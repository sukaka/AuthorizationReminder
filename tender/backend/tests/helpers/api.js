const DEFAULT_API_BASE = 'http://localhost:5187';
const DEFAULT_AUTH_BASE = 'http://localhost:5180';

const normalizeBaseUrl = (value, fallback) => {
  const text = String(value || fallback || '').trim();
  if (!text) return '';
  return text.replace(/\/+$/, '');
};

const getApiBase = () => normalizeBaseUrl(process.env.API_BASE, DEFAULT_API_BASE);
const getAuthBase = () => normalizeBaseUrl(process.env.AUTH_BASE, DEFAULT_AUTH_BASE);

const uniqueCode = (prefix) => {
  const head = String(prefix || 'TENDER').toUpperCase();
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0');
  return `${head}-${ts}-${rand}`;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseResponse = async (res) => {
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch (_err) {
      json = null;
    }
  }
  return {
    status: Number(res.status),
    ok: !!res.ok,
    headers: res.headers,
    text,
    json,
  };
};

const request = async ({
  base,
  path,
  method = 'GET',
  token = '',
  body,
  headers = {},
  timeoutMs = 15000,
}) => {
  const baseUrl = normalizeBaseUrl(base, DEFAULT_API_BASE);
  const url = `${baseUrl}${path}`;
  const finalHeaders = {
    ...headers,
  };

  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  let finalBody;
  if (body !== undefined && body !== null) {
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    if (!isFormData && !Object.prototype.hasOwnProperty.call(finalHeaders, 'Content-Type')) {
      finalHeaders['Content-Type'] = 'application/json';
    }
    finalBody = isFormData ? body : JSON.stringify(body);
  }

  const res = await fetchWithTimeout(
    url,
    {
      method,
      headers: finalHeaders,
      body: finalBody,
    },
    timeoutMs
  );

  return parseResponse(res);
};

const ensureStatus = (resp, expected) => {
  if (resp.status !== expected) {
    throw new Error(`期望 HTTP ${expected}，实际 ${resp.status}，响应：${resp.text || '<empty>'}`);
  }
};

const ensureJsonField = (resp, fieldName) => {
  const value = resp?.json?.[fieldName];
  if (value === undefined || value === null || value === '') {
    throw new Error(`响应缺少字段 ${fieldName}：${resp?.text || '<empty>'}`);
  }
  return value;
};

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromResponse(response) {
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    const values = Array.isArray(list) && list.length ? list : (() => {
      const fallback = response.headers.get('set-cookie');
      return fallback ? [fallback] : [];
    })();

    values.forEach((item) => {
      const pair = String(item || '').split(';')[0] || '';
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const key = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!key) return;
      this.cookies.set(key, value);
    });
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }
}

const parseCaptchaCode = (svg) => {
  const text = String(svg || '');
  const match = text.match(/<text[^>]*>([^<]+)<\/text>/i);
  return match && match[1] ? match[1].trim() : '';
};

const loginByPassword = async ({ authBase, loginId, username, password }) => {
  const base = normalizeBaseUrl(authBase, DEFAULT_AUTH_BASE);
  const loginIdentifier = String(loginId || username || '').trim();
  if (!loginIdentifier || !password) {
    throw new Error('loginByPassword 缺少 loginId/username 或 password');
  }
  const jar = new CookieJar();

  const csrfRes = await fetchWithTimeout(`${base}/api/auth/csrf`, { method: 'GET' }, 10000);
  jar.addFromResponse(csrfRes);
  const csrfData = await parseResponse(csrfRes);
  ensureStatus(csrfData, 200);
  const csrfToken = ensureJsonField(csrfData, 'token');

  let captchaToken = '';
  let captchaCode = '';
  const captchaRes = await fetchWithTimeout(
    `${base}/api/auth/captcha`,
    {
      method: 'GET',
      headers: jar.toHeader() ? { Cookie: jar.toHeader() } : {},
    },
    10000
  );
  jar.addFromResponse(captchaRes);
  const captchaData = await parseResponse(captchaRes);
  if (captchaData.status === 200 && captchaData.json?.enabled === true) {
    captchaToken = String(captchaData.json?.token || '');
    captchaCode = parseCaptchaCode(captchaData.json?.svg || '');
    if (!captchaToken || !captchaCode) {
      throw new Error(`验证码解析失败：${captchaData.text || '<empty>'}`);
    }
  }

  const payload = {
    username: loginIdentifier,
    password,
  };
  if (captchaToken && captchaCode) {
    payload.captchaToken = captchaToken;
    payload.captcha = captchaCode;
  }

  const loginRes = await fetchWithTimeout(
    `${base}/api/auth/login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        ...(jar.toHeader() ? { Cookie: jar.toHeader() } : {}),
      },
      body: JSON.stringify(payload),
    },
    10000
  );
  jar.addFromResponse(loginRes);
  const loginData = await parseResponse(loginRes);
  ensureStatus(loginData, 200);
  return ensureJsonField(loginData, 'token');
};

module.exports = {
  getApiBase,
  getAuthBase,
  request,
  ensureStatus,
  ensureJsonField,
  uniqueCode,
  loginByPassword,
};
