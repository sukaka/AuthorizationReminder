import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import MetricCards from '../src/components/widgets/MetricCards.vue'
import RankingTable from '../src/components/widgets/RankingTable.vue'
import StatusMatrix from '../src/components/widgets/StatusMatrix.vue'
import type { WidgetDefinition } from '../src/types'
import { mountWithInteraction } from './helpers/interaction'

const widget = (
  type: WidgetDefinition['type'],
  id = 'sca-01-metrics',
): WidgetDefinition => ({
  id,
  type,
  dataSourceKey: 'security-overview',
  layoutArea: 'metrics',
  optional: false,
  minWidth: 2,
  minHeight: 1,
  maxWidth: 12,
  maxHeight: 4,
  config: { variant: id },
})

describe('interactive metric widgets', () => {
  it('previews, locks, and supports keyboard selection on metric cards', async () => {
    const { wrapper } = mountWithInteraction(MetricCards, {
      widget: widget('metric-cards'),
      data: { criticalRisks: 48, high: 12 },
      performanceProfile: 'high',
    })
    const card = wrapper.get('[data-interaction-key="criticalRisks"]')

    await card.trigger('mouseenter')
    expect(card.attributes('data-interaction-state')).toBe('primary')

    await card.trigger('mouseleave')
    expect(card.attributes('data-interaction-state')).toBe('none')

    await card.trigger('click')
    expect(card.attributes('aria-pressed')).toBe('true')

    const second = wrapper.get('[data-interaction-key="high"]')
    await second.trigger('keydown', { key: 'Enter' })
    expect(second.attributes('aria-pressed')).toBe('true')
    expect(card.attributes('aria-pressed')).toBe('false')
  })

  it('marks ranking rows as primary, related, or unchanged', async () => {
    const rankingWidget = widget('ranking-table', 'sca-01-ranking')
    const { wrapper, api } = mountWithInteraction(RankingTable, {
      widget: rankingWidget,
      data: { criticalRisks: 48, high: 12, project_count: 4 },
      performanceProfile: 'high',
    })

    api.lock({
      ...api.targetFor(rankingWidget, 'criticalRisks', 48, 'ranking'),
      relatedKeys: ['high'],
    })
    await nextTick()

    expect(wrapper.get('[data-interaction-key="criticalRisks"]')
      .attributes('data-interaction-state')).toBe('primary')
    expect(wrapper.get('[data-interaction-key="high"]')
      .attributes('data-interaction-state')).toBe('related')
    expect(wrapper.get('[data-interaction-key="project_count"]')
      .attributes('data-interaction-state')).toBe('none')
  })

  it('labels status matrix cells and exposes a health legend', async () => {
    const { wrapper } = mountWithInteraction(StatusMatrix, {
      widget: widget('status-matrix', 'remind-02-health'),
      data: { successRate: 94, totalReminders: 0 },
      performanceProfile: 'high',
    })

    const cell = wrapper.get('[data-interaction-key="successRate"]')
    expect(cell.attributes('aria-label')).toBe('触达成功率：94，状态正常')
    expect(wrapper.text()).toContain('正常')
    expect(wrapper.text()).toContain('关注')
    expect(wrapper.text()).toContain('暂无数据')
  })
})
