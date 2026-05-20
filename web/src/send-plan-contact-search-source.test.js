import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('send plan search placeholder includes contacts', () => {
  assert.match(appSource, /placeholder="搜索计划\/授权\/客户\/联系人"/)
})
