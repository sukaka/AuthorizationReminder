import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  assertNever,
  probeFailureMessage,
  type LauncherState,
  validateServerOrigin,
} from './launcherState';
import {
  desktopBridge,
  toProbeFailure,
  type DesktopBridge,
} from '../remote/desktopBridge';
import './launcher.css';

type LauncherPageProps = {
  readonly bridge?: DesktopBridge;
};

const VALUE_POINTS: readonly {
  readonly title: string;
  readonly detail: ReactNode;
}[] = [
  {
    title: '八类助手，88 项常用任务',
    detail: (
      <>
        描述你要完成的工作，助手会
        <span className="launcher-nowrap">自动采用已发布</span>
        的专业提示词。
      </>
    ),
  },
  {
    title: '统一 SSO 安全登录',
    detail: (
      <>
        登录由
        <span className="launcher-nowrap">企业统一身份系统完成</span>
        ，桌面端不保存账号密码。
      </>
    ),
  },
  {
    title: '模型密钥保存在系统钥匙串',
    detail: (
      <>
        个人模型配置
        <span className="launcher-nowrap">留在设备上</span>
        ，
        <span className="launcher-nowrap">业务服务</span>
        不托管你的模型密钥。
      </>
    ),
  },
  {
    title: '草稿与待同步内容保留在本机',
    detail: (
      <>
        网络不可用时仍可
        <span className="launcher-nowrap">进入本地入口</span>
        ，待恢复后再安全同步。
      </>
    ),
  },
];

function hostLabel(origin: string): string {
  return new URL(origin).host;
}

function statusContent(state: LauncherState) {
  switch (state.kind) {
    case 'booting':
      return { tone: 'neutral', message: '正在读取本机设置…' };
    case 'needs-server':
      return {
        tone: state.notice ? 'neutral' : 'muted',
        message: state.notice ?? '请先填写远程服务地址并测试连接。',
      };
    case 'checking':
      return { tone: 'neutral', message: '正在验证服务和登录能力…' };
    case 'server-ready':
      return { tone: 'success', message: '连接成功，可以使用统一登录。' };
    case 'server-unreachable':
      return {
        tone: 'danger',
        message: probeFailureMessage(state.reason),
      };
    case 'authenticating':
      return { tone: 'neutral', message: '正在打开统一登录…' };
    case 'workspace-ready':
      return { tone: 'success', message: '工作台已就绪。' };
    case 'update-available':
      return {
        tone: 'neutral',
        message: `发现新版本 ${state.version}，可选择下载并安装。`,
      };
    case 'updating':
      return {
        tone: 'neutral',
        message: `正在更新，已完成 ${state.progress}%`,
      };
    case 'update-failed':
      return { tone: 'danger', message: state.message };
    default:
      return assertNever(state);
  }
}

export function LauncherPage({
  bridge = desktopBridge,
}: LauncherPageProps) {
  const [state, setState] = useState<LauncherState>({ kind: 'booting' });
  const [originInput, setOriginInput] = useState('');
  const [savedOrigin, setSavedOrigin] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState('—');
  const [auxiliaryNotice, setAuxiliaryNotice] = useState('');

  useEffect(() => {
    let active = true;
    bridge
      .getServerConfig()
      .then((config) => {
        if (!active) return;
        const origin = config.serverOrigin ?? '';
        setOriginInput(origin);
        setSavedOrigin(config.serverOrigin);
        setCurrentVersion(config.currentVersion);
        setState(
          config.serverOrigin && config.lastSuccessfulCheckAt
            ? { kind: 'server-ready', origin: config.serverOrigin }
            : { kind: 'needs-server', origin },
        );
      })
      .catch(() => {
        if (!active) return;
        setState({
          kind: 'needs-server',
          origin: '',
          notice: '暂时无法读取本机设置。请填写地址并重新测试。',
        });
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    bridge
      .onWorkspaceRecovered((recovery) => {
        if (!active) return;
        setState((current) => {
          const origin =
            current.kind === 'booting' ? savedOrigin ?? '' : current.origin;
          return recovery.reason
            ? {
                kind: 'server-unreachable',
                origin,
                reason: recovery.reason,
              }
            : { kind: 'server-ready', origin };
        });
      })
      .then((stop) => {
        if (active) {
          unlisten = stop;
        } else {
          stop();
        }
      })
      .catch(() => {
        if (active) {
          setAuxiliaryNotice('工作台恢复通知暂不可用，可重新测试连接。');
        }
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [bridge, savedOrigin]);

  const validation = useMemo(
    () => validateServerOrigin(originInput, import.meta.env.DEV),
    [originInput],
  );
  const status = statusContent(state);
  const canLogin = state.kind === 'server-ready';
  const isBusy =
    state.kind === 'booting' ||
    state.kind === 'checking' ||
    state.kind === 'authenticating' ||
    state.kind === 'updating';
  const isChecking = state.kind === 'checking';
  const canProbe = validation.kind === 'valid' && !isBusy;

  const updateInput = (value: string) => {
    setOriginInput(value);
    setState({ kind: 'needs-server', origin: value });
  };

  const probe = async () => {
    if (validation.kind !== 'valid') return;
    const origin = validation.origin;
    if (
      savedOrigin &&
      savedOrigin !== origin &&
      !window.confirm(
        `远程服务将从 ${hostLabel(savedOrigin)} 切换为 ${hostLabel(origin)}。新服务器将成为本机数据同步和模型命令的受信任业务来源，是否继续？`,
      )
    ) {
      setState({
        kind: 'needs-server',
        origin: originInput,
        notice: '未更改远程服务地址，你可以继续修改或重新测试。',
      });
      return;
    }

    setState({ kind: 'checking', origin });
    try {
      await bridge.probeServer(origin);
      await bridge.saveServerConfig(origin);
      setOriginInput(origin);
      setSavedOrigin(origin);
      setState({ kind: 'server-ready', origin });
    } catch (error: unknown) {
      setState({
        kind: 'server-unreachable',
        origin,
        reason: toProbeFailure(error),
      });
    }
  };

  const login = async () => {
    if (state.kind !== 'server-ready') return;
    const origin = state.origin;
    setState({ kind: 'authenticating', origin });
    try {
      await bridge.openWorkspace(origin);
    } catch {
      setState({
        kind: 'server-unreachable',
        origin,
        reason: 'connection',
      });
    }
  };

  return (
    <main className="launcher-shell">
      <section className="launcher-intro" aria-labelledby="launcher-title">
        <div className="launcher-brand">
          <span aria-hidden="true">聚</span>
          <div>
            <strong>聚信 AI 助手</strong>
            <small>企业智能工作台</small>
          </div>
        </div>
        <div className="launcher-copy">
          <span className="launcher-eyebrow">无需自己编写提示词</span>
          <h1 id="launcher-title">让日常工作更高效</h1>
          <p>
            告诉智能体你要做什么，
            <span className="launcher-nowrap">聚信 AI 助手</span>
            会从经过治理的任务中匹配流程，帮你生成、整理和复核工作成果。
          </p>
        </div>
        <div className="launcher-values">
          {VALUE_POINTS.map((point, index) => (
            <article key={point.title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h2>{point.title}</h2>
                <p>{point.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="launcher-console" aria-label="连接与登录">
        <header>
          <div>
            <span className="launcher-eyebrow">开始使用</span>
            <h2>连接企业服务</h2>
          </div>
          <span className="launcher-version">当前版本 {currentVersion}</span>
        </header>

        <div className="launcher-form">
          <label htmlFor="server-origin">远程服务地址</label>
          <div className="launcher-origin-row">
            <input
              aria-describedby="server-origin-status server-origin-help"
              autoComplete="url"
              disabled={isBusy}
              id="server-origin"
              inputMode="url"
              onChange={(event) => updateInput(event.target.value)}
              placeholder="https://ai.example.com"
              spellCheck={false}
              value={originInput}
            />
            <button
              className="launcher-secondary"
              disabled={!canProbe}
              onClick={() => void probe()}
              type="button"
            >
              {isChecking
                ? '正在测试…'
                : state.kind === 'server-unreachable'
                  ? '重新测试'
                  : '测试连接'}
            </button>
          </div>
          {validation.kind === 'invalid' ? (
            <p
              className="launcher-validation"
              id="server-origin-status"
              role="alert"
            >
              {validation.message}
            </p>
          ) : (
            <p
              className={`launcher-status is-${status.tone}`}
              id="server-origin-status"
              role={state.kind === 'server-unreachable' ? 'alert' : 'status'}
            >
              <span aria-hidden="true" />
              {status.message}
            </p>
          )}
          <p className="launcher-help" id="server-origin-help">
            正式环境仅接受 HTTPS；本机开发构建可连接 localhost。
          </p>
        </div>

        <div className="launcher-actions">
          <button
            className="launcher-primary"
            disabled={!canLogin}
            onClick={() => void login()}
            type="button"
          >
            使用统一登录
          </button>
          <button
            className="launcher-secondary"
            onClick={() =>
              setAuxiliaryNotice(
                '本机草稿将在统一登录确认身份后开放，避免不同用户查看彼此内容。',
              )
            }
            type="button"
          >
            查看本机草稿
          </button>
        </div>

        {auxiliaryNotice ? (
          <p className="launcher-auxiliary" role="status">
            {auxiliaryNotice}
          </p>
        ) : null}

        <footer className="launcher-footer">
          <div>
            <strong>应用更新</strong>
            <span>安全更新由聚信受信任发布服务签名提供。</span>
          </div>
          <button
            className="launcher-link"
            onClick={() =>
              setAuxiliaryNotice(
                '自动更新将在正式发布构建启用；当前开发构建不会连接更新服务。',
              )
            }
            type="button"
          >
            检查更新
          </button>
        </footer>
      </section>
    </main>
  );
}
