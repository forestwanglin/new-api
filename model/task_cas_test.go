package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	commonRelay "github.com/QuantumNous/new-api/relay/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	DB = db
	LOG_DB = db

	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true
	initCol()

	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	if err := db.AutoMigrate(
		&Task{},
		&User{},
		&UserSession{},
		&AuthFlow{},
		&ExternalIdentityClaim{},
		&Token{},
		&PasskeyCredential{},
		&TwoFA{},
		&TwoFABackupCode{},
		&Log{},
		&Channel{},
		&QuotaData{},
		&Ability{},
		&TopUp{},
		&SubscriptionPlan{},
		&SubscriptionOrder{},
		&UserSubscription{},
		&UserOAuthBinding{},
		&PerfMetric{},
		&SystemInstance{},
		&SystemTask{},
		&SystemTaskLock{},
		&UserAccessToken{},
	); err != nil {
		panic("failed to migrate: " + err.Error())
	}

	os.Exit(m.Run())
}

func truncateTables(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		DB.Exec("DELETE FROM tasks")
		DB.Exec("DELETE FROM auth_flows")
		DB.Exec("DELETE FROM external_identity_claims")
		DB.Exec("DELETE FROM user_sessions")
		DB.Exec("DELETE FROM passkey_credentials")
		DB.Exec("DELETE FROM two_fa_backup_codes")
		DB.Exec("DELETE FROM two_fas")
		DB.Exec("DELETE FROM tokens")
		DB.Exec("DELETE FROM user_access_tokens")
		DB.Exec("DELETE FROM user_oauth_bindings")
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM quota_data")
		DB.Exec("DELETE FROM abilities")
		DB.Exec("DELETE FROM top_ups")
		DB.Exec("DELETE FROM subscription_orders")
		DB.Exec("DELETE FROM subscription_plans")
		DB.Exec("DELETE FROM user_subscriptions")
		DB.Exec("DELETE FROM perf_metrics")
		DB.Exec("DELETE FROM system_instances")
		DB.Exec("DELETE FROM system_task_locks")
		DB.Exec("DELETE FROM system_tasks")
	})
}

func insertTask(t *testing.T, task *Task) {
	t.Helper()
	task.CreatedAt = time.Now().Unix()
	task.UpdatedAt = time.Now().Unix()
	require.NoError(t, DB.Create(task).Error)
}

func TestGetTaskForProtocolObservationScopesOwnerAndPlatform(t *testing.T) {
	truncateTables(t)
	task := &Task{
		TaskID:   "task_protocol_scope",
		UserId:   7,
		Platform: "plugin-a",
		Status:   TaskStatusInProgress,
	}
	insertTask(t, task)

	got, exists, err := GetTaskForProtocolObservation(context.Background(), 7, "plugin-a", task.TaskID)
	require.NoError(t, err)
	require.True(t, exists)
	assert.Equal(t, task.ID, got.ID)

	for _, query := range []struct {
		userID   int
		platform string
	}{
		{userID: 8, platform: "plugin-a"},
		{userID: 7, platform: "plugin-b"},
	} {
		got, exists, err = GetTaskForProtocolObservation(context.Background(), query.userID, constant.TaskPlatform(query.platform), task.TaskID)
		require.NoError(t, err)
		assert.False(t, exists)
		assert.Nil(t, got)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err = GetTaskForProtocolObservation(cancelled, 7, "plugin-a", task.TaskID)
	require.ErrorIs(t, err, context.Canceled)
}

// ---------------------------------------------------------------------------
// Snapshot / Equal — pure logic tests (no DB)
// ---------------------------------------------------------------------------

func TestSnapshotEqual_Same(t *testing.T) {
	s := taskSnapshot{
		Status:     TaskStatusInProgress,
		Progress:   "50%",
		StartTime:  1000,
		FinishTime: 0,
		FailReason: "",
		ResultURL:  "",
		Data:       json.RawMessage(`{"key":"value"}`),
	}
	assert.True(t, s.Equal(s))
}

func TestSnapshotEqual_DifferentStatus(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{}`)}
	b := taskSnapshot{Status: TaskStatusSuccess, Data: json.RawMessage(`{}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_DifferentProgress(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Progress: "30%", Data: json.RawMessage(`{}`)}
	b := taskSnapshot{Status: TaskStatusInProgress, Progress: "60%", Data: json.RawMessage(`{}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_DifferentData(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{"a":1}`)}
	b := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage(`{"a":2}`)}
	assert.False(t, a.Equal(b))
}

func TestSnapshotEqual_NilVsEmpty(t *testing.T) {
	a := taskSnapshot{Status: TaskStatusInProgress, Data: nil}
	b := taskSnapshot{Status: TaskStatusInProgress, Data: json.RawMessage{}}
	// bytes.Equal(nil, []byte{}) == true
	assert.True(t, a.Equal(b))
}

func TestSnapshotEqual_PluginStateAndPollFailures(t *testing.T) {
	base := taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 2,
	}
	assert.True(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 2,
	}))
	assert.False(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"b"}`),
		PollFailures: 2,
	}))
	assert.False(t, base.Equal(taskSnapshot{
		Status:       TaskStatusInProgress,
		PluginState:  json.RawMessage(`{"req_key":"a"}`),
		PollFailures: 3,
	}))
}

func TestSnapshot_Roundtrip(t *testing.T) {
	task := &Task{
		Status:     TaskStatusInProgress,
		Progress:   "42%",
		StartTime:  1234,
		FinishTime: 5678,
		FailReason: "timeout",
		PrivateData: TaskPrivateData{
			ResultURL:    "https://example.com/result.mp4",
			PluginState:  json.RawMessage(`{"req_key":"keep"}`),
			PollFailures: 3,
		},
		Data: json.RawMessage(`{"model":"test-model"}`),
	}
	snap := task.Snapshot()
	assert.Equal(t, task.Status, snap.Status)
	assert.Equal(t, task.Progress, snap.Progress)
	assert.Equal(t, task.StartTime, snap.StartTime)
	assert.Equal(t, task.FinishTime, snap.FinishTime)
	assert.Equal(t, task.FailReason, snap.FailReason)
	assert.Equal(t, task.PrivateData.ResultURL, snap.ResultURL)
	assert.JSONEq(t, string(task.Data), string(snap.Data))
	assert.Equal(t, task.PrivateData.PluginState, snap.PluginState)
	assert.Equal(t, task.PrivateData.PollFailures, snap.PollFailures)
}

// ---------------------------------------------------------------------------
// UpdateWithStatus CAS — DB integration tests
// ---------------------------------------------------------------------------

func TestUpdateWithStatus_Win(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID:   "task_cas_win",
		Status:   TaskStatusInProgress,
		Progress: "50%",
		Data:     json.RawMessage(`{}`),
	}
	insertTask(t, task)

	task.Status = TaskStatusSuccess
	task.Progress = "100%"
	won, err := task.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	assert.True(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusSuccess, reloaded.Status)
	assert.Equal(t, "100%", reloaded.Progress)
}

func TestUpdateWithStatus_Lose(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_lose",
		Status: TaskStatusFailure,
		Data:   json.RawMessage(`{}`),
	}
	insertTask(t, task)

	task.Status = TaskStatusSuccess
	won, err := task.UpdateWithStatus(TaskStatusInProgress) // wrong fromStatus
	require.NoError(t, err)
	assert.False(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusFailure, reloaded.Status) // unchanged
}

func TestUpdateWithStatus_ConcurrentWinner(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_race",
		Status: TaskStatusInProgress,
		Quota:  1000,
		Data:   json.RawMessage(`{}`),
	}
	insertTask(t, task)

	const goroutines = 5
	wins := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := range goroutines {
		go func(idx int) {
			defer wg.Done()
			t := &Task{}
			*t = Task{
				ID:       task.ID,
				TaskID:   task.TaskID,
				Status:   TaskStatusSuccess,
				Progress: "100%",
				Quota:    task.Quota,
				Data:     json.RawMessage(`{}`),
			}
			t.CreatedAt = task.CreatedAt
			t.UpdatedAt = time.Now().Unix()
			won, err := t.UpdateWithStatus(TaskStatusInProgress)
			if err == nil {
				wins[idx] = won
			}
		}(i)
	}
	wg.Wait()

	winCount := 0
	for _, w := range wins {
		if w {
			winCount++
		}
	}
	assert.Equal(t, 1, winCount, "exactly one goroutine should win the CAS")
}

func TestUpdateWithStatus_PersistsPluginStateAndPollFailures(t *testing.T) {
	truncateTables(t)

	task := &Task{
		TaskID: "task_cas_plugin_state",
		Status: TaskStatusInProgress,
		Data:   json.RawMessage(`{}`),
		PrivateData: TaskPrivateData{
			PluginState:  json.RawMessage(`{"req_key":"old"}`),
			PollFailures: 1,
		},
	}
	insertTask(t, task)

	task.PrivateData.PluginState = json.RawMessage(`{"req_key":"new"}`)
	task.PrivateData.PollFailures = 4
	won, err := task.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	require.True(t, won)

	var reloaded Task
	require.NoError(t, DB.First(&reloaded, task.ID).Error)
	assert.EqualValues(t, TaskStatusInProgress, reloaded.Status)
	assert.JSONEq(t, `{"req_key":"new"}`, string(reloaded.PrivateData.PluginState))
	assert.Equal(t, 4, reloaded.PrivateData.PollFailures)
}

func TestPointsTaskOutcomeFencesStalePollsAndRefundReopening(t *testing.T) {
	truncateTables(t)
	task := &Task{TaskID: "points_fenced", Status: TaskStatusInProgress, Quota: 20,
		PrivateData: TaskPrivateData{PointsBillingID: "call-fenced"}}
	require.NoError(t, DB.Create(task).Error)
	first := *task
	now := time.Now().UnixMilli()
	won, err := TryClaimPointsTaskPoll(&first, now, now+60000)
	require.NoError(t, err)
	require.True(t, won)
	concurrent := *task
	won, err = TryClaimPointsTaskPoll(&concurrent, now, now+60000)
	require.NoError(t, err)
	assert.False(t, won, "only one poll may publish an outcome")

	stale := first
	first.Status = TaskStatusFailure
	first.PrivateData.PointsOutcome = &commonRelay.TaskInfo{Status: string(TaskStatusFailure), Reason: "failed"}
	won, err = first.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	require.True(t, won)
	require.Greater(t, first.OutcomeVersion, stale.OutcomeVersion)

	stale.Status = TaskStatusSuccess
	stale.Quota = 10
	won, err = stale.UpdateWithStatus(TaskStatusInProgress)
	require.NoError(t, err)
	assert.False(t, won, "old success must not reopen a failed/refunded task")
	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.EqualValues(t, TaskStatusFailure, stored.Status)
	assert.Equal(t, 20, stored.Quota, "outcome publication cannot overwrite financial quota")

	stored.Status = TaskStatusSuccess
	won, err = stored.UpdateWithStatus(TaskStatusFailure)
	require.NoError(t, err)
	assert.False(t, won, "ordinary polls cannot correct terminal outcomes")
}

func TestPointsTaskBillingGuardCommitsQuotaWithAcceptedVersion(t *testing.T) {
	truncateTables(t)
	task := &Task{TaskID: "points_guard", Status: TaskStatusSuccess, Quota: 20,
		PrivateData: TaskPrivateData{PointsBillingID: "call-guard"}}
	require.NoError(t, DB.Create(task).Error)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		locked, err := LockPointsTaskBilling(tx, task.ID, task.OutcomeVersion)
		require.NoError(t, err)
		return CommitPointsTaskBilling(tx, locked, 10)
	}))
	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.Equal(t, 10, stored.Quota)
	assert.Equal(t, stored.OutcomeVersion, stored.AppliedOutcomeVersion)

	require.ErrorIs(t, DB.Transaction(func(tx *gorm.DB) error {
		_, err := LockPointsTaskBilling(tx, task.ID, task.OutcomeVersion-1)
		return err
	}), ErrStaleTaskOutcome)
	errAbort := errors.New("financial write failed")
	require.ErrorIs(t, DB.Transaction(func(tx *gorm.DB) error {
		locked, err := LockPointsTaskBilling(tx, task.ID, task.OutcomeVersion)
		require.NoError(t, err)
		require.NoError(t, CommitPointsTaskBilling(tx, locked, 0))
		return errAbort
	}), errAbort)
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.Equal(t, 10, stored.Quota)
}

func TestPointsTaskOutcomeDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dsn string
			switch dialect {
			case "sqlite":
				dsn = "local"
				previousPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "outcome.db")
				t.Cleanup(func() { common.SQLitePath = previousPath })
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("isolated database DSN is not configured")
			}
			t.Setenv("TASK_OUTCOME_TEST_DSN", dsn)
			db, dbType, err := chooseDB("TASK_OUTCOME_TEST_DSN", false)
			require.NoError(t, err)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(dbType)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&Task{}, &Midjourney{}))
				require.NoError(t, sqlDB.Close())
				DB = previousDB
				common.SetMainDatabaseType(previousType)
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			require.False(t, db.Migrator().HasTable(&Task{}), "requires an isolated task database")
			// A representative old table tests additive migration of live rows,
			// without pretending this is a complete latest-release fixture.
			require.NoError(t, db.Table("tasks").AutoMigrate(&struct {
				ID     int64  `gorm:"primaryKey"`
				TaskID string `gorm:"type:varchar(191)"`
				Quota  int
			}{}))
			require.NoError(t, db.Table("tasks").Create(map[string]any{"id": 9, "task_id": "legacy", "quota": 30}).Error)
			require.NoError(t, db.AutoMigrate(&Task{}))
			require.NoError(t, db.AutoMigrate(&Task{}))
			var legacy Task
			require.NoError(t, db.First(&legacy, 9).Error)
			assert.Equal(t, 30, legacy.Quota)
			assert.Zero(t, legacy.OutcomeVersion)
			legacy.Status = TaskStatusInProgress
			require.NoError(t, db.Model(&legacy).Update("status", legacy.Status).Error)

			task := &Task{TaskID: "matrix_points", Status: TaskStatusInProgress, Quota: 20,
				Data:        json.RawMessage(`{"usage":{"total_tokens":20}}`),
				PrivateData: TaskPrivateData{PointsBillingID: "call-matrix"}}
			require.NoError(t, db.Create(task).Error)
			now := time.Now().UnixMilli()
			won, err := TryClaimPointsTaskPoll(task, now, now+60000)
			require.NoError(t, err)
			require.True(t, won)
			oldPoll := *task
			task.Status = TaskStatusSuccess
			task.PrivateData.PointsOutcome = &commonRelay.TaskInfo{Status: string(TaskStatusSuccess), TotalTokens: 20}
			won, err = task.UpdateWithStatus(TaskStatusInProgress)
			require.NoError(t, err)
			require.True(t, won)
			assert.True(t, HasUnfinishedSyncTasks(), "unapplied terminal outcomes must wake the system task")
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				locked, err := LockPointsTaskBilling(tx, task.ID, task.OutcomeVersion)
				if err != nil {
					return err
				}
				return CommitPointsTaskBilling(tx, locked, 20)
			}))
			oldPoll.Status = TaskStatusSuccess
			oldPoll.PrivateData.PointsOutcome = &commonRelay.TaskInfo{Status: string(TaskStatusSuccess), TotalTokens: 10}
			won, err = oldPoll.UpdateWithStatus(TaskStatusInProgress)
			require.NoError(t, err)
			assert.False(t, won, "stale usage10 cannot replace accepted usage20")

			// Explicit correction must own a fresh fence; replaying the same
			// response does not create another outcome or financial event.
			won, err = TryClaimPointsTaskCorrection(task, now, now+60000)
			require.NoError(t, err)
			require.True(t, won)
			task.PrivateData.PointsOutcome = &commonRelay.TaskInfo{Status: string(TaskStatusSuccess), TotalTokens: 21}
			won, err = task.AcceptPointsTaskCorrection()
			require.NoError(t, err)
			require.True(t, won)
			acceptedVersion := task.OutcomeVersion
			won, err = TryClaimPointsTaskCorrection(task, now, now+60000)
			require.NoError(t, err)
			require.True(t, won)
			won, err = task.AcceptPointsTaskCorrection()
			require.NoError(t, err)
			assert.False(t, won)
			assert.Equal(t, acceptedVersion, task.OutcomeVersion)
			require.NoError(t, ReleasePointsTaskPoll(task))

			// The public task representation must not leak private financial
			// identity, polling fences or accepted usage provenance.
			payload, err := common.Marshal(task)
			require.NoError(t, err)
			assert.NotContains(t, string(payload), "call-matrix")
			assert.NotContains(t, string(payload), "outcome_version")
			assert.NotContains(t, string(payload), "poll_fence")

			require.False(t, db.Migrator().HasTable(&Midjourney{}), "requires an isolated Midjourney database")
			require.NoError(t, db.Table("midjourneys").AutoMigrate(&struct {
				Id    int `gorm:"primaryKey"`
				Quota int
			}{}))
			require.NoError(t, db.Table("midjourneys").Create(map[string]any{"id": 9, "quota": 30}).Error)
			require.NoError(t, db.AutoMigrate(&Midjourney{}))
			require.NoError(t, db.AutoMigrate(&Midjourney{}))
			var legacyMJ Midjourney
			require.NoError(t, db.First(&legacyMJ, 9).Error)
			assert.Equal(t, 30, legacyMJ.Quota)
			assert.Zero(t, legacyMJ.OutcomeVersion)
			assert.Empty(t, legacyMJ.PointsBillingID)
			mj := &Midjourney{MjId: "matrix-mj", Status: "IN_PROGRESS", Quota: 20, PointsBillingID: "call-matrix-mj"}
			require.NoError(t, db.Create(mj).Error)
			won, err = TryClaimPointsMidjourneyPoll(mj, now, now+60000)
			require.NoError(t, err)
			require.True(t, won)
			staleMJ := *mj
			mj.Status, mj.Progress = "FAILURE", "100%"
			won, err = mj.UpdateWithStatus("IN_PROGRESS")
			require.NoError(t, err)
			require.True(t, won)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				locked, err := LockPointsMidjourneyBilling(tx, mj.Id, mj.OutcomeVersion)
				if err != nil {
					return err
				}
				return CommitPointsMidjourneyBilling(tx, locked, 0)
			}))
			staleMJ.Status = "SUCCESS"
			won, err = staleMJ.UpdateWithStatus("IN_PROGRESS")
			require.NoError(t, err)
			assert.False(t, won, "a delayed Midjourney success cannot restore refunded quota")
			var storedMJ Midjourney
			require.NoError(t, db.First(&storedMJ, mj.Id).Error)
			assert.Zero(t, storedMJ.Quota)
			assert.Equal(t, storedMJ.OutcomeVersion, storedMJ.AppliedOutcomeVersion)
		})
	}
}

func TestPointsMidjourneyOutcomeCannotRestoreRefundedQuota(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Midjourney{}))
	t.Cleanup(func() { require.NoError(t, DB.Exec("DELETE FROM midjourneys").Error) })
	task := &Midjourney{MjId: "mj-fenced", Status: "IN_PROGRESS", Quota: 20, PointsBillingID: "call-mj-fenced"}
	require.NoError(t, DB.Create(task).Error)
	now := time.Now().UnixMilli()
	won, err := TryClaimPointsMidjourneyPoll(task, now, now+60000)
	require.NoError(t, err)
	require.True(t, won)
	stale := *task
	task.Status = "FAILURE"
	task.Progress = "100%"
	won, err = task.UpdateWithStatus("IN_PROGRESS")
	require.NoError(t, err)
	require.True(t, won)
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		locked, err := LockPointsMidjourneyBilling(tx, task.Id, task.OutcomeVersion)
		if err != nil {
			return err
		}
		return CommitPointsMidjourneyBilling(tx, locked, 0)
	}))
	stale.Status = "SUCCESS"
	won, err = stale.UpdateWithStatus("IN_PROGRESS")
	require.NoError(t, err)
	assert.False(t, won)
	var current Midjourney
	require.NoError(t, DB.First(&current, task.Id).Error)
	assert.Equal(t, "FAILURE", current.Status)
	assert.Zero(t, current.Quota)
	assert.Equal(t, current.OutcomeVersion, current.AppliedOutcomeVersion)
	assert.False(t, HasUnfinishedMidjourneyTasks(), "refunded terminal tasks need no further polling")
}

func TestPointsTaskBackgroundFlagPreservesAcceptedOutcome(t *testing.T) {
	truncateTables(t)
	task := &Task{TaskID: "points_background", Status: TaskStatusSuccess, Quota: 20,
		PrivateData: TaskPrivateData{PointsBillingID: "call-background", PointsOutcome: &commonRelay.TaskInfo{Status: string(TaskStatusSuccess), TotalTokens: 20}}}
	require.NoError(t, DB.Create(task).Error)
	require.NoError(t, SetTaskResponsesBackground(context.Background(), task.ID))
	var stored Task
	require.NoError(t, DB.First(&stored, task.ID).Error)
	assert.True(t, stored.PrivateData.ResponsesBackground)
	require.NotNil(t, stored.PrivateData.PointsOutcome)
	assert.Equal(t, 20, stored.PrivateData.PointsOutcome.TotalTokens)
	assert.Equal(t, "call-background", stored.PrivateData.PointsBillingID)
	assert.Equal(t, task.OutcomeVersion, stored.OutcomeVersion)
}

func TestPointsTaskRecoveryLeaseDoesNotStarveLaterOutcomes(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&Midjourney{}))
	t.Cleanup(func() { require.NoError(t, DB.Exec("DELETE FROM midjourneys").Error) })
	ctx := context.Background()
	const now int64 = 1000
	first := &Task{TaskID: "retry-first", Status: TaskStatusFailure, PrivateData: TaskPrivateData{PointsBillingID: "retry-first"}}
	second := &Task{TaskID: "retry-second", Status: TaskStatusSuccess, PrivateData: TaskPrivateData{PointsBillingID: "retry-second"}}
	uncertain := &Task{TaskID: "retry-uncertain", Status: TaskStatusInProgress, PrivateData: TaskPrivateData{PointsBillingID: "retry-uncertain"}}
	for _, task := range []*Task{first, second, uncertain} {
		require.NoError(t, DB.Create(task).Error)
	}
	batch, err := claimPointsTaskSettlements(ctx, 1, now)
	require.NoError(t, err)
	require.Len(t, batch, 1)
	assert.Equal(t, first.ID, batch[0].ID)
	// Leave the first outcome unapplied, simulating a permanent financial
	// error. Another worker gets the later outcome during the same lease.
	batch, err = claimPointsTaskSettlements(ctx, 1, now)
	require.NoError(t, err)
	require.Len(t, batch, 1)
	assert.Equal(t, second.ID, batch[0].ID)
	batch, err = claimPointsTaskSettlements(ctx, 1, now)
	require.NoError(t, err)
	assert.Empty(t, batch, "leased and uncertain outcomes cannot be claimed")
	batch, err = claimPointsTaskSettlements(ctx, 1, now+60000)
	require.NoError(t, err)
	require.Len(t, batch, 1)
	assert.Equal(t, first.ID, batch[0].ID, "failed work retries after a lost worker's lease expires")

	firstMJ := &Midjourney{MjId: "retry-first", Status: "FAILURE", PointsBillingID: "retry-first"}
	secondMJ := &Midjourney{MjId: "retry-second", Status: "SUCCESS", PointsBillingID: "retry-second"}
	uncertainMJ := &Midjourney{Status: "IN_PROGRESS", PointsBillingID: "retry-uncertain"}
	for _, task := range []*Midjourney{firstMJ, secondMJ, uncertainMJ} {
		require.NoError(t, DB.Create(task).Error)
	}
	mjBatch, err := claimPointsMidjourneySettlements(ctx, 1, now)
	require.NoError(t, err)
	require.Len(t, mjBatch, 1)
	assert.Equal(t, firstMJ.Id, mjBatch[0].Id)
	mjBatch, err = claimPointsMidjourneySettlements(ctx, 1, now)
	require.NoError(t, err)
	require.Len(t, mjBatch, 1)
	assert.Equal(t, secondMJ.Id, mjBatch[0].Id)
	mjBatch, err = claimPointsMidjourneySettlements(ctx, 1, now)
	require.NoError(t, err)
	assert.Empty(t, mjBatch)
	mjBatch, err = claimPointsMidjourneySettlements(ctx, 1, now+60000)
	require.NoError(t, err)
	require.Len(t, mjBatch, 1)
	assert.Equal(t, firstMJ.Id, mjBatch[0].Id)
}

func TestPointsTaskListsMarkUnappliedTerminalOutcomesPending(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&PointCallBilling{}))
	call := PointCallBilling{ID: "list-pending-call", UserID: 1, Model: "list-model", Rate: "1", Unit: "1000", State: "charged", Points: 20,
		Allocations: `[{"type_id":1,"code":"GENERAL","name":"General","charged":20}]`}
	require.NoError(t, DB.Create(&call).Error)
	t.Cleanup(func() { require.NoError(t, DB.Delete(&PointCallBilling{}, "id = ?", call.ID).Error) })
	for _, status := range []TaskStatus{TaskStatusSuccess, TaskStatusFailure} {
		pending := &Task{Status: status, OutcomeVersion: 2, AppliedOutcomeVersion: 1, PrivateData: TaskPrivateData{PointsBillingID: call.ID}}
		applied := &Task{Status: status, OutcomeVersion: 2, AppliedOutcomeVersion: 2, PrivateData: TaskPrivateData{PointsBillingID: call.ID}}
		require.NoError(t, enrichPointsTasks([]*Task{pending, applied}))
		require.NotNil(t, pending.PointsBilling)
		assert.Equal(t, "pending", pending.PointsBilling.Status)
		assert.Equal(t, "20", pending.PointsBilling.TotalPoints, "keep the actual committed amount")
		require.Len(t, pending.PointsBilling.Items, 1)
		assert.Equal(t, "20", pending.PointsBilling.Items[0].Points)
		assert.Equal(t, "committed", applied.PointsBilling.Status, "one pending row must not mutate a shared summary")
	}
	for _, status := range []string{"SUCCESS", "FAILURE"} {
		pending := &Midjourney{Status: status, OutcomeVersion: 2, AppliedOutcomeVersion: 1, PointsBillingID: call.ID}
		applied := &Midjourney{Status: status, OutcomeVersion: 2, AppliedOutcomeVersion: 2, PointsBillingID: call.ID}
		require.NoError(t, EnrichPointsMidjourney([]*Midjourney{pending, applied}))
		require.NotNil(t, pending.PointsBilling)
		assert.Equal(t, "pending", pending.PointsBilling.Status)
		assert.Equal(t, "20", pending.PointsBilling.TotalPoints)
		require.Len(t, pending.PointsBilling.Items, 1)
		assert.Equal(t, "20", pending.PointsBilling.Items[0].Points)
		assert.Equal(t, "committed", applied.PointsBilling.Status)
	}
}
