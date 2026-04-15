const crypto = require('crypto');

const SECRET_MASK = '******';

const createConfigSecretManager = ({ secretKey = '', serviceName = 'api' } = {}) => {
  const deriveKey = (secret) => crypto.createHash('sha256').update(secret).digest();

  const encryptValue = (value) => {
    if (value === undefined || value === null) return value;
    const text = String(value);
    if (!text) return text;
    if (!secretKey) return text;
    const iv = crypto.randomBytes(12);
    const key = deriveKey(secretKey);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, tag, enc]).toString('base64');
    return `enc:${payload}`;
  };

  const decryptValue = (value) => {
    if (value === undefined || value === null) return value;
    const text = String(value);
    if (!text.startsWith('enc:')) return text;
    if (!secretKey) {
      throw new Error('CONFIG_SECRET_KEY 未配置，无法解密');
    }
    const raw = Buffer.from(text.slice(4), 'base64');
    const iv = raw.slice(0, 12);
    const tag = raw.slice(12, 28);
    const data = raw.slice(28);
    const key = deriveKey(secretKey);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  };

  const applySecretUpdate = ({ incoming, existing }) => {
    if (incoming === undefined || incoming === null) return existing;
    const text = String(incoming).trim();
    if (!text || text === SECRET_MASK) return existing;
    if (!secretKey) {
      throw new Error('CONFIG_SECRET_KEY 未配置，无法安全保存密码');
    }
    return encryptValue(text);
  };

  const ensureEncrypted = (value) => {
    if (value === undefined || value === null) return value;
    const text = String(value);
    if (!text) return text;
    if (!secretKey) return text;
    if (text.startsWith('enc:')) return text;
    return encryptValue(text);
  };

  const maskSecrets = (configs) => {
    const cloned = JSON.parse(JSON.stringify(configs || {}));
    if (cloned.email?.pass) cloned.email.pass = SECRET_MASK;
    if (cloned.sms?.accessKeySecret) cloned.sms.accessKeySecret = SECRET_MASK;
    if (cloned.wecom?.secret) cloned.wecom.secret = SECRET_MASK;
    if (cloned.ocr?.accessKeySecret) cloned.ocr.accessKeySecret = SECRET_MASK;
    return cloned;
  };

  const decryptSecrets = (configs) => {
    if (!configs) return configs;
    const safeDecrypt = (value, fieldName) => {
      try {
        return decryptValue(value);
      } catch (_err) {
        console.warn(`[SECURITY][${serviceName}] 配置项 ${fieldName} 解密失败，已降级为空值，请重新保存该密钥。`);
        return '';
      }
    };
    if (configs.email?.pass) configs.email.pass = safeDecrypt(configs.email.pass, 'email.pass');
    if (configs.sms?.accessKeySecret) configs.sms.accessKeySecret = safeDecrypt(configs.sms.accessKeySecret, 'sms.accessKeySecret');
    if (configs.wecom?.secret) configs.wecom.secret = safeDecrypt(configs.wecom.secret, 'wecom.secret');
    if (configs.ocr?.accessKeySecret) configs.ocr.accessKeySecret = safeDecrypt(configs.ocr.accessKeySecret, 'ocr.accessKeySecret');
    return configs;
  };

  return {
    encryptValue,
    decryptValue,
    applySecretUpdate,
    ensureEncrypted,
    maskSecrets,
    decryptSecrets,
  };
};

module.exports = {
  SECRET_MASK,
  createConfigSecretManager,
};
