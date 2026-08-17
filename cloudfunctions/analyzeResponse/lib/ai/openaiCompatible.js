const http = require('http');
const https = require('https');

const SYSTEM_PROMPT = `你是“会答小练”的会议回应结构检查器。只评价三点：
1. caughtPoint：是否回应了对方的核心提议、担忧、限制或问题；仅复述不算通过。
2. judgement：是否明确表达赞成、反对、部分赞成、附条件赞成、暂不判断或需要信息。
3. nextStep：是否给出行动、负责人、时间、验证方式或需要对方回答的明确问题。

不得评价发音、普通话、音色、情绪、性格、智力、领导力、语速或停顿。不得生成标准答案。
必须返回一个 JSON 对象，字段严格如下：
{"dimensions":{"caughtPoint":{"passed":true,"evidence":"引用或准确概括用户实际表达","feedback":"不超过40个汉字"},"judgement":{"passed":true,"evidence":"依据","feedback":"不超过40个汉字"},"nextStep":{"passed":true,"evidence":"依据","feedback":"不超过40个汉字"}},"priority":"最优先修改的一点，不超过60个汉字","retryHint":"下一次使用的简短提示，不超过60个汉字","needReRecord":false}
不能凭空编造用户说过的话；证据不足时 passed 必须为 false。只输出 JSON。`;

function requireAiConfig(env) {
  const missing = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'].filter((key) => !env[key]);
  if (missing.length) {
    const error = new Error(`Missing AI settings: ${missing.join(', ')}`);
    error.code = 'CONFIG_MISSING';
    error.recoverable = false;
    throw error;
  }
}

function stripJsonFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1024 * 1024) request.destroy(new Error('AI response too large'));
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`AI upstream returned HTTP ${response.statusCode}`);
          error.code = 'AI_UPSTREAM';
          error.recoverable = true;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (_) {
          const error = new Error('AI response is not JSON');
          error.code = 'AI_FORMAT_INVALID';
          error.recoverable = true;
          reject(error);
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      const error = new Error('AI request timed out');
      error.code = 'AI_TIMEOUT';
      error.recoverable = true;
      request.destroy(error);
    });
    request.on('error', (cause) => {
      if (cause.code === 'AI_TIMEOUT') {
        reject(cause);
        return;
      }
      const error = new Error('AI request failed');
      error.code = cause.code === 'ETIMEDOUT' ? 'AI_TIMEOUT' : 'AI_UPSTREAM';
      error.recoverable = true;
      reject(error);
    });
    request.write(body);
    request.end();
  });
}

function createOpenAiAnalyzer(env = process.env) {
  requireAiConfig(env);
  const endpoint = `${env.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const maxTokens = Math.min(800, Math.max(200, Number(env.AI_MAX_TOKENS) || 500));
  const timeoutMs = Math.min(30000, Math.max(5000, Number(env.AI_TIMEOUT_MS) || 12000));

  return async function analyze({ scenario, transcript, retry }) {
    const userPrompt = [
      `会议场景：${scenario.title}`,
      `对方发言：${scenario.speech}`,
      `用户回应：${transcript}`,
      retry ? '上一次格式不合格。请严格只返回指定 JSON。' : ''
    ].filter(Boolean).join('\n');
    const payload = {
      model: env.AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
      stream: false
    };
    if (env.AI_JSON_MODE !== 'false') {
      payload.response_format = { type: 'json_object' };
    }
    const body = JSON.stringify(payload);
    const response = await postJson(endpoint, {
      Authorization: `Bearer ${env.AI_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body, timeoutMs);
    const content = response && response.choices && response.choices[0]
      && response.choices[0].message && response.choices[0].message.content;
    try {
      return JSON.parse(stripJsonFence(content));
    } catch (_) {
      const error = new Error('AI content is not valid feedback JSON');
      error.code = 'AI_FORMAT_INVALID';
      error.recoverable = true;
      throw error;
    }
  };
}

module.exports = {
  SYSTEM_PROMPT,
  requireAiConfig,
  stripJsonFence,
  createOpenAiAnalyzer
};
