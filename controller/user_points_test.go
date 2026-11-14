package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestAdminUserPointsOperationLogs(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}))
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	user := model.User{Username: "point-owner", AffCode: "point-owner", Role: common.RoleCommonUser, Quota: 321}
	require.NoError(t, db.Create(&user).Error)
	typ := model.PointType{Code: "FUTURE", Name: "Future points", ConsumePriority: 999}
	require.NoError(t, db.Create(&typ).Error)
	account := model.PointAccount{UserId: int64(user.Id), PointTypeId: typ.Id, AvailablePoints: -6, FrozenPoints: 7}
	require.NoError(t, db.Create(&account).Error)
	call := func(mode, amount, requestID string) {
		t.Helper()
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(user.Id)}}
		c.Request = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/user/%d/points", user.Id), strings.NewReader(fmt.Sprintf(`{"point_type_id":"%d","mode":%q,"amount":%q,"request_id":%q}`, typ.Id, mode, amount, requestID)))
		c.Set("id", operator.Id)
		c.Set("role", operator.Role)
		c.Set("username", operator.Username)
		c.Set(common.RequestIdKey, "http-"+requestID+"-"+mode)
		AdjustUserPoints(c)
		require.Contains(t, rec.Body.String(), `"success":true`)
		assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyAuditLogged))
		var response struct {
			Data map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(rec.Body.Bytes(), &response))
		assert.Len(t, response.Data, 6, "internal log metadata must not alter the HTTP contract")
	}
	call("add", "9007199254740993", "initial")
	call("subtract", "9007199254740999", "debt")
	// Replay must use original journal values after the account has changed.
	call("add", "9007199254740993", "initial")
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	for i, want := range []struct{ action, amount, before, after string }{{"user.points_add", "9007199254740993", "-6", "9007199254740987"}, {"user.points_subtract", "9007199254740999", "9007199254740987", "-12"}} {
		log := logs[i]
		assert.Equal(t, user.Id, log.UserId)
		assert.Equal(t, model.LogTypeTopup, log.Type)
		var other model.AuditOther
		require.NoError(t, common.Unmarshal([]byte(log.Other), &other))
		require.NotNil(t, other.Op)
		encodedParams, err := common.Marshal(other.Op.Params)
		require.NoError(t, err)
		var params map[string]any
		require.NoError(t, common.Unmarshal(encodedParams, &params))
		assert.Equal(t, want.action, other.Op.Action)
		assert.Equal(t, want.amount, params["amount"])
		assert.Equal(t, want.before, params["from"])
		assert.Equal(t, want.after, params["to"])
		assert.Equal(t, typ.Code, params["point_type_code"])
		assert.Equal(t, typ.Name, params["point_type_name"])
		assert.Equal(t, strconv.FormatInt(typ.Id, 10), params["point_type_id"])
		assert.Equal(t, user.Username, params["target_username"])
		require.NotNil(t, other.AdminInfo)
		assert.Equal(t, operator.Id, other.AdminInfo.AdminID)
	}
	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Order("id").Find(&audits).Error)
	require.Len(t, audits, 3)
	assert.Equal(t, "user.points_add", audits[0].Action)
	assert.Equal(t, "user.points_subtract", audits[1].Action)
	assert.Equal(t, "user.points_replay", audits[2].Action)
	for _, audit := range audits {
		assert.Equal(t, operator.Id, audit.UserId)
		assert.True(t, audit.Success)
	}
	replayParams, err := common.Marshal(audits[2].Other.Op.Params)
	require.NoError(t, err)
	assert.Contains(t, string(replayParams), `"from":"-6"`)
	assert.Contains(t, string(replayParams), `"to":"9007199254740987"`)
	require.NoError(t, db.First(&account, account.Id).Error)
	assert.EqualValues(t, -12, account.AvailablePoints)
	assert.EqualValues(t, 7, account.FrozenPoints)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, 321, user.Quota)
	// A newly registered second type uses the same log path without hardcoded types.
	typ = model.PointType{Code: "SECOND", Name: "Second points", ConsumePriority: 1}
	require.NoError(t, db.Create(&typ).Error)
	call("add", "2", "second-type")
	var secondLog model.Log
	require.NoError(t, model.LOG_DB.Order("id DESC").First(&secondLog).Error)
	assert.Contains(t, secondLog.Other, `"point_type_code":"SECOND"`)
	assert.Contains(t, secondLog.Other, `"from":"0"`)
	assert.Contains(t, secondLog.Other, `"to":"2"`)
}

func TestAdminUserPointsFailedOperationAudit(t *testing.T) {
	for _, tc := range []struct {
		name, body, reason       string
		denied, failDB, conflict bool
	}{
		{name: "missing_type", body: `{"point_type_id":"999999","mode":"add","amount":"2","request_id":"missing"}`, reason: "point_type_not_found"},
		{name: "conflict", body: `{"point_type_id":"1","mode":"add","amount":"3","request_id":"conflict"}`, reason: "request_conflict", conflict: true},
		{name: "invalid_json", body: `{`, reason: "invalid_parameters"},
		{name: "invalid_amount", body: `{"point_type_id":"1","mode":"add","amount":"0","request_id":"bad"}`, reason: "invalid_parameters"},
		{name: "permission", body: `{"point_type_id":"1","mode":"subtract","amount":"2","request_id":"denied"}`, reason: "permission_denied", denied: true},
		{name: "journal_failure", body: `{"point_type_id":"1","mode":"add","amount":"2","request_id":"failed"}`, reason: "database_error", failDB: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}))
			operator := createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "point-failed", AffCode: "point-failed", Role: common.RoleCommonUser}
			require.NoError(t, db.Create(&user).Error)
			require.NoError(t, db.Create(&model.PointType{Id: 1, Code: "FUTURE", Name: "Future"}).Error)
			if tc.conflict {
				_, err := model.AdjustUserPoints(user.Id, operator.Id, operator.Role, 1, "add", "2", "conflict")
				require.NoError(t, err)
			}
			if tc.failDB {
				require.NoError(t, db.Callback().Create().Before("gorm:create").Register("test:fail_point_journal", func(tx *gorm.DB) {
					if tx.Statement.Table == "point_ledger" {
						tx.AddError(errors.New("private database failure"))
					}
				}))
			}
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(user.Id)}}
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/1/points", strings.NewReader(tc.body))
			c.Set("id", operator.Id)
			c.Set("role", operator.Role)
			if tc.denied {
				c.Set("role", common.RoleCommonUser)
			}
			AdjustUserPoints(c)
			assert.Contains(t, rec.Body.String(), `"success":false`)
			assert.True(t, common.GetContextKeyBool(c, constant.ContextKeyAuditLogged))
			var count int64
			require.NoError(t, model.LOG_DB.Model(&model.Log{}).Count(&count).Error)
			assert.Zero(t, count)
			var audit model.AuditLog
			require.NoError(t, model.LOG_DB.First(&audit).Error)
			assert.False(t, audit.Success)
			params, err := common.Marshal(audit.Other.Op.Params)
			require.NoError(t, err)
			assert.Contains(t, string(params), `"failure_reason":"`+tc.reason+`"`)
			assert.NotContains(t, audit.Other.Op.Params, "from")
			assert.NotContains(t, audit.Other.Op.Params, "to")
			encoded, err := common.Marshal(audit.Other)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), "private database failure")
		})
	}
}

func TestAdminUserPointsLogFailureKeepsCommittedAdjustment(t *testing.T) {
	for _, table := range []string{"logs", "audit_logs"} {
		t.Run(table, func(t *testing.T) {
			db := setupManageUserTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.PointType{}, &model.PointAccount{}, &model.PointTransaction{}, &model.PointLedger{}))
			operator := createQuotaTestOperator(t, db, common.RoleRootUser)
			user := model.User{Username: "point-log-failed", AffCode: "point-log-failed", Role: common.RoleCommonUser, Quota: 321}
			require.NoError(t, db.Create(&user).Error)
			typ := model.PointType{Code: "FUTURE", Name: "Future"}
			require.NoError(t, db.Create(&typ).Error)
			require.NoError(t, model.LOG_DB.Callback().Create().Before("gorm:create").Register("test:fail_point_log", func(tx *gorm.DB) {
				if tx.Statement.Table == table {
					tx.AddError(errors.New("log unavailable"))
				}
			}))
			for i := 0; i < 2; i++ {
				rec := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(rec)
				c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(user.Id)}}
				c.Request = httptest.NewRequest(http.MethodPost, "/api/user/1/points", strings.NewReader(fmt.Sprintf(`{"point_type_id":"%d","mode":"add","amount":"2","request_id":"log-failure"}`, typ.Id)))
				c.Set("id", operator.Id)
				c.Set("role", operator.Role)
				AdjustUserPoints(c)
				require.Contains(t, rec.Body.String(), `"success":true`)
			}
			var account model.PointAccount
			require.NoError(t, db.Where("user_id = ?", user.Id).First(&account).Error)
			assert.EqualValues(t, 2, account.AvailablePoints)
			var count int64
			require.NoError(t, db.Model(&model.PointTransaction{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			require.NoError(t, db.Model(&model.PointLedger{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		})
	}
}
