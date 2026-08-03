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
  sanitizePastedText,
  setDocumentTableColumnWidth,
  splitDocumentTableCell,
  tableCellSpan,
  tableCellRowSpan,
  tableCellText,
  tableRowCells,
  toEditorDocument,
  documentMediaPresentation,
  updateDocumentBlock,
  updateDocumentMedia,
  updateDocumentTableCell,
} from './documentBlockAdapter';

type DocumentBlockEditorProps = {
  content: DeliverableContent;
  disabled?: boolean;
  onChange: (content: DeliverableContent) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  containerRef?: RefObject<HTMLDivElement | null>;
  locatedBlockId?: string | null;
  ariaLabel?: string;
  onPreviewMedia?: (block: DeliverableBlock) => void;
  onDeleteMedia?: (block: DeliverableBlock) => void;
  onRequestDeleteBlock?: (block: DeliverableBlock) => void;
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
type DropTarget = { blockId: string; position: 'before' | 'after' };
type TableNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

function insertTextAtSelection(element: HTMLElement, text: string): string {
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  if (!selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) {
    element.textContent = `${element.textContent ?? ''}${text}`;
    return element.textContent ?? '';
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return element.textContent ?? '';
}

function insertTextAtInputSelection(input: HTMLInputElement, text: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  const cursor = start + text.length;
  input.value = next;
  input.setSelectionRange(cursor, cursor);
  return next;
}

function focusTableInput(input: HTMLInputElement, key: TableNavigationKey): boolean {
  const cell = input.closest('td');
  const row = cell?.parentElement;
  const table = input.closest('table');
  if (!cell || !row || !table) return false;

  const rows = Array.from(table.tBodies[0]?.rows ?? []);
  const tableRow = row as HTMLTableRowElement;
  const rowIndex = rows.indexOf(tableRow);
  const cellIndex = Array.from(tableRow.cells).indexOf(cell as HTMLTableCellElement);
  if (rowIndex < 0 || cellIndex < 0) return false;

  let targetCell: HTMLTableCellElement | undefined;
  if (key === 'ArrowLeft') targetCell = tableRow.cells[cellIndex - 1];
  if (key === 'ArrowRight') targetCell = tableRow.cells[cellIndex + 1];
  if (key === 'Home') targetCell = tableRow.cells[0];
  if (key === 'End') targetCell = tableRow.cells[tableRow.cells.length - 1];
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const targetRow = rows[rowIndex + (key === 'ArrowUp' ? -1 : 1)];
    if (targetRow) targetCell = targetRow.cells[Math.min(cellIndex, targetRow.cells.length - 1)];
  }

  const targetInput = targetCell?.querySelector<HTMLInputElement>('input');
  if (!targetInput || targetInput === input) return false;
  targetInput.focus();
  targetInput.select();
  return true;
}

export function DocumentBlockEditor({
  content,
  disabled = false,
  onChange,
  textareaRef,
  containerRef,
  locatedBlockId = null,
  ariaLabel = '成果正文',
  onPreviewMedia,
  onDeleteMedia,
  onRequestDeleteBlock,
}: DocumentBlockEditorProps) {
  const document = useMemo(() => toEditorDocument(content), [content]);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const draggedBlockIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const [selectedTableCell, setSelectedTableCell] = useState<TableCellSelection | null>(null);
  const [past, setPast] = useState<DeliverableContent[]>([]);
  const [future, setFuture] = useState<DeliverableContent[]>([]);
  const documentSignature = useMemo(() => JSON.stringify(document), [document]);
  const lastEmittedSignature = useRef<string | null>(null);
  const composingBlockIdRef = useRef<string | null>(null);
  const editableBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    document.blocks.forEach((block) => {
      if (!['paragraph', 'list', 'quote', 'notice'].includes(block.type) || typeof block.text !== 'string') return;
      const element = editableBlockRefs.current[block.block_id];
      if (!element || element === window.document.activeElement) return;
      if ((element.textContent ?? '') !== block.text) element.textContent = block.text;
    });
  }, [document]);

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

  const setActiveDropTarget = (next: DropTarget | null) => {
    dropTargetRef.current = next;
    setDropTarget(next);
  };

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
          onCompositionEnd={(event) => {
            composingBlockIdRef.current = null;
            commitChange(updateDocumentBlock(
              document,
              block.block_id,
              { text: sanitizePastedText(event.currentTarget.textContent ?? '') },
            ));
          }}
          onCompositionStart={() => {
            composingBlockIdRef.current = block.block_id;
          }}
          onInput={(event) => {
            if (composingBlockIdRef.current === block.block_id) return;
            commitChange(updateDocumentBlock(
              document,
              block.block_id,
              { text: sanitizePastedText(event.currentTarget.textContent ?? '') },
            ));
          }}
          onPaste={(event) => {
            event.preventDefault();
            const pasted = sanitizePastedText(event.clipboardData.getData('text/plain'));
            const text = insertTextAtSelection(event.currentTarget, pasted);
            commitChange(updateDocumentBlock(document, block.block_id, { text }));
          }}
          role="textbox"
          ref={(element) => {
            editableBlockRefs.current[block.block_id] = element;
            if (element && element !== window.document.activeElement && (element.textContent ?? '') !== block.text) {
              element.textContent = block.text ?? '';
            }
          }}
          suppressContentEditableWarning
        />
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
              aria-label={`表格 ${block.block_id} 向下合并单元格`}
              className="professional-quiet-button"
              disabled={disabled || selection.rowIndex >= rows.length - 1}
              onClick={() => tableAction(mergeDocumentTableCells(
                document,
                block.block_id,
                selection.rowIndex,
                selection.columnIndex,
                'down',
              ))}
              type="button"
            >合并下方</button>
            <button
              aria-label={`表格 ${block.block_id} 拆分单元格`}
              className="professional-quiet-button"
              disabled={disabled || tableCellSpan(selectedCell) <= 1}
              onClick={() => tableAction(splitDocumentTableCell(document, block.block_id, selection.rowIndex, selection.columnIndex))}
              type="button"
            >拆分</button>
            <button
              aria-label={`表格 ${block.block_id} 纵向拆分单元格`}
              className="professional-quiet-button"
              disabled={disabled || tableCellRowSpan(selectedCell) <= 1}
              onClick={() => tableAction(splitDocumentTableCell(
                document,
                block.block_id,
                selection.rowIndex,
                selection.columnIndex,
                'vertical',
              ))}
              type="button"
            >纵向拆分</button>
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
                      rowSpan={tableCellRowSpan(cell)}
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
                        onPaste={(event) => {
                          event.preventDefault();
                          const pasted = sanitizePastedText(event.clipboardData.getData('text/plain'), { singleLine: true });
                          const value = insertTextAtInputSelection(event.currentTarget, pasted);
                          commitChange(updateDocumentTableCell(document, block.block_id, rowIndex, columnIndex, value));
                        }}
                        onKeyDown={(event) => {
                          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                          if (focusTableInput(event.currentTarget, event.key as TableNavigationKey)) event.preventDefault();
                        }}
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
      const presentation = documentMediaPresentation(block);
      const commitMediaChange = (patch: Parameters<typeof updateDocumentMedia>[2]) => {
        commitChange(updateDocumentMedia(document, block.block_id, patch));
      };
      return (
        <div className="document-block-editor-media">
          <div
            className={`document-block-editor-media-figure is-align-${presentation.alignment}`}
          >
            {url ? (
              <img
                alt={presentation.alt}
                src={url}
                style={{ width: presentation.width ? `${presentation.width}px` : undefined }}
              />
            ) : <span className="document-block-editor-media-placeholder">{presentation.alt}</span>}
          </div>
          <div className="document-block-editor-media-info">
            <strong>{presentation.alt}</strong>
            <div className="document-block-editor-media-properties" aria-label={`图片 ${block.block_id} 属性`}>
              <label>
                <span>替代文本</span>
                <input
                  aria-label={`图片 ${block.block_id} 替代文本`}
                  disabled={disabled}
                  onChange={(event) => commitMediaChange({ alt: event.target.value })}
                  value={presentation.alt}
                />
              </label>
              <label>
                <span>宽度</span>
                <input
                  aria-label={`图片 ${block.block_id} 宽度`}
                  disabled={disabled}
                  min={40}
                  max={1200}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    commitMediaChange({ width: value ? Number(value) : null });
                  }}
                  placeholder="自动"
                  type="number"
                  value={presentation.width ?? ''}
                />
              </label>
              <label>
                <span>对齐</span>
                <select
                  aria-label={`图片 ${block.block_id} 对齐方式`}
                  disabled={disabled}
                  onChange={(event) => commitMediaChange({ alignment: event.target.value as 'left' | 'center' | 'right' })}
                  value={presentation.alignment}
                >
                  <option value="left">左对齐</option>
                  <option value="center">居中</option>
                  <option value="right">右对齐</option>
                </select>
              </label>
            </div>
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
              {onDeleteMedia && !onRequestDeleteBlock ? (
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
    <div className="document-block-editor" data-testid="document-block-editor" ref={containerRef}>
      <div className="document-block-editor-canvas" aria-label="结构化区块">
        {document.blocks.map((block) => (
          <article
            aria-describedby="document-block-editor-keyboard-help"
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            aria-label={`${blockLabel(block)}区块 ${block.block_id}`}
            className={`document-block-editor-block is-${block.type}${draggedBlockId === block.block_id ? ' is-dragged' : ''}${dropTarget?.blockId === block.block_id ? ` is-drop-${dropTarget.position}` : ''}${locatedBlockId === block.block_id ? ' is-located' : ''}`}
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
              setActiveDropTarget(null);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              if (dropTarget?.blockId === block.block_id) setActiveDropTarget(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              const sourceBlockId = draggedBlockIdRef.current ?? draggedBlockId;
              if (disabled || !sourceBlockId || sourceBlockId === block.block_id) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const position = rect.height > 0 && event.clientY >= rect.top + rect.height / 2
                ? 'after'
                : 'before';
              setActiveDropTarget({ blockId: block.block_id, position });
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            }}
            onDragStart={() => {
              draggedBlockIdRef.current = block.block_id;
              setDraggedBlockId(block.block_id);
              setActiveDropTarget(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceBlockId = draggedBlockIdRef.current ?? draggedBlockId;
              const target = dropTargetRef.current?.blockId === block.block_id
                ? dropTargetRef.current
                : { blockId: block.block_id, position: 'before' as const };
              if (sourceBlockId) commitChange(reorderDocumentBlocks(document, sourceBlockId, block.block_id, target.position));
              draggedBlockIdRef.current = null;
              setDraggedBlockId(null);
              setActiveDropTarget(null);
            }}
          >
            {dropTarget?.blockId === block.block_id && dropTarget.position === 'before' ? (
              <div aria-label={`放置到区块 ${block.block_id} 前`} className="document-block-editor-drop-indicator" />
            ) : null}
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
                {onRequestDeleteBlock ? (
                  <button
                    aria-label={`删除区块 ${block.block_id}`}
                    className="professional-quiet-button is-danger"
                    disabled={disabled || document.blocks.length <= 1}
                    onClick={() => onRequestDeleteBlock(block)}
                    type="button"
                  >删</button>
                ) : null}
              </div>
            </div>
            {block.type !== 'image' && block.type !== 'media' ? (
              <div className="document-block-editor-preview">{blockPreview(block)}</div>
            ) : null}
            {renderBlockEditor(block)}
            {dropTarget?.blockId === block.block_id && dropTarget.position === 'after' ? (
              <div aria-label={`放置到区块 ${block.block_id} 后`} className="document-block-editor-drop-indicator" />
            ) : null}
          </article>
        ))}
      </div>
      <p className="document-block-editor-keyboard-help" id="document-block-editor-keyboard-help">
        选中区块后可用 Alt+↑/↓ 调整顺序；表格单元格可用方向键、Home、End 移动；拖拽时会显示放置到目标区块前或后的落点。
      </p>
      <div className="document-block-editor-input">
        <label className="professional-editor-field document-block-editor-compatibility-field">
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
