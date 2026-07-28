import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it, vi } from 'vitest';

import App from '../src/App';
import { server } from './setup';

beforeEach(() => {
  delete window.__TAURI_INTERNALS__;

  server.use(
    http.get('/api/ai/session', () =>
      HttpResponse.json({
        user: { id: 'u-web', username: '网页用户', role: 'employee' },
        scope: { department: '通用', managedDepartments: [] },
        apps: ['ai-assistant'],
        local_binding_token: 'signed-binding-token',
      }),
    ),
    http.get('/api/ai/home', () =>
      HttpResponse.json({
        favorites: [],
        recent_tasks: [],
        recent_generations: [],
        safety_reminders: [],
      }),
    ),
    http.get('/api/ai/projects', () => HttpResponse.json([])),
    http.get('/api/conversations', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/ai/long-tasks', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/categories', () => HttpResponse.json({ items: [], total: 0 })),
    http.get('/api/knowledge/document-types', () => HttpResponse.json({ items: [], total: 0 })),
  );
});

it('shows server-side model settings guidance and hides updater in web mode', async () => {
  server.use(
    http.get('/api/ai/chat/model/status', () => HttpResponse.json({
      configured: true,
      model_display_name: 'DeepSeek 服务端模型',
      model_id: 'deepseek-chat',
      message: '服务端模型已配置',
    })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({
      items: [],
      total: 0,
    })),
  );
  render(<App />);

  expect(await screen.findByRole('region', { name: '私人工作助理工作区' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '工作台' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(await screen.findByText('Web 端个人模型')).toBeInTheDocument();
  expect(screen.getByText('未配置个人模型时，会自动使用服务端统一模型。')).toBeInTheDocument();
  expect(await screen.findByText('DeepSeek 服务端模型')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '检查应用更新' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '应用更新未启用' })).not.toBeInTheDocument();
});

it('lets web users save a personal model profile without storing keys in Tauri', async () => {
  const createProfile = vi.fn();
  server.use(
    http.get('/api/ai/chat/model/status', () => HttpResponse.json({
      configured: true,
      model_display_name: '服务端统一模型',
      model_id: 'server-chat',
      message: '服务端模型已配置',
    })),
    http.get('/api/ai/model-profiles', () => HttpResponse.json({
      items: [],
      total: 0,
    })),
    http.post('/api/ai/model-profiles', async ({ request }) => {
      createProfile(await request.json());
      return HttpResponse.json({
        uuid: 'web-profile-1',
        display_name: '我的 DeepSeek',
        base_url: 'https://api.deepseek.com',
        model_id: 'deepseek-chat',
        temperature: 0.3,
        max_output_tokens: 8192,
        timeout_seconds: 300,
        is_default: true,
        has_api_key: true,
        status: 'ACTIVE',
        created_at: '2026-07-07T10:00:00',
        updated_at: '2026-07-07T10:00:00',
      }, { status: 201 });
    }),
  );

  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '设置' }));
  await userEvent.type(await screen.findByLabelText('名称'), '我的 DeepSeek');
  await userEvent.type(screen.getByLabelText('服务地址'), 'https://api.deepseek.com');
  await userEvent.type(screen.getByLabelText('模型名称'), 'deepseek-chat');
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-web-secret');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  await screen.findByText('模型配置已加密保存');
  expect(createProfile).toHaveBeenCalledWith(expect.objectContaining({
    display_name: '我的 DeepSeek',
    base_url: 'https://api.deepseek.com',
    model_id: 'deepseek-chat',
    api_key: 'sk-web-secret',
    is_default: true,
  }));
  expect(screen.queryByText('sk-web-secret')).not.toBeInTheDocument();
});
