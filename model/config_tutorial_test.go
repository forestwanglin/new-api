package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestConfigTutorialDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				before := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "tutorial.db")
				t.Cleanup(func() { common.SQLitePath = before })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN is not configured")
			}
			t.Setenv("TUTORIAL_TEST_DSN", dsn)
			db, dbtype, err := chooseDB("TUTORIAL_TEST_DSN", false)
			require.NoError(t, err)
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(dbtype)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() {
				DB = oldDB
				common.SetMainDatabaseType(oldType)
				require.NoError(t, db.Migrator().DropTable(&ConfigTutorialChapter{}, &ConfigTutorialGroup{}, &Option{}))
				require.NoError(t, sqlDB.Close())
			})
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Log("engine", version)
			require.NoError(t, db.AutoMigrate(&Option{}))
			require.NoError(t, migrateConfigTutorials(db))
			require.NoError(t, InitializeConfigTutorials(db))
			recorder := &migrationSQLRecorder{}
			require.NoError(t, migrateConfigTutorials(db.Session(&gorm.Session{Logger: recorder})))
			assert.Empty(t, recorder.schemaMutations())
			for _, index := range []struct {
				value any
				name  string
			}{{&ConfigTutorialGroup{}, "idx_ctg_key"}, {&ConfigTutorialChapter{}, "idx_ctc_anchor"}, {&ConfigTutorialChapter{}, "idx_ctc_group"}} {
				assert.True(t, db.Migrator().HasIndex(index.value, index.name), index.name)
			}
			groups, err := ReadConfigTutorial()
			require.NoError(t, err)
			require.Len(t, groups, 3)
			var original ConfigTutorialChapter
			require.NoError(t, db.Where("anchor = ?", "doc-curl").First(&original).Error)
			original.Title = "administrator content"
			original.ContentMarkdown = "changed body"
			saved, err := SaveConfigTutorialChapter(original.Id, original.Version, original)
			require.NoError(t, err)
			require.EqualValues(t, 2, saved.Version)
			require.NoError(t, InitializeConfigTutorials(db))
			retained, err := GetConfigTutorialChapter(saved.Id)
			require.NoError(t, err)
			assert.Equal(t, "changed body", string(retained.ContentMarkdown))
			require.NoError(t, DeleteConfigTutorialChapter(saved.Id))
			for range 2 {
				require.NoError(t, migrateConfigTutorials(db))
				require.NoError(t, InitializeConfigTutorials(db))
			}
			var count int64
			require.NoError(t, db.Model(&ConfigTutorialChapter{}).Where("anchor = ?", "doc-curl").Count(&count).Error)
			assert.Zero(t, count)
			managed, err := SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "managed", Title: "100%_literal", SortOrder: 0, Enabled: true})
			require.NoError(t, err)
			_, err = SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "managed", Title: "duplicate", Enabled: true})
			require.ErrorIs(t, err, ErrConfigTutorialDuplicate)
			item, err := SaveConfigTutorialChapter(0, 0, ConfigTutorialChapter{GroupId: managed.Id, Anchor: "managed-chapter", Title: "Managed", ContentMarkdown: "## safe markdown", Enabled: true})
			require.NoError(t, err)
			boundary, err := SaveConfigTutorialChapter(0, 0, ConfigTutorialChapter{GroupId: managed.Id, Anchor: "boundary", Title: "Boundary", ContentMarkdown: LongText(strings.Repeat("x", 65536)), Enabled: true})
			require.NoError(t, err)
			readBoundary, err := GetConfigTutorialChapter(boundary.Id)
			require.NoError(t, err)
			assert.Len(t, readBoundary.ContentMarkdown, 65536)
			require.NoError(t, DeleteConfigTutorialChapter(boundary.Id))
			require.ErrorIs(t, DeleteConfigTutorialGroup(managed.Id), ErrConfigTutorialGroupNotEmpty)
			item.Enabled = false
			item.SortOrder = 0
			updated, err := SaveConfigTutorialChapter(item.Id, 1, *item)
			require.NoError(t, err)
			assert.False(t, updated.Enabled)
			_, err = SaveConfigTutorialChapter(item.Id, 1, *item)
			require.ErrorIs(t, err, ErrConfigTutorialConflict)
			item.GroupId = 999999
			_, err = SaveConfigTutorialChapter(item.Id, 2, *item)
			require.ErrorIs(t, err, ErrConfigTutorialGroupNotFound)
			filtered, total, err := ListConfigTutorialGroups(ConfigTutorialFilter{Page: 1, PageSize: 20, Keyword: "%_"})
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			require.Len(t, filtered, 1)
			public, err := ReadConfigTutorial()
			require.NoError(t, err)
			for _, g := range public {
				assert.NotEqual(t, "managed", g.Group.GroupKey)
			}
			destination, err := SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "destination", Title: "Destination", SortOrder: 0, Enabled: true})
			require.NoError(t, err)
			item.GroupId = destination.Id
			item.Enabled = true
			moved, err := SaveConfigTutorialChapter(item.Id, 2, *item)
			require.NoError(t, err)
			assert.Equal(t, destination.Id, moved.GroupId)
			destination.Enabled = false
			destination.SortOrder = 0
			inactive, err := SaveConfigTutorialGroup(destination.Id, 1, *destination)
			require.NoError(t, err)
			assert.False(t, inactive.Enabled)
			assert.Zero(t, inactive.SortOrder)
			_, err = SaveConfigTutorialGroup(destination.Id, 1, *destination)
			require.ErrorIs(t, err, ErrConfigTutorialConflict)
			require.NoError(t, DeleteConfigTutorialChapter(item.Id))
			require.NoError(t, DeleteConfigTutorialGroup(managed.Id))
			// The shared marker lock arbitrates real concurrent creates/deletes on every dialect.
			concurrent, err := SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "concurrent", Title: "Concurrent", Enabled: true})
			require.NoError(t, err)
			start := make(chan struct{})
			var wg sync.WaitGroup
			errs := make(chan error, 2)
			wg.Go(func() {
				<-start
				_, e := SaveConfigTutorialChapter(0, 0, ConfigTutorialChapter{GroupId: concurrent.Id, Anchor: "concurrent-item", Title: "Concurrent item", ContentMarkdown: "body", Enabled: true})
				errs <- e
			})
			wg.Go(func() { <-start; errs <- DeleteConfigTutorialGroup(concurrent.Id) })
			close(start)
			wg.Wait()
			close(errs)
			for e := range errs {
				if e != nil {
					assert.True(t, e == ErrConfigTutorialGroupNotEmpty || e == ErrConfigTutorialGroupNotFound, e)
				}
			}
			var orphanCount int64
			require.NoError(t, db.Table("config_tutorial_chapters c").Joins("LEFT JOIN config_tutorial_groups g ON g.id=c.group_id").Where("g.id IS NULL").Count(&orphanCount).Error)
			assert.Zero(t, orphanCount)
			// Moving an existing chapter races with deleting its destination too.
			moveSource, err := SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "move-source", Title: "Source", Enabled: true})
			require.NoError(t, err)
			moveTarget, err := SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "move-target", Title: "Target", Enabled: true})
			require.NoError(t, err)
			moveItem, err := SaveConfigTutorialChapter(0, 0, ConfigTutorialChapter{GroupId: moveSource.Id, Anchor: "move-item", Title: "Move item", ContentMarkdown: "body", Enabled: true})
			require.NoError(t, err)
			moveItem.GroupId = moveTarget.Id
			start = make(chan struct{})
			errs = make(chan error, 2)
			wg.Go(func() {
				<-start
				_, e := SaveConfigTutorialChapter(moveItem.Id, moveItem.Version, *moveItem)
				errs <- e
			})
			wg.Go(func() { <-start; errs <- DeleteConfigTutorialGroup(moveTarget.Id) })
			close(start)
			wg.Wait()
			close(errs)
			for e := range errs {
				if e != nil {
					assert.True(t, e == ErrConfigTutorialGroupNotEmpty || e == ErrConfigTutorialGroupNotFound, e)
				}
			}
			require.NoError(t, db.Table("config_tutorial_chapters c").Joins("LEFT JOIN config_tutorial_groups g ON g.id=c.group_id").Where("g.id IS NULL").Count(&orphanCount).Error)
			assert.Zero(t, orphanCount)
			retainedMove, err := GetConfigTutorialChapter(moveItem.Id)
			require.NoError(t, err)
			assert.Contains(t, []int64{moveSource.Id, moveTarget.Id}, retainedMove.GroupId)
			// Deleting all content is permanent across repeated startup.
			require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ConfigTutorialChapter{}).Error)
			require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ConfigTutorialGroup{}).Error)
			require.NoError(t, InitializeConfigTutorials(db))
			empty, err := ReadConfigTutorial()
			require.NoError(t, err)
			assert.Empty(t, empty)
			require.ErrorIs(t, UpdateOption(configTutorialSeedKey, "tampered"), ErrConfigTutorialFields)
			require.ErrorIs(t, UpdateOptionsBulk(map[string]string{configTutorialSeedKey: "tampered"}), ErrConfigTutorialFields)
			options, err := AllOption()
			require.NoError(t, err)
			for _, o := range options {
				assert.NotEqual(t, configTutorialSeedKey, o.Key)
			}
			// Invalid content cannot reach persistence through direct model calls either.
			_, err = SaveConfigTutorialGroup(0, 0, ConfigTutorialGroup{GroupKey: "Invalid", Title: "Bad"})
			require.ErrorIs(t, err, ErrConfigTutorialFields)
			_, err = SaveConfigTutorialChapter(0, 0, ConfigTutorialChapter{GroupId: 1, Anchor: "too-big", Title: "Large", ContentMarkdown: LongText(strings.Repeat("x", 65537))})
			require.ErrorIs(t, err, ErrConfigTutorialFields)
			// Existing installations preserve unrelated rows and seed only once.
			require.NoError(t, db.Create(&Option{Key: "tutorial-test-preserved", Value: "existing"}).Error)
			require.NoError(t, migrateConfigTutorials(db))
			var preserved Option
			require.NoError(t, db.Where(map[string]any{"key": "tutorial-test-preserved"}).First(&preserved).Error)
			assert.Equal(t, "existing", preserved.Value)
			// A failed initial import must roll back both marker and partial data.
			require.NoError(t, db.Where(map[string]any{"key": configTutorialSeedKey}).Delete(&Option{}).Error)
			originalSeed := configTutorialSeed
			configTutorialSeed = []byte(`[{"group_key":"partial","title":"Partial","chapters":[{"anchor":"invalid","title":"Invalid","content_markdown":""}]}]`)
			seedErr := InitializeConfigTutorials(db)
			configTutorialSeed = originalSeed
			require.ErrorIs(t, seedErr, ErrConfigTutorialFields)
			require.NoError(t, db.Model(&ConfigTutorialGroup{}).Count(&count).Error)
			assert.Zero(t, count)
			require.NoError(t, db.Model(&Option{}).Where(map[string]any{"key": configTutorialSeedKey}).Count(&count).Error)
			assert.Zero(t, count)
			// Two first-start attempts share a unique claim and cannot duplicate seeds.
			start = make(chan struct{})
			errs = make(chan error, 2)
			for range 2 {
				wg.Go(func() { <-start; errs <- InitializeConfigTutorials(db) })
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				require.NoError(t, err)
			}
			require.NoError(t, db.Model(&ConfigTutorialGroup{}).Count(&count).Error)
			assert.EqualValues(t, 3, count)
			require.NoError(t, db.Model(&ConfigTutorialChapter{}).Count(&count).Error)
			assert.EqualValues(t, 13, count)
			// Existing administrator content without a marker is not overwritten.
			require.NoError(t, db.Where(map[string]any{"key": configTutorialSeedKey}).Delete(&Option{}).Error)
			require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ConfigTutorialChapter{}).Error)
			require.NoError(t, db.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ConfigTutorialGroup{}).Error)
			require.NoError(t, db.Create(&ConfigTutorialGroup{GroupKey: "existing", Title: "Existing", Version: 1}).Error)
			require.NoError(t, InitializeConfigTutorials(db))
			require.NoError(t, db.Model(&ConfigTutorialGroup{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			require.NoError(t, db.Model(&ConfigTutorialChapter{}).Count(&count).Error)
			assert.Zero(t, count)
			t.Log(fmt.Sprintf("verified %s migration/seed/CRUD/concurrency", dialect))
		})
	}
}
