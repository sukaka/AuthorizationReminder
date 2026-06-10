import { describe, expect, it } from 'vitest'

import { calculateScreenTransform } from '../src/composables/useScreenScale'

describe('calculateScreenTransform', () => {
  it('selects ultrawide at 32:9 and preserves aspect ratio', () => {
    const result = calculateScreenTransform(3840, 1080)

    expect(result.layout).toBe('ultrawide')
    expect(result.designWidth).toBe(3840)
    expect(result.scaleX).toBe(result.scaleY)
    expect(result.offsetX).toBe(0)
    expect(result.offsetY).toBe(0)
  })

  it('letterboxes mismatched widescreen viewports without stretching', () => {
    const result = calculateScreenTransform(1600, 1000)

    expect(result.layout).toBe('widescreen')
    expect(result.scaleX).toBe(result.scaleY)
    expect(result.offsetY).toBeGreaterThan(0)
  })

  it('rejects invalid viewport dimensions', () => {
    expect(() => calculateScreenTransform(0, 1080)).toThrow('Viewport dimensions must be positive')
  })
})
