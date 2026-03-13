require('dotenv').config();

const crypto = require('crypto');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');

const app = express();
const PORT = Number(process.env.PORT || 5190);
const SHIPPING_GATEWAY_TOKEN = String(process.env.SHIPPING_GATEWAY_TOKEN || '').trim();
const SHIPPING_GATEWAY_TIMEOUT_MS = Math.max(1000, Number(process.env.SHIPPING_GATEWAY_TIMEOUT_MS || 8000));
const SHIPPING_GATEWAY_ALLOW_MOCK = String(process.env.SHIPPING_GATEWAY_ALLOW_MOCK || '0').trim() === '1';
const RATE_LIMIT_WINDOW_SEC = Math.min(600, Math.max(1, Number(process.env.RATE_LIMIT_WINDOW_SEC || 60)));
const RATE_LIMIT_MAX = Math.min(3000, Math.max(20, Number(process.env.RATE_LIMIT_MAX || 240)));
const TRUSTED_PROXIES = String(process.env.TRUSTED_PROXIES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const TRACK_STATUS = {
  PENDING: 'PENDING',
  SHIPPED: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  SIGNED: 'SIGNED',
  EXCEPTION: 'EXCEPTION',
};

const PROVIDER_KEYS = {
  CAINIAO: 'CAINIAO',
  SF: 'SF',
  JD: 'JD',
};

const trimText = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
};
const defaultOrigins = [
  'http://localhost:5183',
  'http://127.0.0.1:5183',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
].map(normalizeOrigin);

const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

const toInt = (value, fallback, min, max) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.floor(num);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const createIpRateLimiter = ({ windowSec, maxRequests }) => {
  const windowMs = Math.max(1000, Number(windowSec || 60) * 1000);
  const max = Math.max(1, Number(maxRequests || 200));
  const buckets = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(ip);
    }
  }, Math.min(windowMs, 30000));
  if (typeof timer.unref === 'function') timer.unref();

  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const ip = trimText(req.ip) || 'unknown';
    const now = Date.now();
    const existing = buckets.get(ip);
    const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;
    bucket.count += 1;
    buckets.set(ip, bucket);
    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        enabled: false,
        fetched: 0,
        events: [],
        error: '请求过于频繁，请稍后重试',
      });
    }
    return next();
  };
};

const safeTokenEquals = (left, right) => {
  const leftBuf = Buffer.from(String(left || ''), 'utf8');
  const rightBuf = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuf.length || leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
};

const providerConfigs = {
  [PROVIDER_KEYS.CAINIAO]: {
    key: PROVIDER_KEYS.CAINIAO,
    label: '菜鸟',
    aliases: ['菜鸟', 'cainiao', 'cn'],
    inferRegExp: [/菜鸟/i, /cainiao/i],
    trackingPrefixRegExp: [/^CN/i],
    apiUrl: trimText(process.env.CAINIAO_TRACKING_API_URL),
    apiToken: trimText(process.env.CAINIAO_TRACKING_API_TOKEN),
    timeoutMs: toInt(process.env.CAINIAO_TRACKING_TIMEOUT_MS, SHIPPING_GATEWAY_TIMEOUT_MS, 1000, 60000),
    appKey: trimText(process.env.CAINIAO_APP_KEY),
    appSecret: trimText(process.env.CAINIAO_APP_SECRET),
  },
  [PROVIDER_KEYS.SF]: {
    key: PROVIDER_KEYS.SF,
    label: '顺丰',
    aliases: ['顺丰', 'sf', 'shunfeng'],
    inferRegExp: [/顺丰/i, /(^|[^a-z])sf([^a-z]|$)/i, /shunfeng/i],
    trackingPrefixRegExp: [/^SF/i],
    apiUrl: trimText(process.env.SF_TRACKING_API_URL),
    apiToken: trimText(process.env.SF_TRACKING_API_TOKEN),
    timeoutMs: toInt(process.env.SF_TRACKING_TIMEOUT_MS, SHIPPING_GATEWAY_TIMEOUT_MS, 1000, 60000),
    customerCode: trimText(process.env.SF_CUSTOMER_CODE),
    checkword: trimText(process.env.SF_CHECKWORD),
  },
  [PROVIDER_KEYS.JD]: {
    key: PROVIDER_KEYS.JD,
    label: '京东',
    aliases: ['京东', 'jd', 'jingdong', '京东物流'],
    inferRegExp: [/京东/i, /(^|[^a-z])jd([^a-z]|$)/i, /jingdong/i],
    trackingPrefixRegExp: [/^JD/i, /^JDX/i],
    apiUrl: trimText(process.env.JD_TRACKING_API_URL),
    apiToken: trimText(process.env.JD_TRACKING_API_TOKEN),
    timeoutMs: toInt(process.env.JD_TRACKING_TIMEOUT_MS, SHIPPING_GATEWAY_TIMEOUT_MS, 1000, 60000),
    appKey: trimText(process.env.JD_APP_KEY),
    appSecret: trimText(process.env.JD_APP_SECRET),
  },
};

const getEnabledProviderCount = () =>
  Object.values(providerConfigs).reduce((count, item) => count + (item.apiUrl ? 1 : 0), 0);

const nowMysqlDateTime = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const normalizeDateTime = (value) => {
  const text = trimText(value);
  if (!text) return '';

  if (/^\d{10,13}$/.test(text)) {
    const timestamp = text.length === 13 ? Number(text) : Number(text) * 1000;
    if (Number.isFinite(timestamp)) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const minute = String(date.getMinutes()).padStart(2, '0');
        const second = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
      }
    }
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) {
    return text.replace('T', ' ');
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  const second = String(parsed.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const normalizeStatus = (value, fallback = TRACK_STATUS.IN_TRANSIT) => {
  const text = trimText(value).toUpperCase();
  if (!text) return fallback;
  if (text.includes('SIGNED') || text.includes('DELIVERED') || text.includes('签收') || text.includes('妥投')) {
    return TRACK_STATUS.SIGNED;
  }
  if (text.includes('EXCEPTION') || text.includes('FAIL') || text.includes('ERROR') || text.includes('异常') || text.includes('退回')) {
    return TRACK_STATUS.EXCEPTION;
  }
  if (text.includes('TRANSIT') || text.includes('运输') || text.includes('在途') || text.includes('派送') || text.includes('中转')) {
    return TRACK_STATUS.IN_TRANSIT;
  }
  if (text.includes('SHIP') || text.includes('揽收') || text.includes('发货') || text.includes('出库')) {
    return TRACK_STATUS.SHIPPED;
  }
  if (text.includes('PENDING') || text.includes('待发')) {
    return TRACK_STATUS.PENDING;
  }
  return fallback;
};

const toSafePayload = async (response) => {
  const text = await response.text();
  if (!text) return { json: null, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch (_err) {
    return { json: null, text: text.slice(0, 600) };
  }
};

const collectEventArray = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  const priorityKeys = ['events', 'traces', 'trace', 'list', 'records', 'routes', 'nodes', 'details', 'logs', 'data'];
  const queue = [payload];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      return current;
    }

    for (const key of priorityKeys) {
      if (Array.isArray(current[key])) {
        return current[key];
      }
    }

    Object.values(current).forEach((item) => {
      if (item && typeof item === 'object') {
        queue.push(item);
      }
    });
  }

  return [];
};

const normalizeEvents = (payload, fallbackStatus = TRACK_STATUS.IN_TRANSIT) => {
  const rawEvents = collectEventArray(payload);
  const events = rawEvents
    .map((item) => {
      const eventTime =
        normalizeDateTime(item?.event_time) ||
        normalizeDateTime(item?.eventTime) ||
        normalizeDateTime(item?.time) ||
        normalizeDateTime(item?.accept_time) ||
        normalizeDateTime(item?.acceptTime) ||
        normalizeDateTime(item?.update_time) ||
        normalizeDateTime(item?.created_at) ||
        normalizeDateTime(item?.timestamp) ||
        '';
      if (!eventTime) return null;

      const description = trimText(
        item?.description || item?.context || item?.remark || item?.detail || item?.accept_station || item?.msg || item?.content
      ).slice(0, 255);
      if (!description) return null;

      const location = trimText(item?.location || item?.city || item?.site || item?.station || item?.address).slice(0, 128);
      const status = normalizeStatus(item?.status || item?.status_code || item?.node_status || item?.state, fallbackStatus);

      return {
        event_time: eventTime,
        status,
        location,
        description,
      };
    })
    .filter(Boolean);

  const uniqueMap = new Map();
  events.forEach((event) => {
    const key = `${event.event_time}|${event.status}|${event.location}|${event.description}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, event);
    }
  });

  return Array.from(uniqueMap.values()).sort((a, b) => a.event_time.localeCompare(b.event_time));
};

const inferProvider = ({ provider, carrier, trackingNo }) => {
  const providerText = trimText(provider).toUpperCase();
  if (providerText && providerConfigs[providerText]) {
    return providerConfigs[providerText];
  }

  const carrierText = trimText(carrier).toLowerCase();
  if (carrierText) {
    for (const item of Object.values(providerConfigs)) {
      if (item.aliases.some((alias) => alias.toLowerCase() === carrierText)) return item;
      if (item.inferRegExp.some((re) => re.test(carrierText))) return item;
    }
  }

  const trackingText = trimText(trackingNo).toUpperCase();
  if (trackingText) {
    for (const item of Object.values(providerConfigs)) {
      if (item.trackingPrefixRegExp.some((re) => re.test(trackingText))) return item;
    }
  }

  const enabledProviders = Object.values(providerConfigs).filter((item) => Boolean(item.apiUrl));
  if (enabledProviders.length === 1) {
    return enabledProviders[0];
  }

  return null;
};

const buildProviderHeaders = (providerConfig) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tracking-Provider': providerConfig.key,
  };

  if (providerConfig.apiToken) {
    headers.Authorization = `Bearer ${providerConfig.apiToken}`;
  }

  if (providerConfig.appKey) {
    headers['X-Provider-App-Key'] = providerConfig.appKey;
  }
  if (providerConfig.appSecret) {
    headers['X-Provider-App-Secret'] = providerConfig.appSecret;
  }
  if (providerConfig.customerCode) {
    headers['X-Provider-Customer-Code'] = providerConfig.customerCode;
  }
  if (providerConfig.checkword) {
    headers['X-Provider-Checkword'] = providerConfig.checkword;
  }

  return headers;
};

const queryProviderTracking = async ({ providerConfig, carrier, trackingNo }) => {
  if (!providerConfig.apiUrl) {
    if (!SHIPPING_GATEWAY_ALLOW_MOCK) {
      return {
        enabled: false,
        fetched: 0,
        events: [],
        error: '',
      };
    }

    const now = nowMysqlDateTime();
    return {
      enabled: true,
      fetched: 1,
      events: [
        {
          event_time: now,
          status: TRACK_STATUS.IN_TRANSIT,
          location: '演示线路',
          description: `模拟轨迹：${providerConfig.label} ${trackingNo} 在途`,
        },
      ],
      error: '',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerConfig.timeoutMs || SHIPPING_GATEWAY_TIMEOUT_MS);
  try {
    const response = await fetch(providerConfig.apiUrl, {
      method: 'POST',
      headers: buildProviderHeaders(providerConfig),
      body: JSON.stringify({
        provider: providerConfig.key,
        carrier: trimText(carrier),
        tracking_no: trimText(trackingNo),
      }),
      signal: controller.signal,
    });

    const payload = await toSafePayload(response);
    if (!response.ok) {
      const detail = trimText(payload.json?.error || payload.json?.message || payload.text).slice(0, 120);
      return {
        enabled: true,
        fetched: 0,
        events: [],
        error: `${providerConfig.label}物流接口返回 ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    const events = normalizeEvents(payload.json || payload.text, TRACK_STATUS.IN_TRANSIT);
    return {
      enabled: true,
      fetched: events.length,
      events,
      error: '',
    };
  } catch (err) {
    const message = err?.name === 'AbortError' ? `${providerConfig.label}物流接口请求超时` : trimText(err?.message) || '物流接口请求失败';
    return {
      enabled: true,
      fetched: 0,
      events: [],
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
};

const corsOptions = (req, cb) => {
  const allowed = isOriginAllowedForRequest({
    origin: req.headers.origin,
    headers: req.headers,
    allowedOrigins,
    defaultOrigins,
  });
  if (!allowed) {
    const err = new Error('Not allowed by CORS');
    err.statusCode = 403;
    return cb(err);
  }
  return cb(null, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Token'],
    maxAge: 86400,
  });
};

const apiRateLimiter = createIpRateLimiter({
  windowSec: RATE_LIMIT_WINDOW_SEC,
  maxRequests: RATE_LIMIT_MAX,
});

app.disable('x-powered-by');
if (TRUSTED_PROXIES.length) {
  app.set('trust proxy', TRUSTED_PROXIES.length === 1 ? TRUSTED_PROXIES[0] : TRUSTED_PROXIES);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRateLimiter);

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    provider_configured: {
      cainiao: Boolean(providerConfigs[PROVIDER_KEYS.CAINIAO].apiUrl),
      sf: Boolean(providerConfigs[PROVIDER_KEYS.SF].apiUrl),
      jd: Boolean(providerConfigs[PROVIDER_KEYS.JD].apiUrl),
    },
  });
});

app.post('/api/track/query', async (req, res) => {
  try {
    if (SHIPPING_GATEWAY_TOKEN) {
      const authHeader = trimText(req.headers.authorization);
      const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : trimText(req.headers['x-api-token']);
      if (!safeTokenEquals(rawToken, SHIPPING_GATEWAY_TOKEN)) {
        return res.status(401).json({
          enabled: false,
          fetched: 0,
          events: [],
          error: '物流网关鉴权失败',
        });
      }
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({
        enabled: false,
        fetched: 0,
        events: [],
        error: '请求体格式非法',
      });
    }

    const trackingNo = trimText(req.body?.tracking_no).replace(/\s+/g, '').slice(0, 64);
    const carrier = trimText(req.body?.carrier).slice(0, 32);
    const providerHint = trimText(req.body?.provider).toUpperCase().slice(0, 16);

    if (!trackingNo) {
      return res.status(400).json({
        enabled: false,
        fetched: 0,
        events: [],
        error: 'tracking_no 不能为空',
      });
    }
    if (trackingNo.length < 4 || !/^[A-Za-z0-9_-]+$/.test(trackingNo)) {
      return res.status(400).json({
        enabled: false,
        fetched: 0,
        events: [],
        error: 'tracking_no 格式非法',
      });
    }

    const providerConfig = inferProvider({ provider: providerHint, carrier, trackingNo });
    if (!providerConfig) {
      return res.status(400).json({
        enabled: false,
        fetched: 0,
        events: [],
        error: '无法识别物流公司，请填写菜鸟/顺丰/京东或提供 provider',
      });
    }

    const result = await queryProviderTracking({ providerConfig, carrier, trackingNo });
    return res.json({
      provider: providerConfig.key,
      provider_label: providerConfig.label,
      enabled: Boolean(result.enabled),
      fetched: Number(result.fetched || 0),
      events: Array.isArray(result.events) ? result.events : [],
      error: trimText(result.error),
      fetched_at: nowMysqlDateTime(),
    });
  } catch (err) {
    console.error('[shipping-gateway] query failed', err);
    return res.status(500).json({
      enabled: false,
      fetched: 0,
      events: [],
      error: trimText(err?.message) || '物流网关内部错误',
    });
  }
});

app.use((err, _req, res, _next) => {
  const statusCode = Number(err?.statusCode || err?.status || 500);
  const message = statusCode >= 500 ? '物流网关内部错误' : trimText(err?.message) || '请求失败';
  if (statusCode >= 500) {
    console.error('[shipping-gateway] unhandled error', err);
  }
  res.status(statusCode).json({
    enabled: false,
    fetched: 0,
    events: [],
    error: message,
  });
});

app.listen(PORT, () => {
  const summary = Object.values(providerConfigs)
    .map((item) => `${item.label}:${item.apiUrl ? 'on' : 'off'}`)
    .join(' ');
  console.log(`[shipping-gateway] listening on :${PORT} providers=${summary} enabled=${getEnabledProviderCount()}`);
});
