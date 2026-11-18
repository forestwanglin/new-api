package service

import (
	"errors"
	"strings"

	sqlitedriver "github.com/glebarez/go-sqlite"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
)

// Username conflicts alone may regenerate a phone-registration username. Other
// uniqueness errors (phone ownership, invitation bindings, etc.) retain their
// original semantics and must not be retried as username collisions.
func isPhoneRegistrationUsernameConflict(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505" && (pgErr.ConstraintName == "uni_users_username" || pgErr.ConstraintName == "idx_users_username")
	}
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) {
		if mysqlErr.Number != 1062 {
			return false
		}
		// The duplicate value is arbitrary; inspect only the server's key suffix.
		_, key, ok := strings.Cut(mysqlErr.Message, " for key '")
		if !ok || !strings.HasSuffix(key, "'") {
			return false
		}
		key = strings.TrimSuffix(key, "'")
		if dot := strings.LastIndexByte(key, '.'); dot >= 0 {
			key = key[dot+1:]
		}
		return key == "uni_users_username" || key == "idx_users_username" || key == "username"
	}
	var sqliteErr *sqlitedriver.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == 2067 &&
		strings.Contains(sqliteErr.Error(), "UNIQUE constraint failed: users.username (2067)")
}
