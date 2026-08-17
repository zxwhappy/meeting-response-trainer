const cloud = require('wx-server-sdk');
const { decideUsage } = require('./lib/quota');
const { validateFeedback } = require('./lib/feedback');
const { runAnalysisPipeline, prepareWithCleanupHandoff } = require('./lib/pipeline');
const { anonymousUserKey, stableDocumentId, chinaDate } = require('./lib/user');
const { createTencentAsr } = require('./lib/asr/tencent');
const { createOpenAiAnalyzer } = require('./lib/ai/openaiCompatible');
const scenarios = require('./data/scenarios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const EVENT_NAMES = new Set([
  'app_open',
  'practice_start',
  'scenario_play_start',
  'scenario_play_complete',
  'prep_start',
  'record_start',
  'record_submit',
  'analysis_success',
  'analysis_fail',
  'feedback_view',
  'retry_start',
  'retry_submit',
  'practice_complete',
  'feedback_helpful_yes',
  'feedback_helpful_no',
  'scenario_request_submit',
  'audio_fallback_text'
]);

function requireString(value, name, maxLength) {
  if (typeof value !== 'string' || !value || value.length > maxLength) {
    const error = new Error(`Invalid ${name}`);
    error.code = 'INVALID_REQUEST';
    error.recoverable = false;
    throw error;
  }
  return value;
}

function validateFileID(fileID) {
  requireString(fileID, 'fileID', 1024);
  if (!fileID.includes('/temp-audio/')) {
    const error = new Error('Only temp-audio files can be analyzed');
    error.code = 'INVALID_REQUEST';
    error.recoverable = false;
    throw error;
  }
}

async function findDocument(transaction, collection, id) {
  try {
    const result = await transaction.collection(collection).doc(id).get();
    return result.data || null;
  } catch (_) {
    return null;
  }
}

async function claimDailyUsage({ userKey, requestId, date }) {
  const usageId = stableDocumentId([userKey, date]);
  const requestDocId = stableDocumentId([userKey, date, requestId]);
  return db.runTransaction(async (transaction) => {
    const existingRequest = await findDocument(transaction, 'analysis_requests', requestDocId);
    const usage = await findDocument(transaction, 'analysis_usage_daily', usageId);
    const decision = decideUsage({
      existingRequest: Boolean(existingRequest),
      count: usage ? Number(usage.count) : 0,
      limit: 10
    });
    if (!decision.allowed) return decision;

    await transaction.collection('analysis_usage_daily').doc(usageId).set({
      data: {
        userKey,
        date,
        count: decision.nextCount,
        updatedAt: db.serverDate()
      }
    });
    await transaction.collection('analysis_requests').doc(requestDocId).set({
      data: {
        userKey,
        date,
        requestIdHash: stableDocumentId([requestId]),
        status: 'processing',
        createdAt: db.serverDate()
      }
    });
    return { ...decision, requestDocId };
  });
}

function tempDocumentId(fileID) {
  return stableDocumentId([fileID]);
}

async function registerTempAudio(fileID, requestId) {
  validateFileID(fileID);
  const createdAtMs = Date.now();
  await db.collection('temp_audio_files').doc(tempDocumentId(fileID)).set({
    data: {
      fileID,
      requestIdHash: stableDocumentId([String(requestId || '')]),
      createdAt: db.serverDate(),
      createdAtMs,
      cleanupAttempts: 0
    }
  });
  return { registered: true };
}

async function removeTempMetadata(fileID, cleanupFailed) {
  const reference = db.collection('temp_audio_files').doc(tempDocumentId(fileID));
  if (cleanupFailed) {
    await reference.update({
      data: {
        cleanupAttempts: db.command.inc(1),
        lastCleanupErrorAt: db.serverDate()
      }
    }).catch(() => {});
    return;
  }
  await reference.remove().catch(() => {});
}

async function track(userKey, event) {
  if (!EVENT_NAMES.has(event.eventName)) {
    const error = new Error('Unknown event name');
    error.code = 'INVALID_REQUEST';
    error.recoverable = false;
    throw error;
  }
  const dimensions = event.dimensions && typeof event.dimensions === 'object'
    ? {
      caughtPoint: Boolean(event.dimensions.caughtPoint),
      judgement: Boolean(event.dimensions.judgement),
      nextStep: Boolean(event.dimensions.nextStep)
    }
    : null;
  const sessionId = requireString(event.sessionId, 'sessionId', 128);
  await db.collection('practice_events').add({
    data: {
      userKey,
      sessionId,
      scenarioId: String(event.scenarioId || '').slice(0, 64),
      round: [0, 1, 2].includes(Number(event.round)) ? Number(event.round) : 0,
      eventName: event.eventName,
      durationMs: Math.max(0, Math.min(Number(event.durationMs) || 0, 3600000)),
      errorCode: String(event.errorCode || '').slice(0, 64),
      dimensions,
      mockMode: false,
      date: chinaDate(),
      createdAt: db.serverDate()
    }
  });

  if (event.eventName === 'scenario_request_submit') {
    const requestText = String(event.scenarioRequest || '').trim().slice(0, 100);
    if (requestText) {
      await db.collection('scenario_requests').add({
        data: {
          userKey,
          sessionId,
          scenarioId: String(event.scenarioId || '').slice(0, 64),
          requestText,
          createdAt: db.serverDate()
        }
      });
    }
  }
  return { tracked: true };
}

function publicError(error) {
  const code = error && error.code ? error.code : 'ANALYSIS_FAILED';
  const messages = {
    INVALID_REQUEST: '提交内容不完整，请重新录制。',
    DAILY_LIMIT: '今天练得够多了，明天再来试试。',
    DUPLICATE_REQUEST: '这次提交已经处理过，请重新录制。',
    CONFIG_MISSING: '练习服务暂时没有配置好，请稍后再试。',
    ASR_EMPTY: '没有听清一段完整回应，请重新录制。',
    ASR_FAILED: '这次没有转写成功，可以重试或重新录制。',
    AI_TIMEOUT: '反馈生成超时了，可以重试一次。',
    AI_FORMAT_INVALID: '反馈格式不完整，可以重试一次。',
    AI_UPSTREAM: '反馈服务暂时不可用，请稍后重试。',
    ANALYSIS_FAILED: '刚才没有完成，请重试或重新录制。'
  };
  return {
    code,
    message: messages[code] || messages.ANALYSIS_FAILED,
    recoverable: error && error.recoverable !== false,
    detail: process.env.APP_MODE === 'development' ? String(error && error.message || '') : ''
  };
}

async function deleteCloudAudio(fileID) {
  const response = await cloud.deleteFile({ fileList: [fileID] });
  const failed = response.fileList && response.fileList.find((item) => item.status !== 0);
  if (failed) throw new Error(`Cloud deletion failed: ${failed.errMsg || failed.status}`);
}

async function analyze(openId, event) {
  const fileID = event.fileID;
  const requestId = requireString(event.requestId, 'requestId', 160);
  validateFileID(fileID);
  const scenario = scenarios[event.scenarioId];
  if (!scenario || ![1, 2].includes(Number(event.round))) {
    const error = new Error('Invalid scenario or round');
    error.code = 'INVALID_REQUEST';
    error.recoverable = false;
    throw error;
  }

  await registerTempAudio(fileID, requestId);
  let claim = null;
  let cleanupFailed = false;
  try {
    const result = await prepareWithCleanupHandoff({
      fileID,
      prepare: async () => {
        const userKey = anonymousUserKey(openId, process.env.USER_HASH_SALT);
        const transcribe = createTencentAsr(process.env);
        const aiAnalyze = createOpenAiAnalyzer(process.env);
        claim = await claimDailyUsage({ userKey, requestId, date: chinaDate() });
        if (!claim.allowed) {
          const error = new Error(claim.code);
          error.code = claim.code;
          error.recoverable = claim.code !== 'DAILY_LIMIT';
          throw error;
        }
        return { transcribe, aiAnalyze };
      },
      runOwnedPipeline: async ({ transcribe, aiAnalyze }) => runAnalysisPipeline(
        { fileID, scenario },
        {
          downloadAudio: async (targetFileID) => {
            const response = await cloud.downloadFile({ fileID: targetFileID });
            return response.fileContent;
          },
          deleteAudio: deleteCloudAudio,
          transcribe,
          analyze: aiAnalyze,
          validateFeedback,
          onCleanupError: () => { cleanupFailed = true; }
        }
      ),
      deleteAudio: deleteCloudAudio,
      onCleanupError: () => {
        cleanupFailed = true;
      },
    });
    await db.collection('analysis_requests').doc(claim.requestDocId).update({
      data: {
        status: 'completed',
        resultFlags: {
          caughtPoint: result.dimensions.caughtPoint.passed,
          judgement: result.dimensions.judgement.passed,
          nextStep: result.dimensions.nextStep.passed
        },
        completedAt: db.serverDate()
      }
    }).catch(() => {});
    return result;
  } catch (error) {
    if (claim && claim.requestDocId) {
      await db.collection('analysis_requests').doc(claim.requestDocId).update({
        data: {
          status: 'failed',
          errorCode: error.code || 'ANALYSIS_FAILED',
          completedAt: db.serverDate()
        }
      }).catch(() => {});
    }
    throw error;
  } finally {
    await removeTempMetadata(fileID, cleanupFailed);
  }
}

exports.main = async (event) => {
  try {
    const context = cloud.getWXContext();
    let data;
    switch (event.action) {
      case 'registerTempAudio':
        data = await registerTempAudio(event.fileID, event.requestId);
        break;
      case 'trackEvent':
        data = await track(
          anonymousUserKey(context.OPENID, process.env.USER_HASH_SALT),
          event
        );
        break;
      case 'analyze':
        data = await analyze(context.OPENID, event);
        break;
      default: {
        const error = new Error('Unknown action');
        error.code = 'INVALID_REQUEST';
        error.recoverable = false;
        throw error;
      }
    }
    return { success: true, data };
  } catch (error) {
    console.error('analyzeResponse failed', {
      code: error.code || 'ANALYSIS_FAILED',
      message: error.message
    });
    return { success: false, error: publicError(error) };
  }
};
