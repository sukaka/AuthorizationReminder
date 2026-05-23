import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('admin result center exposes retake and delete-score controls', () => {
  assert.match(appSource, /开放补考/);
  assert.match(appSource, /删除成绩/);
  assert.match(appSource, /\/api\/train-exam\/admin\/users\/\$\{userId\}\/papers\/\$\{paperId\}\/retake-opportunities/);
  assert.match(appSource, /\/api\/train-exam\/admin\/results\/\$\{resultId\}/);
});
