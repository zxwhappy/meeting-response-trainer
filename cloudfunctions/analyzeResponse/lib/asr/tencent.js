const crypto = require('crypto');
const https = require('https');

const CONTENT_TYPE = 'application/json; charset=utf-8';
const SERVICE = 'asr';
const VERSION = '2019-06-14';

function requireAsrConfig(env) {
  const missing = ['TC_SECRET_ID', 'TC_SECRET_KEY'].filter((key) => !env[key]);
  if (missing.length) {
    const error = new Error(`Missing ASR settings: ${missing.join(', ')}`);
    error.code = 'CONFIG_MISSING';
    error.recoverable = false;
    throw error;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function buildAuthorization({ secretId, secretKey, timestamp, host, action, payload }) {
  const requestDate = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = [
    `content-type:${CONTENT_TYPE}`,
    `host:${host}`,
    `x-tc-action:${action.toLowerCase()}`,
    ''
  ].join('\n');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256(payload)
  ].join('\n');
  const credentialScope = `${requestDate}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, requestDate);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function requestRecognition({ host, region, secretId, secretKey, payload, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const action = 'SentenceRecognition';
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: host,
      path: '/',
      method: 'POST',
      headers: {
        Authorization: buildAuthorization({
          secretId,
          secretKey,
          timestamp,
          host,
          action,
          payload: body
        }),
        'Content-Type': CONTENT_TYPE,
        Host: host,
        'X-TC-Action': action,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': VERSION,
        'X-TC-Region': region,
        'Content-Length': Buffer.byteLength(body)
      }
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1024 * 1024) request.destroy(new Error('ASR response too large'));
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (response.statusCode < 200 || response.statusCode >= 300
            || !parsed.Response || parsed.Response.Error) {
            const upstream = parsed.Response && parsed.Response.Error;
            const error = new Error(upstream ? upstream.Message : `ASR HTTP ${response.statusCode}`);
            error.code = 'ASR_FAILED';
            error.upstreamCode = upstream ? upstream.Code : '';
            error.recoverable = true;
            reject(error);
            return;
          }
          resolve(parsed.Response.Result || '');
        } catch (_) {
          const error = new Error('ASR response is not valid JSON');
          error.code = 'ASR_FAILED';
          error.recoverable = true;
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error('ASR request timed out');
      error.code = 'ASR_FAILED';
      error.recoverable = true;
      request.destroy(error);
    });
    request.on('error', (cause) => {
      if (cause.code === 'ASR_FAILED') {
        reject(cause);
        return;
      }
      const error = new Error('Tencent ASR request failed');
      error.code = 'ASR_FAILED';
      error.recoverable = true;
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

function createTencentAsr(env = process.env) {
  requireAsrConfig(env);
  const host = env.TC_ASR_ENDPOINT || 'asr.tencentcloudapi.com';
  const region = env.TC_ASR_REGION || 'ap-shanghai';
  const timeoutMs = (Number(env.TC_ASR_TIMEOUT_SECONDS) || 10) * 1000;
  return function transcribe(audioBuffer) {
    return requestRecognition({
      host,
      region,
      secretId: env.TC_SECRET_ID,
      secretKey: env.TC_SECRET_KEY,
      timeoutMs,
      payload: {
        EngSerViceType: env.TC_ASR_ENGINE_TYPE || '16k_zh',
        SourceType: 1,
        VoiceFormat: 'mp3',
        Data: audioBuffer.toString('base64'),
        DataLen: audioBuffer.length,
        WordInfo: 0,
        FilterDirty: 0,
        FilterModal: 0,
        FilterPunc: 0,
        ConvertNumMode: 1
      }
    });
  };
}

module.exports = {
  requireAsrConfig,
  buildAuthorization,
  createTencentAsr
};
