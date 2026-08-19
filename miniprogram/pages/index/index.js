const scenarios = require('../../data/scenarios');
const config = require('../../config/env');
const {
  STATES,
  transition,
  toError,
  recoverFromError
} = require('../../utils/stateMachine');
const {
  listEnabledScenarios,
  createPracticeForScenario,
  getSceneExitPrompt,
  checkSubmission,
  createRequestId
} = require('../../utils/practice');
const {
  DIMENSIONS,
  compareFeedback,
  buildFallbackFeedback
} = require('../../utils/feedback');
const {
  analyzeRecording,
  trackEvent
} = require('../../services/cloud');

const PRACTICE_KEY = 'meetingTrainerPractice';
const DEVICE_KEY = 'meetingTrainerDeviceId';

const PHASE_PROGRESS = {
  [STATES.LISTEN]: 10,
  [STATES.PREP_FIRST]: 25,
  [STATES.RECORD_FIRST]: 40,
  [STATES.ANALYZING_FIRST]: 50,
  [STATES.FEEDBACK_FIRST]: 65,
  [STATES.RECORD_SECOND]: 80,
  [STATES.ANALYZING_SECOND]: 88,
  [STATES.COMPARISON]: 100,
  [STATES.ERROR]: 50
};

function localDate(now) {
  const date = now || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function secondsText(milliseconds) {
  return `${Math.floor(Math.max(0, milliseconds) / 1000)}秒`;
}

function feedbackItems(result) {
  if (!result) return [];
  return DIMENSIONS.map(({ key, label }) => ({
    key,
    label,
    passed: result.dimensions[key].passed,
    status: result.dimensions[key].passed ? '做到了' : '还可以更清楚',
    evidence: result.dimensions[key].evidence,
    feedback: result.dimensions[key].feedback
  }));
}

function friendlyError(error) {
  const messages = {
    NETWORK_ERROR: '现在没有网络。连接恢复后，可以从这里继续。',
    UPLOAD_OR_NETWORK_FAILED: '录音上传没有完成，请检查网络后重试。',
    CLIENT_TIMEOUT: '这次分析等得有点久，请重试一次。',
    ASR_EMPTY: '没有听清一段完整回应，请重新录制。',
    ASR_FAILED: '这次没有转写成功，可以重试或重新录制。',
    AI_TIMEOUT: '反馈生成超时了，可以重试一次。',
    AI_FORMAT_INVALID: '反馈格式不完整，可以重试一次或先用三点自检。',
    DAILY_LIMIT: '今天练得够多了，明天再来试试。',
    DUPLICATE_REQUEST: '这次提交已经处理过，请重新录制或开始下一轮。',
    CLOUD_NOT_CONFIGURED: '练习服务暂时没有配置好，请稍后再试。',
    CONFIG_MISSING: '练习服务暂时没有配置好，请稍后再试。',
    RECORDER_ERROR: '录音被系统中断了，请重新录制。',
    AUDIO_ERROR: '会议发言播放失败，可以再试一次。'
  };
  return messages[error.code] || error.message || '刚才没有完成，可以从这里重试。';
}

function isPrivacyScopeUndeclared(error) {
  const errno = Number(error && error.errno);
  const message = String(error && error.errMsg || '');
  return errno === 112 || /api scope is not declared in the privacy agreement/i.test(message);
}

function permissionDetail(error) {
  if (!error) return '';
  const message = String(error.errMsg || error.message || '');
  const errno = error.errno === undefined ? '' : ` (errno: ${error.errno})`;
  return `${message}${errno}`.trim();
}

Page({
  data: {
    STATES,
    phase: STATES.TODAY,
    progress: 0,
    scenario: null,
    scenarioOptions: listEnabledScenarios(scenarios),
    mockMode: config.mockMode,
    privacyVisible: false,
    exitConfirm: null,
    micPurposeVisible: false,
    privacyAuthorizationNeeded: false,
    micPermissionDenied: false,
    micPermissionIssue: '',
    micPermissionTitle: '需要麦克风权限',
    micPermissionMessage: '允许后才能录制回应；我们不会长期保存录音。',
    micPermissionActionText: '打开小程序设置',
    micPermissionDetail: '',
    audioPlaying: false,
    audioProgress: 0,
    audioCurrentText: '0:00',
    audioDurationText: '0:00',
    audioPlayCount: 0,
    audioFailureCount: 0,
    audioFallbackVisible: false,
    prepSeconds: 30,
    recording: false,
    recordingDurationText: '0秒',
    hasRecording: false,
    previewPlaying: false,
    isSubmitting: false,
    analysisMessage: '正在听你的回应',
    firstFeedback: null,
    firstFeedbackItems: [],
    firstTranscriptExpanded: false,
    secondFeedback: null,
    secondFeedbackItems: [],
    secondTranscriptExpanded: false,
    secondStage: 'choice',
    secondAudioPlayed: false,
    comparison: null,
    helpfulChoice: '',
    scenarioRequest: '',
    requestSubmitted: false,
    errorView: null
  },

  onLoad() {
    this.deviceId = wx.getStorageSync(DEVICE_KEY) || randomId('device');
    wx.setStorageSync(DEVICE_KEY, this.deviceId);
    this.sessionId = randomId('session');
    this.sessionStartedAt = Date.now();
    this.currentRound = 1;
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.analysisRetryUsed = { 1: false, 2: false };
    this.practiceRunId = 0;
    this.micExplained = false;
    this.previewRequested = false;
    this.interruptedRecording = false;
    this.initScenarioSelection();
    this.initAudioManagers();
    this.initRecorder();
    this.emit('app_open');
  },

  onShow() {
    if (this.pendingSystemMicCheck) {
      this.pendingSystemMicCheck = false;
      if (this.getSystemMicrophoneAuthorization() === 'authorized') {
        this.clearMicPermissionIssue();
      }
    }
    if (this.interruptedRecording) {
      this.interruptedRecording = false;
      wx.showModal({
        title: '录音已安全停止',
        content: '刚才切换到后台或录音被系统打断，这段内容没有提交。请重新录制。',
        showCancel: false,
        confirmText: '重新录制'
      });
    }
  },

  onHide() {
    if (this.data.recording && this.recorder) {
      this.recordStopReason = 'interrupted';
      this.interruptedRecording = true;
      this.recorder.stop();
    }
    this.pauseScenarioAudio();
  },

  onUnload() {
    this.practiceRunId += 1;
    this.clearCountdown();
    this.clearRecordingTimer();
    this.clearAnalysisTimers();
    this.clearAudioTimer();
    this.previewRequested = false;
    if (this.scenarioAudio) this.scenarioAudio.destroy();
    if (this.previewAudio) this.previewAudio.destroy();
  },

  initScenarioSelection() {
    this.practice = wx.getStorageSync(PRACTICE_KEY) || null;
    this.setData({
      scenario: null,
      scenarioOptions: listEnabledScenarios(scenarios),
      phase: STATES.TODAY,
      progress: 0
    });
  },

  moveTo(next) {
    const nextPhase = transition(this.data.phase, next);
    this.setData({ phase: nextPhase, progress: PHASE_PROGRESS[nextPhase] || 0 });
  },

  emit(eventName, extra) {
    const detail = extra || {};
    return trackEvent({
      sessionId: this.sessionId,
      scenarioId: this.data.scenario ? this.data.scenario.id : '',
      round: detail.round || this.currentRound || 0,
      eventName,
      durationMs: detail.durationMs || 0,
      errorCode: detail.errorCode || '',
      dimensions: detail.dimensions || null,
      scenarioRequest: detail.scenarioRequest || ''
    });
  },

  selectScenario(event) {
    const scenarioId = event.currentTarget.dataset.id;
    let practice;
    try {
      practice = createPracticeForScenario({
        date: localDate(),
        scenarios,
        scenarioId
      });
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'none' });
      return;
    }
    const scenario = scenarios.find((item) => item.id === practice.scenarioId);
    this.resetSessionResults();
    this.practice = practice;
    wx.setStorageSync(PRACTICE_KEY, practice);
    this.setData({ scenario });
    this.moveTo(STATES.LISTEN);
    this.emit('practice_start', { round: 1 });
  },

  repeatScenario() {
    if (!this.data.scenario) return;
    const scenario = this.data.scenario;
    const practice = createPracticeForScenario({
      date: localDate(),
      scenarios,
      scenarioId: scenario.id
    });
    this.resetSessionResults();
    this.practice = practice;
    wx.setStorageSync(PRACTICE_KEY, practice);
    this.setData({ scenario });
    this.moveTo(STATES.LISTEN);
    this.emit('practice_start', { round: 1 });
  },

  resetSessionResults() {
    this.practiceRunId = (this.practiceRunId || 0) + 1;
    this.sessionId = randomId('session');
    this.sessionStartedAt = Date.now();
    this.currentRound = 1;
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.analysisRetryUsed = { 1: false, 2: false };
    this.clearCountdown();
    this.clearAnalysisTimers();
    this.clearRecordingTimer();
    const previewWasActive = this.previewRequested || this.data.previewPlaying;
    this.previewRequested = false;
    if (this.previewAudio && previewWasActive) this.previewAudio.stop();
    this.firstFeedback = null;
    this.secondFeedback = null;
    this.errorState = null;
    this.failedRound = 0;
    this.setData({
      audioPlaying: false,
      audioProgress: 0,
      audioCurrentText: '0:00',
      audioDurationText: '0:00',
      audioPlayCount: 0,
      audioFailureCount: 0,
      audioFallbackVisible: false,
      prepSeconds: 30,
      recording: false,
      recordingDurationText: '0秒',
      hasRecording: false,
      previewPlaying: false,
      isSubmitting: false,
      analysisMessage: '正在听你的回应',
      exitConfirm: null,
      micPurposeVisible: false,
      privacyAuthorizationNeeded: false,
      micPermissionDenied: false,
      micPermissionIssue: '',
      micPermissionTitle: '需要麦克风权限',
      micPermissionMessage: '允许后才能录制回应；我们不会长期保存录音。',
      micPermissionActionText: '打开小程序设置',
      micPermissionDetail: '',
      firstFeedback: null,
      firstFeedbackItems: [],
      firstTranscriptExpanded: false,
      secondFeedback: null,
      secondFeedbackItems: [],
      secondTranscriptExpanded: false,
      secondStage: 'choice',
      secondAudioPlayed: false,
      comparison: null,
      helpfulChoice: '',
      scenarioRequest: '',
      requestSubmitted: false,
      errorView: null
    });
  },

  initAudioManagers() {
    this.scenarioAudio = wx.createInnerAudioContext();
    this.scenarioAudio.obeyMuteSwitch = false;
    this.scenarioAudio.onPlay(() => {
      this.setData({ audioPlaying: true });
      this.startAudioTimer();
    });
    this.scenarioAudio.onEnded(() => {
      this.clearAudioTimer();
      this.setData({ audioPlaying: false, audioProgress: 100, audioFailureCount: 0 });
      this.emit('scenario_play_complete');
      if (this.audioMode === 'second') {
        this.startSecondPrep();
      } else {
        this.startFirstPrep();
      }
    });
    this.scenarioAudio.onError(() => this.handleScenarioAudioError());

    this.previewAudio = wx.createInnerAudioContext();
    this.previewAudio.onEnded(() => {
      this.previewRequested = false;
      this.setData({ previewPlaying: false });
    });
    this.previewAudio.onError(() => {
      const shouldNotify = this.previewRequested && Boolean(this.recordingPath);
      this.previewRequested = false;
      this.setData({ previewPlaying: false });
      if (shouldNotify) {
        wx.showToast({ title: '试听失败，请重新录制', icon: 'none' });
      }
    });
  },

  formatAudioTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  },

  startAudioTimer() {
    this.clearAudioTimer();
    this.audioTimer = setInterval(() => {
      const duration = Number(this.scenarioAudio.duration) || 0;
      const current = Number(this.scenarioAudio.currentTime) || 0;
      this.setData({
        audioProgress: duration > 0 ? Math.min(100, current / duration * 100) : 0,
        audioCurrentText: this.formatAudioTime(current),
        audioDurationText: this.formatAudioTime(duration)
      });
    }, 250);
  },

  clearAudioTimer() {
    if (this.audioTimer) clearInterval(this.audioTimer);
    this.audioTimer = null;
  },

  playScenarioAudio() {
    if (this.data.audioPlaying || this.data.audioPlayCount >= 2) return;
    this.audioMode = 'first';
    this.scenarioAudio.src = this.data.scenario.audioUrl;
    this.setData({
      audioPlayCount: this.data.audioPlayCount + 1,
      audioFallbackVisible: false,
      audioProgress: 0
    });
    this.emit('scenario_play_start', { round: 1 });
    this.scenarioAudio.play();
  },

  replayFirstAudio() {
    if (this.data.audioPlayCount >= 2) return;
    this.clearCountdown();
    this.moveTo(STATES.LISTEN);
    this.playScenarioAudio();
  },

  pauseScenarioAudio() {
    if (this.scenarioAudio && this.data.audioPlaying) {
      this.scenarioAudio.pause();
      this.clearAudioTimer();
      this.setData({ audioPlaying: false });
    }
  },

  handleScenarioAudioError() {
    this.clearAudioTimer();
    const failures = this.data.audioFailureCount + 1;
    const fallback = failures >= 2;
    this.setData({
      audioPlaying: false,
      audioFailureCount: failures,
      audioFallbackVisible: fallback
    });
    if (fallback) {
      this.emit('audio_fallback_text', { errorCode: 'AUDIO_ERROR' });
    } else {
      wx.showToast({ title: '播放失败，请再试一次', icon: 'none' });
    }
  },

  continueWithFallbackText() {
    this.startFirstPrep();
  },

  startFirstPrep() {
    if (this.data.phase !== STATES.LISTEN) return;
    this.moveTo(STATES.PREP_FIRST);
    this.emit('prep_start', { round: 1 });
    this.startCountdown(30, 1);
  },

  startCountdown(seconds, round) {
    this.clearCountdown();
    this.prepDeadline = Date.now() + seconds * 1000;
    this.setData({ prepSeconds: seconds });
    const update = () => {
      const remaining = Math.max(0, Math.ceil((this.prepDeadline - Date.now()) / 1000));
      this.setData({ prepSeconds: remaining });
      if (remaining === 0) this.finishPrep(round);
    };
    this.countdownTimer = setInterval(update, 250);
  },

  clearCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  },

  readyEarly() {
    this.finishPrep(this.currentRound);
  },

  finishPrep(round) {
    this.clearCountdown();
    if (round === 1 && this.data.phase === STATES.PREP_FIRST) {
      this.currentRound = 1;
      this.moveTo(STATES.RECORD_FIRST);
      return;
    }
    if (round === 2 && this.data.phase === STATES.RECORD_SECOND) {
      this.currentRound = 2;
      this.setData({ secondStage: 'ready', prepSeconds: 0 });
    }
  },

  initRecorder() {
    this.recorder = wx.getRecorderManager();
    this.recorder.onStart(() => {
      this.recordingStartedAt = Date.now();
      this.setData({ recording: true, hasRecording: false, recordingDurationText: '0秒' });
      this.emit('record_start', { round: this.currentRound });
      this.startRecordingTimer();
    });
    this.recorder.onStop((result) => {
      this.clearRecordingTimer();
      const discarded = ['interrupted', 'abandoned'].includes(this.recordStopReason);
      this.recordStopReason = '';
      if (discarded) {
        this.recordingPath = '';
        this.recordingDurationMs = 0;
        this.setData({ recording: false, hasRecording: false, recordingDurationText: '0秒' });
        return;
      }
      this.recordingPath = result.tempFilePath || '';
      this.recordingDurationMs = Number(result.duration) || (Date.now() - this.recordingStartedAt);
      this.setData({
        recording: false,
        hasRecording: Boolean(this.recordingPath),
        recordingDurationText: secondsText(this.recordingDurationMs)
      });
    });
    this.recorder.onError((error) => {
      this.clearRecordingTimer();
      if (this.recordStopReason === 'abandoned' || this.data.phase === STATES.TODAY) {
        this.recordStopReason = '';
        return;
      }
      if (/auth|permission|authorize/i.test(String(error.errMsg || error.message || ''))) {
        this.handleMicPermissionFailure(error);
        return;
      }
      this.showError({ code: 'RECORDER_ERROR', message: error.errMsg }, this.recordPhase());
    });
    if (this.recorder.onInterruptionBegin) {
      this.recorder.onInterruptionBegin(() => {
        if (this.data.recording) {
          this.recordStopReason = 'interrupted';
          this.interruptedRecording = true;
          this.recorder.stop();
        }
      });
    }
  },

  recordPhase() {
    return this.currentRound === 2 ? STATES.RECORD_SECOND : STATES.RECORD_FIRST;
  },

  requestStartRecording() {
    if (this.data.recording || this.data.isSubmitting) return;
    if (!this.micExplained) {
      this.prepareMicPurpose();
      return;
    }
    this.ensureMicrophonePermission();
  },

  prepareMicPurpose() {
    const showPurpose = (privacyAuthorizationNeeded) => {
      this.setData({
        micPurposeVisible: true,
        privacyAuthorizationNeeded
      });
    };
    if (typeof wx.getPrivacySetting !== 'function') {
      showPurpose(false);
      return;
    }
    wx.getPrivacySetting({
      success: (result) => showPurpose(Boolean(result.needAuthorization)),
      fail: () => showPurpose(false)
    });
  },

  acceptMicPurpose() {
    this.micExplained = true;
    this.setData({
      micPurposeVisible: false,
      privacyAuthorizationNeeded: false
    });
    this.ensureMicrophonePermission();
  },

  declineMicPurpose() {
    this.setData({
      micPurposeVisible: false,
      privacyAuthorizationNeeded: false
    });
    this.returnToday();
  },

  ensureMicrophonePermission() {
    wx.getSetting({
      success: (settings) => {
        if (settings.authSetting['scope.record']) {
          this.beginRecording();
          return;
        }
        if (settings.authSetting['scope.record'] === false) {
          this.setMicPermissionIssue('miniProgram');
          return;
        }
        wx.authorize({
          scope: 'scope.record',
          success: () => this.beginRecording(),
          fail: (error) => this.handleMicPermissionFailure(error)
        });
      },
      fail: (error) => this.setMicPermissionIssue('unknown', error)
    });
  },

  getSystemMicrophoneAuthorization() {
    if (typeof wx.getAppAuthorizeSetting !== 'function') return '';
    try {
      return wx.getAppAuthorizeSetting().microphoneAuthorized || '';
    } catch (_) {
      return '';
    }
  },

  handleMicPermissionFailure(error) {
    if (isPrivacyScopeUndeclared(error)) {
      this.setMicPermissionIssue('privacyConfig', error);
      return;
    }
    wx.getSetting({
      success: (settings) => {
        if (settings.authSetting['scope.record'] === false) {
          this.setMicPermissionIssue('miniProgram', error);
          return;
        }
        if (this.getSystemMicrophoneAuthorization() === 'denied') {
          this.setMicPermissionIssue('system', error);
          return;
        }
        this.setMicPermissionIssue('unknown', error);
      },
      fail: () => this.setMicPermissionIssue('unknown', error)
    });
  },

  setMicPermissionIssue(issue, error) {
    const content = {
      privacyConfig: {
        title: '麦克风服务还没配置好',
        message: '当前版本暂时无法申请麦克风权限，请稍后再试。',
        action: '重新检查'
      },
      system: {
        title: '需要手机麦克风权限',
        message: '请允许微信使用手机麦克风，然后返回继续录音。',
        action: '打开系统设置'
      },
      miniProgram: {
        title: '需要麦克风权限',
        message: '请在小程序设置里允许使用麦克风，然后返回继续录音。',
        action: '打开小程序设置'
      },
      unknown: {
        title: '麦克风授权没有完成',
        message: '请重新申请一次；如果仍然失败，请稍后再试。',
        action: '重新申请'
      }
    }[issue] || {};
    const development = typeof __wxConfig !== 'undefined' && __wxConfig.envVersion !== 'release';
    this.setData({
      micPermissionDenied: true,
      micPermissionIssue: issue,
      micPermissionTitle: content.title || '需要麦克风权限',
      micPermissionMessage: content.message || '请重新申请麦克风权限。',
      micPermissionActionText: content.action || '重新申请',
      micPermissionDetail: development ? permissionDetail(error) : ''
    });
  },

  clearMicPermissionIssue() {
    this.setData({
      micPermissionDenied: false,
      micPermissionIssue: '',
      micPermissionDetail: ''
    });
  },

  handleMicPermissionAction() {
    if (this.data.micPermissionIssue === 'system') {
      this.openSystemSettings();
      return;
    }
    if (this.data.micPermissionIssue === 'miniProgram') {
      this.openSettings();
      return;
    }
    this.clearMicPermissionIssue();
    this.ensureMicrophonePermission();
  },

  openSettings() {
    wx.openSetting({
      success: (result) => {
        const allowed = Boolean(result.authSetting['scope.record']);
        if (allowed) {
          this.beginRecording();
          return;
        }
        this.setMicPermissionIssue('miniProgram');
      },
      fail: (error) => this.setMicPermissionIssue('miniProgram', error)
    });
  },

  openSystemSettings() {
    if (typeof wx.openAppAuthorizeSetting !== 'function') {
      wx.showModal({
        title: '请在手机系统设置中开启',
        content: '找到微信的权限设置，允许微信使用麦克风后再回来。',
        showCancel: false
      });
      return;
    }
    this.pendingSystemMicCheck = true;
    wx.openAppAuthorizeSetting({
      fail: (error) => {
        this.pendingSystemMicCheck = false;
        this.setMicPermissionIssue('system', error);
      }
    });
  },

  beginRecording() {
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.clearMicPermissionIssue();
    this.setData({ hasRecording: false, previewPlaying: false });
    this.recorder.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
      frameSize: 16
    });
  },

  stopRecording() {
    if (!this.data.recording) return;
    this.recordStopReason = 'manual';
    this.recorder.stop();
  },

  startRecordingTimer() {
    this.clearRecordingTimer();
    this.recordingTimer = setInterval(() => {
      const elapsed = Math.min(60000, Date.now() - this.recordingStartedAt);
      this.setData({ recordingDurationText: secondsText(elapsed) });
    }, 250);
  },

  clearRecordingTimer() {
    if (this.recordingTimer) clearInterval(this.recordingTimer);
    this.recordingTimer = null;
  },

  togglePreview() {
    if (!this.recordingPath) return;
    if (this.data.previewPlaying) {
      this.previewRequested = false;
      this.previewAudio.stop();
      this.setData({ previewPlaying: false });
      return;
    }
    this.previewRequested = true;
    this.previewAudio.src = this.recordingPath;
    this.previewAudio.play();
    this.setData({ previewPlaying: true });
  },

  rerecord() {
    const previewWasActive = this.previewRequested || this.data.previewPlaying;
    this.previewRequested = false;
    if (previewWasActive) this.previewAudio.stop();
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.setData({ hasRecording: false, previewPlaying: false, recordingDurationText: '0秒' });
    this.requestStartRecording();
  },

  submitRecording() {
    this.submitRound(false);
  },

  async submitRound(isRetry) {
    const check = checkSubmission({
      durationMs: this.recordingDurationMs,
      tempFilePath: this.recordingPath,
      isSubmitting: this.data.isSubmitting
    });
    if (!check.ok) {
      if (check.code === 'RECORDING_TOO_SHORT') {
        wx.showToast({ title: '这段回应太短了，再完整说一次吧', icon: 'none' });
      }
      return;
    }

    const round = this.currentRound;
    const recordState = round === 1 ? STATES.RECORD_FIRST : STATES.RECORD_SECOND;
    const analyzingState = round === 1 ? STATES.ANALYZING_FIRST : STATES.ANALYZING_SECOND;
    if (this.data.phase !== recordState) return;
    this.moveTo(analyzingState);
    this.setData({ isSubmitting: true, analysisMessage: '正在听你的回应' });
    this.startAnalysisMessages();
    this.emit(isRetry ? 'retry_submit' : 'record_submit', {
      round,
      durationMs: this.recordingDurationMs
    });

    const requestId = createRequestId(this.sessionId, round, Date.now(), Math.random());
    const practiceRunId = this.practiceRunId;
    try {
      const result = await analyzeRecording({
        tempFilePath: this.recordingPath,
        scenario: this.data.scenario,
        requestId,
        sessionId: this.sessionId,
        deviceId: this.deviceId,
        round
      });
      if (practiceRunId !== this.practiceRunId) return;
      this.clearAnalysisTimers();
      this.setData({ isSubmitting: false });
      const dimensionFlags = {
        caughtPoint: result.dimensions.caughtPoint.passed,
        judgement: result.dimensions.judgement.passed,
        nextStep: result.dimensions.nextStep.passed
      };
      this.emit('analysis_success', { round, dimensions: dimensionFlags });
      if (round === 1) {
        this.firstFeedback = result;
        this.moveTo(STATES.FEEDBACK_FIRST);
        this.setData({
          firstFeedback: result,
          firstFeedbackItems: feedbackItems(result)
        });
        this.emit('feedback_view', { round: 1, dimensions: dimensionFlags });
      } else {
        this.secondFeedback = result;
        const comparison = compareFeedback(this.firstFeedback, result);
        this.moveTo(STATES.COMPARISON);
        this.setData({
          secondFeedback: result,
          secondFeedbackItems: feedbackItems(result),
          comparison
        });
        this.finishPracticeRecord(result);
      }
    } catch (error) {
      if (practiceRunId !== this.practiceRunId) return;
      this.clearAnalysisTimers();
      this.setData({ isSubmitting: false });
      this.emit('analysis_fail', { round, errorCode: error.code || 'UNKNOWN' });
      this.failedRound = round;
      this.showError(error, recordState);
    }
  },

  startAnalysisMessages() {
    this.clearAnalysisTimers();
    this.analysisTimers = [
      setTimeout(() => this.setData({ analysisMessage: '正在检查回应结构' }), 4000),
      setTimeout(() => this.setData({ analysisMessage: '正在整理一条复练建议' }), 9000)
    ];
  },

  clearAnalysisTimers() {
    (this.analysisTimers || []).forEach((timer) => clearTimeout(timer));
    this.analysisTimers = [];
  },

  showError(error, recoveryState) {
    const state = toError(recoveryState, error);
    this.errorState = state;
    const code = error.code || 'UNKNOWN';
    const development = typeof __wxConfig !== 'undefined' && __wxConfig.envVersion !== 'release';
    this.setData({
      phase: STATES.ERROR,
      progress: PHASE_PROGRESS[STATES.ERROR],
      errorView: {
        code,
        message: friendlyError(error),
        detail: development ? (error.detail || error.message || '') : '',
        canRetry: Boolean(this.recordingPath)
          && error.recoverable !== false
          && !this.analysisRetryUsed[this.failedRound]
          && code !== 'ASR_EMPTY'
          && code !== 'RECORDER_ERROR',
        canFallback: code !== 'ASR_EMPTY' && code !== 'RECORDER_ERROR',
        canRerecord: !['CONFIG_MISSING', 'CLOUD_NOT_CONFIGURED', 'DAILY_LIMIT'].includes(code)
      }
    });
  },

  retryAnalysis() {
    const round = this.failedRound || this.currentRound;
    if (this.analysisRetryUsed[round]) return;
    this.analysisRetryUsed[round] = true;
    const recovery = recoverFromError(this.errorState);
    this.setData({ phase: recovery, progress: PHASE_PROGRESS[recovery], errorView: null });
    this.emit('retry_start', { round });
    this.submitRound(true);
  },

  rerecordFromError() {
    const recovery = recoverFromError(this.errorState);
    this.currentRound = recovery === STATES.RECORD_SECOND ? 2 : 1;
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.setData({
      phase: recovery,
      progress: PHASE_PROGRESS[recovery],
      errorView: null,
      hasRecording: false,
      recordingDurationText: '0秒',
      secondStage: this.currentRound === 2 ? 'ready' : this.data.secondStage
    });
  },

  useSelfCheck() {
    const round = this.failedRound || this.currentRound;
    const fallback = buildFallbackFeedback('本轮未生成转写；请按三点自检。');
    if (round === 1) {
      this.firstFeedback = fallback;
      this.setData({
        phase: STATES.FEEDBACK_FIRST,
        progress: PHASE_PROGRESS[STATES.FEEDBACK_FIRST],
        errorView: null,
        firstFeedback: fallback,
        firstFeedbackItems: feedbackItems(fallback)
      });
      this.emit('feedback_view', { round: 1 });
      return;
    }
    this.secondFeedback = fallback;
    const comparison = compareFeedback(this.firstFeedback, fallback);
    this.setData({
      phase: STATES.COMPARISON,
      progress: 100,
      errorView: null,
      secondFeedback: fallback,
      secondFeedbackItems: feedbackItems(fallback),
      comparison
    });
    this.finishPracticeRecord(fallback);
  },

  toggleFirstTranscript() {
    this.setData({ firstTranscriptExpanded: !this.data.firstTranscriptExpanded });
  },

  toggleSecondTranscript() {
    this.setData({ secondTranscriptExpanded: !this.data.secondTranscriptExpanded });
  },

  markTranscriptInaccurate() {
    wx.showModal({
      title: '转写不准确',
      content: 'MVP 暂不支持编辑转写。你可以重新录制这一轮。',
      cancelText: '先继续',
      confirmText: '重新录制',
      success: (result) => {
        if (!result.confirm) return;
        this.currentRound = 1;
        this.recordingPath = '';
        this.recordingDurationMs = 0;
        this.moveTo(STATES.RECORD_FIRST);
        this.setData({ hasRecording: false, recordingDurationText: '0秒' });
      }
    });
  },

  startSecondRound() {
    this.currentRound = 2;
    this.recordingPath = '';
    this.recordingDurationMs = 0;
    this.moveTo(STATES.RECORD_SECOND);
    this.setData({
      secondStage: 'choice',
      secondAudioPlayed: false,
      hasRecording: false,
      recordingDurationText: '0秒'
    });
  },

  playSecondAudio() {
    if (this.data.secondAudioPlayed || this.data.audioPlaying) return;
    this.audioMode = 'second';
    this.scenarioAudio.src = this.data.scenario.audioUrl;
    this.setData({ secondAudioPlayed: true, audioProgress: 0 });
    this.emit('scenario_play_start', { round: 2 });
    this.scenarioAudio.play();
  },

  skipSecondAudio() {
    if (this.data.audioPlaying) this.scenarioAudio.stop();
    this.startSecondPrep();
  },

  startSecondPrep() {
    if (this.data.phase !== STATES.RECORD_SECOND) return;
    this.setData({ secondStage: 'prep' });
    this.emit('prep_start', { round: 2 });
    this.startCountdown(15, 2);
  },

  finishPracticeRecord(secondResult) {
    const dimensions = {
      caughtPoint: secondResult.dimensions.caughtPoint.passed,
      judgement: secondResult.dimensions.judgement.passed,
      nextStep: secondResult.dimensions.nextStep.passed
    };
    this.practice = {
      date: localDate(),
      scenarioId: this.data.scenario.id,
      completed: true,
      lastResults: dimensions,
      completedAt: Date.now()
    };
    wx.setStorageSync(PRACTICE_KEY, this.practice);
    this.emit('practice_complete', {
      round: 2,
      durationMs: Date.now() - this.sessionStartedAt,
      dimensions
    });
  },

  chooseHelpful(event) {
    if (this.data.helpfulChoice) return;
    const choice = event.currentTarget.dataset.choice;
    this.setData({ helpfulChoice: choice });
    this.emit(choice === 'yes' ? 'feedback_helpful_yes' : 'feedback_helpful_no', { round: 2 });
  },

  onScenarioRequestInput(event) {
    this.setData({ scenarioRequest: String(event.detail.value || '').slice(0, 100) });
  },

  async submitScenarioRequest() {
    const value = this.data.scenarioRequest.trim();
    if (!value || this.data.requestSubmitted) return;
    this.setData({ requestSubmitted: true });
    try {
      await trackEvent({
        sessionId: this.sessionId,
        scenarioId: this.data.scenario.id,
        round: 2,
        eventName: 'scenario_request_submit',
        durationMs: 0,
        errorCode: '',
        dimensions: null,
        scenarioRequest: value
      }, true);
      wx.showToast({ title: '已记下这个场景', icon: 'success' });
    } catch (_) {
      this.setData({ requestSubmitted: false });
      wx.showToast({ title: '没有提交成功，请稍后重试', icon: 'none' });
    }
  },

  completePractice() {
    this.returnToSceneSelection();
  },

  returnToday() {
    this.returnToSceneSelection();
  },

  requestReturnToSceneSelection() {
    const prompt = getSceneExitPrompt({
      phase: this.data.phase,
      recording: this.data.recording,
      isSubmitting: this.data.isSubmitting,
      hasRecording: this.data.hasRecording,
      hasFirstFeedback: Boolean(this.data.firstFeedback)
    });
    if (!prompt) {
      this.returnToSceneSelection();
      return;
    }
    this.setData({ exitConfirm: prompt });
  },

  cancelReturnToSceneSelection() {
    this.setData({ exitConfirm: null });
  },

  confirmReturnToSceneSelection() {
    this.setData({ exitConfirm: null });
    this.returnToSceneSelection();
  },

  returnToSceneSelection() {
    if (this.data.phase === STATES.TODAY) return;
    const nextPhase = transition(this.data.phase, STATES.TODAY);
    if (this.data.recording && this.recorder) {
      this.recordStopReason = 'abandoned';
      this.recorder.stop();
    }
    this.clearCountdown();
    this.pauseScenarioAudio();
    if (this.scenarioAudio) this.scenarioAudio.stop();
    this.resetSessionResults();
    this.setData({
      phase: nextPhase,
      progress: 0,
      scenario: null,
      exitConfirm: null,
      errorView: null
    });
  },

  showPrivacy() {
    this.setData({ privacyVisible: true });
  },

  hidePrivacy() {
    this.setData({ privacyVisible: false });
  },

  noop() {
    // 阻止弹层打开时的背景滚动。
  }
});
