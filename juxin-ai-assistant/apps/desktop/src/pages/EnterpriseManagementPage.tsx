import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { ApiError } from '../api/client';
import {
  createEnterpriseCapabilityEvaluation,
  createEnterpriseInsightSchedule,
  createEnterpriseOptimizationProposal,
  getEnterpriseCapabilityEvaluations,
  getEnterpriseAuditLogs,
  getEnterpriseInsightSchedules,
  getEnterpriseOptimizationProposals,
  getEnterpriseOrganizations,
  transitionEnterpriseOptimizationProposal,
  type EnterpriseCapabilityEvaluation,
  type EnterpriseAuditLog,
  type EnterpriseOptimizationProposal,
  type EnterpriseOrganization,
  type EnterpriseSchedule,
} from '../api/intelligence';

const capabilityTypes = [
  { value: 'skill', label: 'Skill' },
  { value: 'workflow', label: '工作流' },
  { value: 'template', label: '模板' },
  { value: 'model', label: '模型' },
];

function localDateTime(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string {
  return new Date(value).toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return '尚未计算';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatRate(value: number | null): string {
  return value === null ? '暂无' : `${(value * 100).toFixed(1)}%`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 403) return '当前账号没有企业智能管理权限。';
  if (error instanceof ApiError && error.status === 400) return '提交内容未通过校验，请检查时间窗口和计数。';
  return fallback;
}

export function EnterpriseManagementPage() {
  const [organizations, setOrganizations] = useState<EnterpriseOrganization[]>([]);
  const [organizationId, setOrganizationId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<EnterpriseSchedule[]>([]);
  const [evaluations, setEvaluations] = useState<EnterpriseCapabilityEvaluation[]>([]);
  const [proposals, setProposals] = useState<EnterpriseOptimizationProposal[]>([]);
  const [auditLogs, setAuditLogs] = useState<EnterpriseAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [notice, setNotice] = useState('');
  const [scheduleForm, setScheduleForm] = useState({
    name: '每日洞察扫描',
    cron_expression: '0 9 * * *',
    timezone: 'Asia/Shanghai',
    misfire_policy: 'fire_once',
    catch_up: false,
    source_version: 'project-task-v1',
    idempotency_prefix: 'enterprise-insight',
  });
  const [evaluationForm, setEvaluationForm] = useState({
    capability_type: 'skill',
    capability_key: '',
    capability_version: '1.0.0',
    period_start: localDateTime(-1),
    period_end: localDateTime(),
    data_cutoff_at: localDateTime(),
    sample_size: '10',
    success_count: '8',
    quality_pass_count: '8',
    quality_sample_size: '10',
    human_modified_count: '1',
    total_cost_micros: '0',
    total_latency_ms: '0',
    evidence_refs: '',
    source_version: 'runtime-ledger-v1',
    definition_version: '1.0.0',
  });
  const [proposalForm, setProposalForm] = useState({
    evaluation_uuid: '',
    title: '',
    rationale: '',
    proposed_change: '{\n  "action": "review_skill"\n}',
    risk_level: 'medium',
  });

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === organizationId) || null,
    [organizations, organizationId],
  );

  const loadOrganizations = async () => {
    setLoading(true);
    try {
      const payload = await getEnterpriseOrganizations();
      setOrganizations(payload.items);
      setOrganizationId((current) => current && payload.items.some((item) => item.id === current)
        ? current
        : payload.items[0]?.id || null);
      setNotice(payload.items.length ? '' : '当前没有可管理的组织范围。');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '组织范围暂时无法加载，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  };

  const loadOrganizationData = async (id: number) => {
    setLoading(true);
    try {
      const [schedulePayload, evaluationPayload, proposalPayload, auditPayload] = await Promise.all([
        getEnterpriseInsightSchedules(id),
        getEnterpriseCapabilityEvaluations(id),
        getEnterpriseOptimizationProposals(id),
        getEnterpriseAuditLogs(),
      ]);
      setSchedules(schedulePayload.items);
      setEvaluations(evaluationPayload.items);
      setProposals(proposalPayload.items);
      setAuditLogs(auditPayload.items);
      setProposalForm((current) => ({ ...current, evaluation_uuid: current.evaluation_uuid || evaluationPayload.items[0]?.uuid || '' }));
      setNotice('');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '组织管理数据暂时无法加载，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOrganizations(); }, []);

  useEffect(() => {
    if (organizationId !== null) void loadOrganizationData(organizationId);
  }, [organizationId]);

  const submitSchedule = async (event: FormEvent) => {
    event.preventDefault();
    if (organizationId === null) return;
    setAction('schedule');
    setNotice('');
    try {
      const created = await createEnterpriseInsightSchedule(organizationId, scheduleForm);
      setSchedules((current) => [created, ...current.filter((item) => item.schedule_uuid !== created.schedule_uuid)]);
      setNotice('洞察扫描计划已创建，执行范围已冻结。');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '洞察扫描计划创建失败。'));
    } finally { setAction(''); }
  };

  const submitEvaluation = async (event: FormEvent) => {
    event.preventDefault();
    if (organizationId === null) return;
    setAction('evaluation');
    setNotice('');
    try {
      const created = await createEnterpriseCapabilityEvaluation(organizationId, {
        ...evaluationForm,
        period_start: toIso(evaluationForm.period_start),
        period_end: toIso(evaluationForm.period_end),
        data_cutoff_at: toIso(evaluationForm.data_cutoff_at),
        sample_size: Number(evaluationForm.sample_size),
        success_count: Number(evaluationForm.success_count),
        quality_pass_count: Number(evaluationForm.quality_pass_count),
        quality_sample_size: Number(evaluationForm.quality_sample_size),
        human_modified_count: Number(evaluationForm.human_modified_count),
        total_cost_micros: Number(evaluationForm.total_cost_micros),
        total_latency_ms: Number(evaluationForm.total_latency_ms),
        evidence_refs: evaluationForm.evidence_refs.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      });
      setEvaluations((current) => [created, ...current.filter((item) => item.uuid !== created.uuid)]);
      setProposalForm((current) => ({ ...current, evaluation_uuid: created.uuid }));
      setNotice('能力评估已保存为固定窗口快照，可继续提交人工审核提案。');
    } catch (error: unknown) {
      setNotice(errorMessage(error, '能力评估保存失败。'));
    } finally { setAction(''); }
  };

  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    if (organizationId === null) return;
    setAction('proposal');
    setNotice('');
    try {
      const created = await createEnterpriseOptimizationProposal(organizationId, {
        evaluation_uuid: proposalForm.evaluation_uuid,
        title: proposalForm.title,
        rationale: proposalForm.rationale,
        proposed_change: JSON.parse(proposalForm.proposed_change) as Record<string, unknown>,
        risk_level: proposalForm.risk_level,
      });
      setProposals((current) => [created, ...current.filter((item) => item.uuid !== created.uuid)]);
      setProposalForm((current) => ({ ...current, title: '', rationale: '' }));
      setNotice('优化提案已进入草稿状态，未自动发布。');
    } catch (error: unknown) {
      setNotice(error instanceof SyntaxError ? '提案变更必须是合法 JSON。' : errorMessage(error, '优化提案创建失败。'));
    } finally { setAction(''); }
  };

  const transitionProposal = async (proposal: EnterpriseOptimizationProposal, nextAction: string) => {
    if (organizationId === null) return;
    setAction(`${proposal.uuid}:${nextAction}`);
    setNotice('');
    try {
      const result = await transitionEnterpriseOptimizationProposal(organizationId, proposal.uuid, nextAction, '企业智能管理工作台人工操作');
      setProposals((current) => current.map((item) => item.uuid === result.proposal.uuid ? result.proposal : item));
      setNotice(`提案已从 ${result.from_status} 变更为 ${result.to_status}。`);
    } catch (error: unknown) {
      setNotice(errorMessage(error, '提案状态变更失败，请刷新后重试。'));
    } finally { setAction(''); }
  };

  if (loading && !organizations.length) {
    return <section className="enterprise-management-state" aria-busy="true"><span className="status-orb" /><p>正在加载企业智能管理范围…</p></section>;
  }

  return (
    <div className="enterprise-management-page">
      <header className="enterprise-management-header">
        <div>
          <span className="enterprise-overview-kicker">ENTERPRISE CONTROL PLANE</span>
          <h1>企业智能管理</h1>
          <p>管理洞察扫描、能力评估和优化提案；所有执行范围由后端权限与冻结契约最终校验。</p>
        </div>
        <label className="enterprise-management-org-picker">管理组织
          <select aria-label="管理组织" value={organizationId ?? ''} onChange={(event) => setOrganizationId(Number(event.target.value) || null)}>
            {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.project_count} 个项目</option>)}
          </select>
        </label>
      </header>

      {notice ? <div className="enterprise-management-notice" role="status">{notice}</div> : null}
      {!selectedOrganization ? (
        <section className="enterprise-management-state"><span className="status-symbol">!</span><h2>暂无可管理组织</h2><p>后端没有返回当前账号可管理的活动组织。</p></section>
      ) : (
        <>
          <div className="enterprise-management-grid">
            <section className="enterprise-management-panel">
              <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">SCHEDULED SCAN</span><h2>洞察扫描计划</h2></div><span className="enterprise-badge">{schedules.length} 个计划</span></div>
              <form className="enterprise-management-form" onSubmit={(event) => void submitSchedule(event)}>
                <label>计划名称<input required value={scheduleForm.name} onChange={(event) => setScheduleForm({ ...scheduleForm, name: event.target.value })} /></label>
                <div className="enterprise-management-form-grid">
                  <label>Cron 表达式<input required value={scheduleForm.cron_expression} onChange={(event) => setScheduleForm({ ...scheduleForm, cron_expression: event.target.value })} /></label>
                  <label>时区<input required value={scheduleForm.timezone} onChange={(event) => setScheduleForm({ ...scheduleForm, timezone: event.target.value })} /></label>
                </div>
                <div className="enterprise-management-form-grid">
                  <label>错过策略<select value={scheduleForm.misfire_policy} onChange={(event) => setScheduleForm({ ...scheduleForm, misfire_policy: event.target.value })}><option value="fire_once">补发一次</option><option value="skip">跳过</option><option value="fire_all">全部补发</option></select></label>
                  <label>来源版本<input required value={scheduleForm.source_version} onChange={(event) => setScheduleForm({ ...scheduleForm, source_version: event.target.value })} /></label>
                </div>
                <label className="enterprise-management-checkbox"><input type="checkbox" checked={scheduleForm.catch_up} onChange={(event) => setScheduleForm({ ...scheduleForm, catch_up: event.target.checked })} />允许追赶漏执行</label>
                <button className="primary-action" disabled={action === 'schedule'} type="submit">{action === 'schedule' ? '创建中…' : '创建扫描计划'}</button>
              </form>
              <div className="enterprise-management-list">
                {schedules.length ? schedules.map((schedule) => <article className="enterprise-management-card" key={schedule.schedule_uuid}><div><strong>{schedule.name}</strong><small>{schedule.cron_expression} · {schedule.timezone}</small></div><span className={`enterprise-badge ${schedule.enabled ? '' : 'enterprise-badge-warning'}`}>{schedule.enabled ? '已启用' : '已停用'}</span><p>下次执行：{formatDate(schedule.next_fire_at)} · 范围指纹 {schedule.scope_fingerprint.slice(0, 12)}…</p></article>) : <p className="enterprise-management-empty">还没有扫描计划。</p>}
              </div>
            </section>

            <section className="enterprise-management-panel">
              <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">CAPABILITY EVALUATION</span><h2>能力评估快照</h2></div><span className="enterprise-badge">{evaluations.length} 个快照</span></div>
              <form className="enterprise-management-form" onSubmit={(event) => void submitEvaluation(event)}>
                <div className="enterprise-management-form-grid"><label>能力类型<select value={evaluationForm.capability_type} onChange={(event) => setEvaluationForm({ ...evaluationForm, capability_type: event.target.value })}>{capabilityTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label>能力标识<input required placeholder="例如 weekly-summary" value={evaluationForm.capability_key} onChange={(event) => setEvaluationForm({ ...evaluationForm, capability_key: event.target.value })} /></label></div>
                <div className="enterprise-management-form-grid"><label>能力版本<input required value={evaluationForm.capability_version} onChange={(event) => setEvaluationForm({ ...evaluationForm, capability_version: event.target.value })} /></label><label>来源版本<input required value={evaluationForm.source_version} onChange={(event) => setEvaluationForm({ ...evaluationForm, source_version: event.target.value })} /></label></div>
                <div className="enterprise-management-form-grid"><label>窗口开始<input required type="datetime-local" value={evaluationForm.period_start} onChange={(event) => setEvaluationForm({ ...evaluationForm, period_start: event.target.value })} /></label><label>窗口结束<input required type="datetime-local" value={evaluationForm.period_end} onChange={(event) => setEvaluationForm({ ...evaluationForm, period_end: event.target.value })} /></label></div>
                <label>数据截止时间<input required type="datetime-local" value={evaluationForm.data_cutoff_at} onChange={(event) => setEvaluationForm({ ...evaluationForm, data_cutoff_at: event.target.value })} /></label>
                <div className="enterprise-management-number-grid">
                  <label>样本数<input min="0" required type="number" value={evaluationForm.sample_size} onChange={(event) => setEvaluationForm({ ...evaluationForm, sample_size: event.target.value })} /></label><label>成功数<input min="0" required type="number" value={evaluationForm.success_count} onChange={(event) => setEvaluationForm({ ...evaluationForm, success_count: event.target.value })} /></label><label>质量样本<input min="0" required type="number" value={evaluationForm.quality_sample_size} onChange={(event) => setEvaluationForm({ ...evaluationForm, quality_sample_size: event.target.value })} /></label><label>质量通过<input min="0" required type="number" value={evaluationForm.quality_pass_count} onChange={(event) => setEvaluationForm({ ...evaluationForm, quality_pass_count: event.target.value })} /></label>
                </div>
                <label>证据引用（每行或逗号分隔）<textarea value={evaluationForm.evidence_refs} onChange={(event) => setEvaluationForm({ ...evaluationForm, evidence_refs: event.target.value })} /></label>
                <button className="primary-action" disabled={action === 'evaluation'} type="submit">{action === 'evaluation' ? '保存中…' : '保存评估快照'}</button>
              </form>
              <div className="enterprise-management-list">{evaluations.length ? evaluations.map((evaluation) => <article className="enterprise-management-card" key={evaluation.uuid}><div><strong>{evaluation.capability_key} · v{evaluation.capability_version}</strong><small>{capabilityTypes.find((type) => type.value === evaluation.capability_type)?.label || evaluation.capability_type} · {formatDate(evaluation.data_cutoff_at)}</small></div><span className="enterprise-badge">{evaluation.confidence_label === 'normal' ? '样本充分' : '低样本'}</span><p>成功率 {formatRate(evaluation.success_rate)} · 质量通过率 {formatRate(evaluation.quality_pass_rate)} · 状态 {evaluation.status}</p></article>) : <p className="enterprise-management-empty">还没有能力评估。</p>}</div>
            </section>
          </div>

          <section className="enterprise-management-panel enterprise-management-proposals">
            <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">HUMAN-GATED OPTIMIZATION</span><h2>优化提案审核</h2></div><span className="enterprise-badge">{proposals.length} 个提案</span></div>
            <form className="enterprise-management-form enterprise-management-proposal-form" onSubmit={(event) => void submitProposal(event)}>
              <div className="enterprise-management-form-grid"><label>基于评估<select required value={proposalForm.evaluation_uuid} onChange={(event) => setProposalForm({ ...proposalForm, evaluation_uuid: event.target.value })}><option value="">请选择评估快照</option>{evaluations.map((evaluation) => <option key={evaluation.uuid} value={evaluation.uuid}>{evaluation.capability_key} · v{evaluation.capability_version}</option>)}</select></label><label>风险级别<select value={proposalForm.risk_level} onChange={(event) => setProposalForm({ ...proposalForm, risk_level: event.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label></div>
              <label>提案标题<input required value={proposalForm.title} onChange={(event) => setProposalForm({ ...proposalForm, title: event.target.value })} /></label>
              <label>调整理由<textarea required value={proposalForm.rationale} onChange={(event) => setProposalForm({ ...proposalForm, rationale: event.target.value })} /></label>
              <label>变更内容（JSON）<textarea className="enterprise-management-json" required value={proposalForm.proposed_change} onChange={(event) => setProposalForm({ ...proposalForm, proposed_change: event.target.value })} /></label>
              <button className="primary-action" disabled={action === 'proposal' || !proposalForm.evaluation_uuid} type="submit">{action === 'proposal' ? '提交中…' : '提交人工审核'}</button>
            </form>
            <div className="enterprise-management-proposal-list">{proposals.length ? proposals.map((proposal) => <article className="enterprise-management-card" key={proposal.uuid}><div><strong>{proposal.title}</strong><small>{proposal.capability_key} · 风险 {proposal.risk_level} · 提交人 {proposal.proposed_by}</small><p>{proposal.rationale}</p></div><span className="enterprise-badge">{proposal.status}</span><div className="enterprise-management-actions">{proposal.status === 'draft' ? <button disabled={action === `${proposal.uuid}:submit_review`} onClick={() => void transitionProposal(proposal, 'submit_review')} type="button">送审</button> : null}{proposal.status === 'review_pending' ? <><button disabled={action === `${proposal.uuid}:reject`} onClick={() => void transitionProposal(proposal, 'reject')} type="button">驳回</button><button className="primary-action" disabled={action === `${proposal.uuid}:approve`} onClick={() => void transitionProposal(proposal, 'approve')} type="button">批准</button></> : null}{proposal.status === 'approved' ? <button className="primary-action" disabled={action === `${proposal.uuid}:publish`} onClick={() => void transitionProposal(proposal, 'publish')} type="button">发布新版本</button> : null}{(proposal.status === 'published_as_new_version' || proposal.status === 'observed') ? <button disabled={action === `${proposal.uuid}:rollback`} onClick={() => void transitionProposal(proposal, 'rollback')} type="button">回滚</button> : null}</div></article>) : <p className="enterprise-management-empty">还没有优化提案。</p>}</div>
          </section>

          <section className="enterprise-management-panel enterprise-management-audit">
            <div className="enterprise-panel-heading"><div><span className="enterprise-panel-kicker">TRACEABILITY</span><h2>最近企业操作审计</h2></div><span className="enterprise-badge">{auditLogs.length} 条记录</span></div>
            <div className="enterprise-management-list">
              {auditLogs.length ? auditLogs.map((log) => <article className="enterprise-management-card" key={log.id}><div><strong>{log.action}</strong><small>{log.username_snapshot} · {log.entity_type} · {log.entity_uuid || '无实体'}</small></div><span className={`enterprise-badge ${log.result === 'SUCCESS' ? '' : 'enterprise-badge-warning'}`}>{log.result}</span><p>{formatDate(log.created_at)}</p></article>) : <p className="enterprise-management-empty">暂无企业操作审计记录。</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
