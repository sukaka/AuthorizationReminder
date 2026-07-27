import { useMemo, useState } from 'react';

import {
  type ChatCitation,
  type ChatGeneratedFile,
  type ChatTaskStatePayload,
} from '../api/chat';
import { isSafeSameOriginUrl } from '../api/client';

type RunStatus = 'idle' | 'running' | 'stopping';

export type ChatRunContextMessage = {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  generatedFiles?: ChatGeneratedFile[];
  isComplete?: boolean;
};

type GenerationMetrics = {
  latencyMs?: number | null;
  usage?: Record<string, unknown> | null;
};

type ContextTab = 'plan' | 'activity' | 'sources' | 'deliverables';

type ChatRunContextProps = {
  runId?: string;
  sessionUuid?: string;
  status: RunStatus;
  taskProgress?: ChatTaskStatePayload | null;
  metrics?: GenerationMetrics | null;
  messages: ChatRunContextMessage[];
  onStop?: () => void;
  onRetry?: () => void;
  onContinueWithoutTools?: () => void;
  onOpenTaskCenter?: (runId?: string) => void;
};

const stageLabels: Record<string, string> = {
  analyzing: '识别任务',
  building_context: '整理依据',
  checking_sources: '检查来源',
  retrieving: '查找资料',
  composing: '组织内容',
  generating: '生成回答',
  quality_check: '复核结果',
  completed: '已完成',
  stopped: '已停止',
  failed: '需要处理',
};

const toolLabels: Record<string, string> = {
  web_search: '联网查找',
  deep_web_research: '深度调研',
  web_capture: '网页采集',
  search_knowledge_base: '公司知识查询',
  search_personal_references: '我的资料查询',
  search_current_attachments: '当前附件查询',
  company_knowledge_search: '公司知识查询',
  personal_reference_search: '我的资料查询',
  current_attachment_search: '当前附件查询',
  word_export: 'Word 导出',
};

function stageLabel(stage: string, fallback = '处理中'): string {
  return stageLabels[stage] || fallback;
}

function toolLabel(tool: Record<string, unknown>): string {
  const name = String(tool.tool_name || tool.name || '');
  return toolLabels[name] || name || '任务处理';
}

function toolStatus(tool: Record<string, unknown>): string {
  const status = String(tool.status || '').toLowerCase();
  if (status === 'failed' || status === 'error') return '失败';
  if (status === 'completed' || status === 'success' || status === 'succeeded') return '完成';
  if (status === 'running') return '进行中';
  return status || '已记录';
}

function formatLatency(value?: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function usageNumber(usage: Record<string, unknown> | null | undefined, names: string[]): number | null {
  if (!usage) return null;
  for (const name of names) {
    const value = usage[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function formatTokens(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString('zh-CN');
}

function sourceLabel(source: Record<string, unknown>): string {
  return String(
    source.file_name
    || source.title
    || source.name
    || source.source_type
    || source.type
    || '资料来源',
  );
}

function sourceKey(citation: ChatCitation): string {
  return citation.file_uuid || citation.file_name || citation.asset_url || citation.source_type;
}

function statusLabel(status: RunStatus, taskProgress?: ChatTaskStatePayload | null): string {
  if (status === 'running') return '运行中';
  if (status === 'stopping') return '正在停止';
  if (taskProgress?.stage === 'failed') return '需要处理';
  if (taskProgress?.stage === 'stopped') return '已停止';
  if (taskProgress?.stage === 'completed') return '已完成';
  return '待运行';
}

export function ChatRunContext({
  runId,
  sessionUuid,
  status,
  taskProgress,
  metrics,
  messages,
  onStop,
  onRetry,
  onContinueWithoutTools,
  onOpenTaskCenter,
}: ChatRunContextProps) {
  const [activeTab, setActiveTab] = useState<ContextTab>('plan');
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.isComplete !== false);
  const citations = useMemo(() => {
    const seen = new Set<string>();
    return messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.citations || [])
      .filter((citation) => {
        const key = sourceKey(citation);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [messages]);
  const generatedFiles = useMemo(() => {
    const seen = new Set<string>();
    return messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.generatedFiles || [])
      .filter((file) => {
        if (seen.has(file.artifact_id)) return false;
        seen.add(file.artifact_id);
        return true;
      });
  }, [messages]);
  const stageHistory = taskProgress?.stage_history?.length
    ? taskProgress.stage_history
    : taskProgress?.stage
      ? [{ stage: taskProgress.stage, label: taskProgress.label, next_action: taskProgress.next_action }]
      : [];
  const toolCalls = taskProgress?.tool_calls || [];
  const selectedSources = taskProgress?.selected_sources || [];
  const inputTokens = usageNumber(metrics?.usage, ['prompt_tokens', 'input_tokens']);
  const outputTokens = usageNumber(metrics?.usage, ['completion_tokens', 'output_tokens']);
  const totalTokens = usageNumber(metrics?.usage, ['total_tokens'])
    ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const hasContext = Boolean(runId || sessionUuid || taskProgress || messages.length || status !== 'idle');
  const currentStage = taskProgress?.stage ? stageLabel(taskProgress.stage, taskProgress.label) : '尚未运行';

  if (!hasContext) {
    return (
      <aside className="chat-run-context is-empty" aria-label="任务详情">
        <div className="chat-run-context-empty-icon" aria-hidden="true">↗</div>
        <strong>任务详情</strong>
        <p>发送任务后，这里会显示计划、活动、来源和交付成果。</p>
      </aside>
    );
  }

  const tabs: Array<{ id: ContextTab; label: string; count?: number }> = [
    { id: 'plan', label: '计划', count: stageHistory.length || undefined },
    { id: 'activity', label: '活动', count: toolCalls.length || undefined },
    { id: 'sources', label: '来源', count: citations.length + selectedSources.length || undefined },
    { id: 'deliverables', label: '成果', count: generatedFiles.length || undefined },
  ];

  return (
    <aside className="chat-run-context" aria-label="任务详情">
      <header className="chat-run-context-header">
        <div>
          <span className="chat-run-context-eyebrow">任务详情</span>
          <strong>当前任务</strong>
        </div>
        <span className={`chat-run-context-status is-${status === 'idle' ? taskProgress?.stage || 'idle' : status}`}>
          <i aria-hidden="true" />
          {statusLabel(status, taskProgress)}
        </span>
      </header>
      <nav className="chat-run-context-tabs" aria-label="任务视图">
        {tabs.map((tab) => (
          <button
            className={activeTab === tab.id ? 'is-active' : ''}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
            {tab.count ? <span>{tab.count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="chat-run-context-body">
        {activeTab === 'plan' ? (
          <section aria-label="任务计划" className="chat-run-context-section">
            <div className="chat-run-context-section-title">
              <span>任务目标</span>
              <strong>{currentStage}</strong>
            </div>
            <p className="chat-run-context-goal">{taskProgress?.goal || latestUserMessage?.content || '等待输入任务'}</p>
            {taskProgress?.next_action ? (
              <div className="chat-run-context-next">
                <span>下一步</span>
                <strong>{taskProgress.next_action}</strong>
              </div>
            ) : null}
            {stageHistory.length ? (
              <ol className="chat-run-context-stages" aria-label="任务阶段">
                {stageHistory.map((item, index) => {
                  const stage = String(item.stage || '');
                  return (
                    <li className={stage === taskProgress?.stage ? 'is-active' : ''} key={`${stage}-${index}`}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <strong>{String(item.label || stageLabel(stage))}</strong>
                        {item.next_action ? <small>{String(item.next_action)}</small> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="chat-run-context-muted">发送后会记录每个处理阶段。</p>
            )}
          </section>
        ) : null}

        {activeTab === 'activity' ? (
          <section aria-label="任务活动" className="chat-run-context-section">
            {toolCalls.length ? (
              <ul className="chat-run-context-list">
                {toolCalls.map((tool, index) => (
                  <li key={`${toolLabel(tool)}-${index}`}>
                    <span className="chat-run-context-list-icon" aria-hidden="true">⌁</span>
                    <div>
                      <strong>{toolLabel(tool)}</strong>
                      <small>{toolStatus(tool)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="chat-run-context-muted">暂无工具活动。模型生成和质量检查会显示在这里。</p>
            )}
            {metrics ? (
              <dl className="chat-run-context-metrics">
                <div><dt>耗时</dt><dd>{formatLatency(metrics.latencyMs)}</dd></div>
                <div><dt>输入 token</dt><dd>{formatTokens(inputTokens)}</dd></div>
                <div><dt>输出 token</dt><dd>{formatTokens(outputTokens)}</dd></div>
                <div><dt>总 token</dt><dd>{formatTokens(totalTokens)}</dd></div>
              </dl>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'sources' ? (
          <section aria-label="任务来源" className="chat-run-context-section">
            {selectedSources.length ? (
              <div className="chat-run-context-subsection">
                <span className="chat-run-context-label">任务选择的来源</span>
                <ul className="chat-run-context-source-list">
                  {selectedSources.map((source, index) => <li key={`${sourceLabel(source)}-${index}`}>{sourceLabel(source)}</li>)}
                </ul>
              </div>
            ) : null}
            {citations.length ? (
              <div className="chat-run-context-subsection">
                <span className="chat-run-context-label">回答引用</span>
                <ul className="chat-run-context-source-list">
                  {citations.map((citation) => (
                    <li key={sourceKey(citation)}>
                      <span>{citation.file_name || citation.source_type || '资料来源'}</span>
                      {citation.page_or_sheet || citation.page_number ? <small>{citation.page_or_sheet || `第 ${citation.page_number} 页`}</small> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!selectedSources.length && !citations.length ? <p className="chat-run-context-muted">本次任务暂无可展示的来源。</p> : null}
          </section>
        ) : null}

        {activeTab === 'deliverables' ? (
          <section aria-label="任务成果" className="chat-run-context-section">
            {generatedFiles.length ? (
              <ul className="chat-run-context-deliverables">
                {generatedFiles.map((file) => (
                  <li key={file.artifact_id}>
                    <span className="chat-run-context-file-icon" aria-hidden="true">↓</span>
                    <div>
                      <strong title={file.file_name}>{file.file_name}</strong>
                      <small>{file.format.toUpperCase()} · 可下载</small>
                    </div>
                    {isSafeSameOriginUrl(file.download_url) ? <a download href={file.download_url}>下载</a> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="chat-run-context-deliverable-empty">
                <strong>{latestAssistantMessage ? '回答已生成' : '还没有交付成果'}</strong>
                <p>{latestAssistantMessage ? '可在回答卡片中复制、保存或导出。' : '完成任务后，生成的 Word、Excel 或 Markdown 会出现在这里。'}</p>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <footer
        aria-label="任务操作"
        className="chat-run-context-footer"
        role="group"
      >
        {(
          (status === 'running' && onStop)
          || ((taskProgress?.stage === 'failed' || taskProgress?.stage === 'stopped') && onRetry)
          || (taskProgress?.stage === 'failed' && onContinueWithoutTools)
        ) ? (
          <div className="chat-run-context-action-group">
            {status === 'running' && onStop ? (
              <button
                className="chat-run-context-action is-stop"
                onClick={onStop}
                type="button"
              >
                <span aria-hidden="true" className="chat-run-context-action-icon">■</span>
                <span>停止任务</span>
              </button>
            ) : null}
            {(taskProgress?.stage === 'failed' || taskProgress?.stage === 'stopped') && onRetry ? (
              <button
                className="chat-run-context-action is-primary"
                onClick={onRetry}
                type="button"
              >
                <span aria-hidden="true" className="chat-run-context-action-icon">↻</span>
                <span>重新运行</span>
              </button>
            ) : null}
            {taskProgress?.stage === 'failed' && onContinueWithoutTools ? (
              <button
                className="chat-run-context-action is-secondary"
                onClick={onContinueWithoutTools}
                type="button"
              >
                <span aria-hidden="true" className="chat-run-context-action-icon">→</span>
                <span>继续普通回答</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {runId && onOpenTaskCenter ? (
          <button
            aria-label="打开任务中心"
            className="chat-run-context-action is-tertiary"
            onClick={() => onOpenTaskCenter(runId)}
            type="button"
          >
            <span>任务中心</span>
            <span aria-hidden="true" className="chat-run-context-action-icon">↗</span>
          </button>
        ) : null}
      </footer>
    </aside>
  );
}
