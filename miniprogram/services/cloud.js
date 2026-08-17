const config = require('../config/env');
const { validateFeedback } = require('../utils/feedback');

class ClientError extends Error {
  constructor(code, message, recoverable = true, detail = '') {
    super(message);
    this.name = 'ClientError';
    this.code = code;
    this.recoverable = recoverable;
    this.detail = detail;
  }
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new ClientError('CLIENT_TIMEOUT', '这次分析等得有点久，请重试一次。'));
      }, timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function callFunction(action, data, timeoutMs = config.analysisTimeoutMs) {
  if (!wx.cloud) {
    return Promise.reject(new ClientError(
      'CLOUD_NOT_CONFIGURED',
      '练习服务暂时没有配置好，请稍后再试。',
      false,
      '当前基础库不支持 wx.cloud'
    ));
  }
  return withTimeout(wx.cloud.callFunction({
    name: config.analysisFunctionName,
    data: { action, ...data }
  }), timeoutMs).then((response) => {
    const result = response && response.result;
    if (!result || result.success !== true) {
      const error = result && result.error ? result.error : {};
      throw new ClientError(
        error.code || 'CLOUD_CALL_FAILED',
        error.message || '服务暂时没有响应，请检查网络后重试。',
        error.recoverable !== false,
        error.detail || ''
      );
    }
    return result.data;
  });
}

function mockFeedback(round) {
  const second = round === 2;
  return {
    transcript: second
      ? '【模拟转写】我理解现在有风险，我赞成先处理问题，今天确认负责人，周四再决定上线时间。'
      : '【模拟转写】我理解这个风险，可以先看看，后面再讨论。',
    dimensions: {
      caughtPoint: {
        passed: true,
        evidence: '提到了当前风险。',
        feedback: '已经回应了对方的核心担忧。'
      },
      judgement: {
        passed: second,
        evidence: second ? '明确说了赞成先处理问题。' : '没有明确赞成或反对。',
        feedback: second ? '判断表达清楚。' : '直接说出是否赞成。'
      },
      nextStep: {
        passed: second,
        evidence: second ? '提出今天确认负责人、周四复核。' : '“后面再讨论”还不具体。',
        feedback: second ? '行动和时间都比较具体。' : '补上负责人或时间。'
      }
    },
    priority: second
      ? '结构已经完整，下一次可以再压缩一句。'
      : '先明确是否赞成，再补一个带时间的下一步。',
    retryHint: '接住对方 → 给出判断 → 推进下一步',
    needReRecord: false,
    mock: true
  };
}

async function analyzeRecording({
  tempFilePath,
  scenario,
  requestId,
  sessionId,
  deviceId,
  round
}) {
  if (config.mockMode) {
    return validateFeedback(mockFeedback(round));
  }
  if (!tempFilePath) {
    throw new ClientError('NO_RECORDING', '请先录制一段回应。');
  }

  const cloudPath = `temp-audio/${sessionId}/${requestId}.mp3`;
  let fileID = '';
  try {
    const upload = await withTimeout(
      wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath }),
      15000
    );
    fileID = upload.fileID;
    try {
      await callFunction('registerTempAudio', { fileID, requestId }, 8000);
    } catch (_) {
      // analyze 会再次登记；这里失败不阻断主流程。
    }
    const result = await callFunction('analyze', {
      fileID,
      requestId,
      sessionId,
      deviceId,
      scenarioId: scenario.id,
      round
    });
    return validateFeedback(result);
  } catch (error) {
    if (fileID) {
      wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
    }
    if (error instanceof ClientError) {
      throw error;
    }
    throw new ClientError(
      'UPLOAD_OR_NETWORK_FAILED',
      '录音上传没有完成，请检查网络后重试。',
      true,
      error && error.message ? error.message : ''
    );
  }
}

function trackEvent(event, required = false) {
  if (config.mockMode || !wx.cloud) {
    if (required && !config.mockMode) {
      return Promise.reject(new ClientError(
        'CLOUD_NOT_CONFIGURED',
        '场景建议暂时没有提交成功，请稍后重试。'
      ));
    }
    return Promise.resolve();
  }
  const safeEvent = {
    sessionId: event.sessionId,
    scenarioId: event.scenarioId,
    round: event.round || 0,
    eventName: event.eventName,
    durationMs: Number(event.durationMs) || 0,
    errorCode: event.errorCode || '',
    dimensions: event.dimensions || null,
    mockMode: false,
    scenarioRequest: event.scenarioRequest || ''
  };
  const request = callFunction('trackEvent', safeEvent, 8000);
  return required ? request : request.catch(() => {});
}

module.exports = {
  ClientError,
  withTimeout,
  analyzeRecording,
  trackEvent
};
