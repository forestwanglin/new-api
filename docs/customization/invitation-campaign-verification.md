# Invitation Campaign Verification

日期：2026-11-16

## 通过

- `go test ./model ./service ./controller ./router -run 'TestInvitation|TestCustomSubscription' -count=1`
- `go test ./model -run 'TestInvitationDomainDatabaseMatrix|TestCustomSubscriptionPaymentDatabaseMatrix' -count=1 -v` using SQLite 3.50.4, MySQL 8.4.13, PostgreSQL 16.16; fresh and legacy upgrade migrations each run twice.
- `go vet ./model ./controller ./router ./service`, `go build -o /tmp/new-api-invitation-check .`, `git diff --check`.
- Frontend invitation/navigation tests: 11 tests passed; typecheck passed for 1,608 files; invitation scoped lint and protected-header-safe format checks passed; production build passed.
- Isolated Chrome: anonymous binding opens the shared login dialog; Escape/cancel returns without binding; 390x844 viewport renders the public campaign and binding controls without overlap.
- Refund zero-rounding regression matrix: frozen reward reduced to zero and refunded again, acknowledged zero reward refunded, and pre-acknowledgement refund; SQLite 3.50.4, MySQL 8.4.13, PostgreSQL 16.16 all passed.

## Known baseline limits

- Full Go controller/router runs still expose existing OpenAI sampling compatibility failures and missing pre-existing phone/WeChat/custom-subscription entries in the PAT route catalogue. Dedicated invitation authorization tests pass.
- Full frontend suite: 281 files and 3,028 tests passed; one pre-existing `detail-preview` localized pricing test times out after 20 seconds.
- No production database, real payment provider, refund provider, SMS, or WeChat credential flow was used.
