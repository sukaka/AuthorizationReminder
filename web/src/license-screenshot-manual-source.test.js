import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')

test('license screenshot column supports manual uploaded marker', () => {
  assert.match(appSource, /onMarkLicenseScreenshotUploaded/)
  assert.match(appSource, /按已上传处理/)
  assert.match(appSource, /已标记/)
  assert.match(appSource, /screenshot_marked_uploaded/)
})
