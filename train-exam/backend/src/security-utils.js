const net = require('net');

const elevatedRoles = new Set(['admin', 'editor', 'reviewer', 'auditor']);

const normalizeRole = (value) => String(value || '').trim().toLowerCase();
const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

const canReadCourse = ({ role, courseStatus }) => {
  if (elevatedRoles.has(normalizeRole(role))) return true;
  return normalizeStatus(courseStatus) === 'published';
};

const isDocPreviewHostAllowed = ({ requestHost, tokenHost, forwardedHost, forwardedFor, realIp, forwarded, forwardedProto, forwardedPort }) => {
  const proxySignals = [forwardedHost, forwardedFor, realIp, forwarded, forwardedProto, forwardedPort]
    .some((value) => String(value || '').trim());
  if (proxySignals) return false;
  const actual = String(requestHost || '').trim().toLowerCase();
  const expected = String(tokenHost || '').trim().toLowerCase();
  return !!actual && !!expected && actual === expected;
};

const isPrivateIpv4 = (value) => {
  const parts = String(value || '').split('.').map((item) => Number(item));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
};

const isPrivateHostname = (hostname) => {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  const ipType = net.isIP(host);
  if (ipType === 4) return isPrivateIpv4(host);
  if (ipType === 6) {
    if (host === '::1') return true;
    if (host.startsWith('fc') || host.startsWith('fd')) return true;
    if (host.startsWith('fe80:')) return true;
  }
  return false;
};

const validateAiBaseUrl = (value, { allowHttp = false, allowPrivateHosts = false } = {}) => {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error('AI base_url 非法');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('AI base_url 仅支持 http/https');
  }
  if (parsed.protocol !== 'https:' && !allowHttp) {
    throw new Error('AI base_url 必须使用 HTTPS');
  }
  if (!allowPrivateHosts && isPrivateHostname(parsed.hostname)) {
    throw new Error('AI base_url 不允许指向本地或内网地址');
  }
  return parsed;
};

const createMemoryRateLimiter = ({ windowMs, limit }) => {
  const hits = new Map();
  return {
    consume(key, nowMs = Date.now()) {
      const bucketKey = String(key || '').trim();
      if (!bucketKey) return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, Number(windowMs || 1000)) };
      const now = Number(nowMs);
      const start = now - Number(windowMs || 1000);
      const existing = Array.isArray(hits.get(bucketKey)) ? hits.get(bucketKey) : [];
      const fresh = existing.filter((ts) => Number(ts) > start);
      if (fresh.length >= Number(limit || 1)) {
        hits.set(bucketKey, fresh);
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, Number(windowMs || 1000) - (now - fresh[0])),
        };
      }
      fresh.push(now);
      hits.set(bucketKey, fresh);
      return {
        allowed: true,
        remaining: Math.max(0, Number(limit || 1) - fresh.length),
        retryAfterMs: 0,
      };
    },
  };
};

module.exports = {
  canReadCourse,
  createMemoryRateLimiter,
  isDocPreviewHostAllowed,
  validateAiBaseUrl,
};
