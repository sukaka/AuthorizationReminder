import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfessionalEditorDemoPage } from '../src/pages/ProfessionalEditorDemoPage';

function blockIds() {
  return within(screen.getByTestId('editor-canvas'))
    .getAllByTestId('editor-block')
    .map((block) => block.getAttribute('data-block-id'));
}

describe('4.0 online editor demo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reorders paragraph, table and image blocks without changing their stable ids', () => {
    render(<ProfessionalEditorDemoPage />);

    expect(blockIds()).toEqual([
      'executive-summary',
      'risk-table',
      'architecture-image',
      'next-actions',
    ]);

    const transfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn(() => 'executive-summary'),
    };
    fireEvent.dragStart(screen.getByRole('button', { name: '拖动执行摘要' }), {
      dataTransfer: transfer,
    });
    fireEvent.dragOver(screen.getByTestId('editor-block-architecture-image'), {
      dataTransfer: transfer,
    });
    fireEvent.drop(screen.getByTestId('editor-block-architecture-image'), {
      dataTransfer: transfer,
    });

    expect(blockIds()).toEqual([
      'risk-table',
      'executive-summary',
      'architecture-image',
      'next-actions',
    ]);

    fireEvent.click(screen.getByRole('button', { name: '下移风险清单' }));
    expect(blockIds()).toEqual([
      'executive-summary',
      'risk-table',
      'architecture-image',
      'next-actions',
    ]);
  });

  it('demonstrates editable blocks, draft autosave, immutable versions and review rails', async () => {
    vi.useFakeTimers();
    render(<ProfessionalEditorDemoPage />);

    expect(screen.getByText('4.0 交互原型')).toBeInTheDocument();
    expect(screen.getByText('演示数据，不会写入正式成果')).toBeInTheDocument();
    expect(screen.getByLabelText('执行摘要正文')).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByLabelText('风险名称：数据口径')).toHaveAttribute('contenteditable', 'true');

    fireEvent.click(screen.getByRole('button', { name: '插入段落' }));
    expect(screen.getByText('未保存')).toBeInTheDocument();
    expect(blockIds()).toContain('paragraph-5');

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('正在保存草稿…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('草稿已保存')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    expect(screen.getByText('V4')).toBeInTheDocument();
    expect(screen.getByText('已创建不可变版本 V4')).toBeInTheDocument();

    vi.useRealTimers();
    await userEvent.click(screen.getByRole('tab', { name: '质量审阅' }));
    expect(screen.getByText('关键数字缺少可追溯来源')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: '评论' }));
    expect(screen.getByText('请补充本段结论的负责人。')).toBeInTheDocument();
  });
});
