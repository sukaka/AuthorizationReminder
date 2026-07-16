import { expect, test, type Page } from '@playwright/test';

type ProbeOutcome = 'success' | 'tls' | 'timeout';
type UpdateOutcome = 'idle' | 'available';

type LauncherScenario = {
  readonly probe: ProbeOutcome;
  readonly initialUpdate: UpdateOutcome;
  readonly manualUpdate: UpdateOutcome;
};

const DEFAULT_SCENARIO = {
  probe: 'success',
  initialUpdate: 'idle',
  manualUpdate: 'idle',
} as const satisfies LauncherScenario;

async function openLauncher(
  page: Page,
  scenario: LauncherScenario = DEFAULT_SCENARIO,
): Promise<void> {
  await page.addInitScript((input: LauncherScenario) => {
    const callbacks = new Map<number, (message: unknown) => void>();
    let callbackId = 1;
    const update = {
      contentLength: 18_600_000,
      notes: '优化离线启动体验\n提升更新下载稳定性',
      version: '5.89.1',
    };
    const updateStatus = (outcome: UpdateOutcome) =>
      outcome === 'available'
        ? { kind: 'available', update }
        : { enabled: true, kind: 'idle' };

    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        metadata: { currentWebview: { label: 'launcher' } },
        transformCallback(callback: (message: unknown) => void) {
          const id = callbackId;
          callbackId += 1;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(
          command: string,
          args: Record<string, unknown> = {},
        ) {
          switch (command) {
            case 'plugin:app|version':
              return '5.89.0';
            case 'plugin:event|listen': {
              const handler = args.handler;
              if (typeof handler !== 'number') {
                throw new TypeError('Event handler must be a callback identifier');
              }
              return handler;
            }
            case 'plugin:event|unlisten':
            case 'server_config_save':
            case 'update_defer':
              return null;
            case 'workspace_open':
              (window as typeof window & {
                __E2E_WORKSPACE_ORIGIN__?: unknown;
              }).__E2E_WORKSPACE_ORIGIN__ = args.origin;
              return null;
            case 'server_config_get':
              return null;
            case 'server_probe':
              if (input.probe === 'success') {
                return {
                  authPortalUrl:
                    'https://auth.example.com/portal?system=ai-assistant',
                };
              }
              throw new Error(input.probe);
            case 'update_status':
              return updateStatus(input.initialUpdate);
            case 'update_check':
              return updateStatus(input.manualUpdate);
            default:
              throw new Error(`Unexpected Tauri command: ${command}`);
          }
        },
      },
    });
    Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
      configurable: true,
      value: {
        unregisterListener(_event: string, id: number) {
          callbacks.delete(id);
        },
      },
    });
  }, scenario);

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '让日常工作更高效' }),
  ).toBeVisible();
}

async function probe(page: Page): Promise<void> {
  await page.getByLabel('远程服务地址').fill('https://ai.example.com');
  await page.getByRole('button', { name: '测试连接' }).click();
}

test('shows the local launcher when business services are offline', async ({
  page,
}) => {
  const businessRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://')) {
      businessRequests.push(request.url());
    }
  });
  await page.route('https://**/*', (route) => route.abort('internetdisconnected'));

  await openLauncher(page);

  await expect(page.getByLabel('远程服务地址')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用统一登录' })).toBeDisabled();
  expect(businessRequests).toEqual([]);
});

test('enables unified login after a successful connection probe', async ({
  page,
}) => {
  await openLauncher(page);

  await probe(page);

  await expect(page.getByText('连接成功，可以使用统一登录。')).toBeVisible();
  const login = page.getByRole('button', { name: '使用统一登录' });
  await expect(login).toBeEnabled();
  await login.click();
  await expect(page.getByText('正在打开统一登录…')).toBeVisible();
  expect(await page.evaluate(() => (
    window as typeof window & { __E2E_WORKSPACE_ORIGIN__?: unknown }
  ).__E2E_WORKSPACE_ORIGIN__)).toBe('https://ai.example.com');
});

const CONNECTION_FAILURES = [
  ['tls', '服务器证书不受信任或已过期，请联系管理员处理。'],
  ['timeout', '服务器暂未响应，请稍后重试或修改地址。'],
] as const;

for (const [failure, message] of CONNECTION_FAILURES) {
  test(`shows the localized ${failure} connection failure`, async ({ page }) => {
    await openLauncher(page, { ...DEFAULT_SCENARIO, probe: failure });

    await probe(page);

    await expect(page.getByRole('alert')).toHaveText(message);
    await expect(page.getByRole('button', { name: '重新测试' })).toBeEnabled();
  });
}

test('opens a signed update prompt from native startup status', async ({
  page,
}) => {
  await openLauncher(page, {
    ...DEFAULT_SCENARIO,
    initialUpdate: 'available',
  });

  await expect(
    page.getByRole('dialog', { name: '发现新版本 5.89.1' }),
  ).toBeVisible();
  await expect(page.getByText('优化离线启动体验')).toBeVisible();
  await expect(page.getByText('17.7 MB')).toBeVisible();
});

test('defers the prompted update without blocking the launcher', async ({
  page,
}) => {
  await openLauncher(page, {
    ...DEFAULT_SCENARIO,
    initialUpdate: 'available',
  });

  await page.getByRole('button', { name: '稍后提醒' }).click();

  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(
    page.getByText('已稍后提醒，24 小时内不会再次自动弹出此版本。'),
  ).toBeVisible();
  await expect(page.getByLabel('远程服务地址')).toBeEnabled();
});

test('shows an available update after a manual check', async ({ page }) => {
  await openLauncher(page, {
    ...DEFAULT_SCENARIO,
    manualUpdate: 'available',
  });

  await page.getByRole('button', { name: '检查更新' }).click();

  await expect(
    page.getByRole('dialog', { name: '发现新版本 5.89.1' }),
  ).toBeVisible();
});
