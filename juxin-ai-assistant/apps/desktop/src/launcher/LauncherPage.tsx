import { useState } from 'react';

import { buildMode, buildChannelLabel } from '../buildMode';
import { desktopBridge, type DesktopBridge } from '../remote/desktopBridge';
import { LocalDataDialog } from './LocalDataDialog';
import { LauncherIntro } from './LauncherIntro';
import { UpdateDialog } from './UpdateDialog';
import { useServerFlow } from './useServerFlow';
import { useUpdateFlow } from './useUpdateFlow';
import './launcher.css';

type LauncherPageProps = {
  readonly bridge?: DesktopBridge;
};

export function LauncherPage({
  bridge = desktopBridge,
}: LauncherPageProps) {
  const update = useUpdateFlow(bridge);
  const server = useServerFlow(bridge, update.setNotice);
  const [showLocalData, setShowLocalData] = useState(false);

  const isInsecureMode =
    buildMode !== 'production' &&
    server.state.kind === 'server-ready' &&
    server.originInput.startsWith('http://');

  const helpProtocol =
    buildMode === 'production'
      ? '正式环境仅接受 HTTPS；本机开发构建可连接 localhost。'
      : buildMode === 'lan-test'
        ? '内网测试版支持私有 IP HTTP 和 HTTPS 地址。'
        : '开发构建可连接 localhost 和私有 IP 地址。';

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
          currentVersion={server.currentVersion}
          returnFocusRef={update.triggerRef}
          status={update.dialogStatus}
        />
      ) : null}
      {showLocalData ? (
        <LocalDataDialog onClose={() => setShowLocalData(false)} />
      ) : null}
      <main className="launcher-shell">
        <LauncherIntro />

      <section className="launcher-console" aria-label="连接与登录">
        <header>
          <div>
            <span className="launcher-eyebrow">开始使用</span>
            <h2>连接企业服务</h2>
          </div>
          <span className="launcher-version">
            Agent {server.currentVersion}{' '}
            {buildMode !== 'production' ? `· ${buildChannelLabel}` : ''}
          </span>
        </header>

        <div className="launcher-form">
          <label htmlFor="server-origin">远程服务地址</label>
          <div className="launcher-origin-row">
            <input
              aria-describedby="server-origin-status server-origin-help"
              autoComplete="url"
              disabled={server.isBusy}
              id="server-origin"
              inputMode="url"
              onChange={(event) => server.updateInput(event.target.value)}
              placeholder={
                buildMode === 'production'
                  ? 'https://ai.example.com'
                  : buildMode === 'lan-test'
                    ? 'http://192.168.20.15:5193'
                    : 'http://localhost:5193'
              }
              spellCheck={false}
              value={server.originInput}
            />
            <button
              className="launcher-secondary"
              disabled={!server.canProbe}
              onClick={() => void server.probe()}
              type="button"
            >
              {server.isChecking
                ? '正在测试…'
                : server.state.kind === 'server-unreachable'
                  ? '重新测试'
                  : '测试连接'}
            </button>
          </div>
          {server.validation.kind === 'invalid' ? (
            <p
              className="launcher-validation"
              id="server-origin-status"
              role="alert"
            >
              {server.validation.message}
            </p>
          ) : (
            <p
              className={`launcher-status is-${server.status.tone}`}
              id="server-origin-status"
              role={server.state.kind === 'server-unreachable' ? 'alert' : 'status'}
            >
              <span aria-hidden="true" />
              {server.status.message}
            </p>
          )}
          <p className="launcher-help" id="server-origin-help">
            {helpProtocol}
          </p>
          {isInsecureMode ? (
            <p className="launcher-insecure-warning" role="alert">
              内网 HTTP 测试模式：通信未加密，仅用于受控局域网。
            </p>
          ) : null}
        </div>

        <div className="launcher-actions">
          <button
            className="launcher-primary"
            disabled={!server.canLogin}
            onClick={() => void server.login()}
            type="button"
          >
            使用统一登录
          </button>
          <button
            className="launcher-secondary"
            onClick={() => setShowLocalData(true)}
            type="button"
          >
            查看本机草稿
          </button>
        </div>

        {update.notice ? (
          <p className="launcher-auxiliary" role="status">
            {update.notice}
          </p>
        ) : null}

        <footer className="launcher-footer">
          <div>
            <strong>应用更新</strong>
            <span>安全更新由聚信受信任发布服务签名提供。</span>
          </div>
          <button
            className="launcher-link"
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
              ? '正在检查…'
              : update.status.kind === 'idle' && !update.status.enabled
                ? '更新未启用'
                : '检查更新'}
          </button>
        </footer>
      </section>
      </main>
    </>
  );
}
