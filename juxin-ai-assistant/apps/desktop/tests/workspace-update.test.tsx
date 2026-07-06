import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { WorkspaceUpdateControl } from '../src/launcher/WorkspaceUpdateControl';
import type { DesktopBridge } from '../src/remote/desktopBridge';

function updateBridge(): DesktopBridge {
  return {
    isLocalLauncherContext: () => false,
    closeWorkspace: vi.fn().mockResolvedValue(undefined),
    bindLocalSession: vi.fn().mockResolvedValue(undefined),
    markWorkspaceReady: vi.fn().mockResolvedValue(undefined),
    reportWorkspaceStatus: vi.fn().mockResolvedValue(undefined),
    getServerConfig: vi.fn(),
    probeServer: vi.fn(),
    saveServerConfig: vi.fn(),
    openWorkspace: vi.fn(),
    onWorkspaceRecovered: vi.fn().mockResolvedValue(() => undefined),
    getUpdateStatus: vi.fn().mockResolvedValue({ kind: 'idle', enabled: true }),
    checkForUpdates: vi.fn().mockResolvedValue({ kind: 'idle', enabled: true }),
    downloadAndInstallUpdate: vi.fn(),
    cancelUpdate: vi.fn(),
    deferUpdate: vi.fn(),
    onUpdateStatusChanged: vi.fn().mockResolvedValue(() => undefined),
  };
}

it('checks for signed updates from the workspace settings control', async () => {
  window.__JUXIN_RUNTIME_PLATFORM__ = 'desktop';
  const bridge = updateBridge();
  const user = userEvent.setup();

  render(<WorkspaceUpdateControl bridge={bridge} currentVersion="5.89.0" />);
  const check = await screen.findByRole('button', { name: '检查应用更新' });
  await user.click(check);

  expect(bridge.checkForUpdates).toHaveBeenCalledOnce();
  expect(await screen.findByText('当前已是最新版本。')).toBeVisible();
});
