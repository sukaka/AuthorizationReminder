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
  assert.match(block, /讲师评价/);
  assert.match(block, /考试结果/);
  assert.doesNotMatch(block, /培训管理/);
  assert.doesNotMatch(block, /考试中心/);
  assert.doesNotMatch(block, /成绩与证书/);
  assert.doesNotMatch(block, /错题复训/);
  assert.doesNotMatch(block, /仪表盘/);
  assert.doesNotMatch(block, /题库管理/);
  assert.doesNotMatch(block, /学员总体评价/);
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

test('admin result center starts from published paper result overview', () => {
  assert.match(appSource, /\/api\/train-exam\/admin\/results\/papers/);
  assert.match(appSource, /查看成绩/);
  assert.match(appSource, /评级分布/);
});

test('instructor reviews are exposed to basic users and admins', () => {
  assert.match(appSource, /讲师评价/);
  assert.match(appSource, /\/api\/train-exam\/my\/instructor-review-forms/);
  assert.match(appSource, /\/api\/train-exam\/admin\/instructor-review-forms/);
  assert.match(appSource, /\/api\/train-exam\/instructor-review-forms\/\$\{formId\}\/response/);
  assert.doesNotMatch(appSource, /\/api\/train-exam\/courses\/\$\{courseId\}\/instructor-review/);
});

test('basic instructor review table does not show average score column', () => {
  assert.match(appSource, /!isBasicUser \? <th>平均分<\/th> : null/);
  assert.match(appSource, /!isBasicUser \? <td>\{Number\(item\.summary\?\.average_final_score \|\| 0\)\.toFixed\(2\)\}<\/td> : null/);
});

test('student overall evaluation is an admin-only result summary page', () => {
  const adminMenuMatch = appSource.match(/\) : \(\s*<>\s*([\s\S]*?)\s*<\/>\s*\)\s*}\s*<\/div>\s*<div className="sidebar-actions">/);
  assert.ok(adminMenuMatch, '未找到管理员菜单分支');
  const adminMenuBlock = adminMenuMatch[1];
  assert.match(adminMenuBlock, /学员总体评价/);
  assert.match(adminMenuBlock, /activeMenu === 'student-overall'/);
  assert.match(appSource, /activeMenu === 'student-overall' && role === 'admin'/);
  assert.match(appSource, /buildStudentOverallRows/);
  assert.match(appSource, /仅管理员可见平均分/);
  assert.match(appSource, /总体评价/);
});
