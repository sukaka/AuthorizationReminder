import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('paper management exposes scheduled publish dialog and API call', () => {
  assert.match(appSource, /paperScheduleDialog/);
  assert.match(appSource, /定时发布/);
  assert.match(appSource, /schedule-publish/);
  assert.match(appSource, /scheduled_publish_at/);
  assert.match(appSource, /type="date"/);
  assert.match(appSource, /type="time"/);
});

test('paper list displays scheduled paper state and publish time', () => {
  assert.match(appSource, /待发布/);
  assert.match(appSource, /计划发布/);
  assert.match(appSource, /scheduled_publish_at \|\| p\.published_at/);
});
