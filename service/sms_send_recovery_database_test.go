package service

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Real engines verify atomic preparation, one-use authorization and derived
// retry grants. The provider callback executes after preparation has committed.
func TestSMSRecoveryDatabaseMatrix(t *testing.T) {
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var dialect gorm.Dialector
			switch engine {
			case "sqlite":
				dialect = sqlite.Open(filepath.Join(t.TempDir(), "sms.db"))
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
			model.DB, common.RedisEnabled = db, false
			t.Cleanup(func() { model.DB, common.RedisEnabled = oldDB, oldRedis })
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.AuthFlow{}))
			}
			browser := "sms-matrix-" + common.GetRandomString(12)
			phone := fmt.Sprintf("138%08d", time.Now().UnixNano()%100000000)
			t.Cleanup(func() {
				require.NoError(t, db.Where("session_id = ? OR provider = ? OR purpose IN ?", browser, phone, []string{"phone_cooldown", "phone_send_limit"}).Delete(&model.AuthFlow{}).Error)
			})
			var calls atomic.Int32
			reject := true
			configureSMSRecoveryTest(t, func(r *http.Request) (*http.Response, error) {
				calls.Add(1)
				var flow model.AuthFlow
				require.NoError(t, db.Where("purpose = ? AND provider = ? AND consumed_at IS NULL", phoneSMSPurpose, phone).First(&flow).Error)
				require.Equal(t, smsSending, flow.Intent)
				if reject {
					return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"Code":"isv.AMOUNT_NOT_ENOUGH"}`)), Header: http.Header{}}, nil
				}
				return nil, errors.New("ambiguous timeout")
			})
			permit, original, err := createPhoneFlow(phoneSendPurpose, browser, phoneFlowPayload{Phone: phone}, 2*time.Minute)
			require.NoError(t, err)
			failure := errors.New("matrix preparation failure")
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:matrix-prepare-failure", func(tx *gorm.DB) {
				if flow, ok := tx.Statement.Dest.(*model.AuthFlow); ok && flow.Purpose == phoneSMSPurpose {
					tx.AddError(failure)
				}
			}))
			_, err = SendPhoneSMS(permit, browser, "192.0.2.88")
			require.ErrorIs(t, err, failure)
			require.EqualValues(t, 0, calls.Load())
			_, err = model.GetAuthFlow(permit, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: browser})
			require.NoError(t, err)
			require.NoError(t, db.Callback().Create().Remove("test:matrix-prepare-failure"))
			_, err = SendPhoneSMS(permit, browser, "192.0.2.88")
			var delivery *SMSDeliveryError
			require.ErrorAs(t, err, &delivery)
			require.NotEmpty(t, delivery.RetryToken)
			retry, err := model.GetAuthFlow(delivery.RetryToken, model.AuthFlowMatch{Purpose: phoneSendPurpose, SessionId: browser})
			require.NoError(t, err)
			require.WithinDuration(t, original.ExpiresAt, retry.ExpiresAt, time.Millisecond)
			_, err = SendPhoneSMS(delivery.RetryToken, browser, "192.0.2.88")
			require.ErrorIs(t, err, ErrPhoneRateLimit)
			require.NoError(t, db.Where("purpose = ?", "phone_cooldown").Delete(&model.AuthFlow{}).Error)
			reject = false
			results := make(chan error, 2)
			for range 2 {
				go func() {
					token, e := SendPhoneSMS(delivery.RetryToken, browser, "192.0.2.88")
					if e == nil {
						_, e = model.GetAuthFlow(token, model.AuthFlowMatch{Purpose: phoneSMSPurpose, SessionId: browser})
					}
					results <- e
				}()
			}
			successes := 0
			for range 2 {
				if <-results == nil {
					successes++
				}
			}
			require.Equal(t, 1, successes)
			require.EqualValues(t, 2, calls.Load())
			var flow model.AuthFlow
			require.NoError(t, db.Where("purpose = ? AND provider = ? AND consumed_at IS NULL", phoneSMSPurpose, phone).First(&flow).Error)
			require.Equal(t, smsUnknown, flow.Intent)
		})
	}
}
