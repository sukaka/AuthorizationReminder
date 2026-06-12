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

  it('localizes live train-exam metric keys', () => {
    expect(metricLabel('course_total')).toBe('课程总数')
    expect(metricLabel('question_total')).toBe('题目总数')
    expect(metricLabel('question_published_total')).toBe('已发布题目')
    expect(metricLabel('question_draft_total')).toBe('草稿题目')
    expect(metricLabel('paper_total')).toBe('试卷总数')
    expect(metricLabel('paper_published_total')).toBe('已发布试卷')
    expect(metricLabel('exam_total')).toBe('考试总数')
    expect(metricLabel('final_result_total')).toBe('最终成绩数')
    expect(metricLabel('final_passed_total')).toBe('最终通过数')
    expect(metricLabel('pass_rate')).toBe('通过率')
  })

  it('localizes widget titles instead of exposing template ids', () => {
    expect(widgetTitle('metrics')).toBe('核心指标')
    expect(widgetTitle('health')).toBe('数据健康矩阵')
    expect(widgetTitle('ranking')).toBe('指标排行')
    expect(widgetTitle('risk-globe')).toBe('风险星球')
    expect(widgetTitle('remind-02-health')).toBe('数据健康矩阵')
    expect(widgetTitle('remind-02-ranking')).toBe('触达指标排行')
  })
})
