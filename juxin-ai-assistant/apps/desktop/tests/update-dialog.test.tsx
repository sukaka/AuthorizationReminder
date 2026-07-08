import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { UpdateDialog } from '../src/launcher/UpdateDialog';
import type { UpdateStatus } from '../src/remote/desktopBridge';

const UPDATE = {
  version: '1.1.0',
  notes: '优化启动速度\n修复离线恢复体验',
  contentLength: 18_600_000,
} as const;

function renderDialog(
  status: Extract<
    UpdateStatus,
    { readonly kind: 'available' | 'downloading' | 'installing' | 'failed' }
  >,
) {
  const actions = {
    onCancelDownload: vi.fn(),
    onCloseFailure: vi.fn(),
    onInstall: vi.fn(),
    onLater: vi.fn(),
  };

  function Harness() {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)} ref={triggerRef} type="button">
          检查更新
        </button>
        {open ? (
          <UpdateDialog
            actions={{
              ...actions,
              onCloseFailure: () => {
                actions.onCloseFailure();
                setOpen(false);
              },
            }}
            currentVersion="1.0.0"
            returnFocusRef={triggerRef}
            status={status}
          />
        ) : null}
      </>
    );
  }

  return { actions, Harness };
}

describe('update dialog', () => {
  it('offers later and install actions for a newer signed release', async () => {
    const user = userEvent.setup();
    const { actions, Harness } = renderDialog({
      kind: 'available',
      update: UPDATE,
    });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    expect(
      screen.getByRole('dialog', { name: '发现新版本 1.1.0' }),
    ).toBeVisible();
    expect(screen.getByText('优化启动速度')).toBeVisible();
    expect(screen.getByText('17.7 MB')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '稍后提醒' }));
    expect(actions.onLater).toHaveBeenCalledOnce();
    expect(actions.onInstall).not.toHaveBeenCalled();
  });

  it('starts the explicit download action', async () => {
    const user = userEvent.setup();
    const { actions, Harness } = renderDialog({
      kind: 'available',
      update: UPDATE,
    });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));
    await user.click(screen.getByRole('button', { name: '下载并安装' }));

    expect(actions.onInstall).toHaveBeenCalledOnce();
    expect(actions.onLater).not.toHaveBeenCalled();
  });

  it('shows determinate download progress and allows cancellation', async () => {
    const user = userEvent.setup();
    const { actions, Harness } = renderDialog({
      kind: 'downloading',
      received: 9_300_000,
      total: 18_600_000,
      update: UPDATE,
    });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '9300000');
    expect(screen.getByText('50%')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '取消下载' }));
    expect(actions.onCancelDownload).toHaveBeenCalledOnce();
  });

  it('does not expose a cancel or close action while installing', async () => {
    const user = userEvent.setup();
    const { Harness } = renderDialog({ kind: 'installing', update: UPDATE });

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '检查更新' }));

    expect(screen.getByText('正在安装更新…')).toBeVisible();
    expect(screen.queryByRole('button', { name: /取消|关闭/ })).toBeNull();
  });

  it('explains that the current version remains usable and restores focus', async () => {
    const user = userEvent.setup();
    const { actions, Harness } = renderDialog({
      kind: 'failed',
      message: '签名校验失败',
      stage: 'install',
      update: UPDATE,
    });

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: '检查更新' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: '关闭' }));

    expect(actions.onCloseFailure).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
