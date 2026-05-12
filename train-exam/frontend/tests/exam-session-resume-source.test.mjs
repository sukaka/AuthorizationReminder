import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('exam app persists and restores running exam session ids', () => {
  assert.match(appSource, /persistExamSessionId/);
  assert.match(appSource, /readPersistedExamSessionId/);
  assert.match(appSource, /clearPersistedExamSessionId/);
  assert.match(appSource, /\/api\/train-exam\/exam-sessions\/\$\{sessionId\}/);
});
