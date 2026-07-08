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

  it('uses a distinct explanation for core status matrices', () => {
    const coreWidget: WidgetDefinition = {
      ...widget,
      id: 'train-02-core',
      layoutArea: 'core',
      config: { variant: 'train-02-core' },
    }
    const healthWidget: WidgetDefinition = {
      ...widget,
      id: 'train-02-health',
      layoutArea: 'health',
      config: { variant: 'train-02-health' },
    }

    const core = mountWithInteraction(StatusMatrix, {
      widget: coreWidget,
      data: {
        course_total: 3,
        question_total: 105,
        exam_total: 2,
        pass_rate: 0,
      },
      performanceProfile: 'high',
    })
    const health = mountWithInteraction(StatusMatrix, {
      widget: healthWidget,
      data: {
        course_total: 3,
        question_total: 105,
        exam_total: 2,
        pass_rate: 0,
      },
      performanceProfile: 'high',
    })

    expect(core.wrapper.text()).toContain('展示考试、题库、试卷与通过率的实时指标分布。')
    expect(health.wrapper.text()).toContain('下方格子表示关键指标健康度，颜色越亮越需要关注。')
    expect(core.wrapper.text()).not.toContain('下方格子表示关键指标健康度，颜色越亮越需要关注。')
  })
})
