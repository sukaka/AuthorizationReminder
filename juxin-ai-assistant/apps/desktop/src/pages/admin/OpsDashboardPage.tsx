import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  controlOpsRun,
  getOpsFeatureFlags,
  getOpsCostSummary,
  getOpsGaReport,
  getOpsReadiness,
  getOpsSecurityAudit,
  getOpsSnapshot,
  getOpsRunReconciliation,
  getOpsRunDetail,
  getAgentHubHealth,
  listAgentMarket,
  listLearningCandidates,
  runCheckpointSuite,
  runGaOfflineSuite,
  transitionLearningCandidate,
  updateOpsFeatureFlags,
  type CheckpointSuitePayload,
  type CostSummaryPayload,
  type GaReportPayload,
  type LearningCandidatePayload,
  type OpsSnapshotPayload,
  type OpsRunAction,
  type OpsRunDetailPayload,
  type ReadinessPayload,
  type RunReconciliationPayload,
  type SecurityAuditPayload,
} from '../../api/client';
import { AdminPageState, RequestNotice } from './AdminPageState';

function pct(rate: number): string {
  return `${Math.round((rate || 0) * 1000) / 10}%`;
}

function overallLabel(overall: string): string {
  if (overall === 'ready') return '可发布（代理指标全通过）';
  if (overall === 'partial') return '部分达标（有未计量项）';
  if (overall === 'blocked') return '未达门禁（存在失败项）';
  return '未就绪';
}

function statusLabel(status: string): string {
  if (status === 'pass') return '通过';
  if (status === 'fail') return '未通过';
  if (status === 'pass_with_gaps') return '有未观测项';
  if (status === 'not_observed') return '未观测';
  if (status === 'unavailable') return '不可用';
  return '待计量';
}

function statusColor(status: string): string {
  if (status === 'pass') return '#0d7a3f';
  if (status === 'fail') return '#b42318';
  return '#667085';
}

function formatMetricValue(item: GaReportPayload['items'][number]): string {
  if (item.value === null || item.value === undefined) return '—';
  if (item.unit === 'ratio') return pct(item.value);
  return String(item.value);
}

function formatSloValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function opsRequestError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const payload = error.payload;
  if (typeof payload === 'object' && payload !== null && 'detail' in payload) {
    const detail = String((payload as { detail?: unknown }).detail || '').trim();
    if (detail) return detail;
  }
  return error.code;
}

type WeComChannelKey = 'wecom' | 'wecom_kf';

const weComChannels: Array<{ key: WeComChannelKey; label: string; description: string }> = [
  { key: 'wecom', label: '企业微信', description: '企业内部应用消息通道' },
  { key: 'wecom_kf', label: '企业微信客服', description: '微信客服外部问答通道' },
];

export function OpsDashboardPage() {
  const [snapshot, setSnapshot] = useState<OpsSnapshotPayload | null>(null);
  const [runReconciliation, setRunReconciliation] = useState<RunReconciliationPayload | null>(null);
  const [ga, setGa] = useState<GaReportPayload | null>(null);
  const [cost, setCost] = useState<CostSummaryPayload | null>(null);
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [security, setSecurity] = useState<SecurityAuditPayload | null>(null);
  const [hubHealth, setHubHealth] = useState<{
    overall: string;
    healthy: number;
    total: number;
    items: Array<Record<string, unknown>>;
  } | null>(null);
  const [checkpointSuite, setCheckpointSuite] = useState<CheckpointSuitePayload | null>(null);
  const [market, setMarket] = useState<Array<Record<string, unknown>>>([]);
  const [flags, setFlags] = useState<Record<string, unknown> | null>(null);
  const [candidates, setCandidates] = useState<LearningCandidatePayload[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [suiteBusy, setSuiteBusy] = useState(false);
  const [rollout, setRollout] = useState(100);
  const [runId, setRunId] = useState('');
  const [runDetail, setRunDetail] = useState<OpsRunDetailPayload | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [channelSaving, setChannelSaving] = useState<WeComChannelKey | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [snap, runRecon, flagBody, cand, gaReport, costBody, marketBody, ready, sec, hub] =
        await Promise.all([
          getOpsSnapshot(),
          getOpsRunReconciliation().catch(() => null),
          getOpsFeatureFlags(),
          listLearningCandidates().catch(() => ({ items: [], total: 0 })),
          getOpsGaReport().catch(() => null),
          getOpsCostSummary().catch(() => null),
          listAgentMarket().catch(() => ({ items: [], total: 0 })),
          getOpsReadiness().catch(() => null),
          getOpsSecurityAudit().catch(() => null),
          getAgentHubHealth().catch(() => null),
        ]);
      setSnapshot(snap);
      setRunReconciliation(runRecon);
      setFlags(flagBody);
      setRollout(Number(flagBody.rollout_percent ?? 100) || 100);
      setCandidates(cand.items || []);
      setGa(gaReport);
      setCost(costBody);
      setMarket(marketBody.items || []);
      setReadiness(ready);
      setSecurity(sec);
      setHubHealth(hub);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '加载运营看板失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onTransition(id: string, status: string) {
    setNotice('');
    setError('');
    try {
      await transitionLearningCandidate(id, status);
      setNotice(`已更新候选状态为 ${status}`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '状态流转失败');
    }
  }

  async function onToggleWeComChannel(channel: WeComChannelKey, label: string) {
    if (!flags || channelSaving) return;
    const channels = (flags.channels as Record<string, boolean> | undefined) || {};
    const enabled = !Boolean(channels[channel]);
    setNotice('');
    setError('');
    setChannelSaving(channel);
    try {
      const next = await updateOpsFeatureFlags({ channels: { [channel]: enabled } });
      setFlags(next);
      setNotice(`${label}通道已${enabled ? '启用' : '停用'}，立即生效`);
    } catch (err) {
      setError(opsRequestError(err, `${label}通道保存失败`));
    } finally {
      setChannelSaving(null);
    }
  }

  async function loadRunDetail() {
    const selectedRunId = runId.trim();
    if (!selectedRunId) {
      setError('请输入 Run ID');
      return;
    }
    setRunBusy(true);
    setError('');
    setNotice('');
    setRunDetail(null);
    try {
      setRunId(selectedRunId);
      setRunDetail(await getOpsRunDetail(selectedRunId));
    } catch (err) {
      setError(opsRequestError(err, '查询任务失败'));
    } finally {
      setRunBusy(false);
    }
  }

  async function onRunControl(action: OpsRunAction) {
    if (!runDetail) return;
    const selectedRunId = runDetail.run.run_id;
    setRunBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await controlOpsRun(selectedRunId, action);
      const refreshed = await getOpsRunDetail(selectedRunId).catch(() => null);
      setRunDetail(refreshed ?? { ...runDetail, run: response.run });
      if (action === 'rollback') {
        setNotice('已回滚到最近安全检查点；已发生的外部副作用不会被撤销，请按回执对账。');
      } else {
        setNotice(action === 'pause' ? '任务已暂停。' : '任务已恢复。');
      }
    } catch (err) {
      setError(opsRequestError(err, '任务控制失败'));
    } finally {
      setRunBusy(false);
    }
  }

  if (loading && !snapshot) {
    return <AdminPageState title="运营看板" description="加载中…" />;
  }

  return (
    <section className="admin-panel">
      <header className="admin-panel__header">
        <div>
          <h2>6.0 运营看板</h2>
          <p>对照主方案 §8.1 发布门禁：任务质量、灰度与学习候选（管理员）。</p>
        </div>
        <button type="button" onClick={() => void reload()}>
          刷新
        </button>
      </header>
      {error ? <RequestNotice message={error} /> : null}
      {notice ? <RequestNotice message={notice} /> : null}

      {readiness ? (
        <div
          style={{
            marginBottom: 16,
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 10,
            padding: 14,
            background:
              readiness.overall === 'ready'
                ? 'rgba(13,122,63,0.06)'
                : readiness.overall === 'not_ready'
                  ? 'rgba(180,35,24,0.06)'
                  : 'var(--panel-muted, #f6f7f9)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>一键就绪检查</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                状态：<strong>{readiness.overall}</strong>
                {' · '}通过 {readiness.pass_count} / 警告 {readiness.warn_count} / 失败{' '}
                {readiness.fail_count}
                {' · '}{readiness.elapsed_ms} ms
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.8 }}>{readiness.recommendation}</p>
            </div>
            <button type="button" className="secondary-action" onClick={() => void reload()}>
              重新检查
            </button>
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {readiness.checks.map((c) => (
              <li key={c.id} style={{ color: statusColor(c.status === 'warn' ? 'unknown' : c.status) }}>
                [{c.status}] {c.name}
                {c.detail ? ` — ${c.detail}` : ''}
                {c.latency_ms != null ? ` (${c.latency_ms}ms)` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {security || hubHealth ? (
        <div
          style={{
            marginBottom: 16,
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          }}
        >
          {security ? (
            <div
              style={{
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 10,
                padding: 14,
                background:
                  security.overall === 'pass'
                    ? 'rgba(13,122,63,0.06)'
                    : security.overall === 'fail'
                      ? 'rgba(180,35,24,0.06)'
                      : 'var(--panel-muted, #f6f7f9)',
              }}
            >
              <h3 style={{ margin: 0 }}>安全与特权审计</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13 }}>
                状态：<strong>{security.overall}</strong>
                {' · '}通过 {security.pass_count} / 警告 {security.warn_count} / 失败{' '}
                {security.fail_count}
              </p>
              <p style={{ margin: '4px 0 8px', fontSize: 12, opacity: 0.8 }}>
                {security.recommendation}
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {security.checks.map((c) => (
                  <li
                    key={c.id}
                    style={{ color: statusColor(c.status === 'warn' ? 'unknown' : c.status) }}
                  >
                    [{c.category}] {c.name}
                    {c.detail ? ` — ${c.detail}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {hubHealth ? (
            <div
              style={{
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <h3 style={{ margin: 0 }}>Agent Hub 健康</h3>
              <p style={{ margin: '6px 0 8px', fontSize: 13 }}>
                状态：<strong>{hubHealth.overall}</strong>
                {' · '}
                {hubHealth.healthy}/{hubHealth.total} 健康
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {hubHealth.items.map((item) => (
                  <li key={String(item.agent_id)}>
                    {String(item.agent_id)} · {String(item.status || (item.ok ? 'ok' : 'down'))}
                    {item.circuit_state ? ` · circuit=${String(item.circuit_state)}` : ''}
                    {item.latency_ms != null ? ` · ${String(item.latency_ms)}ms` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {ga ? (
        <div
          style={{
            marginBottom: 20,
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 10,
            padding: 16,
            background:
              ga.overall === 'ready'
                ? 'rgba(13,122,63,0.06)'
                : ga.overall === 'blocked'
                  ? 'rgba(180,35,24,0.06)'
                  : 'var(--panel-muted, #f6f7f9)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>GA 发布门禁</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, opacity: 0.85 }}>
                状态：<strong>{overallLabel(ga.overall)}</strong>
                {' · '}
                通过 {ga.summary.passed} / 未通过 {ga.summary.failed} / 待计量 {ga.summary.unknown}
                （共 {ga.summary.total} 项，样本 {ga.summary.sample_limit}）
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary-action"
                disabled={suiteBusy}
                onClick={() => {
                  void (async () => {
                    setSuiteBusy(true);
                    setError('');
                    try {
                      const suite = await runGaOfflineSuite();
                      const rates = (suite.ga_rates || {}) as Record<string, number | null>;
                      setNotice(
                        `离线评测完成：引用 ${rates.citation_accuracy ?? '—'} · 拒答 ${rates.no_evidence_refusal_rate ?? '—'}`,
                      );
                      await reload();
                    } catch (err) {
                      setError(err instanceof ApiError ? err.code : '离线评测失败');
                    } finally {
                      setSuiteBusy(false);
                    }
                  })();
                }}
              >
                {suiteBusy ? '运行中…' : '运行离线评测'}
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={suiteBusy}
                onClick={() => {
                  void (async () => {
                    setSuiteBusy(true);
                    setError('');
                    try {
                      const suite = await runCheckpointSuite(12);
                      setCheckpointSuite(suite);
                      setNotice(
                        `Checkpoint 套件：${suite.recovered}/${suite.total} 恢复 · rate=${suite.recovery_rate} · ${
                          suite.passed ? '通过' : '未通过'
                        }`,
                      );
                      await reload();
                    } catch (err) {
                      setError(err instanceof ApiError ? err.code : 'Checkpoint 套件失败');
                    } finally {
                      setSuiteBusy(false);
                    }
                  })();
                }}
              >
                {suiteBusy ? '运行中…' : 'Checkpoint 恢复套件'}
              </button>
            </div>
          </div>
          {checkpointSuite ? (
            <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.85 }}>
              最近 checkpoint 套件：{checkpointSuite.recovered}/{checkpointSuite.total} · rate{' '}
              {checkpointSuite.recovery_rate}（目标 ≥ {checkpointSuite.target}）·{' '}
              <strong style={{ color: checkpointSuite.passed ? '#0d7a3f' : '#b42318' }}>
                {checkpointSuite.passed ? '通过' : '未通过'}
              </strong>
            </p>
          ) : null}
          <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                <th style={{ padding: '8px 4px' }}>指标</th>
                <th style={{ padding: '8px 4px' }}>门槛</th>
                <th style={{ padding: '8px 4px' }}>实测</th>
                <th style={{ padding: '8px 4px' }}>结论</th>
                <th style={{ padding: '8px 4px' }}>说明</th>
              </tr>
            </thead>
            <tbody>
              {ga.items.map((item) => (
                <tr key={item.key} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                  <td style={{ padding: '8px 4px' }}>{item.name}</td>
                  <td style={{ padding: '8px 4px' }}>{item.target}</td>
                  <td style={{ padding: '8px 4px' }}>{formatMetricValue(item)}</td>
                  <td style={{ padding: '8px 4px', color: statusColor(item.status), fontWeight: 600 }}>
                    {statusLabel(item.status)}
                  </td>
                  <td style={{ padding: '8px 4px', opacity: 0.8 }}>{item.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ga.notes?.length ? (
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, opacity: 0.8 }}>
              {ga.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {snapshot ? (
        <div
          className="admin-stat-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}
        >
          <Stat label="Run 总数" value={snapshot.runs_total} />
          <Stat label="成功" value={snapshot.runs_succeeded} />
          <Stat label="失败" value={snapshot.runs_failed} />
          <Stat label="进行中" value={snapshot.runs_running} />
          <Stat label="成功率" value={pct(snapshot.success_rate)} />
          <Stat label="成果数" value={snapshot.artifacts_total} />
          <Stat label="FAQ 已发布" value={snapshot.faqs_published} />
          <Stat label="FAQ 草稿" value={snapshot.faqs_draft} />
          <Stat label="学习候选草稿" value={snapshot.learning_candidates_draft} />
          <Stat label="学习候选已发布" value={snapshot.learning_candidates_published} />
        </div>
      ) : null}

      <section
        aria-label="按 Run ID 控制"
        style={{
          marginTop: 20,
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 10,
          padding: 14,
        }}
      >
        <h3 style={{ margin: 0 }}>按 Run ID 控制任务</h3>
        <p style={{ margin: '6px 0 12px', fontSize: 12, opacity: 0.8 }}>
          查询单个任务的 Run / Step / Event 链路，并执行可审计的暂停、恢复或内部检查点回滚。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void loadRunDetail();
          }}
          style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}
        >
          <label style={{ display: 'grid', gap: 4, flex: '1 1 280px', fontSize: 12 }}>
            Run ID
            <input
              aria-label="Run ID"
              autoComplete="off"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            />
          </label>
          <button type="submit" disabled={runBusy || !runId.trim()}>
            {runBusy && !runDetail ? '查询中…' : '查询任务'}
          </button>
        </form>
        {runDetail ? (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            <p style={{ margin: 0 }}>
              <code>{runDetail.run.run_id}</code>
              {' · '}状态：{runDetail.run.status}
              {' · '}阶段：{runDetail.run.stage}
              {' · '}进度：{runDetail.run.progress}%
            </p>
            <p style={{ margin: '6px 0 0' }}>
              范围对账：{runDetail.reconciliation.overall === 'pass' ? '通过' : '发现不一致'}
              {' · '}Step {runDetail.steps.length} 个
              {' · '}Event {runDetail.events.length} 个
            </p>
            {runDetail.steps.length ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {runDetail.steps.map((step) => (
                  <li key={step.step_id || `${step.sequence}-${step.step_type}`}>
                    Step {step.sequence} · {step.step_type} · {step.status}
                  </li>
                ))}
              </ul>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={runBusy || !['running', 'waiting_confirmation'].includes(runDetail.run.status)}
                onClick={() => void onRunControl('pause')}
              >
                暂停任务
              </button>
              <button
                type="button"
                disabled={runBusy || runDetail.run.status !== 'paused'}
                onClick={() => void onRunControl('resume')}
              >
                恢复任务
              </button>
              <button
                type="button"
                disabled={runBusy || ['succeeded', 'completed', 'failed', 'cancelled'].includes(runDetail.run.status)}
                onClick={() => void onRunControl('rollback')}
              >
                回滚到安全检查点
              </button>
            </div>
            <p style={{ margin: '10px 0 0', color: '#b54708', fontSize: 12 }}>
              回滚只恢复内部安全检查点，不会撤销已发生的外部副作用；结果未知时必须先对账，禁止直接重发。
            </p>
          </div>
        ) : null}
      </section>

      {runReconciliation ? (
        <div
          style={{
            marginTop: 20,
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 10,
            padding: 14,
            background:
              runReconciliation.overall === 'pass'
                ? 'rgba(13,122,63,0.06)'
                : 'rgba(180,35,24,0.06)',
          }}
        >
          <h3 style={{ margin: 0 }}>Run / Step / Event 对账</h3>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            状态：<strong>{runReconciliation.overall === 'pass' ? '通过' : '发现不一致'}</strong>
            {' · '}扫描 {runReconciliation.scanned_runs} 个 Run
            {' · '}问题 {runReconciliation.issue_count} 个
          </p>
          {snapshot ? (
            <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.8 }}>
              连续观测快照：
              <strong
                style={{
                  color:
                    snapshot.run_reconciliation_overall === 'pass'
                      ? '#0d7a3f'
                      : snapshot.run_reconciliation_overall === 'fail'
                        ? '#b42318'
                        : undefined,
                }}
              >
                {snapshot.run_reconciliation_overall === 'pass'
                  ? '通过'
                  : snapshot.run_reconciliation_overall === 'fail'
                    ? '失败'
                    : '不可用'}
              </strong>
              {' · '}扫描 {snapshot.run_reconciliation_scanned_runs} 个 Run
              {' · '}问题 {snapshot.run_reconciliation_issue_count} 个
            </p>
          ) : null}
          {runReconciliation.issues.length ? (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12 }}>
              {runReconciliation.issues.slice(0, 20).map((issue, index) => (
                <li key={`${issue.run_id}-${issue.code}-${index}`}>
                  <strong>{issue.code}</strong> · {issue.entity} · {issue.run_id.slice(0, 8)} ·{' '}
                  {issue.detail}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: '10px 0 0', fontSize: 12, opacity: 0.8 }}>
              当前样本的状态、序号和终态回执一致。
            </p>
          )}
        </div>
      ) : null}

      {snapshot?.slo_audit ? (
        <div
          style={{
            marginTop: 20,
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 10,
            padding: 14,
            background:
              snapshot.slo_audit.overall === 'fail'
                ? 'rgba(180,35,24,0.06)'
                : snapshot.slo_audit.overall === 'pass'
                  ? 'rgba(13,122,63,0.06)'
                  : 'var(--panel-muted, #f6f7f9)',
          }}
        >
          <h3 style={{ margin: 0 }}>Agent Loop SLO 审计</h3>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            状态：
            <strong
              style={{
                color: statusColor(
                  snapshot.slo_audit.overall === 'pass_with_gaps'
                    ? 'unknown'
                    : snapshot.slo_audit.overall,
                ),
              }}
            >
              {statusLabel(snapshot.slo_audit.overall)}
            </strong>
            {' · '}硬失败 {snapshot.slo_audit.fail_count}
            {' · '}未观测 {snapshot.slo_audit.gap_count}
          </p>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12 }}>
            {snapshot.slo_audit.checks.map((check) => (
              <li key={check.id} style={{ color: statusColor(check.status === 'not_observed' ? 'unknown' : check.status) }}>
                [{statusLabel(check.status)}] {check.name}
                {' · 实际 '}{formatSloValue(check.actual)}
                {' / 阈值 '}{formatSloValue(check.threshold)}
                {check.detail ? ` — ${check.detail}` : ''}
              </li>
            ))}
          </ul>
          {snapshot.slo_audit.notes.length ? (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, opacity: 0.8 }}>
              {snapshot.slo_audit.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {cost ? (
        <div style={{ marginTop: 20 }}>
          <h3>Agent 成本与出域</h3>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 12 }}
          >
            <Stat label="调用次数" value={cost.calls_total} />
            <Stat label="成功" value={cost.calls_succeeded} />
            <Stat label="出域拦截" value={cost.calls_blocked} />
            <Stat label="成功率" value={cost.success_rate == null ? '—' : pct(cost.success_rate)} />
            <Stat label="总成本(µ)" value={cost.total_cost_micros} />
            <Stat label="平均延迟 ms" value={cost.avg_latency_ms} />
            <Stat label="出域审计" value={cost.egress_audits_total} />
            <Stat label="出域拒绝" value={cost.egress_denied} />
          </div>
          {cost.by_agent?.length ? (
            <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
                  <th style={{ padding: '6px 4px' }}>Agent</th>
                  <th style={{ padding: '6px 4px' }}>调用</th>
                  <th style={{ padding: '6px 4px' }}>成本(µ)</th>
                  <th style={{ padding: '6px 4px' }}>平均延迟</th>
                </tr>
              </thead>
              <tbody>
                {cost.by_agent.map((row) => (
                  <tr key={row.agent_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 4px' }}>{row.agent_id}</td>
                    <td style={{ padding: '6px 4px' }}>{row.calls}</td>
                    <td style={{ padding: '6px 4px' }}>{row.cost_micros}</td>
                    <td style={{ padding: '6px 4px' }}>{row.avg_latency_ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ fontSize: 13, opacity: 0.75 }}>暂无 Agent 调用记录。</p>
          )}
        </div>
      ) : null}

      {market.length ? (
        <div style={{ marginTop: 20 }}>
          <h3>Agent 市场（已安装）</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {market.map((item) => (
              <li
                key={String(item.agent_id)}
                style={{
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                <strong>{String(item.name || item.agent_id)}</strong>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {String(item.agent_id)} · {String(item.provider_name || item.provider_key)} ·{' '}
                  {String(item.status)} · 成本 {String(item.cost_per_call_micros ?? 0)} µ/次
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {flags ? (
        <div style={{ marginTop: 20 }}>
          <h3>功能开关 / 灰度</h3>
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            建议路径：管理员 → 5% → 20% → 50% → 全量（主方案 Phase 6）
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <label>
              放量比例{' '}
              <input
                type="number"
                min={0}
                max={100}
                value={rollout}
                onChange={(e) => setRollout(Number(e.target.value))}
                style={{ width: 72 }}
              />
              %
            </label>
            {[5, 20, 50, 100].map((n) => (
              <button
                key={n}
                type="button"
                className="secondary-action"
                onClick={() => setRollout(n)}
              >
                {n}%
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    const next = await updateOpsFeatureFlags({ rollout_percent: rollout });
                    setFlags(next);
                    setNotice(`灰度比例已保存为 ${rollout}%`);
                  } catch (err) {
                    setError(err instanceof ApiError ? err.code : '保存失败');
                  }
                })();
              }}
            >
              保存灰度
            </button>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    const channels = {
                      ...((flags.channels as Record<string, boolean>) || {}),
                      feishu: !Boolean((flags.channels as Record<string, boolean>)?.feishu),
                    };
                    const next = await updateOpsFeatureFlags({ channels });
                    setFlags(next);
                    setNotice('飞书通道开关已切换');
                  } catch (err) {
                    setError(err instanceof ApiError ? err.code : '保存失败');
                  }
                })();
              }}
            >
              切换飞书通道
            </button>
          </div>
          <div
            role="group"
            aria-label="企业微信通道开关"
            style={{
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 10,
              padding: 14,
              marginBottom: 12,
              background: 'var(--panel, #fff)',
            }}
          >
            <h4 style={{ margin: 0 }}>消息通道</h4>
            <p style={{ margin: '6px 0 12px', fontSize: 13, opacity: 0.8 }}>
              开关仅负责启停通道，保存后立即生效。App ID、Secret、Token 和加密密钥等凭据仅从服务器的 .env 读取；修改 .env 后需重启 API。
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {weComChannels.map((item) => {
                const channels = (flags.channels as Record<string, boolean> | undefined) || {};
                const configuration = (
                  (
                    flags.channel_configuration as Record<
                      string,
                      { configured?: boolean; missing?: string[] }
                    > | undefined
                  ) || {}
                )[item.key];
                const enabled = Boolean(channels[item.key]);
                const configured = Boolean(configuration?.configured);
                const canToggle = enabled || configured;
                const missingConfiguration = configuration?.missing || [];
                return (
                  <label
                    key={item.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      border: '1px solid var(--border, #e5e7eb)',
                      borderRadius: 8,
                      padding: '10px 12px',
                      cursor: channelSaving ? 'wait' : canToggle ? 'pointer' : 'not-allowed',
                      opacity: canToggle ? 1 : 0.78,
                    }}
                  >
                    <span>
                      <strong style={{ display: 'block' }}>{item.label}</strong>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 12, opacity: 0.72 }}>
                        {item.description} · {configured
                          ? '配置已就绪，可直接启用'
                          : `待补环境变量：${missingConfiguration.join('、') || '请检查服务器 .env'}`}
                      </span>
                      {!configured ? (
                        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--warning, #b54708)' }}>
                          请在服务器 .env 补齐后重启 API，再回来开启通道。
                        </span>
                      ) : null}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={item.label}
                      checked={enabled}
                      disabled={channelSaving !== null || !canToggle}
                      onChange={() => void onToggleWeComChannel(item.key, item.label)}
                    />
                  </label>
                );
              })}
            </div>
          </div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              background: 'var(--panel-muted, #f6f7f9)',
              padding: 12,
              borderRadius: 8,
            }}
          >
            {JSON.stringify(flags, null, 2)}
          </pre>
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <h3>学习候选审核</h3>
        {candidates.length === 0 ? (
          <p>暂无学习候选。</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {candidates.map((c) => (
              <li
                key={c.candidate_id}
                style={{
                  border: '1px solid var(--border, #e5e7eb)',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <strong>{c.title}</strong>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  {c.candidate_type} · {c.status} · {c.candidate_id.slice(0, 8)}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {c.status === 'draft' ? (
                    <button type="button" onClick={() => void onTransition(c.candidate_id, 'evaluated')}>
                      标记已评测
                    </button>
                  ) : null}
                  {c.status === 'evaluated' || c.status === 'staged' ? (
                    <button type="button" onClick={() => void onTransition(c.candidate_id, 'published')}>
                      发布
                    </button>
                  ) : null}
                  {c.status === 'published' ? (
                    <button type="button" onClick={() => void onTransition(c.candidate_id, 'rolled_back')}>
                      回滚
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
