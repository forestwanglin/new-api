package router

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPointLedgerAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.InvitationReward{}, &model.User{}, &model.UserSession{}, &model.UserAccessToken{}, &model.AuditLog{}, &model.Option{}))
	oldDB, oldLogDB, oldType, oldRedis, oldSecret := model.DB, model.LOG_DB, common.MainDatabaseType(), common.RedisEnabled, common.SessionSecret
	model.DB, model.LOG_DB = db, db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.SessionSecret = "point-ledger-test-secret"
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetMainDatabaseType(oldType)
		common.RedisEnabled, common.SessionSecret = oldRedis, oldSecret
		require.NoError(t, sqlDB.Close())
	})
	user := model.User{Id: 1, Username: "ledger-user", Password: "placeholder", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "ledger-user"}
	require.NoError(t, db.Create(&user).Error)
	bundle, err := service.CreateLoginSession(user.Id, "password", "127.0.0.1", "ledger-test")
	require.NoError(t, err)
	admin := model.User{Id: 2, Username: "ledger-admin", Password: "placeholder", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "ledger-admin"}
	require.NoError(t, db.Create(&admin).Error)
	adminBundle, err := service.CreateLoginSession(admin.Id, "password", "127.0.0.1", "ledger-test")
	require.NoError(t, err)
	pat := model.AccessTokenPrefix + strings.Repeat("l", 43)
	access := &model.UserAccessToken{Name: "ledger PAT", TokenHash: model.AccessTokenFingerprint(pat), TokenHint: model.AccessTokenHint(pat)}
	require.NoError(t, access.SetScopes([]string{"usage:read"}))
	require.NoError(t, model.CreateUserAccessToken(admin.Id, access, service.AccessTokenMaxPerUser))
	engine := gin.New()
	SetApiRouter(engine)
	req := httptest.NewRequest(http.MethodGet, "/api/points/ledger/self", nil)
	req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var got pointAdminResponse
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &got))
	assert.True(t, got.Success)
	assert.Contains(t, string(got.Data), `"items":[]`)
	for _, path := range []string{"/api/points/wallet/self", "/api/points/wallet/rules"} {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", http.StatusUnauthorized}, {pat, http.StatusForbidden}} {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			assert.Equal(t, tc.status, w.Code, w.Body.String())
		}
	}
	for _, tc := range []struct {
		path    string
		success bool
	}{
		{"/api/points/wallet/self", true},
		{"/api/points/wallet/self?user_id=2", false},
		{"/api/points/wallet/self?unknown=1", false},
		{"/api/points/wallet/self?user_id=%ZZ", false},
		{"/api/points/wallet/self?bad=1;ignored=2", false},
		{"/api/points/wallet/self?p=1&p=2", false},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var response pointAdminResponse
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		assert.Equal(t, tc.success, response.Success, w.Body.String())
		if tc.success {
			assert.Contains(t, string(response.Data), `"balances":[]`)
			assert.Contains(t, string(response.Data), `"source_summaries":[]`)
			assert.Contains(t, string(response.Data), `"pending_gpt_points":"0"`)
			assert.Contains(t, string(response.Data), `"pending_invitation_rewards":[]`)
			assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")
		}
	}
	for _, tc := range []struct {
		path, token string
		status      int
		success     bool
	}{
		{"/api/points/ledger/self", "", 401, false},
		{"/api/points/ledger", bundle.AccessToken, 403, false},
		{"/api/points/ledger/self", pat, 403, false},
		{"/api/points/ledger", pat, 403, false},
		{"/api/points/ledger", adminBundle.AccessToken, 200, true},
		{"/api/points/ledger/self?user_id=2", bundle.AccessToken, 200, false},
	} {
		t.Run(tc.path+tc.token[:min(len(tc.token), 4)], func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			require.Equal(t, tc.status, w.Code, w.Body.String())
			if tc.status == 200 {
				var response pointAdminResponse
				require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
				assert.Equal(t, tc.success, response.Success)
			}
		})
	}
	for _, query := range []string{"p=0", "p=-1", "p=9223372036854775807&page_size=100", "page_size=101", "page_size=0", "p=1&p=2", "point_type_id=0", "point_type_id=9223372036854775808", "start_timestamp=-1", "start_timestamp=8640000000000001", "start_timestamp=20&end_timestamp=10", "action=%00", "action=", "unknown=1"} {
		t.Run(query, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/points/ledger/self?"+query, nil)
			req.Header.Set("Authorization", "Bearer "+bundle.AccessToken)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			require.Equal(t, 200, w.Code)
			var response pointAdminResponse
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
			assert.False(t, response.Success)
		})
	}
}

// The same real queries and exact JSON contract run against all three engines.
func TestPointLedgerDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "ledger.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("isolated MySQL test DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("isolated PostgreSQL test DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			tables := []any{&model.PointLedger{}, &model.PointTransaction{}, &model.PointAccount{}, &model.PointType{}, &model.User{}}
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "requires an empty isolated test database")
			}
			require.NoError(t, db.AutoMigrate(tables...))
			assert.True(t, db.Migrator().HasIndex(&model.PointLedger{}, "idx_point_ledger_created_id"), "fresh databases need the history ordering index")
			t.Cleanup(func() {
				for _, table := range tables {
					require.NoError(t, db.Migrator().DropTable(table))
				}
			})
			oldDB, oldType := model.DB, common.MainDatabaseType()
			model.DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			t.Cleanup(func() {
				model.DB = oldDB
				common.SetMainDatabaseType(oldType)
			})
			var version string
			versionSQL := "SELECT version()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			typ := model.PointType{Id: 1, Code: "GENERAL", Name: "General"}
			require.NoError(t, db.Create(&typ).Error)
			// Live balances deliberately differ from historical snapshots.
			accounts := []model.PointAccount{{Id: 1, UserId: 1, PointTypeId: 1, AvailablePoints: 999}, {Id: 2, UserId: 2, PointTypeId: 1}, {Id: 3, UserId: 1, PointTypeId: 99}}
			require.NoError(t, db.Create(&accounts).Error)
			transactions := []model.PointTransaction{{Id: 1, UserId: 1, EventKey: "consume", Action: model.PointActionConsume, BizType: "MODEL_REQUEST", BizId: "req-1", Points: 20, Remark: "request"}, {Id: 2, UserId: 2, EventKey: "other", Action: model.PointActionCredit}, {Id: 3, UserId: 1, EventKey: "freeze", Action: model.PointActionFreeze, RelatedTransactionId: func() *int64 { v := int64(9007199254740993); return &v }()}, {Id: 4, UserId: 1, EventKey: "future", Action: "FUTURE_ACTION"}}
			require.NoError(t, db.Create(&transactions).Error)
			rows := []model.PointLedger{
				{Id: 1, AccountId: 1, TransactionId: 1, AccountVersion: 1, AvailableDelta: -20, AvailableBefore: 9007199254740993, AvailableAfter: 9007199254740973, CreatedAt: 1000},
				{Id: 2, AccountId: 2, TransactionId: 2, AccountVersion: 1, AvailableDelta: 500, AvailableAfter: 500, CreatedAt: 2000},
				{Id: 3, AccountId: 1, TransactionId: 3, AccountVersion: 2, AvailableDelta: -10, FrozenDelta: 10, AvailableBefore: 9007199254740973, AvailableAfter: 9007199254740963, FrozenAfter: 10, CreatedAt: 2000},
				{Id: 4, AccountId: 3, TransactionId: 1, AccountVersion: 1, AvailableDelta: -5, AvailableBefore: 10, AvailableAfter: 5, CreatedAt: 1000},
				{Id: 5, AccountId: 1, TransactionId: 4, AccountVersion: 3, AvailableAfter: 9223372036854775807, CreatedAt: 2000},
				// Cross-user and orphan references must not be visible in either scope.
				{Id: 6, AccountId: 1, TransactionId: 2, AccountVersion: 4, CreatedAt: 3000},
				{Id: 7, AccountId: 1, TransactionId: 99, AccountVersion: 5, CreatedAt: 3000},
			}
			require.NoError(t, db.Create(&rows).Error)
			// Removing only the additive index reproduces the previous ledger
			// schema while retaining real data and all pre-existing constraints.
			require.NoError(t, db.Migrator().DropIndex(&model.PointLedger{}, "idx_point_ledger_created_id"))
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.PointLedger{}))
				assert.True(t, db.Migrator().HasIndex(&model.PointLedger{}, "idx_point_ledger_created_id"))
				assert.True(t, db.Migrator().HasIndex(&model.PointLedger{}, "idx_point_ledger_account_version"))
			}
			var preserved []model.PointLedger
			require.NoError(t, db.Order("id").Find(&preserved).Error)
			assert.Equal(t, rows, preserved, "adding the ordering index must preserve every historical snapshot")
			err = db.Create(&model.PointLedger{Id: 99, AccountId: 1, AccountVersion: 1, TransactionId: 1, CreatedAt: 4000}).Error
			require.Error(t, err, "existing account/version uniqueness must survive the upgrade")
			self, err := model.GetPointLedger(model.PointLedgerFilter{UserID: 1, Page: 1, PageSize: 20}, false)
			require.NoError(t, err)
			require.Len(t, self.Items, 4)
			assert.EqualValues(t, 4, self.Total)
			assert.EqualValues(t, []int64{5, 3, 4, 1}, []int64{self.Items[0].Id, self.Items[1].Id, self.Items[2].Id, self.Items[3].Id})
			assert.Equal(t, "", self.Items[2].PointTypeName, "missing type keeps ledger row")
			assert.EqualValues(t, 9007199254740973, self.Items[3].AvailableAfter, "historical balance must not be live balance")
			encoded, err := common.Marshal(self)
			require.NoError(t, err)
			assert.Contains(t, string(encoded), `"available_after":"9223372036854775807"`)
			assert.Contains(t, string(encoded), `"available_before":"9007199254740993"`)
			assert.Contains(t, string(encoded), `"available_delta":"-20"`)
			assert.Contains(t, string(encoded), `"related_transaction_id":"9007199254740993"`)
			assert.Contains(t, string(encoded), `"freeze_id":null`)
			assert.NotContains(t, string(encoded), "event_key")
			assert.NotContains(t, string(encoded), "billing_snapshot")
			next, err := model.GetPointLedger(model.PointLedgerFilter{UserID: 1, Page: 2, PageSize: 2}, false)
			require.NoError(t, err)
			require.Len(t, next.Items, 2)
			assert.EqualValues(t, 4, next.Items[0].Id)
			assert.EqualValues(t, 4, next.Total)
			start, end := int64(1000), int64(2000)
			filtered, err := model.GetPointLedger(model.PointLedgerFilter{UserID: 1, Page: 1, PageSize: 20, PointTypeID: 1, Action: "CONSUME", StartTimestamp: &start, EndTimestamp: &end}, false)
			require.NoError(t, err)
			require.Len(t, filtered.Items, 1)
			assert.EqualValues(t, 1, filtered.Total)
			var historyQueries []struct {
				sql  string
				args []any
			}
			if dialect == "mysql" {
				capture := func(tx *gorm.DB) {
					historyQueries = append(historyQueries, struct {
						sql  string
						args []any
					}{tx.Statement.SQL.String(), append([]any(nil), tx.Statement.Vars...)})
				}
				require.NoError(t, db.Callback().Query().After("gorm:query").Register("ledger_test:capture_plan", capture))
				require.NoError(t, db.Callback().Row().After("gorm:row").Register("ledger_test:capture_plan", capture))
			}
			all, err := model.GetPointLedger(model.PointLedgerFilter{Page: 1, PageSize: 20}, true)
			require.NoError(t, err)
			assert.EqualValues(t, 5, all.Total)
			if dialect == "mysql" {
				require.NoError(t, db.Callback().Query().Remove("ledger_test:capture_plan"))
				require.NoError(t, db.Callback().Row().Remove("ledger_test:capture_plan"))
				var planCount int
				for _, query := range historyQueries {
					if !strings.Contains(query.sql, "FROM point_ledger AS ledger") {
						continue
					}
					var plan []struct {
						Table string
						Type  string
						Key   *string
					}
					require.NoError(t, db.Raw("EXPLAIN "+query.sql, query.args...).Scan(&plan).Error)
					require.NotEmpty(t, plan)
					assert.Equal(t, "ledger", plan[0].Table, "history must drive from ledger, avoiding account/transaction cross-products")
					for _, step := range plan {
						if step.Table == "txn" {
							assert.Equal(t, "eq_ref", step.Type)
							require.NotNil(t, step.Key)
							assert.Equal(t, "PRIMARY", *step.Key, "one primary-key transaction lookup per ledger row")
						}
					}
					planCount++
				}
				assert.Equal(t, 2, planCount, "verify actual plans for both count and list queries")
			}
			other, err := model.GetPointLedger(model.PointLedgerFilter{UserID: 2, Page: 1, PageSize: 20}, true)
			require.NoError(t, err)
			require.Len(t, other.Items, 1)
			assert.EqualValues(t, 2, other.Items[0].UserId)
			empty, err := model.GetPointLedger(model.PointLedgerFilter{UserID: 3, Page: 1, PageSize: 20}, false)
			require.NoError(t, err)
			assert.Empty(t, empty.Items)
			_, err = model.GetPointLedger(model.PointLedgerFilter{Page: 1, PageSize: 20}, false)
			require.Error(t, err)
			for table, want := range map[string]int64{"point_ledger": 7, "point_transactions": 4, "point_accounts": 3} {
				var count int64
				require.NoError(t, db.Table(table).Count(&count).Error)
				assert.Equal(t, want, count, fmt.Sprintf("query must not write %s", table))
			}
			for _, phase := range []string{"count", "list"} {
				t.Run("cancel_before_"+phase, func(t *testing.T) {
					ctx, cancel := context.WithCancel(context.Background())
					defer cancel()
					require.NoError(t, db.Callback().Query().After("gorm:query").Register("ledger_test:cancel", func(tx *gorm.DB) {
						if (phase == "count" && tx.Statement.Table == "point_types") ||
							(phase == "list" && strings.HasPrefix(tx.Statement.SQL.String(), "SELECT count(*)")) {
							cancel()
						}
					}))
					defer func() { require.NoError(t, db.Callback().Query().Remove("ledger_test:cancel")) }()
					page, err := model.GetPointLedgerWithContext(ctx, model.PointLedgerFilter{Page: 1, PageSize: 20}, true)
					require.ErrorIs(t, err, context.Canceled, "each database phase must honor the request context")
					assert.Nil(t, page, "cancellation must not return a partial successful page")
				})
			}
			require.NoError(t, db.Migrator().DropTable(&model.PointLedger{}))
			_, err = model.GetPointLedger(model.PointLedgerFilter{UserID: 1, Page: 1, PageSize: 20}, false)
			require.Error(t, err, "query failure must not become a fabricated empty page")
		})
	}
}

// Cancellation must reach the database instead of returning a successful empty page.
func TestPointLedgerRequestCancellation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canceled-ledger.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}, &model.User{}))
	oldDB, oldType := model.DB, common.MainDatabaseType()
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = oldDB
		common.SetMainDatabaseType(oldType)
	})
	engine := gin.New()
	engine.GET("/ledger", controller.GetAdminPointLedger)
	for _, expired := range []bool{false, true} {
		t.Run(fmt.Sprintf("expired=%t", expired), func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			if expired {
				cancel()
				ctx, cancel = context.WithDeadline(context.Background(), time.Unix(1, 0))
			}
			cancel()
			req := httptest.NewRequest(http.MethodGet, "/ledger", nil).WithContext(ctx)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			require.Equal(t, http.StatusOK, w.Code)
			var response pointAdminResponse
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
			assert.False(t, response.Success, "a canceled or expired query must fail, not report an empty history")
			assert.NotContains(t, w.Body.String(), "context canceled")
			assert.NotContains(t, w.Body.String(), "deadline exceeded")
		})
	}
}
