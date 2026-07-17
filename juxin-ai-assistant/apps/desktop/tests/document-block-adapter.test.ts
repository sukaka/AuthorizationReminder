import { describe, expect, it } from 'vitest';

import type { DeliverableContent } from '../src/api/deliverables';
import {
  blocksToPlainText,
  appendBlock,
  appendMedia,
  documentMediaPresentation,
  insertDocumentTableColumn,
  insertDocumentTableRow,
  mergeDocumentTableCells,
  moveDocumentBlock,
  moveDocumentBlockToEdge,
  reorderDocumentBlocks,
  removeDocumentBlock,
  removeDocumentTableColumn,
  removeDocumentTableRow,
  replaceEditableText,
  sanitizePastedText,
  setDocumentTableColumnWidth,
  splitDocumentTableCell,
  toEditorDocument,
  tableCellText,
  tableRowCells,
  updateDocumentBlock,
  updateDocumentMedia,
  updateDocumentTableCell,
} from '../src/components/documentBlockAdapter';

const legacyContent: DeliverableContent = {
  schema_version: '1',
  blocks: [
    { block_id: 'heading-1', type: 'heading', text: '项目说明' },
    { block_id: 'paragraph-1', type: 'paragraph', text: '第一段' },
    { block_id: 'table-1', type: 'table', rows: [['字段', '值']] },
    { block_id: 'paragraph-2', type: 'paragraph', text: '第二段' },
  ],
};

describe('documentBlockAdapter', () => {
  it('sanitizes clipboard text without allowing hidden control characters or HTML semantics', () => {
    expect(sanitizePastedText('甲\r\n乙\u0000\u0007\u2028丙')).toBe('甲\n乙\n丙');
    expect(sanitizePastedText('  甲\t\n乙  ', { singleLine: true })).toBe('甲 乙');
  });

  it('normalizes legacy content without changing order or IDs', () => {
    const result = toEditorDocument(legacyContent);
    expect(result.schema_version).toBe('2');
    expect(result.blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'paragraph-1',
      'table-1',
      'paragraph-2',
    ]);
  });

  it('replaces text while preserving non-text blocks', () => {
    const result = replaceEditableText('改好的第一段\n\n改好的第二段', legacyContent);
    expect(blocksToPlainText(result)).toBe('改好的第一段\n\n改好的第二段');
    expect(result.blocks.find((block) => block.block_id === 'table-1')).toEqual(
      legacyContent.blocks[2],
    );
    expect(result.schema_version).toBe('2');
  });

  it('reorders blocks by stable block ID', () => {
    const result = reorderDocumentBlocks(legacyContent, 'paragraph-2', 'paragraph-1');
    expect(result.blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'paragraph-2',
      'paragraph-1',
      'table-1',
    ]);
  });

  it('supports explicit before and after drop positions', () => {
    expect(reorderDocumentBlocks(legacyContent, 'paragraph-2', 'paragraph-1', 'before').blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'paragraph-2',
      'paragraph-1',
      'table-1',
    ]);
    expect(reorderDocumentBlocks(legacyContent, 'paragraph-1', 'table-1', 'after').blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'table-1',
      'paragraph-1',
      'paragraph-2',
    ]);
  });

  it('moves blocks up and down without crossing document boundaries', () => {
    expect(moveDocumentBlock(legacyContent, 'table-1', 'up').blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'table-1',
      'paragraph-1',
      'paragraph-2',
    ]);
    expect(moveDocumentBlock(legacyContent, 'paragraph-1', 'down').blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'table-1',
      'paragraph-1',
      'paragraph-2',
    ]);
    expect(moveDocumentBlock(legacyContent, 'heading-1', 'up').blocks.map((block) => block.block_id)).toEqual(
      legacyContent.blocks.map((block) => block.block_id),
    );
    expect(moveDocumentBlock(legacyContent, 'paragraph-2', 'down').blocks.map((block) => block.block_id)).toEqual(
      legacyContent.blocks.map((block) => block.block_id),
    );
  });

  it('updates one block or table cell without changing neighboring blocks', () => {
    const headingUpdated = updateDocumentBlock(legacyContent, 'heading-1', { text: '新的项目说明' });
    expect(headingUpdated.blocks[0]).toEqual({ block_id: 'heading-1', type: 'heading', text: '新的项目说明' });
    expect(headingUpdated.blocks.slice(1)).toEqual(legacyContent.blocks.slice(1));

    const tableUpdated = updateDocumentTableCell(legacyContent, 'table-1', 0, 1, '新值');
    expect(tableUpdated.blocks.find((block) => block.block_id === 'table-1')?.rows).toEqual([['字段', '新值']]);
    expect(tableUpdated.blocks.find((block) => block.block_id === 'paragraph-2')).toEqual(legacyContent.blocks[3]);
  });

  it('removes a block by stable ID', () => {
    const result = removeDocumentBlock(legacyContent, 'table-1');
    expect(result.blocks.map((block) => block.block_id)).toEqual([
      'heading-1',
      'paragraph-1',
      'paragraph-2',
    ]);
    expect(result.schema_version).toBe('2');
  });

  it('normalizes media presentation fields and preserves provider metadata', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'media-1', type: 'media', asset_id: 'asset-1', url: '/image.png', alt: '旧说明',
        provider_meta: { source: 'office' },
      }],
    };
    expect(documentMediaPresentation(content.blocks[0])).toEqual({ alt: '旧说明', width: null, alignment: 'left' });
    const updated = updateDocumentMedia(content, 'media-1', { alt: '新说明', width: 9999, alignment: 'center' });
    expect(updated.blocks[0]).toMatchObject({
      alt: '新说明',
      attrs: { alt: '新说明', width: 1200, alignment: 'center' },
      provider_meta: { source: 'office' },
    });
  });

  it('appends media with an explicit presentation contract', () => {
    const result = appendMedia(legacyContent, {
      asset_id: 'asset-1', url: '/image.png', alt: '报告图', mime_type: 'image/png', size_bytes: 12,
    });
    expect(result.blocks.at(-1)).toMatchObject({
      type: 'media',
      attrs: { alt: '报告图', width: null, alignment: 'left' },
    });
  });

  it('appends each supported editor block with a stable ID', () => {
    const result = appendBlock(legacyContent, 'notice');
    expect(result.blocks.at(-1)).toMatchObject({
      block_id: 'manual-block-5',
      type: 'notice',
      text: '',
    });
    expect(appendBlock(legacyContent, 'divider').blocks.at(-1)).toEqual({
      block_id: 'manual-block-5',
      type: 'divider',
    });
  });

  it('edits and structurally changes DOCX cells rows without coercing objects to strings', () => {
    const docxTable: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'docx-table',
        type: 'table',
        rows: [
          { cells: [{ text: '字段' }, { text: '值' }] },
          { cells: [{ text: '风险' }, { text: '高' }] },
        ],
      }],
    };
    const edited = updateDocumentTableCell(docxTable, 'docx-table', 1, 1, '低');
    expect(edited.blocks[0].rows).toEqual([
      { cells: [{ text: '字段' }, { text: '值' }] },
      { cells: [{ text: '风险' }, '低'] },
    ]);
    expect(tableRowCells((edited.blocks[0].rows as unknown[])[0])).toEqual([{ text: '字段' }, { text: '值' }]);
    expect(tableCellText(tableRowCells((edited.blocks[0].rows as unknown[])[0])?.[0])).toBe('字段');

    const withRow = insertDocumentTableRow(edited, 'docx-table');
    expect(withRow.blocks[0].rows).toHaveLength(3);
    expect(tableRowCells((withRow.blocks[0].rows as unknown[])[2])).toEqual(['', '']);
    const withColumn = insertDocumentTableColumn(withRow, 'docx-table', 1);
    expect(tableRowCells((withColumn.blocks[0].rows as unknown[])[0])).toEqual([{ text: '字段' }, '', { text: '值' }]);
    expect(tableRowCells((removeDocumentTableColumn(withColumn, 'docx-table', 1).blocks[0].rows as unknown[])[0])).toEqual([{ text: '字段' }, { text: '值' }]);
    expect(removeDocumentTableRow(withRow, 'docx-table', 1).blocks[0].rows).toHaveLength(2);
  });

  it('merges, splits and bounds table columns while exposing edge block moves', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: [
        { block_id: 'a', type: 'paragraph', text: 'A' },
        { block_id: 'table', type: 'table', rows: [['左', '右']] },
        { block_id: 'b', type: 'paragraph', text: 'B' },
      ],
    };
    const merged = mergeDocumentTableCells(content, 'table', 0, 0);
    expect(merged.blocks[1].rows).toEqual([[{ text: '左\n右', col_span: 2 }]]);
    const split = splitDocumentTableCell(merged, 'table', 0, 0);
    expect(split.blocks[1].rows).toEqual([[{ text: '左\n右' }, '']]);
    expect(setDocumentTableColumnWidth(content, 'table', 0, 9999).blocks[1]).toMatchObject({ column_widths: [1000, 160] });
    expect(removeDocumentTableColumn(content, 'table', 0).blocks[1].rows).toEqual([['右']]);
    expect(removeDocumentTableColumn(removeDocumentTableColumn(content, 'table', 0), 'table', 0).blocks[1].rows).toEqual([['右']]);
    expect(moveDocumentBlockToEdge(content, 'b', 'start').blocks.map((block) => block.block_id)).toEqual(['b', 'a', 'table']);
    expect(moveDocumentBlockToEdge(content, 'a', 'end').blocks.map((block) => block.block_id)).toEqual(['table', 'b', 'a']);
  });

  it('merges and splits a constrained vertical table cell', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'table',
        type: 'table',
        rows: [['上', '右上'], ['下', '右下']],
      }],
    };
    const merged = mergeDocumentTableCells(content, 'table', 0, 0, 'down');
    expect(merged.blocks[0].rows).toEqual([
      [{ text: '上\n下', row_span: 2 }, '右上'],
      ['右下'],
    ]);
    const split = splitDocumentTableCell(merged, 'table', 0, 0, 'vertical');
    expect(split.blocks[0].rows).toEqual([
      [{ text: '上\n下' }, '右上'],
      ['', '右下'],
    ]);
  });

  it('keeps the 500-block document transform within the local editing budget', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: Array.from({ length: 500 }, (_, index) => ({
        block_id: `block-${index + 1}`,
        type: 'paragraph',
        text: `${String(index + 1).padStart(3, '0')} ${'长文档性能基准'.repeat(14)}`,
      })),
    };
    const startedAt = performance.now();
    const normalized = toEditorDocument(content);
    const plainText = blocksToPlainText(normalized);
    const reordered = reorderDocumentBlocks(normalized, 'block-499', 'block-2', 'after');
    const durationMs = performance.now() - startedAt;

    expect(plainText.length).toBeGreaterThan(50_000);
    expect(reordered.blocks[2].block_id).toBe('block-499');
    expect(durationMs).toBeLessThan(1_000);
  });
});
