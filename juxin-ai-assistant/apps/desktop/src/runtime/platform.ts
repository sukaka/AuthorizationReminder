export type RuntimePlatform = 'desktop' | 'web';

type RuntimeLike = {
  __TAURI_INTERNALS__?: unknown;
  __JUXIN_RUNTIME_PLATFORM__?: unknown;
};

function readExplicitRuntimePlatform(runtime: RuntimeLike): RuntimePlatform | undefined {
  if (runtime.__JUXIN_RUNTIME_PLATFORM__ === 'web' || runtime.__JUXIN_RUNTIME_PLATFORM__ === 'desktop') {
    return runtime.__JUXIN_RUNTIME_PLATFORM__;
  }

  const envRuntimePlatform = import.meta.env.VITE_JUXIN_RUNTIME_PLATFORM;
  if (envRuntimePlatform === 'web' || envRuntimePlatform === 'desktop') {
    return envRuntimePlatform;
  }

  return undefined;
}

export function detectRuntimePlatform(runtime: RuntimeLike = window): RuntimePlatform {
  return readExplicitRuntimePlatform(runtime) ?? (runtime.__TAURI_INTERNALS__ ? 'desktop' : 'web');
}

export function isDesktopRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'desktop';
}

export function isWebRuntime(runtime: RuntimeLike = window): boolean {
  return detectRuntimePlatform(runtime) === 'web';
}
