import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import type { DesktopBridge } from '../remote/desktopBridge';
import { toProbeFailure } from '../remote/desktopBridge';
import { buildMode } from '../buildMode';
import {
  launcherStatusContent,
  type LauncherState,
  validateServerOrigin,
} from './launcherState';

function hostLabel(origin: string): string {
  return new URL(origin).host;
}

export function useServerFlow(
  bridge: DesktopBridge,
  setNotice: Dispatch<SetStateAction<string>>,
) {
  const [state, setState] = useState<LauncherState>({ kind: 'booting' });
  const [originInput, setOriginInput] = useState('');
  const [savedOrigin, setSavedOrigin] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState('—');

  useEffect(() => {
    let active = true;
    bridge
      .getServerConfig()
      .then((config) => {
        if (!active) return;
        const origin = config.serverOrigin ?? '';
        const trustedOrigin = config.lastSuccessfulCheckAt
          ? config.serverOrigin
          : null;
        setOriginInput(origin);
        setSavedOrigin(trustedOrigin);
        setCurrentVersion(config.currentVersion);
        if (config.configurationWarning) {
          setNotice(config.configurationWarning);
        }
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
            ? { kind: 'server-unreachable', origin, reason: recovery.reason }
            : { kind: 'server-ready', origin };
        });
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => {
        if (active) setNotice('工作台恢复通知暂不可用，可重新测试连接。');
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [bridge, savedOrigin, setNotice]);

  const validation = useMemo(
    () => validateServerOrigin(originInput, buildMode),
    [originInput],
  );
  const busy =
    state.kind === 'booting' ||
    state.kind === 'checking' ||
    state.kind === 'authenticating';

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
      setState({ kind: 'server-unreachable', origin, reason: 'connection' });
    }
  };

  return {
    canLogin: state.kind === 'server-ready',
    canProbe: validation.kind === 'valid' && !busy,
    currentVersion,
    isBusy: busy,
    isChecking: state.kind === 'checking',
    login,
    originInput,
    probe,
    state,
    status: launcherStatusContent(state),
    updateInput,
    validation,
  };
}
