import { expect, test, type Page } from '@playwright/test';

async function installWorkspaceBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const commands: Array<{ command: string; args: Record<string, unknown> }> = [];
    Object.defineProperty(window, '__E2E_TAURI_COMMANDS__', {
      configurable: true,
      value: commands,
    });
    Object.defineProperty(window, '__JUXIN_DESKTOP_AUTH_PORTAL__', {
      configurable: true,
      value: 'http://localhost:18093/auth-portal?system=ai-assistant',
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        async invoke(command: string, args: Record<string, unknown> = {}) {
          commands.push({ command, args });
          if (command === 'local_session_bind' || command === 'workspace_ready' || command === 'workspace_status') return null;
          if (command === 'update_status') return { kind: 'idle', enabled: true };
          if (command === 'update_check') return { kind: 'idle', enabled: true };
          if (command === 'plugin:event|listen') return 1;
          if (command === 'plugin:event|unlisten') return null;
          throw new Error(`Unexpected Tauri command: ${command}`);
        },
      },
    });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      configurable: true,
      value: { unregisterListener() {} },
    });
  });
}

async function commands(page: Page) {
  return page.evaluate(() => (
    window as typeof window & {
      __E2E_TAURI_COMMANDS__: Array<{ command: string; args: Record<string, unknown> }>;
    }
  ).__E2E_TAURI_COMMANDS__);
}

test('redirects a 401 session to the trusted SSO portal', async ({ page }) => {
  await installWorkspaceBridge(page);
  await page.route('**/api/ai/session', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/auth-portal**', (route) => route.fulfill({ body: '<h1>统一登录</h1>', contentType: 'text/html' }));

  await page.goto('/');

  await expect(page).toHaveURL(/\/auth-portal\?system=ai-assistant$/);
});

test('shows a usable forbidden state and reports 403 to native recovery', async ({ page }) => {
  await installWorkspaceBridge(page);
  await page.route('**/api/ai/session', (route) => route.fulfill({ status: 403, json: {} }));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: '暂时无法进入 AI 助手' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回启动页' })).toBeVisible();
  await expect.poll(async () => commands(page)).toContainEqual({
    command: 'workspace_status',
    args: { status: 'forbidden' },
  });
});

test('reports a service interruption and keeps a return-to-launcher action', async ({ page }) => {
  await installWorkspaceBridge(page);
  await page.route('**/api/ai/session', (route) => route.abort('connectionrefused'));

  await page.goto('/');

  await expect(page.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回启动页' })).toBeVisible();
  await expect.poll(async () => commands(page)).toContainEqual({
    command: 'workspace_status',
    args: { status: 'network-error' },
  });
});

test('redirects an expired session encountered after workspace entry', async ({ page }) => {
  await installWorkspaceBridge(page);
  await page.route('**/api/ai/session', (route) => route.fulfill({ json: {
    user: { id: 'u-e2e', username: '员工', role: 'employee' },
    scope: { department: '销售部', managedDepartments: [] },
    apps: ['ai-assistant'],
    local_binding_token: 'binding-token',
  } }));
  await page.route('**/api/ai/home', (route) => route.fulfill({ json: {
    favorites: [], recent_tasks: [], recent_generations: [], safety_reminders: [],
  } }));
  await page.route('**/api/ai/catalog**', (route) => route.fulfill({ status: 401, json: {} }));
  await page.route('**/auth-portal**', (route) => route.fulfill({ body: '<h1>统一登录</h1>', contentType: 'text/html' }));

  await page.goto('/');
  await page.getByRole('button', { name: 'AI 能力', exact: true }).click();

  await expect(page).toHaveURL(/\/auth-portal\?system=ai-assistant$/);
});
