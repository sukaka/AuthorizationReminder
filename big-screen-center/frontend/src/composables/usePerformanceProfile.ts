import { onMounted, onUnmounted, ref } from 'vue'

import type { EffectsProfile } from '../types'

const SAMPLE_WINDOW = 180

export function createPerformanceDetector(initial: EffectsProfile = 'high') {
  let current = initial
  let samples: number[] = []

  const sample = (fps: number) => {
    if (!Number.isFinite(fps) || fps <= 0) return current
    samples.push(fps)
    if (samples.length < SAMPLE_WINDOW) return current

    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
    samples = []
    if (current === 'high' && average < 45) current = 'medium'
    else if (current === 'medium' && average < 28) current = 'low'
    return current
  }

  return {
    sample,
    profile: () => current,
  }
}

export function usePerformanceProfile(initial: EffectsProfile = 'high') {
  const profile = ref<EffectsProfile>(initial)
  const detector = createPerformanceDetector(initial)
  let frameId = 0
  let previousTime = 0

  const measure = (time: number) => {
    if (previousTime > 0) {
      const delta = time - previousTime
      if (delta > 0) profile.value = detector.sample(1000 / delta)
    }
    previousTime = time
    frameId = requestAnimationFrame(measure)
  }

  onMounted(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      profile.value = 'low'
      return
    }
    frameId = requestAnimationFrame(measure)
  })
  onUnmounted(() => {
    if (frameId) cancelAnimationFrame(frameId)
  })

  return { profile }
}
