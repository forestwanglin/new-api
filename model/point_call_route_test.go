package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestPointCallRouteDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := "local"
			if dialect == "mysql" {
				dsn = os.Getenv("TEST_MYSQL_DSN")
			} else if dialect == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			oldDB, oldPath, oldType := DB, common.SQLitePath, common.MainDatabaseType()
			common.SQLitePath = filepath.Join(t.TempDir(), "point-route.db")
			t.Setenv("POINT_ROUTE_TEST_DSN", dsn)
			db, dbType, err := chooseDB("POINT_ROUTE_TEST_DSN", false)
			require.NoError(t, err)
			DB = db
			common.SetMainDatabaseType(dbType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			models := []any{&User{}, &Token{}, &PointType{}, &PointModelRule{}, &PointAccount{}, &PointTransaction{}, &PointLedger{}, &PointFreeze{}, &PointCallBilling{}, &PointCallEvent{}, &PointCallOperation{}}
			for _, m := range models {
				require.False(t, db.Migrator().HasTable(m), "requires a dedicated empty test database")
			}
			t.Cleanup(func() {
				for i := len(models) - 1; i >= 0; i-- {
					require.NoError(t, db.Migrator().DropTable(models[i]))
				}
				require.NoError(t, sqlDB.Close())
				DB, common.SQLitePath = oldDB, oldPath
				common.SetMainDatabaseType(oldType)
			})
			require.NoError(t, db.AutoMigrate(models...))
			// An old call without a policy snapshot must survive two additive migrations.
			legacy := PointCallBilling{ID: "legacy-route-call", UserID: 1, Model: "model-a", Rate: "1", Unit: "1000", Allocations: "[]", ChannelID: 9}
			require.NoError(t, db.Create(&legacy).Error)
			require.NoError(t, db.Migrator().DropColumn(&PointCallBilling{}, "EligibilitySnapshot"))
			for range 2 {
				require.NoError(t, migratePointCallBilling(db))
			}
			require.NoError(t, db.First(&legacy, "id = ?", legacy.ID).Error)
			assert.Nil(t, legacy.EligibilitySnapshot)
			assert.Equal(t, 9, legacy.ChannelID)

			user := User{Username: "point-route-user", Quota: 1000}
			require.NoError(t, db.Create(&user).Error)
			token := Token{UserId: user.Id, Key: "point-route-key", RemainQuota: 1000, Status: common.TokenStatusEnabled, ExpiredTime: -1}
			require.NoError(t, db.Create(&token).Error)
			types := make([]PointType, 3)
			accounts := make([]PointAccount, 3)
			for i, channel := range []int{10, 20, 30} {
				policy := fmt.Sprintf(`{"version":1,"operator":"AND","groups":[{"operator":"OR","enabled":true,"conditions":[{"kind":"MODEL","match_type":"EXACT","match_value":"model-a","enabled":true}]},{"operator":"OR","enabled":true,"conditions":[{"kind":"CHANNEL","channel_id":"%d","enabled":true}]}]}`, channel)
				types[i] = PointType{Code: fmt.Sprintf("ROUTE_%d", channel), Name: fmt.Sprintf("Route %d", channel), ConsumePriority: 100 - i, EligibilityPolicy: &policy}
				require.NoError(t, db.Create(&types[i]).Error)
				points := int64(100)
				if i == 2 {
					points = 0
				}
				accounts[i] = PointAccount{UserId: int64(user.Id), PointTypeId: types[i].Id, AvailablePoints: points}
				require.NoError(t, db.Create(&accounts[i]).Error)
			}
			require.ErrorIs(t, CreatePointCall("model-only", user.Id, token.Id, "model-a", "1", "1000"), ErrInsufficientPoints)
			require.ErrorIs(t, CreatePointCallForRoute("wrong-model", user.Id, token.Id, "MODEL-A", "1", "1000", 10, "default"), ErrInsufficientPoints)
			// A different live call owns its own freeze on the original account.
			require.NoError(t, CreatePointCallForRoute("foreign-call", user.Id, 0, "model-a", "1", "1000", 10, "default"))
			require.NoError(t, ReservePointCall("foreign-call", "foreign-call:first", 7, false))
			foreignCall, err := GetPointCall("foreign-call")
			require.NoError(t, err)
			foreignBefore, err := pointCallDecode(foreignCall)
			require.NoError(t, err)
			require.NoError(t, CreatePointCallForRoute("route-call", user.Id, token.Id, "model-a", "1", "1000", 10, "default"))
			require.NoError(t, ReservePointCall("route-call", "route-call:first", 10, false))
			call, err := GetPointCall("route-call")
			require.NoError(t, err)
			snapshot := *call.EligibilitySnapshot
			originalBPolicy := *types[1].EligibilityPolicy
			// Later configuration edits do not change this call's eligibility or labels.
			require.NoError(t, db.Model(&types[1]).Updates(map[string]any{"name": "Renamed", "eligibility_policy": `{"version":1,"operator":"OR","groups":[]}`}).Error)
			require.NoError(t, ReservePointCallForRoute("route-call", "route-call:second", 12, false, 20, "retry", true))
			require.NoError(t, ReservePointCallForRoute("route-call", "route-call:second", 12, false, 20, "retry", true))
			require.ErrorIs(t, ReservePointCallForRoute("route-call", "route-call:second", 12, false, 10, "retry", true), ErrPointCallConflict)
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			assert.EqualValues(t, 93, accounts[0].AvailablePoints)
			assert.EqualValues(t, 7, accounts[0].FrozenPoints, "foreign freeze stays untouched")
			foreignAfter, err := GetPointCall("foreign-call")
			require.NoError(t, err)
			assert.Equal(t, foreignCall, foreignAfter)
			var foreignFreeze PointFreeze
			require.NoError(t, db.First(&foreignFreeze, foreignBefore[0].FreezeID).Error)
			assert.EqualValues(t, 7, foreignFreeze.RemainingPoints)
			assert.Equal(t, PointFreezeActive, foreignFreeze.Status)
			assert.EqualValues(t, 88, accounts[1].AvailablePoints)
			assert.EqualValues(t, 12, accounts[1].FrozenPoints)
			require.NoError(t, db.First(&token, token.Id).Error)
			assert.Equal(t, 988, token.RemainQuota, "rebinding reserves only the budget delta")
			before := append([]PointAccount(nil), accounts...)
			callBeforeFault, err := GetPointCall("route-call")
			require.NoError(t, err)
			injected := errors.New("replacement freeze creation failed")
			require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:route-freeze-failure", func(tx *gorm.DB) {
				if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PointFreeze" {
					tx.AddError(injected)
				}
			}))
			faultErr := ReservePointCallForRoute("route-call", "route-call:db-fault", 12, false, 10, "retry", true)
			require.NoError(t, db.Callback().Create().Remove("test:route-freeze-failure"))
			require.ErrorIs(t, faultErr, injected)
			callAfterFault, err := GetPointCall("route-call")
			require.NoError(t, err)
			assert.Equal(t, callBeforeFault, callAfterFault)
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			assert.Equal(t, before, accounts, "DB failure after releasing old holds rolls back the entire route change")
			require.ErrorIs(t, ReservePointCallForRoute("route-call", "route-call:poor", 12, false, 30, "retry", true), ErrInsufficientPoints)
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			assert.Equal(t, before, accounts, "failed rebinding rolls back releases, holds and versions")
			call, err = GetPointCall("route-call")
			require.NoError(t, err)
			assert.Equal(t, 20, call.ChannelID)
			assert.Equal(t, snapshot, *call.EligibilitySnapshot)
			_, err = SetPointCallTarget("route-call", "route-call:partial", 5, false, false, nil)
			require.NoError(t, err)
			require.Error(t, ReservePointCallForRoute("route-call", "route-call:charged-switch", 12, false, 10, "retry", true), "observed usage cannot move to an ineligible point type")
			result, err := SetPointCallTarget("route-call", "route-call:final", 8, true, false, nil)
			require.NoError(t, err)
			require.Len(t, result.Metadata.Items, 1)
			assert.Equal(t, "Route 20", result.Metadata.Items[0].Name, "finance retains its admission label snapshot")
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			assert.EqualValues(t, 92, accounts[1].AvailablePoints)
			assert.Zero(t, accounts[1].FrozenPoints)
			// Point-budget Keys retain exactly one owned budget through a route move.
			// Restore live B policy for this new admission; the older call snapshot
			// above remains independent of both configuration edits.
			require.NoError(t, db.Model(&types[1]).Update("eligibility_policy", originalBPolicy).Error)
			pointToken := Token{UserId: user.Id, Key: "route-point-cap-key", PointLimitEnabled: true, PointLimit: 12, UnlimitedQuota: true, Status: common.TokenStatusEnabled, ExpiredTime: -1}
			require.NoError(t, db.Create(&pointToken).Error)
			require.NoError(t, CreatePointCallForRoute("point-cap-route", user.Id, pointToken.Id, "model-a", "1", "1000", 10, "default"))
			require.NoError(t, ReservePointCallForRoute("point-cap-route", "cap:first", 10, true, 10, "default", false))
			require.NoError(t, ReservePointCallForRoute("point-cap-route", "cap:rebind", 10, true, 20, "retry", true))
			require.NoError(t, db.First(&pointToken, pointToken.Id).Error)
			assert.EqualValues(t, 10, pointToken.ReservedPoints, "same-target route change does not double-reserve the Key")
			capBefore, err := GetPointCall("point-cap-route")
			require.NoError(t, err)
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			before = append([]PointAccount(nil), accounts...)
			require.ErrorIs(t, ReservePointCallForRoute("point-cap-route", "cap:over-limit", 13, true, 10, "retry", true), ErrTokenPointLimit)
			capAfter, err := GetPointCall("point-cap-route")
			require.NoError(t, err)
			assert.Equal(t, capBefore, capAfter)
			for i := range accounts {
				require.NoError(t, db.First(&accounts[i], accounts[i].Id).Error)
			}
			assert.Equal(t, before, accounts, "failed Key cap increase restores the previous route's hold")
			require.NoError(t, db.First(&pointToken, pointToken.Id).Error)
			assert.EqualValues(t, 10, pointToken.ReservedPoints)
			require.NoError(t, ReservePointCallForRoute("point-cap-route", "cap:increase", 12, true, 10, "retry", true))
			require.NoError(t, ReservePointCallForRoute("point-cap-route", "cap:increase", 12, true, 10, "retry", true))
			require.NoError(t, db.First(&pointToken, pointToken.Id).Error)
			assert.EqualValues(t, 12, pointToken.ReservedPoints)
			require.NoError(t, MarkPointCallDispatch("point-cap-route", "submitted"))
			require.ErrorIs(t, ReservePointCallForRoute("point-cap-route", "cap:submitted", 12, true, 20, "retry", true), ErrPointCallConflict)
			_, err = SetPointCallTarget("point-cap-route", "cap:final", 8, true, false, nil)
			require.NoError(t, err)
			require.NoError(t, db.First(&pointToken, pointToken.Id).Error)
			assert.Zero(t, pointToken.ReservedPoints)
			used, err := GetTokenUsedPoints(user.Id, []int{pointToken.Id})
			require.NoError(t, err)
			assert.EqualValues(t, 8, used[pointToken.Id])
			_, err = SetPointCallTarget("point-cap-route", "cap:refund", 0, true, false, nil)
			require.NoError(t, err)
			used, err = GetTokenUsedPoints(user.Id, []int{pointToken.Id})
			require.NoError(t, err)
			assert.Zero(t, used[pointToken.Id])
			require.NoError(t, db.Model(&PointCallBilling{}).Where("id = ?", "route-call").Update("eligibility_snapshot", "{}").Error)
			require.Error(t, ReservePointCallForRoute("route-call", "route-call:corrupt", 12, false, 20, "retry", true))
		})
	}
}
