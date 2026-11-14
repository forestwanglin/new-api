package model

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsClickHouseDSN(t *testing.T) {
	cases := []struct {
		dsn  string
		want bool
	}{
		{"clickhouse://default:pass@localhost:9000/logs", true},
		{"tcp://localhost:9000/logs", true},
		{"http://localhost:8123/logs", true},
		{"https://localhost:8443/logs", true},
		{"postgres://root:pass@localhost:5432/db", false},
		{"postgresql://root:pass@localhost:5432/db", false},
		{"root:pass@tcp(localhost:3306)/db", false},
		{"local", false},
		{"", false},
	}
	for _, c := range cases {
		assert.Equalf(t, c.want, isClickHouseDSN(c.dsn), "dsn=%q", c.dsn)
	}
}

func TestNormalizeClickHouseDSN(t *testing.T) {
	// https without secure gets secure=true appended
	normalized := normalizeClickHouseDSN("https://default:pass@localhost:8443/logs")
	assert.Contains(t, normalized, "secure=true")
	assert.True(t, strings.HasPrefix(normalized, "https://"))

	// https that already specifies secure is left untouched
	assert.Equal(t,
		"https://localhost:8443/logs?secure=false",
		normalizeClickHouseDSN("https://localhost:8443/logs?secure=false"),
	)

	// non-https schemes are returned verbatim
	assert.Equal(t, "clickhouse://localhost:9000/logs", normalizeClickHouseDSN("clickhouse://localhost:9000/logs"))
	assert.Equal(t, "tcp://localhost:9000/logs", normalizeClickHouseDSN("tcp://localhost:9000/logs"))
}

func TestChooseDBRejectsClickHouseForMainDatabase(t *testing.T) {
	original, had := os.LookupEnv("SQL_DSN")
	t.Cleanup(func() {
		if had {
			require.NoError(t, os.Setenv("SQL_DSN", original))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})
	require.NoError(t, os.Setenv("SQL_DSN", "clickhouse://default:pass@localhost:9000/logs"))

	db, dbType, err := chooseDB("SQL_DSN", false)
	require.Error(t, err)
	assert.Nil(t, db)
	assert.Equal(t, common.DatabaseType(""), dbType)
	assert.Contains(t, err.Error(), "does not support ClickHouse")
}

func TestClickHouseLogTTLExpression(t *testing.T) {
	assert.Equal(t, "", clickHouseLogTTLExpression(0))
	assert.Equal(t, "", clickHouseLogTTLExpression(-5))
	assert.Equal(t, "toDateTime(created_at) + INTERVAL 30 DAY DELETE", clickHouseLogTTLExpression(30))
}

func TestClickHouseLogTTLClause(t *testing.T) {
	assert.Equal(t, "", clickHouseLogTTLClause(0))
	assert.Equal(t, "\nTTL toDateTime(created_at) + INTERVAL 7 DAY DELETE", clickHouseLogTTLClause(7))
}

func TestClickHouseLogCreateTableSQL(t *testing.T) {
	withoutTTL := clickHouseLogCreateTableSQL(0)
	assert.Contains(t, withoutTTL, "CREATE TABLE IF NOT EXISTS logs")
	assert.Contains(t, withoutTTL, "ENGINE = MergeTree()")
	assert.Contains(t, withoutTTL, "PARTITION BY toYYYYMM(toDateTime(created_at))")
	assert.Contains(t, withoutTTL, "ORDER BY (created_at, request_id)")
	assert.NotContains(t, withoutTTL, "TTL ")

	withTTL := clickHouseLogCreateTableSQL(30)
	assert.Contains(t, withTTL, "ORDER BY (created_at, request_id)")
	assert.Contains(t, withTTL, "TTL toDateTime(created_at) + INTERVAL 30 DAY DELETE")
}

func TestClickHouseCreateTableHasTTL(t *testing.T) {
	assert.True(t, clickHouseCreateTableHasTTL("CREATE TABLE logs (...)\nTTL toDateTime(created_at) + INTERVAL 30 DAY DELETE"))
	assert.True(t, clickHouseCreateTableHasTTL("CREATE TABLE logs (...) TTL toDateTime(created_at)"))
	assert.False(t, clickHouseCreateTableHasTTL("CREATE TABLE logs (...)\nORDER BY (created_at, request_id)"))
}

func TestClickHouseLogOrder(t *testing.T) {
	assert.Equal(t, "created_at desc, request_id desc", clickHouseLogOrder(""))
	assert.Equal(t, "logs.created_at desc, logs.request_id desc", clickHouseLogOrder("logs."))
}

func TestBuildLogLikeConditionUsesStandardEscape(t *testing.T) {
	originalLogDatabaseType := common.LogDatabaseType()
	t.Cleanup(func() {
		common.SetLogDatabaseType(originalLogDatabaseType)
	})
	common.SetLogDatabaseType(common.DatabaseTypeSQLite)

	condition, pattern, err := buildLogLikeCondition("logs.model_name", "gpt_4%")

	require.NoError(t, err)
	assert.Equal(t, "logs.model_name LIKE ? ESCAPE '!'", condition)
	assert.Equal(t, "gpt!_4%", pattern)
}

func TestBuildLogLikeConditionUsesClickHouseEscaping(t *testing.T) {
	originalLogDatabaseType := common.LogDatabaseType()
	t.Cleanup(func() {
		common.SetLogDatabaseType(originalLogDatabaseType)
	})
	common.SetLogDatabaseType(common.DatabaseTypeClickHouse)

	condition, pattern, err := buildLogLikeCondition("logs.model_name", `gpt_4\mini%`)

	require.NoError(t, err)
	assert.Equal(t, "logs.model_name LIKE ?", condition)
	assert.Equal(t, `gpt\_4\\mini%`, pattern)
}

func TestEnsureLogRequestId(t *testing.T) {
	empty := &Log{}
	ensureLogRequestId(empty)
	assert.NotEmpty(t, empty.RequestId, "empty request id should be backfilled")

	existing := &Log{RequestId: "fixed-request-id"}
	ensureLogRequestId(existing)
	assert.Equal(t, "fixed-request-id", existing.RequestId, "existing request id must be preserved")

	assert.NotPanics(t, func() { ensureLogRequestId(nil) })
}

func TestAssignDisplayLogIds(t *testing.T) {
	logs := []*Log{{}, {}, {}}

	assignDisplayLogIds(logs, 0)
	assert.Equal(t, []int{1, 2, 3}, []int{logs[0].Id, logs[1].Id, logs[2].Id})

	assignDisplayLogIds(logs, 20)
	assert.Equal(t, []int{21, 22, 23}, []int{logs[0].Id, logs[1].Id, logs[2].Id})

	assert.NotPanics(t, func() { assignDisplayLogIds(nil, 0) })
}

// Separate ClickHouse writes can be visible after a failed acknowledgment and
// then be inserted again by recovery. Public accounting must project one row
// per financial event, without collapsing unrelated legacy request logs.
func TestClickHousePointLogProjection(t *testing.T) {
	dsn := os.Getenv("TEST_CLICKHOUSE_DSN")
	if dsn == "" {
		t.Skip("isolated ClickHouse test database DSN is not configured")
	}
	t.Setenv("POINT_LOG_TEST_DSN", dsn)
	db, kind, err := chooseDB("POINT_LOG_TEST_DSN", true)
	require.NoError(t, err)
	require.Equal(t, common.DatabaseTypeClickHouse, kind)
	require.False(t, db.Migrator().HasTable(&Log{}), "requires an isolated empty log database")
	connection, err := db.DB()
	require.NoError(t, err)
	previousDB, previousKind := LOG_DB, common.LogDatabaseType()
	LOG_DB = db
	common.SetLogDatabaseType(kind)
	t.Cleanup(func() {
		LOG_DB = previousDB
		common.SetLogDatabaseType(previousKind)
		require.NoError(t, connection.Close())
	})
	require.NoError(t, migrateClickHouseLogDB())
	t.Cleanup(func() { require.NoError(t, db.Exec("DROP TABLE logs").Error) })
	var version string
	require.NoError(t, db.Raw("SELECT version()").Scan(&version).Error)
	t.Logf("database: ClickHouse %s", version)
	now := time.Now().Unix()
	debit := PointBillingMetadata{Version: 1, CallID: "call", EventID: "call:debit", Status: "committed", TotalPoints: "4", Items: []PointBillingItem{}}
	refund := debit
	refund.EventID, refund.TotalPoints = "call:refund", "-1"
	pending := debit
	pending.EventID, pending.Status = "call:pending", "pending"
	rows := []Log{
		{UserId: 73, TokenId: 42, CreatedAt: now, Type: LogTypeConsume, RequestId: "debit", Quota: 100, PromptTokens: 5, CompletionTokens: 7, Other: common.MapToJsonStr(map[string]any{"points_billing": debit})},
		{UserId: 73, TokenId: 42, CreatedAt: now, Type: LogTypeRefund, RequestId: "refund", Quota: 40, Other: common.MapToJsonStr(map[string]any{"points_billing": refund})},
		{UserId: 73, TokenId: 42, CreatedAt: now, Type: LogTypeConsume, RequestId: "legacy-shared", Quota: 10, Other: "{}"},
		{UserId: 73, TokenId: 42, CreatedAt: now, Type: LogTypeManage, RequestId: "malformed", Other: "invalid-json"},
		{UserId: 73, TokenId: 42, CreatedAt: now, Type: LogTypeError, RequestId: "pending", Other: common.MapToJsonStr(map[string]any{"points_billing": pending})},
	}
	for _, index := range []int{0, 0, 1, 1, 2, 2, 3, 4} {
		row := rows[index]
		require.NoError(t, db.Create(&row).Error)
	}
	var physical int64
	require.NoError(t, db.Model(&Log{}).Count(&physical).Error)
	require.EqualValues(t, 8, physical)
	filter := LogFilter{}
	logs, total, err := GetAllLogs(filter, 0, 100)
	require.NoError(t, err)
	require.EqualValues(t, 6, total)
	require.Len(t, logs, 6)
	var points int64
	for _, log := range logs {
		meta := pointMetadataFromLog(log)
		if meta != nil && meta.Status == "committed" {
			n, err := strconv.ParseInt(meta.TotalPoints, 10, 64)
			require.NoError(t, err)
			points += n
		}
	}
	assert.EqualValues(t, 3, points)
	logs, total, err = GetAllLogs(LogFilter{Type: LogTypeRefund}, 0, 100)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, logs, 1)
	logs, total, err = GetUserLogs(73, filter, 2, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 6, total)
	assert.Len(t, logs, 2, "pagination applies after financial deduplication")
	logs, err = GetLogByTokenId(42)
	require.NoError(t, err)
	assert.Len(t, logs, 6)
	count := 0
	require.NoError(t, StreamAllLogs(context.Background(), filter, common.RoleAdminUser, func(*Log) error { count++; return nil }))
	assert.Equal(t, 6, count)
	count = 0
	require.NoError(t, StreamUserLogs(context.Background(), 73, filter, func(*Log) error { count++; return nil }))
	assert.Equal(t, 6, count)
	stat, err := SumUsedQuota(LogTypeConsume, 0, 0, "", "", "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, 120, stat.Quota)
	assert.Equal(t, 3, stat.Rpm)
	assert.Equal(t, 12, stat.Tpm)
	assert.Equal(t, 12, SumUsedToken(LogTypeConsume, 0, 0, "", "", ""))
}
