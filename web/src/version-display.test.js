import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'App.jsx'), 'utf8')
const appPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))

test('web app release version comes from package version', () => {
  assert.match(appSource, /import appPackage from '\.\.\/package\.json'/)
  assert.match(appSource, /const APP_RELEASE_VERSION = `v\$\{appPackage\.version\}`/)
  assert.match(appSource, /\{APP_RELEASE_VERSION\}/)
  assert.match(appPackage.version, /^\d+\.\d+\.\d+$/)
})
