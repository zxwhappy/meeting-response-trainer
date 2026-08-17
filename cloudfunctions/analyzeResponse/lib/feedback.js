const DIMENSION_KEYS = ['caughtPoint', 'judgement', 'nextStep'];

class FeedbackValidationError extends Error {
  constructor(field) {
    super(`Invalid AI feedback field: ${field}`);
    this.name = 'FeedbackValidationError';
    this.code = 'AI_FORMAT_INVALID';
    this.recoverable = true;
  }
}

function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new FeedbackValidationError(field);
  }
  return value.trim();
}

function validateFeedback(payload) {
  if (!payload || typeof payload !== 'object' || !payload.dimensions) {
    throw new FeedbackValidationError('root');
  }
  const dimensions = {};
  DIMENSION_KEYS.forEach((key) => {
    const item = payload.dimensions[key];
    if (!item || typeof item.passed !== 'boolean') {
      throw new FeedbackValidationError(`${key}.passed`);
    }
    dimensions[key] = {
      passed: item.passed,
      evidence: requireText(item.evidence, `${key}.evidence`, 80),
      feedback: requireText(item.feedback, `${key}.feedback`, 40)
    };
  });
  if (typeof payload.needReRecord !== 'boolean') {
    throw new FeedbackValidationError('needReRecord');
  }
  return {
    dimensions,
    priority: requireText(payload.priority, 'priority', 60),
    retryHint: requireText(payload.retryHint, 'retryHint', 60),
    needReRecord: payload.needReRecord
  };
}

module.exports = { FeedbackValidationError, validateFeedback };
