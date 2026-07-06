export type RuntimePlatform = 'desktop' | 'web';

type RuntimeLike = {
  __TAURI_INTERNALS__?: unknown;
};

export function detectRuntimePlatform(runtime: RuntimeLike = window): RuntimePlatform {
  return runtime.__TAURI_INTERNALS__ ? 'desktop' : 'web';
}

export function isDesktopRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'desktop';
}

export function isWebRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'web';
}
