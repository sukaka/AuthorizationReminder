import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TaskProgressTimeline } from '../src/components/TaskProgressTimeline';

describe('TaskProgressTimeline', () => {
  it('renders user-facing stages in order', () => {
    render(
      <TaskProgressTimeline
        stage="generating"
        label="正在生成回答"
        nextAction="正在生成工作成果"
        stageHistory={[
          { stage: 'analyzing', label: '正在识别任务' },
          { stage: 'building_context', label: '正在整理依据' },
          { stage: 'generating', label: '正在生成回答' },
        ]}
      />,
    );

    const stages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(stages).toEqual(['正在识别任务', '正在整理依据', '正在生成回答']);
    expect(screen.queryByText(/TaskState|Tool Call|RAG/i)).not.toBeInTheDocument();
  });

  it('collapses consecutive duplicate retrieval stages', () => {
    render(
      <TaskProgressTimeline
        stage="completed"
        label="生成完成"
        stageHistory={[
          { stage: 'analyzing', label: '正在理解你的需求' },
          { stage: 'retrieving', label: '正在查找资料' },
          { stage: 'retrieving', label: '正在查找资料' },
          { stage: 'retrieving', label: '正在查找资料' },
          { stage: 'generating', label: '正在生成内容' },
          { stage: 'completed', label: '生成完成' },
        ]}
      />,
    );

    const stages = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(stages).toEqual([
      '正在理解你的需求',
      '正在查找资料',
      '正在生成内容',
      '生成完成',
    ]);
  });

  it('shows retry and fallback actions for failed stage', () => {
    render(
      <TaskProgressTimeline
        stage="failed"
        label="生成遇到问题"
        nextAction="请稍后重试或调整问题"
        toolCalls={[
          { tool_name: 'web_search', status: 'failed', error_code: 'WEB_SEARCH_FAILED' },
        ]}
      />,
    );

    expect(screen.getAllByText('生成遇到问题')).toHaveLength(2);
    expect(screen.getByText('可重试')).toBeInTheDocument();
    expect(screen.getByText('继续普通回答')).toBeInTheDocument();
    expect(screen.getByText('联网查找未完成')).toBeInTheDocument();
  });

  it('requires user click before save or review actions run', async () => {
    const user = userEvent.setup();
    const onSaveToMyMaterials = vi.fn();
    const onSubmitCompanyReview = vi.fn();
    render(
      <TaskProgressTimeline
        stage="completed"
        label="生成完成"
        selectedSources={[{ type: 'web_search', count: 2 }]}
        onSaveToMyMaterials={onSaveToMyMaterials}
        onSubmitCompanyReview={onSubmitCompanyReview}
      />,
    );

    expect(onSaveToMyMaterials).not.toHaveBeenCalled();
    expect(onSubmitCompanyReview).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '保存到我的资料' }));
    await user.click(screen.getByRole('button', { name: '申请加入公司知识库' }));

    expect(onSaveToMyMaterials).toHaveBeenCalledTimes(1);
    expect(onSubmitCompanyReview).toHaveBeenCalledTimes(1);
  });
});
