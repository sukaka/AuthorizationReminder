import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../src/App';
import { LauncherPage } from '../src/launcher/LauncherPage';
import type {
  DesktopBridge,
  ProbeFailureKind,
} from '../src/remote/desktopBridge';

type FakeBridgeOptions = {
  readonly localLauncher?: boolean;
  readonly savedOrigin?: string | null;
  readonly lastSuccessfulCheckAt?: string | null;
  readonly probeFailure?: ProbeFailureKind;
  readonly saveFailure?: boolean;
};

function fakeBridge(options: FakeBridgeOptions = {}): DesktopBridge {
  return {
    isLocalLauncherContext: () => options.localLauncher ?? true,
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
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function readyServerInput(): Promise<HTMLInputElement> {
  const input =
    screen.getByLabelText<HTMLInputElement>('远程服务地址');
  await waitFor(() => expect(input).toBeEnabled());
  return input;
}

describe('local launcher', () => {
  it('shows product introduction before any business network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<LauncherPage bridge={fakeBridge()} />);

    expect(
      screen.getByRole('heading', { name: '让日常工作更高效' }),
    ).toBeVisible();
    expect(screen.getByText('八类助手，88 项常用任务')).toBeVisible();
    expect(screen.getByText('统一 SSO 安全登录')).toBeVisible();
    expect(screen.getByText('模型密钥保存在系统钥匙串')).toBeVisible();
    expect(screen.getByText('草稿与待同步内容保留在本机')).toBeVisible();
    expect(screen.getByLabelText('远程服务地址')).toBeVisible();
    expect(
      screen.getByRole('button', { name: '使用统一登录' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看本机草稿' })).toBeEnabled();
    expect(await screen.findByText('当前版本 1.0.0')).toBeVisible();
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

  it('explains protected local drafts and development update availability', async () => {
    const user = userEvent.setup();

    render(<LauncherPage bridge={fakeBridge()} />);
    await user.click(screen.getByRole('button', { name: '查看本机草稿' }));
    expect(
      screen.getByText(
        '本机草稿将在统一登录确认身份后开放，避免不同用户查看彼此内容。',
      ),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '检查更新' }));
    expect(
      screen.getByText(
        '自动更新将在正式发布构建启用；当前开发构建不会连接更新服务。',
      ),
    ).toBeVisible();
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
    expect(await screen.findByText('当前版本 1.0.0')).toBeVisible();
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
      await screen.findByRole('heading', { name: '让日常工作更高效' }),
    ).toBeVisible();
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });
});
