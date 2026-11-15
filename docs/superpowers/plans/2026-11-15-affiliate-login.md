# Invitation attribution and login presentation implementation plan

**Goal:** Preserve invitation links and existing destinations, attribute only newly created users, and repair the login theme and OpenAI vendor presentation.

**Approved behavior:** `/sign-up?aff=CODE` sends authenticated visitors to `/dashboard`. Anonymous visitors retain the invitation before redirecting to `/` and opening the shared login modal. Existing accounts and phone bindings never change their inviter. New WeChat accounts are attributed when created, before the existing required phone-binding step; new phone accounts are attributed inside their creation transaction.

**Architecture:** Reuse browser affiliate storage, existing `AuthFlow.Payload`, `User.InviterId`, and insertion/reward methods. Optional `aff` is accepted by WeChat verification and phone CAPTCHA verification; the latter freezes it in the server-side phone flow. Resolve inviter IDs on the server. Unknown codes permit ordinary registration, while database failures remain errors. Preserve CSRF/browser proof, single-use proofs, expiry, MFA and session issuance.

**Constraints:** No schema migration or new dependency. User opted out of Trellis task creation. Maintain compatibility with previously shared links and legacy requests without `aff`. An explicit new invitation replaces the pending one; missing query parameters do not erase it. Pending invitations expire after 30 days and clear only after successful authentication, with conditional clearing to preserve newer visits. Keep legacy stored codes usable during transition.

## Execution

- [x] Frontend: failing route/storage/request regressions; save before redirect without preload side effects; send `aff`; clear completed invitations without clearing pending binding/MFA attempts.
- [x] Backend: failing new/existing/invalid-inviter regressions; carry phone attribution in existing flows; write inviter only in new-user branches; verify SQLite, MySQL and PostgreSQL.
- [x] Presentation: failing vendor and selection regressions; map exact `codex-auto-review` to OpenAI; mark model navigation selected for the model plaza at `/`; use theme tokens for the existing login modal.
- [x] Verification: affected Vitest tests, frontend suite/typecheck/lint/format/build, Go focused tests and database matrix; browser check light/dark modal and model navigation. Review final diff and create a local Conventional Commit containing only task changes.

## Review focus

- Authenticated visits and route preloads must not overwrite pending attribution or open the modal.
- Existing users with either a nonzero or zero inviter must remain unchanged.
- WeChat pending phone binding and MFA must retain invitation intent until full authentication succeeds.
- Invalid/expired invitation state must not break ordinary registration, and newer pending invitations must survive stale completion.
- OpenAI display and filtering must agree, including missing or incorrect model vendor metadata; dark mode must retain readable focus, error and disabled states.

## Security references

Read the OWASP Authentication and Session Management Cheat Sheets before implementation. Referral codes are untrusted attribution input, never proof of authentication or authorization. Keep existing server-side authentication controls and exclude secrets from diagnostics. No claim of a complete ASVS audit is made by this change.

Reviewed ASVS 5.0.0 controls: 2.2.1/2.2.2 input validation, 2.3.1/2.3.3 flow order and transactions, 6.3.4 authentication pathway consistency, 6.5.1/6.5.5 single use and expiry, 7.2.1 backend session verification.

## Verification outcome

Affected frontend suite: 25 files / 185 tests passed; typecheck, changed-file lint/format, production build, Go build/vet passed. Referral/phone regressions passed on real SQLite 3.50.4, MySQL 8.4.13 and PostgreSQL 16.16. Chrome verified invitation storage, modal opening, selected model navigation, OpenAI filtering, light/dark themes and mobile sizing.

Full-suite baseline failures remain: frontend detail-preview localized price test times out (also independently reproduced; documented in Z057); controller TestOpenAIChatSamplingCompatibility has four failures reproduced with original HEAD files through a Go overlay. No unrelated assertions were weakened. Real WeChat/SMS registration and production deployment were not performed. See customization registry Z061 for commands, scope and limitations.
