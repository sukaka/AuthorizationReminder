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
    refreshPolicy: {
      mode: blueprint.refreshMode,
      intervalMs: blueprint.refreshMode === 'sse' ? 10000 : 60000,
    },
  }
}

export const screenCatalog = ScreenTemplateSchema.array().parse(
  templateBlueprints.map(createTemplate),
)
