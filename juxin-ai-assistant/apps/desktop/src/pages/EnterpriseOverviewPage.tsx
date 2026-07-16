import { useEffect, useState } from 'react';

import { ApiError } from '../api/client';
import {
  acknowledgeEnterpriseInsight,
  dismissEnterpriseInsight,
  getEnterpriseInsights,
  getEnterpriseNotifications,
  getEnterpriseOperationSummary,
  getEnterpriseOverview,
  markEnterpriseNotificationRead,
  exportEnterpriseManagementQuery,
  runEnterpriseManagementQuery,
  type EnterpriseInsight,
  type EnterpriseNotification,
  type EnterpriseOperationSection,
  type EnterpriseOperationSummaryPayload,
  type EnterpriseOverviewPayload,
  type EnterpriseQueryRequest,
  type EnterpriseQueryResult,
} from '../api/intelligence';

const metricLabels: Array<{ key: keyof EnterpriseOverviewPayload['metrics']; label: string; icon: string }> = [
  { key: 'projects', label: '参与项目', icon: '⌂' },
  { key: 'tasks', label: '项目任务', icon: '◆' },
  { key: 'deliverables', label: '交付成果', icon: '▤' },
  { key: 'open_issues', label: '待处理问题', icon: '!' },
  { key: 'artifacts', label: '工作产物', icon: '✦' },
];

const contractMetricLabels: Record<string, string> = {
  active_project_count: '活跃项目数',
  overdue_task_rate: '超期任务率',
  approved_deliverable_rate: '成果通过率',
};

const healthStatusLabels: Record<string, string> = {
  healthy: '健康',
  attention: '需关注',
  high_risk: '高风险',
  data_incomplete: '数据不完整',
};

const insightSeverityLabels: Record<string, string> = {
  low: '低优先级',
  medium: '需要关注',
  high: '高优先级',
  critical: '立即关注',
};

const operationSectionLabels: Array<{ key: keyof Pick<EnterpriseOperationSummaryPayload, 'contracts' | 'services' | 'tasks' | 'deliverables' | 'issues'>; label: string; icon: string }> = [
  { key: 'contracts', label: '合同', icon: '◫' },
  { key: 'services', label: '服务履约', icon: '◌' },
  { key: 'tasks', label: '任务', icon: '◆' },
  { key: 'deliverables', label: '交付成果', icon: '▤' },
  { key: 'issues', label: '问题与整改', icon: '!' },
];

const managementQueryPresets: Array<{
  key: string;
  label: string;
  description: string;
  intent: EnterpriseQueryRequest['intent'];
  metrics: string[];
  group_by: string[];
}> = [
  {
    key: 'project-health',
    label: '项目健康度对比',
    description: '按当前可见项目列出健康分和风险状态',
    intent: 'compare_project_health',
    metrics: ['project_health_score'],
    group_by: ['project'],
  },
  {
    key: 'overdue-rate',
    label: '逾期任务率',
    description: '查看当前范围在选定周期内的逾期任务比例',
    intent: 'metric_summary',
    metrics: ['overdue_task_rate'],
    group_by: [],
  },
  {
    key: 'deliverable-rate',
    label: '成果通过率',
    description: '查看当前范围内正式成果的通过情况',
    intent: 'metric_summary',
    metrics: ['approved_deliverable_rate'],
    group_by: [],
  },
  {
    key: 'active-projects',
    label: '活跃项目数',
    description: '统计当前访问范围内的活跃项目',
    intent: 'metric_summary',
    metrics: ['active_project_count'],
    group_by: [],
  },
];

const queryMetricLabels: Record<string, string> = {
  active_project_count: '活跃项目数',
  overdue_task_rate: '逾期任务率',
  approved_deliverable_rate: '成果通过率',
  project_health_score: '项目健康分',
};

function queryDateRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function formatQueryMetric(metricCode: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return '暂无数据';
  if (metricCode.endsWith('_rate')) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? value.toLocaleString('zh-CN') : value.toFixed(1);
}

function formatMetricValue(metricCode: string, value: number | null): string {
  if (value === null) return '暂无';
  if (metricCode.endsWith('_rate')) return `${(value * 100).toFixed(1)}%`;
  return value.toLocaleString('zh-CN');
}

function formatMetricBasis(numerator: number, denominator: number | null): string {
  return denominator === null ? `共 ${numerator.toLocaleString('zh-CN')} 条记录` : `${numerator} / ${denominator}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '时间未知'
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function insightSeverityClass(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'enterprise-insight-severity-danger';
  if (severity === 'medium') return 'enterprise-insight-severity-warning';
  return 'enterprise-insight-severity-low';
}

function insightProjectLabel(insight: EnterpriseInsight): string {
  const projectUuid = insight.impact_scope.project_uuid;
  return typeof projectUuid === 'string' ? `项目 ${projectUuid}` : '企业工作范围';
}

function operationSectionBasis(key: string, section: EnterpriseOperationSection): string {
  if (key === 'contracts') return `${section.confirmed ?? 0} 已确认 · ${section.pending_confirmation ?? 0} 待确认`;
  if (key === 'services') return `${section.completed_occurrences ?? 0} 次已完成 · ${section.missing_occurrences ?? 0} 项缺记录`;
  if (key === 'tasks') return `${section.open ?? 0} 个未完成 · ${section.overdue ?? 0} 个逾期`;
  if (key === 'deliverables') return `${section.approved ?? 0} 个已通过 · ${section.pending ?? 0} 个待处理`;
  return `${section.open ?? 0} 个开放 · ${section.open_high_or_critical ?? 0} 个高风险`;
}

function operationSeverityClass(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'enterprise-insight-severity-danger';
  if (severity === 'medium') return 'enterprise-insight-severity-warning';
  return 'enterprise-insight-severity-low';
}

export function EnterpriseOverviewPage() {
  const [overview, setOverview] = useState<EnterpriseOverviewPayload | null>(null);
  const [insights, setInsights] = useState<EnterpriseInsight[]>([]);
  const [notifications, setNotifications] = useState<EnterpriseNotification[]>([]);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [operationSummary, setOperationSummary] = useState<EnterpriseOperationSummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [insightAction, setInsightAction] = useState<string | null>(null);
  const [insightActionError, setInsightActionError] = useState('');
  const [notificationAction, setNotificationAction] = useState<string | null>(null);
  const [notificationActionError, setNotificationActionError] = useState('');
  const [managementQuery, setManagementQuery] = useState<EnterpriseQueryResult | null>(null);
  const [managementQueryKey, setManagementQueryKey] = useState<string | null>(null);
  const [managementQueryLoading, setManagementQueryLoading] = useState(false);
  const [managementQueryError, setManagementQueryError] = useState('');
  const [managementQueryRequest, setManagementQueryRequest] = useState<EnterpriseQueryRequest | null>(null);
  const [managementExporting, setManagementExporting] = useState(false);
  const [managementExportMessage, setManagementExportMessage] = useState('');

  const refresh = () => {
    setLoading(true);
    setOperationSummary(null);
    Promise.all([getEnterpriseOverview(), getEnterpriseInsights()])
      .then(([payload, insightPayload]) => {
        setOverview(payload);
        setInsights(insightPayload.items);
        setError('');
        return Promise.all([
          getEnterpriseOperationSummary()
            .then((operationPayload) => setOperationSummary(operationPayload))
            .catch(() => setOperationSummary(null)),
          getEnterpriseNotifications(false, 20)
            .then((notificationPayload) => {
              setNotifications(notificationPayload.items);
              setNotificationUnreadCount(notificationPayload.unread_count);
              setNotificationActionError('');
            })
            .catch(() => setNotificationActionError('通知收件箱暂不可用，不影响总览查看。')),
        ]);
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 403) {
          setError('当前账号没有企业智能中枢访问权限。');
        } else {
          setError('企业数据暂时无法加载，请稍后重试。');
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const reviewInsight = (insight: EnterpriseInsight, action: 'acknowledge' | 'dismiss') => {
    setInsightAction(`${insight.uuid}:${action}`);
    setInsightActionError('');
    const request = action === 'acknowledge'
      ? acknowledgeEnterpriseInsight(insight.uuid, '已由企业智能中枢人工确认')
      : dismissEnterpriseInsight(insight.uuid, '已由企业智能中枢人工忽略');
    request
      .then((updated) => {
        setInsights((current) => updated.status === 'open'
          ? current.map((item) => item.uuid === updated.uuid ? updated : item)
          : current.filter((item) => item.uuid !== updated.uuid));
      })
      .catch(() => setInsightActionError('操作未完成，请检查权限后重试。'))
      .finally(() => setInsightAction(null));
  };

  const readNotification = (notification: EnterpriseNotification) => {
    setNotificationAction(notification.notification_uuid);
    setNotificationActionError('');
    markEnterpriseNotificationRead(notification.notification_uuid)
      .then((updated) => {
        setNotifications((current) => current.map((item) => item.notification_uuid === updated.notification_uuid
          ? updated
          : item));
        if (notification.unread && !updated.unread) {
          setNotificationUnreadCount((count) => Math.max(0, count - 1));
        }
      })
      .catch(() => setNotificationActionError('通知状态未更新，请稍后重试。'))
      .finally(() => setNotificationAction(null));
  };

  const runManagementQuery = (preset: typeof managementQueryPresets[number]) => {
    const period = queryDateRange();
    setManagementQueryKey(preset.key);
    setManagementQueryLoading(true);
    setManagementQueryError('');
    setManagementExportMessage('');
    setManagementQuery(null);
    const queryRequest: EnterpriseQueryRequest = {
      intent: preset.intent,
      scope: { project_uuids: [], department_ids: [] },
      period,
      metrics: preset.metrics,
      filters: [],
      group_by: preset.group_by,
      limit: 20,
    };
    setManagementQueryRequest(queryRequest);
    runEnterpriseManagementQuery(queryRequest)
      .then(setManagementQuery)
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 403) {
          setManagementQueryError('当前账号没有管理问答访问权限。');
        } else {
          setManagementQueryError('查询未完成，请稍后重试。');
        }
      })
      .finally(() => setManagementQueryLoading(false));
  };

  const exportManagementQuery = () => {
    if (!managementQueryRequest || managementExporting) return;
    setManagementExporting(true);
    setManagementExportMessage('');
    exportEnterpriseManagementQuery(managementQueryRequest)
      .then((fileName) => setManagementExportMessage(`已导出：${fileName}`))
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 403) {
          setManagementExportMessage('当前账号没有导出权限。');
        } else {
          setManagementExportMessage('导出未完成，请稍后重试。');
        }
      })
      .finally(() => setManagementExporting(false));
  };

  if (loading && !overview) {
    return <section className="enterprise-overview-state" aria-busy="true"><span className="status-orb" /><p>正在整理你的企业工作范围…</p></section>;
  }

  if (error && !overview) {
    return <section className="enterprise-overview-state"><span className="status-symbol">!</span><h2>企业中枢暂不可用</h2><p>{error}</p><button className="primary-action" onClick={refresh} type="button">重新加载</button></section>;
  }

  if (!overview) return null;

  const scope = overview.scope;
  const qualityStatus = overview.data_quality.status === 'complete' ? '完整' : '部分数据';
  return (
    <div className="enterprise-overview-page">
      <header className="enterprise-overview-header">
        <div>
          <span className="enterprise-overview-kicker">ENTERPRISE INTELLIGENCE</span>
          <h1>企业智能中枢</h1>
          <p>把你有权访问的项目、任务、成果和风险聚合到一个可追溯的工作视图中。</p>
        </div>
        <div className="enterprise-scope-chip" title={`策略指纹：${scope.scope_fingerprint}`}>
          <span className="presence-dot" />
          <span><strong>{scope.department || '个人工作范围'}</strong><small>{scope.role} · {scope.project_count} 个项目</small></span>
        </div>
      </header>

      <section className="enterprise-metrics" aria-label="企业工作指标">
        {metricLabels.map((metric) => (
          <article className="enterprise-metric-card" key={metric.key}>
            <span className="enterprise-metric-icon" aria-hidden="true">{metric.icon}</span>
            <div><small>{metric.label}</small><strong>{overview.metrics[metric.key]}</strong></div>
          </article>
        ))}
      </section>

      <section className="enterprise-panel enterprise-operation-panel" aria-label="运营执行情况">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">OPERATIONS COCKPIT</span><h2>运营执行情况</h2></div>
          <span className={`enterprise-badge ${operationSummary?.attention_items.length ? 'enterprise-badge-warning' : ''}`}>
            {operationSummary ? (operationSummary.attention_items.length ? `${operationSummary.attention_items.length} 项需处理` : '运行平稳') : '加载中'}
          </span>
        </div>
        {operationSummary ? (
          <>
            <div className="enterprise-operation-grid">
              {operationSectionLabels.map(({ key, label, icon }) => {
                const section = operationSummary[key];
                return (
                  <article className="enterprise-operation-card" key={key}>
                    <span className="enterprise-operation-icon" aria-hidden="true">{icon}</span>
                    <div><small>{label}</small><strong>{section.total.toLocaleString('zh-CN')}</strong><span>{operationSectionBasis(key, section)}</span></div>
                  </article>
                );
              })}
              <article className="enterprise-operation-card enterprise-operation-card-automation">
                <span className="enterprise-operation-icon" aria-hidden="true">↻</span>
                <div><small>自动流程</small><strong>{operationSummary.automation.total.toLocaleString('zh-CN')}</strong><span>{operationSummary.automation.failed} 失败 · {operationSummary.automation.active} 运行中</span></div>
              </article>
            </div>
            {operationSummary.attention_items.length ? (
              <div className="enterprise-operation-attention">
                <div className="enterprise-operation-attention-heading"><strong>数据层关注</strong><small>来源于任务、履约、问题和自动流程的只读汇总</small></div>
                <div className="enterprise-operation-attention-list">
                  {operationSummary.attention_items.slice(0, 5).map((item) => (
                    <div className="enterprise-operation-attention-item" key={`${item.type}:${item.project_uuid}:${item.title}`}>
                      <span className={`enterprise-insight-severity ${operationSeverityClass(item.severity)}`}>{insightSeverityLabels[item.severity] || item.severity}</span>
                      <div><strong>{item.title}</strong><small>{item.project_name} · {item.summary}</small></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="enterprise-panel-note">当前范围内没有检测到逾期任务、履约缺口或高风险问题。</p>}
          </>
        ) : <p className="enterprise-panel-note">运营汇总暂不可用，不影响项目健康度和洞察查看。</p>}
      </section>

      <section className="enterprise-panel enterprise-query-panel" aria-label="管理问答">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">CONTROLLED MANAGEMENT Q&amp;A</span><h2>管理问答</h2></div>
          <span className="enterprise-badge">白名单查询</span>
        </div>
        <p className="enterprise-panel-note enterprise-query-intro">
          选择一个管理问题，系统只执行已注册的指标和当前访问范围内的只读查询；不会生成 SQL，也不会扩大数据权限。
        </p>
        <div className="enterprise-query-presets">
          {managementQueryPresets.map((preset) => (
            <button
              className={`enterprise-query-preset ${managementQueryKey === preset.key ? 'is-selected' : ''}`}
              disabled={managementQueryLoading}
              key={preset.key}
              onClick={() => runManagementQuery(preset)}
              type="button"
            >
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
            </button>
          ))}
        </div>
        {managementQueryLoading ? <p className="enterprise-query-status" role="status">正在按当前权限范围查询…</p> : null}
        {managementQueryError ? <p className="enterprise-panel-error" role="alert">{managementQueryError}</p> : null}
        {managementQuery ? (
          <div className="enterprise-query-result">
            <div className="enterprise-query-result-heading">
              <strong>查询结果</strong>
              <span>{managementQuery.plan.period.start} 至 {managementQuery.plan.period.end} · {managementQuery.rows.length} 行</span>
            </div>
            <div className="enterprise-query-result-actions">
              <button className="secondary-action" disabled={managementExporting} onClick={exportManagementQuery} type="button">
                {managementExporting ? '正在导出…' : '导出当前结果'}
              </button>
              {managementExportMessage ? <small className="enterprise-query-status" role="status">{managementExportMessage}</small> : null}
            </div>
            <div className="enterprise-query-result-list">
              {managementQuery.rows.length ? managementQuery.rows.map((row, index) => {
                const projectName = typeof row.group?.project_name === 'string' ? row.group.project_name : '当前访问范围';
                const metricEntries = Object.entries(row.metrics || {});
                return (
                  <div className="enterprise-query-result-row" key={`${projectName}-${index}`}>
                    <div><strong>{projectName}</strong>{row.status ? <span>{healthStatusLabels[row.status] || row.status}</span> : null}</div>
                    <div className="enterprise-query-result-values">
                      {metricEntries.map(([metricCode, value]) => <span key={metricCode}>{queryMetricLabels[metricCode] || metricCode} <strong>{formatQueryMetric(metricCode, value)}</strong></span>)}
                    </div>
                    <small>证据 {row.evidence_refs.length} 个</small>
                  </div>
                );
              }) : <p className="enterprise-panel-note">当前范围没有可返回的记录。</p>}
            </div>
            <small className="enterprise-query-trace">策略 {managementQuery.plan.policy_version} · 范围指纹 {managementQuery.plan.scope_fingerprint} · 汇总证据 {managementQuery.evidence_refs.length} 个</small>
          </div>
        ) : null}
      </section>

      <section className="enterprise-panel enterprise-contract-panel" aria-label="可追溯指标契约">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">METRIC CONTRACT</span><h2>可追溯指标</h2></div>
          <span className="enterprise-badge">口径锁定</span>
        </div>
        <div className="enterprise-contract-grid">
          {overview.metric_snapshots.map((snapshot) => (
            <article className="enterprise-contract-card" key={snapshot.metric_code}>
              <div className="enterprise-contract-card-heading">
                <span>{contractMetricLabels[snapshot.metric_code] || snapshot.metric_code}</span>
                <small>v{snapshot.definition_version}</small>
              </div>
              <strong>{formatMetricValue(snapshot.metric_code, snapshot.value)}</strong>
              <span className="enterprise-contract-basis">{formatMetricBasis(snapshot.numerator, snapshot.denominator)}</span>
              <div className="enterprise-contract-meta">
                <span>完整度 {Math.round(snapshot.data_completeness * 100)}%</span>
                <span>{snapshot.freshness === 'fresh' ? '实时' : '需刷新'}</span>
              </div>
              <p>{snapshot.reason || `证据 ${snapshot.evidence_refs.length} 个 · 截止 ${formatTime(snapshot.data_cutoff_at)}`}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="enterprise-panel enterprise-health-panel" aria-label="项目健康度">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">PROJECT HEALTH</span><h2>项目健康度</h2></div>
          <span className="enterprise-badge">规则 {overview.project_health[0]?.rule_version || '未配置'}</span>
        </div>
        {overview.project_health.length ? (
          <div className="enterprise-health-grid">
            {overview.project_health.map((project) => (
              <article className="enterprise-health-card" key={project.project_uuid}>
                <div className="enterprise-health-card-heading">
                  <div><strong>{project.project_name}</strong><small>{project.project_uuid}</small></div>
                  <span className={`enterprise-health-status enterprise-health-status-${project.status}`}>
                    {healthStatusLabels[project.status] || project.status}
                  </span>
                </div>
                <div className="enterprise-health-score-row">
                  <strong>{project.score === null ? '—' : project.score}</strong>
                  <span>健康分 · 置信度 {Math.round(project.confidence * 100)}%</span>
                </div>
                <div className="enterprise-health-dimensions">
                  {project.dimensions.map((dimension) => (
                    <div className="enterprise-health-dimension" key={dimension.code}>
                      <span>{dimension.label}</span>
                      <strong>{dimension.score === null ? '缺失' : `${dimension.score}分`}</strong>
                    </div>
                  ))}
                </div>
                {project.deductions.length ? (
                  <div className="enterprise-health-deductions">
                    {project.deductions.map((deduction) => <span key={deduction.code} title={deduction.reason}>-{deduction.points} · {deduction.reason}</span>)}
                  </div>
                ) : <p className="enterprise-health-clear">当前没有可解释的扣分项。</p>}
                <small className="enterprise-health-as-of">截至 {formatTime(project.as_of)} · 规则 {project.rule_version}</small>
              </article>
            ))}
          </div>
        ) : <p className="enterprise-panel-note">当前范围内没有可计算的项目健康度。</p>}
      </section>

      <section className="enterprise-panel enterprise-insights-panel" aria-label="今日关注事项">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">TODAY'S ATTENTION</span><h2>今日关注事项</h2></div>
          <span className={`enterprise-badge ${insights.length ? 'enterprise-badge-warning' : ''}`}>{insights.length ? `${insights.length} 条待处理` : '暂无开放洞察'}</span>
        </div>
        {insights.length ? (
          <div className="enterprise-insights-list">
            {insights.slice(0, 6).map((insight) => (
              <article className="enterprise-insight-card" key={insight.uuid}>
                <div className="enterprise-insight-card-heading">
                  <div><strong>{insight.title}</strong><small>{insightProjectLabel(insight)} · {formatTime(insight.data_cutoff_at)}</small></div>
                  <span className={`enterprise-insight-severity ${insightSeverityClass(insight.severity)}`}>{insightSeverityLabels[insight.severity] || insight.severity}</span>
                </div>
                <p>{insight.summary}</p>
                <div className="enterprise-insight-meta"><span>置信度 {Math.round(insight.confidence * 100)}%</span><span>证据 {insight.evidence_refs.length} 个</span><span>规则 {insight.data_version}</span></div>
                <div className="enterprise-insight-actions">
                  <button
                    className="secondary-action"
                    disabled={Boolean(insightAction)}
                    onClick={() => reviewInsight(insight, 'acknowledge')}
                    type="button"
                  >
                    {insightAction === `${insight.uuid}:acknowledge` ? '处理中…' : '确认关注'}
                  </button>
                  <button
                    className="tertiary-action"
                    disabled={Boolean(insightAction)}
                    onClick={() => reviewInsight(insight, 'dismiss')}
                    type="button"
                  >
                    {insightAction === `${insight.uuid}:dismiss` ? '处理中…' : '忽略洞察'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="enterprise-panel-note">扫描到的洞察会先经过证据核对，再进入建议动作和人工审批，不会自动修改业务事实。</p>}
        {insightActionError ? <p className="enterprise-panel-error" role="alert">{insightActionError}</p> : null}
      </section>

      <section className="enterprise-panel enterprise-notifications-panel" aria-label="通知收件箱">
        <div className="enterprise-panel-heading">
          <div><span className="enterprise-panel-kicker">NOTIFICATION INBOX</span><h2>通知收件箱</h2></div>
          <span className={`enterprise-badge ${notificationUnreadCount ? 'enterprise-badge-warning' : ''}`}>
            {notificationUnreadCount ? `${notificationUnreadCount} 条未读` : '暂无未读'}
          </span>
        </div>
        {notifications.length ? (
          <div className="enterprise-notifications-list">
            {notifications.slice(0, 6).map((notification) => (
              <article className={`enterprise-notification-card ${notification.unread ? 'is-unread' : ''}`} key={notification.notification_uuid}>
                <div className="enterprise-notification-card-heading">
                  <div><strong>{notification.title}</strong><small>{notification.project_uuid ? `项目 ${notification.project_uuid}` : '企业工作范围'} · {formatTime(notification.created_at || notification.data_cutoff_at)}</small></div>
                  <span className={`enterprise-insight-severity ${insightSeverityClass(notification.severity)}`}>{insightSeverityLabels[notification.severity] || notification.severity}</span>
                </div>
                <p>{notification.summary}</p>
                <div className="enterprise-notification-meta"><span>{notification.delivery_status === 'sent' ? '已送达' : notification.delivery_status}</span><span>尝试 {notification.attempts} 次</span><span>规则 {notification.data_version}</span></div>
                <div className="enterprise-notification-actions">
                  {notification.unread ? (
                    <button
                      className="secondary-action"
                      disabled={Boolean(notificationAction)}
                      onClick={() => readNotification(notification)}
                      type="button"
                    >
                      {notificationAction === notification.notification_uuid ? '处理中…' : '标记已读'}
                    </button>
                  ) : <span className="enterprise-notification-read-state">已读</span>}
                </div>
              </article>
            ))}
          </div>
        ) : <p className="enterprise-panel-note">暂无企业洞察通知。周期扫描产生的新提醒会在这里保留可追溯的送达和已读状态。</p>}
        {notificationActionError ? <p className="enterprise-panel-error" role="alert">{notificationActionError}</p> : null}
      </section>

      <div className="enterprise-overview-grid">
        <section className="enterprise-panel">
          <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">SCOPE</span><h2>当前数据范围</h2></div><span className="enterprise-badge">只读</span></div>
          <dl className="enterprise-scope-list">
            <div><dt>访问主体</dt><dd>{scope.user_id}</dd></div>
            <div><dt>部门范围</dt><dd>{scope.managed_departments.length ? scope.managed_departments.join('、') : '未配置部门范围'}</dd></div>
            <div><dt>可见项目</dt><dd>{scope.project_count} 个 · 已按成员关系过滤</dd></div>
            <div><dt>权限策略</dt><dd>{scope.policy_version}</dd></div>
          </dl>
          <p className="enterprise-panel-note">企业中枢只读取现有项目工作表，不会因为聚合展示而扩大原有项目权限。</p>
        </section>

        <section className="enterprise-panel">
          <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">DATA QUALITY</span><h2>数据质量与新鲜度</h2></div><span className="enterprise-badge enterprise-badge-warning">{qualityStatus}</span></div>
          <div className="enterprise-freshness"><strong>{overview.freshness.is_stale ? '需要刷新' : '实时查询'}</strong><span>截至 {formatTime(overview.freshness.as_of)}</span></div>
          <p className="enterprise-panel-note">{overview.data_quality.explanation}</p>
          <div className="enterprise-gap-list">{overview.data_quality.gaps.map((gap) => <span key={gap}>{gap.replaceAll('_', ' ')}</span>)}</div>
          <button className="secondary-action" onClick={refresh} type="button">刷新总览</button>
        </section>
      </div>

      <section className="enterprise-next-step">
        <div><span className="enterprise-panel-kicker">NEXT STEP</span><h2>继续处理你的项目工作</h2><p>总览负责发现重点，项目工作空间负责深入处理任务、成果、问题和项目资料。</p></div>
        <span className="enterprise-next-step-arrow" aria-hidden="true">→</span>
      </section>
    </div>
  );
}
