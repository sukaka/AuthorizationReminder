import { useEffect, useRef, useState } from 'react';

import type { DesktopBridge, UpdateStatus } from '../remote/desktopBridge';

type DialogStatus = Extract<
  UpdateStatus,
  { readonly kind: 'available' | 'downloading' | 'installing' | 'failed' }
>;

function updateFromStatus(status: UpdateStatus) {
  if (
    status.kind === 'available' ||
    status.kind === 'downloading' ||
    status.kind === 'installing' ||
    status.kind === 'failed'
  ) {
    return status.update;
  }
  return null;
}

function opensDialog(status: UpdateStatus): status is DialogStatus {
  return status.kind !== 'idle' && status.kind !== 'checking';
}

export function useUpdateFlow(bridge: DesktopBridge) {
  const [status, setStatus] = useState<UpdateStatus>({
    kind: 'idle',
    enabled: false,
  });
  const [notice, setNotice] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const stop = await bridge.onUpdateStatusChanged((next) => {
          if (!active) return;
          setStatus(next);
          if (next.kind === 'failed' && next.stage === 'check') {
            setNotice('暂时无法检查更新，当前版本仍可继续使用。');
          }
        });
        if (!active) {
          stop();
          return;
        }
        unlisten = stop;
        setStatus(await bridge.getUpdateStatus());
      } catch {
        if (active) {
          setNotice('暂时无法读取更新状态，当前版本仍可继续使用。');
        }
      }
    })();
    return () => {
      active = false;
      unlisten?.();
    };
  }, [bridge]);

  const check = async () => {
    setNotice('');
    setStatus({ kind: 'checking' });
    try {
      const next = await bridge.checkForUpdates();
      setStatus(next);
      if (next.kind === 'idle') {
        setNotice(
          next.enabled
            ? '当前已是最新版本。'
            : '当前构建未启用自动更新。',
        );
      }
    } catch {
      setStatus({ kind: 'idle', enabled: true });
      setNotice('暂时无法检查更新，当前版本仍可继续使用。');
    }
  };

  const defer = async () => {
    const update = updateFromStatus(status);
    try {
      await bridge.deferUpdate();
      setStatus({ kind: 'idle', enabled: true });
      setNotice('已稍后提醒，24 小时内不会再次自动弹出此版本。');
    } catch {
      setStatus({
        kind: 'failed',
        stage: 'defer',
        update,
        message: '暂时无法保存提醒时间，请稍后重试。',
      });
    }
  };

  const install = async () => {
    const update = updateFromStatus(status);
    try {
      await bridge.downloadAndInstallUpdate();
    } catch {
      setStatus({
        kind: 'failed',
        stage: 'download',
        update,
        message: '暂时无法开始下载更新，请稍后重试。',
      });
    }
  };

  const cancel = async () => {
    const update = updateFromStatus(status);
    try {
      await bridge.cancelUpdate();
    } catch {
      setStatus({
        kind: 'failed',
        stage: 'download',
        update,
        message: '更新已进入安装阶段，不能再取消。',
      });
    }
  };

  const dialogStatus =
    opensDialog(status) && !(status.kind === 'failed' && status.stage === 'check')
      ? status
      : null;

  return {
    cancel,
    check,
    closeFailure: () => setStatus({ kind: 'idle', enabled: true }),
    defer,
    dialogStatus,
    install,
    notice,
    setNotice,
    status,
    triggerRef,
  };
}
