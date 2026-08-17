const test = require('node:test');
const assert = require('node:assert/strict');

function loadPageDefinition(wxMock) {
  const pagePath = require.resolve('../miniprogram/pages/index/index');
  let definition;
  global.wx = wxMock;
  global.Page = (page) => {
    definition = page;
  };
  delete require.cache[pagePath];
  require(pagePath);
  delete global.Page;
  return definition;
}

function createPage(definition) {
  return {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

function createAudioContext() {
  const handlers = {};
  const context = {
    handlers,
    stopCalls: 0,
    onPlay(handler) { handlers.play = handler; },
    onEnded(handler) { handlers.ended = handler; },
    onError(handler) { handlers.error = handler; },
    play() {},
    stop() { context.stopCalls += 1; },
    pause() {},
    destroy() {}
  };
  return context;
}

test('does not report preview errors caused by reset or an empty player', () => {
  const contexts = [createAudioContext(), createAudioContext()];
  const toasts = [];
  const page = createPage(loadPageDefinition({
    createInnerAudioContext: () => contexts.shift(),
    showToast: (options) => toasts.push(options)
  }));

  page.recordingPath = '';
  page.previewRequested = false;
  page.initAudioManagers();
  page.practiceRunId = 0;
  page.clearCountdown = () => {};
  page.clearAnalysisTimers = () => {};
  page.clearRecordingTimer = () => {};
  page.setData({ previewPlaying: false });
  page.resetSessionResults();
  page.previewAudio.handlers.error();

  assert.equal(page.previewAudio.stopCalls, 0);
  assert.equal(page.data.previewPlaying, false);
  assert.deepEqual(toasts, []);
});

test('reports a real preview failure after the user requests playback', () => {
  const contexts = [createAudioContext(), createAudioContext()];
  const toasts = [];
  const page = createPage(loadPageDefinition({
    createInnerAudioContext: () => contexts.shift(),
    showToast: (options) => toasts.push(options)
  }));

  page.recordingPath = '/tmp/response.mp3';
  page.previewRequested = true;
  page.initAudioManagers();
  page.previewAudio.handlers.error();

  assert.equal(page.previewRequested, false);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].title, '试听失败，请重新录制');
});

test('shows the privacy authorization button only when WeChat requires it', () => {
  const page = createPage(loadPageDefinition({
    getPrivacySetting: ({ success }) => success({ needAuthorization: true })
  }));

  page.prepareMicPurpose();

  assert.equal(page.data.micPurposeVisible, true);
  assert.equal(page.data.privacyAuthorizationNeeded, true);
});

test('uses the normal microphone permission path after privacy was authorized', () => {
  let authorizedScope = '';
  let recordingStarted = false;
  const page = createPage(loadPageDefinition({
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getSetting: ({ success }) => success({ authSetting: {} }),
    authorize: ({ scope, success }) => {
      authorizedScope = scope;
      success();
    }
  }));
  page.recorder = {
    start: () => {
      recordingStarted = true;
    }
  };

  page.prepareMicPurpose();
  assert.equal(page.data.privacyAuthorizationNeeded, false);
  page.acceptMicPurpose();

  assert.equal(authorizedScope, 'scope.record');
  assert.equal(recordingStarted, true);
});
