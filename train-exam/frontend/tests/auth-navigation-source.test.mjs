import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('training exam SSO portal preserves the non-standard HTTPS auth port', () => {
  assert.match(appSource, /VITE_SSO_PORTAL_PORT/);
  assert.match(appSource, /portalUrl\.port = publicHttpsPort/);
  assert.match(appSource, /buildPortalSwitchUrl\('train-exam'\)/);
  assert.match(appSource, /window\.location\.replace\(buildPortalLoginUrl\(\)\)/);
});
