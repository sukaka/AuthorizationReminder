import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('manual send plan form keeps default reminder policy aligned with automatic plans', () => {
  assert.match(appSource, /days: '90,60,30,7'/)
  assert.match(appSource, /channels: \['wecom'\]/)
  assert.match(appSource, /wecom_mode: 'webhook'/)
  assert.match(appSource, /plan\.auto_created/)
  assert.match(appSource, /自动/)
})
