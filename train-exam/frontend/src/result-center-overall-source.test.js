import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('candidate record page renders overall evaluation from API payload', () => {
  assert.match(appSource, /overall_evaluation/)
  assert.match(appSource, /综合评分/)
  assert.match(appSource, /综合评级/)
  assert.match(appSource, /evaluation_text/)
})
