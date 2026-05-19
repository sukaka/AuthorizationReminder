import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('customer import panel exposes a template download action', () => {
  assert.match(appSource, /onDownloadCustomerImportTemplate/)
  assert.match(appSource, /\/api\/import\/customers\/template\.xlsx/)
  assert.match(appSource, /customer-import-template\.xlsx/)
  assert.match(appSource, /客户导入模板/)
})
