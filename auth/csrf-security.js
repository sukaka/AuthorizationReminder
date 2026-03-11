const crypto = require('crypto');

const createCsrfToken = () => crypto.randomBytes(24).toString('hex');

const isCsrfTokenValid = ({ cookieToken, headerToken }) => {
  const cookie = String(cookieToken || '').trim();
  const header = String(headerToken || '').trim();
  if (!cookie || !header) return false;
  const left = Buffer.from(cookie);
  const right = Buffer.from(header);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

module.exports = {
  createCsrfToken,
  isCsrfTokenValid,
};
