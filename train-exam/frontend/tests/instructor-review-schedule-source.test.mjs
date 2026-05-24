import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('instructor review admin page exposes scheduled publish dialog and API call', () => {
  assert.match(appSource, /instructorReviewScheduleDialog/);
  assert.match(appSource, /定时发布问卷/);
  assert.match(appSource, /\/api\/train-exam\/admin\/instructor-review-forms\/\$\{instructorReviewScheduleDialog\.id\}\/schedule-publish/);
  assert.match(appSource, /scheduled_publish_at/);
  assert.match(appSource, /type="date"/);
  assert.match(appSource, /type="time"/);
});

test('instructor review list displays scheduled state and planned publish time', () => {
  assert.match(appSource, /instructorReviewStatusLabel/);
  assert.match(appSource, /待发布/);
  assert.match(appSource, /计划发布/);
});
