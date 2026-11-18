package service

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func newRegistrationSMS(t *testing.T, phone string) string {
	t.Helper()
	token, _, err := createPhoneFlow(phoneSMSPurpose, "registration-browser", phoneFlowPayload{Phone: phone, Digest: phoneTestSMSHash(t, "123456")}, time.Minute)
	require.NoError(t, err)
	return token
}

func TestPhoneRegistrationUsernameConflictRetriesWholeTransaction(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	collision := model.User{Username: "phone_collision", AffCode: "collision"}
	require.NoError(t, model.DB.Create(&collision).Error)
	token := newRegistrationSMS(t, "13800138000")
	attempts := 0
	var candidates []string
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("test:phone-username-collision", func(tx *gorm.DB) {
		if user, ok := tx.Statement.Dest.(*model.User); ok {
			attempts++
			candidates = append(candidates, user.Username)
			if attempts == 1 {
				user.Username = collision.Username
			}
		}
	}))
	t.Cleanup(func() { require.NoError(t, model.DB.Callback().Create().Remove("test:phone-username-collision")) })
	user, err := CompletePhoneLogin(token, "123456", "registration-browser")
	require.NoError(t, err)
	assert.Equal(t, 2, attempts)
	require.Len(t, candidates, 2)
	assert.NotEqual(t, candidates[0], candidates[1])
	assert.Regexp(t, `^phone_[0-9A-Za-z]{14}$`, user.Username)
	owner, err := model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	assert.Equal(t, user.Id, owner)
	var flow model.AuthFlow
	require.NoError(t, model.DB.Where("purpose = ? AND provider = ?", phoneSMSPurpose, "13800138000").First(&flow).Error)
	assert.Equal(t, 1, flow.Attempts, "transaction retries are not verification guesses")
	assert.NotNil(t, flow.ConsumedAt)
}

func TestPhoneRegistrationUsernameConflictIsBoundedAndRollsBackProof(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	collision := model.User{Username: "phone_collision", AffCode: "collision"}
	require.NoError(t, model.DB.Create(&collision).Error)
	token := newRegistrationSMS(t, "13800138000")
	attempts := 0
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("test:phone-username-exhausted", func(tx *gorm.DB) {
		if user, ok := tx.Statement.Dest.(*model.User); ok {
			attempts++
			user.Username = collision.Username
		}
	}))
	t.Cleanup(func() { require.NoError(t, model.DB.Callback().Create().Remove("test:phone-username-exhausted")) })
	_, err := CompletePhoneLogin(token, "123456", "registration-browser")
	require.Error(t, err)
	assert.Equal(t, 3, attempts)
	flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: "registration-browser"})
	require.NoError(t, err)
	assert.Nil(t, flow.ConsumedAt)
	assert.Equal(t, 1, flow.Attempts)
	owner, err := model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	assert.Zero(t, owner)
}

func TestPhoneRegistrationDoesNotRetryOtherInsertFailures(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	token := newRegistrationSMS(t, "13800138000")
	failure := errors.New("test user insert failure")
	attempts := 0
	require.NoError(t, model.DB.Callback().Create().Before("gorm:create").Register("test:phone-other-failure", func(tx *gorm.DB) {
		if _, ok := tx.Statement.Dest.(*model.User); ok {
			attempts++
			tx.AddError(failure)
		}
	}))
	t.Cleanup(func() { require.NoError(t, model.DB.Callback().Create().Remove("test:phone-other-failure")) })
	_, err := CompletePhoneLogin(token, "123456", "registration-browser")
	require.ErrorIs(t, err, failure)
	assert.Equal(t, 1, attempts)
	_, err = model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: "registration-browser"})
	require.NoError(t, err)
}

type phoneRegistrationRandomFailure struct{}

func (phoneRegistrationRandomFailure) Read([]byte) (int, error) {
	return 0, fmt.Errorf("test randomness unavailable")
}

func TestPhoneRegistrationRandomFailurePreservesProof(t *testing.T) {
	setupAuthSessionTestDB(t)
	require.NoError(t, model.DB.AutoMigrate(&model.ExternalIdentityClaim{}))
	token := newRegistrationSMS(t, "13800138000")
	previous := rand.Reader
	rand.Reader = phoneRegistrationRandomFailure{}
	t.Cleanup(func() { rand.Reader = previous })
	_, err := CompletePhoneLogin(token, "123456", "registration-browser")
	require.Error(t, err)
	rand.Reader = previous
	_, err = model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: "registration-browser"})
	require.NoError(t, err)
	owner, err := model.GetPhoneUserID("13800138000")
	require.NoError(t, err)
	assert.Zero(t, owner)
}

// The callback forces real insert conflicts and simultaneous transactions, so
// the matrix exercises each driver's error and rollback semantics rather than
// constructing driver errors in a unit test.
func TestPhoneRegistrationUsernameDatabaseMatrix(t *testing.T) {
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var dialect gorm.Dialector
			switch engine {
			case "sqlite":
				dialect = sqlite.Open(filepath.Join(t.TempDir(), "phone-registration.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				dialect = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				dialect = postgres.Open(dsn)
			}
			db, err := gorm.Open(dialect, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if engine == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			oldDB, oldRedis := model.DB, common.RedisEnabled
			oldQuota := common.QuotaForNewUser
			model.DB, common.RedisEnabled, common.QuotaForNewUser = db, false, 0
			t.Cleanup(func() { model.DB, common.RedisEnabled, common.QuotaForNewUser = oldDB, oldRedis, oldQuota })
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.User{}, &model.AuthFlow{}, &model.ExternalIdentityClaim{}))
			}
			phones := make([]string, 4)
			phoneSuffix := time.Now().UnixNano() % 10000000
			for i := range phones {
				phones[i] = fmt.Sprintf("13%d%08d", i+5, phoneSuffix)
			}
			var createdUsers []int
			t.Cleanup(func() {
				require.NoError(t, db.Where("provider = ? AND subject IN ?", "phone", phones).Delete(&model.ExternalIdentityClaim{}).Error)
				require.NoError(t, db.Where("purpose = ? AND provider IN ?", phoneSMSPurpose, phones).Delete(&model.AuthFlow{}).Error)
				if len(createdUsers) > 0 {
					require.NoError(t, db.Unscoped().Where("id IN ?", createdUsers).Delete(&model.User{}).Error)
				}
			})
			collision := model.User{Username: "collision_" + common.GetRandomString(10), AffCode: common.GetRandomString(4)}
			require.NoError(t, db.Create(&collision).Error)
			createdUsers = append(createdUsers, collision.Id)
			attempts := 0
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:matrix-username-collision", func(tx *gorm.DB) {
				if user, ok := tx.Statement.Dest.(*model.User); ok {
					attempts++
					if attempts == 1 {
						user.Username = collision.Username
					}
				}
			}))
			token := newRegistrationSMS(t, phones[0])
			user, err := CompletePhoneLogin(token, "123456", "registration-browser")
			require.NoError(t, err)
			createdUsers = append(createdUsers, user.Id)
			assert.Equal(t, 2, attempts)
			require.NoError(t, db.Callback().Create().Remove("test:matrix-username-collision"))

			// Failed username attempts must all roll back their proof consumption.
			attempts = 0
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:matrix-username-exhausted", func(tx *gorm.DB) {
				if user, ok := tx.Statement.Dest.(*model.User); ok {
					attempts++
					user.Username = collision.Username
				}
			}))
			token = newRegistrationSMS(t, phones[1])
			_, err = CompletePhoneLogin(token, "123456", "registration-browser")
			require.Error(t, err)
			assert.Equal(t, 3, attempts)
			flow, err := model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: "registration-browser"})
			require.NoError(t, err)
			assert.Equal(t, 1, flow.Attempts)
			require.NoError(t, db.Callback().Create().Remove("test:matrix-username-exhausted"))

			// Another users-table uniqueness error must not regenerate a name.
			attempts = 0
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:matrix-affiliate-conflict", func(tx *gorm.DB) {
				if user, ok := tx.Statement.Dest.(*model.User); ok {
					attempts++
					user.AffCode = collision.AffCode
				}
			}))
			_, err = CompletePhoneLogin(token, "123456", "registration-browser")
			require.Error(t, err)
			assert.Equal(t, 1, attempts)
			_, err = model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: "registration-browser"})
			require.NoError(t, err)
			require.NoError(t, db.Callback().Create().Remove("test:matrix-affiliate-conflict"))

			// SQLite's single writer serializes registrations; MySQL and Postgres
			// must allow both transactions to reach creation before either inserts.
			arrived, release := make(chan struct{}, 2), make(chan struct{})
			if engine != "sqlite" {
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:matrix-concurrent-registration", func(tx *gorm.DB) {
					if _, ok := tx.Statement.Dest.(*model.User); ok {
						arrived <- struct{}{}
						<-release
					}
				}))
			}
			first, second := newRegistrationSMS(t, phones[2]), newRegistrationSMS(t, phones[3])
			type result struct {
				user *model.User
				err  error
			}
			results := make(chan result, 2)
			for _, sms := range []string{first, second} {
				go func() {
					u, e := CompletePhoneLogin(sms, "123456", "registration-browser")
					results <- result{u, e}
				}()
			}
			if engine != "sqlite" {
				<-arrived
				<-arrived
				close(release)
			}
			var usernames []string
			for range 2 {
				r := <-results
				require.NoError(t, r.err)
				createdUsers = append(createdUsers, r.user.Id)
				assert.Regexp(t, `^phone_[0-9A-Za-z]{14}$`, r.user.Username)
				usernames = append(usernames, r.user.Username)
			}
			assert.NotEqual(t, usernames[0], usernames[1])
			if engine != "sqlite" {
				require.NoError(t, db.Callback().Create().Remove("test:matrix-concurrent-registration"))
			}
		})
	}
}
