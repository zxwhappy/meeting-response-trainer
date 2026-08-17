const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../miniprogram/utils/stateMachine');
} catch (_) {}

test('allows the first-round happy path in order', () => {
  assert.equal(typeof subject.transition, 'function');
  const path = [
    subject.STATES.LISTEN,
    subject.STATES.PREP_FIRST,
    subject.STATES.RECORD_FIRST,
    subject.STATES.ANALYZING_FIRST,
    subject.STATES.FEEDBACK_FIRST,
    subject.STATES.RECORD_SECOND,
    subject.STATES.ANALYZING_SECOND,
    subject.STATES.COMPARISON
  ];
  let current = subject.STATES.TODAY;
  path.forEach((next) => {
    current = subject.transition(current, next);
  });
  assert.equal(current, subject.STATES.COMPARISON);
});

test('rejects skipping from listening directly to recording', () => {
  assert.equal(typeof subject.transition, 'function');
  assert.throws(
    () => subject.transition(subject.STATES.LISTEN, subject.STATES.RECORD_FIRST),
    /非法状态切换/
  );
});

test('returns from an error only to its recorded recovery state', () => {
  assert.equal(typeof subject.recoverFromError, 'function');
  const errorState = subject.toError(subject.STATES.RECORD_FIRST, {
    code: 'NETWORK_ERROR'
  });
  assert.equal(
    subject.recoverFromError(errorState),
    subject.STATES.RECORD_FIRST
  );
});
