class AnalysisError extends Error {
  constructor(code, message, recoverable = true) {
    super(message);
    this.name = 'AnalysisError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

function countEffectiveChineseCharacters(value) {
  const matches = String(value || '').match(/[\u3400-\u9fff]/g);
  return matches ? matches.length : 0;
}

function normalizePipelineError(error) {
  if (error && error.code) {
    if (typeof error.recoverable !== 'boolean') {
      error.recoverable = [
        'AI_TIMEOUT',
        'AI_FORMAT_INVALID',
        'ASR_EMPTY',
        'ASR_FAILED',
        'DOWNLOAD_FAILED'
      ].includes(error.code);
    }
    return error;
  }
  return new AnalysisError('ANALYSIS_FAILED', error ? error.message : 'Analysis failed');
}

async function runAnalysisPipeline(input, dependencies) {
  const {
    downloadAudio,
    deleteAudio,
    transcribe,
    analyze,
    validateFeedback
  } = dependencies;
  let audioBuffer;
  try {
    audioBuffer = await downloadAudio(input.fileID);
    const transcript = String(await transcribe(audioBuffer)).trim();
    if (countEffectiveChineseCharacters(transcript) < 5) {
      throw new AnalysisError('ASR_EMPTY', '没有识别到完整回应，请重新录音');
    }

    let validated;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const rawFeedback = await analyze({
          scenario: input.scenario,
          transcript,
          retry: attempt === 1
        });
        validated = validateFeedback(rawFeedback);
        break;
      } catch (error) {
        if (error && error.code === 'AI_FORMAT_INVALID' && attempt === 0) {
          continue;
        }
        throw error;
      }
    }

    return {
      transcript,
      ...validated
    };
  } catch (error) {
    throw normalizePipelineError(error);
  } finally {
    if (input.fileID) {
      try {
        await deleteAudio(input.fileID);
      } catch (cleanupError) {
        if (typeof dependencies.onCleanupError === 'function') {
          dependencies.onCleanupError(cleanupError, input.fileID);
        }
      }
    }
    audioBuffer = null;
  }
}

async function prepareWithCleanupHandoff({
  fileID,
  prepare,
  runOwnedPipeline,
  deleteAudio,
  onCleanupError
}) {
  let handedOff = false;
  try {
    const prepared = await prepare();
    handedOff = true;
    return await runOwnedPipeline(prepared);
  } finally {
    if (!handedOff && fileID) {
      try {
        await deleteAudio(fileID);
      } catch (error) {
        if (typeof onCleanupError === 'function') onCleanupError(error, fileID);
      }
    }
  }
}

module.exports = {
  AnalysisError,
  countEffectiveChineseCharacters,
  runAnalysisPipeline,
  prepareWithCleanupHandoff
};
