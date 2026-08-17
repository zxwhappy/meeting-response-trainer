const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../cloudfunctions/analyzeResponse/lib/quota');
} catch (_) {}

test('allows and charges a new request below the daily limit', () => {
  assert.equal(typeof subject.decideUsage, 'function');
  assert.deepEqual(
    subject.decideUsage({ existingRequest: false, count: 9, limit: 10 }),
    { allowed: true, charged: true, nextCount: 10, code: null }
  );
});

test('blocks a new request at the daily limit', () => {
  assert.equal(typeof subject.decideUsage, 'function');
  assert.deepEqual(
    subject.decideUsage({ existingRequest: false, count: 10, limit: 10 }),
    { allowed: false, charged: false, nextCount: 10, code: 'DAILY_LIMIT' }
  );
});

test('does not charge a repeated request id', () => {
  assert.equal(typeof subject.decideUsage, 'function');
  assert.deepEqual(
    subject.decideUsage({ existingRequest: true, count: 4, limit: 10 }),
    {
      allowed: false,
      charged: false,
      nextCount: 4,
      code: 'DUPLICATE_REQUEST'
    }
  );
});
