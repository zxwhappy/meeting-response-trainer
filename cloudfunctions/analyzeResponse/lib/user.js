const crypto = require('crypto');

function anonymousUserKey(openId, salt) {
  if (!openId || !salt || salt.length < 16) {
    const error = new Error('USER_HASH_SALT must contain at least 16 characters');
    error.code = 'CONFIG_MISSING';
    error.recoverable = false;
    throw error;
  }
  return crypto.createHmac('sha256', salt).update(openId).digest('hex');
}

function stableDocumentId(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function chinaDate(nowMs = Date.now()) {
  return new Date(nowMs + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

module.exports = { anonymousUserKey, stableDocumentId, chinaDate };
