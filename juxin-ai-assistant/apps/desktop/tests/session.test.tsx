import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { getAuthPortalUrl } from '../src/api/client';
import { server } from './setup';

afterEach(() => {
  Reflect.deleteProperty(window, '__JUXIN_DESKTOP_AUTH_PORTAL__');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('unified session shell', () => {
  it('uses the existing unified portal instead of inventing a child login route', () => {
    expect(getAuthPortalUrl()).toBe('http://localhost:5180/portal?system=ai-assistant');
    expect(getAuthPortalUrl()).not.toContain('/login');
  });

  it('uses the native-verified portal for a dynamically configured desktop server', () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined),
    };
    window.__JUXIN_DESKTOP_AUTH_PORTAL__ =
      'https://auth.dynamic.example/portal?system=ai-assistant';

    expect(getAuthPortalUrl()).toBe(
      'https://auth.dynamic.example/portal?system=ai-assistant',
    );
  });

  it('ignores an unsafe desktop portal override', () => {
    window.__TAURI_INTERNALS__ = {};
    window.__JUXIN_DESKTOP_AUTH_PORTAL__ =
      'https://user@auth.dynamic.example/portal#token';

    expect(getAuthPortalUrl()).toBe(
      'http://localhost:5180/portal?system=ai-assistant',
    );
  });

  it('renders the authenticated workspace without a password form', async () => {
    server.use(
      http.get('/api/ai/session', () =>
        HttpResponse.json({
          user: { id: 'u-1', username: '张磊', role: 'employee' },
          scope: { department: '技术部', managedDepartments: [] },
          apps: ['ai-assistant'],
          local_binding_token: 'signed-binding-token',
        }),
      ),
    );

    render(<App />);

    expect(await screen.findByText('上午好，张磊')).toBeInTheDocument();
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  });

  it('shows a permission state returned by the unified platform', async () => {
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(undefined),
    };
    server.use(
      http.get('/api/ai/session', () =>
        HttpResponse.json(
          { success: false, code: 'FORBIDDEN', message: '无权访问聚信 AI 助手', data: null },
          { status: 403 },
        ),
      ),
    );

    render(<App />);

    expect(await screen.findByText('暂时无法进入工作台')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回统一门户' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '返回启动页' }),
    ).toBeInTheDocument();
  });

  it('logs out the server before native cleanup closes the workspace', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    window.__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockImplementation(async (command: string) => {
        if (command === 'local_logout') order.push('native');
      }),
    };
    server.use(
      http.get('/api/ai/session', () =>
        HttpResponse.json({
          user: { id: 'u-1', username: '张磊', role: 'employee' },
          scope: { department: '技术部', managedDepartments: [] },
          apps: ['ai-assistant'],
          local_binding_token: 'signed-binding-token',
        }),
      ),
      http.post('/api/ai/logout', () => {
        order.push('server');
        return HttpResponse.json({ success: true });
      }),
      http.get('/api/ai/home', () =>
        HttpResponse.json({
          favorites: [],
          recent_tasks: [],
          recent_generations: [],
          safety_reminders: [],
        }),
      ),
    );

    render(<App />);
    await user.click(
      await screen.findByRole('button', { name: '退出登录' }),
    );

    await vi.waitFor(() => expect(order).toEqual(['server', 'native']));
  });
});
