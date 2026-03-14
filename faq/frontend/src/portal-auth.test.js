import test from 'node:test'
import assert from 'node:assert/strict'

import { logoutFromSso } from './portal-auth.js'

test('logoutFromSso fetches csrf token then posts logout request', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url === '/api/auth/csrf') {
      return {
        ok: true,
        async json() {
          return { token: 'csrf-token-1' }
        },
      }
    }
    if (url === '/api/auth/logout') {
      return { ok: true }
    }
    throw new Error(`unexpected url: ${url}`)
  }

  const ok = await logoutFromSso({ fetchImpl })

  assert.equal(ok, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], {
    url: '/api/auth/csrf',
    options: { credentials: 'include' },
  })
  assert.deepEqual(calls[1], {
    url: '/api/auth/logout',
    options: {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-CSRF-Token': 'csrf-token-1',
      },
    },
  })
})

test('logoutFromSso stops when csrf token request fails', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url === '/api/auth/csrf') {
      return { ok: false }
    }
    throw new Error(`unexpected url: ${url}`)
  }

  const ok = await logoutFromSso({ fetchImpl })

  assert.equal(ok, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/auth/csrf')
})
