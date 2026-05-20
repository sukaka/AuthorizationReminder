import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('sales license overview tab loads grouped data and supports export', () => {
  assert.match(appSource, /key: 'sales-licenses', label: '销售授权'/)
  assert.match(appSource, /salesLicenseOverview/)
  assert.match(appSource, /refreshSalesLicenseOverview/)
  assert.match(appSource, /exportSalesLicenseOverview/)
  assert.match(appSource, /\/api\/sales-license-overview/)
  assert.match(appSource, /\/api\/sales-license-overview\/export/)
})
