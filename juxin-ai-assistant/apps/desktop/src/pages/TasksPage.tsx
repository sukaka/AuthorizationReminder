import { useCallback, useEffect, useState } from 'react';

import {
  ApiError,
  cancelAgentRun,
  createAgentRun,
  getAgentRunDetail,
  listAgentRuns,
  postAgentRunFeedback,
  retryAgentRun,
  type AgentRunDetailPayload,
  type AgentRunPayload,
} from '../api/client';
import { CitationList, type CitationRef } from '../components/CitationPreviewDrawer';
import { OutputReader } from '../components/OutputReader';

const STATUS_LABEL: Record<string, string> = {
  created: '已创建',
  queued: '排队中',
  running: '执行中',
  waiting_user: '待补充',
  waiting_confirmation: '待确认',
  paused: '已暂停',
  retrying: '重试中',
  succeeded: '已完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STAGE_LABEL: Record<string, string> = {
  created: '准备任务',
  queued: '等待执行',
  planning: '制定计划',
  routing: '选择合适助手',
  invoking: '调用能力',
  researching: '查找资料',
  generating: '生成内容',
  validating: '检查结果',
  persisting: '保存成果',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
};

function stageLabel(stage?: string | null): string {
  if (!stage) return '处理中';
  return STAGE_LABEL[stage] || '处理中';
}

function displayProgress(run: Pick<AgentRunPayload, 'status' | 'stage' | 'progress'>): number {
  if (run.status === 'succeeded' || run.status === 'completed' || run.stage === 'completed') {
    return 100;
  }
  if (run.status === 'created' || run.status === 'queued' || run.status === 'retrying') {
    return 0;
  }
  return Math.max(0, Math.min(100, run.progress ?? 0));
}

type TasksPageProps = {
  initialRunId?: string;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenChat?: (conversationId?: string) => void;
  onOpenWorkflow?: (workflowId: string) => void;
};

export function TasksPage({
  initialRunId = '',
  onOpenArtifact,
  onOpenChat,
  onOpenWorkflow,
}: TasksPageProps = {}) {
  const [items, setItems] = useState<AgentRunPayload[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<AgentRunDetailPayload | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const openDetail = useCallback(async (runId: string, preserveNotice = false) => {
    setError('');
    if (!preserveNotice) {
      setNotice('');
    }
    try {
      setDetail(await getAgentRunDetail(runId));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '任务详情加载失败');
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await listAgentRuns({ status: statusFilter, query, offset: 0, limit: 50 });
      setItems(payload.items || []);
      setTotal(payload.total || 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '任务列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [query, statusFilter]);

  const loadMore = async () => {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const payload = await listAgentRuns({
        status: statusFilter,
        query,
        offset: items.length,
        limit: 50,
      });
      setItems((current) => {
        const knownIds = new Set(current.map((item) => item.run_id));
        return current.concat(payload.items.filter((item) => !knownIds.has(item.run_id)));
      });
      setTotal(payload.total || 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '加载更多任务失败');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (initialRunId) {
      void openDetail(initialRunId);
    }
  }, [initialRunId, openDetail]);

  const submitNew = async () => {
    const text = draft.trim();
    if (!text) return;
    setError('');
    setNotice('');
    try {
      const created = await createAgentRun({ input_text: text, title: text.slice(0, 40) || 'AI 任务' });
      setDraft('');
      setNotice('任务已提交');
      await refresh();
      if (created.run?.run_id) {
        await openDetail(created.run.run_id, true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '创建任务失败');
    }
  };

  const onCancel = async () => {
    if (!detail?.run?.run_id) return;
    try {
      await cancelAgentRun(detail.run.run_id);
      setNotice('已请求取消');
      await openDetail(detail.run.run_id, true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '取消失败');
    }
  };

  const onRetry = async () => {
    if (!detail?.run?.run_id) return;
    setError('');
    try {
      await retryAgentRun(detail.run.run_id);
      setNotice('任务已重新进入处理队列');
      await openDetail(detail.run.run_id, true);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '重试失败');
    }
  };

  const onFeedback = async (feedback_type: string) => {
    if (!detail?.run?.run_id) return;
    try {
      await postAgentRunFeedback(detail.run.run_id, {
        feedback_type,
        comment: feedback_type === 'correction' ? '请改进引用与准确性' : '',
      });
      setNotice(
        feedback_type === 'correction'
          ? '已记录改进意见（学习候选，不会自动发布）'
          : '感谢反馈',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.code : '反馈失败');
    }
  };

  const answerText = extractAnswer(detail);
  const citations = extractCitations(detail);
  const quality = extractQuality(detail);
  const artifactId = extractArtifactId(detail);

  return (
    <section className="history-page">
      <header className="catalog-heading">
        <div>
          <span className="eyebrow">后台任务</span>
          <h1>任务中心</h1>
          <p>查看后台任务进度、执行步骤、引用来源与交付结果。</p>
        </div>
        <div className="history-filters">
          <input
            aria-label="搜索任务"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索任务"
            type="search"
            value={search}
          />
          <select
            aria-label="状态筛选"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">全部状态</option>
            <option value="running">执行中</option>
            <option value="waiting_user">待补充</option>
            <option value="succeeded">已完成</option>
            <option value="failed">失败</option>
            <option value="cancelled">已取消</option>
          </select>
          <button type="button" className="secondary-action" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
      </header>

      <div className="task-create-row">
        <input
          placeholder="描述一项工作，例如：汇总方案生成验收报告"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitNew();
          }}
        />
        <button type="button" className="primary-action" onClick={() => void submitNew()}>
          发起任务
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="form-success">{notice}</p> : null}
      {loading && !items.length ? <p className="catalog-state">加载中…</p> : null}

      <div className="history-layout">
        <div className="history-list">
          {items.map((item) => (
            <button
              key={item.run_id}
              type="button"
              className={detail?.run?.run_id === item.run_id ? 'is-current' : ''}
              onClick={() => void openDetail(item.run_id)}
            >
              <span>
                <strong>{item.title || '未命名任务'}</strong>
                <small>
                  {STATUS_LABEL[item.status] || '处理中'} · {stageLabel(item.stage)}
                </small>
              </span>
              <span>
                <small>{item.updated_at ? new Date(item.updated_at).toLocaleString() : ''}</small>
                <em>{displayProgress(item)}%</em>
              </span>
            </button>
          ))}
          {!items.length && !loading ? (
            <p className="empty-hint">
              {query ? `没有找到“${query}”相关任务。` : '还没有任务，可在上方发起。'}
            </p>
          ) : null}
          {items.length < total ? (
            <button
              className="secondary-action"
              disabled={loadingMore}
              onClick={() => void loadMore()}
              type="button"
            >
              {loadingMore ? '正在加载…' : `加载更多（已显示 ${items.length} / ${total}）`}
            </button>
          ) : null}
        </div>

        <article className="history-detail">
          {detail?.run ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{STATUS_LABEL[detail.run.status] || detail.run.status}</span>
                  <h2>{detail.run.title || '任务详情'}</h2>
                </div>
                <span>{displayProgress(detail.run)}%</span>
              </header>
              <p style={{ fontSize: 13, opacity: 0.8 }}>
                阶段：{stageLabel(detail.run.stage)} · 进度：{displayProgress(detail.run)}%
              </p>
              {detail.run.next_action ? (
                <p className="form-success" role="status">
                  下一步：{detail.run.next_action}
                </p>
              ) : null}
              {detail.run.error_message ? (
                <p className="form-error" role="alert">
                  {detail.run.error_message}
                  {detail.run.error_code ? `（${detail.run.error_code}）` : ''}
                </p>
              ) : null}
              {workflowMeta(detail) ? (
                <p style={{ fontSize: 13 }}>
                  已关联工作流
                  {workflowMeta(detail)?.status
                    ? ` · ${STATUS_LABEL[String(workflowMeta(detail)?.status)] || '处理中'}`
                    : ''}
                  {workflowMeta(detail)?.workflow_id && onOpenWorkflow ? (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => onOpenWorkflow(String(workflowMeta(detail)?.workflow_id))}
                      >
                        打开工作流
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
              {routingSelected(detail) ? (
                <p style={{ fontSize: 13 }}>
                  系统已自动选择合适助手
                </p>
              ) : null}

              <OutputReader emptyText="暂无正文结果" text={answerText} />

              {citations.length ? (
                <section className="artifact-sources" aria-label="引用来源">
                  <strong>引用来源（点击预览可打开原文）</strong>
                  <CitationList items={citations as CitationRef[]} />
                </section>
              ) : null}

              {quality ? (
                <section className="artifact-sources" aria-label="交付自检">
                  <strong>交付自检 {quality.passed ? '通过' : '未通过'}</strong>
                  {quality.issues?.length ? (
                    <ul>
                      {quality.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: 13 }}>无问题项</p>
                  )}
                </section>
              ) : null}

              {detail.steps?.length ? (
                <section className="artifact-sources" aria-label="执行步骤">
                  <strong>执行步骤</strong>
                  <ol>
                    {detail.steps.map((s) => (
                      <li key={s.step_id}>
                        {s.role ? `[${s.role}] ` : ''}
                        {s.summary || s.step_type} · {s.status}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              {detail.events?.length ? (
                <section className="artifact-sources" aria-label="过程事件">
                  <strong>过程动态</strong>
                  <ul>
                    {detail.events.slice(-12).map((ev) => (
                      <li key={ev.event_id}>
                        <span>{ev.label || ev.event_type}</span>
                        {ev.content ? <small>{ev.content.slice(0, 120)}</small> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="history-actions" style={{ flexWrap: 'wrap' }}>
                {(detail.run.cancel_allowed
                  ?? ['running', 'queued', 'created', 'retrying'].includes(detail.run.status)) ? (
                  <button type="button" className="secondary-action" onClick={() => void onCancel()}>
                    取消任务
                  </button>
                ) : null}
                {detail.run.retry_allowed ? (
                  <button type="button" className="primary-action" onClick={() => void onRetry()}>
                    重新运行
                  </button>
                ) : null}
                <button type="button" className="secondary-action" onClick={() => void onFeedback('useful')}>
                  有用
                </button>
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => void onFeedback('correction')}
                >
                  需要改进
                </button>
                {artifactId && onOpenArtifact ? (
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => onOpenArtifact(artifactId)}
                  >
                    打开成果
                  </button>
                ) : null}
                {onOpenChat ? (
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => onOpenChat(detail.run.conversation_id || undefined)}
                  >
                    {detail.run.conversation_id ? '打开原会话' : '返回聊天'}
                  </button>
                ) : null}
                <button type="button" className="secondary-action" onClick={() => void openDetail(detail.run.run_id)}>
                  刷新详情
                </button>
              </div>
            </>
          ) : (
            <div className="history-placeholder">
              <strong>选择一项任务</strong>
              <span>可查看进度、引用、自检结果与过程步骤。</span>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function workflowMeta(
  detail: AgentRunDetailPayload | null,
): { workflow_id?: string; status?: string } | null {
  if (!detail?.result) return null;
  const wf = detail.result.workflow;
  if (wf && typeof wf === 'object') {
    return wf as { workflow_id?: string; status?: string };
  }
  const routing = detail.result.routing;
  if (routing && typeof routing === 'object' && (routing as { workflow_id?: string }).workflow_id) {
    return {
      workflow_id: String((routing as { workflow_id?: string }).workflow_id),
      status: String((routing as { workflow_status?: string }).workflow_status || ''),
    };
  }
  return null;
}

function routingSelected(detail: AgentRunDetailPayload | null): string {
  if (!detail?.result) return '';
  const direct = detail.result.selected_agent_id;
  if (typeof direct === 'string' && direct) return direct;
  const routing = detail.result.routing;
  if (routing && typeof routing === 'object') {
    const id = (routing as { selected_agent_id?: string }).selected_agent_id;
    if (id) return String(id);
  }
  return '';
}

function extractArtifactId(detail: AgentRunDetailPayload | null): string {
  const runArtifactId = detail?.run?.artifact?.artifact_id;
  if (typeof runArtifactId === 'string' && runArtifactId) return runArtifactId;
  const resultArtifactId = detail?.result?.artifact_id;
  return typeof resultArtifactId === 'string' ? resultArtifactId : '';
}

function extractAnswer(detail: AgentRunDetailPayload | null): string {
  if (!detail) return '';
  const result = detail.result || {};
  for (const key of ['answer', 'output', 'text', 'content', 'final_answer']) {
    const v = result[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  const delivery = result.delivery;
  if (delivery && typeof delivery === 'object') {
    const d = delivery as Record<string, unknown>;
    for (const key of ['answer', 'output', 'text', 'content']) {
      const v = d[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
  }
  // last deltas
  const deltas = (detail.events || [])
    .filter((e) => e.event_type === 'delta' && e.content)
    .map((e) => e.content);
  if (deltas.length) return deltas.join('');
  return '';
}

function extractCitations(detail: AgentRunDetailPayload | null): Array<{
  citation_id?: string;
  name?: string;
  location?: string;
  section?: string;
  page?: number;
  is_inference?: boolean;
  excerpt?: string;
}> {
  if (!detail) return [];
  const fromRun = detail.run?.citations;
  if (Array.isArray(fromRun) && fromRun.length) return fromRun as never[];
  const result = detail.result || {};
  const c = result.citations;
  if (Array.isArray(c)) return c as never[];
  const sources = (detail.events || [])
    .filter((e) => e.event_type === 'source' && e.source)
    .map((e) => e.source as Record<string, unknown>);
  return sources as never[];
}

function extractQuality(detail: AgentRunDetailPayload | null): { passed?: boolean; issues?: string[] } | null {
  if (!detail) return null;
  const result = detail.result || {};
  const q = result.quality;
  if (q && typeof q === 'object') return q as { passed?: boolean; issues?: string[] };
  const rev = (detail.events || []).filter((e) => e.event_type === 'review' && e.quality).pop();
  if (rev?.quality) return rev.quality as { passed?: boolean; issues?: string[] };
  return null;
}
