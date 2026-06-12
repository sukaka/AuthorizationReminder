import {
  ScreenTemplateSchema,
  type ScreenTemplate,
  type SystemKey,
} from './contracts.js'

type RefreshMode = 'poll' | 'sse'
type CoreWidgetType = 'echart' | 'graph' | 'map' | 'status-matrix' | 'three-scene'

interface TemplateBlueprint {
  id: string
  systemKey: SystemKey
  name: string
  metricKey: string
  visualKey: string
  refreshMode: RefreshMode
  coreType: CoreWidgetType
  themeKey: string
}

const interactionKeysBySystem: Record<SystemKey, string[]> = {
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

const interactionGroupByKey: Record<string, string> = {
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

const interactionLabelByKey: Record<string, string> = {
  project_count: '项目数量',
  component_total: '组件总数',
  vulnerability_total: '漏洞总数',
  criticalRisks: '严重风险',
  high: '高危',
  medium: '中危',
  low: '低危',
  vulnerableComponents: '风险组件',
  healthyRate: '健康率',
  blocked_count: '阻断任务',
  assets: '资产',
  devops: '研发运维',
  course_total: '课程总数',
  question_total: '题目总数',
  question_published_total: '已发布题目',
  question_draft_total: '草稿题目',
  paper_total: '试卷总数',
  paper_published_total: '已发布试卷',
  exam_total: '考试总数',
  final_result_total: '最终成绩数',
  final_passed_total: '最终通过数',
  pass_rate: '通过率',
  activeCourses: '进行中课程',
  learners: '参训人数',
  completionRate: '完成率',
  certificates: '证书签发',
  expiring: '到期授权',
  todayDue: '今日到期',
  totalReminders: '提醒总数',
  successRate: '触达成功率',
  total: '总数',
  success: '成功触达',
  channelBreakdown_sms_total: '短信提醒总数',
  expiring7d: '7 天到期',
  expiring30d: '30 天到期',
  riskAmount: '风险金额',
  deliveryRate: '提醒触达率',
  day7: '7 天内到期',
  day30: '30 天内到期',
  day60: '60 天内到期',
  day90: '90 天内到期',
  customer_count: '客户数量',
  license_count: '授权数量',
}

const createMetricInteractions = (systemKey: SystemKey) => {
  const keys = interactionKeysBySystem[systemKey]
  return keys.map((key) => {
    const group = interactionGroupByKey[key]
    const label = interactionLabelByKey[key]
    return {
      key,
      label,
      group,
      relatedKeys: keys.filter(
        (candidate) =>
          candidate !== key && interactionGroupByKey[candidate] === group,
      ),
      detailPath: '/',
      description: `${label}用于展示当前模板中的业务状态和变化情况。`,
    }
  })
}

const templateBlueprints: readonly TemplateBlueprint[] = [
  { id: 'sca-01', systemKey: 'sca', name: '全域安全态势', metricKey: 'security-overview', visualKey: 'risk-globe', refreshMode: 'sse', coreType: 'three-scene', themeKey: 'security-orbit' },
  { id: 'sca-02', systemKey: 'sca', name: '漏洞与威胁态势', metricKey: 'vulnerability-threat', visualKey: 'threat-radar', refreshMode: 'poll', coreType: 'echart', themeKey: 'threat-radar' },
  { id: 'sca-03', systemKey: 'sca', name: '供应链资产图谱', metricKey: 'supply-chain-graph', visualKey: 'dependency-space', refreshMode: 'poll', coreType: 'three-scene', themeKey: 'dependency-space' },
  { id: 'sca-04', systemKey: 'sca', name: '扫描运营中心', metricKey: 'scan-operations', visualKey: 'scan-pipeline', refreshMode: 'sse', coreType: 'three-scene', themeKey: 'scan-pipeline' },
  { id: 'sca-05', systemKey: 'sca', name: '安全治理成果', metricKey: 'security-governance', visualKey: 'security-route', refreshMode: 'poll', coreType: 'echart', themeKey: 'security-route' },
  { id: 'train-01', systemKey: 'train-exam', name: '培训运营总览', metricKey: 'training-overview', visualKey: 'course-galaxy', refreshMode: 'poll', coreType: 'three-scene', themeKey: 'course-galaxy' },
  { id: 'train-02', systemKey: 'train-exam', name: '考试实时指挥', metricKey: 'exam-command', visualKey: 'exam-matrix', refreshMode: 'sse', coreType: 'status-matrix', themeKey: 'exam-command' },
  { id: 'train-03', systemKey: 'train-exam', name: '组织能力画像', metricKey: 'organization-capability', visualKey: 'capability-terrain', refreshMode: 'poll', coreType: 'graph', themeKey: 'capability-terrain' },
  { id: 'train-04', systemKey: 'train-exam', name: '培训成果汇报', metricKey: 'training-outcomes', visualKey: 'growth-stairway', refreshMode: 'poll', coreType: 'three-scene', themeKey: 'growth-stairway' },
  { id: 'remind-01', systemKey: 'reminder', name: '授权到期风险态势', metricKey: 'expiry-risk', visualKey: 'expiry-orbit', refreshMode: 'poll', coreType: 'three-scene', themeKey: 'expiry-orbit' },
  { id: 'remind-02', systemKey: 'reminder', name: '提醒执行与触达', metricKey: 'delivery-execution', visualKey: 'message-network', refreshMode: 'sse', coreType: 'graph', themeKey: 'message-network' },
  { id: 'remind-03', systemKey: 'reminder', name: '客户与销售经营', metricKey: 'customer-sales', visualKey: 'customer-map', refreshMode: 'poll', coreType: 'map', themeKey: 'customer-map' },
]

const layoutAreas = ['metrics', 'core', 'trend', 'ranking', 'health']

function createTemplate(blueprint: TemplateBlueprint): ScreenTemplate {
  return {
    id: blueprint.id,
    systemKey: blueprint.systemKey,
    name: blueprint.name,
    version: 1,
    themeKey: blueprint.themeKey,
    effectsProfile: 'high',
    layouts: {
      widescreen: { width: 1920, height: 1080, areas: [...layoutAreas] },
      ultrawide: { width: 3840, height: 1080, areas: [...layoutAreas] },
    },
    widgets: [
      {
        id: `${blueprint.id}-metrics`,
        type: 'metric-cards',
        dataSourceKey: blueprint.metricKey,
        layoutArea: 'metrics',
        optional: false,
        minWidth: 3,
        minHeight: 2,
        maxWidth: 12,
        maxHeight: 4,
        config: { variant: 'metrics' },
      },
      {
        id: `${blueprint.id}-core`,
        type: blueprint.coreType,
        dataSourceKey: blueprint.metricKey,
        layoutArea: 'core',
        optional: false,
        minWidth: 6,
        minHeight: 5,
        maxWidth: 18,
        maxHeight: 12,
        config: { variant: 'core', visualKey: blueprint.visualKey },
      },
      {
        id: `${blueprint.id}-trend`,
        type: 'echart',
        dataSourceKey: blueprint.metricKey,
        layoutArea: 'trend',
        optional: true,
        minWidth: 3,
        minHeight: 3,
        maxWidth: 12,
        maxHeight: 8,
        config: { variant: 'trend' },
      },
      {
        id: `${blueprint.id}-ranking`,
        type: 'ranking-table',
        dataSourceKey: blueprint.metricKey,
        layoutArea: 'ranking',
        optional: true,
        minWidth: 3,
        minHeight: 3,
        maxWidth: 12,
        maxHeight: 8,
        config: { variant: 'ranking' },
      },
      {
        id: `${blueprint.id}-health`,
        type: 'status-matrix',
        dataSourceKey: blueprint.metricKey,
        layoutArea: 'health',
        optional: false,
        minWidth: 2,
        minHeight: 1,
        maxWidth: 8,
        maxHeight: 3,
        config: { variant: 'health' },
      },
    ],
    filters: [{ key: 'dateRange', type: 'date-range', required: false }],
    interactions: createMetricInteractions(blueprint.systemKey),
    refreshPolicy: {
      mode: blueprint.refreshMode,
      intervalMs: blueprint.refreshMode === 'sse' ? 10000 : 60000,
    },
  }
}

export const screenCatalog = ScreenTemplateSchema.array().parse(
  templateBlueprints.map(createTemplate),
)
