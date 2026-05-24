import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('paper form exposes configurable exam window with 72 hour default', () => {
  assert.match(appSource, /exam_window_hours: 72/);
  assert.match(appSource, /考试有效期\(小时\)/);
  assert.match(appSource, /exam_window_hours: Number\(paperForm\.exam_window_hours \|\| 72\)/);
});

test('published paper list shows expired exam state and admin timeout records', () => {
  assert.match(appSource, /isPaperExpiredForExam/);
  assert.match(appSource, /超过考试时间/);
  assert.match(appSource, /超时用户/);
  assert.match(appSource, /\/api\/train-exam\/admin\/exam-timeouts/);
});
