import { useEffect, useState } from 'react';

import { exportChatWord } from '../api/chat';
import {
  deleteWorkArtifact,
  downloadAgentArtifact,
  downloadWorkArtifactWord,
  getAgentArtifact,
  getWorkArtifactDetail,
  getWorkArtifacts,
  listAgentArtifacts,
  listAgentArtifactVersions,
  type AgentArtifactExportFormat,
  type AgentArtifactPayload,
  type WorkArtifactDetailPayload,
  type WorkArtifactItemPayload,
} from '../api/client';
import { CitationList, type CitationRef } from '../components/CitationPreviewDrawer';
import { OutputReader } from '../components/OutputReader';

type HistoryTab = 'work' | 'agent';

const AGENT_EXPORT_FORMATS: Array<{ fmt: AgentArtifactExportFormat; label: string }> = [
  { fmt: 'docx', label: 'Word' },
  { fmt: 'xlsx', label: 'Excel' },
  { fmt: 'pptx', label: 'PPT' },
  { fmt: 'pdf', label: 'PDF' },
  { fmt: 'md', label: 'Markdown' },
];

type HistoryPageProps = {
  initialTab?: HistoryTab;
  focusAgentArtifactId?: string;
  onOpenTask?: (runId: string) => void;
};

export function HistoryPage({
  initialTab = 'work',
  focusAgentArtifactId = '',
  onOpenTask,
}: HistoryPageProps = {}) {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const [items, setItems] = useState<WorkArtifactItemPayload[]>([]);
  const [agentItems, setAgentItems] = useState<AgentArtifactPayload[]>([]);
  const [detail, setDetail] = useState<WorkArtifactDetailPayload | null>(null);
  const [agentDetail, setAgentDetail] = useState<AgentArtifactPayload | null>(null);
  const [agentVersions, setAgentVersions] = useState<
    Array<{ version: number; change_summary: string; is_active: boolean; content_preview: string }>
  >([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState('');
  const [pendingDeleteUuid, setPendingDeleteUuid] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    setError('');
    if (tab === 'work') {
      getWorkArtifacts({
        artifactType: typeFilter,
        createdFrom: dateFrom ? `${dateFrom}T00:00:00` : '',
        createdTo: dateTo ? `${dateTo}T23:59:59` : '',
      })
        .then((payload) => {
          if (active) setItems(payload.items);
        })
        .catch(() => {
          if (active) setError('工作成果加载失败');
        });
    } else {
      listAgentArtifacts()
        .then(async (payload) => {
          if (!active) return;
          const list = payload.items || [];
          setAgentItems(list);
          if (focusAgentArtifactId) {
            const hit = list.find((item) => item.artifact_id === focusAgentArtifactId);
            if (hit) {
              try {
                const full = await getAgentArtifact(hit.artifact_id);
                if (!active) return;
                setAgentDetail(full);
                try {
                  const resp = await listAgentArtifactVersions(hit.artifact_id);
                  setAgentVersions(resp.items || []);
                } catch {
                  setAgentVersions([]);
                }
              } catch {
                /* ignore focus load error */
              }
            }
          }
        })
        .catch(() => {
          if (active) setError('任务成果加载失败');
        });
    }
    return () => {
      active = false;
    };
  }, [tab, typeFilter, dateFrom, dateTo, focusAgentArtifactId]);

  const selectItem = async (item: WorkArtifactItemPayload) => {
    setError('');
    setPendingDeleteUuid('');
    setDownloadStatus('');
    setAgentDetail(null);
    setAgentVersions([]);
    try {
      setDetail(await getWorkArtifactDetail(item.artifact_uuid));
    } catch {
      setError('工作成果读取失败');
    }
  };

  const selectAgentItem = async (item: AgentArtifactPayload) => {
    setError('');
    setDownloadStatus('');
    setDetail(null);
    try {
      const full = await getAgentArtifact(item.artifact_id);
      setAgentDetail(full);
      try {
        const resp = await listAgentArtifactVersions(item.artifact_id);
        setAgentVersions(resp.items || []);
      } catch {
        setAgentVersions([]);
      }
    } catch {
      setError('任务成果读取失败');
    }
  };

  const remove = async () => {
    if (!detail) return;
    if (pendingDeleteUuid !== detail.artifact_uuid) {
      setPendingDeleteUuid(detail.artifact_uuid);
      return;
    }
    const uuid = detail.artifact_uuid;
    try {
      await deleteWorkArtifact(uuid);
      setItems((current) => current.filter((item) => item.artifact_uuid !== uuid));
      setDetail(null);
      setPendingDeleteUuid('');
    } catch {
      setError('删除失败，请重试');
    }
  };

  const copy = async () => {
    const text = detail?.content || agentDetail?.content_markdown;
    if (text) await navigator.clipboard?.writeText(text);
  };

  const download = async () => {
    if (!detail?.download_url) return;
    try {
      const result = await downloadWorkArtifactWord(detail.download_url);
      setDownloadStatus(result.kind === 'desktop' ? `Word 已保存到：${result.path}` : 'Word 已开始下载');
    } catch {
      setDownloadStatus('Word 下载失败，请稍后重试');
    }
  };

  const downloadAgent = async (fmt: AgentArtifactExportFormat) => {
    if (!agentDetail) return;
    try {
      const result = await downloadAgentArtifact(agentDetail.artifact_id, fmt);
      setDownloadStatus(
        result.kind === 'desktop' ? `${fmt.toUpperCase()} 已保存到：${result.path}` : `${fmt.toUpperCase()} 已开始下载`,
      );
    } catch {
      setDownloadStatus(`${fmt.toUpperCase()} 下载失败，请稍后重试`);
    }
  };

  const createNewVersion = async () => {
    if (!detail?.conversation_id || !detail.message_id) return;
    try {
      const result = await exportChatWord({
        conversationId: detail.conversation_id,
        messageId: detail.message_id,
        exportType: 'single_answer',
      });
      setDownloadStatus(result.kind === 'desktop' ? `Word 已保存到：${result.path}` : 'Word 已开始下载');
      const refreshed = await getWorkArtifactDetail(detail.artifact_uuid);
      setDetail(refreshed);
      setItems((current) =>
        current.map((item) => (item.artifact_uuid === refreshed.artifact_uuid ? refreshed : item)),
      );
    } catch {
      setDownloadStatus('新版本生成失败，请稍后重试');
    }
  };

  return (
    <section className="history-page">
      <header className="catalog-heading">
        <div>
          <span className="eyebrow">仅你可见</span>
          <h1>工作成果</h1>
          <p>聊天导出成果与任务 Run 成果（多格式导出）。</p>
        </div>
        <div className="history-filters">
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={tab === 'work' ? 'is-current' : ''}
              onClick={() => {
                setTab('work');
                setAgentDetail(null);
              }}
            >
              聊天成果
            </button>
            <button
              type="button"
              className={tab === 'agent' ? 'is-current' : ''}
              onClick={() => {
                setTab('agent');
                setDetail(null);
              }}
            >
              任务成果
            </button>
          </div>
          {tab === 'work' ? (
            <>
              <select
                aria-label="类型筛选"
                onChange={(event) => setTypeFilter(event.target.value)}
                value={typeFilter}
              >
                <option value="">全部成果</option>
                <option value="word_document">Word 文档</option>
                <option value="ordinary_answer">普通回答</option>
              </select>
              <input
                aria-label="开始日期"
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
              <input
                aria-label="结束日期"
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </>
          ) : null}
        </div>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="history-layout">
        <div className="history-list">
          {tab === 'work'
            ? items.map((item) => (
                <button
                  className={detail?.artifact_uuid === item.artifact_uuid ? 'is-current' : ''}
                  key={item.artifact_uuid}
                  onClick={() => void selectItem(item)}
                  type="button"
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{artifactTypeLabel(item.artifact_type)}</small>
                  </span>
                  <span>
                    <small>{new Date(item.updated_at).toLocaleString()}</small>
                    <em>V{item.version}</em>
                  </span>
                </button>
              ))
            : agentItems.map((item) => (
                <button
                  className={agentDetail?.artifact_id === item.artifact_id ? 'is-current' : ''}
                  key={item.artifact_id}
                  onClick={() => void selectAgentItem(item)}
                  type="button"
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.artifact_type || 'markdown'}</small>
                  </span>
                  <span>
                    <small>{item.run_id ? `Run ${item.run_id.slice(0, 8)}` : '独立成果'}</small>
                    <em>V{item.version}</em>
                  </span>
                </button>
              ))}
          {tab === 'work' && !items.length ? <p className="empty-hint">还没有工作成果。</p> : null}
          {tab === 'agent' && !agentItems.length ? <p className="empty-hint">还没有任务成果。</p> : null}
        </div>
        <article className="history-detail">
          {tab === 'work' && detail ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{artifactTypeLabel(detail.artifact_type)}</span>
                  <h2>{detail.title}</h2>
                </div>
                <span>V{detail.version}</span>
              </header>
              {detail.file_name ? <p className="artifact-file-name">{detail.file_name}</p> : null}
              <OutputReader emptyText={detail.content_summary || '本次成果没有可显示的正文'} text={detail.content} />
              {detail.source_summary.length ? (
                <section className="artifact-sources" aria-label="成果引用来源">
                  <strong>引用来源（点击预览可打开原文）</strong>
                  <CitationList
                    items={detail.source_summary.map(
                      (source): CitationRef => ({
                        file_uuid: source.file_uuid || '',
                        chunk_id: source.chunk_id || '',
                        chunk_index: source.chunk_index,
                        name: source.file_name,
                        file_name: source.file_name,
                        page: source.page_number,
                        page_number: source.page_number,
                        section: source.section_title,
                        section_title: source.section_title,
                        source_type: source.source_type,
                      }),
                    )}
                  />
                </section>
              ) : null}
              {downloadStatus ? <p className="form-success">{downloadStatus}</p> : null}
              <div className="history-actions">
                {detail.download_url ? (
                  <button className="secondary-action" onClick={() => void download()} type="button">
                    下载 Word
                  </button>
                ) : null}
                {detail.artifact_type === 'word_document' && detail.conversation_id && detail.message_id ? (
                  <button className="secondary-action" onClick={() => void createNewVersion()} type="button">
                    生成新版本
                  </button>
                ) : null}
                {detail.content ? (
                  <button className="secondary-action" onClick={() => void copy()} type="button">
                    复制全文
                  </button>
                ) : null}
                <button className="danger-action" onClick={() => void remove()} type="button">
                  {pendingDeleteUuid === detail.artifact_uuid ? '确认删除' : '删除成果'}
                </button>
              </div>
            </>
          ) : null}

          {tab === 'agent' && agentDetail ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">任务成果</span>
                  <h2>{agentDetail.title}</h2>
                </div>
                <span>V{agentDetail.version}</span>
              </header>
              <OutputReader emptyText="本次成果没有可显示的正文" text={agentDetail.content_markdown} />
              {agentDetail.quality ? (
                <section className="artifact-sources" aria-label="质量信息">
                  <strong>质量门禁</strong>
                  <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(agentDetail.quality, null, 2)}
                  </pre>
                </section>
              ) : null}
              {Array.isArray((agentDetail.quality as { citations?: unknown } | null)?.citations) ? (
                <section className="artifact-sources" aria-label="成果引用">
                  <strong>引用来源（点击预览）</strong>
                  <CitationList
                    items={
                      ((agentDetail.quality as { citations: CitationRef[] }).citations ||
                        []) as CitationRef[]
                    }
                  />
                </section>
              ) : null}
              {agentVersions.length ? (
                <section className="artifact-sources" aria-label="版本时间线">
                  <strong>版本时间线</strong>
                  <ul>
                    {agentVersions.map((v) => (
                      <li key={v.version}>
                        <span>
                          V{v.version}
                          {v.is_active ? '（生效）' : ''}
                        </span>
                        <small>{v.change_summary || v.content_preview}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {downloadStatus ? <p className="form-success">{downloadStatus}</p> : null}
              <div className="history-actions" style={{ flexWrap: 'wrap' }}>
                {AGENT_EXPORT_FORMATS.map(({ fmt, label }) => (
                  <button
                    key={fmt}
                    className="secondary-action"
                    onClick={() => void downloadAgent(fmt)}
                    type="button"
                  >
                    导出 {label}
                  </button>
                ))}
                <button className="secondary-action" onClick={() => void copy()} type="button">
                  复制全文
                </button>
                {agentDetail.run_id && onOpenTask ? (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={() => onOpenTask(agentDetail.run_id)}
                  >
                    查看来源任务
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {!detail && !agentDetail ? (
            <div className="history-placeholder">
              <strong>选择一条工作成果</strong>
              <span>内容将在选择后安全打开；任务成果支持 Word / Excel / PPT / PDF。</span>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}

function artifactTypeLabel(value: string): string {
  if (value === 'word_document') return 'Word 文档';
  if (value === 'ordinary_answer') return '普通回答';
  return '工作成果';
}
