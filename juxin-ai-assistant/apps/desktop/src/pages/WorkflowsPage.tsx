import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  deleteCustomWorkflow,
  getWorkflowDefinition,
  listWorkflows,
  publishCustomWorkflow,
  routeAgent,
  runWorkflow,
  saveCustomWorkflow,
  validateSavedWorkflow,
  validateWorkflow,
} from '../api/client';

type WorkflowItem = {
  id: string;
  name: string;
  description: string;
  step_count: number;
  custom?: boolean;
};

type WorkflowFilter = 'all' | 'preset' | 'custom';

type StepLog = {
  id: string;
  type: string;
  status: string;
  latency_ms?: number;
  error?: string;
  output?: Record<string, unknown>;
};

type BuilderStep = {
  id: string;
  type: string;
  agent_id: string;
  params_json: string;
};

const STATUS_LABEL: Record<string, string> = {
  succeeded: '成功',
  failed: '失败',
  waiting_human: '待人工确认',
  partial: '部分完成',
};

const STEP_TYPES = [
  { value: 'route', label: '智能路由' },
  { value: 'invoke', label: '调用 Agent' },
  { value: 'parallel', label: '并行分支' },
  { value: 'condition', label: '条件分支' },
  { value: 'merge', label: '合并' },
  { value: 'human_review', label: '人工审核' },
  { value: 'egress_check', label: '出域检查' },
  { value: 'set', label: '设置变量' },
  { value: 'noop', label: '空操作' },
  { value: 'tool', label: '工具调用' },
  { value: 'skill', label: 'Skill 调用' },
  { value: 'artifact', label: '生成交付物' },
  { value: 'approval', label: '审批门' },
  { value: 'project_read', label: '读取项目资料' },
  { value: 'transform', label: '数据转换' },
  { value: 'notification', label: '通知' },
  { value: 'wait', label: '等待信号' },
  { value: 'subflow', label: '子流程' },
  { value: 'business', label: '业务动作' },
];

const emptyParamsJson = '{}';

function WorkflowCanvasNodes({
  steps,
}: {
  steps: Array<Record<string, unknown>>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        minWidth: 'max-content',
      }}
    >
      {steps.map((s, index) => {
        const stype = String(s.type || '');
        const params =
          s.params && typeof s.params === 'object' ? (s.params as Record<string, unknown>) : {};
        const agentId = typeof params.agent_id === 'string' ? params.agent_id : '';
        const branches =
          stype === 'parallel' && Array.isArray(params.branches)
            ? (params.branches as Array<Record<string, unknown>>)
            : [];
        const isCondition = stype === 'condition';
        return (
          <div key={`wf-node-${String(s.id)}-${index}`} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              style={{
                minWidth: isCondition || branches.length ? 160 : 120,
                maxWidth: branches.length ? 220 : 170,
                padding: '10px 12px',
                borderRadius: 10,
                background: stype === 'parallel' ? '#eff6ff' : isCondition ? '#fefce8' : '#fff',
                border: `1px solid ${stype === 'parallel' ? '#93c5fd' : isCondition ? '#fde047' : '#94a3b8'}`,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {index + 1}. {STEP_TYPES.find((t) => t.value === stype)?.label || stype}
              </div>
              <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>
                {String(s.id)}
                {agentId ? ` · ${agentId}` : ''}
                {isCondition && params.then_agent
                  ? ` · then=${String(params.then_agent)}`
                  : ''}
              </div>
              {branches.length ? (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    borderTop: '1px dashed #bfdbfe',
                    paddingTop: 6,
                  }}
                >
                  {branches.map((b, bi) => (
                    <div
                      key={`br-${String(b.id)}-${bi}`}
                      style={{
                        fontSize: 11,
                        background: '#fff',
                        border: '1px solid #dbeafe',
                        borderRadius: 6,
                        padding: '4px 6px',
                      }}
                    >
                      ∥ {String(b.id || `b${bi + 1}`)}
                      {Array.isArray(b.steps)
                        ? ` · ${(b.steps as unknown[]).length} 步`
                        : ''}
                    </div>
                  ))}
                </div>
              ) : null}
              {isCondition ? (
                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.75 }}>
                  if {String(params.if || params.contains || '…')} → 分支
                </div>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <div
                aria-hidden
                style={{
                  width: 28,
                  height: 2,
                  background: '#64748b',
                  position: 'relative',
                  margin: '0 2px',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    right: -1,
                    top: -3,
                    width: 0,
                    height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: '6px solid #64748b',
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function WorkflowValidationPanel({
  validation,
}: {
  validation: {
    valid: boolean;
    errors: Array<{ code: string; message: string; path?: string; severity?: string }>;
    warnings: Array<{ code: string; message: string; path?: string; severity?: string }>;
    preview?: {
      node_count?: number;
      max_depth?: number;
      requires_approval?: boolean;
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    };
  };
}) {
  return (
    <section
      aria-label="流程检查结果"
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        border: `1px solid ${validation.valid ? '#86efac' : '#fca5a5'}`,
        background: validation.valid ? '#f0fdf4' : '#fff1f2',
      }}
    >
      <strong>{validation.valid ? '检查通过' : '检查未通过'}</strong>
      {validation.preview ? (
        <p style={{ margin: '6px 0', fontSize: 12, opacity: 0.8 }}>
          预览：{validation.preview.node_count ?? 0} 个节点 · 最大深度 {validation.preview.max_depth ?? 0}
          {validation.preview.requires_approval ? ' · 含审批门' : ''}
        </p>
      ) : null}
      {validation.errors.length ? (
        <ul style={{ margin: '6px 0', paddingLeft: 20, color: '#b91c1c', fontSize: 12 }}>
          {validation.errors.map((issue, index) => (
            <li key={`workflow-error-${issue.code}-${index}`}>
              {issue.path ? `${issue.path}：` : ''}{issue.message} <code>{issue.code}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {validation.warnings.length ? (
        <ul style={{ margin: '6px 0', paddingLeft: 20, color: '#92400e', fontSize: 12 }}>
          {validation.warnings.map((issue, index) => (
            <li key={`workflow-warning-${issue.code}-${index}`}>
              {issue.path ? `${issue.path}：` : ''}{issue.message} <code>{issue.code}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type WorkflowsPageProps = {
  initialWorkflowId?: string;
  onOpenTaskCenter?: (runId?: string) => void;
};

export function WorkflowsPage({ initialWorkflowId = '', onOpenTaskCenter }: WorkflowsPageProps = {}) {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [selectedId, setSelectedId] = useState(initialWorkflowId);
  const [inputText, setInputText] = useState('请对这段业务说明做简短摘要，便于汇报。');
  const [preferred, setPreferred] = useState('');
  const [routeResult, setRouteResult] = useState<Record<string, unknown> | null>(null);
  const [runResult, setRunResult] = useState<{
    status: string;
    steps: StepLog[];
    outputs?: Record<string, unknown>;
    error?: string;
    agent_run_id?: string;
  } | null>(null);
  const [definition, setDefinition] = useState<Record<string, unknown> | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderId, setBuilderId] = useState('my_flow');
  const [builderName, setBuilderName] = useState('我的流程');
  const [builderDesc, setBuilderDesc] = useState('');
  const [builderSteps, setBuilderSteps] = useState<BuilderStep[]>([
    { id: 's1', type: 'route', agent_id: '', params_json: emptyParamsJson },
    { id: 's2', type: 'invoke', agent_id: 'local.summary', params_json: emptyParamsJson },
  ]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [canvasMode, setCanvasMode] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState<WorkflowFilter>('all');
  const [validation, setValidation] = useState<{
    valid: boolean;
    errors: Array<{ code: string; message: string; path?: string; severity?: string }>;
    warnings: Array<{ code: string; message: string; path?: string; severity?: string }>;
    preview?: {
      node_count?: number;
      max_depth?: number;
      requires_approval?: boolean;
      nodes?: Array<Record<string, unknown>>;
      edges?: Array<Record<string, unknown>>;
    };
  } | null>(null);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const payload = await listWorkflows();
      setItems(payload.items || []);
      setSelectedId((current) => {
        if (current && payload.items?.some((i) => i.id === current)) return current;
        if (initialWorkflowId && payload.items?.some((i) => i.id === initialWorkflowId)) {
          return initialWorkflowId;
        }
        return payload.items?.[0]?.id || '';
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '工作流列表加载失败');
    }
  }, [initialWorkflowId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (initialWorkflowId) setSelectedId(initialWorkflowId);
  }, [initialWorkflowId]);

  useEffect(() => {
    if (!selectedId) {
      setDefinition(null);
      return;
    }
    let alive = true;
    getWorkflowDefinition(selectedId)
      .then((def) => {
        if (alive) setDefinition(def);
      })
      .catch(() => {
        if (alive) setDefinition(null);
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const onRoute = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await routeAgent({
        input_text: inputText,
        preferred_agent_id: preferred || undefined,
      });
      setRouteResult(result);
      const runId = result.agent_run_id ? String(result.agent_run_id) : '';
      setNotice(
        `路由完成：${String(result.selected_agent_id || '无可用 Agent')}${
          runId ? ` · 已写入任务 ${runId.slice(0, 8)}` : ''
        }`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '路由失败');
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    setNotice('');
    setRunResult(null);
    try {
      const result = await runWorkflow(selectedId, {
        input_text: inputText,
        preferred_agent_id: preferred || undefined,
        egress_confirmed: false,
      });
      const agentRunId = result.agent_run_id ? String(result.agent_run_id) : '';
      setRunResult({
        status: String(result.status || ''),
        steps: (result.steps as StepLog[]) || [],
        outputs: result.outputs as Record<string, unknown> | undefined,
        error: String(result.error || ''),
        agent_run_id: agentRunId,
      });
      setNotice(
        `工作流 ${STATUS_LABEL[String(result.status)] || String(result.status)}${
          agentRunId ? ` · 任务 ${agentRunId.slice(0, 8)}` : ''
        }`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '工作流运行失败');
    } finally {
      setBusy(false);
    }
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setBuilderSteps((current) => {
      const next = [...current];
      const target = index + dir;
      if (target < 0 || target >= next.length) return current;
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  const reorderStep = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setBuilderSteps((current) => {
      if (from >= current.length || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const stepTypeLabel = (type: string) =>
    STEP_TYPES.find((t) => t.value === type)?.label || type;

  const builderPayload = () => {
    const steps: Array<{ id: string; type: string; params: Record<string, unknown> }> = [];
    for (const [index, step] of builderSteps.entries()) {
      let params: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(step.params_json || emptyParamsJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          params = parsed as Record<string, unknown>;
        } else {
          throw new Error('params_not_object');
        }
      } catch {
        throw new Error(`第 ${index + 1} 步参数必须是 JSON 对象`);
      }
      if (step.type === 'invoke' && !params.agent_id) {
        params.agent_id = step.agent_id || 'local.echo';
      }
      if (step.type === 'human_review' && !params.message) params.message = '请人工确认';
      if (step.type === 'set' && !params.key) {
        params.key = 'flag';
        params.value = true;
      }
      if (step.type === 'egress_check' && !params.destination) params.destination = 'external_agent';
      steps.push({ id: step.id || `s${index + 1}`, type: step.type, params });
    }
    return {
      id: builderId.trim().toLowerCase(),
      name: builderName.trim() || builderId,
      description: builderDesc,
      steps,
    };
  };

  const loadDefinitionIntoBuilder = (source: Record<string, unknown>, copy = false) => {
    const sourceId = String(source.id || selectedId || 'my_flow');
    const sourceName = String(source.name || '我的流程');
    const sourceSteps = Array.isArray(source.steps) ? (source.steps as Array<Record<string, unknown>>) : [];
    const nextId = copy
      ? `${sourceId}-copy-${Date.now().toString(36)}`.slice(0, 48)
      : sourceId;
    setBuilderId(nextId.replace(/[^a-z0-9_-]/g, '-').toLowerCase());
    setBuilderName(copy ? `${sourceName} 副本` : sourceName);
    setBuilderDesc(String(source.description || ''));
    setBuilderSteps(
      sourceSteps.map((step, index) => {
        const params = step.params && typeof step.params === 'object'
          ? (step.params as Record<string, unknown>)
          : {};
        return {
          id: String(step.id || `s${index + 1}`),
          type: String(step.type || 'noop'),
          agent_id: typeof params.agent_id === 'string' ? params.agent_id : '',
          params_json: JSON.stringify(params, null, 2),
        };
      }),
    );
    setValidation(null);
    setBuilderOpen(true);
  };

  const onValidateBuilder = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await validateWorkflow(builderPayload());
      setValidation(result);
      setNotice(result.valid ? '流程静态检查通过，可保存为草稿。' : '流程检查未通过，请先修复错误。');
    } catch (err) {
      setError(err instanceof Error ? err.message : err instanceof ApiError ? err.code : '流程检查失败');
    } finally {
      setBusy(false);
    }
  };

  const onValidateSelected = async () => {
    if (!selectedId || !selected?.custom) return;
    setBusy(true);
    setError('');
    try {
      const result = await validateSavedWorkflow(selectedId);
      setValidation(result);
      setNotice(result.valid ? '当前草稿检查通过。' : '当前流程存在阻断错误。');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '流程检查失败');
    } finally {
      setBusy(false);
    }
  };

  const onPublishSelected = async () => {
    if (!selectedId || !selected?.custom) return;
    setBusy(true);
    setError('');
    try {
      const check = await validateSavedWorkflow(selectedId);
      setValidation(check);
      if (!check.valid) {
        setNotice('发布已阻止：请先修复流程检查错误。');
        return;
      }
      await publishCustomWorkflow(selectedId);
      setNotice('流程已发布；后续运行只会读取已发布版本。');
      await refresh();
      const latest = await getWorkflowDefinition(selectedId);
      setDefinition(latest);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const saveBuilder = async () => {
    setBusy(true);
    setError('');
    try {
      await saveCustomWorkflow(builderPayload());
      setValidation(null);
      setNotice('自定义流程已保存');
      setBuilderOpen(false);
      await refresh();
      setSelectedId(builderId.trim().toLowerCase());
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '保存失败（id 需小写字母数字下划线）');
    } finally {
      setBusy(false);
    }
  };

  const selected = items.find((i) => i.id === selectedId);
  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesFilter =
        workflowFilter === 'all'
        || (workflowFilter === 'custom' && item.custom)
        || (workflowFilter === 'preset' && !item.custom);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [item.name, item.id, item.description]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [items, searchQuery, workflowFilter]);

  useEffect(() => {
    if (filteredItems.some((item) => item.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.id || '');
  }, [filteredItems, selectedId]);

  const removeCustom = async () => {
    if (!selectedId) return;
    if (!window.confirm(`删除自定义流程「${selectedId}」？`)) return;
    try {
      await deleteCustomWorkflow(selectedId);
      setNotice('已删除');
      setSelectedId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '删除失败');
    }
  };

  const defSteps = Array.isArray(definition?.steps)
    ? (definition?.steps as Array<Record<string, unknown>>)
    : [];

  return (
    <section className="history-page workflow-page">
      <header className="catalog-heading workflow-heading">
        <div>
          <span className="eyebrow">5.0.0 自动流程</span>
          <h1>工作流</h1>
          <p>预置流程 + 类型化节点编排；先检查草稿，再显式发布，运行后可在任务中心查看审计。</p>
        </div>
        <div className="workflow-heading-actions">
          <button type="button" className="secondary-action" onClick={() => setBuilderOpen((v) => !v)}>
            {builderOpen ? '关闭编排' : '拖拽编排'}
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setCanvasMode((v) => !v)}
            title="切换步骤画布预览"
          >
            {canvasMode ? '列表视图' : '画布视图'}
          </button>
          <button type="button" className="secondary-action" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="form-success">{notice}</p> : null}

      {builderOpen ? (
        <section className="workflow-builder">
          <h3 style={{ marginTop: 0 }}>拖拽步骤编排</h3>
          <p style={{ fontSize: 12, opacity: 0.75, marginTop: 0 }}>
            按住左侧 ⋮⋮ 拖动排序；画布预览同步展示节点连线。参数使用 JSON 对象，检查不通过时不能发布。
          </p>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
            <label>
              流程 ID（小写）
              <input value={builderId} onChange={(e) => setBuilderId(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label>
              名称
              <input value={builderName} onChange={(e) => setBuilderName(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8 }}>
            说明
            <input value={builderDesc} onChange={(e) => setBuilderDesc(e.target.value)} style={{ width: '100%' }} />
          </label>

          {/* Canvas preview of builder steps */}
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 10,
              background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
              border: '1px dashed #cbd5e1',
              overflowX: 'auto',
            }}
            aria-label="编排画布预览"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 'max-content' }}>
              {builderSteps.map((step, index) => (
                <div key={`canvas-${step.id}-${index}`} style={{ display: 'flex', alignItems: 'center' }}>
                  <div
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex != null) reorderStep(dragIndex, index);
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    style={{
                      minWidth: 120,
                      maxWidth: 160,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: dragIndex === index ? '#dbeafe' : '#fff',
                      border: '1px solid #94a3b8',
                      boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
                      cursor: 'grab',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {index + 1}. {stepTypeLabel(step.type)}
                    </div>
                    <div style={{ opacity: 0.7, wordBreak: 'break-all' }}>
                      {step.id}
                      {step.type === 'invoke' && step.agent_id ? ` · ${step.agent_id}` : ''}
                    </div>
                  </div>
                  {index < builderSteps.length - 1 ? (
                    <div
                      aria-hidden
                      style={{
                        width: 28,
                        height: 2,
                        background: '#64748b',
                        position: 'relative',
                        margin: '0 2px',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          right: -1,
                          top: -3,
                          width: 0,
                          height: 0,
                          borderTop: '4px solid transparent',
                          borderBottom: '4px solid transparent',
                          borderLeft: '6px solid #64748b',
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
              {!builderSteps.length ? (
                <span style={{ fontSize: 12, opacity: 0.6 }}>添加步骤后在此预览</span>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {builderSteps.map((step, index) => (
              <div
                key={`${step.id}-${index}`}
                draggable
                onDragStart={() => setDragIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex != null) reorderStep(dragIndex, index);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  padding: 8,
                  borderRadius: 8,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: dragIndex === index ? 'rgba(37,99,235,0.08)' : 'transparent',
                  cursor: 'grab',
                }}
              >
                <span style={{ width: 20, opacity: 0.5, userSelect: 'none' }} title="拖动排序">
                  ⋮⋮
                </span>
                <span style={{ width: 24 }}>{index + 1}.</span>
                <input
                  value={step.id}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderSteps((cur) => cur.map((s, i) => (i === index ? { ...s, id: v } : s)));
                  }}
                  style={{ width: 80 }}
                  placeholder="步骤id"
                />
                <select
                  value={step.type}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderSteps((cur) => cur.map((s, i) => (i === index ? { ...s, type: v } : s)));
                  }}
                >
                  {STEP_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {step.type === 'invoke' ? (
                  <input
                    value={step.agent_id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBuilderSteps((cur) =>
                        cur.map((s, i) => (i === index ? { ...s, agent_id: v } : s)),
                      );
                    }}
                    placeholder="agent_id"
                    style={{ width: 140 }}
                  />
                ) : null}
                <textarea
                  aria-label={`${step.id} 参数 JSON`}
                  value={step.params_json}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderSteps((cur) => cur.map((s, i) => (i === index ? { ...s, params_json: v } : s)));
                  }}
                  placeholder={'参数 JSON，例如 {"key":"value"}'}
                  rows={2}
                  style={{ minWidth: 220, flex: '1 1 220px', fontFamily: 'monospace', fontSize: 12 }}
                />
                <button type="button" className="secondary-action" onClick={() => moveStep(index, -1)}>
                  ↑
                </button>
                <button type="button" className="secondary-action" onClick={() => moveStep(index, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="danger-action"
                  onClick={() => setBuilderSteps((cur) => cur.filter((_, i) => i !== index))}
                >
                  删
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary-action"
              onClick={() =>
                setBuilderSteps((cur) => [
                  ...cur,
                  {
                    id: `s${cur.length + 1}`,
                    type: 'invoke',
                    agent_id: 'local.echo',
                    params_json: emptyParamsJson,
                  },
                ])
              }
            >
              添加步骤
            </button>
            <button type="button" className="secondary-action" disabled={busy} onClick={() => void onValidateBuilder()}>
              检查流程
            </button>
            <button type="button" className="primary-action" disabled={busy} onClick={() => void saveBuilder()}>
              保存流程
            </button>
          </div>
          {validation ? (
            <WorkflowValidationPanel validation={validation} />
          ) : null}
        </section>
      ) : null}

      <div className="workflow-layout">
        <aside className="workflow-library" aria-label="工作流库">
          <div className="workflow-library-heading">
            <div>
              <span className="workflow-section-kicker">WORKFLOW LIBRARY</span>
              <h2>流程库</h2>
            </div>
            <span className="workflow-library-count">{filteredItems.length} 个</span>
          </div>
          <label className="workflow-search">
            <span className="sr-only">搜索工作流</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索名称、ID 或说明"
              aria-label="搜索工作流"
            />
          </label>
          <div className="workflow-filters" role="group" aria-label="工作流类型筛选">
            {([
              ['all', '全部'],
              ['preset', '预置'],
              ['custom', '自定义'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={workflowFilter === value ? 'is-current' : ''}
                onClick={() => setWorkflowFilter(value)}
                aria-pressed={workflowFilter === value}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="workflow-list">
            {filteredItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`workflow-item${selectedId === item.id ? ' is-current' : ''}`}
                onClick={() => setSelectedId(item.id)}
                aria-current={selectedId === item.id ? 'page' : undefined}
              >
                <span className="workflow-item-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="workflow-item-copy">
                  <strong>{item.name}</strong>
                  <small>
                    {item.step_count} 步 · {item.custom ? '自定义' : '预置'} · {item.id}
                  </small>
                </span>
                <span className={`workflow-item-kind${item.custom ? ' is-custom' : ''}`}>
                  {item.custom ? '自定义' : '预置'}
                </span>
              </button>
            ))}
            {!filteredItems.length ? (
              <div className="workflow-empty">
                <strong>{items.length ? '没有匹配的工作流' : '暂无工作流'}</strong>
                <span>{items.length ? '换一个关键词或筛选条件试试。' : '刷新后重新加载工作流列表。'}</span>
              </div>
            ) : null}
          </div>
        </aside>

        <article className="workflow-detail">
          {selected ? (
            <>
              <header className="workflow-detail-header">
                <div className="workflow-detail-title">
                  <span className="eyebrow">{selected.custom ? '自定义' : '预置'}</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.description || '暂无流程说明。'}</p>
                </div>
                <div className="workflow-detail-meta">
                  <span className="workflow-status-dot" aria-hidden />
                  <span>可运行</span>
                  <span className="workflow-detail-id">{selected.id}</span>
                </div>
              </header>

              <div className="workflow-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => definition && loadDefinitionIntoBuilder(definition, true)}
                  disabled={!definition || busy}
                >
                  复制为新流程
                </button>
                {selected.custom ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => void onValidateSelected()}
                    >
                      检查当前草稿
                    </button>
                    <button
                      type="button"
                      className="primary-action"
                      disabled={busy}
                      onClick={() => void onPublishSelected()}
                    >
                      发布当前版本
                    </button>
                  </>
                ) : null}
              </div>
              {validation && !builderOpen ? <WorkflowValidationPanel validation={validation} /> : null}

              {defSteps.length ? (
                <section className="workflow-section workflow-steps" aria-label="步骤定义">
                  <div className="workflow-section-heading">
                    <div>
                      <span className="workflow-section-kicker">STEP DEFINITION</span>
                      <strong>步骤定义</strong>
                    </div>
                    <span>{defSteps.length} 个节点</span>
                  </div>
                  {canvasMode ? (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 12,
                        borderRadius: 10,
                        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
                        border: '1px dashed #cbd5e1',
                        overflowX: 'auto',
                      }}
                    >
                      <WorkflowCanvasNodes steps={defSteps} />
                    </div>
                  ) : (
                    <ol>
                      {defSteps.map((s) => (
                        <li key={String(s.id)}>
                          {String(s.id)} · {String(s.type)}
                          {s.params &&
                          typeof s.params === 'object' &&
                          'agent_id' in (s.params as object) ? (
                            <small> agent={(s.params as { agent_id?: string }).agent_id}</small>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ) : null}

              <section className="workflow-section workflow-run-config" aria-label="运行配置">
                <div className="workflow-section-heading">
                  <div>
                    <span className="workflow-section-kicker">RUN CONFIGURATION</span>
                    <strong>运行配置</strong>
                  </div>
                  <span>不会修改流程定义</span>
                </div>
                <label className="workflow-field">
                  输入内容
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={4}
                  style={{ width: '100%', marginTop: 6 }}
                />
                </label>
                <label className="workflow-field">
                  指定 Agent（可选）
                <input
                  value={preferred}
                  onChange={(e) => setPreferred(e.target.value)}
                  placeholder="local.summary"
                  style={{ width: '100%', marginTop: 6 }}
                />
                </label>
              </section>

              <div className="workflow-run-actions">
                <button type="button" className="secondary-action" disabled={busy} onClick={() => void onRoute()}>
                  智能路由
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={busy || !selectedId}
                  onClick={() => void onRun()}
                >
                  {busy ? '运行中…' : '运行工作流'}
                </button>
                {selected.custom ? (
                  <button type="button" className="danger-action" onClick={() => void removeCustom()}>
                    删除自定义
                  </button>
                ) : null}
              </div>

              {routeResult ? (
                <section className="artifact-sources" style={{ marginTop: 16 }} aria-label="路由结果">
                  <strong>路由结果</strong>
                  <p style={{ fontSize: 13 }}>
                    选中：<code>{String(routeResult.selected_agent_id || '—')}</code>
                    {routeResult.agent_run_id ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="secondary-action"
                          onClick={() => onOpenTaskCenter?.(String(routeResult.agent_run_id))}
                        >
                          打开任务 {String(routeResult.agent_run_id).slice(0, 8)}
                        </button>
                      </>
                    ) : null}
                  </p>
                  {Array.isArray(routeResult.candidates) ? (
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={{ padding: 4 }}>Agent</th>
                          <th style={{ padding: 4 }}>分</th>
                          <th style={{ padding: 4 }}>成本µ</th>
                          <th style={{ padding: 4 }}>延迟</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(routeResult.candidates as Array<Record<string, unknown>>).map((c) => (
                          <tr key={String(c.agent_id)} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: 4 }}>{String(c.agent_id)}</td>
                            <td style={{ padding: 4 }}>{String(c.score)}</td>
                            <td style={{ padding: 4 }}>{String(c.cost_per_call_micros)}</td>
                            <td style={{ padding: 4 }}>{String(c.avg_latency_ms)} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </section>
              ) : null}

              {runResult ? (
                <section className="artifact-sources" style={{ marginTop: 16 }} aria-label="运行步骤">
                  <strong>
                    运行状态：{STATUS_LABEL[runResult.status] || runResult.status}
                    {runResult.error ? ` · ${runResult.error}` : ''}
                  </strong>
                  <ol>
                    {runResult.steps.map((s) => (
                      <li key={s.id}>
                        <strong>{s.id}</strong> [{s.type}] {s.status}
                        {s.latency_ms != null ? ` · ${s.latency_ms}ms` : ''}
                        {s.error ? ` · ${s.error}` : ''}
                        {s.output && typeof s.output === 'object' && 'output' in s.output ? (
                          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                            {String((s.output as { output?: string }).output || '').slice(0, 200)}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {runResult.agent_run_id && onOpenTaskCenter ? (
                    <button
                      type="button"
                      className="primary-action"
                      onClick={() => onOpenTaskCenter(runResult.agent_run_id)}
                    >
                      在任务中心打开
                    </button>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : (
            <div className="history-placeholder">
              <strong>选择一个工作流</strong>
              <span>或点「简易编排」创建自定义流程。</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
