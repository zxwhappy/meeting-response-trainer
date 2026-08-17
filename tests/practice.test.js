const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../miniprogram/utils/practice');
} catch (_) {}

const scenarios = [
  { id: 'a', enabled: true },
  { id: 'b', enabled: true },
  { id: 'off', enabled: false }
];

test('keeps the same enabled scenario on repeated visits on the same day', () => {
  assert.equal(typeof subject.selectDailyScenario, 'function');
  const result = subject.selectDailyScenario({
    date: '2026-08-17',
    scenarios,
    saved: { date: '2026-08-17', scenarioId: 'b', completed: false }
  });
  assert.equal(result.scenarioId, 'b');
});

test('next practice advances without selecting a disabled scenario', () => {
  assert.equal(typeof subject.selectDailyScenario, 'function');
  const result = subject.selectDailyScenario({
    date: '2026-08-17',
    scenarios,
    saved: { date: '2026-08-17', scenarioId: 'b', completed: true },
    requestedNext: true
  });
  assert.equal(result.scenarioId, 'a');
  assert.equal(result.completed, false);
});

test('rejects recordings shorter than three seconds', () => {
  assert.equal(typeof subject.checkSubmission, 'function');
  assert.deepEqual(
    subject.checkSubmission({
      durationMs: 2999,
      tempFilePath: '/tmp/short.mp3',
      isSubmitting: false
    }),
    { ok: false, code: 'RECORDING_TOO_SHORT' }
  );
});

test('rejects a duplicate submission while analysis is running', () => {
  assert.equal(typeof subject.checkSubmission, 'function');
  assert.deepEqual(
    subject.checkSubmission({
      durationMs: 5000,
      tempFilePath: '/tmp/valid.mp3',
      isSubmitting: true
    }),
    { ok: false, code: 'SUBMITTING' }
  );
});
