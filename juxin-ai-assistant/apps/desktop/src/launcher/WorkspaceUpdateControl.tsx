import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';

import { desktopBridge, type DesktopBridge } from '../remote/desktopBridge';
import { getRuntimeCapabilities } from '../runtime/capabilities';
import { UpdateDialog } from './UpdateDialog';
import { useUpdateFlow } from './useUpdateFlow';

type WorkspaceUpdateControlProps = {
  readonly bridge?: DesktopBridge;
  readonly currentVersion?: string;
};

export function WorkspaceUpdateControl({
  bridge = desktopBridge,
  currentVersion,
}: WorkspaceUpdateControlProps) {
  if (!getRuntimeCapabilities().canUseAutoUpdater) return null;

  const update = useUpdateFlow(bridge);
  const [version, setVersion] = useState(currentVersion ?? '—');

  useEffect(() => {
    if (currentVersion) return;
    let active = true;
    void getVersion().then((next) => {
      if (active) setVersion(next);
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentVersion]);

  return (
    <>
      {update.dialogStatus ? (
        <UpdateDialog
          actions={{
            onCancelDownload: () => void update.cancel(),
            onCloseFailure: update.closeFailure,
            onInstall: () => void update.install(),
            onLater: () => void update.defer(),
          }}
          currentVersion={version}
          returnFocusRef={update.triggerRef}
          status={update.dialogStatus}
        />
      ) : null}
      <div className="workspace-update-control">
        <button
          disabled={
            update.status.kind === 'checking' ||
            update.status.kind === 'downloading' ||
            update.status.kind === 'installing' ||
            (update.status.kind === 'idle' && !update.status.enabled)
          }
          onClick={() => void update.check()}
          ref={update.triggerRef}
          type="button"
        >
          {update.status.kind === 'checking'
            ? '正在检查更新…'
            : update.status.kind === 'idle' && !update.status.enabled
              ? '应用更新未启用'
              : '检查应用更新'}
        </button>
        {update.notice ? <small role="status">{update.notice}</small> : null}
      </div>
    </>
  );
}
