import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { expect, it, vi } from 'vitest';

import { FeedbackPanel } from '../src/components/FeedbackPanel';
import { HistoryPage } from '../src/pages/HistoryPage';
import { server } from './setup';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

const historyItem = {
  uuid: 'gen-1',
  task_uuid: 'task-1',
  task_name: '工作总结',
  assistant_code: 'general',
  assistant_name: '通用助手',
  status: 'COMPLETED',
  model_display_name: '公司模型',
  model_id: 'model-1',
  prompt_version: 3,
  latency_ms: 120,
  usage: {},
  created_at: '2026-06-20T08:00:00Z',
  finished_at: '2026-06-20T08:00:01Z',
};

it('loads work artifact detail only after selection and requires delete confirmation', async () => {
  const listRequest = vi.fn();
  const detailRequest = vi.fn();
  const deleteRequest = vi.fn();
  const exportRequest = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  server.use(
    http.get('/api/ai/work-artifacts', ({ request }) => {
      const url = new URL(request.url);
      listRequest(Object.fromEntries(url.searchParams));
      return HttpResponse.json({
        items: [{
        artifact_uuid: 'artifact-word-1',
        conversation_id: 'chat-1',
        message_id: 'assistant-1',
        title: '交付方案',
        artifact_type: 'word_document',
        source_scope: 'chat',
        source_summary: [{
          source_type: 'official_knowledge',
          file_name: '交付手册.pdf',
          page_number: 6,
          section_title: '验收交付物',
        }],
        content_summary: 'Word 文档已生成，可下载或基于原会话继续整理。',
        file_name: '交付方案.docx',
        version: 1,
        status: 'active',
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:01Z',
      }],
      total: 1,
      page: 1,
        page_size: 100,
      });
    }),
    http.get('/api/ai/work-artifacts/artifact-word-1', () => {
      detailRequest();
      return HttpResponse.json({
        artifact_uuid: 'artifact-word-1',
        conversation_id: 'chat-1',
        message_id: 'assistant-1',
        title: '交付方案',
        artifact_type: 'word_document',
        source_scope: 'chat',
        source_summary: [{
          source_type: 'official_knowledge',
          file_name: '交付手册.pdf',
          page_number: 6,
          section_title: '验收交付物',
        }],
        content_summary: 'Word 文档已生成，可下载或基于原会话继续整理。',
        file_name: '交付方案.docx',
        version: 1,
        status: 'active',
        content: null,
        download_url: '/api/export/download/artifact-word-1',
        versions: [{
          version_uuid: 'version-1',
          version: 1,
          source: 'word_export',
          source_ref: 'artifact-word-1',
          file_name: '交付方案.docx',
          source_summary: [],
          content_summary: 'Word 文档已生成，可下载或基于原会话继续整理。',
          created_at: '2026-06-20T08:00:01Z',
        }],
        created_at: '2026-06-20T08:00:00Z',
        updated_at: '2026-06-20T08:00:01Z',
      });
    }),
    http.delete('/api/ai/work-artifacts/artifact-word-1', () => {
      deleteRequest();
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/export/word', async ({ request }) => {
      exportRequest(await request.json());
      return HttpResponse.json({
        file_name: '交付方案-v2.docx',
        download_url: '/api/export/download/artifact-word-v2',
      }, { status: 201 });
    }),
    http.get('/api/export/download/artifact-word-v2', () => new HttpResponse(
      new Uint8Array([100, 111, 99, 120]).buffer,
      {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': "attachment; filename*=UTF-8''artifact-v2.docx",
        },
      },
    )),
  );
  invokeMock.mockImplementation((command: string, payload?: unknown) => {
    if (command === 'generation_word_save') {
      expect(payload).toEqual({
        fileName: 'artifact-v2.docx',
        bytes: [100, 111, 99, 120],
      });
      return Promise.resolve('/Users/test/Downloads/artifact-v2.docx');
    }
    return Promise.resolve(undefined);
  });

  render(<HistoryPage />);

  expect(await screen.findByText('交付方案')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('类型筛选'), 'word_document');
  await userEvent.type(screen.getByLabelText('开始日期'), '2026-06-01');
  await userEvent.type(screen.getByLabelText('结束日期'), '2026-06-30');
  await waitFor(() => expect(listRequest).toHaveBeenLastCalledWith(expect.objectContaining({
    artifact_type: 'word_document',
    created_from: '2026-06-01T00:00:00',
    created_to: '2026-06-30T23:59:59',
  })));
  expect(detailRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /交付方案/ }));
  expect(await screen.findByRole('heading', { name: '交付方案' })).toBeInTheDocument();
  expect(screen.getByText('交付方案.docx')).toBeInTheDocument();
  expect(screen.getByText('交付手册.pdf')).toBeInTheDocument();
  expect(screen.getByText('验收交付物 · 第 6 页')).toBeInTheDocument();
  expect(detailRequest).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: '生成新版本' }));
  await waitFor(() => expect(exportRequest).toHaveBeenCalledWith(expect.objectContaining({
    conversation_id: 'chat-1',
    message_id: 'assistant-1',
    export_type: 'single_answer',
    template: 'juxin_standard',
  })));
  expect(await screen.findByText('Word 已开始下载')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '删除成果' }));
  expect(deleteRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(deleteRequest).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: '交付方案' })).not.toBeInTheDocument();
});

it('offers seven feedback types and requires text only for other feedback', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  render(<FeedbackPanel generationUuid="gen-1" onSubmit={submit} />);

  expect(screen.getAllByRole('radio')).toHaveLength(7);
  expect(screen.queryByLabelText('补充说明')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: '其他' }));
  expect(screen.getByLabelText('补充说明')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '提交反馈' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('补充说明'), '需要更多上下文');
  await userEvent.click(screen.getByRole('button', { name: '提交反馈' }));
  expect(submit).toHaveBeenCalledWith('OTHER', '需要更多上下文');
});
