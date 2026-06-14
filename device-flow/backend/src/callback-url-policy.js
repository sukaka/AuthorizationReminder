const dns = require('node:dns');
const net = require('node:net');

const METADATA_HOSTS = new Set([
  '169.254.169.254',
  'metadata',
  'metadata.google',
  'metadata.google.internal',
  'metadata.azure.internal',
  'instance-data',
]);

const normalizeHostname = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

const parseAllowedHosts = (rawValue) =>
  new Set(
    String(rawValue || '')
      .split(',')
      .map(normalizeHostname)
      .filter(Boolean)
  );

const parseIpv4 = (address) => {
  const parts = String(address || '').split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((item) => Number(item));
  if (octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
  return octets;
};

const isBlockedIpv4 = (address) => {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return a >= 224;
};

const expandIpv6 = (rawAddress) => {
  let address = normalizeHostname(rawAddress).split('%')[0];
  if (!address) return null;

  const ipv4Match = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const octets = parseIpv4(ipv4Match[2]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = `${ipv4Match[1]}${high}:${low}`;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8) return null;
  const values = parts.map((part) => Number.parseInt(part || '0', 16));
  if (values.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return null;
  return values;
};

const isBlockedIpv6 = (address) => {
  const parts = expandIpv6(address);
  if (!parts) return true;
  const allZero = parts.every((part) => part === 0);
  if (allZero) return true;
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) return true;

  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    const mappedIpv4 = `${parts[6] >> 8}.${parts[6] & 0xff}.${parts[7] >> 8}.${parts[7] & 0xff}`;
    return isBlockedIpv4(mappedIpv4);
  }

  if ((parts[0] & 0xfe00) === 0xfc00) return true;
  if ((parts[0] & 0xffc0) === 0xfe80) return true;
  if ((parts[0] & 0xff00) === 0xff00) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true;
  return false;
};

const isBlockedIpAddress = (rawAddress) => {
  const address = normalizeHostname(rawAddress).split('%')[0];
  const family = net.isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
};

const defaultLookup = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

const assertSafeCallbackUrl = async (
  rawUrl,
  {
    allowedHosts = new Set(),
    lookup = defaultLookup,
  } = {}
) => {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error('callback_url 不能为空');

  let parsed;
  try {
    parsed = new URL(value);
  } catch (_err) {
    throw new Error('callback_url 非法');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('callback_url 仅支持 http/https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('callback_url 不能包含用户名或密码');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) throw new Error('callback_url 缺少主机名');
  if (METADATA_HOSTS.has(hostname)) throw new Error('callback_url 禁止访问的地址');
  if (allowedHosts.has(hostname)) return parsed;

  const family = net.isIP(hostname);
  let addresses;
  try {
    addresses = family
      ? [{ address: hostname, family }]
      : await lookup(hostname);
  } catch (_err) {
    throw new Error('callback_url 主机无法解析');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('callback_url 主机无法解析');
  }
  if (addresses.some((item) => isBlockedIpAddress(item?.address))) {
    throw new Error('callback_url 禁止访问的地址');
  }

  return parsed;
};

module.exports = {
  assertSafeCallbackUrl,
  isBlockedIpAddress,
  parseAllowedHosts,
};
