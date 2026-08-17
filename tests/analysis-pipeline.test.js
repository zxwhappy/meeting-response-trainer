const test = require('node:test');
const assert = require('node:assert/strict');

let pipeline = {};
let feedback = {};
try {
  pipeline = require('../cloudfunctions/analyzeResponse/lib/pipeline');
  feedback = require('../cloudfunctions/analyzeResponse/lib/feedback');
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

test('retries one malformed AI response and always deletes the audio', async () => {
  assert.equal(typeof pipeline.runAnalysisPipeline, 'function');
  const deleted = [];
  let aiCalls = 0;
  const result = await pipeline.runAnalysisPipeline(
    {
      fileID: 'cloud://env/temp-audio/a.mp3',
      scenario: { title: '项目延期', speech: '建议延期一周' }
    },
    {
      downloadAudio: async () => Buffer.from('audio'),
      deleteAudio: async (fileID) => deleted.push(fileID),
      transcribe: async () => '我赞成延期，今天先完成压测，周四再确认时间。',
      analyze: async () => {
        aiCalls += 1;
        return aiCalls === 1 ? { dimensions: {} } : validFeedback();
      },
      validateFeedback: feedback.validateFeedback
    }
  );
  assert.equal(result.transcript, '我赞成延期，今天先完成压测，周四再确认时间。');
  assert.equal(aiCalls, 2);
  assert.deepEqual(deleted, ['cloud://env/temp-audio/a.mp3']);
});

test('rejects an empty ASR result before AI analysis and still deletes audio', async () => {
  assert.equal(typeof pipeline.runAnalysisPipeline, 'function');
  const deleted = [];
  await assert.rejects(
    pipeline.runAnalysisPipeline(
      {
        fileID: 'cloud://env/temp-audio/empty.mp3',
        scenario: { title: '项目延期', speech: '建议延期一周' }
      },
      {
        downloadAudio: async () => Buffer.from('audio'),
        deleteAudio: async (fileID) => deleted.push(fileID),
        transcribe: async () => '嗯，好',
        analyze: async () => validFeedback(),
        validateFeedback: feedback.validateFeedback
      }
    ),
    (error) => error.code === 'ASR_EMPTY'
  );
  assert.deepEqual(deleted, ['cloud://env/temp-audio/empty.mp3']);
});

test('surfaces an AI timeout as a recoverable error and still deletes audio', async () => {
  assert.equal(typeof pipeline.runAnalysisPipeline, 'function');
  const deleted = [];
  await assert.rejects(
    pipeline.runAnalysisPipeline(
      {
        fileID: 'cloud://env/temp-audio/timeout.mp3',
        scenario: { title: '项目延期', speech: '建议延期一周' }
      },
      {
        downloadAudio: async () => Buffer.from('audio'),
        deleteAudio: async (fileID) => deleted.push(fileID),
        transcribe: async () => '我赞成延期，今天先完成压测，周四再确认时间。',
        analyze: async () => {
          const error = new Error('timed out');
          error.code = 'AI_TIMEOUT';
          throw error;
        },
        validateFeedback: feedback.validateFeedback
      }
    ),
    (error) => error.code === 'AI_TIMEOUT' && error.recoverable === true
  );
  assert.deepEqual(deleted, ['cloud://env/temp-audio/timeout.mp3']);
});

test('deletes audio when quota or configuration fails before the pipeline takes ownership', async () => {
  assert.equal(typeof pipeline.prepareWithCleanupHandoff, 'function');
  const deleted = [];
  await assert.rejects(
    pipeline.prepareWithCleanupHandoff({
      fileID: 'cloud://env/temp-audio/preflight.mp3',
      prepare: async () => {
        const error = new Error('missing config');
        error.code = 'CONFIG_MISSING';
        throw error;
      },
      runOwnedPipeline: async () => {
        throw new Error('must not run');
      },
      deleteAudio: async (fileID) => deleted.push(fileID)
    }),
    (error) => error.code === 'CONFIG_MISSING'
  );
  assert.deepEqual(deleted, ['cloud://env/temp-audio/preflight.mp3']);
});
