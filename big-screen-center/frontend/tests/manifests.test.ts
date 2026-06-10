import { describe, expect, it } from 'vitest'

import { TEMPLATE_BLUEPRINTS, screenManifests } from '../src/templates/manifests'

describe('screen manifests', () => {
  it('defines the approved twelve-template catalog', () => {
    expect(TEMPLATE_BLUEPRINTS).toHaveLength(12)
    expect(screenManifests).toHaveLength(12)
    expect(new Set(screenManifests.map((template) => template.id)).size).toBe(12)
  })

  it('distributes templates across SCA, training, and reminder systems', () => {
    expect(screenManifests.filter((template) => template.systemKey === 'sca')).toHaveLength(5)
    expect(screenManifests.filter((template) => template.systemKey === 'train-exam')).toHaveLength(4)
    expect(screenManifests.filter((template) => template.systemKey === 'reminder')).toHaveLength(3)
  })

  it('provides fixed widescreen and ultrawide design dimensions', () => {
    for (const template of screenManifests) {
      expect(template.layouts.widescreen).toMatchObject({ width: 1920, height: 1080 })
      expect(template.layouts.ultrawide).toMatchObject({ width: 3840, height: 1080 })
    }
  })

  it('includes metrics, core visual, trend, ranking, and health widgets', () => {
    for (const template of screenManifests) {
      const variants = template.widgets.map((widget) => widget.config.variant)
      expect(template.widgets.some((widget) => widget.type === 'metric-cards')).toBe(true)
      expect(variants).toEqual(expect.arrayContaining(['core', 'trend', 'ranking', 'health']))
    }
  })

  it('limits every template to one persistent Three.js scene', () => {
    for (const template of screenManifests) {
      expect(template.widgets.filter((widget) => widget.type === 'three-scene').length).toBeLessThanOrEqual(1)
    }
  })
})
