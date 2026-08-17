const STATES = Object.freeze({
  TODAY: 'today',
  LISTEN: 'listen',
  PREP_FIRST: 'prepFirst',
  RECORD_FIRST: 'recordFirst',
  ANALYZING_FIRST: 'analyzingFirst',
  FEEDBACK_FIRST: 'feedbackFirst',
  RECORD_SECOND: 'recordSecond',
  ANALYZING_SECOND: 'analyzingSecond',
  COMPARISON: 'comparison',
  ERROR: 'error'
});

const ALLOWED = Object.freeze({
  [STATES.TODAY]: [STATES.LISTEN],
  [STATES.LISTEN]: [STATES.TODAY, STATES.PREP_FIRST, STATES.ERROR],
  [STATES.PREP_FIRST]: [STATES.TODAY, STATES.LISTEN, STATES.RECORD_FIRST, STATES.ERROR],
  [STATES.RECORD_FIRST]: [STATES.TODAY, STATES.ANALYZING_FIRST, STATES.ERROR],
  [STATES.ANALYZING_FIRST]: [STATES.TODAY, STATES.FEEDBACK_FIRST, STATES.ERROR],
  [STATES.FEEDBACK_FIRST]: [STATES.TODAY, STATES.RECORD_FIRST, STATES.RECORD_SECOND, STATES.ERROR],
  [STATES.RECORD_SECOND]: [STATES.TODAY, STATES.ANALYZING_SECOND, STATES.ERROR],
  [STATES.ANALYZING_SECOND]: [STATES.TODAY, STATES.RECORD_SECOND, STATES.COMPARISON, STATES.ERROR],
  [STATES.COMPARISON]: [STATES.TODAY, STATES.LISTEN],
  [STATES.ERROR]: [STATES.TODAY]
});

function transition(current, next) {
  if (!ALLOWED[current] || !ALLOWED[current].includes(next)) {
    throw new Error(`非法状态切换：${current} -> ${next}`);
  }
  return next;
}

function toError(recoveryState, error) {
  if (!ALLOWED[recoveryState]) {
    throw new Error(`未知恢复状态：${recoveryState}`);
  }
  return {
    phase: STATES.ERROR,
    recoveryState,
    error: error || { code: 'UNKNOWN' }
  };
}

function recoverFromError(errorState) {
  if (!errorState || errorState.phase !== STATES.ERROR || !ALLOWED[errorState.recoveryState]) {
    throw new Error('异常状态缺少有效的恢复位置');
  }
  return errorState.recoveryState;
}

module.exports = {
  STATES,
  transition,
  toError,
  recoverFromError
};
