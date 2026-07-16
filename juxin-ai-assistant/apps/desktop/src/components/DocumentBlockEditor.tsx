import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { DeliverableBlock, DeliverableContent } from '../api/deliverables';
import {
  appendBlock,
  blocksToPlainText,
  insertDocumentTableColumn,
  insertDocumentTableRow,
  mergeDocumentTableCells,
  moveDocumentBlockToEdge,
  moveDocumentBlock,
  removeDocumentTableColumn,
  removeDocumentTableRow,
  reorderDocumentBlocks,
  replaceEditableText,
  setDocumentTableColumnWidth,
  splitDocumentTableCell,
  tableCellSpan,
  tableCellText,
  tableRowCells,
  toEditorDocument,
  updateDocumentBlock,
  updateDocumentTableCell,
} from './documentBlockAdapter';

type DocumentBlockEditorProps = {
  content: DeliverableContent;
  disabled?: boolean;
  onChange: (content: DeliverableContent) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  ariaLabel?: string;
  onPreviewMedia?: (block: DeliverableBlock) => void;
  onDeleteMedia?: (block: DeliverableBlock) => void;
};

function blockLabel(block: DeliverableBlock): string {
  if (block.type === 'heading') return '标题';
  if (block.type === 'table') return '表格';
  if (block.type === 'image' || block.type === 'media') return '图片';
  if (block.type === 'list') return '列表';
  if (block.type === 'quote') return '引用';
  if (block.type === 'divider') return '分隔线';
  if (block.type === 'notice') return '提示';
  return '段落';
}

function blockPreview(block: DeliverableBlock): string {
  if (typeof block.text === 'string' && block.text.trim()) return block.text.trim();
  if (block.type === 'table') {
    const rows = Array.isArray(block.rows) ? block.rows.length : 0;
    return rows ? `${rows} 行结构化表格` : '空表格';
  }
  if (block.type === 'image' || block.type === 'media') return String(block.alt ?? block.url ?? '图片占位');
  return '空段落';
}

function tableRows(block: DeliverableBlock): unknown[][] {
  if (!Array.isArray(block.rows)) return [];
  return block.rows.map((row) => tableRowCells(row) ?? []);
}

type TableCellSelection = { blockId: string; rowIndex: number; columnIndex: number };

export function DocumentBlockEditor({
  content,
  disabled = false,
  onChange,
  textareaRef,
  ariaLabel = '成果正文',
  onPreviewMedia,
  onDeleteMedia,
}: DocumentBlockEditorProps) {
  const document = useMemo(() => toEditorDocument(content), [content]);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const draggedBlockIdRef = useRef<string | null>(null);
  const [selectedTableCell, setSelectedTableCell] = useState<TableCellSelection | null>(null);
  const [past, setPast] = useState<DeliverableContent[]>([]);
  const [future, setFuture] = useState<DeliverableContent[]>([]);
  const documentSignature = useMemo(() => JSON.stringify(document), [document]);
  const lastEmittedSignature = useRef<string | null>(null);

  useEffect(() => {
    if (lastEmittedSignature.current === null) {
      lastEmittedSignature.current = documentSignature;
      return;
    }
    if (lastEmittedSignature.current !== documentSignature) {
      setPast([]);
      setFuture([]);
      lastEmittedSignature.current = documentSignature;
    }
  }, [documentSignature]);

  const commitChange = useCallback((next: DeliverableContent) => {
    const normalized = toEditorDocument(next);
    if (JSON.stringify(normalized) === documentSignature) return;
    setPast((history) => [...history.slice(-19), document]);
    setFuture([]);
    lastEmittedSignature.current = JSON.stringify(normalized);
    onChange(normalized);
  }, [document, documentSignature, onChange]);

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [document, ...history].slice(0, 20));
    lastEmittedSignature.current = JSON.stringify(previous);
    onChange(previous);
  }, [document, onChange, past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture((history) => history.slice(1));
    setPast((history) => [...history.slice(-19), document]);
    lastEmittedSignature.current = JSON.stringify(next);
    onChange(next);
  }, [document, future, onChange]);

  const plainText = blocksToPlainText(document);

  const renderBlockEditor = (block: DeliverableBlock) => {
    if (block.type === 'heading') {
      return (
        <input
          aria-label={`标题：${block.block_id}`}
          className="document-block-editor-inline-input is-heading"
          disabled={disabled}
          onChange={(event) => commitChange(updateDocumentBlock(document, block.block_id, { text: event.target.value }))}
          value={String(block.text ?? '')}
        />
      );
    }
    if (['paragraph', 'list', 'quote', 'notice'].includes(block.type) && typeof block.text === 'string') {
      return (
        <div
          aria-label={`${blockLabel(block)}：${block.block_id}`}
          className={`document-block-editor-inline-input is-${block.type}`}
          contentEditable={!disabled}
          onInput={(event) => commitChange(updateDocumentBlock(
            document,
            block.block_id,
            { text: event.currentTarget.textContent ?? '' },
          ))}
          role="textbox"
          suppressContentEditableWarning
        >
          {block.text}
        </div>
      );
    }
    if (block.type === 'divider') {
      return <hr aria-label={`分隔线：${block.block_id}`} className="document-block-editor-divider" />;
    }
    if (block.type === 'table') {
      const rows = tableRows(block);
      if (!rows.length) return <p>{blockPreview(block)}</p>;
      const selection = selectedTableCell?.blockId === block.block_id
        ? selectedTableCell
        : { blockId: block.block_id, rowIndex: 0, columnIndex: 0 };
      const selectedRow = rows[selection.rowIndex] ?? [];
      const selectedCell = selectedRow[selection.columnIndex];
      const tableAction = (next: DeliverableContent) => commitChange(next);
      return (
        <div className="document-block-editor-table-wrap">
          <div className="document-block-editor-table-actions" aria-label={`表格 ${block.block_id} 工具`}>
            <button
              aria-label={`表格 ${block.block_id} 新增行`}
              className="professional-quiet-button"
              disabled={disabled}
              onClick={() => tableAction(insertDocumentTableRow(document, block.block_id, selection.rowIndex + 1))}
              type="button"
            >+ 行</button>
            <button
              aria-label={`表格 ${block.block_id} 删除行`}
              className="professional-quiet-button"
              disabled={disabled || rows.length <= 1}
              onClick={() => tableAction(removeDocumentTableRow(document, block.block_id, selection.rowIndex))}
              type="button"
            >− 行</button>
            <button
              aria-label={`表格 ${block.block_id} 新增列`}
              className="professional-quiet-button"
              disabled={disabled}
              onClick={() => tableAction(insertDocumentTableColumn(document, block.block_id, selection.columnIndex + 1))}
              type="button"
            >+ 列</button>
            <button
              aria-label={`表格 ${block.block_id} 删除列`}
              className="professional-quiet-button"
              disabled={disabled || Math.max(1, ...rows.map((row) => row.length)) <= 1}
              onClick={() => tableAction(removeDocumentTableColumn(document, block.block_id, selection.columnIndex))}
              type="button"
            >− 列</button>
            <button
              aria-label={`表格 ${block.block_id} 合并单元格`}
              className="professional-quiet-button"
              disabled={disabled || selection.columnIndex >= selectedRow.length - 1}
              onClick={() => tableAction(mergeDocumentTableCells(document, block.block_id, selection.rowIndex, selection.columnIndex))}
              type="button"
            >合并右侧</button>
            <button
              aria-label={`表格 ${block.block_id} 拆分单元格`}
              className="professional-quiet-button"
              disabled={disabled || tableCellSpan(selectedCell) <= 1}
              onClick={() => tableAction(splitDocumentTableCell(document, block.block_id, selection.rowIndex, selection.columnIndex))}
              type="button"
            >拆分</button>
            <button
              aria-label={`表格 ${block.block_id} 列宽增加`}
              className="professional-quiet-button"
              disabled={disabled}
              onClick={() => tableAction(setDocumentTableColumnWidth(document, block.block_id, selection.columnIndex, 200))}
              type="button"
            >列宽 +</button>
            <button
              aria-label={`表格 ${block.block_id} 列宽减少`}
              className="professional-quiet-button"
              disabled={disabled}
              onClick={() => tableAction(setDocumentTableColumnWidth(document, block.block_id, selection.columnIndex, 120))}
              type="button"
            >列宽 −</button>
          </div>
          <table className="document-block-editor-table">
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${block.block_id}-row-${rowIndex}`}>
                  {row.map((cell, columnIndex) => (
                    <td
                      colSpan={tableCellSpan(cell)}
                      key={`${block.block_id}-${rowIndex}-${columnIndex}`}
                      onClick={() => setSelectedTableCell({ blockId: block.block_id, rowIndex, columnIndex })}
                      data-selected={selectedTableCell?.blockId === block.block_id
                        && selectedTableCell.rowIndex === rowIndex
                        && selectedTableCell.columnIndex === columnIndex ? 'true' : undefined}
                    >
                      <input
                        aria-label={`表格：${block.block_id} 第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`}
                        disabled={disabled}
                        onChange={(event) => commitChange(updateDocumentTableCell(
                          document,
                          block.block_id,
                          rowIndex,
                          columnIndex,
                          event.target.value,
                        ))}
                        value={tableCellText(cell)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === 'image' || block.type === 'media') {
      const url = typeof block.url === 'string' ? block.url : '';
      const alt = String(block.alt ?? block.url ?? '图片');
      return (
        <div className="document-block-editor-media">
          {url ? <img alt={alt} src={url} /> : <span className="document-block-editor-media-placeholder">{alt}</span>}
          <div className="document-block-editor-media-info">
            <strong>{alt}</strong>
            <div className="document-block-editor-media-actions">
              {onPreviewMedia ? (
                <button
                  className="professional-quiet-button"
                  disabled={disabled}
                  onClick={() => onPreviewMedia(block)}
                  type="button"
                >
                  预览图片
                </button>
              ) : null}
              {onDeleteMedia ? (
                <button
                  className="professional-quiet-button is-danger"
                  disabled={disabled}
                  onClick={() => onDeleteMedia(block)}
                  type="button"
                >
                  删除图片
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    }
    return <p>{blockPreview(block)}</p>;
  };

  return (
    <div className="document-block-editor" data-testid="document-block-editor">
      <div className="document-block-editor-canvas" aria-label="结构化区块">
        {document.blocks.map((block) => (
          <article
            className={`document-block-editor-block is-${block.type}${draggedBlockId === block.block_id ? ' is-dragged' : ''}`}
            data-block-id={block.block_id}
            draggable={!disabled}
            tabIndex={disabled ? -1 : 0}
            key={block.block_id}
            onKeyDown={(event) => {
              if (disabled || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
              event.preventDefault();
              commitChange(moveDocumentBlock(
                document,
                block.block_id,
                event.key === 'ArrowUp' ? 'up' : 'down',
              ));
            }}
            onDragEnd={() => {
              draggedBlockIdRef.current = null;
              setDraggedBlockId(null);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragStart={() => {
              draggedBlockIdRef.current = block.block_id;
              setDraggedBlockId(block.block_id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceBlockId = draggedBlockIdRef.current ?? draggedBlockId;
              if (sourceBlockId) commitChange(reorderDocumentBlocks(document, sourceBlockId, block.block_id));
              draggedBlockIdRef.current = null;
              setDraggedBlockId(null);
            }}
          >
            <div className="document-block-editor-meta">
              <span className="document-block-editor-handle" aria-hidden="true">⋮⋮</span>
              <span>{blockLabel(block)}</span>
              <code>{block.block_id}</code>
              <div className="document-block-editor-move-actions" aria-label={`移动区块 ${block.block_id}`}>
                <button
                  aria-label={`区块 ${block.block_id} 上移`}
                  className="professional-quiet-button"
                  disabled={disabled}
                  onClick={() => commitChange(moveDocumentBlock(document, block.block_id, 'up'))}
                  type="button"
                >↑</button>
                <button
                  aria-label={`区块 ${block.block_id} 下移`}
                  className="professional-quiet-button"
                  disabled={disabled}
                  onClick={() => commitChange(moveDocumentBlock(document, block.block_id, 'down'))}
                  type="button"
                >↓</button>
                <button
                  aria-label={`区块 ${block.block_id} 移到开头`}
                  className="professional-quiet-button"
                  disabled={disabled}
                  onClick={() => commitChange(moveDocumentBlockToEdge(document, block.block_id, 'start'))}
                  type="button"
                >首</button>
                <button
                  aria-label={`区块 ${block.block_id} 移到末尾`}
                  className="professional-quiet-button"
                  disabled={disabled}
                  onClick={() => commitChange(moveDocumentBlockToEdge(document, block.block_id, 'end'))}
                  type="button"
                >末</button>
              </div>
            </div>
            {block.type !== 'image' && block.type !== 'media' ? (
              <div className="document-block-editor-preview">{blockPreview(block)}</div>
            ) : null}
            {renderBlockEditor(block)}
          </article>
        ))}
      </div>
      <div className="document-block-editor-input">
        <label className="professional-editor-field">
          <span>{ariaLabel}</span>
          <textarea
            aria-label={ariaLabel}
            disabled={disabled}
            onChange={(event) => commitChange(replaceEditableText(event.target.value, document))}
            ref={textareaRef}
            spellCheck={false}
            value={plainText}
          />
        </label>
        <div className="document-block-editor-actions">
          <div className="document-block-editor-history" aria-label="编辑历史">
            <button
              aria-label="撤销"
              className="professional-quiet-button"
              disabled={disabled || past.length === 0}
              onClick={undo}
              title="撤销"
              type="button"
            >
              ↶ 撤销
            </button>
            <button
              aria-label="重做"
              className="professional-quiet-button"
              disabled={disabled || future.length === 0}
              onClick={redo}
              title="重做"
              type="button"
            >
              ↷ 重做
            </button>
          </div>
          <div className="document-block-editor-insert-toolbar" aria-label="插入区块">
            <span>插入：</span>
            {([
              ['paragraph', '段落'], ['heading', '标题'], ['list', '列表'], ['table', '表格'],
              ['quote', '引用'], ['divider', '分隔线'], ['notice', '提示'],
            ] as const).map(([type, label]) => (
              <button
                className="professional-quiet-button document-block-editor-add"
                disabled={disabled}
                key={type}
                onClick={() => commitChange(appendBlock(document, type))}
                type="button"
              >
                + {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
