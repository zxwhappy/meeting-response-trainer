const SYSTEM_PROMPT = `你是“会答小练”的会议回应结构检查器。只评价三点：
1. caughtPoint：是否回应了对方的核心提议、担忧、限制或问题；仅复述不算通过。
2. judgement：是否明确表达赞成、反对、部分赞成、附条件赞成、暂不判断或需要信息。
3. nextStep：是否给出行动、负责人、时间、验证方式或需要对方回答的明确问题。

不得评价发音、普通话、音色、情绪、性格、智力、领导力、语速或停顿。不得生成标准答案。
必须返回一个 JSON 对象，字段严格如下：
{"dimensions":{"caughtPoint":{"passed":true,"evidence":"引用或准确概括用户实际表达","feedback":"不超过40个汉字"},"judgement":{"passed":true,"evidence":"依据","feedback":"不超过40个汉字"},"nextStep":{"passed":true,"evidence":"依据","feedback":"不超过40个汉字"}},"priority":"最优先修改的一点，不超过60个汉字","retryHint":"下一次使用的简短提示，不超过60个汉字","needReRecord":false}
不能凭空编造用户说过的话；证据不足时 passed 必须为 false。只输出 JSON。`;

function stripJsonFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function aiError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.recoverable = true;
  return error;
}

function isTimeoutError(error) {
  const code = String(error && error.code || '').toUpperCase();
  const message = String(error && error.message || '');
  return ['AI_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED'].includes(code)
    || /timed?\s*out|timeout|超时/i.test(message);
}

function mapSdkError(error) {
  if (isTimeoutError(error)) return aiError('AI_TIMEOUT', 'CloudBase AI request timed out');
  return aiError('AI_UPSTREAM', 'CloudBase AI request failed');
}

function createCloudBaseAnalyzer(cloud, env = process.env) {
  if (!cloud || typeof cloud.ai !== 'function') {
    const error = new Error('CloudBase AI is unavailable in wx-server-sdk');
    error.code = 'CONFIG_MISSING';
    error.recoverable = false;
    throw error;
  }

  const provider = env.AI_PROVIDER || 'hunyuan-v3';
  const modelName = env.AI_MODEL || 'hy3';
  const timeoutMs = Math.min(30000, Math.max(5000, Number(env.AI_TIMEOUT_MS) || 12000));
  const model = cloud.ai().createModel(provider);

  return async function analyze({ scenario, transcript, retry }) {
    const userPrompt = [
      `会议场景：${scenario.title}`,
      `对方发言：${scenario.speech}`,
      `用户回应：${transcript}`,
      retry ? '上一次格式不合格。请严格只返回指定 JSON。' : ''
    ].filter(Boolean).join('\n');

    let result;
    try {
      result = await model.generateText({
        model: modelName,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      }, { timeout: timeoutMs });
      if (result && result.error) throw result.error;
    } catch (error) {
      throw mapSdkError(error);
    }

    try {
      return JSON.parse(stripJsonFence(result && result.text));
    } catch (_) {
      throw aiError('AI_FORMAT_INVALID', 'CloudBase AI content is not valid feedback JSON');
    }
  };
}

module.exports = {
  SYSTEM_PROMPT,
  stripJsonFence,
  isTimeoutError,
  createCloudBaseAnalyzer
};
