import { describe, expect, it } from 'vitest'
import backendPackage from '../package.json' with { type: 'json' }
import frontendPackage from '../../frontend/package.json' with { type: 'json' }

describe('dependency policy', () => {
  it('pins runtime dependencies without ranges', () => {
    const values = [
      ...Object.values(backendPackage.dependencies),
      ...Object.values(frontendPackage.dependencies),
    ]

    expect(values.every((value) => /^\d+\.\d+\.\d+$/.test(value))).toBe(true)
  })

  it('includes the approved browser data-visualization packages', () => {
    expect(Object.keys(frontendPackage.dependencies).sort()).toEqual(
      expect.arrayContaining([
        '@antv/g6',
        '@kjgl77/datav-vue3',
        '@tsparticles/vue3',
        'animejs',
        'echarts',
        'echarts-gl',
        'gridstack',
        'maplibre-gl',
        'three',
        'tsparticles',
      ]),
    )
  })
})
