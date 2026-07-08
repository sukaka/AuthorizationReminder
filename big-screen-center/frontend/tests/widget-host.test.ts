import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import WidgetHost from '../src/components/widgets/WidgetHost.vue'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const widget = (type: string): WidgetDefinition => ({
  id: 'test-widget',
  type: type as WidgetDefinition['type'],
  dataSourceKey: 'security-overview',
  layoutArea: 'core',
  optional: false,
  minWidth: 2,
  minHeight: 2,
  maxWidth: 12,
  maxHeight: 12,
  config: { variant: 'core' },
})

describe('WidgetHost', () => {
  it('loads registered widget types from the code-owned registry', async () => {
    const { wrapper } = mountWithInteraction(WidgetHost, {
      widget: widget('metric-cards'),
      data: { total: 12 },
      performanceProfile: 'high',
    })
    await flushPromises()

    await vi.waitFor(() => {
      expect(wrapper.find('[data-widget-type="metric-cards"]').exists()).toBe(true)
    })
  })

  it('renders an explicit error card for unknown widget types', () => {
    const wrapper = mount(WidgetHost, {
      props: {
        widget: widget('remote-script-widget'),
        data: {},
        performanceProfile: 'low',
      },
    })

    expect(wrapper.get('[role="alert"]').text()).toContain('未注册组件')
    expect(wrapper.html()).not.toContain('remote-script-widget.vue')
  })
})
