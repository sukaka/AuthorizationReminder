import type { DeliverableBlock, DeliverableContent } from '../api/deliverables';

/**
 * The editor only mutates the document shape.  It does not own a second
 * document model, which keeps V1 payloads readable and makes migration
 * happen at the save boundary.
 */
export function toEditorDocument(content: DeliverableContent): DeliverableContent {
  const usedIds = new Set<string>();
  const blocks = content.blocks.map((block, index) => {
    const candidate = typeof block.block_id === 'string' && block.block_id.trim()
      ? block.block_id
      : `legacy-block-${index + 1}`;
    let blockId = candidate;
    let suffix = 2;
    while (usedIds.has(blockId)) {
      blockId = `${candidate}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(blockId);
    return { ...block, block_id: blockId };
  });
  return { ...content, schema_version: '2', blocks };
}

export function editableBlocks(content: DeliverableContent): DeliverableBlock[] {
  return content.blocks.filter((block) => block.type !== 'heading' && typeof block.text === 'string');
}

export function blocksToPlainText(content: DeliverableContent): string {
  return editableBlocks(content)
    .map((block) => String(block.text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Replace only text-bearing blocks, preserving headings, tables, media and IDs. */
export function replaceEditableText(text: string, current: DeliverableContent): DeliverableContent {
  const normalized = toEditorDocument(current);
  const parts = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const usedIds = new Set(normalized.blocks.map((block) => block.block_id));
  let partIndex = 0;
  const blocks = normalized.blocks.flatMap((block) => {
    if (block.type === 'heading' || typeof block.text !== 'string') return [block];
    const nextText = parts[partIndex];
    partIndex += 1;
    return nextText === undefined ? [] : [{ ...block, text: nextText }];
  });
  while (partIndex < parts.length) {
    let blockId = `manual-block-${partIndex + 1}`;
    let suffix = 2;
    while (usedIds.has(blockId)) {
      blockId = `manual-block-${partIndex + 1}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(blockId);
    blocks.push({ block_id: blockId, type: 'paragraph', text: parts[partIndex] });
    partIndex += 1;
  }
  return { ...normalized, blocks };
}

export function reorderDocumentBlocks(
  content: DeliverableContent,
  fromBlockId: string,
  toBlockId: string,
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const fromIndex = normalized.blocks.findIndex((block) => block.block_id === fromBlockId);
  const toIndex = normalized.blocks.findIndex((block) => block.block_id === toBlockId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return normalized;
  const blocks = [...normalized.blocks];
  const [moved] = blocks.splice(fromIndex, 1);
  blocks.splice(toIndex, 0, moved);
  return { ...normalized, blocks };
}

export function moveDocumentBlock(
  content: DeliverableContent,
  blockId: string,
  direction: 'up' | 'down',
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const index = normalized.blocks.findIndex((block) => block.block_id === blockId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= normalized.blocks.length) return normalized;
  const blocks = [...normalized.blocks];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return { ...normalized, blocks };
}

/** Update one structured block while retaining the normalized document shape. */
export function updateDocumentBlock(
  content: DeliverableContent,
  blockId: string,
  patch: Partial<DeliverableBlock>,
): DeliverableContent {
  const normalized = toEditorDocument(content);
  if (!normalized.blocks.some((block) => block.block_id === blockId)) return normalized;
  return {
    ...normalized,
    blocks: normalized.blocks.map((block) => (
      block.block_id === blockId ? { ...block, ...patch, block_id: block.block_id } : block
    )),
  };
}

/** Update a single table cell without changing any other block or row. */
export function updateDocumentTableCell(
  content: DeliverableContent,
  blockId: string,
  rowIndex: number,
  columnIndex: number,
  value: string,
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const block = normalized.blocks.find((item) => item.block_id === blockId);
  if (!block || !Array.isArray(block.rows) || rowIndex < 0 || columnIndex < 0) return normalized;
  const rows = block.rows.map((row) => {
    const cells = tableRowCells(row);
    return cells ? tableRowWithCells(row, cells) : row;
  });
  const cells = tableRowCells(rows[rowIndex]);
  if (!cells || columnIndex >= cells.length) return normalized;
  cells[columnIndex] = value;
  rows[rowIndex] = tableRowWithCells(rows[rowIndex], cells);
  return updateDocumentBlock(normalized, blockId, { rows });
}

/** Read a table row from either the editor's array form or the DOCX import form. */
export function tableRowCells(row: unknown): unknown[] | null {
  if (Array.isArray(row)) return row.map(cloneTableValue);
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const cells = (row as { cells?: unknown }).cells;
    if (Array.isArray(cells)) return cells.map(cloneTableValue);
  }
  return null;
}

/** Return a row with the original row representation preserved. */
export function tableRowWithCells(row: unknown, cells: unknown[]): unknown {
  if (Array.isArray(row)) return cells;
  if (row && typeof row === 'object' && !Array.isArray(row) && 'cells' in row) {
    return { ...(row as Record<string, unknown>), cells };
  }
  return cells;
}

export function tableCellText(cell: unknown): string {
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
    const value = (cell as { text?: unknown; value?: unknown; content?: unknown }).text
      ?? (cell as { value?: unknown }).value
      ?? (cell as { content?: unknown }).content;
    return value === null || value === undefined ? '' : String(value);
  }
  return cell === null || cell === undefined ? '' : String(cell);
}

function cloneTableValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return value;
}

export function tableCellSpan(cell: unknown): number {
  if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return 1;
  const span = Number((cell as { col_span?: unknown }).col_span);
  return Number.isInteger(span) && span > 0 ? span : 1;
}

function tableCellWithSpan(cell: unknown, span: number): unknown {
  const normalizedSpan = Math.max(1, Math.floor(span));
  if (normalizedSpan === 1 && cell && typeof cell === 'object' && !Array.isArray(cell)) {
    const { col_span: _colSpan, ...rest } = cell as Record<string, unknown>;
    return rest;
  }
  if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
    return { ...(cell as Record<string, unknown>), col_span: normalizedSpan };
  }
  return normalizedSpan === 1 ? cell : { text: tableCellText(cell), col_span: normalizedSpan };
}

function tableBlockRows(content: DeliverableContent, blockId: string): {
  normalized: DeliverableContent;
  block: DeliverableBlock;
  rows: unknown[];
} | null {
  const normalized = toEditorDocument(content);
  const block = normalized.blocks.find((item) => item.block_id === blockId);
  if (!block || block.type !== 'table' || !Array.isArray(block.rows)) return null;
  return { normalized, block, rows: block.rows.map(cloneTableValue) };
}

/** Add an empty table row while retaining DOCX `cells` rows when present. */
export function insertDocumentTableRow(
  content: DeliverableContent,
  blockId: string,
  rowIndex?: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target) return toEditorDocument(content);
  const width = Math.max(1, ...target.rows.map((row) => tableRowCells(row)?.length ?? 0));
  const index = rowIndex === undefined ? target.rows.length : Math.max(0, Math.min(rowIndex, target.rows.length));
  const template = target.rows.find((row) => tableRowCells(row));
  const row = tableRowWithCells(template ?? [], Array.from({ length: width }, () => ''));
  const rows = [...target.rows];
  rows.splice(index, 0, row);
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Remove a table row, retaining at least one row so the table remains editable. */
export function removeDocumentTableRow(
  content: DeliverableContent,
  blockId: string,
  rowIndex: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target || rowIndex < 0 || rowIndex >= target.rows.length || target.rows.length <= 1) {
    return target?.normalized ?? toEditorDocument(content);
  }
  const rows = target.rows.filter((_, index) => index !== rowIndex);
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Add an empty column to every row, padding ragged rows deterministically. */
export function insertDocumentTableColumn(
  content: DeliverableContent,
  blockId: string,
  columnIndex?: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target) return toEditorDocument(content);
  const width = Math.max(1, ...target.rows.map((row) => tableRowCells(row)?.length ?? 0));
  const index = columnIndex === undefined ? width : Math.max(0, Math.min(columnIndex, width));
  const sourceRows = target.rows.length ? target.rows : [[]];
  const rows = sourceRows.map((row) => {
    const cells = tableRowCells(row) ?? [];
    while (cells.length < width) cells.push('');
    cells.splice(index, 0, '');
    return tableRowWithCells(row, cells);
  });
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Remove a table column, retaining at least one editable column. */
export function removeDocumentTableColumn(
  content: DeliverableContent,
  blockId: string,
  columnIndex: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target || columnIndex < 0 || columnIndex >= Math.max(1, ...target.rows.map((row) => tableRowCells(row)?.length ?? 0))) {
    return target?.normalized ?? toEditorDocument(content);
  }
  const width = Math.max(1, ...target.rows.map((row) => tableRowCells(row)?.length ?? 0));
  if (width <= 1) return target.normalized;
  const rows = target.rows.map((row) => {
    const cells = tableRowCells(row) ?? [];
    if (columnIndex < cells.length) cells.splice(columnIndex, 1);
    return tableRowWithCells(row, cells);
  });
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Merge a cell with its right neighbour. Only horizontal spans are supported in 4.0.0. */
export function mergeDocumentTableCells(
  content: DeliverableContent,
  blockId: string,
  rowIndex: number,
  columnIndex: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target || rowIndex < 0 || columnIndex < 0) return target?.normalized ?? toEditorDocument(content);
  const cells = tableRowCells(target.rows[rowIndex]);
  if (!cells || columnIndex >= cells.length - 1) return target.normalized;
  const left = cells[columnIndex];
  const right = cells[columnIndex + 1];
  const leftSpan = tableCellSpan(left);
  const rightSpan = tableCellSpan(right);
  if (rightSpan !== 1) return target.normalized;
  cells[columnIndex] = tableCellWithSpan(
    { ...(left && typeof left === 'object' && !Array.isArray(left) ? left as Record<string, unknown> : {}), text: [tableCellText(left), tableCellText(right)].filter(Boolean).join('\n') },
    leftSpan + rightSpan,
  );
  cells.splice(columnIndex + 1, 1);
  const rows = [...target.rows];
  rows[rowIndex] = tableRowWithCells(rows[rowIndex], cells);
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Split a horizontally merged cell and insert blank cells to its right. */
export function splitDocumentTableCell(
  content: DeliverableContent,
  blockId: string,
  rowIndex: number,
  columnIndex: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target || rowIndex < 0 || columnIndex < 0) return target?.normalized ?? toEditorDocument(content);
  const cells = tableRowCells(target.rows[rowIndex]);
  if (!cells || columnIndex >= cells.length) return target.normalized;
  const span = tableCellSpan(cells[columnIndex]);
  if (span <= 1) return target.normalized;
  const original = cells[columnIndex];
  cells[columnIndex] = tableCellWithSpan(original, 1);
  cells.splice(columnIndex + 1, 0, ...Array.from({ length: span - 1 }, () => ''));
  const rows = [...target.rows];
  rows[rowIndex] = tableRowWithCells(rows[rowIndex], cells);
  return updateDocumentBlock(target.normalized, blockId, { rows });
}

/** Store a safe pixel width hint for a table column. The DOCX renderer may ignore it. */
export function setDocumentTableColumnWidth(
  content: DeliverableContent,
  blockId: string,
  columnIndex: number,
  width: number,
): DeliverableContent {
  const target = tableBlockRows(content, blockId);
  if (!target || columnIndex < 0) return target?.normalized ?? toEditorDocument(content);
  const columnCount = Math.max(1, ...target.rows.map((row) => tableRowCells(row)?.length ?? 0));
  if (columnIndex >= columnCount) return target.normalized;
  const existing = Array.isArray(target.block.column_widths) ? target.block.column_widths : [];
  const widths = Array.from({ length: columnCount }, (_, index) => {
    const value = Number(existing[index]);
    return Number.isFinite(value) && value > 0 ? value : 160;
  });
  widths[columnIndex] = Math.max(40, Math.min(1000, Math.round(width)));
  return updateDocumentBlock(target.normalized, blockId, { column_widths: widths });
}

export function moveDocumentBlockToEdge(
  content: DeliverableContent,
  blockId: string,
  edge: 'start' | 'end',
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const index = normalized.blocks.findIndex((block) => block.block_id === blockId);
  if (index < 0 || normalized.blocks.length <= 1 || (edge === 'start' && index === 0) || (edge === 'end' && index === normalized.blocks.length - 1)) {
    return normalized;
  }
  const blocks = [...normalized.blocks];
  const [moved] = blocks.splice(index, 1);
  blocks.splice(edge === 'start' ? 0 : blocks.length, 0, moved);
  return { ...normalized, blocks };
}

/** Remove a block by stable ID; used when a media asset is deleted. */
export function removeDocumentBlock(
  content: DeliverableContent,
  blockId: string,
): DeliverableContent {
  const normalized = toEditorDocument(content);
  return {
    ...normalized,
    blocks: normalized.blocks.filter((block) => block.block_id !== blockId),
  };
}

export function appendParagraph(content: DeliverableContent): DeliverableContent {
  return appendBlock(content, 'paragraph');
}

/** Add a WordPress-style structured block without introducing a second model. */
export function appendBlock(
  content: DeliverableContent,
  type: 'paragraph' | 'heading' | 'list' | 'quote' | 'table' | 'divider' | 'notice',
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const usedIds = new Set(normalized.blocks.map((block) => block.block_id));
  const baseId = `manual-block-${normalized.blocks.length + 1}`;
  let blockId = baseId;
  let suffix = 2;
  while (usedIds.has(blockId)) {
    blockId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return {
    ...normalized,
    blocks: [...normalized.blocks, {
      block_id: blockId,
      type,
      ...(type === 'divider'
        ? {}
        : type === 'table'
          ? { rows: [['', '']] }
          : { text: type === 'heading' ? '新标题' : '' }),
    }],
  };
}

export function appendMedia(
  content: DeliverableContent,
  media: {
    asset_id: string;
    url: string;
    alt: string;
    mime_type: string;
    size_bytes: number;
  },
): DeliverableContent {
  const normalized = toEditorDocument(content);
  const usedIds = new Set(normalized.blocks.map((block) => block.block_id));
  const baseId = `media-${media.asset_id}`;
  let blockId = baseId;
  let suffix = 2;
  while (usedIds.has(blockId)) {
    blockId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return {
    ...normalized,
    blocks: [...normalized.blocks, {
      block_id: blockId,
      type: 'media',
      asset_id: media.asset_id,
      url: media.url,
      alt: media.alt,
      mime_type: media.mime_type,
      size_bytes: media.size_bytes,
    }],
  };
}
