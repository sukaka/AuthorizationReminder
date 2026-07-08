import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('requestJson turns 504 html gateway response into structured timeout error', async (t) => {
  globalThis.window = { location: { origin: 'http://localhost:18089', href: 'http://localhost:18089/' } }
  globalThis.fetch = async () => new Response('<html><h1>504 Gateway Time-out</h1></html>', {
    status: 504,
    headers: { 'content-type': 'text/html' },
  })
  const errors = []
  t.mock.method(console, 'error', (...args) => errors.push(args))

  const { requestJson } = await import(`../src/api.js?cacheBust=${Date.now()}`)

  await assert.rejects(
    requestJson('/api/sca/projects/7/vulnerabilities/query', { method: 'POST' }),
    (error) => {
      assert.match(error.message, /SCA API 请求超时/)
      assert.equal(error.status, 504)
      assert.equal(error.url, '/api/sca/projects/7/vulnerabilities/query')
      assert.equal(error.contentType, 'text/html')
      assert.match(error.responseText, /504 Gateway Time-out/)
      return true
    },
  )
  assert.equal(errors.length, 1)
  assert.equal(errors[0][0], '[SCA API] request failed')
  assert.equal(errors[0][1].status, 504)
  assert.equal(errors[0][1].url, '/api/sca/projects/7/vulnerabilities/query')
})

test('resumable uploads support configurable chunks, bounded concurrency, retries, and resume state', () => {
  const source = readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')

  assert.match(source, /VITE_UPLOAD_CHUNK_SIZE_MB/)
  assert.match(source, /VITE_UPLOAD_CONCURRENCY/)
  assert.match(source, /VITE_UPLOAD_MAX_RETRIES/)
  assert.match(source, /uploaded_chunks/)
  assert.match(source, /localStorage/)
  assert.match(source, /Promise\.all/)
  assert.match(source, /shouldRetryUpload/)
  assert.match(source, /error\.status === 429/)
})
