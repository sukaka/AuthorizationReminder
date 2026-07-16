import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { DeliverableContent } from '../src/api/deliverables';
import { blocksToPlainText } from '../src/components/documentBlockAdapter';
import { DocumentBlockEditor } from '../src/components/DocumentBlockEditor';

const initialContent: DeliverableContent = {
  schema_version: '2',
  blocks: [
    { block_id: 'intro', type: 'paragraph', text: '原始结论' },
    { block_id: 'table', type: 'table', rows: [['风险', '高']] },
  ],
};

function HistoryHarness() {
  const [content, setContent] = useState(initialContent);
  return <DocumentBlockEditor content={content} onChange={setContent} />;
}

describe('DocumentBlockEditor history', () => {
  it('undoes and redoes text changes without changing structured blocks', () => {
    render(<HistoryHarness />);
    const editor = screen.getByLabelText('成果正文');

    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();

    fireEvent.change(editor, { target: { value: '修改后的结论' } });
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
    expect(blocksToPlainText({
      schema_version: '2',
      blocks: [{ block_id: 'intro', type: 'paragraph', text: '修改后的结论' }],
    })).toBe('修改后的结论');

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect((editor as HTMLTextAreaElement).value).toBe('原始结论');
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect((editor as HTMLTextAreaElement).value).toBe('修改后的结论');
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
  });

  it('moves any structured block with Alt+Arrow keys', () => {
    render(<HistoryHarness />);
    const canvas = screen.getByLabelText('结构化区块');
    const table = canvas.querySelector('[data-block-id="table"]');
    expect(table).not.toBeNull();

    fireEvent.keyDown(table as HTMLElement, { altKey: true, key: 'ArrowUp' });
    expect(Array.from(canvas.querySelectorAll('article')).map((item) => item.dataset.blockId)).toEqual([
      'table',
      'intro',
    ]);

    const movedTable = canvas.querySelector('[data-block-id="table"]');
    fireEvent.keyDown(movedTable as HTMLElement, { altKey: true, key: 'ArrowDown' });
    expect(Array.from(canvas.querySelectorAll('article')).map((item) => item.dataset.blockId)).toEqual([
      'intro',
      'table',
    ]);
  });

  it('reorders blocks with the accessible drag-and-drop surface', () => {
    let nextContent = initialContent;
    render(
      <DocumentBlockEditor content={initialContent} onChange={(next) => { nextContent = next; }} />,
    );
    const canvas = screen.getByLabelText('结构化区块');
    const intro = canvas.querySelector('[data-block-id="intro"]');
    const table = canvas.querySelector('[data-block-id="table"]');
    expect(intro).not.toBeNull();
    expect(table).not.toBeNull();

    fireEvent.dragStart(intro as HTMLElement);
    fireEvent.dragOver(table as HTMLElement);
    fireEvent.drop(table as HTMLElement);

    expect(nextContent.blocks.map((block) => block.block_id)).toEqual(['table', 'intro']);
  });

  it('edits structured text and table cells, and exposes media actions', () => {
    let nextContent = initialContent;
    render(<DocumentBlockEditor content={initialContent} onChange={(next) => { nextContent = next; }} />);

    const paragraph = screen.getByRole('textbox', { name: '段落：intro' });
    paragraph.textContent = '新的结论';
    fireEvent.input(paragraph);
    expect(nextContent.blocks.find((block) => block.block_id === 'intro')?.text).toBe('新的结论');

    const cell = screen.getByRole('textbox', { name: '表格：table 第 1 行第 2 列' });
    fireEvent.change(cell, { target: { value: '低' } });
    expect(nextContent.blocks.find((block) => block.block_id === 'table')?.rows).toEqual([['风险', '低']]);
  });

  it('renders DOCX cells rows and exposes table structure controls', () => {
    const docxContent: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'docx-table',
        type: 'table',
        rows: [{ cells: [{ text: '字段' }, { text: '值' }] }],
      }],
    };
    let nextContent = docxContent;
    render(<DocumentBlockEditor content={docxContent} onChange={(next) => { nextContent = next; }} />);
    expect(screen.getByRole('textbox', { name: '表格：docx-table 第 1 行第 1 列' })).toHaveValue('字段');
    expect(screen.getByRole('textbox', { name: '表格：docx-table 第 1 行第 2 列' })).toHaveValue('值');
    fireEvent.click(screen.getByRole('button', { name: '表格 docx-table 新增行' }));
    expect(nextContent.blocks[0].rows).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '表格 docx-table 新增列' }));
    expect((nextContent.blocks[0].rows as unknown[])[0]).toEqual({ cells: [{ text: '字段' }, '', { text: '值' }] });
  });

  it('inserts a new table from the block toolbar', () => {
    let nextContent = initialContent;
    render(<DocumentBlockEditor content={initialContent} onChange={(next) => { nextContent = next; }} />);

    fireEvent.click(screen.getByRole('button', { name: '+ 表格' }));
    expect(nextContent.blocks.at(-1)).toEqual({
      block_id: 'manual-block-3',
      type: 'table',
      rows: [['', '']],
    });
  });

  it('calls preview and delete handlers for media blocks', () => {
    const mediaContent: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'media-1',
        type: 'media',
        asset_id: 'asset-1',
        url: '/media/asset-1.png',
        alt: '封面',
        mime_type: 'image/png',
        size_bytes: 10,
      }],
    };
    let previewed = '';
    let deleted = '';
    render(
      <DocumentBlockEditor
        content={mediaContent}
        onChange={() => undefined}
        onDeleteMedia={(block) => { deleted = block.block_id; }}
        onPreviewMedia={(block) => { previewed = block.block_id; }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '预览图片' }));
    fireEvent.click(screen.getByRole('button', { name: '删除图片' }));
    expect(previewed).toBe('media-1');
    expect(deleted).toBe('media-1');
  });
});
