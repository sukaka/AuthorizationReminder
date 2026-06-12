import { metricLabel } from '../metric-labels'
import type {
  MetricInteractionDefinition,
  SystemKey,
} from '../types'

const keysBySystem: Record<SystemKey, string[]> = {
  sca: [
    'project_count',
    'component_total',
    'vulnerability_total',
    'criticalRisks',
    'high',
    'medium',
    'low',
    'vulnerableComponents',
    'healthyRate',
    'blocked_count',
    'assets',
    'devops',
  ],
  'train-exam': [
    'course_total',
    'question_total',
    'question_published_total',
    'question_draft_total',
    'paper_total',
    'paper_published_total',
    'exam_total',
    'final_result_total',
    'final_passed_total',
    'pass_rate',
    'activeCourses',
    'learners',
    'completionRate',
    'certificates',
  ],
  reminder: [
    'expiring',
    'todayDue',
    'totalReminders',
    'successRate',
    'total',
    'success',
    'channelBreakdown_sms_total',
    'expiring7d',
    'expiring30d',
    'riskAmount',
    'deliveryRate',
    'day7',
    'day30',
    'day60',
    'day90',
    'customer_count',
    'license_count',
  ],
}

const groupByKey: Record<string, string> = {
  project_count: 'asset',
  component_total: 'asset',
  assets: 'asset',
  vulnerability_total: 'risk',
  criticalRisks: 'risk',
  high: 'risk',
  medium: 'risk',
  low: 'risk',
  vulnerableComponents: 'risk',
  healthyRate: 'governance',
  blocked_count: 'governance',
  devops: 'governance',
  course_total: 'content',
  question_total: 'content',
  question_published_total: 'content',
  question_draft_total: 'content',
  paper_total: 'content',
  paper_published_total: 'content',
  exam_total: 'exam',
  final_result_total: 'exam',
  final_passed_total: 'exam',
  pass_rate: 'outcome',
  activeCourses: 'content',
  learners: 'learner',
  completionRate: 'outcome',
  certificates: 'outcome',
  expiring: 'expiry',
  todayDue: 'expiry',
  expiring7d: 'expiry',
  expiring30d: 'expiry',
  day7: 'expiry',
  day30: 'expiry',
  day60: 'expiry',
  day90: 'expiry',
  riskAmount: 'expiry',
  totalReminders: 'delivery',
  successRate: 'delivery',
  total: 'delivery',
  success: 'delivery',
  channelBreakdown_sms_total: 'delivery',
  deliveryRate: 'delivery',
  customer_count: 'customer',
  license_count: 'customer',
}

const labelOverrides: Record<string, string> = {
  devops: '研发运维',
}

const labelFor = (key: string) => labelOverrides[key] || metricLabel(key)

export const createMetricInteractions = (
  systemKey: SystemKey,
): MetricInteractionDefinition[] => {
  const keys = keysBySystem[systemKey]
  return keys.map((key) => {
    const group = groupByKey[key]
    const label = labelFor(key)
    return {
      key,
      label,
      group,
      relatedKeys: keys.filter(
        (candidate) => candidate !== key && groupByKey[candidate] === group,
      ),
      detailPath: '/',
      description: `${label}用于展示当前模板中的业务状态和变化情况。`,
    }
  })
}
