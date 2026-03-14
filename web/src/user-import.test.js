import test from 'node:test'
import assert from 'node:assert/strict'

import { readUserImportDownloadFilename, readUserImportSummary } from './user-import.js'

test('readUserImportSummary reads import summary counters from headers', () => {
  const headers = new Headers({
    'X-Import-Total': '10',
    'X-Import-Created': '8',
    'X-Import-Skipped': '2',
    'X-Import-Error-Count': '2',
    'X-Import-Filename': 'user-import-result-2026-03-14-08-09-10.xlsx',
  })

  assert.deepEqual(readUserImportSummary(headers), {
    total: 10,
    created: 8,
    skipped: 2,
    errorCount: 2,
    filename: 'user-import-result-2026-03-14-08-09-10.xlsx',
  })
})

test('readUserImportSummary falls back to safe defaults when headers are missing', () => {
  const headers = new Headers()

  assert.deepEqual(readUserImportSummary(headers), {
    total: 0,
    created: 0,
    skipped: 0,
    errorCount: 0,
    filename: 'user-import-result.xlsx',
  })
})

test('readUserImportDownloadFilename reads quoted filename from Content-Disposition', () => {
  const headers = new Headers({
    'Content-Disposition': 'attachment; filename="user-import-template.xlsx"',
  })

  assert.equal(readUserImportDownloadFilename(headers, 'fallback.xlsx'), 'user-import-template.xlsx')
})

test('readUserImportDownloadFilename falls back when filename is missing', () => {
  const headers = new Headers()

  assert.equal(readUserImportDownloadFilename(headers, 'fallback.xlsx'), 'fallback.xlsx')
})
