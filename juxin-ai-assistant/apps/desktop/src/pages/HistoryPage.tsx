import { useEffect, useState } from 'react';

import { exportChatWord } from '../api/chat';
import {
  deleteWorkArtifact,
  downloadWorkArtifactWord,
  getWorkArtifactDetail,
  getWorkArtifacts,
  type WorkArtifactDetailPayload,
  type WorkArtifactItemPayload,
} from '../api/client';
import { OutputReader } from '../components/OutputReader';

export function HistoryPage() {
  const [items, setItems] = useState<WorkArtifactItemPayload[]>([]);
  const [detail, setDetail] = useState<WorkArtifactDetailPayload | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');
  const [pendingDeleteUuid, setPendingDeleteUuid] = useState('');
  const [downloadStatus, setDownloadStatus] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    getWorkArtifacts()
      .then((payload) => {
        if (active) {
          setItems(payload.items);
        }
      })
      .catch(() => {
        if (active) setError('工作成果加载失败');
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = typeFilter
    ? items.filter((item) => item.artifact_type === typeFilter)
    : items;

  const selectItem = async (item: WorkArtifactItemPayload) => {
    setError('');
    setPendingDeleteUuid('');
    setDownloadStatus('');
    try {
      setDetail(await getWorkArtifactDetail(item.artifact_uuid));
    } catch {
      setError('工作成果读取失败');
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
    if (detail?.content) await navigator.clipboard?.writeText(detail.content);
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
      setItems((current) => current.map((item) => (
        item.artifact_uuid === refreshed.artifact_uuid ? refreshed : item
      )));
    } catch {
      setDownloadStatus('新版本生成失败，请稍后重试');
    }
  };

  return (
    <section className="history-page">
      <header className="catalog-heading">
        <div><span className="eyebrow">仅你可见</span><h1>工作成果</h1><p>这里保存你生成过的材料、纪要、报告和文档成果。</p></div>
        <div className="history-filters">
          <select aria-label="类型筛选" onChange={(event) => setTypeFilter(event.target.value)} value={typeFilter}>
            <option value="">全部成果</option>
            <option value="word_document">Word 文档</option>
            <option value="ordinary_answer">普通回答</option>
          </select>
        </div>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="history-layout">
        <div className="history-list">
          {visibleItems.map((item) => (
            <button className={detail?.artifact_uuid === item.artifact_uuid ? 'is-current' : ''} key={item.artifact_uuid} onClick={() => selectItem(item)} type="button">
              <span><strong>{item.title}</strong><small>{artifactTypeLabel(item.artifact_type)}</small></span>
              <span><small>{new Date(item.updated_at).toLocaleString()}</small><em>V{item.version}</em></span>
            </button>
          ))}
          {!visibleItems.length ? <p className="empty-hint">还没有工作成果。</p> : null}
        </div>
        <article className="history-detail">
          {detail ? (
            <>
              <header><div><span className="eyebrow">{artifactTypeLabel(detail.artifact_type)}</span><h2>{detail.title}</h2></div><span>V{detail.version}</span></header>
              {detail.file_name ? <p className="artifact-file-name">{detail.file_name}</p> : null}
              <OutputReader emptyText={detail.content_summary || '本次成果没有可显示的正文'} text={detail.content} />
              {detail.source_summary.length ? (
                <section className="artifact-sources" aria-label="成果引用来源">
                  <strong>引用来源</strong>
                  <ul>
                    {detail.source_summary.map((source) => (
                      <li key={`${source.source_type}-${source.file_name}-${source.page_number || ''}-${source.section_title || ''}`}>
                        <span>{source.file_name}</span>
                        {source.page_number || source.section_title ? (
                          <small>{[
                            source.page_number ? `第 ${source.page_number} 页` : '',
                            source.section_title || '',
                          ].filter(Boolean).join(' · ')}</small>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {downloadStatus ? <p className="form-success">{downloadStatus}</p> : null}
              <div className="history-actions">
                {detail.download_url ? <button className="secondary-action" onClick={download} type="button">下载 Word</button> : null}
                {detail.artifact_type === 'word_document' && detail.conversation_id && detail.message_id ? (
                  <button className="secondary-action" onClick={createNewVersion} type="button">生成新版本</button>
                ) : null}
                {detail.content ? <button className="secondary-action" onClick={copy} type="button">复制全文</button> : null}
                <button className="danger-action" onClick={remove} type="button">
                  {pendingDeleteUuid === detail.artifact_uuid ? '确认删除' : '删除成果'}
                </button>
              </div>
            </>
          ) : <div className="history-placeholder"><strong>选择一条工作成果</strong><span>内容将在选择后安全打开。</span></div>}
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
