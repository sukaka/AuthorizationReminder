import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.join(import.meta.dirname, '..')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.vue'), 'utf8')

test('report export collects metadata before creating reports', () => {
  assert.match(appSource, /reportMetadataDialogVisible/)
  assert.match(appSource, /报告属性信息/)
  assert.match(appSource, /client_name/)
  assert.match(appSource, /auditor_name/)
  assert.match(appSource, /metadata: reportMetadata/)
})
