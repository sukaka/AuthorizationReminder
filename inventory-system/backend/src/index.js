require('dotenv').config();

const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const {
  isOriginAllowedForRequest,
  normalizeOrigin,
} = require('./cors-origin');
const { get, initDb, query, run, transaction } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 5183);
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5180';
const AUTH_SYSTEM_KEY = String(process.env.AUTH_SYSTEM_KEY || 'inventory').trim();
const AUTH_COOKIE_NAME = String(process.env.AUTH_COOKIE_NAME || 'juxin_auth_token').trim() || 'juxin_auth_token';
const SHIPPING_PENDING_TIMEOUT_HOURS = Math.max(1, Number(process.env.SHIPPING_PENDING_TIMEOUT_HOURS || 24));
const SHIPPING_TRANSIT_TIMEOUT_HOURS = Math.max(1, Number(process.env.SHIPPING_TRANSIT_TIMEOUT_HOURS || 72));
const SHIPPING_ALERT_REPEAT_HOURS = Math.max(1, Number(process.env.SHIPPING_ALERT_REPEAT_HOURS || 24));
const REMINDER_DB_NAME = String(process.env.MYSQL_REMINDER_DATABASE || 'juxin_reminder').trim();
const REMINDER_ALERT_WEBHOOK = String(process.env.REMINDER_ALERT_WEBHOOK || '').trim();
const REMINDER_ALERT_WEBHOOK_TOKEN = String(process.env.REMINDER_ALERT_WEBHOOK_TOKEN || '').trim();
const SHIPPING_TRACKING_API_URL = String(process.env.SHIPPING_TRACKING_API_URL || '').trim();
const SHIPPING_TRACKING_API_TOKEN = String(process.env.SHIPPING_TRACKING_API_TOKEN || '').trim();
const SHIPPING_TRACKING_API_TIMEOUT_MS = Math.max(1000, Number(process.env.SHIPPING_TRACKING_API_TIMEOUT_MS || 6000));
const SHIPPING_TRACKING_AUTO_SYNC_ENABLED = String(process.env.SHIPPING_TRACKING_AUTO_SYNC_ENABLED || '1').trim() !== '0';
const SHIPPING_TRACKING_AUTO_SYNC_INTERVAL_MS = Math.max(
  30000,
  Number(process.env.SHIPPING_TRACKING_AUTO_SYNC_INTERVAL_MS || 300000)
);
const SHIPPING_TRACKING_AUTO_SYNC_BATCH = Math.min(
  200,
  Math.max(1, Number(process.env.SHIPPING_TRACKING_AUTO_SYNC_BATCH || 30))
);
const MYSQL_HOST = process.env.MYSQL_HOST || '127.0.0.1';
const MYSQL_PORT = Number(process.env.MYSQL_PORT || 3306);
const MYSQL_USER = process.env.MYSQL_USER || 'juxin';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || '';
const AUTH_FETCH_TIMEOUT_MS = Math.max(1000, Number(process.env.AUTH_FETCH_TIMEOUT_MS || 5000));
const RATE_LIMIT_WINDOW_SEC = Math.min(600, Math.max(1, Number(process.env.RATE_LIMIT_WINDOW_SEC || 60)));
const RATE_LIMIT_MAX = Math.min(5000, Math.max(20, Number(process.env.RATE_LIMIT_MAX || 300)));
const REMINDER_WEBHOOK_TIMEOUT_MS = Math.max(1000, Number(process.env.REMINDER_WEBHOOK_TIMEOUT_MS || 5000));
const TRUSTED_PROXIES = String(process.env.TRUSTED_PROXIES || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const SHIPPING_STATUS = {
  PENDING: 'PENDING',
  SHIPPED: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  SIGNED: 'SIGNED',
  EXCEPTION: 'EXCEPTION',
};
const SHIPPING_STATUS_SET = new Set(Object.values(SHIPPING_STATUS));
const SHIPPING_STATUS_TRANSITIONS = {
  [SHIPPING_STATUS.PENDING]: new Set([SHIPPING_STATUS.SHIPPED, SHIPPING_STATUS.EXCEPTION]),
  [SHIPPING_STATUS.SHIPPED]: new Set([SHIPPING_STATUS.IN_TRANSIT, SHIPPING_STATUS.SIGNED, SHIPPING_STATUS.EXCEPTION]),
  [SHIPPING_STATUS.IN_TRANSIT]: new Set([SHIPPING_STATUS.SIGNED, SHIPPING_STATUS.EXCEPTION]),
  [SHIPPING_STATUS.SIGNED]: new Set([]),
  [SHIPPING_STATUS.EXCEPTION]: new Set([]),
};
const SHIPPING_ALERT_TYPES = {
  PENDING_TIMEOUT: 'PENDING_TIMEOUT',
  TRANSIT_TIMEOUT: 'TRANSIT_TIMEOUT',
};
const SERIAL_STATUS = {
  IN_STOCK: 'IN_STOCK',
  OUT_STOCK: 'OUT_STOCK',
};

const defaultOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8082',
  'http://127.0.0.1:8082',
].map(normalizeOrigin);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit'],
    maxAge: 86400,
  });
};

app.disable('x-powered-by');
if (TRUSTED_PROXIES.length) {
  app.set('trust proxy', TRUSTED_PROXIES.length === 1 ? TRUSTED_PROXIES[0] : TRUSTED_PROXIES);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const appError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const createIpRateLimiter = ({ windowSec, maxRequests }) => {
  const windowMs = Math.max(1000, Number(windowSec || 60) * 1000);
  const max = Math.max(1, Number(maxRequests || 300));
  const buckets = new Map();

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets.entries()) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(windowMs, 30000));
  if (typeof timer.unref === 'function') timer.unref();

  return (req, res, next) => {
    if (req.method === 'OPTIONS' || req.path === '/health') return next();
    const ip = trimText(req.ip) || 'unknown';
    const now = Date.now();
    const existing = buckets.get(ip);
    const bucket = !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;
    bucket.count += 1;
    buckets.set(ip, bucket);

    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return next(appError('请求过于频繁，请稍后重试', 429));
    }
    return next();
  };
};

const apiRateLimiter = createIpRateLimiter({
  windowSec: RATE_LIMIT_WINDOW_SEC,
  maxRequests: RATE_LIMIT_MAX,
});

const toPositiveDecimal = (value, field) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw appError(`${field} 必须是大于 0 的数字`);
  }
  return Number(num.toFixed(3));
};

const toNonNegativeDecimal = (value, field) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw appError(`${field} 不能小于 0`);
  }
  return Number(num.toFixed(3));
};

const toIntId = (value, field) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw appError(`${field} 非法`);
  }
  return num;
};

const trimText = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value).trim());
const normalizeBatchNo = (value) => trimText(value).slice(0, 64);
const normalizeSerialNo = (value) => trimText(value).slice(0, 128);
const toNumber = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};
const splitSerialTokens = (value) => {
  const raw = Array.isArray(value) ? value.map((item) => trimText(item)) : [trimText(value)];
  if (raw.length === 0) return [];
  return raw
    .join('\n')
    .split(/[\n,，;；\s]+/)
    .map((item) => normalizeSerialNo(item))
    .filter(Boolean);
};
const parseSerialNumbers = (value, fieldLabel = '序列号') => {
  const tokens = splitSerialTokens(value);
  const uniqueSet = new Set();
  const list = [];
  for (const token of tokens) {
    const key = token.toUpperCase();
    if (uniqueSet.has(key)) {
      throw appError(`${fieldLabel}重复：${token}`);
    }
    uniqueSet.add(key);
    list.push(token);
  }
  return list;
};
const compactSerialPreview = (serialNos, maxCount = 6) => {
  const list = Array.isArray(serialNos) ? serialNos : [];
  if (!list.length) return '';
  if (list.length <= maxCount) return list.join(', ');
  return `${list.slice(0, maxCount).join(', ')} ... 共${list.length}个`;
};
const toDayKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const buildRecentDayKeys = (days) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const list = [];
  for (let i = 0; i < days; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    list.push(toDayKey(current));
  }
  return list;
};
const parseDashboardDays = (raw) => {
  const value = Number(raw);
  if (!Number.isInteger(value)) return 30;
  if (value <= 7) return 7;
  if (value >= 180) return 180;
  return value;
};
const parsePaging = (rawPage, rawLimit, options = {}) => {
  const hasPaging = rawPage !== undefined || rawLimit !== undefined;
  if (!hasPaging) return null;

  const defaultLimit = Number(options.defaultLimit || 50);
  const maxLimit = Number(options.maxLimit || 500);
  const pageNum = Number(rawPage || 1);
  const limitNum = Number(rawLimit || defaultLimit);
  const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 1;
  const limit = Number.isInteger(limitNum) ? Math.min(Math.max(limitNum, 1), maxLimit) : defaultLimit;

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};
const setPagingHeaders = (res, paging, total) => {
  if (!paging) return;
  res.setHeader('X-Total-Count', String(Number(total || 0)));
  res.setHeader('X-Page', String(paging.page));
  res.setHeader('X-Limit', String(paging.limit));
};

const normalizeShippingStatus = (value, fallback = SHIPPING_STATUS.PENDING) => {
  const text = trimText(value);
  if (!text) return fallback;
  const key = text.toUpperCase();
  if (!SHIPPING_STATUS_SET.has(key)) {
    throw appError('发货状态非法');
  }
  return key;
};

const canTransitionShippingStatus = (fromStatus, toStatus) => {
  const from = normalizeShippingStatus(fromStatus, SHIPPING_STATUS.PENDING);
  const to = normalizeShippingStatus(toStatus, from);
  if (from === to) return true;
  const allowed = SHIPPING_STATUS_TRANSITIONS[from];
  return Boolean(allowed && allowed.has(to));
};

const parseDateTimeToMysql = (value, fieldName) => {
  const text = trimText(value);
  if (!text) return null;
  const directText = text.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(directText)) {
    return `${directText}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(directText)) {
    return directText;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw appError(`${fieldName}格式非法`);
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  const second = String(parsed.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const parseDbDateValue = (value) => {
  const text = trimText(value);
  if (!text) return null;
  const date = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const getShippingOverdueMeta = (row) => {
  const status = normalizeShippingStatus(row?.status, SHIPPING_STATUS.PENDING);
  const createdAt = parseDbDateValue(row?.created_at);
  const shippedAt = parseDbDateValue(row?.shipped_at);
  const now = Date.now();
  const elapsedFromCreated = createdAt ? (now - createdAt.getTime()) / 3600000 : 0;
  const elapsedFromShipped = shippedAt ? (now - shippedAt.getTime()) / 3600000 : 0;
  const pendingOverdue = status === SHIPPING_STATUS.PENDING && elapsedFromCreated >= SHIPPING_PENDING_TIMEOUT_HOURS;
  const transitOverdue =
    (status === SHIPPING_STATUS.SHIPPED || status === SHIPPING_STATUS.IN_TRANSIT) &&
    shippedAt &&
    elapsedFromShipped >= SHIPPING_TRANSIT_TIMEOUT_HOURS;

  let alertType = '';
  let overtimeHours = 0;
  if (pendingOverdue) {
    alertType = SHIPPING_ALERT_TYPES.PENDING_TIMEOUT;
    overtimeHours = Number((elapsedFromCreated - SHIPPING_PENDING_TIMEOUT_HOURS).toFixed(1));
  } else if (transitOverdue) {
    alertType = SHIPPING_ALERT_TYPES.TRANSIT_TIMEOUT;
    overtimeHours = Number((elapsedFromShipped - SHIPPING_TRANSIT_TIMEOUT_HOURS).toFixed(1));
  }

  return {
    pendingOverdue,
    transitOverdue,
    isOverdue: pendingOverdue || Boolean(transitOverdue),
    alertType,
    overtimeHours: Math.max(0, overtimeHours),
    elapsedPendingHours: Number(elapsedFromCreated.toFixed(1)),
    elapsedTransitHours: Number(elapsedFromShipped.toFixed(1)),
  };
};

const shippingStatusTextMap = {
  [SHIPPING_STATUS.PENDING]: '待发货',
  [SHIPPING_STATUS.SHIPPED]: '已发货',
  [SHIPPING_STATUS.IN_TRANSIT]: '运输中',
  [SHIPPING_STATUS.SIGNED]: '已签收',
  [SHIPPING_STATUS.EXCEPTION]: '异常',
};

const getNowMysqlDateTime = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const toSafeMysqlDateTime = (value, fallback = '') => {
  try {
    return parseDateTimeToMysql(value, '时间');
  } catch (_err) {
    return fallback;
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 5000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 5000)));
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeTrackingEventStatus = (value) => {
  const text = trimText(value).toUpperCase();
  if (!text) return '';
  if (SHIPPING_STATUS_SET.has(text)) return text;
  if (text.includes('TRANSIT')) return SHIPPING_STATUS.IN_TRANSIT;
  if (text.includes('SIGNED') || text.includes('DELIVERED')) return SHIPPING_STATUS.SIGNED;
  if (text.includes('SHIP')) return SHIPPING_STATUS.SHIPPED;
  if (text.includes('EXCEPTION') || text.includes('ERROR') || text.includes('FAIL')) return SHIPPING_STATUS.EXCEPTION;
  if (text.includes('PENDING')) return SHIPPING_STATUS.PENDING;
  return '';
};

const buildShippingTrackDescription = (status, remark, options = {}) => {
  const normalized = normalizeShippingStatus(status, SHIPPING_STATUS.PENDING);
  const label = shippingStatusTextMap[normalized] || normalized;
  const note = trimText(remark);
  if (options.isCreate) {
    return note ? `创建发货记录（${label}）：${note}` : `创建发货记录（${label}）`;
  }
  return note ? `状态更新为${label}：${note}` : `状态更新为${label}`;
};

const insertShippingTrackingEvent = async (runner, payload) => {
  const execute = typeof runner?.run === 'function' ? runner.run.bind(runner) : run;
  const shippingOrderId = Number(payload?.shipping_order_id || 0);
  if (!shippingOrderId) return null;

  const eventTime = toSafeMysqlDateTime(payload?.event_time, '') || getNowMysqlDateTime();
  const statusRaw = trimText(payload?.status);
  const status = statusRaw ? normalizeTrackingEventStatus(statusRaw) || statusRaw.toUpperCase() : '';
  const location = trimText(payload?.location).slice(0, 128);
  const description = trimText(payload?.description).slice(0, 255);
  if (!description) return null;
  const source = trimText(payload?.source, 'SYSTEM').slice(0, 32) || 'SYSTEM';

  const result = await execute(
    `INSERT IGNORE INTO shipping_tracking_events
     (shipping_order_id, event_time, status, location, description, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [shippingOrderId, eventTime, status, location, description, source]
  );
  return result;
};

const loadShippingTrackingEvents = async (shippingOrderId) => {
  const rows = await query(
    `SELECT id,
            shipping_order_id,
            event_time,
            status,
            location,
            description,
            source,
            created_at
     FROM shipping_tracking_events
     WHERE shipping_order_id = ?
     ORDER BY event_time DESC, id DESC`,
    [shippingOrderId]
  );
  return rows;
};

const parseExternalTrackingEvents = (raw, fallbackStatus) => {
  const data = raw?.data ?? raw;
  let events = [];
  if (Array.isArray(data)) {
    events = data;
  } else if (Array.isArray(data?.events)) {
    events = data.events;
  } else if (Array.isArray(data?.traces)) {
    events = data.traces;
  } else if (Array.isArray(raw?.events)) {
    events = raw.events;
  }

  const normalized = events
    .map((item) => {
      const eventTime =
        toSafeMysqlDateTime(item?.event_time, '') ||
        toSafeMysqlDateTime(item?.time, '') ||
        toSafeMysqlDateTime(item?.accept_time, '') ||
        toSafeMysqlDateTime(item?.update_time, '') ||
        '';
      if (!eventTime) return null;

      const status =
        normalizeTrackingEventStatus(item?.status) ||
        normalizeTrackingEventStatus(item?.status_code) ||
        normalizeTrackingEventStatus(item?.node_status) ||
        fallbackStatus ||
        '';
      const location = trimText(item?.location || item?.city || item?.site || item?.station).slice(0, 128);
      const description = trimText(item?.description || item?.context || item?.remark || item?.detail).slice(0, 255);
      if (!description) return null;
      return {
        event_time: eventTime,
        status,
        location,
        description,
      };
    })
    .filter(Boolean);

  const uniqueMap = new Map();
  normalized.forEach((item) => {
    const key = `${item.event_time}|${item.status}|${item.location}|${item.description}`;
    if (!uniqueMap.has(key)) uniqueMap.set(key, item);
  });

  return Array.from(uniqueMap.values()).sort((a, b) => a.event_time.localeCompare(b.event_time));
};

const fetchExternalTrackingEvents = async ({ carrier, tracking_no, status }) => {
  if (!SHIPPING_TRACKING_API_URL) {
    return {
      enabled: false,
      fetched: 0,
      events: [],
      error: '',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHIPPING_TRACKING_API_TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (SHIPPING_TRACKING_API_TOKEN) {
      headers.Authorization = `Bearer ${SHIPPING_TRACKING_API_TOKEN}`;
    }
    const response = await fetch(SHIPPING_TRACKING_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        carrier: trimText(carrier),
        tracking_no: trimText(tracking_no),
      }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch (_err) {
        payload = null;
      }
    }
    if (!response.ok) {
      const detail = trimText(payload?.error || payload?.message || rawText).slice(0, 120);
      return {
        enabled: true,
        fetched: 0,
        events: [],
        error: `物流接口返回 ${response.status}${detail ? `: ${detail}` : ''}`,
      };
    }

    const payloadEnabled = payload?.enabled === undefined ? true : Boolean(payload?.enabled);
    const payloadError = trimText(payload?.error || payload?.message);
    const events = parseExternalTrackingEvents(payload, normalizeTrackingEventStatus(status));
    return {
      enabled: payloadEnabled,
      fetched: events.length,
      events,
      error: payloadError && events.length === 0 ? payloadError : '',
    };
  } catch (err) {
    const message = err?.name === 'AbortError' ? '物流接口请求超时' : trimText(err?.message) || '物流接口请求失败';
    return {
      enabled: true,
      fetched: 0,
      events: [],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const syncExternalTrackingEvents = async (shippingOrder) => {
  const fetchResult = await fetchExternalTrackingEvents(shippingOrder || {});
  if (!fetchResult.enabled || !fetchResult.events.length) {
    return {
      ...fetchResult,
      inserted: 0,
    };
  }

  let inserted = 0;
  for (const event of fetchResult.events) {
    const result = await insertShippingTrackingEvent(null, {
      shipping_order_id: Number(shippingOrder.id),
      event_time: event.event_time,
      status: event.status || normalizeTrackingEventStatus(shippingOrder.status),
      location: event.location,
      description: event.description,
      source: 'LIVE_API',
    });
    if (Number(result?.affectedRows || 0) > 0) inserted += 1;
  }

  return {
    ...fetchResult,
    inserted,
  };
};

let shippingTrackingSyncTimer = null;
let shippingTrackingSyncRunning = false;
let shippingTrackingSyncCursorId = 0;

const loadAutoSyncShippingOrders = async () => {
  const cursorId = Number(shippingTrackingSyncCursorId || 0);
  let rows = await query(
    `SELECT id,
            shipment_no,
            carrier,
            tracking_no,
            status
     FROM shipping_orders
     WHERE status IN ('SHIPPED', 'IN_TRANSIT')
       AND tracking_no IS NOT NULL
       AND tracking_no <> ''
       AND id > ?
     ORDER BY id ASC
     LIMIT ?`,
    [cursorId, SHIPPING_TRACKING_AUTO_SYNC_BATCH]
  );

  if (!rows.length && cursorId > 0) {
    shippingTrackingSyncCursorId = 0;
    rows = await query(
      `SELECT id,
              shipment_no,
              carrier,
              tracking_no,
              status
       FROM shipping_orders
       WHERE status IN ('SHIPPED', 'IN_TRANSIT')
         AND tracking_no IS NOT NULL
         AND tracking_no <> ''
         AND id > 0
       ORDER BY id ASC
       LIMIT ?`,
      [SHIPPING_TRACKING_AUTO_SYNC_BATCH]
    );
  }

  if (rows.length) {
    shippingTrackingSyncCursorId = Number(rows[rows.length - 1]?.id || 0);
  }

  return rows;
};

const runShippingTrackingAutoSync = async () => {
  if (!SHIPPING_TRACKING_AUTO_SYNC_ENABLED || !SHIPPING_TRACKING_API_URL) return;
  if (shippingTrackingSyncRunning) return;

  shippingTrackingSyncRunning = true;
  try {
    const targets = await loadAutoSyncShippingOrders();
    if (!targets.length) return;

    let totalFetched = 0;
    let totalInserted = 0;
    let errorCount = 0;

    for (const row of targets) {
      const result = await syncExternalTrackingEvents(row);
      totalFetched += Number(result?.fetched || 0);
      totalInserted += Number(result?.inserted || 0);
      if (trimText(result?.error)) errorCount += 1;
    }

    if (totalInserted > 0 || errorCount > 0) {
      console.log(
        `[shipping-track-sync] targets=${targets.length} fetched=${totalFetched} inserted=${totalInserted} errors=${errorCount}`
      );
    }
  } catch (err) {
    console.warn('[shipping-track-sync] failed', err?.message || err);
  } finally {
    shippingTrackingSyncRunning = false;
  }
};

const startShippingTrackingAutoSync = () => {
  if (!SHIPPING_TRACKING_AUTO_SYNC_ENABLED) {
    console.log('[shipping-track-sync] disabled by config');
    return;
  }
  if (!SHIPPING_TRACKING_API_URL) {
    console.log('[shipping-track-sync] skipped (SHIPPING_TRACKING_API_URL not configured)');
    return;
  }

  if (shippingTrackingSyncTimer) {
    clearInterval(shippingTrackingSyncTimer);
    shippingTrackingSyncTimer = null;
  }

  runShippingTrackingAutoSync().catch((err) => {
    console.warn('[shipping-track-sync] startup sync failed', err?.message || err);
  });

  shippingTrackingSyncTimer = setInterval(() => {
    runShippingTrackingAutoSync().catch((err) => {
      console.warn('[shipping-track-sync] cycle failed', err?.message || err);
    });
  }, SHIPPING_TRACKING_AUTO_SYNC_INTERVAL_MS);

  console.log(
    `[shipping-track-sync] started interval=${SHIPPING_TRACKING_AUTO_SYNC_INTERVAL_MS}ms batch=${SHIPPING_TRACKING_AUTO_SYNC_BATCH}`
  );
};

const buildShippingAlertMessage = (row, alertType, overtimeHours) => {
  const shipmentNo = trimText(row?.shipment_no) || '-';
  const trackingNo = trimText(row?.tracking_no) || '-';
  if (alertType === SHIPPING_ALERT_TYPES.PENDING_TIMEOUT) {
    return `发货单 ${shipmentNo}（${trackingNo}）已超时待发货 ${Math.max(1, Math.round(overtimeHours))} 小时`;
  }
  return `发货单 ${shipmentNo}（${trackingNo}）运输超时 ${Math.max(1, Math.round(overtimeHours))} 小时`;
};

let reminderPool = null;
let reminderTableReady = false;
const getReminderPool = () => {
  if (reminderPool) return reminderPool;
  reminderPool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: REMINDER_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
  });
  return reminderPool;
};

const ensureReminderAlertTable = async () => {
  if (reminderTableReady) return;
  const pool = getReminderPool();
  await pool.execute(`CREATE TABLE IF NOT EXISTS inventory_shipping_alerts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      shipping_order_id INT NOT NULL,
      shipment_no VARCHAR(64) NOT NULL,
      stock_out_order_id INT NOT NULL,
      alert_type VARCHAR(32) NOT NULL,
      alert_status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
      alert_message VARCHAR(255) NOT NULL,
      source_system VARCHAR(32) NOT NULL DEFAULT 'inventory',
      payload_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inv_ship_alert_created_at (created_at),
      INDEX idx_inv_ship_alert_type_created (alert_type, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  reminderTableReady = true;
};

const persistReminderAlert = async (payload) => {
  try {
    await ensureReminderAlertTable();
    const pool = getReminderPool();
    await pool.execute(
      `INSERT INTO inventory_shipping_alerts
       (shipping_order_id, shipment_no, stock_out_order_id, alert_type, alert_status, alert_message, source_system, payload_json)
       VALUES (?, ?, ?, ?, 'OPEN', ?, 'inventory', ?)`,
      [
        Number(payload.shipping_order_id || 0),
        trimText(payload.shipment_no),
        Number(payload.stock_out_order_id || 0),
        trimText(payload.alert_type),
        trimText(payload.alert_message),
        toJsonText(payload),
      ]
    );
  } catch (err) {
    console.warn('[shipping-alert] write reminder db failed', err?.message || err);
  }
};

const pushReminderWebhook = async (payload) => {
  if (!REMINDER_ALERT_WEBHOOK) return;
  try {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (REMINDER_ALERT_WEBHOOK_TOKEN) {
      headers.Authorization = `Bearer ${REMINDER_ALERT_WEBHOOK_TOKEN}`;
    }
    const resp = await fetchWithTimeout(
      REMINDER_ALERT_WEBHOOK,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
      REMINDER_WEBHOOK_TIMEOUT_MS
    );
    if (!resp.ok) {
      console.warn('[shipping-alert] webhook failed', resp.status);
    }
  } catch (err) {
    console.warn('[shipping-alert] webhook failed', err?.message || err);
  }
};

const syncShippingAlerts = async () => {
  const overdueRows = await query(
    `SELECT s.id,
            s.shipment_no,
            s.stock_out_order_id,
            s.carrier,
            s.tracking_no,
            s.receiver_name,
            s.receiver_phone,
            s.receiver_address,
            s.status,
            s.shipped_at,
            s.created_at,
            s.updated_at,
            o.order_no AS stock_out_order_no
     FROM shipping_orders s
     LEFT JOIN stock_out_orders o ON o.id = s.stock_out_order_id
     WHERE (s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ?)
        OR (s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?)
     ORDER BY s.updated_at DESC`,
    [SHIPPING_PENDING_TIMEOUT_HOURS, SHIPPING_TRANSIT_TIMEOUT_HOURS]
  );

  const triggeredAlerts = [];
  const nowMs = Date.now();
  for (const row of overdueRows) {
    const overdueMeta = getShippingOverdueMeta(row);
    if (!overdueMeta.isOverdue || !overdueMeta.alertType) continue;

    const notice = await get(
      `SELECT id, notify_count, last_notified_at, resolved_at
       FROM shipping_alert_notices
       WHERE shipping_order_id = ? AND alert_type = ?`,
      [row.id, overdueMeta.alertType]
    );

    let shouldNotify = false;
    let nextNotifyCount = 1;

    if (!notice) {
      await run(
        `INSERT INTO shipping_alert_notices
         (shipping_order_id, alert_type, first_notified_at, last_notified_at, resolved_at, notify_count, note)
         VALUES (?, ?, NOW(), NOW(), NULL, 1, ?)`,
        [row.id, overdueMeta.alertType, buildShippingAlertMessage(row, overdueMeta.alertType, overdueMeta.overtimeHours)]
      );
      shouldNotify = true;
      nextNotifyCount = 1;
    } else {
      const wasResolved = Boolean(notice.resolved_at);
      const lastNotifiedAt = parseDbDateValue(notice.last_notified_at);
      const hoursSinceLast = lastNotifiedAt ? (nowMs - lastNotifiedAt.getTime()) / 3600000 : Infinity;
      const canRepeat = hoursSinceLast >= SHIPPING_ALERT_REPEAT_HOURS;
      if (wasResolved || canRepeat) {
        nextNotifyCount = Number(notice.notify_count || 0) + 1;
        await run(
          `UPDATE shipping_alert_notices
           SET last_notified_at = NOW(),
               resolved_at = NULL,
               notify_count = ?,
               note = ?
           WHERE id = ?`,
          [
            nextNotifyCount,
            buildShippingAlertMessage(row, overdueMeta.alertType, overdueMeta.overtimeHours),
            notice.id,
          ]
        );
        shouldNotify = true;
      }
    }

    if (shouldNotify) {
      const alertPayload = {
        shipping_order_id: Number(row.id),
        shipment_no: row.shipment_no,
        stock_out_order_id: Number(row.stock_out_order_id),
        stock_out_order_no: row.stock_out_order_no,
        carrier: row.carrier,
        tracking_no: row.tracking_no,
        receiver_name: row.receiver_name,
        receiver_phone: row.receiver_phone,
        receiver_address: row.receiver_address,
        status: row.status,
        shipped_at: row.shipped_at,
        created_at: row.created_at,
        alert_type: overdueMeta.alertType,
        overtime_hours: overdueMeta.overtimeHours,
        threshold_hours:
          overdueMeta.alertType === SHIPPING_ALERT_TYPES.PENDING_TIMEOUT
            ? SHIPPING_PENDING_TIMEOUT_HOURS
            : SHIPPING_TRANSIT_TIMEOUT_HOURS,
        alert_message: buildShippingAlertMessage(row, overdueMeta.alertType, overdueMeta.overtimeHours),
        notify_count: nextNotifyCount,
      };
      triggeredAlerts.push(alertPayload);
      await Promise.all([persistReminderAlert(alertPayload), pushReminderWebhook(alertPayload)]);
    }
  }

  await run(
    `UPDATE shipping_alert_notices n
     JOIN shipping_orders s ON s.id = n.shipping_order_id
     SET n.resolved_at = NOW()
     WHERE n.resolved_at IS NULL
       AND (
         (n.alert_type = ? AND NOT (s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ?))
         OR
         (n.alert_type = ? AND NOT (s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?))
       )`,
    [
      SHIPPING_ALERT_TYPES.PENDING_TIMEOUT,
      SHIPPING_PENDING_TIMEOUT_HOURS,
      SHIPPING_ALERT_TYPES.TRANSIT_TIMEOUT,
      SHIPPING_TRANSIT_TIMEOUT_HOURS,
    ]
  );

  return {
    triggeredCount: triggeredAlerts.length,
    triggeredAlerts,
  };
};

const buildOrderNo = (prefix) => {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(
    d.getSeconds()
  ).padStart(2, '0')}`;
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `${prefix}${stamp}${rand}`;
};

const buildDateStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(
    2,
    '0'
  )}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(
    2,
    '0'
  )}`;
};

const escapeCsvCell = (value) => {
  let text = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (/^[\t ]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  const escaped = text.replace(/"/g, '""');
  return `"${escaped}"`;
};

const buildOperationLogFilter = (queryParams) => {
  const where = [];
  const params = [];

  const username = trimText(queryParams.username);
  const action = trimText(queryParams.action);
  const entity = trimText(queryParams.entity);
  const keyword = trimText(queryParams.keyword);
  const dateFrom = trimText(queryParams.from);
  const dateTo = trimText(queryParams.to);

  if (username) {
    where.push('username LIKE ?');
    params.push(`%${username}%`);
  }
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (entity) {
    where.push('entity = ?');
    params.push(entity);
  }
  if (keyword) {
    where.push('(message LIKE ? OR entity_id LIKE ? OR before_data LIKE ? OR after_data LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (dateFrom) {
    where.push(`created_at >= CONCAT(?, ' 00:00:00')`);
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push(`created_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)`);
    params.push(dateTo);
  }

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
};

const introspectToken = async (token) => {
  let resp;
  try {
    resp = await fetchWithTimeout(
      `${AUTH_SERVICE_URL}/api/auth/introspect`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
      AUTH_FETCH_TIMEOUT_MS
    );
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw appError('统一登录服务超时', 503);
    }
    throw appError('统一登录服务不可用', 503);
  }

  if (!resp.ok) {
    throw appError('登录已过期', 401);
  }

  let data;
  try {
    const rawText = await resp.text();
    if (rawText.length > 65536) {
      throw new Error('auth payload too large');
    }
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    throw appError('统一登录返回异常', 401);
  }

  const user = data?.user;
  const apps = Array.isArray(data?.apps) ? data.apps : [];
  if (!user || user.id === undefined || !user.username) {
    throw appError('登录状态无效', 401);
  }

  if (AUTH_SYSTEM_KEY && !apps.includes(AUTH_SYSTEM_KEY)) {
    throw appError('无权限访问库存管理系统', 403);
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      role: user.role || 'viewer',
    },
    apps,
  };
};

const extractBearerToken = (authorizationHeader) => {
  const header = trimText(authorizationHeader);
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? trimText(match[1]) : '';
};

const extractCookieToken = (cookieHeader) => {
  const raw = trimText(cookieHeader);
  if (!raw) return '';
  const pairs = raw.split(';');
  for (const item of pairs) {
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const key = trimText(item.slice(0, idx));
    if (key !== AUTH_COOKIE_NAME) continue;
    return trimText(decodeURIComponent(item.slice(idx + 1)));
  }
  return '';
};

const authRequired = asyncHandler(async (req, _res, next) => {
  if (req.path === '/api/health') return next();
  const token = extractBearerToken(req.headers.authorization) || extractCookieToken(req.headers.cookie);
  if (!token) {
    throw appError('未登录', 401);
  }
  if (token.length < 16 || token.length > 4096) {
    throw appError('登录凭证非法', 401);
  }

  const auth = await introspectToken(token);
  req.user = auth.user;
  req.apps = auth.apps;
  req.authToken = token;

  next();
});

const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(appError('无权限执行该操作', 403));
  }
  return next();
};
const requireInventoryEditor = requireRole('admin', 'sysadmin');
const requireInventoryOperator = requireRole('admin', 'sysadmin');
const requireAuditViewer = requireRole('auditor');

const ensureEntityExists = async (table, id, label) => {
  const row = await get(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!row) {
    throw appError(`${label}不存在`);
  }
};

const getActor = (req) => ({
  sub: String(req.user?.id ?? ''),
  name: String(req.user?.username || ''),
  role: String(req.user?.role || ''),
});

const applyBatchBalanceDeltaTx = async (
  tx,
  { productId, storageLocationId, batchNo, deltaIn = 0, deltaOut = 0, stockInOrderId = null, stockOutOrderId = null }
) => {
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  if (!normalizedBatchNo) return null;

  const row = await tx.get(
    `SELECT id, qty_in, qty_out, qty_balance
     FROM inventory_batch_balances
     WHERE product_id = ? AND storage_location_id = ? AND batch_no = ?
     FOR UPDATE`,
    [productId, storageLocationId, normalizedBatchNo]
  );

  const beforeIn = toNumber(row?.qty_in);
  const beforeOut = toNumber(row?.qty_out);
  const beforeBalance = toNumber(row?.qty_balance);
  const nextIn = Number((beforeIn + toNumber(deltaIn)).toFixed(3));
  const nextOut = Number((beforeOut + toNumber(deltaOut)).toFixed(3));
  const nextBalance = Number((beforeBalance + toNumber(deltaIn) - toNumber(deltaOut)).toFixed(3));
  if (nextBalance < -0.0005) {
    throw appError(`批次库存不足（批次:${normalizedBatchNo}，商品ID:${productId}，存放位置ID:${storageLocationId}）`);
  }

  if (row) {
    await tx.run(
      `UPDATE inventory_batch_balances
       SET qty_in = ?,
           qty_out = ?,
           qty_balance = ?,
           last_stock_in_order_id = COALESCE(?, last_stock_in_order_id),
           last_stock_out_order_id = COALESCE(?, last_stock_out_order_id)
       WHERE id = ?`,
      [nextIn, nextOut, Math.max(0, nextBalance), stockInOrderId, stockOutOrderId, row.id]
    );
  } else {
    await tx.run(
      `INSERT INTO inventory_batch_balances
       (product_id, storage_location_id, batch_no, qty_in, qty_out, qty_balance, last_stock_in_order_id, last_stock_out_order_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        storageLocationId,
        normalizedBatchNo,
        Math.max(0, nextIn),
        Math.max(0, nextOut),
        Math.max(0, nextBalance),
        stockInOrderId,
        stockOutOrderId,
      ]
    );
  }

  return {
    batch_no: normalizedBatchNo,
    qty_in: Math.max(0, nextIn),
    qty_out: Math.max(0, nextOut),
    qty_balance: Math.max(0, nextBalance),
  };
};

const upsertSerialInTx = async (
  tx,
  { serialNo, productId, storageLocationId, batchNo, stockInOrderId = null, stockInItemId = null, remark = '' }
) => {
  const normalizedSerialNo = normalizeSerialNo(serialNo);
  if (!normalizedSerialNo) throw appError('序列号不能为空');
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  const existed = await tx.get(
    `SELECT id, serial_no, product_id, storage_location_id, batch_no, status
     FROM inventory_serial_numbers
     WHERE serial_no = ?
     FOR UPDATE`,
    [normalizedSerialNo]
  );

  if (existed) {
    if (trimText(existed.status).toUpperCase() === SERIAL_STATUS.IN_STOCK) {
      throw appError(`序列号已在库：${normalizedSerialNo}`);
    }
    if (toNumber(existed.product_id) && toNumber(existed.product_id) !== toNumber(productId)) {
      throw appError(`序列号已绑定其他商品：${normalizedSerialNo}`);
    }
    await tx.run(
      `UPDATE inventory_serial_numbers
       SET product_id = ?,
           storage_location_id = ?,
           batch_no = ?,
           status = ?,
           stock_in_order_id = ?,
           stock_in_item_id = ?,
           remark = ?
       WHERE id = ?`,
      [
        productId,
        storageLocationId,
        normalizedBatchNo,
        SERIAL_STATUS.IN_STOCK,
        stockInOrderId,
        stockInItemId,
        trimText(remark).slice(0, 255),
        existed.id,
      ]
    );
    return { id: toNumber(existed.id), serial_no: normalizedSerialNo, batch_no: normalizedBatchNo };
  }

  const inserted = await tx.run(
    `INSERT INTO inventory_serial_numbers
     (serial_no, product_id, storage_location_id, batch_no, status, stock_in_order_id, stock_in_item_id, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedSerialNo,
      productId,
      storageLocationId,
      normalizedBatchNo,
      SERIAL_STATUS.IN_STOCK,
      stockInOrderId,
      stockInItemId,
      trimText(remark).slice(0, 255),
    ]
  );
  return { id: toNumber(inserted.insertId), serial_no: normalizedSerialNo, batch_no: normalizedBatchNo };
};

const consumeSerialOutTx = async (
  tx,
  { serialNo, productId, storageLocationId, batchNo, stockOutOrderId = null, stockOutItemId = null, remark = '' }
) => {
  const normalizedSerialNo = normalizeSerialNo(serialNo);
  const normalizedBatchNo = normalizeBatchNo(batchNo);
  if (!normalizedSerialNo) throw appError('序列号不能为空');

  const row = await tx.get(
    `SELECT id, serial_no, product_id, storage_location_id, batch_no, status
     FROM inventory_serial_numbers
     WHERE serial_no = ?
     FOR UPDATE`,
    [normalizedSerialNo]
  );
  if (!row) throw appError(`序列号不存在：${normalizedSerialNo}`);
  if (trimText(row.status).toUpperCase() !== SERIAL_STATUS.IN_STOCK) {
    throw appError(`序列号不在库：${normalizedSerialNo}`);
  }
  if (toNumber(row.product_id) !== toNumber(productId)) {
    throw appError(`序列号商品不匹配：${normalizedSerialNo}`);
  }
  if (toNumber(row.storage_location_id) !== toNumber(storageLocationId)) {
    throw appError(`序列号库位不匹配：${normalizedSerialNo}`);
  }
  if (normalizedBatchNo && normalizeBatchNo(row.batch_no) !== normalizedBatchNo) {
    throw appError(`序列号批次不匹配：${normalizedSerialNo}`);
  }

  await tx.run(
    `UPDATE inventory_serial_numbers
     SET status = ?,
         storage_location_id = NULL,
         stock_out_order_id = ?,
         stock_out_item_id = ?,
         remark = ?
     WHERE id = ?`,
    [SERIAL_STATUS.OUT_STOCK, stockOutOrderId, stockOutItemId, trimText(remark).slice(0, 255), row.id]
  );

  return {
    id: toNumber(row.id),
    serial_no: normalizedSerialNo,
    batch_no: normalizeBatchNo(row.batch_no),
  };
};

const toJsonText = (value) => {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return JSON.stringify({ raw: String(value) });
  }
};

const getRequestIp = (req) => {
  return trimText(req.ip) || trimText(req.socket?.remoteAddress) || '';
};

const buildOperationLogPayload = ({
  user,
  action,
  entity,
  entityId,
  message,
  beforeData,
  afterData,
  requestIp,
}) => {
  const userIdNum = Number(user?.id);
  return [
    Number.isInteger(userIdNum) && userIdNum > 0 ? userIdNum : null,
    trimText(user?.id),
    trimText(user?.username),
    trimText(user?.role),
    trimText(action),
    trimText(entity),
    trimText(entityId),
    trimText(message),
    toJsonText(beforeData),
    toJsonText(afterData),
    trimText(requestIp),
  ];
};

const writeOperationLog = async (payload) => {
  try {
    await run(
      `INSERT INTO operation_logs
       (user_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      buildOperationLogPayload(payload)
    );
  } catch (err) {
    console.warn('[inventory-audit] write failed', err?.message || err);
  }
};

const writeOperationLogTx = async (tx, payload) => {
  try {
    await tx.run(
      `INSERT INTO operation_logs
       (user_id, user_sub, username, user_role, action, entity, entity_id, message, before_data, after_data, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      buildOperationLogPayload(payload)
    );
  } catch (err) {
    console.warn('[inventory-audit] write failed', err?.message || err);
  }
};

app.use('/api', apiRateLimiter);
app.use(authRequired);

app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, service: 'inventory', ts: new Date().toISOString() });
  })
);

app.get(
  '/api/auth/me',
  asyncHandler(async (req, res) => {
    res.json({ ...req.user, apps: req.apps || [] });
  })
);

app.get(
  '/api/dashboard/summary',
  asyncHandler(async (_req, res) => {
    const [productAgg, storageAgg, usageAgg, balanceAgg, lowAgg] = await Promise.all([
      get('SELECT COUNT(*) AS count FROM products WHERE is_active = 1'),
      get('SELECT COUNT(*) AS count FROM storage_locations WHERE is_active = 1'),
      get('SELECT COUNT(*) AS count FROM usage_locations WHERE is_active = 1'),
      get('SELECT COUNT(*) AS records, COALESCE(SUM(quantity), 0) AS total_qty FROM inventory_balances'),
      get(
        `SELECT COUNT(*) AS count
         FROM products p
         LEFT JOIN (
           SELECT product_id, COALESCE(SUM(quantity), 0) AS total_qty
           FROM inventory_balances
           GROUP BY product_id
         ) b ON b.product_id = p.id
         WHERE p.is_active = 1 AND COALESCE(b.total_qty, 0) < p.safety_stock`
      ),
    ]);

    res.json({
      productCount: Number(productAgg?.count || 0),
      storageLocationCount: Number(storageAgg?.count || 0),
      usageLocationCount: Number(usageAgg?.count || 0),
      balanceRecordCount: Number(balanceAgg?.records || 0),
      inventoryTotalQty: Number(balanceAgg?.total_qty || 0),
      lowStockCount: Number(lowAgg?.count || 0),
    });
  })
);

app.get(
  '/api/dashboard/insights',
  asyncHandler(async (req, res) => {
    const days = parseDashboardDays(req.query.days);
    const dayKeys = buildRecentDayKeys(days);
    const fromDay = dayKeys[0];

    const [
      productAgg,
      avgSafetyAgg,
      storageAgg,
      usageAgg,
      balanceAgg,
      lowAgg,
      movementRows,
      movementNetAgg,
      trendRows,
      trendNetRows,
      categoryRows,
      storageTopRows,
      storageHeatmapRows,
      usageTopRows,
      lowStockRows,
      stockInCount,
      stockOutCount,
      stocktakeCount,
    ] = await Promise.all([
      get('SELECT COUNT(*) AS count FROM products WHERE is_active = 1'),
      get('SELECT COALESCE(AVG(NULLIF(safety_stock, 0)), 0) AS avg_safety FROM products WHERE is_active = 1'),
      get('SELECT COUNT(*) AS count FROM storage_locations WHERE is_active = 1'),
      get('SELECT COUNT(*) AS count FROM usage_locations WHERE is_active = 1'),
      get('SELECT COUNT(*) AS records, COALESCE(SUM(quantity), 0) AS total_qty FROM inventory_balances'),
      get(
        `SELECT COUNT(*) AS count
         FROM products p
         LEFT JOIN (
           SELECT product_id, COALESCE(SUM(quantity), 0) AS total_qty
           FROM inventory_balances
           GROUP BY product_id
         ) b ON b.product_id = p.id
         WHERE p.is_active = 1 AND COALESCE(b.total_qty, 0) < p.safety_stock`
      ),
      query(
        `SELECT change_type, COALESCE(SUM(ABS(qty_change)), 0) AS total_qty
         FROM inventory_ledger
         WHERE occurred_at >= CONCAT(?, ' 00:00:00')
         GROUP BY change_type`,
        [fromDay]
      ),
      get(
        `SELECT COALESCE(SUM(qty_change), 0) AS net_qty
         FROM inventory_ledger
         WHERE occurred_at >= CONCAT(?, ' 00:00:00')`,
        [fromDay]
      ),
      query(
        `SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d') AS day_key,
                change_type,
                COALESCE(SUM(ABS(qty_change)), 0) AS qty
         FROM inventory_ledger
         WHERE occurred_at >= CONCAT(?, ' 00:00:00')
         GROUP BY DATE_FORMAT(occurred_at, '%Y-%m-%d'), change_type
         ORDER BY day_key ASC`,
        [fromDay]
      ),
      query(
        `SELECT DATE_FORMAT(occurred_at, '%Y-%m-%d') AS day_key,
                COALESCE(SUM(qty_change), 0) AS net_qty
         FROM inventory_ledger
         WHERE occurred_at >= CONCAT(?, ' 00:00:00')
         GROUP BY DATE_FORMAT(occurred_at, '%Y-%m-%d')
         ORDER BY day_key ASC`,
        [fromDay]
      ),
      query(
        `SELECT COALESCE(NULLIF(TRIM(p.category), ''), '未分类') AS category,
                COALESCE(SUM(b.quantity), 0) AS total_qty
         FROM products p
         LEFT JOIN inventory_balances b ON b.product_id = p.id
         WHERE p.is_active = 1
         GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), '未分类')
         HAVING total_qty > 0
         ORDER BY total_qty DESC
         LIMIT 8`
      ),
      query(
        `SELECT sl.id AS storage_location_id,
                sl.code,
                sl.name,
                COALESCE(SUM(b.quantity), 0) AS total_qty
         FROM storage_locations sl
         LEFT JOIN inventory_balances b ON b.storage_location_id = sl.id
         WHERE sl.is_active = 1
         GROUP BY sl.id, sl.code, sl.name
         HAVING total_qty > 0
         ORDER BY total_qty DESC, sl.code ASC
         LIMIT 10`
      ),
      query(
        `SELECT sl.id AS storage_location_id,
                sl.code,
                sl.name,
                COALESCE(sl.warehouse, '') AS warehouse,
                COALESCE(sl.area, '') AS area,
                COALESCE(SUM(b.quantity), 0) AS total_qty,
                COUNT(DISTINCT p.id) AS product_count,
                COALESCE(
                  SUM(
                    CASE
                      WHEN p.id IS NOT NULL AND COALESCE(pt.total_qty, 0) < p.safety_stock THEN 1
                      ELSE 0
                    END
                  ),
                  0
                ) AS low_product_count
         FROM storage_locations sl
         LEFT JOIN inventory_balances b ON b.storage_location_id = sl.id
         LEFT JOIN products p ON p.id = b.product_id AND p.is_active = 1
         LEFT JOIN (
           SELECT product_id, SUM(quantity) AS total_qty
           FROM inventory_balances
           GROUP BY product_id
         ) pt ON pt.product_id = p.id
         WHERE sl.is_active = 1
         GROUP BY sl.id, sl.code, sl.name, sl.warehouse, sl.area
         ORDER BY low_product_count DESC, total_qty DESC, sl.code ASC
         LIMIT 36`
      ),
      query(
        `SELECT ul.id AS usage_location_id,
                ul.code,
                ul.name,
                COALESCE(SUM(ABS(l.qty_change)), 0) AS total_out_qty
         FROM usage_locations ul
         LEFT JOIN inventory_ledger l
           ON l.usage_location_id = ul.id
          AND l.change_type = 'OUT'
          AND l.occurred_at >= CONCAT(?, ' 00:00:00')
         WHERE ul.is_active = 1
         GROUP BY ul.id, ul.code, ul.name
         HAVING total_out_qty > 0
         ORDER BY total_out_qty DESC, ul.code ASC
         LIMIT 10`,
        [fromDay]
      ),
      query(
        `SELECT p.id AS product_id,
                p.sku,
                p.name AS product_name,
                p.safety_stock,
                COALESCE(t.total_qty, 0) AS total_qty,
                (p.safety_stock - COALESCE(t.total_qty, 0)) AS gap_qty
         FROM products p
         LEFT JOIN (
           SELECT product_id, SUM(quantity) AS total_qty
           FROM inventory_balances
           GROUP BY product_id
         ) t ON t.product_id = p.id
         WHERE p.is_active = 1 AND COALESCE(t.total_qty, 0) < p.safety_stock
         ORDER BY gap_qty DESC, p.name ASC
         LIMIT 12`
      ),
      get(`SELECT COUNT(*) AS count FROM stock_in_orders WHERE created_at >= CONCAT(?, ' 00:00:00')`, [fromDay]),
      get(`SELECT COUNT(*) AS count FROM stock_out_orders WHERE created_at >= CONCAT(?, ' 00:00:00')`, [fromDay]),
      get(`SELECT COUNT(*) AS count FROM stocktake_orders WHERE created_at >= CONCAT(?, ' 00:00:00')`, [fromDay]),
    ]);

    const movementMap = movementRows.reduce((acc, row) => {
      acc[String(row.change_type || '').toUpperCase()] = toNumber(row.total_qty);
      return acc;
    }, {});

    const trendMap = new Map();
    trendRows.forEach((row) => {
      const dayKey = String(row.day_key || '');
      if (!dayKey) return;
      const item =
        trendMap.get(dayKey) ||
        {
          date: dayKey,
          in_qty: 0,
          out_qty: 0,
          adjust_qty: 0,
          net_qty: 0,
        };
      const qty = toNumber(row.qty);
      const type = String(row.change_type || '').toUpperCase();
      if (type === 'IN') item.in_qty += qty;
      if (type === 'OUT') item.out_qty += qty;
      if (type === 'ADJUST') item.adjust_qty += qty;
      trendMap.set(dayKey, item);
    });

    const netMap = new Map();
    trendNetRows.forEach((row) => {
      const dayKey = String(row.day_key || '');
      if (!dayKey) return;
      netMap.set(dayKey, toNumber(row.net_qty));
    });

    const trend = dayKeys.map((dayKey) => {
      const row = trendMap.get(dayKey) || {
        date: dayKey,
        in_qty: 0,
        out_qty: 0,
        adjust_qty: 0,
      };
      return {
        date: dayKey,
        in_qty: toNumber(row.in_qty),
        out_qty: toNumber(row.out_qty),
        adjust_qty: toNumber(row.adjust_qty),
        net_qty: toNumber(netMap.get(dayKey) || 0),
      };
    });

    const categoryTotal = categoryRows.reduce((sum, row) => sum + toNumber(row.total_qty), 0);
    const storageHeatmapMaxQty = Math.max(1, ...storageHeatmapRows.map((row) => toNumber(row.total_qty)));
    const storageHeatmap = storageHeatmapRows.map((row) => {
      const totalQty = toNumber(row.total_qty);
      const productCountAtLocation = toNumber(row.product_count);
      const lowProductCount = toNumber(row.low_product_count);
      const lowRatio = productCountAtLocation > 0 ? lowProductCount / productCountAtLocation : 0;
      const volumeRatio = totalQty / storageHeatmapMaxQty;
      const heatScore = Math.min(1, Math.max(0, Number((lowRatio * 0.72 + volumeRatio * 0.28).toFixed(3))));
      let heatLevel = 'normal';
      if (heatScore >= 0.7) heatLevel = 'high';
      else if (heatScore >= 0.45) heatLevel = 'medium';

      return {
        storage_location_id: toNumber(row.storage_location_id),
        code: row.code,
        name: row.name,
        warehouse: trimText(row.warehouse) || '未分仓',
        area: trimText(row.area) || '未分区',
        total_qty: totalQty,
        product_count: productCountAtLocation,
        low_product_count: lowProductCount,
        low_ratio: Number((lowRatio * 100).toFixed(1)),
        heat_score: heatScore,
        heat_level: heatLevel,
      };
    });

    const netSeries = trend.map((row) => toNumber(row.net_qty));
    const average = (list) => {
      if (!Array.isArray(list) || list.length === 0) return 0;
      return list.reduce((sum, value) => sum + toNumber(value), 0) / list.length;
    };
    const tail = (list, count) => list.slice(Math.max(0, list.length - count));
    const avgNet7 = average(tail(netSeries, Math.min(7, netSeries.length)));
    const avgNet30 = average(tail(netSeries, Math.min(30, netSeries.length)));
    const weightedDailyNet = Number((avgNet7 * 0.65 + avgNet30 * 0.35).toFixed(3));
    const avgSafety = Math.max(1, toNumber(avgSafetyAgg?.avg_safety));
    const baseLowStockCount = toNumber(lowAgg?.count);
    const productCount = Math.max(0, toNumber(productAgg?.count));
    let dailyWarningDelta = Number((((0 - weightedDailyNet) / avgSafety) * 0.08).toFixed(3));
    if (!Number.isFinite(dailyWarningDelta)) dailyWarningDelta = 0;
    dailyWarningDelta = Math.max(-2.5, Math.min(2.5, dailyWarningDelta));
    const clampForecast = (value) => Math.max(0, Math.min(productCount, Number(value.toFixed(1))));
    const forecastFor = (horizonDays) => clampForecast(baseLowStockCount + dailyWarningDelta * horizonDays);
    const predict7 = forecastFor(7);
    const predict30 = forecastFor(30);
    const forecastPoints = Array.from({ length: 31 }, (_item, dayOffset) => ({
      day_offset: dayOffset,
      low_stock_count: forecastFor(dayOffset),
    }));
    const volatilityRaw = average(netSeries.map((value) => Math.abs(value - average(netSeries))));
    const confidence = Number(
      Math.max(0.45, Math.min(0.92, 0.86 - (volatilityRaw / Math.max(Math.abs(weightedDailyNet) + 1, 1)) * 0.18)).toFixed(2)
    );
    const forecastDirection =
      dailyWarningDelta > 0.05 ? 'worse' : dailyWarningDelta < -0.05 ? 'improve' : 'flat';

    res.json({
      days,
      updatedAt: new Date().toISOString(),
      summary: {
        productCount: toNumber(productAgg?.count),
        storageLocationCount: toNumber(storageAgg?.count),
        usageLocationCount: toNumber(usageAgg?.count),
        balanceRecordCount: toNumber(balanceAgg?.records),
        inventoryTotalQty: toNumber(balanceAgg?.total_qty),
        lowStockCount: toNumber(lowAgg?.count),
      },
      metrics: {
        inQty: toNumber(movementMap.IN),
        outQty: toNumber(movementMap.OUT),
        adjustQty: toNumber(movementMap.ADJUST),
        netQty: toNumber(movementNetAgg?.net_qty),
        orderCount:
          toNumber(stockInCount?.count) + toNumber(stockOutCount?.count) + toNumber(stocktakeCount?.count),
      },
      trend,
      categoryDist: categoryRows.map((row) => ({
        category: row.category,
        total_qty: toNumber(row.total_qty),
        share: categoryTotal > 0 ? Number(((toNumber(row.total_qty) / categoryTotal) * 100).toFixed(2)) : 0,
      })),
      storageTop: storageTopRows.map((row) => ({
        storage_location_id: toNumber(row.storage_location_id),
        code: row.code,
        name: row.name,
        total_qty: toNumber(row.total_qty),
      })),
      usageTop: usageTopRows.map((row) => ({
        usage_location_id: toNumber(row.usage_location_id),
        code: row.code,
        name: row.name,
        total_out_qty: toNumber(row.total_out_qty),
      })),
      storageHeatmap,
      warningForecast: {
        baseLowStockCount,
        predict7,
        predict30,
        dailyWarningDelta,
        avgNet7: Number(avgNet7.toFixed(3)),
        avgNet30: Number(avgNet30.toFixed(3)),
        weightedDailyNet,
        confidence,
        direction: forecastDirection,
        points: forecastPoints,
      },
      lowStockTop: lowStockRows.map((row) => ({
        product_id: toNumber(row.product_id),
        sku: row.sku,
        product_name: row.product_name,
        safety_stock: toNumber(row.safety_stock),
        total_qty: toNumber(row.total_qty),
        gap_qty: toNumber(row.gap_qty),
      })),
    });
  })
);

app.get(
  '/api/options',
  asyncHandler(async (_req, res) => {
    const [products, storageLocations, usageLocations] = await Promise.all([
      query(
        `SELECT id, sku, name, unit, safety_stock
         FROM products
         WHERE is_active = 1
         ORDER BY name ASC`
      ),
      query(
        `SELECT id, code, name, warehouse, area, shelf, slot
         FROM storage_locations
         WHERE is_active = 1
         ORDER BY code ASC`
      ),
      query(
        `SELECT id, code, name, type
         FROM usage_locations
         WHERE is_active = 1
         ORDER BY code ASC`
      ),
    ]);

    res.json({ products, storageLocations, usageLocations });
  })
);

app.get(
  '/api/products',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const includeInactive = String(req.query.include_inactive || '') === '1';
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 500 });

    const where = [];
    const params = [];

    if (!includeInactive) {
      where.push('p.is_active = 1');
    }

    if (keyword) {
      where.push('(p.sku LIKE ? OR p.name LIKE ? OR p.category LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = paging ? await get(`SELECT COUNT(*) AS total FROM products p ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : '';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    }

    const rows = await query(
      `SELECT p.*,
              COALESCE(b.total_qty, 0) AS total_qty,
              CASE WHEN COALESCE(b.total_qty, 0) < p.safety_stock THEN 1 ELSE 0 END AS is_low_stock
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS total_qty
         FROM inventory_balances
         GROUP BY product_id
       ) b ON b.product_id = p.id
       ${whereSql}
       ORDER BY p.id DESC${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.post(
  '/api/products',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const sku = trimText(req.body?.sku);
    const name = trimText(req.body?.name);
    const category = trimText(req.body?.category);
    const unit = trimText(req.body?.unit, '件') || '件';
    const safetyStock = toNonNegativeDecimal(req.body?.safety_stock || 0, '安全库存');

    if (!sku) throw appError('SKU 不能为空');
    if (!name) throw appError('商品名称不能为空');

    const existing = await get('SELECT id FROM products WHERE sku = ?', [sku]);
    if (existing) throw appError('SKU 已存在');

    const result = await run(
      'INSERT INTO products (sku, name, category, unit, safety_stock, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [sku, name, category, unit, safetyStock]
    );

    const created = await get('SELECT * FROM products WHERE id = ?', [result.insertId]);
    await writeOperationLog({
      user: req.user,
      action: 'PRODUCT_CREATE',
      entity: 'product',
      entityId: created?.id || result.insertId,
      message: `创建商品 ${sku}`,
      afterData: created,
      requestIp,
    });
    res.status(201).json(created);
  })
);

app.put(
  '/api/products/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '商品ID');

    const current = await get('SELECT * FROM products WHERE id = ?', [id]);
    if (!current) throw appError('商品不存在', 404);

    const sku = trimText(req.body?.sku, current.sku);
    const name = trimText(req.body?.name, current.name);
    const category = trimText(req.body?.category, current.category);
    const unit = trimText(req.body?.unit, current.unit) || '件';
    const safetyStock =
      req.body?.safety_stock === undefined
        ? Number(current.safety_stock || 0)
        : toNonNegativeDecimal(req.body?.safety_stock, '安全库存');
    const isActive = req.body?.is_active === undefined ? Number(current.is_active) : Number(req.body.is_active ? 1 : 0);

    if (!sku) throw appError('SKU 不能为空');
    if (!name) throw appError('商品名称不能为空');

    const duplicate = await get('SELECT id FROM products WHERE sku = ? AND id <> ?', [sku, id]);
    if (duplicate) throw appError('SKU 已存在');

    await run(
      'UPDATE products SET sku = ?, name = ?, category = ?, unit = ?, safety_stock = ?, is_active = ? WHERE id = ?',
      [sku, name, category, unit, safetyStock, isActive, id]
    );

    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    await writeOperationLog({
      user: req.user,
      action: 'PRODUCT_UPDATE',
      entity: 'product',
      entityId: id,
      message: `更新商品 ${updated?.sku || current?.sku || id}`,
      beforeData: current,
      afterData: updated,
      requestIp,
    });
    res.json(updated);
  })
);

app.delete(
  '/api/products/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '商品ID');
    const current = await get('SELECT * FROM products WHERE id = ?', [id]);
    if (!current) throw appError('商品不存在', 404);

    try {
      await run('DELETE FROM products WHERE id = ?', [id]);
    } catch (err) {
      if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
        throw appError('该商品已关联库存/单据，不能删除');
      }
      throw err;
    }

    await writeOperationLog({
      user: req.user,
      action: 'PRODUCT_DELETE',
      entity: 'product',
      entityId: id,
      message: `删除商品 ${current?.sku || id}`,
      beforeData: current,
      requestIp,
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/storage-locations',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const includeInactive = String(req.query.include_inactive || '') === '1';
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 500 });

    const where = [];
    const params = [];

    if (!includeInactive) {
      where.push('is_active = 1');
    }

    if (keyword) {
      where.push('(code LIKE ? OR name LIKE ? OR warehouse LIKE ? OR area LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = paging ? await get(`SELECT COUNT(*) AS total FROM storage_locations ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : '';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    }
    const rows = await query(`SELECT * FROM storage_locations ${whereSql} ORDER BY id DESC${pagingSql}`, rowsParams);
    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.post(
  '/api/storage-locations',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const code = trimText(req.body?.code);
    const name = trimText(req.body?.name);
    const warehouse = trimText(req.body?.warehouse);
    const area = trimText(req.body?.area);
    const shelf = trimText(req.body?.shelf);
    const slot = trimText(req.body?.slot);
    const description = trimText(req.body?.description);

    if (!code) throw appError('存放位置编码不能为空');
    if (!name) throw appError('存放位置名称不能为空');

    const duplicate = await get('SELECT id FROM storage_locations WHERE code = ?', [code]);
    if (duplicate) throw appError('存放位置编码已存在');

    const result = await run(
      `INSERT INTO storage_locations
       (code, name, warehouse, area, shelf, slot, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [code, name, warehouse, area, shelf, slot, description]
    );

    const created = await get('SELECT * FROM storage_locations WHERE id = ?', [result.insertId]);
    await writeOperationLog({
      user: req.user,
      action: 'STORAGE_LOCATION_CREATE',
      entity: 'storage_location',
      entityId: created?.id || result.insertId,
      message: `创建存放位置 ${code}`,
      afterData: created,
      requestIp,
    });
    res.status(201).json(created);
  })
);

app.put(
  '/api/storage-locations/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '存放位置ID');

    const current = await get('SELECT * FROM storage_locations WHERE id = ?', [id]);
    if (!current) throw appError('存放位置不存在', 404);

    const code = trimText(req.body?.code, current.code);
    const name = trimText(req.body?.name, current.name);
    const warehouse = trimText(req.body?.warehouse, current.warehouse);
    const area = trimText(req.body?.area, current.area);
    const shelf = trimText(req.body?.shelf, current.shelf);
    const slot = trimText(req.body?.slot, current.slot);
    const description = trimText(req.body?.description, current.description);
    const isActive = req.body?.is_active === undefined ? Number(current.is_active) : Number(req.body.is_active ? 1 : 0);

    if (!code) throw appError('存放位置编码不能为空');
    if (!name) throw appError('存放位置名称不能为空');

    const duplicate = await get('SELECT id FROM storage_locations WHERE code = ? AND id <> ?', [code, id]);
    if (duplicate) throw appError('存放位置编码已存在');

    await run(
      `UPDATE storage_locations
       SET code = ?, name = ?, warehouse = ?, area = ?, shelf = ?, slot = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [code, name, warehouse, area, shelf, slot, description, isActive, id]
    );

    const updated = await get('SELECT * FROM storage_locations WHERE id = ?', [id]);
    await writeOperationLog({
      user: req.user,
      action: 'STORAGE_LOCATION_UPDATE',
      entity: 'storage_location',
      entityId: id,
      message: `更新存放位置 ${updated?.code || current?.code || id}`,
      beforeData: current,
      afterData: updated,
      requestIp,
    });
    res.json(updated);
  })
);

app.delete(
  '/api/storage-locations/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '存放位置ID');
    const current = await get('SELECT * FROM storage_locations WHERE id = ?', [id]);
    if (!current) throw appError('存放位置不存在', 404);

    try {
      await run('DELETE FROM storage_locations WHERE id = ?', [id]);
    } catch (err) {
      if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
        throw appError('该存放位置已被库存或单据使用，不能删除');
      }
      throw err;
    }

    await writeOperationLog({
      user: req.user,
      action: 'STORAGE_LOCATION_DELETE',
      entity: 'storage_location',
      entityId: id,
      message: `删除存放位置 ${current?.code || id}`,
      beforeData: current,
      requestIp,
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/usage-locations',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const includeInactive = String(req.query.include_inactive || '') === '1';
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 500 });

    const where = [];
    const params = [];

    if (!includeInactive) {
      where.push('is_active = 1');
    }

    if (keyword) {
      where.push('(code LIKE ? OR name LIKE ? OR type LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = paging ? await get(`SELECT COUNT(*) AS total FROM usage_locations ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : '';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    }
    const rows = await query(`SELECT * FROM usage_locations ${whereSql} ORDER BY id DESC${pagingSql}`, rowsParams);
    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.post(
  '/api/usage-locations',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const code = trimText(req.body?.code);
    const name = trimText(req.body?.name);
    const type = trimText(req.body?.type);
    const description = trimText(req.body?.description);

    if (!code) throw appError('使用位置编码不能为空');
    if (!name) throw appError('使用位置名称不能为空');

    const duplicate = await get('SELECT id FROM usage_locations WHERE code = ?', [code]);
    if (duplicate) throw appError('使用位置编码已存在');

    const result = await run(
      'INSERT INTO usage_locations (code, name, type, description, is_active) VALUES (?, ?, ?, ?, 1)',
      [code, name, type, description]
    );

    const created = await get('SELECT * FROM usage_locations WHERE id = ?', [result.insertId]);
    await writeOperationLog({
      user: req.user,
      action: 'USAGE_LOCATION_CREATE',
      entity: 'usage_location',
      entityId: created?.id || result.insertId,
      message: `创建使用位置 ${code}`,
      afterData: created,
      requestIp,
    });
    res.status(201).json(created);
  })
);

app.put(
  '/api/usage-locations/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '使用位置ID');

    const current = await get('SELECT * FROM usage_locations WHERE id = ?', [id]);
    if (!current) throw appError('使用位置不存在', 404);

    const code = trimText(req.body?.code, current.code);
    const name = trimText(req.body?.name, current.name);
    const type = trimText(req.body?.type, current.type);
    const description = trimText(req.body?.description, current.description);
    const isActive = req.body?.is_active === undefined ? Number(current.is_active) : Number(req.body.is_active ? 1 : 0);

    if (!code) throw appError('使用位置编码不能为空');
    if (!name) throw appError('使用位置名称不能为空');

    const duplicate = await get('SELECT id FROM usage_locations WHERE code = ? AND id <> ?', [code, id]);
    if (duplicate) throw appError('使用位置编码已存在');

    await run('UPDATE usage_locations SET code = ?, name = ?, type = ?, description = ?, is_active = ? WHERE id = ?', [
      code,
      name,
      type,
      description,
      isActive,
      id,
    ]);

    const updated = await get('SELECT * FROM usage_locations WHERE id = ?', [id]);
    await writeOperationLog({
      user: req.user,
      action: 'USAGE_LOCATION_UPDATE',
      entity: 'usage_location',
      entityId: id,
      message: `更新使用位置 ${updated?.code || current?.code || id}`,
      beforeData: current,
      afterData: updated,
      requestIp,
    });
    res.json(updated);
  })
);

app.delete(
  '/api/usage-locations/:id',
  requireInventoryEditor,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const id = toIntId(req.params.id, '使用位置ID');
    const current = await get('SELECT * FROM usage_locations WHERE id = ?', [id]);
    if (!current) throw appError('使用位置不存在', 404);

    try {
      await run('DELETE FROM usage_locations WHERE id = ?', [id]);
    } catch (err) {
      if (err?.code === 'ER_ROW_IS_REFERENCED_2') {
        throw appError('该使用位置已被出库或流水使用，不能删除');
      }
      throw err;
    }

    await writeOperationLog({
      user: req.user,
      action: 'USAGE_LOCATION_DELETE',
      entity: 'usage_location',
      entityId: id,
      message: `删除使用位置 ${current?.code || id}`,
      beforeData: current,
      requestIp,
    });
    res.json({ ok: true });
  })
);

app.get(
  '/api/inventory/balances',
  asyncHandler(async (req, res) => {
    const keyword = trimText(req.query.keyword);
    const lowStockOnly = String(req.query.low_stock || '') === '1';
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 60, maxLimit: 500 });

    const where = [];
    const params = [];

    if (keyword) {
      where.push('(p.sku LIKE ? OR p.name LIKE ? OR sl.code LIKE ? OR sl.name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (lowStockOnly) {
      where.push('COALESCE(t.total_qty, 0) < p.safety_stock');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS total_qty
         FROM inventory_balances
         GROUP BY product_id
       ) t ON t.product_id = p.id
       LEFT JOIN inventory_balances b ON b.product_id = p.id
       LEFT JOIN storage_locations sl ON sl.id = b.storage_location_id`;
    const countRow = paging ? await get(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : '';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    }

    const rows = await query(
      `SELECT p.id AS product_id,
              p.sku,
              p.name AS product_name,
              p.category,
              p.unit,
              p.safety_stock,
              COALESCE(t.total_qty, 0) AS total_qty,
              CASE WHEN COALESCE(t.total_qty, 0) < p.safety_stock THEN 1 ELSE 0 END AS is_low_stock,
              b.storage_location_id,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name,
              COALESCE(b.quantity, 0) AS location_qty,
              b.updated_at
       ${fromSql}
       ${whereSql}
       ORDER BY is_low_stock DESC, p.name ASC, sl.code ASC${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.get(
  '/api/inventory/low-stock',
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT p.id AS product_id,
              p.sku,
              p.name AS product_name,
              p.unit,
              p.safety_stock,
              COALESCE(t.total_qty, 0) AS total_qty
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS total_qty
         FROM inventory_balances
         GROUP BY product_id
       ) t ON t.product_id = p.id
       WHERE p.is_active = 1 AND COALESCE(t.total_qty, 0) < p.safety_stock
       ORDER BY (p.safety_stock - COALESCE(t.total_qty, 0)) DESC, p.name ASC`
    );

    res.json(rows);
  })
);

app.get(
  '/api/inventory/ledger',
  asyncHandler(async (req, res) => {
    const where = [];
    const params = [];
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 80, maxLimit: 500 });

    const productId = trimText(req.query.product_id);
    const storageLocationId = trimText(req.query.storage_location_id);
    const changeType = trimText(req.query.change_type);
    const batchNo = normalizeBatchNo(req.query.batch_no);
    const serialNo = normalizeSerialNo(req.query.serial_no);
    const dateFrom = trimText(req.query.from);
    const dateTo = trimText(req.query.to);
    const limitRaw = Number(req.query.limit || 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;

    if (productId) {
      where.push('l.product_id = ?');
      params.push(toIntId(productId, '商品ID'));
    }

    if (storageLocationId) {
      where.push('l.storage_location_id = ?');
      params.push(toIntId(storageLocationId, '存放位置ID'));
    }

    if (changeType) {
      where.push('l.change_type = ?');
      params.push(changeType);
    }

    if (batchNo) {
      where.push('l.batch_no = ?');
      params.push(batchNo);
    }

    if (serialNo) {
      where.push('l.serial_no = ?');
      params.push(serialNo);
    }

    if (dateFrom) {
      where.push(`l.occurred_at >= CONCAT(?, ' 00:00:00')`);
      params.push(dateFrom);
    }

    if (dateTo) {
      where.push(`l.occurred_at < DATE_ADD(CONCAT(?, ' 00:00:00'), INTERVAL 1 DAY)`);
      params.push(dateTo);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = paging ? await get(`SELECT COUNT(*) AS total FROM inventory_ledger l ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : ' LIMIT ?';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    } else {
      rowsParams.push(limit);
    }

    const rows = await query(
      `SELECT l.*,
              p.sku,
              p.name AS product_name,
              p.unit,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name,
              ul.code AS usage_location_code,
              ul.name AS usage_location_name,
              COALESCE(l.operator_name, l.operator_sub, CAST(l.operator_id AS CHAR), '系统') AS operator_name
       FROM inventory_ledger l
       JOIN products p ON p.id = l.product_id
       JOIN storage_locations sl ON sl.id = l.storage_location_id
       LEFT JOIN usage_locations ul ON ul.id = l.usage_location_id
       ${whereSql}
       ORDER BY l.id DESC
       ${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.get(
  '/api/inventory/batch-balances',
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 300 });
    const productIdRaw = trimText(req.query.product_id);
    const storageLocationIdRaw = trimText(req.query.storage_location_id);
    const batchNo = normalizeBatchNo(req.query.batch_no);
    const keyword = trimText(req.query.keyword);

    const where = [];
    const params = [];

    if (productIdRaw) {
      where.push('b.product_id = ?');
      params.push(toIntId(productIdRaw, '商品ID'));
    }
    if (storageLocationIdRaw) {
      where.push('b.storage_location_id = ?');
      params.push(toIntId(storageLocationIdRaw, '存放位置ID'));
    }
    if (batchNo) {
      where.push('b.batch_no = ?');
      params.push(batchNo);
    }
    if (keyword) {
      where.push('(b.batch_no LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR sl.code LIKE ? OR sl.name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM inventory_batch_balances b
      JOIN products p ON p.id = b.product_id
      JOIN storage_locations sl ON sl.id = b.storage_location_id`;
    const countRow = paging ? await get(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params) : null;

    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : ' LIMIT 500';
    if (paging) rowsParams.push(paging.limit, paging.offset);

    const rows = await query(
      `SELECT b.id,
              b.product_id,
              b.storage_location_id,
              b.batch_no,
              b.qty_in,
              b.qty_out,
              b.qty_balance,
              b.last_stock_in_order_id,
              b.last_stock_out_order_id,
              b.created_at,
              b.updated_at,
              p.sku,
              p.name AS product_name,
              p.unit,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name
       ${fromSql}
       ${whereSql}
       ORDER BY b.updated_at DESC, b.id DESC${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(
      rows.map((row) => ({
        ...row,
        qty_in: toNumber(row.qty_in),
        qty_out: toNumber(row.qty_out),
        qty_balance: toNumber(row.qty_balance),
      }))
    );
  })
);

app.get(
  '/api/inventory/serial-numbers',
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 300 });
    const productIdRaw = trimText(req.query.product_id);
    const statusRaw = trimText(req.query.status).toUpperCase();
    const batchNo = normalizeBatchNo(req.query.batch_no);
    const serialNo = normalizeSerialNo(req.query.serial_no);
    const keyword = trimText(req.query.keyword);

    const where = [];
    const params = [];

    if (productIdRaw) {
      where.push('s.product_id = ?');
      params.push(toIntId(productIdRaw, '商品ID'));
    }
    if (statusRaw) {
      if (!Object.values(SERIAL_STATUS).includes(statusRaw)) {
        throw appError('序列号状态非法');
      }
      where.push('s.status = ?');
      params.push(statusRaw);
    }
    if (batchNo) {
      where.push('s.batch_no = ?');
      params.push(batchNo);
    }
    if (serialNo) {
      where.push('s.serial_no = ?');
      params.push(serialNo);
    }
    if (keyword) {
      where.push('(s.serial_no LIKE ? OR s.batch_no LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR sl.code LIKE ? OR sl.name LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM inventory_serial_numbers s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN storage_locations sl ON sl.id = s.storage_location_id
      LEFT JOIN stock_in_orders sio ON sio.id = s.stock_in_order_id
      LEFT JOIN stock_out_orders soo ON soo.id = s.stock_out_order_id`;
    const countRow = paging ? await get(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params) : null;

    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : ' LIMIT 500';
    if (paging) rowsParams.push(paging.limit, paging.offset);

    const rows = await query(
      `SELECT s.id,
              s.serial_no,
              s.product_id,
              s.storage_location_id,
              s.batch_no,
              s.status,
              s.stock_in_order_id,
              s.stock_in_item_id,
              s.stock_out_order_id,
              s.stock_out_item_id,
              s.remark,
              s.created_at,
              s.updated_at,
              p.sku,
              p.name AS product_name,
              p.unit,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name,
              sio.order_no AS stock_in_order_no,
              soo.order_no AS stock_out_order_no
       ${fromSql}
       ${whereSql}
       ORDER BY s.updated_at DESC, s.id DESC${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.get(
  '/api/inventory/serial-history',
  asyncHandler(async (req, res) => {
    const serialNo = normalizeSerialNo(req.query.serial_no);
    if (!serialNo) {
      throw appError('序列号不能为空');
    }

    const rows = await query(
      `SELECT l.id,
              l.change_type,
              l.qty_change,
              l.qty_before,
              l.qty_after,
              l.ref_type,
              l.ref_id,
              l.note,
              l.batch_no,
              l.serial_no,
              l.occurred_at,
              p.sku,
              p.name AS product_name,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name,
              ul.code AS usage_location_code,
              ul.name AS usage_location_name,
              COALESCE(l.operator_name, l.operator_sub, CAST(l.operator_id AS CHAR), '系统') AS operator_name
       FROM inventory_ledger l
       JOIN products p ON p.id = l.product_id
       JOIN storage_locations sl ON sl.id = l.storage_location_id
       LEFT JOIN usage_locations ul ON ul.id = l.usage_location_id
       WHERE l.serial_no = ?
       ORDER BY l.id DESC
       LIMIT 200`,
      [serialNo]
    );
    res.json(rows);
  })
);

app.get(
  '/api/operation-logs',
  requireAuditViewer,
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 200 });
    const { whereSql, params } = buildOperationLogFilter(req.query);
    const countRow = paging ? await get(`SELECT COUNT(*) AS total FROM operation_logs ${whereSql}`, params) : null;
    const rowsParams = [...params];
    const pagingSql = paging ? ' LIMIT ? OFFSET ?' : ' LIMIT 500';
    if (paging) {
      rowsParams.push(paging.limit, paging.offset);
    }

    const rows = await query(
      `SELECT id,
              user_id,
              user_sub,
              username,
              user_role,
              action,
              entity,
              entity_id,
              message,
              before_data,
              after_data,
              request_ip,
              created_at
       FROM operation_logs
       ${whereSql}
       ORDER BY id DESC${pagingSql}`,
      rowsParams
    );

    setPagingHeaders(res, paging, Number(countRow?.total || rows.length));
    res.json(rows);
  })
);

app.get(
  '/api/operation-logs/export.csv',
  requireAuditViewer,
  asyncHandler(async (req, res) => {
    const { whereSql, params } = buildOperationLogFilter(req.query);
    const maxRowsRaw = Number(req.query.max_rows || 10000);
    const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(Math.trunc(maxRowsRaw), 1), 20000) : 10000;

    const rows = await query(
      `SELECT id,
              user_id,
              user_sub,
              username,
              user_role,
              action,
              entity,
              entity_id,
              message,
              before_data,
              after_data,
              request_ip,
              created_at
       FROM operation_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, maxRows]
    );

    const headers = [
      'ID',
      '时间',
      '操作人',
      '角色',
      '动作',
      '实体',
      '实体ID',
      '描述',
      '请求IP',
      'Before',
      'After',
    ];

    const lines = [headers.map((item) => escapeCsvCell(item)).join(',')];
    rows.forEach((row) => {
      lines.push(
        [
          row.id,
          row.created_at,
          row.username,
          row.user_role,
          row.action,
          row.entity,
          row.entity_id,
          row.message,
          row.request_ip,
          row.before_data,
          row.after_data,
        ]
          .map((item) => escapeCsvCell(item))
          .join(',')
      );
    });

    const fileName = `inventory-operation-logs-${buildDateStamp()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(`\uFEFF${lines.join('\n')}`);
  })
);

app.get(
  '/api/inventory/stock-in-orders',
  asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;

    const rows = await query(
      `SELECT o.*,
              COALESCE(o.created_by_name, o.created_by_sub, CAST(o.created_by AS CHAR), '系统') AS creator_name,
              COALESCE(SUM(i.quantity), 0) AS total_qty,
              COUNT(i.id) AS item_count
       FROM stock_in_orders o
       LEFT JOIN stock_in_items i ON i.order_id = o.id
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT ?`,
      [limit]
    );

    res.json(rows);
  })
);

app.get(
  '/api/inventory/stock-in-orders/:id',
  asyncHandler(async (req, res) => {
    const orderId = toIntId(req.params.id, '入库单');
    const order = await get(
      `SELECT o.*,
              COALESCE(o.created_by_name, o.created_by_sub, CAST(o.created_by AS CHAR), '系统') AS creator_name,
              COALESCE(SUM(i.quantity), 0) AS total_qty,
              COUNT(i.id) AS item_count
       FROM stock_in_orders o
       LEFT JOIN stock_in_items i ON i.order_id = o.id
       WHERE o.id = ?
       GROUP BY o.id`,
      [orderId]
    );

    if (!order) {
      throw appError('入库单不存在', 404);
    }

    const items = await query(
      `SELECT i.id,
              i.order_id,
              i.product_id,
              i.storage_location_id,
              i.quantity,
              i.unit_cost,
              i.batch_no,
              i.serial_no,
              p.sku,
              p.name AS product_name,
              sl.code AS storage_code,
              sl.name AS storage_name
       FROM stock_in_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN storage_locations sl ON sl.id = i.storage_location_id
       WHERE i.order_id = ?
       ORDER BY i.id ASC`,
      [orderId]
    );

    res.json({
      ...order,
      total_qty: toNumber(order.total_qty),
      item_count: toNumber(order.item_count),
      items: items.map((row) => ({
        id: toNumber(row.id),
        order_id: toNumber(row.order_id),
        product_id: toNumber(row.product_id),
        storage_location_id: toNumber(row.storage_location_id),
        quantity: toNumber(row.quantity),
        unit_cost: toNumber(row.unit_cost),
        batch_no: trimText(row.batch_no),
        serial_no: trimText(row.serial_no),
        sku: row.sku,
        product_name: row.product_name,
        storage_code: row.storage_code,
        storage_name: row.storage_name,
      })),
    });
  })
);

app.get(
  '/api/inventory/stock-out-orders',
  asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;

    const rows = await query(
      `SELECT o.*,
              COALESCE(o.created_by_name, o.created_by_sub, CAST(o.created_by AS CHAR), '系统') AS creator_name,
              ul.code AS usage_location_code,
              ul.name AS usage_location_name,
              COALESCE(SUM(i.quantity), 0) AS total_qty,
              COUNT(i.id) AS item_count,
              COALESCE(ship.shipment_count, 0) AS shipment_count,
              COALESCE(ship.pending_count, 0) AS shipping_pending_count,
              COALESCE(ship.shipped_count, 0) AS shipping_shipped_count,
              COALESCE(ship.in_transit_count, 0) AS shipping_in_transit_count,
              COALESCE(ship.signed_count, 0) AS shipping_signed_count,
              COALESCE(ship.exception_count, 0) AS shipping_exception_count,
              COALESCE(ship.tracking_nos, '') AS shipping_tracking_nos,
              CASE
                WHEN COALESCE(ship.shipment_count, 0) = 0 THEN 'PENDING'
                WHEN COALESCE(ship.exception_count, 0) > 0 THEN 'EXCEPTION'
                WHEN COALESCE(ship.pending_count, 0) > 0 THEN 'PENDING'
                WHEN COALESCE(ship.signed_count, 0) >= COALESCE(ship.shipment_count, 0) THEN 'SIGNED'
                WHEN COALESCE(ship.in_transit_count, 0) > 0 THEN 'IN_TRANSIT'
                WHEN COALESCE(ship.shipped_count, 0) > 0 THEN 'SHIPPED'
                ELSE 'PENDING'
              END AS shipping_status
       FROM stock_out_orders o
       LEFT JOIN usage_locations ul ON ul.id = o.usage_location_id
       LEFT JOIN stock_out_items i ON i.order_id = o.id
       LEFT JOIN (
         SELECT so.stock_out_order_id,
                COUNT(*) AS shipment_count,
                SUM(CASE WHEN so.status = 'PENDING' THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN so.status = 'SHIPPED' THEN 1 ELSE 0 END) AS shipped_count,
                SUM(CASE WHEN so.status = 'IN_TRANSIT' THEN 1 ELSE 0 END) AS in_transit_count,
                SUM(CASE WHEN so.status = 'SIGNED' THEN 1 ELSE 0 END) AS signed_count,
                SUM(CASE WHEN so.status = 'EXCEPTION' THEN 1 ELSE 0 END) AS exception_count,
                GROUP_CONCAT(so.tracking_no ORDER BY so.id DESC SEPARATOR ' / ') AS tracking_nos
         FROM shipping_orders so
         GROUP BY so.stock_out_order_id
       ) ship ON ship.stock_out_order_id = o.id
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT ?`,
      [limit]
    );

    res.json(rows);
  })
);

app.get(
  '/api/inventory/shipping-orders/alerts',
  asyncHandler(async (_req, res) => {
    const syncResult = await syncShippingAlerts();

    const rows = await query(
      `SELECT s.id,
              s.shipment_no,
              s.stock_out_order_id,
              so.order_no AS stock_out_order_no,
              s.carrier,
              s.tracking_no,
              s.receiver_name,
              s.receiver_phone,
              s.receiver_address,
              s.status,
              s.shipped_at,
              s.created_at,
              s.updated_at,
              n.notify_count,
              n.first_notified_at,
              n.last_notified_at,
              n.resolved_at,
              n.note
       FROM shipping_orders s
       LEFT JOIN stock_out_orders so ON so.id = s.stock_out_order_id
       LEFT JOIN shipping_alert_notices n
         ON n.shipping_order_id = s.id
        AND n.alert_type = CASE
          WHEN s.status = 'PENDING' THEN ?
          ELSE ?
        END
       WHERE (s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ?)
          OR (s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?)
       ORDER BY s.updated_at DESC
       LIMIT 300`,
      [
        SHIPPING_ALERT_TYPES.PENDING_TIMEOUT,
        SHIPPING_ALERT_TYPES.TRANSIT_TIMEOUT,
        SHIPPING_PENDING_TIMEOUT_HOURS,
        SHIPPING_TRANSIT_TIMEOUT_HOURS,
      ]
    );

    let pendingOverdueCount = 0;
    let transitOverdueCount = 0;
    const mappedRows = rows.map((row) => {
      const overdueMeta = getShippingOverdueMeta(row);
      if (overdueMeta.pendingOverdue) pendingOverdueCount += 1;
      if (overdueMeta.transitOverdue) transitOverdueCount += 1;

      return {
        ...row,
        notify_count: Number(row.notify_count || 0),
        is_pending_overdue: overdueMeta.pendingOverdue ? 1 : 0,
        is_transit_overdue: overdueMeta.transitOverdue ? 1 : 0,
        is_overdue: overdueMeta.isOverdue ? 1 : 0,
        alert_type: overdueMeta.alertType,
        overtime_hours: overdueMeta.overtimeHours,
      };
    });

    const unresolvedAgg = await get(
      `SELECT COUNT(*) AS count
       FROM shipping_alert_notices
       WHERE resolved_at IS NULL`
    );

    res.json({
      summary: {
        pendingTimeoutHours: SHIPPING_PENDING_TIMEOUT_HOURS,
        transitTimeoutHours: SHIPPING_TRANSIT_TIMEOUT_HOURS,
        pendingOverdueCount,
        transitOverdueCount,
        totalOverdueCount: pendingOverdueCount + transitOverdueCount,
        unresolvedNoticeCount: Number(unresolvedAgg?.count || 0),
        triggeredCount: Number(syncResult?.triggeredCount || 0),
      },
      rows: mappedRows,
    });
  })
);

app.get(
  '/api/inventory/shipping-orders',
  asyncHandler(async (req, res) => {
    await syncShippingAlerts();

    const paging = parsePaging(req.query.page, req.query.limit, { defaultLimit: 50, maxLimit: 300 });
    const keyword = trimText(req.query.keyword);
    const statusRaw = trimText(req.query.status);
    const stockOutOrderIdRaw = trimText(req.query.stock_out_order_id);
    const overdueRaw = trimText(req.query.overdue).toLowerCase();

    const where = [];
    const params = [];

    if (keyword) {
      where.push('(s.shipment_no LIKE ? OR s.tracking_no LIKE ? OR so.order_no LIKE ? OR s.receiver_name LIKE ? OR s.carrier LIKE ?)');
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (statusRaw) {
      const status = normalizeShippingStatus(statusRaw);
      where.push('s.status = ?');
      params.push(status);
    }

    if (stockOutOrderIdRaw) {
      where.push('s.stock_out_order_id = ?');
      params.push(toIntId(stockOutOrderIdRaw, '出库单ID'));
    }

    if (overdueRaw === '1' || overdueRaw === 'any') {
      where.push(
        `((s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ?)
          OR (s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?))`
      );
      params.push(SHIPPING_PENDING_TIMEOUT_HOURS, SHIPPING_TRANSIT_TIMEOUT_HOURS);
    } else if (overdueRaw === 'pending') {
      where.push(`s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ?`);
      params.push(SHIPPING_PENDING_TIMEOUT_HOURS);
    } else if (overdueRaw === 'transit') {
      where.push(`s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?`);
      params.push(SHIPPING_TRANSIT_TIMEOUT_HOURS);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const fromSql = `FROM shipping_orders s
       LEFT JOIN stock_out_orders so ON so.id = s.stock_out_order_id
       LEFT JOIN usage_locations ul ON ul.id = so.usage_location_id
       LEFT JOIN (
         SELECT order_id, COUNT(*) AS item_count, COALESCE(SUM(quantity), 0) AS total_qty
         FROM stock_out_items
         GROUP BY order_id
       ) soi ON soi.order_id = s.stock_out_order_id`;

    const countRow = paging ? await get(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`, params) : null;
    const rowsParams = [
      SHIPPING_PENDING_TIMEOUT_HOURS,
      SHIPPING_TRANSIT_TIMEOUT_HOURS,
      ...params,
    ];
    let pagingSql = '';
    if (paging) {
      pagingSql = ' LIMIT ? OFFSET ?';
      rowsParams.push(paging.limit, paging.offset);
    }

    const rows = await query(
      `SELECT s.id,
              s.shipment_no,
              s.stock_out_order_id,
              so.order_no AS stock_out_order_no,
              so.usage_location_id,
              ul.code AS usage_location_code,
              ul.name AS usage_location_name,
              COALESCE(soi.item_count, 0) AS stock_out_item_count,
              COALESCE(soi.total_qty, 0) AS stock_out_total_qty,
              s.carrier,
              s.tracking_no,
              s.receiver_name,
              s.receiver_phone,
              s.receiver_address,
              s.shipped_at,
              s.status,
              s.remark,
              s.created_by_sub,
              s.created_by_name,
              s.created_by_role,
              COALESCE(s.created_by_name, s.created_by_sub, '系统') AS creator_name,
              s.created_at,
              s.updated_at,
              CASE WHEN s.status = 'PENDING' AND TIMESTAMPDIFF(HOUR, s.created_at, NOW()) >= ? THEN 1 ELSE 0 END AS is_pending_overdue,
              CASE
                WHEN s.status IN ('SHIPPED', 'IN_TRANSIT') AND s.shipped_at IS NOT NULL AND TIMESTAMPDIFF(HOUR, s.shipped_at, NOW()) >= ?
                  THEN 1
                ELSE 0
              END AS is_transit_overdue
       ${fromSql}
       ${whereSql}
       ORDER BY s.id DESC${pagingSql}`,
      rowsParams
    );

    const mappedRows = rows.map((row) => {
      const pendingOverdue = Number(row.is_pending_overdue || 0) === 1;
      const transitOverdue = Number(row.is_transit_overdue || 0) === 1;
      const overdueMeta = getShippingOverdueMeta(row);
      return {
        ...row,
        stock_out_item_count: Number(row.stock_out_item_count || 0),
        stock_out_total_qty: Number(row.stock_out_total_qty || 0),
        is_pending_overdue: pendingOverdue ? 1 : 0,
        is_transit_overdue: transitOverdue ? 1 : 0,
        is_overdue: pendingOverdue || transitOverdue ? 1 : 0,
        alert_type: overdueMeta.alertType,
        overtime_hours: overdueMeta.overtimeHours,
      };
    });

    setPagingHeaders(res, paging, Number(countRow?.total || mappedRows.length));
    res.json(mappedRows);
  })
);

app.get(
  '/api/inventory/shipping-orders/:id',
  asyncHandler(async (req, res) => {
    const shippingOrderId = toIntId(req.params.id, '发货单ID');
    const row = await get(
      `SELECT s.*,
              so.order_no AS stock_out_order_no,
              so.usage_location_id,
              ul.code AS usage_location_code,
              ul.name AS usage_location_name,
              COALESCE(s.created_by_name, s.created_by_sub, '系统') AS creator_name
       FROM shipping_orders s
       LEFT JOIN stock_out_orders so ON so.id = s.stock_out_order_id
       LEFT JOIN usage_locations ul ON ul.id = so.usage_location_id
       WHERE s.id = ?`,
      [shippingOrderId]
    );

    if (!row) {
      throw appError('发货单不存在', 404);
    }

    const stockOutItems = await query(
      `SELECT i.id,
              i.order_id,
              i.product_id,
              i.storage_location_id,
              i.quantity,
              i.batch_no,
              i.serial_no,
              p.sku,
              p.name AS product_name,
              p.unit,
              sl.code AS storage_location_code,
              sl.name AS storage_location_name
       FROM stock_out_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN storage_locations sl ON sl.id = i.storage_location_id
       WHERE i.order_id = ?
       ORDER BY i.id ASC`,
      [row.stock_out_order_id]
    );

    const notices = await query(
      `SELECT id, alert_type, first_notified_at, last_notified_at, resolved_at, notify_count, note
       FROM shipping_alert_notices
       WHERE shipping_order_id = ?
       ORDER BY id DESC`,
      [shippingOrderId]
    );
    const trackingEvents = await loadShippingTrackingEvents(shippingOrderId);

    const overdueMeta = getShippingOverdueMeta(row);
    res.json({
      ...row,
      is_pending_overdue: overdueMeta.pendingOverdue ? 1 : 0,
      is_transit_overdue: overdueMeta.transitOverdue ? 1 : 0,
      is_overdue: overdueMeta.isOverdue ? 1 : 0,
      alert_type: overdueMeta.alertType,
      overtime_hours: overdueMeta.overtimeHours,
      stock_out_items: stockOutItems,
      alert_notices: notices,
      tracking_events: trackingEvents,
    });
  })
);

app.get(
  '/api/inventory/shipping-orders/:id/tracking',
  asyncHandler(async (req, res) => {
    const shippingOrderId = toIntId(req.params.id, '发货单ID');
    const live = String(req.query.live || '') === '1';
    const shippingOrder = await get(
      `SELECT id,
              shipment_no,
              stock_out_order_id,
              carrier,
              tracking_no,
              receiver_name,
              receiver_phone,
              receiver_address,
              shipped_at,
              status,
              remark,
              created_at,
              updated_at
       FROM shipping_orders
       WHERE id = ?`,
      [shippingOrderId]
    );
    if (!shippingOrder) {
      throw appError('发货单不存在', 404);
    }

    let liveSync = {
      enabled: Boolean(SHIPPING_TRACKING_API_URL),
      fetched: 0,
      inserted: 0,
      events: [],
      error: '',
    };

    if (live) {
      liveSync = await syncExternalTrackingEvents(shippingOrder);
    }

    const events = await loadShippingTrackingEvents(shippingOrderId);
    res.json({
      order: shippingOrder,
      events,
      live_sync: {
        enabled: Boolean(liveSync.enabled),
        fetched: Number(liveSync.fetched || 0),
        inserted: Number(liveSync.inserted || 0),
        error: trimText(liveSync.error),
      },
    });
  })
);

app.post(
  '/api/inventory/shipping-orders/batch',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const stockOutOrderId = toIntId(req.body?.stock_out_order_id, '关联出库单');
    const shipments = Array.isArray(req.body?.shipments) ? req.body.shipments : [];
    const defaultReceiverName = trimText(req.body?.receiver_name);
    const defaultReceiverPhone = trimText(req.body?.receiver_phone);
    const defaultReceiverAddress = trimText(req.body?.receiver_address);
    const actor = getActor(req);

    if (!shipments.length) {
      throw appError('发货明细不能为空');
    }
    if (shipments.length > 50) {
      throw appError('单次最多创建50条发货记录');
    }

    const dedupTracking = new Set();
    const payloadShipments = shipments.map((item, index) => {
      const trackingNo = trimText(item?.tracking_no);
      if (!trackingNo) throw appError(`第${index + 1}行快递单号不能为空`);
      if (dedupTracking.has(trackingNo)) throw appError(`第${index + 1}行快递单号重复`);
      dedupTracking.add(trackingNo);

      const status = normalizeShippingStatus(item?.status, SHIPPING_STATUS.PENDING);
      let shippedAt = parseDateTimeToMysql(item?.shipped_at, `第${index + 1}行发货时间`);
      if (status !== SHIPPING_STATUS.PENDING && !shippedAt) {
        shippedAt = getNowMysqlDateTime();
      }
      if (status === SHIPPING_STATUS.PENDING) {
        shippedAt = null;
      }

      return {
        carrier: trimText(item?.carrier),
        trackingNo,
        receiverName: trimText(item?.receiver_name, defaultReceiverName),
        receiverPhone: trimText(item?.receiver_phone, defaultReceiverPhone),
        receiverAddress: trimText(item?.receiver_address, defaultReceiverAddress),
        shippedAt,
        status,
        remark: trimText(item?.remark),
      };
    });

    const result = await transaction(async (tx) => {
      const stockOutOrder = await tx.get(
        `SELECT id, order_no, usage_location_id, purpose, remark
         FROM stock_out_orders
         WHERE id = ?
         FOR UPDATE`,
        [stockOutOrderId]
      );
      if (!stockOutOrder) throw appError('关联出库单不存在', 404);

      const createdIds = [];
      for (const item of payloadShipments) {
        const duplicateTracking = await tx.get(`SELECT id FROM shipping_orders WHERE tracking_no = ?`, [item.trackingNo]);
        if (duplicateTracking) {
          throw appError(`快递单号已存在：${item.trackingNo}`);
        }

        const inserted = await tx.run(
          `INSERT INTO shipping_orders
           (shipment_no, stock_out_order_id, carrier, tracking_no, receiver_name, receiver_phone, receiver_address, shipped_at, status, remark, created_by_sub, created_by_name, created_by_role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            buildOrderNo('SHIP'),
            stockOutOrderId,
            item.carrier,
            item.trackingNo,
            item.receiverName,
            item.receiverPhone,
            item.receiverAddress,
            item.shippedAt,
            item.status,
            item.remark,
            actor.sub,
            actor.name,
            actor.role,
          ]
        );
        await insertShippingTrackingEvent(tx, {
          shipping_order_id: Number(inserted.insertId),
          event_time: item.shippedAt || getNowMysqlDateTime(),
          status: item.status,
          location: '',
          description: buildShippingTrackDescription(item.status, item.remark, { isCreate: true }),
          source: 'MANUAL',
        });
        createdIds.push(Number(inserted.insertId));
      }

      const placeholders = createdIds.map(() => '?').join(',');
      const createdRows =
        createdIds.length > 0
          ? await tx.query(
              `SELECT id, shipment_no, stock_out_order_id, carrier, tracking_no, receiver_name, receiver_phone, receiver_address, shipped_at, status, remark, created_at
               FROM shipping_orders
               WHERE id IN (${placeholders})
               ORDER BY id ASC`,
              createdIds
            )
          : [];

      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'SHIPPING_CREATE',
        entity: 'shipping_order',
        entityId: createdIds.join(','),
        message: `创建发货记录 ${createdIds.length} 条（出库单 ${stockOutOrder.order_no}）`,
        afterData: {
          stock_out_order_id: stockOutOrderId,
          stock_out_order_no: stockOutOrder.order_no,
          shipment_count: createdIds.length,
          shipments: createdRows,
        },
        requestIp,
      });

      return {
        stock_out_order_id: stockOutOrderId,
        stock_out_order_no: stockOutOrder.order_no,
        shipment_count: createdIds.length,
        shipments: createdRows,
      };
    });

    await syncShippingAlerts();
    res.status(201).json(result);
  })
);

app.put(
  '/api/inventory/shipping-orders/:id',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const shippingOrderId = toIntId(req.params.id, '发货单ID');
    const actor = getActor(req);

    const result = await transaction(async (tx) => {
      const current = await tx.get(`SELECT * FROM shipping_orders WHERE id = ? FOR UPDATE`, [shippingOrderId]);
      if (!current) throw appError('发货单不存在', 404);

      const status = req.body?.status === undefined ? current.status : normalizeShippingStatus(req.body?.status, current.status);
      const previousStatus = normalizeShippingStatus(current.status, SHIPPING_STATUS.PENDING);
      if (!canTransitionShippingStatus(previousStatus, status)) {
        throw appError(`发货状态流转非法：${previousStatus} -> ${status}`);
      }

      const carrier = req.body?.carrier === undefined ? trimText(current.carrier) : trimText(req.body?.carrier);
      const trackingNo = req.body?.tracking_no === undefined ? trimText(current.tracking_no) : trimText(req.body?.tracking_no);
      const receiverName =
        req.body?.receiver_name === undefined ? trimText(current.receiver_name) : trimText(req.body?.receiver_name);
      const receiverPhone =
        req.body?.receiver_phone === undefined ? trimText(current.receiver_phone) : trimText(req.body?.receiver_phone);
      const receiverAddress =
        req.body?.receiver_address === undefined
          ? trimText(current.receiver_address)
          : trimText(req.body?.receiver_address);
      const remark = req.body?.remark === undefined ? trimText(current.remark) : trimText(req.body?.remark);

      if (!trackingNo) throw appError('快递单号不能为空');

      const duplicateTracking = await tx.get(
        `SELECT id
         FROM shipping_orders
         WHERE tracking_no = ? AND id <> ?`,
        [trackingNo, shippingOrderId]
      );
      if (duplicateTracking) {
        throw appError(`快递单号已存在：${trackingNo}`);
      }

      const beforeShippedAt = trimText(current.shipped_at);
      let shippedAt = current.shipped_at;
      if (req.body?.shipped_at !== undefined) {
        shippedAt = parseDateTimeToMysql(req.body?.shipped_at, '发货时间');
      }
      if (status !== SHIPPING_STATUS.PENDING && !shippedAt) {
        shippedAt = getNowMysqlDateTime();
      }
      if (status === SHIPPING_STATUS.PENDING) {
        shippedAt = null;
      }
      const shouldAppendTrackEvent = previousStatus !== status || trimText(shippedAt) !== beforeShippedAt;

      await tx.run(
        `UPDATE shipping_orders
         SET carrier = ?,
             tracking_no = ?,
             receiver_name = ?,
             receiver_phone = ?,
             receiver_address = ?,
             shipped_at = ?,
             status = ?,
             remark = ?,
             created_by_sub = ?,
             created_by_name = ?,
             created_by_role = ?
         WHERE id = ?`,
        [
          carrier,
          trackingNo,
          receiverName,
          receiverPhone,
          receiverAddress,
          shippedAt,
          status,
          remark,
          actor.sub || current.created_by_sub,
          actor.name || current.created_by_name,
          actor.role || current.created_by_role,
          shippingOrderId,
        ]
      );

      const updated = await tx.get(`SELECT * FROM shipping_orders WHERE id = ?`, [shippingOrderId]);
      if (shouldAppendTrackEvent) {
        await insertShippingTrackingEvent(tx, {
          shipping_order_id: shippingOrderId,
          event_time: shippedAt || getNowMysqlDateTime(),
          status,
          location: trimText(req.body?.tracking_location),
          description: buildShippingTrackDescription(status, remark, { isCreate: false }),
          source: 'MANUAL',
        });
      }
      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'SHIPPING_UPDATE',
        entity: 'shipping_order',
        entityId: shippingOrderId,
        message: `更新发货单 ${updated?.shipment_no || shippingOrderId}`,
        beforeData: current,
        afterData: updated,
        requestIp,
      });
      return updated;
    });

    await syncShippingAlerts();
    const overdueMeta = getShippingOverdueMeta(result);
    res.json({
      ...result,
      is_pending_overdue: overdueMeta.pendingOverdue ? 1 : 0,
      is_transit_overdue: overdueMeta.transitOverdue ? 1 : 0,
      is_overdue: overdueMeta.isOverdue ? 1 : 0,
      alert_type: overdueMeta.alertType,
      overtime_hours: overdueMeta.overtimeHours,
    });
  })
);

app.get(
  '/api/inventory/stocktake-orders',
  asyncHandler(async (req, res) => {
    const limitRaw = Number(req.query.limit || 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 100;

    const rows = await query(
      `SELECT o.*,
              COALESCE(o.created_by_name, o.created_by_sub, CAST(o.created_by AS CHAR), '系统') AS creator_name,
              COUNT(i.id) AS item_count,
              COALESCE(SUM(i.diff_qty), 0) AS total_diff_qty
       FROM stocktake_orders o
       LEFT JOIN stocktake_items i ON i.order_id = o.id
       GROUP BY o.id
       ORDER BY o.id DESC
       LIMIT ?`,
      [limit]
    );

    res.json(rows);
  })
);

app.post(
  '/api/inventory/stock-in',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const supplier = trimText(req.body?.supplier);
    const remark = trimText(req.body?.remark);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) {
      throw appError('入库明细不能为空');
    }

    const actor = getActor(req);

    const payloadItems = items.map((item, index) => {
      const productId = toIntId(item.product_id, `第${index + 1}行商品`);
      const storageLocationId = toIntId(item.storage_location_id, `第${index + 1}行存放位置`);
      const quantity = toPositiveDecimal(item.quantity, `第${index + 1}行入库数量`);
      const unitCost = toNonNegativeDecimal(item.unit_cost || 0, `第${index + 1}行成本价`);
      const batchNo = normalizeBatchNo(item.batch_no);
      const serialNos = parseSerialNumbers(item.serial_nos ?? item.serial_no, `第${index + 1}行序列号`);
      if (serialNos.length) {
        if (Math.abs(quantity - Math.round(quantity)) > 0.0005) {
          throw appError(`第${index + 1}行序列号入库时，数量必须是整数`);
        }
        if (Math.round(quantity) !== serialNos.length) {
          throw appError(`第${index + 1}行数量与序列号个数不一致`);
        }
      }

      return {
        productId,
        storageLocationId,
        quantity,
        unitCost,
        batchNo,
        serialNos,
      };
    });

    const dedupSerialSet = new Set();
    payloadItems.forEach((item, index) => {
      item.serialNos.forEach((serialNo) => {
        const key = serialNo.toUpperCase();
        if (dedupSerialSet.has(key)) {
          throw appError(`序列号重复（第${index + 1}行）：${serialNo}`);
        }
        dedupSerialSet.add(key);
      });
    });

    const result = await transaction(async (tx) => {
      const orderNo = buildOrderNo('IN');
      const orderResult = await tx.run(
        `INSERT INTO stock_in_orders
         (order_no, supplier, remark, created_by, created_by_sub, created_by_name, created_by_role)
         VALUES (?, ?, ?, NULL, ?, ?, ?)`,
        [orderNo, supplier, remark, actor.sub, actor.name, actor.role]
      );
      const orderId = Number(orderResult.insertId);
      const totalQty = Number(payloadItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toFixed(3));

      for (const item of payloadItems) {
        await ensureEntityExists('products', item.productId, '商品');
        await ensureEntityExists('storage_locations', item.storageLocationId, '存放位置');

        const stockInItemResult = await tx.run(
          `INSERT INTO stock_in_items
           (order_id, product_id, storage_location_id, quantity, unit_cost, batch_no, serial_no)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.productId,
            item.storageLocationId,
            item.quantity,
            item.unitCost,
            item.batchNo,
            compactSerialPreview(item.serialNos, 3).slice(0, 128),
          ]
        );
        const stockInItemId = Number(stockInItemResult?.insertId || 0);

        const balanceRow = await tx.get(
          `SELECT quantity
           FROM inventory_balances
           WHERE product_id = ? AND storage_location_id = ?
           FOR UPDATE`,
          [item.productId, item.storageLocationId]
        );

        const beforeQty = Number(balanceRow?.quantity || 0);
        const afterQty = Number((beforeQty + item.quantity).toFixed(3));

        if (balanceRow) {
          await tx.run(
            `UPDATE inventory_balances
             SET quantity = ?
             WHERE product_id = ? AND storage_location_id = ?`,
            [afterQty, item.productId, item.storageLocationId]
          );
        } else {
          await tx.run(
            `INSERT INTO inventory_balances (product_id, storage_location_id, quantity)
             VALUES (?, ?, ?)`,
            [item.productId, item.storageLocationId, afterQty]
          );
        }

        if (item.batchNo) {
          await applyBatchBalanceDeltaTx(tx, {
            productId: item.productId,
            storageLocationId: item.storageLocationId,
            batchNo: item.batchNo,
            deltaIn: item.quantity,
            stockInOrderId: orderId,
          });
        }

        if (item.serialNos.length) {
          let runningBefore = beforeQty;
          for (const serialNo of item.serialNos) {
            await upsertSerialInTx(tx, {
              serialNo,
              productId: item.productId,
              storageLocationId: item.storageLocationId,
              batchNo: item.batchNo,
              stockInOrderId: orderId,
              stockInItemId,
              remark: remark || orderNo,
            });
            const runningAfter = Number((runningBefore + 1).toFixed(3));
            await tx.run(
              `INSERT INTO inventory_ledger
               (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, batch_no, serial_no, note)
               VALUES (?, ?, NULL, 'IN', ?, ?, ?, 'STOCK_IN', ?, NULL, ?, ?, ?, ?, ?, ?)`,
              [
                item.productId,
                item.storageLocationId,
                1,
                runningBefore,
                runningAfter,
                orderId,
                actor.sub,
                actor.name,
                actor.role,
                item.batchNo,
                serialNo,
                remark || `SN入库 ${serialNo}`,
              ]
            );
            runningBefore = runningAfter;
          }
        } else {
          await tx.run(
            `INSERT INTO inventory_ledger
             (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, batch_no, serial_no, note)
             VALUES (?, ?, NULL, 'IN', ?, ?, ?, 'STOCK_IN', ?, NULL, ?, ?, ?, ?, '', ?)`,
            [
              item.productId,
              item.storageLocationId,
              item.quantity,
              beforeQty,
              afterQty,
              orderId,
              actor.sub,
              actor.name,
              actor.role,
              item.batchNo,
              remark || null,
            ]
          );
        }
      }

      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'STOCK_IN_CREATE',
        entity: 'stock_in_order',
        entityId: orderId,
        message: `创建入库单 ${orderNo}`,
        afterData: {
          order_no: orderNo,
          supplier,
          remark,
          item_count: payloadItems.length,
          total_qty: totalQty,
          items: payloadItems.map((item) => ({
            product_id: item.productId,
            storage_location_id: item.storageLocationId,
            quantity: item.quantity,
            unit_cost: item.unitCost,
            batch_no: item.batchNo,
            serial_count: item.serialNos.length,
            serial_preview: compactSerialPreview(item.serialNos, 6),
          })),
        },
        requestIp,
      });

      return { orderId, orderNo };
    });

    res.status(201).json(result);
  })
);

app.put(
  '/api/inventory/stock-in-orders/:id',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const orderId = toIntId(req.params.id, '入库单');
    const requestIp = getRequestIp(req);
    const supplier = trimText(req.body?.supplier);
    const remark = trimText(req.body?.remark);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) {
      throw appError('入库明细不能为空');
    }

    const actor = getActor(req);

    const payloadItems = items.map((item, index) => {
      const productId = toIntId(item.product_id, `第${index + 1}行商品`);
      const storageLocationId = toIntId(item.storage_location_id, `第${index + 1}行存放位置`);
      const quantity = toPositiveDecimal(item.quantity, `第${index + 1}行入库数量`);
      const unitCost = toNonNegativeDecimal(item.unit_cost || 0, `第${index + 1}行成本价`);
      const batchNo = normalizeBatchNo(item.batch_no);
      const serialNos = parseSerialNumbers(item.serial_nos ?? item.serial_no, `第${index + 1}行序列号`);
      return {
        productId,
        storageLocationId,
        quantity,
        unitCost,
        batchNo,
        serialNos,
      };
    });

    for (const item of payloadItems) {
      await ensureEntityExists('products', item.productId, '商品');
      await ensureEntityExists('storage_locations', item.storageLocationId, '存放位置');
    }

    const buildQtyMap = (rows, productKey, storageKey, qtyKey) => {
      const map = new Map();
      rows.forEach((row) => {
        const productId = toNumber(row[productKey]);
        const storageLocationId = toNumber(row[storageKey]);
        const qty = toNumber(row[qtyKey]);
        if (!productId || !storageLocationId) return;
        const mapKey = `${productId}:${storageLocationId}`;
        const current = map.get(mapKey) || { productId, storageLocationId, quantity: 0 };
        current.quantity = Number((current.quantity + qty).toFixed(3));
        map.set(mapKey, current);
      });
      return map;
    };

    const result = await transaction(async (tx) => {
      const orderRow = await tx.get(
        `SELECT id, order_no, supplier, remark
         FROM stock_in_orders
         WHERE id = ?
         FOR UPDATE`,
        [orderId]
      );
      if (!orderRow) {
        throw appError('入库单不存在', 404);
      }

      const oldItems = await tx.query(
        `SELECT id, product_id, storage_location_id, quantity, unit_cost, batch_no, serial_no
         FROM stock_in_items
         WHERE order_id = ?
         ORDER BY id ASC`,
        [orderId]
      );

      const hasTraceabilityInOld = oldItems.some((item) => normalizeBatchNo(item.batch_no) || normalizeSerialNo(item.serial_no));
      const hasTraceabilityInNew = payloadItems.some((item) => item.batchNo || item.serialNos.length > 0);
      if (hasTraceabilityInOld || hasTraceabilityInNew) {
        throw appError('含批次/SN的入库单暂不支持编辑，请作废后重新入库');
      }

      const oldQtyMap = buildQtyMap(oldItems, 'product_id', 'storage_location_id', 'quantity');
      const newQtyMap = buildQtyMap(payloadItems, 'productId', 'storageLocationId', 'quantity');
      const allKeys = new Set([...oldQtyMap.keys(), ...newQtyMap.keys()]);

      for (const mapKey of allKeys) {
        const oldRow = oldQtyMap.get(mapKey) || null;
        const newRow = newQtyMap.get(mapKey) || null;
        const productId = toNumber(newRow?.productId || oldRow?.productId);
        const storageLocationId = toNumber(newRow?.storageLocationId || oldRow?.storageLocationId);
        const oldQty = toNumber(oldRow?.quantity);
        const newQty = toNumber(newRow?.quantity);
        const deltaQty = Number((newQty - oldQty).toFixed(3));
        if (Math.abs(deltaQty) < 0.0005) continue;

        const balanceRow = await tx.get(
          `SELECT quantity
           FROM inventory_balances
           WHERE product_id = ? AND storage_location_id = ?
           FOR UPDATE`,
          [productId, storageLocationId]
        );

        const beforeQty = toNumber(balanceRow?.quantity);
        const afterQtyRaw = Number((beforeQty + deltaQty).toFixed(3));
        if (afterQtyRaw < 0) {
          throw appError(`编辑后库存不足（商品ID:${productId}，存放位置ID:${storageLocationId}）`);
        }

        if (balanceRow) {
          await tx.run(
            `UPDATE inventory_balances
             SET quantity = ?
             WHERE product_id = ? AND storage_location_id = ?`,
            [afterQtyRaw, productId, storageLocationId]
          );
        } else {
          await tx.run(
            `INSERT INTO inventory_balances (product_id, storage_location_id, quantity)
             VALUES (?, ?, ?)`,
            [productId, storageLocationId, afterQtyRaw]
          );
        }

        await tx.run(
          `INSERT INTO inventory_ledger
           (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, batch_no, serial_no, note)
           VALUES (?, ?, NULL, 'ADJUST', ?, ?, ?, 'STOCK_IN_EDIT', ?, NULL, ?, ?, ?, '', '', ?)`,
          [
            productId,
            storageLocationId,
            deltaQty,
            beforeQty,
            afterQtyRaw,
            orderId,
            actor.sub,
            actor.name,
            actor.role,
            `编辑入库单 ${orderRow.order_no}`,
          ]
        );
      }

      await tx.run(
        `UPDATE stock_in_orders
         SET supplier = ?, remark = ?
         WHERE id = ?`,
        [supplier, remark, orderId]
      );

      await tx.run(`DELETE FROM stock_in_items WHERE order_id = ?`, [orderId]);
      for (const item of payloadItems) {
        await tx.run(
          `INSERT INTO stock_in_items
           (order_id, product_id, storage_location_id, quantity, unit_cost, batch_no, serial_no)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [orderId, item.productId, item.storageLocationId, item.quantity, item.unitCost, item.batchNo, '']
        );
      }

      const beforeTotalQty = Number(oldItems.reduce((sum, item) => sum + toNumber(item.quantity), 0).toFixed(3));
      const afterTotalQty = Number(payloadItems.reduce((sum, item) => sum + toNumber(item.quantity), 0).toFixed(3));

      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'STOCK_IN_UPDATE',
        entity: 'stock_in_order',
        entityId: orderId,
        message: `编辑入库单 ${orderRow.order_no}`,
        beforeData: {
          order_no: orderRow.order_no,
          supplier: trimText(orderRow.supplier),
          remark: trimText(orderRow.remark),
          item_count: oldItems.length,
          total_qty: beforeTotalQty,
          items: oldItems.map((item) => ({
            product_id: toNumber(item.product_id),
            storage_location_id: toNumber(item.storage_location_id),
            quantity: toNumber(item.quantity),
            unit_cost: toNumber(item.unit_cost),
            batch_no: normalizeBatchNo(item.batch_no),
            serial_no: normalizeSerialNo(item.serial_no),
          })),
        },
        afterData: {
          order_no: orderRow.order_no,
          supplier,
          remark,
          item_count: payloadItems.length,
          total_qty: afterTotalQty,
          delta_total_qty: Number((afterTotalQty - beforeTotalQty).toFixed(3)),
          items: payloadItems.map((item) => ({
            product_id: item.productId,
            storage_location_id: item.storageLocationId,
            quantity: item.quantity,
            unit_cost: item.unitCost,
            batch_no: item.batchNo,
            serial_count: item.serialNos.length,
            serial_preview: compactSerialPreview(item.serialNos, 6),
          })),
        },
        requestIp,
      });

      return {
        orderId,
        orderNo: orderRow.order_no,
        totalQty: afterTotalQty,
        itemCount: payloadItems.length,
      };
    });

    res.json(result);
  })
);

app.post(
  '/api/inventory/stock-out',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const usageLocationId = toIntId(req.body?.usage_location_id, '使用位置');
    const purpose = trimText(req.body?.purpose);
    const remark = trimText(req.body?.remark);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) {
      throw appError('出库明细不能为空');
    }

    const actor = getActor(req);

    const payloadItems = items.map((item, index) => {
      const productId = toIntId(item.product_id, `第${index + 1}行商品`);
      const storageLocationId = toIntId(item.storage_location_id, `第${index + 1}行存放位置`);
      const quantity = toPositiveDecimal(item.quantity, `第${index + 1}行出库数量`);
      const batchNo = normalizeBatchNo(item.batch_no);
      const serialNos = parseSerialNumbers(item.serial_nos ?? item.serial_no, `第${index + 1}行序列号`);
      if (serialNos.length) {
        if (Math.abs(quantity - Math.round(quantity)) > 0.0005) {
          throw appError(`第${index + 1}行序列号出库时，数量必须是整数`);
        }
        if (Math.round(quantity) !== serialNos.length) {
          throw appError(`第${index + 1}行数量与序列号个数不一致`);
        }
      }

      return {
        productId,
        storageLocationId,
        quantity,
        batchNo,
        serialNos,
      };
    });

    const dedupSerialSet = new Set();
    payloadItems.forEach((item, index) => {
      item.serialNos.forEach((serialNo) => {
        const key = serialNo.toUpperCase();
        if (dedupSerialSet.has(key)) {
          throw appError(`序列号重复（第${index + 1}行）：${serialNo}`);
        }
        dedupSerialSet.add(key);
      });
    });

    const result = await transaction(async (tx) => {
      await ensureEntityExists('usage_locations', usageLocationId, '使用位置');

      const orderNo = buildOrderNo('OUT');
      const orderResult = await tx.run(
        `INSERT INTO stock_out_orders
         (order_no, usage_location_id, purpose, remark, created_by, created_by_sub, created_by_name, created_by_role)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        [orderNo, usageLocationId, purpose, remark, actor.sub, actor.name, actor.role]
      );
      const orderId = Number(orderResult.insertId);
      const totalQty = Number(payloadItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0).toFixed(3));

      for (const item of payloadItems) {
        await ensureEntityExists('products', item.productId, '商品');
        await ensureEntityExists('storage_locations', item.storageLocationId, '存放位置');

        const stockOutItemResult = await tx.run(
          `INSERT INTO stock_out_items
           (order_id, product_id, storage_location_id, quantity, batch_no, serial_no)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.productId,
            item.storageLocationId,
            item.quantity,
            item.batchNo,
            compactSerialPreview(item.serialNos, 3).slice(0, 128),
          ]
        );
        const stockOutItemId = Number(stockOutItemResult?.insertId || 0);

        const balanceRow = await tx.get(
          `SELECT quantity
           FROM inventory_balances
           WHERE product_id = ? AND storage_location_id = ?
           FOR UPDATE`,
          [item.productId, item.storageLocationId]
        );

        const beforeQty = Number(balanceRow?.quantity || 0);
        if (beforeQty < item.quantity) {
          throw appError(
            `商品ID ${item.productId} 在存放位置ID ${item.storageLocationId} 库存不足（当前 ${beforeQty}）`
          );
        }

        const afterQty = Number((beforeQty - item.quantity).toFixed(3));

        await tx.run(
          `UPDATE inventory_balances
           SET quantity = ?
           WHERE product_id = ? AND storage_location_id = ?`,
          [afterQty, item.productId, item.storageLocationId]
        );

        if (item.batchNo) {
          await applyBatchBalanceDeltaTx(tx, {
            productId: item.productId,
            storageLocationId: item.storageLocationId,
            batchNo: item.batchNo,
            deltaOut: item.quantity,
            stockOutOrderId: orderId,
          });
        }

        if (item.serialNos.length) {
          let runningBefore = beforeQty;
          const serialBatchCounter = new Map();
          for (const serialNo of item.serialNos) {
            const consumedSerial = await consumeSerialOutTx(tx, {
              serialNo,
              productId: item.productId,
              storageLocationId: item.storageLocationId,
              batchNo: item.batchNo,
              stockOutOrderId: orderId,
              stockOutItemId,
              remark: remark || purpose || orderNo,
            });
            const serialBatchNo = normalizeBatchNo(consumedSerial?.batch_no);
            if (!item.batchNo && serialBatchNo) {
              serialBatchCounter.set(serialBatchNo, (serialBatchCounter.get(serialBatchNo) || 0) + 1);
            }
            const runningAfter = Number((runningBefore - 1).toFixed(3));
            await tx.run(
              `INSERT INTO inventory_ledger
               (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, batch_no, serial_no, note)
               VALUES (?, ?, ?, 'OUT', ?, ?, ?, 'STOCK_OUT', ?, NULL, ?, ?, ?, ?, ?, ?)`,
              [
                item.productId,
                item.storageLocationId,
                usageLocationId,
                -1,
                runningBefore,
                runningAfter,
                orderId,
                actor.sub,
                actor.name,
                actor.role,
                item.batchNo,
                serialNo,
                remark || purpose || `SN出库 ${serialNo}`,
              ]
            );
            runningBefore = runningAfter;
          }
          if (!item.batchNo && serialBatchCounter.size) {
            for (const [serialBatchNo, count] of serialBatchCounter.entries()) {
              await applyBatchBalanceDeltaTx(tx, {
                productId: item.productId,
                storageLocationId: item.storageLocationId,
                batchNo: serialBatchNo,
                deltaOut: Number(count || 0),
                stockOutOrderId: orderId,
              });
            }
          }
        } else {
          await tx.run(
            `INSERT INTO inventory_ledger
             (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, batch_no, serial_no, note)
             VALUES (?, ?, ?, 'OUT', ?, ?, ?, 'STOCK_OUT', ?, NULL, ?, ?, ?, ?, '', ?)`,
            [
              item.productId,
              item.storageLocationId,
              usageLocationId,
              Number((0 - item.quantity).toFixed(3)),
              beforeQty,
              afterQty,
              orderId,
              actor.sub,
              actor.name,
              actor.role,
              item.batchNo,
              remark || purpose || null,
            ]
          );
        }
      }

      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'STOCK_OUT_CREATE',
        entity: 'stock_out_order',
        entityId: orderId,
        message: `创建出库单 ${orderNo}`,
        afterData: {
          order_no: orderNo,
          usage_location_id: usageLocationId,
          purpose,
          remark,
          item_count: payloadItems.length,
          total_qty: totalQty,
          items: payloadItems.map((item) => ({
            product_id: item.productId,
            storage_location_id: item.storageLocationId,
            quantity: item.quantity,
            batch_no: item.batchNo,
            serial_count: item.serialNos.length,
            serial_preview: compactSerialPreview(item.serialNos, 6),
          })),
        },
        requestIp,
      });

      return { orderId, orderNo };
    });

    res.status(201).json(result);
  })
);

app.post(
  '/api/inventory/stocktake',
  requireInventoryOperator,
  asyncHandler(async (req, res) => {
    const requestIp = getRequestIp(req);
    const remark = trimText(req.body?.remark);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!items.length) {
      throw appError('盘点明细不能为空');
    }

    const actor = getActor(req);

    const payloadItems = items.map((item, index) => {
      const productId = toIntId(item.product_id, `第${index + 1}行商品`);
      const storageLocationId = toIntId(item.storage_location_id, `第${index + 1}行存放位置`);
      const countedQty = toNonNegativeDecimal(item.counted_qty, `第${index + 1}行实盘数量`);

      return {
        productId,
        storageLocationId,
        countedQty,
      };
    });

    const result = await transaction(async (tx) => {
      const orderNo = buildOrderNo('TAKE');
      const orderResult = await tx.run(
        `INSERT INTO stocktake_orders
         (order_no, status, remark, created_by, created_by_sub, created_by_name, created_by_role, posted_at)
         VALUES (?, 'POSTED', ?, NULL, ?, ?, ?, NOW())`,
        [orderNo, remark, actor.sub, actor.name, actor.role]
      );
      const orderId = Number(orderResult.insertId);
      let adjustedCount = 0;
      let totalDiffQty = 0;

      for (const item of payloadItems) {
        await ensureEntityExists('products', item.productId, '商品');
        await ensureEntityExists('storage_locations', item.storageLocationId, '存放位置');

        const balanceRow = await tx.get(
          `SELECT quantity
           FROM inventory_balances
           WHERE product_id = ? AND storage_location_id = ?
           FOR UPDATE`,
          [item.productId, item.storageLocationId]
        );

        const systemQty = Number(balanceRow?.quantity || 0);
        const countedQty = item.countedQty;
        const diffQty = Number((countedQty - systemQty).toFixed(3));

        await tx.run(
          `INSERT INTO stocktake_items
           (order_id, product_id, storage_location_id, system_qty, counted_qty, diff_qty)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [orderId, item.productId, item.storageLocationId, systemQty, countedQty, diffQty]
        );

        if (balanceRow) {
          await tx.run(
            `UPDATE inventory_balances
             SET quantity = ?
             WHERE product_id = ? AND storage_location_id = ?`,
            [countedQty, item.productId, item.storageLocationId]
          );
        } else {
          await tx.run(
            `INSERT INTO inventory_balances (product_id, storage_location_id, quantity)
             VALUES (?, ?, ?)`,
            [item.productId, item.storageLocationId, countedQty]
          );
        }

        if (diffQty !== 0) {
          adjustedCount += 1;
          totalDiffQty = Number((totalDiffQty + diffQty).toFixed(3));
          await tx.run(
            `INSERT INTO inventory_ledger
             (product_id, storage_location_id, usage_location_id, change_type, qty_change, qty_before, qty_after, ref_type, ref_id, operator_id, operator_sub, operator_name, operator_role, note)
             VALUES (?, ?, NULL, 'ADJUST', ?, ?, ?, 'STOCKTAKE', ?, NULL, ?, ?, ?, ?)`,
            [
              item.productId,
              item.storageLocationId,
              diffQty,
              systemQty,
              countedQty,
              orderId,
              actor.sub,
              actor.name,
              actor.role,
              remark || null,
            ]
          );
        }
      }

      await writeOperationLogTx(tx, {
        user: req.user,
        action: 'STOCKTAKE_CREATE',
        entity: 'stocktake_order',
        entityId: orderId,
        message: `创建盘点单 ${orderNo}`,
        afterData: {
          order_no: orderNo,
          remark,
          item_count: payloadItems.length,
          adjusted_item_count: adjustedCount,
          total_diff_qty: totalDiffQty,
        },
        requestIp,
      });

      return { orderId, orderNo };
    });

    res.status(201).json(result);
  })
);

app.use((err, _req, res, _next) => {
  const statusCode = Number(err.statusCode || 500);
  const message = statusCode >= 500 ? '服务器内部错误' : err.message;

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({ error: message });
});

const start = async () => {
  await initDb();
  startShippingTrackingAutoSync();

  app.listen(PORT, () => {
    console.log(`Inventory API listening on :${PORT}`);
  });
};

start().catch((err) => {
  console.error('Failed to start inventory backend', err);
  process.exit(1);
});
