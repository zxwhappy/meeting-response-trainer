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

test('lists only enabled scenarios in their configured order', () => {
  assert.equal(typeof subject.listEnabledScenarios, 'function');
  assert.deepEqual(subject.listEnabledScenarios(scenarios).map((item) => item.id), ['a', 'b']);
});

test('creates a fresh practice for the selected enabled scenario', () => {
  assert.equal(typeof subject.createPracticeForScenario, 'function');
  const result = subject.createPracticeForScenario({
    date: '2026-08-17',
    scenarios,
    scenarioId: 'b'
  });
  assert.equal(result.scenarioId, 'b');
  assert.equal(result.completed, false);
});

test('rejects selecting a disabled scenario', () => {
  assert.throws(
    () => subject.createPracticeForScenario({
      date: '2026-08-17',
      scenarios,
      scenarioId: 'off'
    }),
    /不可用/
  );
});

test('warns before leaving an active recording or analysis', () => {
  assert.equal(typeof subject.getSceneExitPrompt, 'function');
  assert.match(subject.getSceneExitPrompt({ phase: 'recordFirst' }).content, /进度会被清空/);
  assert.match(subject.getSceneExitPrompt({ phase: 'analyzingFirst' }).content, /仍可能计入今日次数/);
  assert.equal(subject.getSceneExitPrompt({ phase: 'listen' }), null);
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
