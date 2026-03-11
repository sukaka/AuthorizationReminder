# Auth OWASP Remediation Result

**Date:** 2026-03-11

## Implemented Changes

1. Added server-side session persistence in `auth_user_sessions`, and bound every JWT to `sid`.
2. Enforced session validity checks in `authMiddleware`.
3. Revoked the active session on logout.
4. Revoked all user sessions on password change.
5. Shortened default JWT/session lifetime from `7d` to `12h`.
6. Added a modern password hashing scheme for new and upgraded passwords.
7. Added legacy bcrypt compatibility with explicit rejection for `>72` byte legacy-password verification attempts.
8. Automatically rehashed safe-length legacy bcrypt passwords after successful login.
9. Removed `csurf` and replaced it with a custom double-submit CSRF implementation.
10. Upgraded `nodemailer` and generated `auth/package-lock.json`.
11. Added non-local bootstrap enforcement: `AUTH_COOKIE_SECURE=false` is now rejected outside local-only deployments.

## Runtime Verification

- `logout` after login:
  - old bearer token now returns `401`
- `change-password` after login:
  - old bearer token now returns `401`
  - login with the new password returns `200`
- JWT TTL:
  - reduced to `43200` seconds (`12h`)
- legacy bcrypt truncation test:
  - both `>72` byte attempts now return `400`
- dependency audit:
  - `docker compose exec -T auth npm audit --omit=dev` returns `0 vulnerabilities`

## Tests

- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/password-security.test.js /Users/zhanglei/Documents/codex-new/auth/tests/session-security.test.js /Users/zhanglei/Documents/codex-new/auth/tests/csrf-security.test.js /Users/zhanglei/Documents/codex-new/auth/tests/security-bootstrap.test.js`
  - `10` tests passed
- `node --check /Users/zhanglei/Documents/codex-new/auth/index.js`
  - passed

## Remaining Note

- Local Docker Compose still serves auth over plain HTTP, so local runtime cookies still do not carry `Secure`.
- This is now treated as a local-only exception by bootstrap validation; non-local deployments must enable `AUTH_COOKIE_SECURE`.
