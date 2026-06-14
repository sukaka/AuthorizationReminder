import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import EChartPanel from '../src/components/widgets/EChartPanel.vue'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const handlers = new Map<string, (params?: unknown) => void>()
const dispatchAction = vi.fn()
const setOption = vi.fn()
const off = vi.fn()
const dispose = vi.fn()
let chartHost: HTMLElement | null = null

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

vi.mock('echarts/charts', () => ({
  BarChart: {},
  LineChart: {},
}))

vi.mock('echarts/components', () => ({
  GridComponent: {},
  PolarComponent: {},
  TooltipComponent: {},
}))

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: {},
}))

vi.mock('echarts/core', () => ({
  use: vi.fn(),
  init: vi.fn((host: HTMLElement) => {
    chartHost = host
    return {
    setOption,
    on: vi.fn((event: string, handler: (params?: unknown) => void) => {
      handlers.set(event, handler)
    }),
    off,
    dispatchAction,
    resize: vi.fn(),
    dispose,
  }
  }),
}))

vi.mock('echarts-gl', () => ({}))

const widget: WidgetDefinition = {
  id: 'sca-01-trend',
  type: 'echart',
  dataSourceKey: 'security-overview',
  layoutArea: 'trend',
  optional: true,
  minWidth: 3,
  minHeight: 3,
  maxWidth: 12,
  maxHeight: 8,
  config: { variant: 'sca-01-trend', visualKey: 'risk-globe' },
}

describe('EChartPanel interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    handlers.clear()
    dispatchAction.mockClear()
    setOption.mockClear()
    off.mockClear()
    dispose.mockClear()
    chartHost = null
  })

  it('maps chart hover, click, and globalout events to interaction targets', async () => {
    const { api } = mountWithInteraction(EChartPanel, {
      widget,
      data: { criticalRisks: 48, high: 12 },
      performanceProfile: 'high',
    })
    await flushPromises()

    handlers.get('mouseover')?.({
      data: { metricKey: 'criticalRisks', value: 48 },
    })
    expect(api.active.value?.key).toBe('criticalRisks')
    expect(api.active.value?.source).toBe('echart')

    handlers.get('click')?.({
      data: { metricKey: 'high', value: 12 },
    })
    expect(api.snapshot.value.locked?.key).toBe('high')

    handlers.get('globalout')?.()
    expect(api.snapshot.value.hovered).toBeNull()
  })

  it('dispatches highlight actions for active linked metrics', async () => {
    const { api } = mountWithInteraction(EChartPanel, {
      widget,
      data: { criticalRisks: 48, high: 12, project_count: 4 },
      performanceProfile: 'high',
    })
    await flushPromises()

    api.lock({
      ...api.targetFor(widget, 'criticalRisks', 48, 'echart'),
      relatedKeys: ['high'],
    })
    await nextTick()

    expect(dispatchAction).toHaveBeenCalledWith({ type: 'downplay' })
    expect(dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
    expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'highlight',
      dataIndex: 0,
    }))
    expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'highlight',
      dataIndex: 1,
    }))
    expect(dispatchAction).toHaveBeenCalledWith(expect.objectContaining({
      type: 'showTip',
      dataIndex: 0,
    }))
  })

  it('rebuilds a failed WebGL chart as a 2D chart', async () => {
    setOption.mockImplementationOnce(() => {
      const error = document.createElement('div')
      error.className = 'ecgl-nowebgl'
      error.textContent = 'Sorry, your browser does not support WebGL'
      chartHost?.appendChild(error)
    })
    const glWidget: WidgetDefinition = {
      ...widget,
      id: 'sca-02-core',
      layoutArea: 'core',
      config: { variant: 'sca-02-core', visualKey: 'threat-radar' },
    }

    const { wrapper } = mountWithInteraction(EChartPanel, {
      widget: glWidget,
      data: { criticalRisks: 48, high: 12 },
      performanceProfile: 'high',
    }, {
      global: {
        stubs: {
          ParticleVeil: true,
        },
      },
    })
    await flushPromises()

    expect(setOption.mock.calls[0][0].series[0].type).toBe('bar3D')
    expect(setOption.mock.calls.at(-1)?.[0].series[0].type).toBe('line')
    expect(dispose).toHaveBeenCalledOnce()
    expect(wrapper.text()).not.toContain('Sorry, your browser does not support WebGL')
  })

  it('removes chart listeners on unmount', async () => {
    const { wrapper } = mountWithInteraction(EChartPanel, {
      widget,
      data: { criticalRisks: 48 },
      performanceProfile: 'high',
    })
    await flushPromises()

    wrapper.unmount()

    expect(off).toHaveBeenCalledWith('mouseover', expect.any(Function))
    expect(off).toHaveBeenCalledWith('click', expect.any(Function))
    expect(off).toHaveBeenCalledWith('globalout', expect.any(Function))
  })
})
