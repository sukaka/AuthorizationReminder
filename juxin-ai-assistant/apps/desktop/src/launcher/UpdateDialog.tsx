import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { UpdateStatus } from '../remote/desktopBridge';

type DialogStatus = Extract<
  UpdateStatus,
  { readonly kind: 'available' | 'downloading' | 'installing' | 'failed' }
>;

type UpdateDialogActions = {
  readonly onLater: () => void;
  readonly onInstall: () => void;
  readonly onCancelDownload: () => void;
  readonly onCloseFailure: () => void;
};

type UpdateDialogProps = {
  readonly status: DialogStatus;
  readonly currentVersion: string;
  readonly actions: UpdateDialogActions;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
};

function formatBytes(value: number | null): string {
  if (value === null) return '大小将在下载时确认';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function updateFromStatus(status: DialogStatus) {
  return status.update;
}

export function UpdateDialog({
  status,
  currentVersion,
  actions,
  returnFocusRef,
}: UpdateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialScrollLeftRef = useRef(window.scrollX);
  const initialScrollTopRef = useRef(window.scrollY);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const update = updateFromStatus(status);

  useEffect(() => {
    const dialog = dialogRef.current;
    const scrollLeft = initialScrollLeftRef.current;
    const scrollTop = initialScrollTopRef.current;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollTop}px`;
    document.body.style.width = '100%';
    if (dialog && typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog?.setAttribute('open', '');
    }
    titleRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      if (window.scrollX !== scrollLeft || window.scrollY !== scrollTop) {
        window.scrollTo(scrollLeft, scrollTop);
      }
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  const title = update
    ? `发现新版本 ${update.version}`
    : '更新未完成';
  const progress =
    status.kind === 'downloading' && status.total
      ? Math.min(100, Math.round((status.received / status.total) * 100))
      : null;

  return (
    <dialog
      aria-describedby="update-dialog-description"
      aria-labelledby="update-dialog-title"
      aria-modal="true"
      className="update-dialog"
      onCancel={(event) => event.preventDefault()}
      ref={dialogRef}
    >
      <div className="update-dialog-heading">
        <span className="launcher-eyebrow">签名安全更新</span>
        <h2 id="update-dialog-title" ref={titleRef} tabIndex={-1}>
          {title}
        </h2>
        <p id="update-dialog-description">
          当前版本 {currentVersion}。更新包由聚信受信任发布服务签名验证。
        </p>
      </div>

      {update ? (
        <div className="update-dialog-release">
          <div>
            <strong>版本说明</strong>
            <p>
              {update.notes.split(/\r?\n/).map((line, index) => (
                <span key={`${index}-${line}`}>{line}</span>
              ))}
            </p>
          </div>
          <span>{formatBytes(update.contentLength)}</span>
        </div>
      ) : null}

      {status.kind === 'downloading' ? (
        <div className="update-dialog-progress" role="status">
          <div>
            <strong>正在下载更新…</strong>
            <span>{progress === null ? formatBytes(status.received) : `${progress}%`}</span>
          </div>
          <progress
            max={status.total ?? undefined}
            value={status.total ? status.received : undefined}
          />
        </div>
      ) : null}

      {status.kind === 'installing' ? (
        <div className="update-dialog-installing" role="status">
          <strong>正在安装更新…</strong>
          <span>安装完成后应用将自动重启，请不要关闭应用。</span>
        </div>
      ) : null}

      {status.kind === 'failed' ? (
        <div className="update-dialog-failure" role="alert">
          <strong>{status.message}</strong>
          <span>当前版本仍可继续使用，你可以稍后重新检查更新。</span>
        </div>
      ) : null}

      <div className="update-dialog-actions">
        {status.kind === 'available' ? (
          <>
            <button
              className="launcher-secondary"
              onClick={actions.onLater}
              type="button"
            >
              稍后提醒
            </button>
            <button
              className="launcher-primary"
              onClick={actions.onInstall}
              type="button"
            >
              下载并安装
            </button>
          </>
        ) : null}
        {status.kind === 'downloading' ? (
          <button
            className="launcher-secondary"
            onClick={actions.onCancelDownload}
            type="button"
          >
            取消下载
          </button>
        ) : null}
        {status.kind === 'failed' ? (
          <button
            className="launcher-primary"
            onClick={actions.onCloseFailure}
            type="button"
          >
            关闭
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
