import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { AssistantModesAdminPage } from '../src/pages/admin/AssistantModesAdminPage';
import { server } from './setup';

const mode = {
  uuid: 'mode-general',
  code: 'general',
  name: '通用办公助手',
  description: '处理日常办公任务',
  icon: 'sparkles',
  allowed_tools: ['company_knowledge_search'],
  default_source_scope: 'company',
  default_output_structure: '摘要、正文、下一步',
  word_template: 'juxin_standard',
  status: 'ACTIVE',
  version: 3,
  test_cases: [],
  review_status: 'approved',
  failure_rate: 0.125,
  available_versions: [3, 2, 1],
  created_at: '2026-07-10T08:00:00Z',
  updated_at: '2026-07-10T08:00:00Z',
};

it('edits, tests, disables and rolls back an assistant mode', async () => {
  const saveRequest = vi.fn();
  const testRequest = vi.fn();
  const disableRequest = vi.fn();
  const rollbackRequest = vi.fn();
  server.use(
    http.get('/api/ai/admin/assistant-modes', () => HttpResponse.json({ items: [mode], total: 1 })),
    http.put('/api/ai/admin/assistant-modes/mode-general', async ({ request }) => {
      saveRequest(await request.json());
      return HttpResponse.json({ ...mode, version: 4, default_source_scope: 'company_and_personal' });
    }),
    http.post('/api/ai/admin/assistant-modes/mode-general/test', async ({ request }) => {
      testRequest(await request.json());
      return HttpResponse.json({ status: 'passed', issues: [], persisted: false });
    }),
    http.post('/api/ai/admin/assistant-modes/mode-general/disable', () => {
      disableRequest();
      return HttpResponse.json({ ...mode, status: 'DISABLED', version: 4 });
    }),
    http.post('/api/ai/admin/assistant-modes/mode-general/rollback', async ({ request }) => {
      rollbackRequest(await request.json());
      return HttpResponse.json({ ...mode, version: 5 });
    }),
  );

  render(<AssistantModesAdminPage />);

  expect(await screen.findByRole('heading', { name: '助手模式治理' })).toBeInTheDocument();
  expect(screen.getByText(/失败率 12\.5%/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('默认资料范围'), 'company_and_personal');
  await userEvent.click(screen.getByRole('checkbox', { name: '导出 Word' }));
  await userEvent.type(screen.getByLabelText('配置测试样例'), '生成季度总结');
  await userEvent.click(screen.getByRole('button', { name: '保存模式' }));
  await waitFor(() => expect(saveRequest).toHaveBeenCalledWith(expect.objectContaining({
    code: 'general',
    default_source_scope: 'company_and_personal',
    allowed_tools: ['company_knowledge_search', 'word_export'],
    test_cases: [{ name: '默认样例', input: '生成季度总结' }],
  })));

  await userEvent.type(screen.getByLabelText('试运行输入'), '生成内部周报');
  await userEvent.click(screen.getByRole('button', { name: '试运行' }));
  await waitFor(() => expect(testRequest).toHaveBeenCalledWith({ input: '生成内部周报' }));
  expect(await screen.findByText('试运行通过，未写入正式任务或工作成果。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '停用模式' }));
  await waitFor(() => expect(disableRequest).toHaveBeenCalled());
  await userEvent.selectOptions(screen.getByLabelText('历史版本'), '2');
  await userEvent.click(screen.getByRole('button', { name: '回滚版本' }));
  await waitFor(() => expect(rollbackRequest).toHaveBeenCalledWith({ version: 2 }));

  const toolbar = screen.getByRole('group', { name: '模式操作' });
  expect(within(toolbar).getByRole('button', { name: '新建模式' })).toBeInTheDocument();
});
