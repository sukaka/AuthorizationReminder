import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatRunContext } from '../src/components/ChatRunContext';

const taskProgress = {
  task_state_id: 'task-state-1',
  conversation_id: 'session-1',
  stage: 'generating',
  status: 'running',
  label: '正在生成回答',
  goal: '整理本周项目进展，并输出一份可审阅的工作总结。',
  selected_sources: [{ file_name: '项目周报.docx', source_type: 'official_knowledge' }],
  tool_calls: [
    { tool_name: 'search_knowledge_base', status: 'completed' },
    { tool_name: 'word_export', status: 'running' },
  ],
  verification_status: 'pending',
  next_action: '完成事实核验后生成 Word 成果',
  retry_allowed: false,
  failure_reason: '',
  stage_history: [
    { stage: 'analyzing', label: '识别任务' },
    { stage: 'building_context', label: '整理依据' },
    { stage: 'generating', label: '生成回答', next_action: '完成事实核验后生成 Word 成果' },
  ],
};

const messages = [
  {
    role: 'user' as const,
    content: '整理本周项目进展，并输出一份可审阅的工作总结。',
  },
  {
    role: 'assistant' as const,
    content: '已整理项目进展，下面是可审阅的工作总结。',
    isComplete: true,
    citations: [{
      source_type: 'official_knowledge',
      file_uuid: 'file-1',
      file_name: '项目周报.docx',
      page_number: 3,
    }],
    generatedFiles: [{
      artifact_id: 'artifact-1',
      file_name: '本周项目总结.docx',
      format: 'docx' as const,
      media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      download_url: '/api/artifacts/artifact-1/download',
    }],
  },
];

describe('ChatRunContext', () => {
  it('exposes the real run plan, activity, sources and deliverables', async () => {
    const user = userEvent.setup();
    render(
      <ChatRunContext
        messages={messages}
        metrics={{ latencyMs: 1234, usage: { input_tokens: 120, output_tokens: 80 } }}
        onOpenTaskCenter={vi.fn()}
        onStop={vi.fn()}
        runId="run-20260718-abc123"
        sessionUuid="session-123456"
        status="running"
        taskProgress={taskProgress}
      />,
    );

    expect(screen.getByText('任务详情')).toBeInTheDocument();
    expect(screen.queryByText(/run-2026|session-123456/i)).not.toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText(taskProgress.goal)).toBeInTheDocument();
    expect(screen.getByText('整理依据')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /活动/ }));
    expect(screen.getByText('公司知识查询')).toBeInTheDocument();
    expect(screen.getByText('Word 导出')).toBeInTheDocument();
    expect(screen.getByText('1.2 s')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /来源/ }));
    expect(screen.getAllByText('项目周报.docx')).toHaveLength(2);
    expect(screen.getByText('第 3 页')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /成果/ }));
    expect(screen.getByText('本周项目总结.docx')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('href', '/api/artifacts/artifact-1/download');
  });

  it('only invokes run actions after an explicit click', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const onOpenTaskCenter = vi.fn();
    render(
      <ChatRunContext
        messages={messages}
        onOpenTaskCenter={onOpenTaskCenter}
        onStop={onStop}
        runId="run-20260718-abc123"
        status="running"
      />,
    );

    expect(onStop).not.toHaveBeenCalled();
    expect(onOpenTaskCenter).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '停止任务' }));
    await user.click(screen.getByRole('button', { name: '打开任务中心' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onOpenTaskCenter).toHaveBeenCalledWith('run-20260718-abc123');
  });

  it('shows explicit recovery actions for a failed task', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onContinueWithoutTools = vi.fn();
    const onOpenTaskCenter = vi.fn();
    render(
      <ChatRunContext
        messages={[]}
        onContinueWithoutTools={onContinueWithoutTools}
        onOpenTaskCenter={onOpenTaskCenter}
        onRetry={onRetry}
        runId="run-failed-1"
        status="idle"
        taskProgress={{
          ...taskProgress,
          stage: 'failed',
          status: 'failed',
          retry_allowed: true,
          stage_history: [{ stage: 'failed', label: '生成失败' }],
        }}
      />,
    );

    const actions = screen.getByRole('group', { name: '任务操作' });
    const retry = within(actions).getByRole('button', { name: '重新运行' });
    const continueWithoutTools = within(actions).getByRole('button', { name: '继续普通回答' });
    const taskCenter = within(actions).getByRole('button', { name: '打开任务中心' });
    expect(retry).toHaveClass('is-primary');
    expect(continueWithoutTools).toHaveClass('is-secondary');
    expect(taskCenter).toHaveClass('is-tertiary');
    expect(taskCenter).toHaveTextContent('任务中心');

    await user.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(continueWithoutTools);
    expect(onContinueWithoutTools).toHaveBeenCalledTimes(1);
    await user.click(taskCenter);
    expect(onOpenTaskCenter).toHaveBeenCalledWith('run-failed-1');
  });
});
