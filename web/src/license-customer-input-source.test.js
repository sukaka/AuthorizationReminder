import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('license form uses a typeable customer autocomplete instead of a native select', () => {
  assert.match(appSource, /licenseCustomerInput/)
  assert.match(appSource, /licenseCustomerSuggestions/)
  assert.match(appSource, /placeholder="输入或选择客户名称"/)
  assert.doesNotMatch(appSource, /<select\s+className="form-select"\s+value=\{licenseForm\.customer_id\}/)
})

test('customer table exposes a create-license shortcut', () => {
  assert.match(appSource, /onCreateLicenseForCustomer/)
  assert.match(appSource, /新增授权/)
  assert.match(appSource, /setActiveTab\('licenses'\)/)
})
