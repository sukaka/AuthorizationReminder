import { describe, expect, it } from 'vitest';

import {
  detectRuntimePlatform,
  getRuntimeCapabilities,
  isDesktopRuntime,
  isWebRuntime,
} from '../src/runtime/capabilities';

describe('runtime platform detection', () => {
  it('detects web when Tauri internals are absent', () => {
    expect(detectRuntimePlatform({})).toBe('web');
    expect(isWebRuntime({})).toBe(true);
    expect(isDesktopRuntime({})).toBe(false);
  });

  it('detects desktop when Tauri internals exist', () => {
    const runtime = { __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'workspace' } } } };

    expect(detectRuntimePlatform(runtime)).toBe('desktop');
    expect(isDesktopRuntime(runtime)).toBe(true);
    expect(isWebRuntime(runtime)).toBe(false);
  });

  it('prefers explicit web override over Tauri internals', () => {
    const runtime = {
      __JUXIN_RUNTIME_PLATFORM__: 'web',
      __TAURI_INTERNALS__: { metadata: { currentWebview: { label: 'workspace' } } },
    };

    expect(detectRuntimePlatform(runtime)).toBe('web');
    expect(isWebRuntime(runtime)).toBe(true);
    expect(isDesktopRuntime(runtime)).toBe(false);
  });

  it('disables desktop-only capabilities in web mode', () => {
    expect(getRuntimeCapabilities('web')).toEqual({
      platform: 'web',
      canUseLocalKeychain: false,
      canUseLocalDrafts: false,
      canOpenLocalFile: false,
      canUseAutoUpdater: false,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    });
  });

  it('keeps desktop capabilities in desktop mode', () => {
    expect(getRuntimeCapabilities('desktop')).toEqual({
      platform: 'desktop',
      canUseLocalKeychain: true,
      canUseLocalDrafts: true,
      canOpenLocalFile: true,
      canUseAutoUpdater: true,
      canUseServerWordExport: true,
      canUseUnifiedLogin: true,
    });
  });
});
