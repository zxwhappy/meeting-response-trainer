const MIN_RECORDING_MS = 3000;

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function selectDailyScenario({ date, scenarios, saved, requestedNext = false }) {
  const enabled = (scenarios || []).filter((scenario) => scenario.enabled !== false);
  if (!date || enabled.length === 0) {
    throw new Error('没有可用的练习场景');
  }

  const savedIndex = saved
    ? enabled.findIndex((scenario) => scenario.id === saved.scenarioId)
    : -1;

  if (!requestedNext && saved && saved.date === date && savedIndex >= 0) {
    return {
      date,
      scenarioId: saved.scenarioId,
      completed: Boolean(saved.completed),
      lastResults: saved.lastResults || null,
      completedAt: saved.completedAt || null
    };
  }

  let nextIndex;
  if (requestedNext && savedIndex >= 0) {
    nextIndex = (savedIndex + 1) % enabled.length;
  } else {
    nextIndex = hashString(date) % enabled.length;
    if (saved && saved.date !== date && savedIndex === nextIndex && enabled.length > 1) {
      nextIndex = (nextIndex + 1) % enabled.length;
    }
  }

  return {
    date,
    scenarioId: enabled[nextIndex].id,
    completed: false,
    lastResults: null,
    completedAt: null
  };
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
  selectDailyScenario,
  checkSubmission,
  createRequestId
};
