const DIMENSIONS = Object.freeze([
  { key: 'caughtPoint', label: '接住对方' },
  { key: 'judgement', label: '说出判断' },
  { key: 'nextStep', label: '推进下一步' }
]);

class FeedbackValidationError extends Error {
  constructor(field) {
    super(`AI 反馈字段不合法：${field}`);
    this.name = 'FeedbackValidationError';
    this.code = 'AI_FORMAT_INVALID';
    this.field = field;
  }
}

function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new FeedbackValidationError(field);
  }
  return value.trim();
}

function validateFeedback(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new FeedbackValidationError('root');
  }
  if (typeof payload.transcript !== 'string') {
    throw new FeedbackValidationError('transcript');
  }
  if (!payload.dimensions || typeof payload.dimensions !== 'object') {
    throw new FeedbackValidationError('dimensions');
  }

  const dimensions = {};
  DIMENSIONS.forEach(({ key }) => {
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
    transcript: payload.transcript.trim(),
    dimensions,
    priority: requireText(payload.priority, 'priority', 60),
    retryHint: requireText(payload.retryHint, 'retryHint', 60),
    needReRecord: payload.needReRecord
  };
}

function countPassed(result) {
  return DIMENSIONS.reduce(
    (count, { key }) => count + (result.dimensions[key].passed ? 1 : 0),
    0
  );
}

function compareFeedback(first, second) {
  const firstCount = countPassed(first);
  const secondCount = countPassed(second);
  const delta = secondCount - firstCount;
  const newDimensions = DIMENSIONS
    .filter(({ key }) => !first.dimensions[key].passed && second.dimensions[key].passed)
    .map(({ label }) => label);
  const lostDimensions = DIMENSIONS
    .filter(({ key }) => first.dimensions[key].passed && !second.dimensions[key].passed)
    .map(({ label }) => label);
  const weakestItem = DIMENSIONS.find(({ key }) => !second.dimensions[key].passed);

  let title;
  if (delta > 0) {
    title = '这次更完整了';
  } else if (delta === 0 && secondCount === 3) {
    title = '两次都比较完整，下一次可以练得更简洁';
  } else if (delta === 0) {
    title = '结构暂时没有明显变化，下一次只练最薄弱的一项';
  } else {
    title = '第二次有一项没有说清，下次先保住这一步';
  }

  return {
    title,
    firstCount,
    secondCount,
    delta,
    newDimensions,
    lostDimensions,
    weakest: weakestItem ? weakestItem.label : null
  };
}

function buildFallbackFeedback(transcript = '') {
  return {
    transcript,
    dimensions: {
      caughtPoint: {
        passed: false,
        evidence: '请自己检查是否回应了对方最核心的担忧或提议。',
        feedback: '先用一句话接住对方。'
      },
      judgement: {
        passed: false,
        evidence: '请自己检查是否明确说出了赞成、反对或附带条件。',
        feedback: '再直接说出你的判断。'
      },
      nextStep: {
        passed: false,
        evidence: '请自己检查是否给出了行动、负责人、时间或明确问题。',
        feedback: '补一个可执行的下一步。'
      }
    },
    priority: '下一次只按“接住、判断、下一步”自检，不追求标准答案。',
    retryHint: '接住对方 → 给出判断 → 推进下一步',
    needReRecord: false,
    fallback: true
  };
}

module.exports = {
  DIMENSIONS,
  FeedbackValidationError,
  validateFeedback,
  countPassed,
  compareFeedback,
  buildFallbackFeedback
};
