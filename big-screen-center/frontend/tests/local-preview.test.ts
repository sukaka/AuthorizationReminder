import { describe, expect, it } from 'vitest'

import {
  buildUnifiedLoginUrl,
  isLocalPreviewHost,
} from '../src/preview-data'

describe('local preview helpers', () => {
  it.each(['localhost', '127.0.0.1', '::1'])(
    'recognizes local preview host %s',
    (hostname) => {
      expect(isLocalPreviewHost(hostname)).toBe(true)
    },
  )

  it('builds the unified login URL on 127.0.0.1', () => {
    expect(buildUnifiedLoginUrl('http://127.0.0.1:18092/play/train-03')).toBe(
      'http://127.0.0.1:5180/portal?system=big-screen',
    )
  })

  it('builds the unified login URL on localhost', () => {
    expect(buildUnifiedLoginUrl('http://localhost:18092/play/sca-03')).toBe(
      'http://localhost:5180/portal?system=big-screen',
    )
  })

  it('uses the same origin portal path outside local preview', () => {
    expect(buildUnifiedLoginUrl('https://dashboard.example.com/play/sca-03')).toBe(
      'https://dashboard.example.com/portal?system=big-screen',
    )
  })
})
