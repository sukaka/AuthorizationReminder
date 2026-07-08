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
  course_total: '课程总数',
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
  exam_total: '考试总数',
  expiring: '到期授权',
  expiring7d: '7 天到期',
  expiring30d: '30 天到期',
  expiryBucketsCount: '到期分布档位',
  failureBreakdownCount: '失败原因数',
  final_passed_total: '最终通过数',
  final_result_total: '最终成绩数',
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
  paper_published_total: '已发布试卷',
  paper_total: '试卷总数',
  project_count: '项目数量',
  question_draft_total: '草稿题目',
  question_published_total: '已发布题目',
  question_total: '题目总数',
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

const normalizedMetricLabels: Record<string, string> = {
  active_courses: '进行中课程',
  channel_breakdown_email_success: '邮件成功数',
  channel_breakdown_email_total: '邮件提醒总数',
  channel_breakdown_sms_success: '短信成功数',
  channel_breakdown_sms_total: '短信提醒总数',
  channel_breakdown_wecom_success: '企微成功数',
  channel_breakdown_wecom_total: '企微提醒总数',
  completion_rate: '完成率',
  critical_risks: '严重风险',
  customer_risk_count: '风险客户数',
  delivery_rate: '提醒触达率',
  expiring_7d: '7 天到期',
  expiring_30d: '30 天到期',
  expiry_buckets_count: '到期分布档位',
  failure_breakdown_count: '失败原因数',
  healthy_rate: '健康率',
  risk_amount: '风险金额',
  sales_top_count: '销售排行数量',
  success_rate: '触达成功率',
  today_complete: '今日完成',
  today_due: '今日到期',
  total_courses: '课程总数',
  total_learners: '学员总数',
  total_projects: '项目总量',
  total_reminders: '提醒总数',
  trend_count: '趋势点数',
  vulnerable_components: '风险组件',
}

const metricTokenLabels: Record<string, string> = {
  active: '进行中',
  amount: '金额',
  asset: '资产',
  assets: '资产',
  average: '平均',
  blocked: '阻断',
  certificate: '证书',
  certificates: '证书',
  channel: '渠道',
  component: '组件',
  components: '组件',
  completion: '完成',
  count: '数量',
  course: '课程',
  courses: '课程',
  critical: '严重',
  customer: '客户',
  day: '天',
  delivery: '触达',
  devops: 'DevOps',
  draft: '草稿',
  due: '到期',
  email: '邮件',
  exam: '考试',
  expiring: '到期',
  expiry: '到期',
  failure: '失败',
  final: '最终',
  graph: '图谱',
  health: '健康',
  healthy: '健康',
  high: '高危',
  learner: '学员',
  learners: '学员',
  license: '授权',
  low: '低危',
  mandatory: '必修',
  medium: '中危',
  min: '最近',
  overdue: '逾期',
  paper: '试卷',
  passed: '通过',
  project: '项目',
  projects: '项目',
  published: '已发布',
  question: '题目',
  ranking: '排行',
  rate: '率',
  reminders: '提醒',
  result: '成绩',
  risk: '风险',
  sales: '销售',
  sms: '短信',
  success: '成功',
  total: '总数',
  trend: '趋势',
  vulnerability: '漏洞',
  vulnerable: '风险',
  wecom: '企微',
}

const widgetTitles: Record<string, string> = {
  core: '核心视图',
  health: '数据健康矩阵',
  metrics: '核心指标',
  ranking: '指标排行',
  trend: '趋势分析',
  'capability-terrain': '能力地形',
  'course-galaxy': '课程星系',
  'customer-map': '客户地图',
  'dependency-space': '依赖空间',
  'exam-matrix': '考试矩阵',
  'expiry-orbit': '到期轨道',
  'growth-stairway': '成长阶梯',
  'message-network': '触达网络',
  'risk-globe': '风险星球',
  'scan-pipeline': '扫描流水线',
  'security-route': '治理路线',
  'threat-radar': '威胁雷达',
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

const normalizeKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

const stripCollisionSuffix = (key: string) => key.replace(/_\d+$/, '')

export const metricLabel = (key: string) => {
  if (metricLabels[key]) return metricLabels[key]
  const normalized = normalizeKey(key)
  if (metricLabels[normalized]) return metricLabels[normalized]
  if (normalizedMetricLabels[normalized]) return normalizedMetricLabels[normalized]

  const baseKey = stripCollisionSuffix(normalized)
  if (metricLabels[baseKey]) return metricLabels[baseKey]
  if (normalizedMetricLabels[baseKey]) return normalizedMetricLabels[baseKey]

  const translated = baseKey
    .split('_')
    .filter(Boolean)
    .map((token) => metricTokenLabels[token] || token)
    .join('')

  return translated || '指标'
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
