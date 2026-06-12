import type { JsonValue } from './types'

const metricLabels: Record<string, string> = {
  activeCourses: '进行中课程',
  assets: '资产',
  average_completion_rate: '平均完成率',
  b0_7: '0-7 天',
  b8_15: '8-15 天',
  b16_30: '16-30 天',
  b31_60: '31-60 天',
  b60p: '60 天以上',
  blocked_count: '阻断任务',
  certificates: '证书签发',
  channelBreakdown_email_success: '邮件成功数',
  channelBreakdown_email_total: '邮件提醒总数',
  channelBreakdown_sms_success: '短信成功数',
  channelBreakdown_sms_total: '短信提醒总数',
  channelBreakdown_wecom_success: '企微成功数',
  channelBreakdown_wecom_total: '企微提醒总数',
  component_total: '组件总数',
  completionRate: '完成率',
  criticalRisks: '严重风险',
  customer_count: '客户数量',
  customerRiskCount: '风险客户数',
  day7: '7 天内到期',
  day30: '30 天内到期',
  day60: '60 天内到期',
  day90: '90 天内到期',
  dueSoon: '即将到期',
  deliveryRate: '提醒触达率',
  devops: 'DevOps',
  elective: '选修课程',
  expiring: '到期授权',
  expiring7d: '7 天到期',
  expiring30d: '30 天到期',
  expiryBucketsCount: '到期分布档位',
  failureBreakdownCount: '失败原因数',
  high: '高危',
  healthyRate: '健康率',
  learners: '参训人数',
  license_count: '授权数量',
  low: '低危',
  mandatory: '必修课程',
  medium: '中危',
  min_days_left: '最近到期天数',
  overdue: '逾期任务',
  pass_rate: '通过率',
  passed_count: '通过人数',
  project_count: '项目数量',
  riskAmount: '风险金额',
  salesTopCount: '销售排行数量',
  success: '成功触达',
  successRate: '触达成功率',
  todayComplete: '今日完成',
  todayDue: '今日到期',
  total: '总数',
  totalCourses: '课程总数',
  totalLearners: '学员总数',
  totalProjects: '项目总量',
  totalReminders: '提醒总数',
  trendCount: '趋势点数',
  vulnerableComponents: '风险组件',
  vulnerability_total: '漏洞总数',
}

const widgetTitles: Record<string, string> = {
  core: '核心视图',
  'remind-01-alert': '到期预警',
  'remind-01-core': '到期风险轨道',
  'remind-01-health': '数据健康矩阵',
  'remind-01-ranking': '到期风险排行',
  'remind-01-trend': '到期趋势',
  'remind-02-alert': '触达预警',
  'remind-02-core': '提醒触达网络',
  'remind-02-health': '数据健康矩阵',
  'remind-02-ranking': '触达指标排行',
  'remind-02-trend': '触达趋势',
  'remind-03-core': '客户经营地图',
  'remind-03-health': '数据健康矩阵',
  'remind-03-ranking': '客户机会排行',
  'remind-03-trend': '客户趋势',
  'sca-01-core': '漏洞风险态势',
  'sca-01-health': '数据健康矩阵',
  'sca-01-ranking': '风险排行',
  'sca-02-core': '组件资产态势',
  'sca-02-health': '数据健康矩阵',
  'sca-02-ranking': '组件排行',
  'sca-03-core': '供应链依赖图谱',
  'sca-03-health': '数据健康矩阵',
  'sca-03-ranking': '供应链排行',
  'sca-04-core': '合规治理视图',
  'sca-04-health': '数据健康矩阵',
  'sca-04-ranking': '合规排行',
  'sca-05-core': '修复运营视图',
  'sca-05-health': '数据健康矩阵',
  'sca-05-ranking': '修复排行',
  'train-01-core': '培训运营总览',
  'train-01-health': '数据健康矩阵',
  'train-01-ranking': '课程排行',
  'train-02-core': '考试通过态势',
  'train-02-health': '数据健康矩阵',
  'train-02-ranking': '考试排行',
  'train-03-core': '课程学习图谱',
  'train-03-health': '数据健康矩阵',
  'train-03-ranking': '学习排行',
  'train-04-core': '证书能力视图',
  'train-04-health': '数据健康矩阵',
  'train-04-ranking': '证书排行',
}

export const metricLabel = (key: string) => {
  if (metricLabels[key]) return metricLabels[key]
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export const widgetTitle = (variant: unknown) => {
  const key = String(variant || '')
  return widgetTitles[key] || key || '数据组件'
}

export const numericMetricEntries = (data: JsonValue, limit: number) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  return Object.entries(data)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .slice(0, limit)
}
