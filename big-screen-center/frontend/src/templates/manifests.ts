import type {
  RegisteredWidgetType,
  ScreenTemplate,
  SystemKey,
  WidgetDefinition,
} from '../types'

type RefreshMode = 'poll' | 'sse'

export const TEMPLATE_BLUEPRINTS = [
  ['sca-01', 'sca', '全域安全态势', 'security-overview', 'risk-globe', 'sse', 'three-scene', 'security-orbit'],
  ['sca-02', 'sca', '漏洞与威胁态势', 'vulnerability-threat', 'threat-radar', 'poll', 'echart', 'threat-radar'],
  ['sca-03', 'sca', '供应链资产图谱', 'supply-chain-graph', 'dependency-space', 'poll', 'three-scene', 'dependency-space'],
  ['sca-04', 'sca', '扫描运营中心', 'scan-operations', 'scan-pipeline', 'sse', 'three-scene', 'scan-pipeline'],
  ['sca-05', 'sca', '安全治理成果', 'security-governance', 'security-route', 'poll', 'echart', 'security-route'],
  ['train-01', 'train-exam', '培训运营总览', 'training-overview', 'course-galaxy', 'poll', 'three-scene', 'course-galaxy'],
  ['train-02', 'train-exam', '考试实时指挥', 'exam-command', 'exam-matrix', 'sse', 'status-matrix', 'exam-command'],
  ['train-03', 'train-exam', '组织能力画像', 'organization-capability', 'capability-terrain', 'poll', 'graph', 'capability-terrain'],
  ['train-04', 'train-exam', '培训成果汇报', 'training-outcomes', 'growth-stairway', 'poll', 'three-scene', 'growth-stairway'],
  ['remind-01', 'reminder', '授权到期风险态势', 'expiry-risk', 'expiry-orbit', 'poll', 'three-scene', 'expiry-orbit'],
  ['remind-02', 'reminder', '提醒执行与触达', 'delivery-execution', 'message-network', 'sse', 'graph', 'message-network'],
  ['remind-03', 'reminder', '客户与销售经营', 'customer-sales', 'customer-map', 'poll', 'map', 'customer-map'],
] as const satisfies ReadonlyArray<
  readonly [
    string,
    SystemKey,
    string,
    string,
    string,
    RefreshMode,
    RegisteredWidgetType,
    string,
  ]
>

const layoutAreas = ['metrics', 'core', 'trend', 'ranking', 'health']

export const screenManifests: ScreenTemplate[] = TEMPLATE_BLUEPRINTS.map(
  ([id, systemKey, name, metricKey, visualKey, refreshMode, coreType, themeKey]) => {
    const widgets: WidgetDefinition[] = [
      {
        id: `${id}-metrics`,
        type: 'metric-cards',
        dataSourceKey: metricKey,
        layoutArea: 'metrics',
        optional: false,
        minWidth: 3,
        minHeight: 2,
        maxWidth: 12,
        maxHeight: 4,
        config: { variant: 'metrics' },
      },
      {
        id: `${id}-core`,
        type: coreType,
        dataSourceKey: metricKey,
        layoutArea: 'core',
        optional: false,
        minWidth: 6,
        minHeight: 5,
        maxWidth: 18,
        maxHeight: 12,
        config: { variant: 'core', visualKey },
      },
      {
        id: `${id}-trend`,
        type: 'echart',
        dataSourceKey: metricKey,
        layoutArea: 'trend',
        optional: true,
        minWidth: 3,
        minHeight: 3,
        maxWidth: 12,
        maxHeight: 8,
        config: { variant: 'trend' },
      },
      {
        id: `${id}-ranking`,
        type: 'ranking-table',
        dataSourceKey: metricKey,
        layoutArea: 'ranking',
        optional: true,
        minWidth: 3,
        minHeight: 3,
        maxWidth: 12,
        maxHeight: 8,
        config: { variant: 'ranking' },
      },
      {
        id: `${id}-health`,
        type: 'status-matrix',
        dataSourceKey: metricKey,
        layoutArea: 'health',
        optional: false,
        minWidth: 2,
        minHeight: 1,
        maxWidth: 8,
        maxHeight: 3,
        config: { variant: 'health' },
      },
    ]

    return {
      id,
      systemKey,
      name,
      version: 1,
      themeKey,
      effectsProfile: 'high',
      layouts: {
        widescreen: { width: 1920, height: 1080, areas: [...layoutAreas] },
        ultrawide: { width: 3840, height: 1080, areas: [...layoutAreas] },
      },
      widgets,
      filters: [{ key: 'dateRange', type: 'date-range', required: false }],
      refreshPolicy: {
        mode: refreshMode,
        intervalMs: refreshMode === 'sse' ? 10000 : 60000,
      },
    }
  },
)
