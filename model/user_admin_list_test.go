package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestAdminUserPhoneDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect == "sqlite" {
				dsn = "local"
				oldPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "admin-phone.db")
				t.Cleanup(func() { common.SQLitePath = oldPath })
			}
			if dsn == "" {
				t.Skip("isolated test database DSN not configured")
			}
			t.Setenv("ADMIN_PHONE_TEST_DSN", dsn)
			db, databaseType, err := chooseDB("ADMIN_PHONE_TEST_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			oldDB, oldType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(databaseType)
			initCol()
			t.Cleanup(func() { DB = oldDB; common.SetMainDatabaseType(oldType); initCol() })
			tables := []any{&User{}, &ExternalIdentityClaim{}, &PointType{}, &PointAccount{}}
			for _, table := range tables {
				require.False(t, db.Migrator().HasTable(table), "requires empty isolated database")
			}
			require.NoError(t, db.AutoMigrate(tables...))
			t.Cleanup(func() {
				require.NoError(t, db.Migrator().DropTable(&PointAccount{}, &PointType{}, &ExternalIdentityClaim{}, &User{}))
			})
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)
			users := []User{
				{Id: 1, Username: "bound", Password: "secret", AffCode: "phone1", DisplayName: "Bound Name", Email: "bound@example.com", Group: "premium", Role: 1, Status: 1},
				{Id: 2, Username: "unbound", Password: "secret", AffCode: "phone2", DisplayName: "Unbound Name", Email: "unbound@example.com", Group: "default", Role: 10, Status: 2},
				{Id: 3, Username: "another", Password: "secret", AffCode: "phone3", Group: "premium", Role: 1, Status: 1},
			}
			require.NoError(t, db.Create(&users).Error)
			claims := []ExternalIdentityClaim{
				{Provider: ExternalIdentityProviderPhone, Subject: "13800138000", UserId: 1},
				{Provider: "telegram", Subject: "13900139000", UserId: 2},
				{Provider: ExternalIdentityProviderPhone, Subject: "13800138001", UserId: 3},
			}
			require.NoError(t, db.Create(&claims).Error)
			pt := PointType{Code: PointTypeGPT, Name: "GPT"}
			require.NoError(t, db.Create(&pt).Error)
			require.NoError(t, db.Create(&PointAccount{UserId: 1, PointTypeId: pt.Id, AvailablePoints: 9007199254740993}).Error)
			for _, tc := range []struct {
				keyword string
				ids     []int
			}{
				{"13800138000", []int{1}}, {"13800138", []int{}}, {"13900139000", []int{}}, {"Name", []int{1, 2}}, {"bound@example.com", []int{1, 2}}, {"another", []int{3}}, {"2", []int{2}},
			} {
				t.Run(tc.keyword, func(t *testing.T) {
					found, total, err := SearchUsers(tc.keyword, "", nil, nil, 0, 20, NewUserSortOptions("id", "asc"))
					require.NoError(t, err)
					require.EqualValues(t, len(tc.ids), total)
					require.Equal(t, tc.ids, collectUserIDs(found))
				})
			}
			role, status, adminRole, disabledStatus := 1, 1, 10, 2
			for _, filter := range []struct {
				group        string
				role, status *int
			}{
				{"default", nil, nil}, {"", &adminRole, nil}, {"", nil, &disabledStatus},
			} {
				found, total, err := SearchUsers("13800138000", filter.group, filter.role, filter.status, 0, 20)
				require.NoError(t, err)
				require.Zero(t, total)
				require.Empty(t, found)
			}
			found, total, err := SearchUsers("", "premium", &role, &status, 1, 1, NewUserSortOptions("id", "asc"))
			require.NoError(t, err)
			require.EqualValues(t, 2, total)
			require.Equal(t, []int{3}, collectUserIDs(found))
			page, total, err := GetAllUsers(&common.PageInfo{Page: 1, PageSize: 2}, NewUserSortOptions("id", "asc"))
			require.NoError(t, err)
			require.EqualValues(t, 3, total)
			items, err := AttachAdminUserListDetails(page)
			require.NoError(t, err)
			require.Len(t, items, 2)
			require.Equal(t, "13800138000", items[0].Phone)
			require.Empty(t, items[1].Phone)
			require.Equal(t, "9007199254740993", items[0].PointBalances[0].AvailablePoints)
			encoded, err := common.Marshal(items)
			require.NoError(t, err)
			require.Contains(t, string(encoded), `"phone":"13800138000"`)
			require.NotContains(t, string(encoded), "secret")
			encoded, err = common.Marshal(users[0])
			require.NoError(t, err)
			require.NotContains(t, string(encoded), `"phone"`)
			empty, err := AttachAdminUserListDetails(nil)
			require.NoError(t, err)
			require.NotNil(t, empty)
			require.Empty(t, empty)
		})
	}
}
