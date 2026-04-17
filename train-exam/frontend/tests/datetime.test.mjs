import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDateTime } from '../src/datetime.js';

test('formatDateTime renders stored UTC timestamps as Asia/Shanghai local time', () => {
  assert.equal(formatDateTime('2026-04-17 03:14:33'), '2026/4/17 11:14:33');
});

test('formatDateTime keeps invalid values readable', () => {
  assert.equal(formatDateTime('not-a-date'), 'not-a-date');
  assert.equal(formatDateTime(''), '-');
});
