const crypto = require('node:crypto');


const createRuntimeTokenGuard = (runtimeToken) => {
  const expected = Buffer.from(String(runtimeToken || ''));
  return (req, res, next) => {
    const actual = Buffer.from(String(req.get('x-prompt-runtime-token') || ''));
    if (
      expected.length < 32
      || actual.length !== expected.length
      || !crypto.timingSafeEqual(actual, expected)
    ) {
      return res.status(401).json({ error: '运行时凭据无效' });
    }
    return next();
  };
};


module.exports = { createRuntimeTokenGuard };
