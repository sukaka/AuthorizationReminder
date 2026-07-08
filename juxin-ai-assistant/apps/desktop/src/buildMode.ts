export type BuildMode = 'development' | 'lan-test' | 'production';

export type OriginValidation =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'valid'; readonly origin: string };

export function parseBuildMode(raw: unknown): BuildMode {
  return raw === 'development' || raw === 'lan-test' || raw === 'production'
    ? raw
    : 'production';
}

export const buildMode = parseBuildMode(
  import.meta.env.VITE_AI_ASSISTANT_BUILD_MODE ??
    (import.meta.env.DEV ? 'development' : 'production'),
);

export function buildChannelLabelFor(mode: BuildMode): string {
  if (mode === 'lan-test') return '内网测试版';
  if (mode === 'development') return '开发版';
  return '正式版';
}

export const buildChannelLabel = buildChannelLabelFor(buildMode);

function parseStrictIpv4(hostname: string): readonly number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) =>
    /^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : Number.NaN,
  );
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  )
    ? octets
    : null;
}

function isPrivateHttpHost(hostname: string): boolean {
  if (hostname.toLowerCase() === 'localhost' || hostname === '[::1]') {
    return true;
  }
  const octets = parseStrictIpv4(hostname);
  if (!octets) return false;
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function validateServerOrigin(
  raw: string,
  mode: BuildMode = buildMode,
): OriginValidation {
  const value = raw.trim();
  if (!value) return { kind: 'empty' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidOrigin();
  }

  const isTrustedScheme =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      mode !== 'production' &&
      isCanonicalPrivateHttpHost(value, url.hostname));
  const isExactOrigin =
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !value.includes('*') &&
    !rawAuthorityHasUserinfo(value) &&
    rawOriginPathIsEmpty(value);

  return isTrustedScheme && isExactOrigin
    ? { kind: 'valid', origin: url.origin }
    : invalidOrigin();
}

function isCanonicalPrivateHttpHost(
  raw: string,
  normalizedHostname: string,
): boolean {
  const hostname = rawAuthorityHostname(raw);
  if (
    hostname.toLowerCase() === 'localhost' ||
    hostname.toLowerCase() === '[::1]'
  ) {
    return true;
  }
  return hostname === normalizedHostname && isPrivateHttpHost(hostname);
}

function rawAuthorityHostname(raw: string): string {
  const authority = (raw.split('://', 2)[1] ?? '').split(/[/?#]/, 1)[0] ?? '';
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    return closingBracket === -1
      ? authority
      : authority.slice(0, closingBracket + 1);
  }
  const portSeparator = authority.lastIndexOf(':');
  return portSeparator === -1
    ? authority
    : authority.slice(0, portSeparator);
}

function invalidOrigin(): OriginValidation {
  return {
    kind: 'invalid',
    message: '请输入不含路径、参数或账号信息的 HTTPS 地址。',
  };
}

function rawAuthorityHasUserinfo(raw: string): boolean {
  const remainder = raw.split('://', 2)[1] ?? '';
  return (remainder.split(/[/?#]/, 1)[0] ?? '').includes('@');
}

function rawOriginPathIsEmpty(raw: string): boolean {
  const remainder = raw.split('://', 2)[1] ?? '';
  const componentIndex = remainder.search(/[/?#]/);
  return componentIndex === -1 || remainder.slice(componentIndex) === '/';
}
