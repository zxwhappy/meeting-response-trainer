const MIN_RECORDING_MS = 3000;

function listEnabledScenarios(scenarios) {
  return (scenarios || []).filter((scenario) => scenario.enabled !== false);
}

function createPracticeForScenario({ date, scenarios, scenarioId }) {
  const enabled = listEnabledScenarios(scenarios);
  if (!date || !scenarioId || enabled.length === 0) {
    throw new Error('没有可用的练习场景');
  }
  const scenario = enabled.find((item) => item.id === scenarioId);
  if (!scenario) {
    throw new Error('所选练习场景不可用');
  }
  return {
    date,
    scenarioId: scenario.id,
    completed: false,
    lastResults: null,
    completedAt: null
  };
}

function getSceneExitPrompt({ phase, recording, isSubmitting, hasRecording, hasFirstFeedback }) {
  if (isSubmitting || phase === 'analyzingFirst' || phase === 'analyzingSecond') {
    return {
      title: '退出本轮练习？',
      content: '分析已经开始，返回后结果不会再显示，本次分析仍可能计入今日次数。'
    };
  }
  const hasProgress = recording
    || hasRecording
    || hasFirstFeedback
    || ['recordFirst', 'feedbackFirst', 'recordSecond', 'error'].includes(phase);
  if (hasProgress) {
    return {
      title: '放弃本轮练习？',
      content: '当前录音和本轮练习进度会被清空。'
    };
  }
  return null;
}

function checkSubmission({ durationMs, tempFilePath, isSubmitting }) {
  if (isSubmitting) {
    return { ok: false, code: 'SUBMITTING' };
  }
  if (!tempFilePath) {
    return { ok: false, code: 'NO_RECORDING' };
  }
  if (!Number.isFinite(durationMs) || durationMs < MIN_RECORDING_MS) {
    return { ok: false, code: 'RECORDING_TOO_SHORT' };
  }
  return { ok: true, code: null };
}

function createRequestId(sessionId, round, nowMs, randomValue) {
  const random = String(randomValue == null ? Math.random() : randomValue)
    .replace(/\D/g, '')
    .slice(-8);
  return `${sessionId}-${round}-${nowMs || Date.now()}-${random || '0'}`;
}

module.exports = {
  MIN_RECORDING_MS,
  listEnabledScenarios,
  createPracticeForScenario,
  getSceneExitPrompt,
  checkSubmission,
  createRequestId
};
