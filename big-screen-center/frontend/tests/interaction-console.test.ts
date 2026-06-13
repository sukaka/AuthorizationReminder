import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import InteractionConsole from '../src/components/InteractionConsole.vue'
import {
  provideScreenInteraction,
  useScreenInteraction,
  type ScreenInteractionApi,
} from '../src/interactions/useScreenInteraction'
import { screenManifests } from '../src/templates/manifests'
import type { InteractionTarget, JsonValue } from '../src/types'

const template = screenManifests[0]
const widget = template.widgets[0]

const target = (overrides: Partial<InteractionTarget> = {}): InteractionTarget => ({
  key: 'criticalRisks',
  label: '严重风险',
  group: 'risk',
  relatedKeys: ['high'],
  detailPath: '/',
  description: '严重风险用于展示需要优先处置的漏洞状态。',
  value: 48,
  unit: undefined,
  source: 'metric-card',
  sourceWidgetId: 'sca-01-metrics',
  templateId: 'sca-01',
  filters: {},
  ...overrides,
})

describe('screen interaction provider', () => {
  it('builds semantic targets and refreshes locked values from data', async () => {
    let api!: ScreenInteractionApi
    const data = shallowRef<JsonValue>({ criticalRisks: 48 })
    const filters = shallowRef<Record<string, JsonValue>>({
      dateRange: '30d',
      nested: { unsafe: true },
    })

    mount(defineComponent({
      setup() {
        api = provideScreenInteraction(shallowRef(template), data, filters)
        return () => h('span', 'provider')
      },
    }))

    const built = api.targetFor(widget, 'criticalRisks', 48, 'metric-card')
    expect(built).toMatchObject({
      key: 'criticalRisks',
      label: '严重风险',
      group: 'risk',
      sourceWidgetId: widget.id,
      templateId: template.id,
      filters: { dateRange: '30d' },
    })

    api.lock(built)
    data.value = { criticalRisks: 99 }
    await nextTick()

    expect(api.snapshot.value.locked).toMatchObject({
      key: 'criticalRisks',
      value: 99,
    })
  })

  it('throws clearly when a component is outside the provider tree', () => {
    const Consumer = defineComponent({
      setup() {
        useScreenInteraction()
        return () => h('span')
      },
    })

    expect(() => mount(Consumer)).toThrow('Screen interaction provider is missing')
  })
})

describe('InteractionConsole', () => {
  it('renders metric analysis, related indicators, and emits close', async () => {
    const wrapper = mount(InteractionConsole, {
      props: {
        target: target(),
        related: [{
          key: 'high',
          label: '高危',
          group: 'risk',
          relatedKeys: ['criticalRisks'],
          detailPath: '/',
          description: '高危漏洞数量。',
          value: 12,
        }],
        systemKey: 'sca',
        currentHref: 'http://127.0.0.1:18092/play/sca-01',
      },
    })

    expect(wrapper.get('[data-interaction-console]').text()).toContain('严重风险')
    expect(wrapper.text()).toContain('高危')
    await wrapper.get('[aria-label="关闭联动分析台"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('opens valid business links in a new tab', async () => {
    const opener = vi.fn()
    const wrapper = mount(InteractionConsole, {
      props: {
        target: target(),
        related: [],
        systemKey: 'sca',
        currentHref: 'http://localhost:18092/play/sca-01',
        opener,
      },
    })

    await wrapper.get('[data-business-detail]').trigger('click')

    expect(opener).toHaveBeenCalledWith(
      'http://localhost:18089/?metric=criticalRisks',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('hides invalid business links', () => {
    const wrapper = mount(InteractionConsole, {
      props: {
        target: target({ detailPath: 'javascript:alert(1)' }),
        related: [],
        systemKey: 'sca',
        currentHref: 'http://localhost:18092/play/sca-01',
      },
    })

    expect(wrapper.find('[data-business-detail]').exists()).toBe(false)
  })
})
