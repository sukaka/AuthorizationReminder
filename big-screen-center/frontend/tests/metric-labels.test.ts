import { describe, expect, it } from 'vitest'

import {
  metricLabel,
  widgetTitle,
} from '../src/metric-labels'

describe('big-screen metric labels', () => {
  it('localizes projected upstream metric keys', () => {
    expect(metricLabel('expiring')).toBe('到期授权')
    expect(metricLabel('todayDue')).toBe('今日到期')
    expect(metricLabel('totalReminders')).toBe('提醒总数')
    expect(metricLabel('successRate')).toBe('触达成功率')
    expect(metricLabel('channelBreakdown_sms_total')).toBe('短信提醒总数')
    expect(metricLabel('expiryBucketsCount')).toBe('到期分布档位')
    expect(metricLabel('day7')).toBe('7 天内到期')
  })

  it('localizes widget titles instead of exposing template ids', () => {
    expect(widgetTitle('remind-02-health')).toBe('数据健康矩阵')
    expect(widgetTitle('remind-02-ranking')).toBe('触达指标排行')
  })
})
