import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GraphPanel from '../src/components/widgets/GraphPanel.vue'
import MapPanel from '../src/components/widgets/MapPanel.vue'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const mocks = vi.hoisted(() => ({
  graphOn: vi.fn(),
  graphOff: vi.fn(),
  setElementState: vi.fn(),
  graphHandlers: new Map<string, (event?: unknown) => void>(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  mapOn: vi.fn(),
  mapOff: vi.fn(),
  mapHandlers: new Map<string, (event?: unknown) => void>(),
}))

class ResizeObserverStub {
  observe = vi.fn()
  disconnect = vi.fn()
}

vi.mock('@antv/g6', () => ({
  Graph: vi.fn(function GraphMock() {
    return {
      render: vi.fn(() => Promise.resolve()),
      on: mocks.graphOn.mockImplementation((event: string, handler: (event?: unknown) => void) => {
        mocks.graphHandlers.set(event, handler)
      }),
      off: mocks.graphOff,
      setElementState: mocks.setElementState,
      setSize: vi.fn(),
      destroy: vi.fn(),
    }
  }),
}))

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

vi.mock('maplibre-gl', () => ({
  default: {
    Map: vi.fn(function MapMock() {
      return {
        addSource: mocks.addSource,
        addLayer: mocks.addLayer,
        on: mocks.mapOn.mockImplementation((
          event: string,
          layerOrHandler: string | ((event?: unknown) => void),
          maybeHandler?: (event?: unknown) => void,
        ) => {
          if (typeof layerOrHandler === 'function') {
            mocks.mapHandlers.set(event, layerOrHandler)
            if (event === 'load') layerOrHandler()
            return
          }
          if (maybeHandler) {
            mocks.mapHandlers.set(`${event}:${layerOrHandler}`, maybeHandler)
          }
        }),
        off: mocks.mapOff,
        remove: vi.fn(),
      }
    }),
  },
}))

const graphWidget: WidgetDefinition = {
  id: 'sca-01-graph',
  type: 'graph',
  dataSourceKey: 'security-overview',
  layoutArea: 'core',
  optional: true,
  minWidth: 3,
  minHeight: 3,
  maxWidth: 12,
  maxHeight: 8,
  config: { variant: 'sca-graph' },
}

const mapWidget: WidgetDefinition = {
  id: 'remind-01-map',
  type: 'map',
  dataSourceKey: 'reminder-overview',
  layoutArea: 'core',
  optional: true,
  minWidth: 3,
  minHeight: 3,
  maxWidth: 12,
  maxHeight: 8,
  config: { variant: 'reminder-map' },
}

const emitMapLayer = (event: string, layer: string, payload: unknown) => {
  mocks.mapHandlers.get(`${event}:${layer}`)?.(payload)
}

describe('graph and map interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    mocks.graphOn.mockClear()
    mocks.graphOff.mockClear()
    mocks.setElementState.mockClear()
    mocks.graphHandlers.clear()
    mocks.addSource.mockClear()
    mocks.addLayer.mockClear()
    mocks.mapOn.mockClear()
    mocks.mapOff.mockClear()
    mocks.mapHandlers.clear()
  })

  it('registers G6 node and canvas interaction handlers', async () => {
    mountWithInteraction(GraphPanel, {
      widget: graphWidget,
      data: { criticalRisks: 48, high: 12 },
      performanceProfile: 'high',
    })
    await flushPromises()

    expect(mocks.graphOn).toHaveBeenCalledWith('node:pointerenter', expect.any(Function))
    expect(mocks.graphOn).toHaveBeenCalledWith('node:pointerleave', expect.any(Function))
    expect(mocks.graphOn).toHaveBeenCalledWith('node:click', expect.any(Function))
    expect(mocks.graphOn).toHaveBeenCalledWith('canvas:click', expect.any(Function))
  })

  it('syncs active metric state back to G6 nodes', async () => {
    const { api } = mountWithInteraction(GraphPanel, {
      widget: graphWidget,
      data: { criticalRisks: 48, high: 12 },
      performanceProfile: 'high',
    })
    await flushPromises()

    api.lock({
      ...api.targetFor(graphWidget, 'criticalRisks', 48, 'graph'),
      relatedKeys: ['high'],
    })
    await nextTick()

    expect(mocks.setElementState).toHaveBeenCalledWith('criticalRisks', ['selected'])
    expect(mocks.setElementState).toHaveBeenCalledWith('high', ['active'])
  })

  it('does not invent map points when no GeoJSON is present', async () => {
    const { wrapper } = mountWithInteraction(MapPanel, {
      widget: mapWidget,
      data: { customer_count: 12, license_count: 30 },
      performanceProfile: 'high',
    })
    await flushPromises()

    expect(mocks.addSource).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-map-metric]')).toHaveLength(2)
  })

  it('uses valid GeoJSON features as interactive map points', async () => {
    const point = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.4, 39.9] },
      properties: {
        metricKey: 'customer_count',
        label: '客户数量',
        value: 12,
      },
    }
    const { api } = mountWithInteraction(MapPanel, {
      widget: mapWidget,
      data: {
        geojson: { type: 'FeatureCollection', features: [point] },
      },
      performanceProfile: 'high',
    })
    await flushPromises()

    expect(mocks.addSource).toHaveBeenCalledWith(
      'business-points',
      expect.objectContaining({ data: expect.any(Object) }),
    )
    emitMapLayer('click', 'business-points-layer', { features: [point] })
    expect(api.snapshot.value.locked?.key).toBe('customer_count')
  })
})
