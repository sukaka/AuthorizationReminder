import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, expect, it } from 'vitest';

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
  );
});

it('hides desktop-only model settings and updater in web mode', async () => {
  render(<App />);

  expect(await screen.findByRole('button', { name: '工作台' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '检查应用更新' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '应用更新未启用' })).not.toBeInTheDocument();
});
