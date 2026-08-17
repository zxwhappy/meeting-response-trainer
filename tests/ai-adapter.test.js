const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../cloudfunctions/analyzeResponse/lib/ai/cloudbaseHunyuan');
} catch (_) {}

function validFeedback() {
  return {
    dimensions: {
      caughtPoint: { passed: true, evidence: '提到了延期风险', feedback: '接住了风险。' },
      judgement: { passed: true, evidence: '明确赞成先压测', feedback: '判断清楚。' },
      nextStep: { passed: true, evidence: '提出周四复核', feedback: '下一步具体。' }
    },
    priority: '保持现在的结构，再更简洁一点。',
    retryHint: '接住风险，明确判断，再约定时间。',
    needReRecord: false
  };
}

function createCloudBaseStub(resultOrError) {
  const calls = {
    ai: 0,
    providers: [],
    inputs: [],
    options: []
  };
  const cloud = {
    ai() {
      calls.ai += 1;
      return {
        createModel(provider) {
          calls.providers.push(provider);
          return {
            async generateText(input, options) {
              calls.inputs.push(input);
              calls.options.push(options);
              if (resultOrError instanceof Error) throw resultOrError;
              return resultOrError;
            }
          };
        }
      };
    }
  };
  return { cloud, calls };
}

test('uses CloudBase hunyuan-v3 and hy3 defaults without API credentials', async () => {
  assert.equal(typeof subject.createCloudBaseAnalyzer, 'function');
  const { cloud, calls } = createCloudBaseStub({ text: JSON.stringify(validFeedback()) });
  const analyze = subject.createCloudBaseAnalyzer(cloud, {});
  const result = await analyze({
    scenario: { title: '项目延期', speech: '建议延期一周' },
    transcript: '我赞成延期，今天先完成压测，周四再确认时间。',
    retry: false
  });

  assert.deepEqual(result, validFeedback());
  assert.equal(calls.ai, 1);
  assert.deepEqual(calls.providers, ['hunyuan-v3']);
  assert.equal(calls.inputs[0].model, 'hy3');
  assert.equal(calls.inputs[0].messages[0].role, 'system');
  assert.match(calls.inputs[0].messages[1].content, /用户回应：我赞成延期/);
  assert.equal(calls.options[0].timeout, 12000);
});

test('parses JSON wrapped in a Markdown fence', async () => {
  const fenced = `\`\`\`json\n${JSON.stringify(validFeedback())}\n\`\`\``;
  const { cloud } = createCloudBaseStub({ text: fenced });
  const analyze = subject.createCloudBaseAnalyzer(cloud, {});
  const result = await analyze({
    scenario: { title: '项目延期', speech: '建议延期一周' },
    transcript: '我赞成延期，周四复核。',
    retry: true
  });

  assert.deepEqual(result, validFeedback());
});

test('maps empty or malformed model text to AI_FORMAT_INVALID', async () => {
  assert.equal(typeof subject.createCloudBaseAnalyzer, 'function');
  for (const text of ['', '不是 JSON']) {
    const { cloud } = createCloudBaseStub({ text });
    const analyze = subject.createCloudBaseAnalyzer(cloud, {});
    await assert.rejects(
      analyze({
        scenario: { title: '项目延期', speech: '建议延期一周' },
        transcript: '我赞成延期，周四复核。',
        retry: false
      }),
      (error) => error.code === 'AI_FORMAT_INVALID' && error.recoverable === true
    );
  }
});

test('maps CloudBase timeouts and other SDK failures to public AI errors', async () => {
  assert.equal(typeof subject.createCloudBaseAnalyzer, 'function');
  const timeout = new Error('request timeout');
  timeout.code = 'ETIMEDOUT';
  const cases = [
    { cause: timeout, expected: 'AI_TIMEOUT' },
    { cause: new Error('AI+ upstream unavailable'), expected: 'AI_UPSTREAM' }
  ];

  for (const item of cases) {
    const { cloud } = createCloudBaseStub(item.cause);
    const analyze = subject.createCloudBaseAnalyzer(cloud, {});
    await assert.rejects(
      analyze({
        scenario: { title: '项目延期', speech: '建议延期一周' },
        transcript: '我赞成延期，周四复核。',
        retry: false
      }),
      (error) => error.code === item.expected && error.recoverable === true
    );
  }
});
