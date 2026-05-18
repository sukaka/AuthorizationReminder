import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('course list exposes publish and draft status actions', () => {
  assert.match(appSource, /onUpdateCourseStatus/);
  assert.match(appSource, /发布课程/);
  assert.match(appSource, /改回草稿/);
});

test('course status action uses existing course update endpoint with status payload', () => {
  assert.match(appSource, /api\.put\(`\/api\/train-exam\/courses\/\$\{id\}`/);
  assert.match(appSource, /status: nextStatus/);
});
