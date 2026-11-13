package model

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhoneIdentityDatabaseMatrix(t *testing.T) {
	for _, engine := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(engine, func(t *testing.T) {
			var driver gorm.Dialector
			switch engine {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "phone.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			require.NoError(t, db.AutoMigrate(&ExternalIdentityClaim{}, &AuthFlow{}))
			sqlDB, err := db.DB()
			require.NoError(t, err)
			if engine == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			t.Cleanup(func() { _ = sqlDB.Close() })
			// Reconstruct the preceding schema and preserve a representative pending flow.
			require.NoError(t, db.Migrator().DropColumn(&AuthFlow{}, "Attempts"))
			legacyHash := authFlowTokenHash("legacy-upgrade-" + engine)
			require.NoError(t, db.Exec("DELETE FROM auth_flows WHERE token_hash = ?", legacyHash).Error)
			require.NoError(t, db.Table("auth_flows").Create(map[string]any{
				"token_hash": legacyHash, "purpose": "oauth", "payload": "legacy-payload",
				"created_at": time.Now(), "expires_at": time.Now().Add(time.Minute),
			}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&ExternalIdentityClaim{}, &AuthFlow{}))
			}
			var preserved AuthFlow
			require.NoError(t, db.Where("token_hash = ?", legacyHash).Take(&preserved).Error)
			require.Equal(t, "legacy-payload", preserved.Payload)
			require.Zero(t, preserved.Attempts)
			old := DB
			DB = db
			t.Cleanup(func() { DB = old })
			require.NoError(t, db.Where("provider = ?", "phone").Delete(&ExternalIdentityClaim{}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&ExternalIdentityClaim{}, &AuthFlow{}))
			}
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return ClaimExternalIdentityWithTx(tx, "phone", "13800138000", 991001) }))
			require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return ClaimExternalIdentityWithTx(tx, "phone", "13800138000", 991002) }), ErrExternalIdentityAlreadyClaimed)
			require.ErrorIs(t, db.Transaction(func(tx *gorm.DB) error { return ClaimExternalIdentityWithTx(tx, "phone", "13900139000", 991001) }), ErrExternalIdentityAlreadyClaimed)
			// Database uniqueness must choose exactly one owner under competing claims.
			var wg sync.WaitGroup
			results := make(chan error, 2)
			for _, owner := range []int{991003, 991004} {
				wg.Go(func() {
					results <- db.Transaction(func(tx *gorm.DB) error { return ClaimExternalIdentityWithTx(tx, "phone", "13700137000", owner) })
				})
			}
			wg.Wait()
			close(results)
			successes := 0
			for err := range results {
				if err == nil {
					successes++
				} else {
					require.ErrorIs(t, err, ErrExternalIdentityAlreadyClaimed)
				}
			}
			require.Equal(t, 1, successes)
			var owners int64
			require.NoError(t, db.Model(&ExternalIdentityClaim{}).Where("provider = ? AND subject = ?", "phone", "13700137000").Count(&owners).Error)
			require.EqualValues(t, 1, owners)
			id, err := GetPhoneUserID("13800138000")
			require.NoError(t, err)
			require.Equal(t, 991001, id)
			token, _, err := CreateAuthFlow(AuthFlowCreate{Purpose: "phone_sms", ExpiresAt: time.Now().Add(time.Minute)})
			require.NoError(t, err)
			for range 5 {
				require.NoError(t, AttemptAuthFlow(token, "phone_sms", 5))
			}
			require.ErrorIs(t, AttemptAuthFlow(token, "phone_sms", 5), ErrAuthFlowInvalid)
			expired, _, err := CreateAuthFlow(AuthFlowCreate{Purpose: "phone_sms", ExpiresAt: time.Now().Add(time.Minute)})
			require.NoError(t, err)
			require.NoError(t, db.Model(&AuthFlow{}).Where("token_hash = ?", authFlowTokenHash(expired)).Update("expires_at", time.Now().Add(-time.Second)).Error)
			require.ErrorIs(t, AttemptAuthFlow(expired, "phone_sms", 5), ErrAuthFlowInvalid)
		})
	}
}
