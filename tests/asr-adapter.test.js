const test = require('node:test');
const assert = require('node:assert/strict');

let subject = {};
try {
  subject = require('../cloudfunctions/analyzeResponse/lib/asr/tencent');
} catch (_) {}

test('builds the Tencent TC3 authorization signature for a fixed request vector', () => {
  assert.equal(typeof subject.buildAuthorization, 'function');
  const payload = '{"EngSerViceType":"16k_zh","SourceType":1,"VoiceFormat":"mp3","Data":"YWJj","DataLen":3,"WordInfo":0,"FilterDirty":0,"FilterModal":0,"FilterPunc":0,"ConvertNumMode":1}';
  const authorization = subject.buildAuthorization({
    secretId: 'AKIDEXAMPLE',
    secretKey: 'testsecretkey123',
    timestamp: 1660000000,
    host: 'asr.tencentcloudapi.com',
    action: 'SentenceRecognition',
    payload
  });
  assert.equal(
    authorization,
    'TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2022-08-08/asr/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=ae44206c6e8d6cdeafd294c3e4b0652c649163f946bac63dfb6547f39720a300'
  );
});
