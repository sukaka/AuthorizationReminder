import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { getAuthPortalUrl, getSession } from '../src/api/client';
import { server } from './setup';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__JUXIN_DESKTOP_AUTH_PORTAL__');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('apiFetch runtime token behavior', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('does not attach desktop bearer token in web mode', async () => {
    vi.doMock('../src/runtime/capabilities', () => ({
      isDesktopRuntime: () => false,
    }));
    const { apiFetch } = await import('../src/api/client');

    window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: 'workspace' } } };
    window.sessionStorage.setItem('juxin_ai_assistant_sso_token', 'desktop-token');
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));

    await apiFetch('/api/ai/session');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBeNull();
    expect(init?.credentials).toBe('include');
  });

  it('attaches desktop bearer token only in desktop mode', async () => {
    vi.doMock('../src/runtime/capabilities', () => ({
      isDesktopRuntime: () => true,
    }));
    const { apiFetch } = await import('../src/api/client');

    window.__TAURI_INTERNALS__ = { metadata: { currentWebview: { label: 'workspace' } } };
    window.sessionStorage.setItem('juxin_ai_assistant_sso_token', 'desktop-token');
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('{}'));

    await apiFetch('/api/ai/session');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer desktop-token');
    expect(init?.credentials).toBe('include');
  });
});

describe('unified session shell', () => {
  it('uses the existing unified portal instead of inventing a child login route', () => {
    expect(getAuthPortalUrl()).toBe('http://localhost:5180/portal?system=ai-assistant');
    expect(getAuthPortalUrl()).not.toContain('/login');
  });

  it('can request a real unified logout instead of returning to system selection', () => {
    expect(getAuthPortalUrl({ logout: true })).toBe(
      'http://localhost:5180/portal?system=ai-assistant&logout=1',
    );
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
    expect(getAuthPortalUrl({ logout: true })).toBe(
      'https://auth.dynamic.example/portal?system=ai-assistant&logout=1',
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

  it('uses a desktop SSO handoff token for API calls and removes all SSO callback params from the URL', async () => {
    window.__TAURI_INTERNALS__ = {};
    window.history.replaceState({}, '', '/?sso_token=desktop-sso-token&portal_session=abc');
    const seenAuthorization: string[] = [];
    server.use(
      http.get('/api/ai/session', ({ request }) => {
        seenAuthorization.push(request.headers.get('authorization') ?? '');
        return HttpResponse.json({
          user: { id: 'u-1', username: '张磊', role: 'employee' },
          scope: { department: '技术部', managedDepartments: [] },
          apps: ['ai-assistant'],
          local_binding_token: 'signed-binding-token',
        });
      }),
    );

    await expect(getSession()).resolves.toMatchObject({
      user: { username: '张磊' },
    });

    expect(seenAuthorization).toEqual(['Bearer desktop-sso-token']);
    expect(window.location.search).toBe('');
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

  it('removes SSO callback params from the web URL after the session is accepted', async () => {
    window.history.replaceState({}, '', '/?portal_session=browser-session&sso_token=browser-token');
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
    expect(window.location.search).toBe('');
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
