const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'prompt-center').trim() || 'prompt-center';
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));

const trimText = (value) => String(value || '').trim();

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const extractBearerToken = (authorizationHeader) => {
  const match = trimText(authorizationHeader).match(/^Bearer\s+(.+)$/i);
  return match ? trimText(match[1]) : '';
};

const extractCookieToken = (cookieHeader) => {
  const raw = trimText(cookieHeader);
  if (!raw) return '';
  for (const item of raw.split(';')) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    if (trimText(item.slice(0, idx)) !== AUTH_COOKIE_NAME) continue;
    return trimText(decodeURIComponent(item.slice(idx + 1)));
  }
  return '';
};

const normalizeRole = (role) => trimText(role).toLowerCase() || 'viewer';

const introspectToken = async (token) => {
  let resp;
  try {
    resp = await fetchWithTimeout(
      `${AUTH_SERVICE_URL}/api/auth/introspect`,
      { headers: { Authorization: `Bearer ${token}` } },
      AUTH_FETCH_TIMEOUT_MS
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw appError('统一登录服务超时', 503);
    throw appError('统一登录服务不可用', 503);
  }

  if (!resp.ok) throw appError('登录已过期', 401);
  let data;
  try {
    const rawText = await resp.text();
    if (rawText.length > 65536) throw new Error('auth payload too large');
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    throw appError('统一登录返回异常', 401);
  }

  const user = data?.user;
  const apps = Array.isArray(data?.apps) ? data.apps : [];
  if (!user || user.id === undefined || !user.username) throw appError('登录状态无效', 401);
  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) throw appError('无权限访问提示词管理系统', 403);

  return {
    user: {
      id: Number(user.id),
      username: trimText(user.username),
      role: normalizeRole(user.role),
      display_name: trimText(user.display_name || user.name || user.username),
      department: trimText(user.department || data?.scope?.department || ''),
    },
    apps,
    scope: data?.scope || {},
  };
};

const authRequired = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) throw appError('请先登录', 401);
  const session = await introspectToken(token);
  req.user = session.user;
  req.authApps = session.apps;
  req.authScope = session.scope;
  next();
});

const roleOf = (req) => normalizeRole(req.user?.role);
const isAdmin = (req) => roleOf(req) === 'admin';
const isEditor = (req) => roleOf(req) === 'editor';
const isReviewer = (req) => roleOf(req) === 'reviewer';
const isAuditor = (req) => roleOf(req) === 'auditor';
const canWritePrompt = (req) => isAdmin(req) || isEditor(req);
const canPublishPrompt = (req) => isAdmin(req) || isReviewer(req);
const canManageTaxonomy = (req) => isAdmin(req) || isEditor(req);
const canReadAudit = (req) => isAuditor(req);

const requirePermission = (predicate, message) =>
  asyncHandler(async (req, _res, next) => {
    if (!predicate(req)) throw appError(message, 403);
    next();
  });

module.exports = {
  appError,
  asyncHandler,
  authRequired,
  roleOf,
  canWritePrompt,
  canPublishPrompt,
  canManageTaxonomy,
  canReadAudit,
  requirePermission,
  extractBearerToken,
  extractCookieToken,
  introspectToken,
};
