import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ProbeFailureKind =
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'product'
  | 'protocol'
  | 'connection';

export type ServerConfigSnapshot = {
  readonly serverOrigin: string | null;
  readonly lastSuccessfulCheckAt: string | null;
  readonly currentVersion: string;
};

export type ProbeSuccess = {
  readonly authPortalUrl: string;
};

export type WorkspaceRecovery = {
  readonly reason: ProbeFailureKind | null;
};

export interface DesktopBridge {
  readonly isLocalLauncherContext: () => boolean;
  readonly getServerConfig: () => Promise<ServerConfigSnapshot>;
  readonly probeServer: (origin: string) => Promise<ProbeSuccess>;
  readonly saveServerConfig: (origin: string) => Promise<void>;
  readonly openWorkspace: (origin: string) => Promise<void>;
  readonly onWorkspaceRecovered: (
    listener: (recovery: WorkspaceRecovery) => void,
  ) => Promise<() => void>;
}

export class DesktopProbeError extends Error {
  constructor(public readonly kind: ProbeFailureKind) {
    super(kind);
    this.name = 'DesktopProbeError';
  }
}

function failureKindFromName(name: string): ProbeFailureKind {
  switch (name.toLowerCase()) {
    case 'dns':
      return 'dns';
    case 'tls':
    case 'unsafeauthportal':
      return 'tls';
    case 'timeout':
      return 'timeout';
    case 'product':
    case 'productmismatch':
      return 'product';
    case 'protocol':
    case 'protocolincompatible':
    case 'invalidresponse':
    case 'responsetoolarge':
      return 'protocol';
    case 'connection':
    case 'httpstatus':
    case 'invalidtimeouts':
      return 'connection';
    default:
      return 'connection';
  }
}

export function toProbeFailure(error: unknown): ProbeFailureKind {
  if (error instanceof DesktopProbeError) return error.kind;
  if (error instanceof Error) return failureKindFromName(error.message);
  if (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof error.kind === 'string'
  ) {
    return failureKindFromName(error.kind);
  }
  if (typeof error === 'string') return failureKindFromName(error);
  return 'connection';
}

async function getServerConfig(): Promise<ServerConfigSnapshot> {
  const config = await invoke<{
    readonly serverOrigin?: string;
    readonly lastSuccessfulCheckAt?: string;
  } | null>('server_config_get');
  return {
    serverOrigin: config?.serverOrigin ?? null,
    lastSuccessfulCheckAt: config?.lastSuccessfulCheckAt ?? null,
    currentVersion: await getVersion(),
  };
}

export const desktopBridge: DesktopBridge = {
  isLocalLauncherContext: () => {
    if (
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has('launcher-preview')
    ) {
      return true;
    }
    const internals = window.__TAURI_INTERNALS__;
    if (!internals) return false;
    if (
      typeof internals === 'object' &&
      'metadata' in internals &&
      typeof internals.metadata === 'object' &&
      internals.metadata !== null &&
      'currentWebview' in internals.metadata &&
      typeof internals.metadata.currentWebview === 'object' &&
      internals.metadata.currentWebview !== null &&
      'label' in internals.metadata.currentWebview &&
      typeof internals.metadata.currentWebview.label === 'string'
    ) {
      return internals.metadata.currentWebview.label === 'launcher';
    }
    return (
      window.location.protocol === 'tauri:' ||
      window.location.hostname === 'tauri.localhost'
    );
  },
  getServerConfig,
  probeServer: async (origin) => {
    try {
      return await invoke<ProbeSuccess>('server_probe', { origin });
    } catch (error: unknown) {
      throw new DesktopProbeError(toProbeFailure(error));
    }
  },
  saveServerConfig: async (origin) => {
    await invoke('server_config_save', { origin });
  },
  openWorkspace: async (origin) => {
    await invoke('workspace_open', { origin });
  },
  onWorkspaceRecovered: async (listener) =>
    listen<WorkspaceRecovery>('workspace-recovered', (event) => {
      listener(event.payload);
    }),
};
