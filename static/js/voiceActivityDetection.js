const DEFAULT_SAMPLE_INTERVAL_MS = 80;
const DEFAULT_SPEECH_THRESHOLD = 0.016;
const DEFAULT_SILENCE_THRESHOLD = 0.011;
const DEFAULT_SPEECH_START_MS = 80;
const DEFAULT_SPEECH_END_MS = 650;
const DEFAULT_MAX_SPEECH_MS = 12000;
const DEFAULT_NOISE_FLOOR = 0.012;
const DEFAULT_NOISE_FLOOR_ALPHA = 0.12;
const DEFAULT_SPEECH_NOISE_MARGIN = 0.004;
const DEFAULT_SILENCE_NOISE_MARGIN = 0.002;
const DEFAULT_NOISE_WARMUP_MS = 160;
const DEFAULT_RELATIVE_SILENCE_RATIO = 0.22;
const DEFAULT_RELATIVE_SILENCE_MAX = 0.055;
const DEFAULT_SPEECH_CONTINUATION_RATIO = 0.4;
const DEFAULT_SPEECH_CONTINUATION_MAX = 0.08;

function getAudioContextClass(windowRef) {
  if (!windowRef) return null;
  return windowRef.AudioContext || windowRef.webkitAudioContext || null;
}

function createStatus(patch = {}) {
  return {
    supported: false,
    state: 'idle',
    level: 0,
    speechMs: 0,
    listeningMs: 0,
    speechElapsedMs: 0,
    silenceMs: 0,
    nonSpeechMs: 0,
    speechStartedAt: null,
    speechEndReason: null,
    lastSpeechAt: null,
    noiseFloor: DEFAULT_NOISE_FLOOR,
    speechPeakLevel: 0,
    adaptiveSpeechThreshold: DEFAULT_SPEECH_THRESHOLD,
    adaptiveSilenceThreshold: DEFAULT_SILENCE_THRESHOLD,
    error: null,
    ...patch,
  };
}

export class OracleVoiceActivityDetector extends EventTarget {
  constructor(options = {}) {
    super();
    this.windowRef = options.windowRef || window;
    this.sampleIntervalMs = options.sampleIntervalMs || DEFAULT_SAMPLE_INTERVAL_MS;
    this.speechThreshold = options.speechThreshold || DEFAULT_SPEECH_THRESHOLD;
    this.silenceThreshold = options.silenceThreshold || DEFAULT_SILENCE_THRESHOLD;
    this.speechStartMs = options.speechStartMs || DEFAULT_SPEECH_START_MS;
    this.speechEndMs = options.speechEndMs || DEFAULT_SPEECH_END_MS;
    this.maxSpeechMs = options.maxSpeechMs || DEFAULT_MAX_SPEECH_MS;
    this.noiseFloorAlpha = options.noiseFloorAlpha || DEFAULT_NOISE_FLOOR_ALPHA;
    this.speechNoiseMargin = options.speechNoiseMargin || DEFAULT_SPEECH_NOISE_MARGIN;
    this.silenceNoiseMargin = options.silenceNoiseMargin || DEFAULT_SILENCE_NOISE_MARGIN;
    this.noiseWarmupMs = options.noiseWarmupMs || DEFAULT_NOISE_WARMUP_MS;
    this.relativeSilenceRatio = options.relativeSilenceRatio || DEFAULT_RELATIVE_SILENCE_RATIO;
    this.relativeSilenceMax = options.relativeSilenceMax || DEFAULT_RELATIVE_SILENCE_MAX;
    this.speechContinuationRatio = options.speechContinuationRatio || DEFAULT_SPEECH_CONTINUATION_RATIO;
    this.speechContinuationMax = options.speechContinuationMax || DEFAULT_SPEECH_CONTINUATION_MAX;
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onLevel = options.onLevel || (() => {});
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.sampleTimer = null;
    this.sampleBuffer = null;
    this.status = createStatus({
      supported: Boolean(getAudioContextClass(this.windowRef)),
    });
  }

  isSupported() {
    return Boolean(getAudioContextClass(this.windowRef));
  }

  start(stream) {
    if (this.status.state === 'listening' || this.status.state === 'speech') {
      return { ...this.status };
    }
    if (!stream || !this.isSupported()) {
      this._setStatus({
        supported: this.isSupported(),
        state: 'unavailable',
        error: 'Voice Activity Detection is not available in this browser.',
      });
      return { ...this.status };
    }

    try {
      const AudioContextClass = getAudioContextClass(this.windowRef);
      const audioContext = new AudioContextClass();
      if (audioContext && typeof audioContext.resume === 'function') {
        audioContext.resume().catch(() => {});
      }
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.25;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      this.audioContext = audioContext;
      this.source = source;
      this.analyser = analyser;
      this.sampleBuffer = new Uint8Array(analyser.fftSize);
      this._setStatus({
        supported: true,
        state: 'listening',
        level: 0,
        speechMs: 0,
        listeningMs: 0,
        speechElapsedMs: 0,
        silenceMs: 0,
        nonSpeechMs: 0,
        speechStartedAt: null,
        speechEndReason: null,
        noiseFloor: DEFAULT_NOISE_FLOOR,
        speechPeakLevel: 0,
        adaptiveSpeechThreshold: this.speechThreshold,
        adaptiveSilenceThreshold: this.silenceThreshold,
        error: null,
      });
      this.sampleTimer = this.windowRef.setInterval(() => this._sample(), this.sampleIntervalMs);
      return { ...this.status };
    } catch (error) {
      this._cleanupAudioGraph();
      this._setStatus({
        supported: this.isSupported(),
        state: 'unavailable',
        error: error && error.message ? error.message : 'Voice Activity Detection failed.',
      });
      return { ...this.status };
    }
  }

  stop(state = 'idle') {
    if (this.sampleTimer) {
      this.windowRef.clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this._cleanupAudioGraph();
    this._setStatus({
      state,
      level: 0,
      speechMs: 0,
      listeningMs: 0,
      speechElapsedMs: 0,
      silenceMs: 0,
      nonSpeechMs: 0,
      speechStartedAt: null,
      speechEndReason: null,
      noiseFloor: DEFAULT_NOISE_FLOOR,
      speechPeakLevel: 0,
      adaptiveSpeechThreshold: this.speechThreshold,
      adaptiveSilenceThreshold: this.silenceThreshold,
    });
    return { ...this.status };
  }

  _sample() {
    if (!this.analyser || !this.sampleBuffer) return;
    this.analyser.getByteTimeDomainData(this.sampleBuffer);
    const level = this._rmsLevel(this.sampleBuffer);
    const wasSpeech = this.status.state === 'speech';
    let noiseFloor = this.status.noiseFloor || DEFAULT_NOISE_FLOOR;
    let speechPeakLevel = wasSpeech ? this.status.speechPeakLevel || 0 : 0;
    let { adaptiveSpeechThreshold, adaptiveSilenceThreshold } = this._adaptiveThresholds(noiseFloor, speechPeakLevel);
    let listeningMs = wasSpeech ? this.status.listeningMs : (this.status.listeningMs || 0) + this.sampleIntervalMs;
    const warmingUp = !wasSpeech && listeningMs <= this.noiseWarmupMs;
    let activeSpeechThreshold = wasSpeech
      ? this._speechContinuationThreshold(adaptiveSpeechThreshold, speechPeakLevel)
      : adaptiveSpeechThreshold;
    let isSpeechLevel = !warmingUp && level >= activeSpeechThreshold;
    if (!wasSpeech && (!isSpeechLevel || warmingUp)) {
      noiseFloor = this._updateNoiseFloor(level, noiseFloor);
      ({ adaptiveSpeechThreshold, adaptiveSilenceThreshold } = this._adaptiveThresholds(noiseFloor, speechPeakLevel));
      activeSpeechThreshold = adaptiveSpeechThreshold;
      isSpeechLevel = !warmingUp && level >= activeSpeechThreshold;
    }
    const isSilenceLevel = level <= adaptiveSilenceThreshold;
    if (wasSpeech || isSpeechLevel) {
      speechPeakLevel = Math.max(speechPeakLevel, level);
      ({ adaptiveSpeechThreshold, adaptiveSilenceThreshold } = this._adaptiveThresholds(noiseFloor, speechPeakLevel));
      activeSpeechThreshold = wasSpeech
        ? this._speechContinuationThreshold(adaptiveSpeechThreshold, speechPeakLevel)
        : adaptiveSpeechThreshold;
    }
    let speechMs = isSpeechLevel ? this.status.speechMs + this.sampleIntervalMs : 0;
    let speechElapsedMs = wasSpeech ? this.status.speechElapsedMs + this.sampleIntervalMs : 0;
    let silenceMs = isSilenceLevel ? this.status.silenceMs + this.sampleIntervalMs : 0;
    let nonSpeechMs = wasSpeech && !isSpeechLevel ? (this.status.nonSpeechMs || 0) + this.sampleIntervalMs : 0;
    const postSpeechQuietMs = Math.max(silenceMs, nonSpeechMs);
    let nextState = this.status.state;
    let eventType = '';
    let speechStartedAt = this.status.speechStartedAt;
    let speechEndReason = null;
    const currentTime = Date.now();
    if (wasSpeech && this.status.speechStartedAt) {
      speechElapsedMs = Math.max(speechElapsedMs, currentTime - this.status.speechStartedAt);
    }

    if (!wasSpeech && speechMs >= this.speechStartMs) {
      nextState = 'speech';
      listeningMs = 0;
      speechElapsedMs = 0;
      silenceMs = 0;
      nonSpeechMs = 0;
      speechStartedAt = currentTime;
      speechEndReason = null;
      eventType = 'speech_start';
    } else if (wasSpeech && (postSpeechQuietMs >= this.speechEndMs || speechElapsedMs >= this.maxSpeechMs)) {
      nextState = 'silence';
      speechEndReason = speechElapsedMs >= this.maxSpeechMs ? 'max_speech_ms' : 'trailing_silence';
      speechMs = 0;
      listeningMs = 0;
      speechElapsedMs = 0;
      speechPeakLevel = 0;
      nonSpeechMs = 0;
      speechStartedAt = null;
      eventType = 'speech_end';
    } else if (!wasSpeech && isSilenceLevel) {
      nextState = 'silence';
      speechStartedAt = null;
    }

    const lastSpeechAt = isSpeechLevel ? new Date().toISOString() : this.status.lastSpeechAt;
    this.status = {
      ...this.status,
      state: nextState,
      level,
      speechMs,
      listeningMs,
      speechElapsedMs,
      silenceMs,
      nonSpeechMs,
      speechStartedAt,
      speechEndReason,
      lastSpeechAt,
      noiseFloor,
      speechPeakLevel,
      adaptiveSpeechThreshold,
      adaptiveSilenceThreshold,
      error: null,
    };
    this.onLevel({ ...this.status });

    if (eventType === 'speech_start') this.onSpeechStart({ ...this.status });
    if (eventType === 'speech_end') this.onSpeechEnd({ ...this.status });
    this._publish({ type: eventType || 'level' });
  }

  _rmsLevel(buffer) {
    let sumSquares = 0;
    for (let index = 0; index < buffer.length; index += 1) {
      const centered = (buffer[index] - 128) / 128;
      sumSquares += centered * centered;
    }
    return Math.sqrt(sumSquares / buffer.length);
  }

  _adaptiveThresholds(noiseFloor = DEFAULT_NOISE_FLOOR, speechPeakLevel = 0) {
    const floor = Math.max(0, noiseFloor);
    const relativeSilenceThreshold = speechPeakLevel > 0
      ? Math.min(speechPeakLevel * this.relativeSilenceRatio, this.relativeSilenceMax)
      : 0;
    return {
      adaptiveSpeechThreshold: Math.max(this.speechThreshold, floor + this.speechNoiseMargin),
      adaptiveSilenceThreshold: Math.max(
        this.silenceThreshold,
        floor + this.silenceNoiseMargin,
        relativeSilenceThreshold,
      ),
    };
  }

  _speechContinuationThreshold(adaptiveSpeechThreshold, speechPeakLevel = 0) {
    if (!speechPeakLevel || speechPeakLevel <= 0) return adaptiveSpeechThreshold;
    const relativeThreshold = Math.min(
      speechPeakLevel * this.speechContinuationRatio,
      this.speechContinuationMax,
    );
    return Math.max(adaptiveSpeechThreshold, relativeThreshold);
  }

  _updateNoiseFloor(level, currentNoiseFloor = DEFAULT_NOISE_FLOOR) {
    const alpha = Math.min(Math.max(this.noiseFloorAlpha, 0.01), 1);
    return currentNoiseFloor + ((level - currentNoiseFloor) * alpha);
  }

  _cleanupAudioGraph() {
    if (this.source && typeof this.source.disconnect === 'function') {
      try { this.source.disconnect(); } catch (_) {}
    }
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      try { this.audioContext.close(); } catch (_) {}
    }
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.sampleBuffer = null;
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this._publish();
  }

  _publish(extra = {}) {
    const detail = { status: { ...this.status }, ...extra };
    this.dispatchEvent(new CustomEvent('oraclevoice:activity', { detail }));
    this.windowRef.dispatchEvent(new CustomEvent('oraclevoice:activity', { detail }));
  }
}

export default {
  OracleVoiceActivityDetector,
};
