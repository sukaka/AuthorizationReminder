import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { LauncherPage } from '../src/launcher/LauncherPage';
import type {
  DesktopBridge,
  ProbeFailureKind,
  UpdateStatus,
} from '../src/remote/desktopBridge';
import { desktopBridge } from '../src/remote/desktopBridge';

type FakeBridgeOptions = {
  readonly localLauncher?: boolean;
  readonly savedOrigin?: string | null;
  readonly lastSuccessfulCheckAt?: string | null;
  readonly probeFailure?: ProbeFailureKind;
  readonly saveFailure?: boolean;
  readonly registerWorkspaceRecovery?: (
    listener: (recovery: { readonly reason: ProbeFailureKind }) => void,
  ) => void;
  readonly updateStatus?: UpdateStatus;
  readonly checkResult?: UpdateStatus;
  readonly checkFailure?: boolean;
  readonly installFailure?: boolean;
  readonly cancelFailure?: boolean;
  readonly deferFailure?: boolean;
  readonly registerUpdateStatus?: (listener: (status: UpdateStatus) => void) => void;
  readonly updateCallOrder?: string[];
};

function fakeBridge(options: FakeBridgeOptions = {}): DesktopBridge {
  return {
    isLocalLauncherContext: () => options.localLauncher ?? true,
    closeWorkspace: vi.fn().mockResolvedValue(undefined),
    bindLocalSession: vi.fn().mockResolvedValue(undefined),
    markWorkspaceReady: vi.fn().mockResolvedValue(undefined),
    reportWorkspaceStatus: vi.fn().mockResolvedValue(undefined),
    getServerConfig: vi.fn().mockResolvedValue({
      serverOrigin: options.savedOrigin ?? null,
      lastSuccessfulCheckAt: options.lastSuccessfulCheckAt ?? null,
      currentVersion: '1.0.0',
    }),
    probeServer: options.probeFailure
      ? vi.fn().mockRejectedValue({
          kind: options.probeFailure,
        })
      : vi.fn().mockResolvedValue({
          authPortalUrl: 'https://auth.example.com/portal?system=ai-assistant',
        }),
    saveServerConfig: options.saveFailure
      ? vi.fn().mockRejectedValue(new Error('connection'))
      : vi.fn().mockResolvedValue(undefined),
    openWorkspace: vi.fn().mockResolvedValue(undefined),
    onWorkspaceRecovered: vi.fn().mockImplementation(async (listener) => {
      options.registerWorkspaceRecovery?.(listener);
      return () => undefined;
    }),
    getUpdateStatus: vi.fn().mockImplementation(async () => {
      options.updateCallOrder?.push('status');
      return options.updateStatus ?? { kind: 'idle', enabled: true };
    }),
    checkForUpdates: options.checkFailure
      ? vi.fn().mockRejectedValue(new Error('check failed'))
      : vi.fn().mockResolvedValue(
          options.checkResult ?? { kind: 'idle', enabled: true },
        ),
    downloadAndInstallUpdate: options.installFailure
      ? vi.fn().mockRejectedValue(new Error('download failed'))
      : vi.fn().mockResolvedValue(undefined),
    cancelUpdate: options.cancelFailure
      ? vi.fn().mockRejectedValue(new Error('cancel failed'))
      : vi.fn().mockResolvedValue(undefined),
    deferUpdate: options.deferFailure
      ? vi.fn().mockRejectedValue(new Error('defer failed'))
      : vi.fn().mockResolvedValue(undefined),
    onUpdateStatusChanged: vi.fn().mockImplementation(async (listener) => {
      options.updateCallOrder?.push('listen');
      options.registerUpdateStatus?.(listener);
      return () => undefined;
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

async function readyServerInput(): Promise<HTMLInputElement> {
  const input =
    screen.getByLabelText<HTMLInputElement>('远程服务地址');
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

describe('local launcher', () => {
  it('recognizes the launcher label in a Tauri development URL', () => {
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWebview: { label: 'launcher' } },
    };

    expect(desktopBridge.isLocalLauncherContext()).toBe(true);
  });

  it('shows product introduction before any business network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<LauncherPage bridge={fakeBridge()} />);

    expect(
      screen.getByRole('heading', { name: '你的私人助理' }),
    ).toBeVisible();
    expect(screen.getByText(/十类私人助理，258项工作技能/)).toBeVisible();
    expect(screen.queryByText('八类助手，88 项常用任务')).not.toBeInTheDocument();
    expect(screen.getByText(/统一登录，安全接入/)).toBeVisible();
    expect(screen.getByText('统一登录后请选择要进入的系统，我不会在本机保存账号密码。')).toBeVisible();
    expect(screen.getByText('你的设置只在本机')).toBeVisible();
    expect(screen.queryByText('模型密钥保存在系统钥匙串')).not.toBeInTheDocument();
    expect(screen.getByText('草稿我会先替你收好')).toBeVisible();
    expect(screen.getByLabelText('远程服务地址')).toBeVisible();
    expect(screen.getByText('统一登录后请选择要进入的系统。')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '使用统一登录' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看本机草稿' })).toBeEnabled();
    expect(await screen.findByText((content) => content.includes('版本 1.0.0'))).toBeVisible();
    expect(screen.getByRole('button', { name: '检查更新' })).toBeEnabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps public HTTP and non-origin addresses from being probed', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();

    render(<LauncherPage bridge={bridge} />);
    await user.type(await readyServerInput(), 'http://ai.example.com/path');

    expect(
      screen.getByText('请输入不含路径、参数或账号信息的 HTTPS 地址。'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    expect(bridge.probeServer).not.toHaveBeenCalled();
  });

  it('keeps the primary controls in a predictable keyboard order', async () => {
    const user = userEvent.setup();

    render(<LauncherPage bridge={fakeBridge()} />);

    await readyServerInput();
    await user.tab();
    expect(screen.getByLabelText('远程服务地址')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '查看本机草稿' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: '检查更新' })).toHaveFocus();
  });

  it('opens a protected local drafts and pending-sync status entry', async () => {
    const user = userEvent.setup();

    render(<LauncherPage bridge={fakeBridge()} />);
    await user.click(screen.getByRole('button', { name: '查看本机草稿' }));
    const dialog = screen.getByRole('dialog', { name: '本机草稿与待同步' });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveTextContent('草稿内容');
    expect(dialog).toHaveTextContent('待同步结果');
    expect(dialog).toHaveTextContent('统一登录确认身份后开放');

    await user.click(screen.getByRole('button', { name: '关闭本机数据状态' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('allows a manual update check from the launcher', async () => {
    const user = userEvent.setup();

    render(<LauncherPage bridge={fakeBridge()} />);

    const check = await screen.findByRole('button', { name: '检查更新' });
    await waitFor(() => expect(check).toBeEnabled());
    await user.click(check);
    expect(await screen.findByText('当前已是最新版本。')).toBeVisible();
  });

  it('subscribes before reading update status and releases the listener', async () => {
    const order: string[] = [];
    const unlisten = vi.fn();
    const bridge = fakeBridge({ updateCallOrder: order });
    vi.mocked(bridge.onUpdateStatusChanged).mockImplementation(async () => {
      order.push('listen');
      return unlisten;
    });

    const view = render(<LauncherPage bridge={bridge} />);
    await waitFor(() => expect(bridge.getUpdateStatus).toHaveBeenCalledOnce());
    expect(order).toEqual(['listen', 'status']);

    view.unmount();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('keeps server controls available while checking for updates', async () => {
    const user = userEvent.setup();
    let finishCheck: ((status: UpdateStatus) => void) | undefined;
    const bridge = fakeBridge({
      savedOrigin: 'https://ai.example.com',
      lastSuccessfulCheckAt: '2026-06-21T04:00:00Z',
    });
    vi.mocked(bridge.checkForUpdates).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );

    render(<LauncherPage bridge={bridge} />);
    const input = await readyServerInput();
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    expect(screen.getByRole('button', { name: '正在检查…' })).toBeDisabled();
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: '使用统一登录' })).toBeEnabled();
    finishCheck?.({ kind: 'idle', enabled: true });
    expect(await screen.findByText('当前已是最新版本。')).toBeVisible();
  });

  it('reports a check failure without opening a modal or blocking login', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({
      checkFailure: true,
      savedOrigin: 'https://ai.example.com',
      lastSuccessfulCheckAt: '2026-06-21T04:00:00Z',
    });

    render(<LauncherPage bridge={bridge} />);
    await readyServerInput();
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    expect(await screen.findByText('暂时无法检查更新，当前版本仍可继续使用。')).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('远程服务地址')).toBeEnabled();
    expect(screen.getByRole('button', { name: '使用统一登录' })).toBeEnabled();
  });

  it('opens an update dialog from a native status event', async () => {
    let emitUpdate: ((status: UpdateStatus) => void) | undefined;
    const bridge = fakeBridge({
      registerUpdateStatus: (listener) => {
        emitUpdate = listener;
      },
    });

    render(<LauncherPage bridge={bridge} />);
    await readyServerInput();
    emitUpdate?.({
      kind: 'available',
      update: {
        contentLength: 18_600_000,
        notes: '优化启动速度',
        version: '1.1.0',
      },
    });

    expect(
      await screen.findByRole('dialog', { name: '发现新版本 1.1.0' }),
    ).toBeVisible();
  });

  it.each([
    [
      '稍后提醒',
      { deferFailure: true },
      '暂时无法保存提醒时间，请稍后重试。',
    ],
    [
      '下载并安装',
      { installFailure: true },
      '暂时无法开始下载更新，请稍后重试。',
    ],
  ] as const)(
    'keeps a failed %s action visible inside the update dialog',
    async (action, failure, message) => {
      const user = userEvent.setup();
      const bridge = fakeBridge({
        ...failure,
        updateStatus: {
          kind: 'available',
          update: {
            contentLength: 18_600_000,
            notes: '优化启动速度',
            version: '1.1.0',
          },
        },
      });

      render(<LauncherPage bridge={bridge} />);
      await user.click(
        await screen.findByRole('button', { name: action }),
      );

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('dialog')).toBeVisible();
    },
  );

  it('keeps a failed cancellation visible inside the update dialog', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({
      cancelFailure: true,
      updateStatus: {
        kind: 'downloading',
        update: {
          contentLength: 18_600_000,
          notes: '优化启动速度',
          version: '1.1.0',
        },
        received: 4_000,
        total: 10_000,
      },
    });

    render(<LauncherPage bridge={bridge} />);
    await user.click(
      await screen.findByRole('button', { name: '取消下载' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '更新已进入安装阶段，不能再取消。',
    );
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('associates the address field with validation and help text', () => {
    render(<LauncherPage bridge={fakeBridge()} />);

    expect(screen.getByLabelText('远程服务地址')).toHaveAttribute(
      'aria-describedby',
      'server-origin-status server-origin-help',
    );
  });

  it('enables unified login only after probe and save succeed', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();

    render(<LauncherPage bridge={bridge} />);
    await user.type(await readyServerInput(), 'https://ai.example.com/');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByText('连接成功，可以使用统一登录。')).toBeVisible();
    expect(bridge.probeServer).toHaveBeenCalledWith('https://ai.example.com');
    expect(bridge.saveServerConfig).toHaveBeenCalledWith(
      'https://ai.example.com',
    );

    const login = screen.getByRole('button', { name: '使用统一登录' });
    expect(login).toBeEnabled();
    await user.click(login);

    expect(bridge.openWorkspace).toHaveBeenCalledWith('https://ai.example.com');
    expect(await screen.findByText('正在打开统一登录…')).toBeVisible();
  });

  it('restores a previously successful saved server without another probe', async () => {
    render(
      <LauncherPage
        bridge={fakeBridge({
          savedOrigin: 'https://ai.example.com',
          lastSuccessfulCheckAt: '2026-06-21T04:00:00Z',
        })}
      />,
    );

    expect(
      await screen.findByText('连接成功，可以使用统一登录。'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '使用统一登录' }),
    ).toBeEnabled();
  });

  it('prefills an unverified build default without treating it as saved trust', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({
      savedOrigin: 'https://default.example.com',
      lastSuccessfulCheckAt: null,
    });
    const confirm = vi.spyOn(window, 'confirm');

    render(<LauncherPage bridge={bridge} />);
    const input = await readyServerInput();
    expect(input).toHaveValue('https://default.example.com');
    expect(screen.getByRole('button', { name: '使用统一登录' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'https://new.example.com');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(bridge.saveServerConfig).toHaveBeenCalledWith(
      'https://new.example.com',
    );
  });

  it('does not enable login when saving a successful probe fails', async () => {
    const user = userEvent.setup();

    render(<LauncherPage bridge={fakeBridge({ saveFailure: true })} />);
    await user.type(await readyServerInput(), 'https://ai.example.com');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法连接远程服务，请检查网络或服务器状态。',
    );
    expect(
      screen.getByRole('button', { name: '使用统一登录' }),
    ).toBeDisabled();
  });

  it('locks the address while a connection probe is in flight', async () => {
    const user = userEvent.setup();
    let finishProbe: ((value: { authPortalUrl: string }) => void) | undefined;
    const bridge = fakeBridge();
    vi.mocked(bridge.probeServer).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
    );

    render(<LauncherPage bridge={bridge} />);
    const input = await readyServerInput();
    await user.type(input, 'https://ai.example.com');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(input).toBeDisabled();
    finishProbe?.({
      authPortalUrl: 'https://auth.example.com/portal?system=ai-assistant',
    });
    expect(
      await screen.findByText('连接成功，可以使用统一登录。'),
    ).toBeVisible();
  });

  it('locks server interaction until the saved config finishes loading', async () => {
    let finishConfig:
      | ((value: {
          serverOrigin: null;
          lastSuccessfulCheckAt: null;
          currentVersion: string;
        }) => void)
      | undefined;
    const bridge = fakeBridge();
    vi.mocked(bridge.getServerConfig).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishConfig = resolve;
        }),
    );

    render(<LauncherPage bridge={bridge} />);

    expect(screen.getByLabelText('远程服务地址')).toBeDisabled();
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    finishConfig?.({
      serverOrigin: null,
      lastSuccessfulCheckAt: null,
      currentVersion: '1.0.0',
    });
    expect(await screen.findByText((content) => content.includes('版本 1.0.0'))).toBeVisible();
    expect(screen.getByLabelText('远程服务地址')).toBeEnabled();
  });

  it('locks server interaction while unified login is opening', async () => {
    const user = userEvent.setup();
    let finishWorkspace: (() => void) | undefined;
    const bridge = fakeBridge();
    vi.mocked(bridge.openWorkspace).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishWorkspace = resolve;
        }),
    );

    render(<LauncherPage bridge={bridge} />);
    const input = await readyServerInput();
    await user.type(input, 'https://ai.example.com');
    await user.click(screen.getByRole('button', { name: '测试连接' }));
    await user.click(
      await screen.findByRole('button', { name: '使用统一登录' }),
    );

    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    finishWorkspace?.();
  });

  it('restores server controls when the native workspace falls back', async () => {
    const user = userEvent.setup();
    let recover:
      | ((recovery: { readonly reason: ProbeFailureKind }) => void)
      | undefined;
    const bridge = fakeBridge({
      savedOrigin: 'https://ai.example.com',
      lastSuccessfulCheckAt: '2026-06-21T04:00:00Z',
      registerWorkspaceRecovery: (listener) => {
        recover = listener;
      },
    });

    render(<LauncherPage bridge={bridge} />);
    await user.click(
      await screen.findByRole('button', { name: '使用统一登录' }),
    );
    expect(screen.getByLabelText('远程服务地址')).toBeDisabled();

    recover?.({ reason: 'timeout' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '服务器暂未响应，请稍后重试或修改地址。',
    );
    expect(screen.getByLabelText('远程服务地址')).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新测试' })).toBeEnabled();
  });

  it('accepts loopback HTTP in a development launcher build', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge();

    render(<LauncherPage bridge={bridge} />);
    await user.type(await readyServerInput(), 'http://127.0.0.1:18093');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(bridge.probeServer).toHaveBeenCalledWith(
      'http://127.0.0.1:18093',
    );
  });

  it.each([
    ['dns', '无法解析服务器地址，请检查域名或当前网络。'],
    ['tls', '服务器证书不受信任或已过期，请联系管理员处理。'],
    ['timeout', '服务器暂未响应，请稍后重试或修改地址。'],
    ['product', '该地址不是兼容的聚信 AI 助手服务。'],
    ['protocol', '客户端与服务器版本不兼容，请先检查更新。'],
    ['connection', '无法连接远程服务，请检查网络或服务器状态。'],
  ] satisfies readonly (readonly [ProbeFailureKind, string])[])(
    'shows a recoverable %s failure',
    async (kind, message) => {
      const user = userEvent.setup();

      render(<LauncherPage bridge={fakeBridge({ probeFailure: kind })} />);
      await user.type(await readyServerInput(), 'https://ai.example.com');
      await user.click(screen.getByRole('button', { name: '测试连接' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: '重新测试' })).toBeEnabled();
      expect(
        screen.getByRole('button', { name: '使用统一登录' }),
      ).toBeDisabled();
    },
  );

  it('asks before replacing a saved trusted server', async () => {
    const user = userEvent.setup();
    const bridge = fakeBridge({
      savedOrigin: 'https://old.example.com',
      lastSuccessfulCheckAt: '2026-06-21T04:00:00Z',
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<LauncherPage bridge={bridge} />);
    const input = await readyServerInput();
    await user.clear(input);
    await user.type(input, 'https://new.example.com');
    await user.click(screen.getByRole('button', { name: '测试连接' }));

    expect(confirm).toHaveBeenCalledWith(
      '远程服务将从 old.example.com 切换为 new.example.com。新服务器将成为本机数据同步和模型命令的受信任业务来源，是否继续？',
    );
    expect(bridge.saveServerConfig).not.toHaveBeenCalled();
    expect(
      screen.getByText('未更改远程服务地址，你可以继续修改或重新测试。'),
    ).toBeVisible();
  });

  it('renders the launcher in a local Tauri window without fetching a session', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<App bridge={fakeBridge({ localLauncher: true })} />);

    expect(
      await screen.findByRole('heading', { name: '你的私人助理' }),
    ).toBeVisible();
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });
});
