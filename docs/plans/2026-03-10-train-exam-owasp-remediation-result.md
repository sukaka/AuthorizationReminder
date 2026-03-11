# Train-Exam OWASP Remediation Result

**Date:** 2026-03-10

## Scope

- Target: `train-exam`
- Baseline: `OWASP Top 10 2021`
- Type: remediation implementation + runtime verification

## Implemented Fixes

1. Rotated legacy built-in auth password hashes on startup when stored hashes still matched historic defaults.
2. Added `train-exam` double-submit CSRF protection and frontend token fetch / retry flow.
3. Restricted low-privilege readers to published courses, linked resources, and linked papers.
4. Added in-memory rate limiting for upload, import, exam start, certificate generation, and AI model test flows.
5. Replaced `xlsx` with `exceljs` and upgraded `multer` to `2.1.1`.
6. Added startup-time weak secret validation for `train-exam`.
7. Split `train-exam` onto its own `train-exam-onlyoffice` instance and JWT secret.
8. Hardened doc preview file access:
   - token binds to internal host
   - request must come from private/loopback source
   - forwarded proxy headers are rejected
9. Added structured security event logging for auth failure, access denial, CSRF failure, and rate limiting.
10. Added AI `base_url` validation to block insecure protocol and private-host SSRF targets.
11. Externalized the train-exam/auth/FAQ/tender/OnlyOffice secrets used by this path into local `.env`.
12. Updated root README to reflect the dedicated `train-exam-onlyoffice` deployment.

## Verification Summary

- `cd /Users/zhanglei/Documents/codex-new/train-exam/backend && npm test`
  - `7` test files passed
  - `22` tests passed
- `node --test /Users/zhanglei/Documents/codex-new/auth/tests/security-bootstrap.test.js`
  - `3` tests passed
- `cd /Users/zhanglei/Documents/codex-new/train-exam/backend && npm audit --omit=dev`
  - `0` vulnerabilities
- `docker compose -f /Users/zhanglei/Documents/codex-new/docker-compose.yml up -d --build --force-recreate train-exam-api web-train-exam train-exam-onlyoffice`
  - rebuilt and restarted successfully

## Runtime Spot-Check Results

- Legacy built-in passwords:
  - stored hashes for `admin/sysadmin/auditor/editor/reviewer` no longer match the two historic defaults
  - `editor` login with the previous default password now returns `400`
- Access control:
  - temporary viewer account gets `403` for draft course `10`
  - temporary viewer account gets `403` for draft resource `25`
  - temporary viewer account gets `403` for a draft paper linked to course `10`
  - `editor` can still read the same draft paper with `200`
- CSRF:
  - cookie-only `POST /api/train-exam/papers/15/exam/start` returns `403`
  - same request with `X-CSRF-Token` succeeds past CSRF validation (`201` first run, then `409` when session already exists)
- Doc preview:
  - preview file URL with mismatched host returns `401`
  - same preview file URL with internal host `train-exam-api:5188` returns `200`
  - spoofing the internal host through `web-train-exam` now returns `401`
- AI SSRF:
  - temporary admin account calling `POST /api/train-exam/ai/models/test` with `http://127.0.0.1:11434` returns `400`
- Security logging:
  - recent `te_operation_logs` now include `ACCESS_DENIED`, `AUTH_FAILURE`, and `CSRF_FAILURE`

## Notes

- Runtime verification used temporary `security_viewer_20260310` / `security_admin_20260310` users and a temporary `security-draft-paper`.
- Those temporary verification users and paper were deleted after the checks completed.
