import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('app exposes a read-only my licenses page for ordinary users', () => {
  assert.match(appSource, /key: 'my-licenses', label: '我的授权'/)
  assert.match(appSource, /myLicenses/)
  assert.match(appSource, /refreshMyLicenses/)
  assert.match(appSource, /\/api\/my\/licenses/)
  assert.match(appSource, /activeTab === 'my-licenses'/)
})
