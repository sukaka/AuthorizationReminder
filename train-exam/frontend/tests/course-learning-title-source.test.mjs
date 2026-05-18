import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSource = fs.readFileSync(path.join(__dirname, '../src/App.jsx'), 'utf8');

test('course learning modal keeps course title only in the modal header', () => {
  assert.ok(appSource.includes('<strong id="course-learning-modal-heading">{currentLearningCourseTitle}</strong>'));
  assert.ok(!appSource.includes('<h2>{currentLearningCourseTitle}</h2>'));
});
