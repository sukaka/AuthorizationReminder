import { describe, expect, it } from 'vitest'

import StatusMatrix from '../src/components/widgets/StatusMatrix.vue'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const widget: WidgetDefinition = {
  id: 'remind-02-health',
  type: 'status-matrix',
  dataSourceKey: 'delivery-execution',
  layoutArea: 'health',
  optional: false,
  minWidth: 2,
  minHeight: 1,
  maxWidth: 8,
  maxHeight: 3,
  config: { variant: 'remind-02-health' },
}

describe('StatusMatrix labels', () => {
  it('explains health cells with Chinese labels', () => {
    const { wrapper } = mountWithInteraction(StatusMatrix, {
      widget,
      data: {
        expiring: 0,
        todayDue: 0,
        totalReminders: 0,
        successRate: 94,
      },
      performanceProfile: 'high',
    })

    expect(wrapper.text()).toContain('数据健康矩阵')
    expect(wrapper.text()).toContain('到期授权')
    expect(wrapper.text()).toContain('触达成功率')
    expect(wrapper.find('[title="触达成功率：94"]').exists()).toBe(true)
  })
})
