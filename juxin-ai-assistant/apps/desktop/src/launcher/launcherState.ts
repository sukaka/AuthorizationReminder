import type { ProbeFailureKind } from '../remote/desktopBridge';

export type LauncherState =
  | { readonly kind: 'booting' }
  | {
      readonly kind: 'needs-server';
      readonly origin: string;
      readonly notice?: string;
    }
  | { readonly kind: 'checking'; readonly origin: string }
  | { readonly kind: 'server-ready'; readonly origin: string }
  | {
      readonly kind: 'server-unreachable';
      readonly origin: string;
      readonly reason: ProbeFailureKind;
    }
  | { readonly kind: 'authenticating'; readonly origin: string }
  | { readonly kind: 'workspace-ready'; readonly origin: string }
  | {
      readonly kind: 'update-available';
      readonly origin: string;
      readonly version: string;
    }
  | {
      readonly kind: 'updating';
      readonly origin: string;
      readonly progress: number;
    }
  | {
      readonly kind: 'update-failed';
      readonly origin: string;
      readonly message: string;
    };

export type OriginValidation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'valid'; readonly origin: string };

export function validateServerOrigin(
  raw: string,
  allowLoopbackHttp: boolean,
): OriginValidation {
  const value = raw.trim();
  if (!value) return { kind: 'empty' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      kind: 'invalid',
      message: '请输入不含路径、参数或账号信息的 HTTPS 地址。',
    };
  }

  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  const isTrustedScheme =
    url.protocol === 'https:' ||
    (allowLoopbackHttp && url.protocol === 'http:' && isLoopback);
  const isExactOrigin =
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !value.includes('*');

  if (!isTrustedScheme || !isExactOrigin) {
    return {
      kind: 'invalid',
      message: '请输入不含路径、参数或账号信息的 HTTPS 地址。',
    };
  }
  return { kind: 'valid', origin: url.origin };
}

export function probeFailureMessage(kind: ProbeFailureKind): string {
  switch (kind) {
    case 'dns':
      return '无法解析服务器地址，请检查域名或当前网络。';
    case 'tls':
      return '服务器证书不受信任或已过期，请联系管理员处理。';
    case 'timeout':
      return '服务器暂未响应，请稍后重试或修改地址。';
    case 'product':
      return '该地址不是兼容的聚信 AI 助手服务。';
    case 'protocol':
      return '客户端与服务器版本不兼容，请先检查更新。';
    case 'connection':
      return '无法连接远程服务，请检查网络或服务器状态。';
    default:
      return assertNever(kind);
  }
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected launcher state: ${String(value)}`);
}
