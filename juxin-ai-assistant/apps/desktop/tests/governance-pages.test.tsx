import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { KnowledgeAdminPage } from '../src/pages/admin/KnowledgeAdminPage';
import { SettingsPage } from '../src/pages/admin/SettingsPage';
import { StatsPage } from '../src/pages/admin/StatsPage';
import { SuggestionsPage } from '../src/pages/admin/SuggestionsPage';
import { TaskAdminPage } from '../src/pages/admin/TaskAdminPage';
import { server } from './setup';

it('clears controlled knowledge plaintext after encrypted save', async () => {
  server.use(
    http.post('/api/ai/admin/knowledge', () => HttpResponse.json({
      uuid: 'k-1', title: '公司介绍', category: 'COMPANY', status: 'ACTIVE', tags: [], priority: 0,
    }, { status: 201 })),
    http.get('/api/ai/admin/knowledge', () => HttpResponse.json({ items: [], total: 0 })),
  );
  render(<KnowledgeAdminPage />);
  await userEvent.type(screen.getByRole('textbox', { name: '标题' }), '公司介绍');
  await userEvent.type(screen.getByRole('textbox', { name: '正文' }), '仅用于加密写入的正文');
  await userEvent.click(screen.getByRole('button', { name: '加密保存' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '正文' })).toHaveValue(''));
});

it('renders settings from a fixed whitelist without arbitrary secret fields', () => {
  render(<SettingsPage />);
  expect(screen.getByRole('textbox', { name: '全局安全提示' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/api key|token|secret|password/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /新增设置/ })).not.toBeInTheDocument();
});

it('limits manager suggestion department selector to managed departments', () => {
  render(<SuggestionsPage departments={['销售部', '交付部']} />);
  const selector = screen.getByRole('combobox', { name: '负责部门' });
  expect(selector).toHaveTextContent('销售部');
  expect(selector).toHaveTextContent('交付部');
  expect(selector).not.toHaveTextContent('商务投标部');
});

it('loads department stats from the metadata-only endpoint', async () => {
  const requestSpy = vi.fn();
  server.use(http.get('/api/ai/department-stats', ({ request }) => {
    requestSpy(request.url);
    return HttpResponse.json({ total: 12, completion_rate: 0.75, failure_rate: 0.25 });
  }));
  render(<StatsPage manager />);
  await userEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  expect(await screen.findByText('12')).toBeInTheDocument();
  expect(requestSpy).toHaveBeenCalledWith(expect.not.stringMatching(/input|output|content/i));
});

it('shows global agent quality metrics for administrators', async () => {
  server.use(http.get('/api/ai/admin/stats', () => HttpResponse.json({
    total: 18,
    completion_rate: 0.8,
    failure_rate: 0.2,
    by_department: {},
    task_ranking: [],
    daily_trend: [],
    feedback_distribution: {},
    tool_call_total: 20,
    tool_call_success_rate: 0.9,
    tool_call_average_latency_ms: 250,
    knowledge_search_total: 12,
    knowledge_search_hit_rate: 0.75,
    citation_coverage_rate: 0.6,
    word_export_total: 5,
    document_format_pass_rate: 0.5,
    answer_without_source_rate: 0.4,
    user_negative_feedback_total: 3,
    tool_error_distribution: { EXPORT_FAILED: 2 },
  })));

  render(<StatsPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新统计' }));

  expect(await screen.findByText('Agent 质量指标')).toBeInTheDocument();
  expect(screen.getByText('工具调用成功率')).toBeInTheDocument();
  expect(screen.getByText('90%')).toBeInTheDocument();
  expect(screen.getByText('平均工具耗时')).toBeInTheDocument();
  expect(screen.getByText('250ms')).toBeInTheDocument();
  expect(screen.getByText('知识检索命中率')).toBeInTheDocument();
  expect(screen.getByText('75%')).toBeInTheDocument();
  expect(screen.getByText('引用覆盖率')).toBeInTheDocument();
  expect(screen.getByText('60%')).toBeInTheDocument();
  expect(screen.getByText('Word 导出次数')).toBeInTheDocument();
  expect(screen.getByText('5')).toBeInTheDocument();
  expect(screen.getByText('用户负反馈数')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('EXPORT_FAILED')).toBeInTheDocument();
});

it('loads task replay metadata from the governance stats page', async () => {
  server.use(
    http.get('/api/ai/admin/stats', () => HttpResponse.json({
      total: 1,
      completion_rate: 1,
      failure_rate: 0,
      by_department: {},
      task_ranking: [],
      daily_trend: [],
      feedback_distribution: {},
    })),
    http.get('/api/ai/admin/task-replays', () => HttpResponse.json({
      total: 1,
      items: [{
        task_state_id: 'state-1',
        conversation_id: 'conversation-1',
        user_id: 'user-replay',
        stage: 'completed',
        goal: '任务 state-1',
        source_summary: [
          { source_type: 'official_knowledge', file_name: '运维白皮书.docx' },
          { type: 'current_attachment', count: 2 },
        ],
        tool_summary: [{ tool_name: 'company_knowledge_search', status: 'success', source_count: 2 }],
        verification_summary: { status: 'warning', reference: { kept_count: 1 }, document: { warnings: ['需人工复核'] } },
        next_action: '可查看摘要或重新生成',
        stage_history: [{ stage: 'completed', next_action: '完成', at: '2026-07-05T01:00:05Z' }],
        created_at: '2026-07-05T01:00:00Z',
        updated_at: '2026-07-05T01:00:05Z',
      }],
    })),
  );

  render(<StatsPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  await userEvent.click(await screen.findByRole('button', { name: '查看任务回放' }));

  expect(await screen.findByText('任务回放')).toBeInTheDocument();
  expect(screen.getByText('任务 state-1')).toBeInTheDocument();
  expect(screen.getByText('查公司知识 · 成功 · 来源 2')).toBeInTheDocument();
  expect(screen.getByText(/运维白皮书\.docx/)).toBeInTheDocument();
  expect(screen.queryByText(/company_knowledge_search|current_attachment|private-input|private-output|完整回答/i)).not.toBeInTheDocument();
});

it('expands task replay into an agent observability detail without exposing prompt bodies', async () => {
  server.use(
    http.get('/api/ai/admin/stats', () => HttpResponse.json({
      total: 1,
      completion_rate: 1,
      failure_rate: 0,
      by_department: {},
      task_ranking: [],
      daily_trend: [],
      feedback_distribution: {},
      tool_error_distribution: { reference_missing: 1 },
    })),
    http.get('/api/ai/admin/task-replays', () => HttpResponse.json({
      total: 1,
      items: [{
        task_state_id: 'state-detail',
        conversation_id: 'conversation-detail',
        user_id: 'user-detail',
        stage: 'completed',
        goal: '生成实施方案',
        source_summary: [{ source_type: 'official_knowledge', file_name: '实施规范.docx' }],
        tool_summary: [{ tool_name: 'company_knowledge_search', status: 'success', source_count: 1 }],
        verification_summary: {
          status: 'warning',
          reference: { kept_count: 1, missing_count: 1 },
          document: { warnings: ['需人工复核交付周期'] },
        },
        next_action: '建议补充客户现场窗口后重新生成',
        stage_history: [
          { stage: 'analyzing', next_action: '识别用户目标', at: '2026-07-05T01:00:00Z' },
          { stage: 'retrieving', next_action: '查找公司知识', at: '2026-07-05T01:00:02Z' },
          { stage: 'quality_check', next_action: '检查引用与格式', at: '2026-07-05T01:00:04Z' },
          { stage: 'completed', next_action: '完成', at: '2026-07-05T01:00:05Z' },
        ],
        created_at: '2026-07-05T01:00:00Z',
        updated_at: '2026-07-05T01:00:05Z',
      }],
    })),
  );

  render(<StatsPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新统计' }));
  await userEvent.click(await screen.findByRole('button', { name: '查看任务回放' }));

  expect(await screen.findByText('Agent 运行观测台')).toBeInTheDocument();
  expect(screen.getByText('生成实施方案')).toBeInTheDocument();
  expect(screen.getByText('运行时间线')).toBeInTheDocument();
  expect(screen.getByText('识别任务')).toBeInTheDocument();
  expect(screen.getByText('查找资料')).toBeInTheDocument();
  expect(screen.getByText('复核结果')).toBeInTheDocument();
  expect(screen.getByText('引用保留 1 条 · 缺失 1 条')).toBeInTheDocument();
  expect(screen.getByText('需人工复核交付周期')).toBeInTheDocument();
  expect(screen.getByText('下一步：建议补充客户现场窗口后重新生成')).toBeInTheDocument();
  expect(screen.getByText('reference_missing')).toBeInTheDocument();
  expect(screen.queryByText(/prompt|用户原文|private-input|private-output/i)).not.toBeInTheDocument();
});

it('saves task, fields, and published Prompt binding in one atomic request', async () => {
  const configurationSpy = vi.fn();
  const legacyRequestSpy = vi.fn();
  const task = {
    uuid: 'task-1', assistant_uuid: 'assistant-1', code: 'sales-summary', name: '销售总结',
    status: 'ACTIVE', fields: [],
    prompt_binding: { prompt_external_id: 88, version_policy: 'PINNED', pinned_version: 3, status: 'ACTIVE' },
  };
  server.use(
    http.get('/api/ai/admin/tasks', () => HttpResponse.json({ items: [task], total: 1 })),
    http.get('/api/ai/capabilities', () => HttpResponse.json({ items: [] })),
    http.put('/api/ai/admin/tasks/task-1/configuration', async ({ request }) => {
      configurationSpy(await request.json());
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1/fields', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
    http.put('/api/ai/admin/tasks/task-1/prompt-binding', () => {
      legacyRequestSpy();
      return HttpResponse.json(task);
    }),
  );
  render(<TaskAdminPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新任务' }));
  await userEvent.click(await screen.findByRole('button', { name: /销售总结/ }));
  await userEvent.click(screen.getByRole('button', { name: '保存并验证' }));
  await waitFor(() => expect(configurationSpy).toHaveBeenCalledWith({
    task: { status: 'ACTIVE' },
    fields: [],
    prompt_binding: {
      prompt_external_id: 88,
      version_policy: 'PINNED',
      pinned_version: 3,
      status: 'ACTIVE',
    },
  }));
  expect(legacyRequestSpy).not.toHaveBeenCalled();
});

it('shows task capability health without exposing prompt or knowledge bodies', async () => {
  server.use(
    http.get('/api/ai/admin/tasks', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/capabilities', () => HttpResponse.json({
      items: [{
        task_uuid: 'task-1',
        task_code: 'work-summary',
        task_name: '工作总结',
        assistant_name: '内部同事',
        task_status: 'ACTIVE',
        input_fields: [{ field_key: 'content', label: '工作内容', field_type: 'TEXTAREA', required: true }],
        output_format: '正式文档',
        document_type: 'FORMAL_DOCUMENT',
        prompt_binding_status: 'configured',
        knowledge_link_count: 2,
      }],
    })),
  );

  render(<TaskAdminPage />);
  await userEvent.click(screen.getByRole('button', { name: '刷新任务' }));

  expect(await screen.findByText('能力健康')).toBeInTheDocument();
  expect(screen.getByText('工作总结')).toBeInTheDocument();
  expect(screen.getByText('内容模板已配置')).toBeInTheDocument();
  expect(screen.getByText('字段 1 个 · 知识 2 条 · ACTIVE')).toBeInTheDocument();
  expect(screen.queryByText(/prompt body|knowledge body/i)).not.toBeInTheDocument();
});
