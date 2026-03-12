const normalizeOrigin = (value) => String(value || '').trim().replace(/\/+$/, '');

const parseOriginHostname = (value) => {
  const text = normalizeOrigin(value);
  if (!text) return '';
  try {
    return String(new URL(text).hostname || '').trim().toLowerCase();
  } catch {
    return '';
  }
};

const parseRequestHostname = (headers = {}) => {
  const forwardedHost = String(headers['x-forwarded-host'] || '').split(',')[0].trim();
  const hostHeader = forwardedHost || String(headers.host || '').split(',')[0].trim();
  if (!hostHeader) return '';
  try {
    return String(new URL(`http://${hostHeader}`).hostname || '').trim().toLowerCase();
  } catch {
    return '';
  }
};

const isOriginAllowedForRequest = ({ origin, headers = {}, allowedOrigins = [], defaultOrigins = [] } = {}) => {
  if (!origin) return true;
  const requestOrigin = normalizeOrigin(origin);
  const list = (Array.isArray(allowedOrigins) && allowedOrigins.length ? allowedOrigins : defaultOrigins)
    .map(normalizeOrigin)
    .filter(Boolean);
  if (list.includes(requestOrigin)) return true;

  const originHostname = parseOriginHostname(requestOrigin);
  const requestHostname = parseRequestHostname(headers);
  if (!originHostname || !requestHostname) return false;
  return originHostname === requestHostname;
};

module.exports = {
  isOriginAllowedForRequest,
  normalizeOrigin,
  parseOriginHostname,
  parseRequestHostname,
};
