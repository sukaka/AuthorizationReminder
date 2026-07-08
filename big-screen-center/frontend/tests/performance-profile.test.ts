import { describe, expect, it } from 'vitest'

import { createPerformanceDetector } from '../src/composables/usePerformanceProfile'

describe('createPerformanceDetector', () => {
  it('drops from high to medium after sustained low fps', () => {
    const detector = createPerformanceDetector('high')

    Array.from({ length: 180 }, () => detector.sample(35))

    expect(detector.profile()).toBe('medium')
  })

  it('drops from medium to low only under severe sustained pressure', () => {
    const detector = createPerformanceDetector('medium')

    Array.from({ length: 180 }, () => detector.sample(22))

    expect(detector.profile()).toBe('low')
  })

  it('keeps the selected profile for healthy frame rates', () => {
    const detector = createPerformanceDetector('high')

    Array.from({ length: 180 }, () => detector.sample(58))

    expect(detector.profile()).toBe('high')
  })
})
