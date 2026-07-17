import { createEvent, fireEvent, render, screen } from '@testing-library/react';
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

    Object.defineProperty(table, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 100, bottom: 100, left: 0, right: 0, width: 0 }),
    });

    fireEvent.dragStart(intro as HTMLElement);
    const dragOver = createEvent.dragOver(table as HTMLElement);
    Object.defineProperty(dragOver, 'clientY', { configurable: true, value: 80 });
    fireEvent(table as HTMLElement, dragOver);
    fireEvent.drop(table as HTMLElement);

    expect(nextContent.blocks.map((block) => block.block_id)).toEqual(['table', 'intro']);
  });

  it('shows a precise drop indicator and supports dropping after a target block', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: [
        { block_id: 'intro', type: 'paragraph', text: '段落' },
        { block_id: 'table', type: 'table', rows: [['字段', '值']] },
        { block_id: 'media', type: 'media', asset_id: 'asset-1', url: '/media/1.png', alt: '图片', mime_type: 'image/png', size_bytes: 10 },
      ],
    };
    let nextContent = content;
    render(<DocumentBlockEditor content={content} onChange={(next) => { nextContent = next; }} />);
    const canvas = screen.getByLabelText('结构化区块');
    const media = canvas.querySelector('[data-block-id="media"]') as HTMLElement;
    const intro = canvas.querySelector('[data-block-id="intro"]') as HTMLElement;
    Object.defineProperty(intro, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 0, height: 100, bottom: 100, left: 0, right: 0, width: 0 }),
    });

    fireEvent.dragStart(media);
    const dragOver = createEvent.dragOver(intro);
    Object.defineProperty(dragOver, 'clientY', { configurable: true, value: 80 });
    fireEvent(intro, dragOver);
    expect(screen.getByLabelText('放置到区块 intro 后')).toBeInTheDocument();
    fireEvent.drop(intro);

    expect(nextContent.blocks.map((block) => block.block_id)).toEqual(['intro', 'media', 'table']);
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

  it('moves focus through the table grid with arrows, Home and End', () => {
    const content: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'grid',
        type: 'table',
        rows: [['a', 'b'], ['c', 'd']],
      }],
    };
    render(<DocumentBlockEditor content={content} onChange={() => undefined} />);

    const a = screen.getByRole('textbox', { name: '表格：grid 第 1 行第 1 列' });
    const b = screen.getByRole('textbox', { name: '表格：grid 第 1 行第 2 列' });
    const c = screen.getByRole('textbox', { name: '表格：grid 第 2 行第 1 列' });
    const d = screen.getByRole('textbox', { name: '表格：grid 第 2 行第 2 列' });

    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(d);
    fireEvent.keyDown(d, { key: 'Home' });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c, { key: 'End' });
    expect(document.activeElement).toBe(d);
  });

  it('emits a block deletion request from the structured block actions', () => {
    let requested = '';
    render(
      <DocumentBlockEditor
        content={initialContent}
        onChange={() => undefined}
        onRequestDeleteBlock={(block) => { requested = block.block_id; }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除区块 intro' }));
    expect(requested).toBe('intro');
  });

  it('keeps pasted content plain and defers structured updates during Chinese IME composition', () => {
    let nextContent = initialContent;
    render(<DocumentBlockEditor content={initialContent} onChange={(next) => { nextContent = next; }} />);

    const paragraph = screen.getByRole('textbox', { name: '段落：intro' });
    fireEvent.compositionStart(paragraph);
    paragraph.textContent = '输入中';
    fireEvent.input(paragraph);
    expect(nextContent.blocks.find((block) => block.block_id === 'intro')?.text).toBe('原始结论');
    fireEvent.compositionEnd(paragraph);
    expect(nextContent.blocks.find((block) => block.block_id === 'intro')?.text).toBe('输入中');

    paragraph.textContent = '输入中';
    fireEvent.paste(paragraph, {
      clipboardData: { getData: () => '粘贴\r\n内容\u0000' },
    });
    expect(nextContent.blocks.find((block) => block.block_id === 'intro')?.text).toBe('输入中粘贴\n内容');

    const cell = screen.getByRole('textbox', { name: '表格：table 第 1 行第 2 列' }) as HTMLInputElement;
    cell.setSelectionRange(0, cell.value.length);
    fireEvent.paste(cell, {
      clipboardData: { getData: () => '低\n（需复核）' },
    });
    expect(nextContent.blocks.find((block) => block.block_id === 'table')?.rows).toEqual([['风险', '低 （需复核）']]);
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

  it('exposes constrained vertical merge and split controls', () => {
    const tableContent: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'vertical-table',
        type: 'table',
        rows: [['上', '右上'], ['下', '右下']],
      }],
    };
    let nextContent = tableContent;
    const view = render(<DocumentBlockEditor content={tableContent} onChange={(next) => { nextContent = next; }} />);

    fireEvent.click(screen.getByRole('button', { name: '表格 vertical-table 向下合并单元格' }));
    expect(nextContent.blocks[0].rows).toEqual([
      [{ text: '上\n下', row_span: 2 }, '右上'],
      ['右下'],
    ]);

    view.rerender(<DocumentBlockEditor content={nextContent} onChange={(next) => { nextContent = next; }} />);
    expect(screen.getAllByRole('cell')[0]).toHaveAttribute('rowspan', '2');
    fireEvent.click(screen.getByRole('button', { name: '表格 vertical-table 纵向拆分单元格' }));
    expect(nextContent.blocks[0].rows).toEqual([
      [{ text: '上\n下' }, '右上'],
      ['', '右下'],
    ]);
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

  it('edits media alt text, width and alignment as structured block attributes', () => {
    const mediaContent: DeliverableContent = {
      schema_version: '2',
      blocks: [{
        block_id: 'media-1', type: 'media', asset_id: 'asset-1', url: '/media/asset-1.png', alt: '封面',
        attrs: { alt: '封面', width: null, alignment: 'left' },
    }],
    };
    let nextContent = mediaContent;
    const view = render(<DocumentBlockEditor content={mediaContent} onChange={(next) => { nextContent = next; }} />);

    fireEvent.change(screen.getByRole('textbox', { name: '图片 media-1 替代文本' }), { target: { value: '新的封面' } });
    view.rerender(<DocumentBlockEditor content={nextContent} onChange={(next) => { nextContent = next; }} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '图片 media-1 宽度' }), { target: { value: '640' } });
    view.rerender(<DocumentBlockEditor content={nextContent} onChange={(next) => { nextContent = next; }} />);
    fireEvent.change(screen.getByRole('combobox', { name: '图片 media-1 对齐方式' }), { target: { value: 'center' } });

    expect(nextContent.blocks[0]).toMatchObject({
      alt: '新的封面',
      attrs: { alt: '新的封面', width: 640, alignment: 'center' },
    });
  });
});
