import {
  detectRuntimePlatform,
  isDesktopRuntime,
  isWebRuntime,
  type RuntimePlatform,
} from './platform';

export type RuntimeCapabilities = {
  platform: RuntimePlatform;
  canUseLocalKeychain: boolean;
  canUseLocalDrafts: boolean;
  canOpenLocalFile: boolean;
  canUseAutoUpdater: boolean;
  canUseServerWordExport: boolean;
  canUseUnifiedLogin: boolean;
};

export { detectRuntimePlatform, isDesktopRuntime, isWebRuntime };

export function getRuntimeCapabilities(platform = detectRuntimePlatform()): RuntimeCapabilities {
  if (platform === 'desktop') {
    return {
      platform,
      canUseLocalKeychain: true,
      canUseLocalDrafts: true,
      canOpenLocalFile: true,
      canUseAutoUpdater: true,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    };
  }

  return {
    platform,
    canUseLocalKeychain: false,
    canUseLocalDrafts: false,
    canOpenLocalFile: false,
    canUseAutoUpdater: false,
    canUseServerWordExport: true,
    canUseUnifiedLogin: true,
  };
}
