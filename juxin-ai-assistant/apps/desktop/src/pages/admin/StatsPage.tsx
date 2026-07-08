import { useState } from 'react';

import { governanceApi, type StatsPayload, type TaskReplayItem } from '../../api/governance';
import { AdminPageState, RequestNotice } from './AdminPageState';

function percent(value?: number): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function textValue(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function replayVerificationStatus(item: TaskReplayItem): string {
  return labelForStatus(textValue(item.verification_summary.status, 'pending'));
}

function labelForStage(value: unknown): string {
  const labels: Record<string, string> = {
    analyzing: '识别任务',
    building_context: '整理依据',
    checking_sources: '整理来源',
    generating: '生成回答',
    retrieving: '查找资料',
    composing: '生成内容',
    quality_check: '复核结果',
    completed: '已完成',
    failed: '已失败',
  };
  const key = textValue(value, '');
  return labels[key] || key || '未知阶段';
}

function labelForStatus(value: unknown): string {
  const labels: Record<string, string> = {
    success: '成功',
    warning: '需复核',
    passed: '通过',
    risk: '有风险',
    failed: '失败',
    pending: '待检查',
  };
  const key = textValue(value, '');
  return labels[key] || key || '未知';
}

function labelForTool(value: unknown): string {
  const labels: Record<string, string> = {
    company_knowledge_search: '查公司知识',
    personal_knowledge_search: '查我的资料',
    web_search: '联网查找',
    web_fetch: '读取网页',
    word_export: '导出 Word',
    document_parser: '解析文件',
  };
  const key = textValue(value, '');
  return labels[key] || '处理资料';
}

function replaySourceLabel(source: Record<string, unknown>): string {
  const sourceLabels: Record<string, string> = {
    official_knowledge: '公司知识',
    personal_knowledge: '我的资料',
    current_attachment: '当前附件',
    web_search: '联网资料',
  };
  const sourceType = textValue(source.source_type, textValue(source.type, ''));
  return textValue(source.file_name, sourceLabels[sourceType] || sourceType || '来源');
}

function replaySourceCount(tool: Record<string, unknown>): number {
  return numberValue(tool.source_count) || numberValue(tool.count);
}

function replayStageTime(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function replayReferenceSummary(item: TaskReplayItem): string {
  const reference = typeof item.verification_summary.reference === 'object'
    && item.verification_summary.reference !== null
    ? item.verification_summary.reference as Record<string, unknown>
    : {};
  const kept = numberValue(reference.kept_count);
  const missing = numberValue(reference.missing_count);
  if (!kept && !missing) return '引用检查暂无明细';
  return `引用保留 ${kept} 条 · 缺失 ${missing} 条`;
}

function replayDocumentWarnings(item: TaskReplayItem): string[] {
  const document = typeof item.verification_summary.document === 'object'
    && item.verification_summary.document !== null
    ? item.verification_summary.document as Record<string, unknown>
    : {};
  return Array.isArray(document.warnings)
    ? document.warnings.map((warning) => String(warning)).filter(Boolean)
    : [];
}

export function StatsPage({ manager = false }: { manager?: boolean }) {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [taskReplays, setTaskReplays] = useState<TaskReplayItem[]>([]);
  const [notice, setNotice] = useState('');
  const [replayNotice, setReplayNotice] = useState('');
  const refresh = async () => {
    try { setStats(await governanceApi.stats(manager)); setNotice(''); }
    catch { setNotice('统计读取失败，请确认数据范围。'); }
  };
  const loadTaskReplays = async () => {
    try {
      const payload = await governanceApi.taskReplays();
      setTaskReplays(payload.items);
      setReplayNotice(payload.items.length ? '' : '暂无可回放任务。');
    } catch {
      setReplayNotice('任务回放读取失败，请确认治理权限。');
    }
  };
  return (
    <AdminPageState title={manager ? '部门数据' : '全局统计'} description="统计仅聚合状态、任务、部门、时间和反馈元数据。">
      <button className="primary-action" onClick={() => void refresh()} type="button">刷新统计</button>
      <RequestNotice message={notice} />
      <div className="metric-strip">
        <div><span>生成总数</span><strong>{stats?.total ?? '—'}</strong></div>
        <div><span>完成率</span><strong>{percent(stats?.completion_rate)}</strong></div>
        <div><span>失败率</span><strong>{percent(stats?.failure_rate)}</strong></div>
      </div>
      {stats ? (
        <>
          {!manager ? (
            <section className="stats-quality-card" aria-label="Agent 质量指标">
              <div>
                <span>Agent 质量指标</span>
                <p>聚合工具、检索、引用和导出质量，不展示用户正文。</p>
              </div>
              <button className="secondary-action" onClick={() => void loadTaskReplays()} type="button">查看任务回放</button>
              <dl>
                <div><dt>工具调用成功率</dt><dd>{percent(stats.tool_call_success_rate)}</dd><small>{stats.tool_call_success ?? 0}/{stats.tool_call_total ?? 0}</small></div>
                <div><dt>平均工具耗时</dt><dd>{stats.tool_call_average_latency_ms ?? 0}ms</dd><small>仅聚合耗时</small></div>
                <div><dt>知识检索命中率</dt><dd>{percent(stats.knowledge_search_hit_rate)}</dd><small>{stats.knowledge_search_hit ?? 0}/{stats.knowledge_search_total ?? 0}</small></div>
                <div><dt>引用覆盖率</dt><dd>{percent(stats.citation_coverage_rate)}</dd><small>无来源回答 {percent(stats.answer_without_source_rate)}</small></div>
                <div><dt>Word 导出次数</dt><dd>{stats.word_export_total ?? 0}</dd><small>正式文档导出</small></div>
                <div><dt>格式自检通过率</dt><dd>{percent(stats.document_format_pass_rate)}</dd><small>{stats.document_format_check_passed ?? 0}/{stats.document_format_check_total ?? 0}</small></div>
                <div><dt>用户负反馈数</dt><dd>{stats.user_negative_feedback_total ?? 0}</dd><small>没用/需修改/记录错误</small></div>
              </dl>
              {Object.keys(stats.tool_error_distribution || {}).length ? (
                <ul aria-label="工具错误分布">
                  {Object.entries(stats.tool_error_distribution || {}).map(([name, count]) => (
                    <li key={name}><span>{name}</span><strong>{count}</strong></li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {!manager && (taskReplays.length || replayNotice) ? (
            <section className="stats-replay-panel" aria-label="Agent 运行观测台">
              <header>
                <span className="eyebrow">任务回放</span>
                <h2>Agent 运行观测台</h2>
                <p>只展示 Planner 阶段、工具、来源和 Verifier 摘要，不展示用户正文。</p>
              </header>
              <RequestNotice message={replayNotice} />
              <div className="stats-replay-list">
                {taskReplays.map((item) => (
                  <article key={item.task_state_id}>
                    <div>
                      <strong>{item.goal || '未命名任务'}</strong>
                      <span>{labelForStage(item.stage)} · 自检 {replayVerificationStatus(item)}</span>
                    </div>
                    <ul>
                      {(item.tool_summary || []).slice(0, 4).map((tool, index) => (
                        <li key={`${item.task_state_id}-tool-${index}`}>
                          {labelForTool(tool.tool_name)} · {labelForStatus(tool.status)} · 来源 {replaySourceCount(tool)}
                        </li>
                      ))}
                    </ul>
                    <p>
                      {(item.source_summary || []).slice(0, 3).map(replaySourceLabel).join('、') || '暂无来源'}
                    </p>
                    <section className="stats-replay-detail" aria-label={`${item.task_state_id} 运行详情`}>
                      <h3>运行时间线</h3>
                      <ol>
                        {(item.stage_history || []).map((stage, index) => (
                          <li key={`${item.task_state_id}-stage-${index}`}>
                            <strong>{labelForStage(stage.stage)}</strong>
                            <span>{textValue(stage.next_action, '暂无动作')}</span>
                            <small>{replayStageTime(stage.at)}</small>
                          </li>
                        ))}
                      </ol>
                      <h3>Verifier 摘要</h3>
                      <p>{replayReferenceSummary(item)}</p>
                      {replayDocumentWarnings(item).length ? (
                        <ul>
                          {replayDocumentWarnings(item).map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.next_action ? <p>下一步：{item.next_action}</p> : null}
                    </section>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <div className="stats-details">
            <section>
              <h2>部门分布</h2>
              <ul>{Object.entries(stats.by_department || {}).map(([name, count]) => <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul>
            </section>
            <section>
              <h2>任务排行</h2>
              <ol>{(stats.task_ranking || []).map((item) => <li key={item.name}><span>{item.name}</span><strong>{item.count}</strong></li>)}</ol>
            </section>
            <section>
              <h2>每日趋势</h2>
              <ul>{(stats.daily_trend || []).map((item) => <li key={item.date}><span>{item.date}</span><strong>{item.count}</strong></li>)}</ul>
            </section>
            <section>
              <h2>反馈分布</h2>
              <ul>{Object.entries(stats.feedback_distribution || {}).map(([name, count]) => <li key={name}><span>{name}</span><strong>{count}</strong></li>)}</ul>
            </section>
          </div>
        </>
      ) : null}
    </AdminPageState>
  );
}
