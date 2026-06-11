import { describe, expect, it } from 'vitest'

import {
  isLocalPreviewHost,
  shouldUseLocalPreviewFallback,
} from '../src/preview-data'

describe('local preview fallback', () => {
  it.each(['localhost', '127.0.0.1', '::1'])(
    'allows local preview data on %s',
    (hostname) => {
      expect(isLocalPreviewHost(hostname)).toBe(true)
    },
  )

  it('uses preview data for local API failures before an envelope exists', () => {
    expect(shouldUseLocalPreviewFallback({
      hostname: '127.0.0.1',
      isMock: false,
      hasEnvelope: false,
      state: 'error',
    })).toBe(true)
  })

  it('does not hide production API failures', () => {
    expect(shouldUseLocalPreviewFallback({
      hostname: 'dashboard.example.com',
      isMock: false,
      hasEnvelope: false,
      state: 'error',
    })).toBe(false)
  })

  it('does not replace a real envelope after data has loaded once', () => {
    expect(shouldUseLocalPreviewFallback({
      hostname: 'localhost',
      isMock: false,
      hasEnvelope: true,
      state: 'error',
    })).toBe(false)
  })
})
