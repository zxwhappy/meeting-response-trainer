const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../miniprogram/utils/feedback');
} catch (_) {}

function feedback(passes) {
  const names = ['caughtPoint', 'judgement', 'nextStep'];
  const dimensions = {};
  names.forEach((name, index) => {
    dimensions[name] = {
      passed: passes[index],
      evidence: passes[index] ? '我同意先处理风险' : '没有找到明确表达',
      feedback: passes[index] ? '已经表达清楚。' : '再直接一些。'
    };
  });
  return {
    transcript: '我同意先处理风险，今天确认负责人，周四再决定上线时间。',
    dimensions,
    priority: '先直接说出你的判断。',
    retryHint: '接住风险，再说判断和下一步。',
    needReRecord: false
  };
}

test('accepts a complete bounded three-point response', () => {
  assert.equal(typeof subject.validateFeedback, 'function');
  const result = subject.validateFeedback(feedback([true, false, true]));
  assert.equal(result.dimensions.judgement.passed, false);
});

test('rejects responses containing an overlong priority suggestion', () => {
  assert.equal(typeof subject.validateFeedback, 'function');
  const payload = feedback([true, true, true]);
  payload.priority = '这是一条超过限制的建议'.repeat(8);
  assert.throws(() => subject.validateFeedback(payload), /priority/);
});

test('reports newly gained dimensions when the second response improves', () => {
  assert.equal(typeof subject.compareFeedback, 'function');
  const result = subject.compareFeedback(
    feedback([true, false, false]),
    feedback([true, true, false])
  );
  assert.equal(result.title, '这次更完整了');
  assert.deepEqual(result.newDimensions, ['说出判断']);
  assert.equal(result.delta, 1);
});

test('handles equal complete results without claiming improvement', () => {
  assert.equal(typeof subject.compareFeedback, 'function');
  const result = subject.compareFeedback(
    feedback([true, true, true]),
    feedback([true, true, true])
  );
  assert.equal(result.title, '两次都比较完整，下一次可以练得更简洁');
  assert.equal(result.delta, 0);
});

test('handles equal incomplete results by focusing one weak dimension', () => {
  assert.equal(typeof subject.compareFeedback, 'function');
  const result = subject.compareFeedback(
    feedback([true, false, true]),
    feedback([true, false, true])
  );
  assert.equal(result.title, '结构暂时没有明显变化，下一次只练最薄弱的一项');
  assert.equal(result.weakest, '说出判断');
});

test('uses neutral language when the second response loses a dimension', () => {
  assert.equal(typeof subject.compareFeedback, 'function');
  const result = subject.compareFeedback(
    feedback([true, true, true]),
    feedback([true, false, true])
  );
  assert.equal(result.title, '第二次有一项没有说清，下次先保住这一步');
  assert.deepEqual(result.lostDimensions, ['说出判断']);
  assert.doesNotMatch(result.title, /失败|退步/);
});
