# Auth System OWASP 2024 Audit

**Date:** 2026-03-11

## Scope and Baseline

- Target: `auth`
- Method: static review + runtime spot checks
- Interpreted baseline:
  - OWASP Authentication Cheat Sheet
  - OWASP Session Management Cheat Sheet
  - OWASP Password Storage Cheat Sheet
- Note:
  - `OWASP 2024` is not a single official auth checklist name. For this audit, it is interpreted as the current OWASP authentication guidance relevant in 2024 and still current on 2026-03-11.

## OWASP Sources

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Transport Layer Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html)

## Findings

### 1. Logout and password change do not revoke previously issued JWTs

- Risk: High
- Confidence: High
- Impact:
  - Any stolen bearer token remains usable until expiry even after the user logs out.
  - Password changes do not kick out an attacker who already holds a token.
  - Combined with the current 7-day token lifetime, this materially extends account takeover windows.
- Static evidence:
  - `/Users/zhanglei/Documents/codex-new/auth/index.js`
  - `createToken()` issues self-contained JWTs with only `id / username / role`.
  - `authMiddleware` only verifies JWT signature and current `is_active`; there is no token version, session table, denylist, or revocation check.
  - `POST /api/auth/logout` only clears the cookie.
  - `POST /api/auth/change-password` only updates `password_hash`.
- Runtime evidence:
  - Temporary test account login succeeded.
  - `POST /api/auth/logout` returned `200`.
  - Reusing the old bearer token on `GET /api/auth/me` still returned `200`.
  - `POST /api/auth/change-password` returned `200`.
  - Reusing the bearer token issued before the password change on `GET /api/auth/me` still returned `200`.
  - Decoded JWT lifetime was `604800` seconds (`7` days).
- OWASP mapping:
  - Session Management Cheat Sheet requires server-side invalidation on logout.
  - Session Management Cheat Sheet calls for reauthentication after password changes and other risk events.
- Recommendation:
  - Introduce server-side session state, token versioning, or a revocation list.
  - Revoke all active sessions on password change.
  - Shorten absolute session lifetime substantially for this SSO entry point.

### 2. Password hashing path is vulnerable to bcrypt 72-byte truncation collisions

- Risk: Medium
- Confidence: High
- Impact:
  - Two different long passwords that only differ after byte `72` authenticate as the same secret.
  - This is a real authentication ambiguity and can break user expectations and account security for long passwords.
- Static evidence:
  - `/Users/zhanglei/Documents/codex-new/auth/index.js`
  - Passwords are passed directly into `bcrypt.hashSync()` and `bcrypt.compareSync()` with no maximum-length enforcement and no pre-hashing strategy.
  - The current password policy checks only minimum complexity, not maximum byte length.
- Runtime evidence:
  - Created a temporary test user whose stored hash was generated from a long password.
  - Login with the original long password returned `200`.
  - Login with a different password that only changed after the 72-byte boundary also returned `200`.
- OWASP mapping:
  - Password Storage Cheat Sheet states that bcrypt has a maximum input length of `72` bytes and applications should enforce that limit or use an alternative approach.
- Recommendation:
  - Prefer Argon2id or scrypt for new password storage.
  - If bcrypt must remain, enforce a hard maximum of `72` bytes or pre-hash safely before bcrypt with a documented migration strategy.

### 3. Auth session cookies are still issued without the `Secure` attribute over plain HTTP

- Risk: Medium
- Confidence: High
- Impact:
  - If this deployment pattern is exposed beyond a strictly local environment, session cookies can be disclosed over unencrypted HTTP.
  - Because the auth service is an SSO entry point, cookie theft here affects multiple downstream apps.
- Static evidence:
  - `/Users/zhanglei/Documents/codex-new/auth/index.js`
  - Cookie options depend on `AUTH_COOKIE_SECURE`.
  - `/Users/zhanglei/Documents/codex-new/docker-compose.yml`
  - `AUTH_COOKIE_SECURE` is set to `"false"`.
  - The local stack serves auth on `http://localhost:5180`.
- Runtime evidence:
  - Login response header contained:
    - `HttpOnly`
    - `SameSite=Lax`
    - no `Secure`
- OWASP mapping:
  - Session Management Cheat Sheet and TLS Cheat Sheet both require `Secure` cookies over HTTPS.
- Recommendation:
  - Enforce HTTPS for the auth entry point.
  - Set `AUTH_COOKIE_SECURE=true` outside disposable local-only development.
  - Consider stricter cookie settings once cross-app flows are reviewed.

### 4. Reachable dependency vulnerabilities remain in the auth runtime

- Risk: Medium
- Confidence: High
- Impact:
  - `nodemailer` carries a reachable high-severity DoS advisory and an address interpretation advisory.
  - `csurf` also pulls a low-severity cookie advisory through an outdated dependency tree.
  - The `nodemailer` path is reachable through MFA email delivery.
- Static evidence:
  - `/Users/zhanglei/Documents/codex-new/auth/package.json`
  - direct dependencies include `nodemailer@^6.9.14` and `csurf@^1.11.0`.
  - `/Users/zhanglei/Documents/codex-new/auth/index.js`
  - MFA email sending is implemented in `sendEmail()` and invoked from `POST /api/auth/mfa/send`.
- Runtime evidence:
  - `docker compose exec -T auth npm audit --omit=dev --json` reported:
    - `nodemailer` high severity advisory
    - `cookie/csurf` low severity advisory
- Recommendation:
  - Upgrade `nodemailer` to a fixed major version after compatibility validation.
  - Replace `csurf` with a maintained CSRF approach or upgrade off the vulnerable tree.

## Checked Items Without Confirmed Vulnerability

- Login brute-force controls:
  - Captcha is enabled by default.
  - Account/IP failure counters and temporary lockout exist.
- Password change:
  - Current password verification is required.
- MFA:
  - Email / SMS / WeCom / TOTP flows exist.
  - Forced MFA setup is enforced through `introspect`, `authorize`, and app listing checks.
- Generic login failure messaging:
  - User-not-found and password-mismatch both return `账号或密码错误`.
- Weak secret bootstrap:
  - Startup validation exists for weak JWT / audit / config keys and the builtin default password.

## Runtime Notes

- Runtime verification used temporary users created directly in `juxin_reminder.users`.
- Those temporary users were deleted after validation.

## Verification Commands

- `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml exec -T auth npm audit --omit=dev --json`
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/security-bootstrap.test.js`
- custom HTTP runtime checks for:
  - login
  - logout
  - password change
  - bearer token reuse
  - cookie flags
  - bcrypt 72-byte truncation behavior
