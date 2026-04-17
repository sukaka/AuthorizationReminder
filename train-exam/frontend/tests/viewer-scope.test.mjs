import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('basic viewer menu only exposes course list, paper list and results', () => {
  const match = appSource.match(/\{isBasicUser \? \(\s*<>\s*([\s\S]*?)\s*<\/>\s*\) : \(/);
  assert.ok(match, '未找到普通用户菜单分支');
  const block = match[1];
  assert.match(block, /课程列表/);
  assert.match(block, /试卷列表/);
  assert.match(block, /考试结果/);
  assert.doesNotMatch(block, /培训管理/);
  assert.doesNotMatch(block, /考试中心/);
  assert.doesNotMatch(block, /成绩与证书/);
  assert.doesNotMatch(block, /错题复训/);
  assert.doesNotMatch(block, /仪表盘/);
  assert.doesNotMatch(block, /题库管理/);
});

test('basic user detection treats user role as regular learner too', () => {
  assert.match(appSource, /role === 'viewer'/);
  assert.match(appSource, /role === 'user'/);
});

test('basic viewer result area no longer renders certificate or recertification tables', () => {
  assert.doesNotMatch(appSource, /viewer-cert-/);
  assert.doesNotMatch(appSource, /viewer-recert-/);
});

test('results center exposes export actions for admin and basic user result lists', () => {
  assert.match(appSource, /导出结果/);
  assert.match(appSource, /\/api\/train-exam\/admin\/results\/export\.csv/);
  assert.match(appSource, /\/api\/train-exam\/my\/results\/export\.csv/);
});
