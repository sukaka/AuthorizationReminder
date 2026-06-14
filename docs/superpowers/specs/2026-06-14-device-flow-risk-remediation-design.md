# Device Flow Risk Remediation Design

## Goal

Resolve the remaining Device Flow risks: callback SSRF, vulnerable dependencies, unstable RBAC test credentials, and platform version drift.

## Scope

- Device Flow callback URL validation and delivery.
- Device Flow backend and frontend dependencies.
- Device Flow RBAC integration-test account setup.
- Repository version automation and Device Flow runtime version reporting.

Other systems and unrelated dependency upgrades are out of scope.

## Callback SSRF Protection

Callback URLs must use `http` or `https`, must not contain credentials, and must include a valid hostname. By default, the application rejects:

- Loopback, unspecified, link-local, private, carrier-grade NAT, multicast, reserved, and documentation IP ranges.
- IPv4-mapped IPv6 addresses that resolve to a blocked IPv4 address.
- Hostnames resolving to any blocked address.
- Cloud metadata hostnames and addresses, including `169.254.169.254`.

`CALLBACK_ALLOWED_HOSTS` is a comma-separated exact hostname/IP allowlist. An allowlisted host bypasses the private-address restriction but still requires `http` or `https` and cannot contain URL credentials.

Validation occurs when a subscription is created or updated and again immediately before each delivery. Redirects are disabled so a trusted public URL cannot redirect the worker to a private target. DNS resolution is repeated at delivery time to reduce DNS rebinding exposure.

## Dependency Remediation

- Upgrade Express within major version 4 to the latest safe patch.
- Upgrade Multer to `2.1.1` or newer.
- Upgrade Vite to the current safe major and align `@vitejs/plugin-react`.
- Replace `xlsx` with `exceljs`, because the npm `xlsx` package has known advisories without a fixed npm release.

The Excel adapter will preserve the current first-sheet import behavior, header aliases, row limits, template format, and export columns. Import parsing and workbook generation become asynchronous where required by ExcelJS.

`npm audit` must report zero known vulnerabilities for the Device Flow backend and frontend lock files after installation.

## RBAC Test Isolation

RBAC tests must not depend on mutable built-in account passwords. Before the matrix test:

1. Generate a random password in memory.
2. Upsert dedicated `device_flow_rbac_admin`, `device_flow_rbac_auditor`, and `device_flow_rbac_sysadmin` users directly in the Auth database through a helper running inside the Auth container.
3. Set the required roles, app access, active state, password hash, no forced password change, and no MFA.
4. Run the existing login and RBAC matrix with those accounts.
5. Delete their sessions and users during cleanup.

No generated password is written to the repository or printed in logs.

## Version Alignment

Add `device-flow/backend` and `device-flow/frontend` to the forced package-version set used by repository version automation. Future patch, minor, and major releases will update both package files and lock files.

Docker Compose will inject the platform `APP_VERSION` into the Device Flow API. `/api/version` and `/api/build` must therefore report the root repository version. The package version remains a fallback for standalone execution.

## Error Handling

- Invalid callback targets return HTTP 400 with a stable validation message.
- A callback target that becomes unsafe after subscription creation is recorded as a failed delivery and follows the existing retry policy without making the HTTP request.
- Excel parse failures keep the current user-facing error.
- RBAC setup failures stop the test before business data is created; cleanup is attempted on exit.

## Verification

- Unit tests for blocked and allowlisted callback targets, DNS results, credentials, and redirects.
- Unit tests for Excel import/export compatibility.
- Version automation test proving Device Flow package alignment.
- Dependency audits for backend and frontend.
- Container rebuild and health/readiness/version checks.
- Device Flow backend tests, frontend production build, smoke flow, API regression, upload cleanup, and full RBAC matrix.

