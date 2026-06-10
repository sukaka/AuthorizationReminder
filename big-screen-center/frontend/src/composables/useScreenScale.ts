import { onMounted, onUnmounted, ref } from 'vue'

import type { LayoutKey } from '../types'

export interface ScreenTransform {
  layout: LayoutKey
  designWidth: 1920 | 3840
  designHeight: 1080
  scaleX: number
  scaleY: number
  offsetX: number
  offsetY: number
}

export function calculateScreenTransform(
  viewportWidth: number,
  viewportHeight: number,
): ScreenTransform {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error('Viewport dimensions must be positive')
  }
  const ratio = viewportWidth / viewportHeight
  const layout: LayoutKey = ratio >= 2.5 ? 'ultrawide' : 'widescreen'
  const designWidth = layout === 'ultrawide' ? 3840 : 1920
  const designHeight = 1080
  const scale = Math.min(
    viewportWidth / designWidth,
    viewportHeight / designHeight,
  )
  return {
    layout,
    designWidth,
    designHeight,
    scaleX: scale,
    scaleY: scale,
    offsetX: (viewportWidth - designWidth * scale) / 2,
    offsetY: (viewportHeight - designHeight * scale) / 2,
  }
}

const fallbackTransform = calculateScreenTransform(1920, 1080)

export function useScreenScale() {
  const transform = ref<ScreenTransform>(fallbackTransform)

  const update = () => {
    if (typeof window === 'undefined') return
    transform.value = calculateScreenTransform(window.innerWidth, window.innerHeight)
  }

  onMounted(() => {
    update()
    window.addEventListener('resize', update, { passive: true })
  })
  onUnmounted(() => window.removeEventListener('resize', update))

  return { transform, update }
}
