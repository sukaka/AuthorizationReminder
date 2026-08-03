/**
 * Unified citation source preview (6.0).
 * Shared by Chat, 任务中心, 工作成果 — office language only.
 */
import { useEffect, useRef, useState } from 'react';

import {
  previewKnowledgeFile,
  type KnowledgeFilePreviewPayload,
} from '../api/chat';

export type CitationRef = {
  citation_id?: string;
  file_uuid?: string;
  name?: string;
  file_name?: string;
  location?: string;
  section?: string;
  section_title?: string;
  page?: number | null;
  page_number?: number | null;
  chunk_id?: string;
  chunk_index?: number | null;
  is_inference?: boolean;
  excerpt?: string;
  source_type?: string;
};

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; citation: CitationRef }
  | { status: 'ready'; citation: CitationRef; preview: KnowledgeFilePreviewPayload }
  | { status: 'error'; citation: CitationRef; message: string };

function resolveFileUuid(citation: CitationRef): string {
  const direct = (citation.file_uuid || '').trim();
  if (direct) return direct;
  const id = (citation.citation_id || '').trim();
  // deep_retrieve uses file_uuid as citation_id when present
  if (id && !id.startsWith('cite-')) return id;
  return '';
}

function isReferencedChunk(
  citation: CitationRef,
  chunk: KnowledgeFilePreviewPayload['chunks'][number],
  index: number,
): boolean {
  if (citation.chunk_id) return citation.chunk_id === chunk.chunk_id;
  if (citation.chunk_index !== null && citation.chunk_index !== undefined) {
    return citation.chunk_index === chunk.chunk_index;
  }
  const page = citation.page_number ?? citation.page;
  if (page !== null && page !== undefined) return page === chunk.page_number;
  const section = citation.section_title || citation.section;
  if (section) return section === chunk.section_title;
  return index === 0;
}

function chunkTitle(chunk: KnowledgeFilePreviewPayload['chunks'][number]): string {
  const parts = [
    chunk.section_title?.trim() || '',
    chunk.page_or_sheet?.trim() || '',
    chunk.page_number != null ? `第 ${chunk.page_number} 页` : '',
  ].filter(Boolean);
  return parts.join(' · ') || `片段 ${chunk.chunk_index + 1}`;
}

function displayName(citation: CitationRef): string {
  return citation.file_name?.trim() || citation.name?.trim() || '知识来源';
}

export type CitationPreviewDrawerProps = {
  citation: CitationRef | null;
  open: boolean;
  onClose: () => void;
};

export function CitationPreviewDrawer({ citation, open, onClose }: CitationPreviewDrawerProps) {
  const [state, setState] = useState<PreviewState>({ status: 'idle' });
  const highlightRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || !citation) {
      setState({ status: 'idle' });
      return;
    }
    const fileUuid = resolveFileUuid(citation);
    if (!fileUuid) {
      setState({
        status: 'error',
        citation,
        message: '该来源缺少文件标识，暂时无法打开原文预览。',
      });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', citation });
    void previewKnowledgeFile(fileUuid, {
      chunkId: citation.chunk_id,
      topK: citation.chunk_id ? 1 : 5,
    })
      .then((preview) => {
        if (!cancelled) setState({ status: 'ready', citation, preview });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'error',
            citation,
            message: '来源预览加载失败，请稍后重试。',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, citation]);

  useEffect(() => {
    if (state.status !== 'ready') return;
    highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [state]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="chat-source-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside aria-label="来源预览" aria-modal="true" className="chat-source-preview" role="dialog">
        <div className="chat-source-preview-header">
          <div>
            <span className="chat-source-preview-icon" aria-hidden="true">
              ⌘
            </span>
            <div>
              <strong>来源预览</strong>
              <small>引用位置已高亮，可滚动查看原始资料</small>
            </div>
          </div>
          <button aria-label="关闭来源预览" autoFocus onClick={onClose} type="button">
            ×
          </button>
        </div>
        {state.status === 'loading' ? (
          <div className="chat-source-preview-state">
            <span className="button-spinner" />
            正在打开来源片段…
          </div>
        ) : null}
        {state.status === 'error' ? (
          <p className="chat-source-preview-state" role="status">
            {state.message}
          </p>
        ) : null}
        {state.status === 'ready' ? (
          <div className="chat-source-preview-body">
            <div className="chat-source-preview-document">
              <span>来源文件</span>
              <h3>{state.preview.file_name || displayName(state.citation)}</h3>
              <p>{state.preview.notice}</p>
              {state.citation.is_inference ? (
                <p className="chat-source-preview-inference">该片段含推断表述，请以原文为准。</p>
              ) : null}
              {state.citation.excerpt ? (
                <p className="chat-source-preview-excerpt">摘要：{state.citation.excerpt}</p>
              ) : null}
            </div>
            {state.preview.chunks.map((chunk, index) => {
              const referenced = isReferencedChunk(state.citation, chunk, index);
              return (
                <article
                  key={chunk.chunk_id}
                  className={`chat-source-preview-chunk${referenced ? ' is-referenced' : ''}`}
                  ref={referenced ? highlightRef : undefined}
                >
                  <strong>{chunkTitle(chunk)}</strong>
                  {referenced ? <span className="chat-source-highlight-label">本次引用</span> : null}
                  <p>{referenced ? <mark>{chunk.text}</mark> : chunk.text}</p>
                </article>
              );
            })}
            {!state.preview.chunks.length ? (
              <p className="chat-source-preview-state">该文件暂无可预览文本片段。</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

/** Clickable citation list for task/artifact surfaces. */
export function CitationList({
  items,
  emptyText = '暂无引用来源',
}: {
  items: CitationRef[];
  emptyText?: string;
}) {
  const [active, setActive] = useState<CitationRef | null>(null);
  if (!items.length) {
    return <p className="citation-list-empty">{emptyText}</p>;
  }
  return (
    <>
      <ul>
        {items.map((c, idx) => {
          const fileUuid = resolveFileUuid(c);
          const label = displayName(c);
          const meta = [
            c.location,
            c.section || c.section_title,
            (c.page ?? c.page_number) != null ? `第 ${c.page ?? c.page_number} 页` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={`${c.citation_id || c.name || idx}-${idx}`}>
              <span>
                {fileUuid ? (
                  <button
                    type="button"
                    className="secondary-action citation-list-preview-button"
                    onClick={() => setActive(c)}
                  >
                    预览
                  </button>
                ) : null}
                {label}
                {c.is_inference ? '（推断）' : ''}
              </span>
              {meta ? <small>{meta}</small> : null}
              {c.excerpt ? (
                <div className="citation-list-excerpt">{c.excerpt}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <CitationPreviewDrawer
        open={Boolean(active)}
        citation={active}
        onClose={() => setActive(null)}
      />
    </>
  );
}
