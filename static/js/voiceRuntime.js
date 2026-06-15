import { applyVoiceActions, optimisticSoftInterrupt } from './voiceInterrupt.js';
import { playOracleVoiceSpeech, stopAudioPlayback } from './audioPlayback.js';
import { CartesiaRealtimeSttClient } from './cartesiaRealtimeStt.js';
import { CartesiaRealtimeTtsClient } from './cartesiaRealtimeTts.js';
import { OracleSpeechRecognition } from './oracleSpeechRecognition.js';
import { OracleMicCapture } from './voiceMicCapture.js';

const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace(/^http/, 'ws');
const ORACLE_TRAILING_SILENCE_END_REASON = 'trailing_silence';
const ORACLE_MAX_SPEECH_END_REASON = 'max_speech_ms';
const ORACLE_MAX_AUDIO_STREAM_MS = 12000;
const ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS = 60000;
const ORACLE_BROWSER_TTS_TIMEOUT_MS = 45000;
const ORACLE_ECHO_GUARD_TAIL_MS = 1400;
const ORACLE_DUPLICATE_TRANSCRIPT_WINDOW_MS = 3000;
const ORACLE_SPEECH_LANES = new Set(['presence', 'answer', 'narration']);
const ORACLE_FAST_SPEECH_MAX_CHARS = 160;
const ORACLE_SHORT_VOICE_INTENT_PATTERNS = [
  /^(?:hello|hi|hey|odysseus|oracle)[.!?]?$/i,
  /^(?:stop|cancel|pause|resume|continue)[.!?]?$/i,
];
const ORACLE_DIRECTED_VOICE_PATTERNS = [
  /^(?:hello|hi|hey)\b/i,
  /\b(?:odysseus|oracle|o\.r\.a\.c\.l\.e\.)\b/i,
  /\?$/,
  /^(?:who|what|where|when|why|how|can|could|would|should|do|does|did|is|are|will)\b/i,
  /^(?:tell|search|find|open|create|make|fix|explain|summarize|write|continue|stop|cancel|pause|resume|help)\b/i,
  /^please\b/i,
  /\b(?:i|me|my)\b.*\b(?:need|want|would|can|can't|am|was|have|think|said|say|hear|heard|feel|prefer)\b/i,
];
const ORACLE_NOISE_TRANSCRIPT_PATTERNS = [
  /^(?:\[(?:background\s+)?(?:noise|music|silence|inaudible|applause|laughter)\]\s*)+$/i,
  /^(?:background\s+noise|noise|music|silence|inaudible|applause|laughter)$/i,
  /^(?:thank\s+you\s+for\s+watching|thanks\s+for\s+watching|like\s+and\s+subscribe|don't\s+forget\s+to\s+subscribe)$/i,
  /^(?:yeah|yep|ok|okay|got\s+it|right|sure|uh\s+huh|mm\s+hmm)[.!?]?$/i,
  /^(?:on\s+average|i\s+started\s+with|i\s+start\s+with|started\s+with)[.!?]?$/i,
  /^(?:i'?m\s+working\s+on\s+your\s+chat\s+request|response\s+is\s+ready)[.!?]?$/i,
];

function normalizeError(error, fallback) {
  if (error && error.message) return error.message;
  return fallback;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return window.btoa(binary);
}

function normalizeSpeechEndReason(reason) {
  return reason === ORACLE_MAX_SPEECH_END_REASON
    ? ORACLE_MAX_SPEECH_END_REASON
    : ORACLE_TRAILING_SILENCE_END_REASON;
}

export class OracleVoiceRuntime extends EventTarget {
  constructor(options = {}) {
    super();
    this.fetchImpl = options.fetchImpl || window.fetch.bind(window);
    this.getSessionId = options.getSessionId || (() => null);
    this.onFinalTranscript = options.onFinalTranscript || (() => false);
    this.showToast = options.showToast || (() => {});
    this.showError = options.showError || (() => {});
    this.micCapture = options.micCapture || new OracleMicCapture({ showError: this.showError });
    this.cartesiaRealtimeStt = options.cartesiaRealtimeStt || new CartesiaRealtimeSttClient({
      fetchImpl: this.fetchImpl,
    });
    this.cartesiaRealtimeTts = options.cartesiaRealtimeTts || new CartesiaRealtimeTtsClient({
      fetchImpl: this.fetchImpl,
    });
    this.speechRecognition = options.speechRecognition || new OracleSpeechRecognition({
      onFinalTranscript: (transcript) => this.handleFinalTranscript(transcript, this._voiceTranscriptSource('voice.browser_speech')),
      showError: this.showError,
    });
    this.config = null;
    this.session = null;
    this.vadInterruptInFlight = false;
    this.serverSttInFlight = false;
    this.voiceSocket = null;
    this.voiceSocketReady = false;
    this.wsAudioStreamActive = false;
    this.voiceAudioStreamEnding = false;
    this.voiceAudioStreamSpeechTurnId = null;
    this.voiceAudioStreamMaxTimer = null;
    this.voiceSpeechTurnId = 0;
    this.voiceSpeechTurnSubmitted = false;
    this.voiceSubmittedSpeechTurnId = null;
    this.cartesiaRealtimeSttActive = false;
    this.cartesiaRealtimeSttSpeechTurnId = null;
    this.voiceSpeechGeneration = 0;
    this.voiceSpeechLane = 'idle';
    this.oracleEchoGuardUntil = 0;
    this.oracleEchoGuardIgnoringSpeech = false;
    this.oraclePlaybackInputMuted = false;
    this.lastAcceptedVoiceTranscript = null;
    this.lastAcceptedVoiceTranscriptAt = 0;
    this._boundNarrationRequestHandler = (event) => this._handleNarrationRequest(event);
    this.status = {
      available: false,
      active: false,
      state: 'idle',
      configState: 'loading',
      speechState: 'idle',
      executionState: 'idle',
      microphoneState: this.micCapture.status.state,
      voiceSocketState: 'idle',
      voiceAudioStreamState: 'idle',
      cartesiaRealtimeSttState: 'idle',
      cartesiaRealtimeSttLatency: null,
      cartesiaRealtimeBlocked: false,
      cartesiaRealtimeSetupBlocker: null,
      lastTranscriptSource: null,
      lastTranscriptDiagnostics: null,
      lastTranscriptFilter: null,
      voiceInputHealth: null,
      voiceInputRejectCount: 0,
      label: 'Idle',
    };
    this.micCapture.addEventListener('oraclevoice:microphone', (event) => {
      const microphone = event.detail && event.detail.status ? event.detail.status : this.micCapture.status;
      const voiceActivity = event.detail && event.detail.voiceActivity ? event.detail.voiceActivity : microphone.voiceActivity;
      const microphoneChunk = event.detail && event.detail.chunk ? event.detail.chunk : null;
      this.status = {
        ...this.status,
        microphoneState: microphone.state,
        microphone,
        voiceActivity,
        voiceActivityState: voiceActivity ? voiceActivity.state : this.status.voiceActivityState,
      };
      this._handleVoiceActivityEvent(event.detail || {});
      if (microphoneChunk) {
        this._handleMicrophoneChunk(microphoneChunk).catch(() => {});
      }
      this._publish();
    });
    this.speechRecognition.addEventListener('oraclevoice:speech-recognition', (event) => {
      const speechRecognition = event.detail && event.detail.status ? event.detail.status : this.speechRecognition.status;
      this.status = {
        ...this.status,
        speechRecognitionState: speechRecognition.state,
        speechRecognition,
      };
      this._publish(event.detail || {});
    });
    window.addEventListener('oraclevoice:narration-request', this._boundNarrationRequestHandler);
  }

  async init() {
    await this.loadConfig();
    this._publish();
    return this;
  }

  async loadConfig() {
    try {
      const response = await this.fetchImpl(`${API_BASE}/api/voice/config`, {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Voice config failed: ${response.status}`);
      this.config = await response.json();
      this.status.configState = 'ready';
      this.status.available = this.config.runtime === 'oracle';
      this.status.label = this.status.available ? 'Ready' : 'Unavailable';
      if (!this._isCartesiaVoiceMode()) {
        this.status.cartesiaRealtimeBlocked = false;
        this.status.cartesiaRealtimeSetupBlocker = null;
      }
      return this.config;
    } catch (error) {
      this.config = null;
      this.status.configState = 'error';
      this.status.available = false;
      this.status.label = 'Unavailable';
      this._publish({ error: normalizeError(error, 'Voice config failed') });
      return null;
    }
  }

  _voiceMode() {
    const mode = this.config && this.config.voice_mode
      ? String(this.config.voice_mode.selected || '').trim().toLowerCase()
      : '';
    return ['local', 'hybrid', 'cartesia'].includes(mode) ? mode : 'hybrid';
  }

  _isLocalVoiceMode() {
    return this._voiceMode() === 'local';
  }

  _isHybridVoiceMode() {
    return this._voiceMode() === 'hybrid';
  }

  _isCartesiaVoiceMode() {
    return this._voiceMode() === 'cartesia';
  }

  async setVoiceMode(mode) {
    const nextMode = ['local', 'hybrid', 'cartesia'].includes(String(mode || '').trim().toLowerCase())
      ? String(mode).trim().toLowerCase()
      : 'hybrid';
    const response = await this.fetchImpl(`${API_BASE}/api/voice/preferences`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: nextMode }),
    });
    if (!response.ok) throw new Error(`Voice mode save failed: ${response.status}`);
    await response.json().catch(() => ({}));
    this.status.cartesiaRealtimeBlocked = false;
    this.status.cartesiaRealtimeSetupBlocker = null;
    await this.loadConfig();
    this._publish({ voiceModeChanged: true, voiceMode: nextMode });
    return this.config;
  }

  async saveCartesiaApiKey(apiKey) {
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!key) throw new Error('Cartesia API key is required');
    const response = await this.fetchImpl(`${API_BASE}/api/voice/credentials/cartesia`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key }),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const detail = errorPayload.detail || {};
      const message = detail.message
        ? errorPayload.detail.message
        : `Cartesia credential save failed: ${response.status}`;
      await this.loadConfig().catch(() => {});
      if (detail.setup_blocker) {
        throw new Error(`${message}: ${detail.setup_blocker}`);
      }
      throw new Error(message);
    }
    const data = await response.json();
    this.status.cartesiaRealtimeBlocked = false;
    this.status.cartesiaRealtimeSetupBlocker = null;
    await this.loadConfig();
    this._publish({ cartesiaCredentialsSaved: true, voiceMode: 'cartesia' });
    return data;
  }

  async start() {
    try {
      if (!this.config) await this.loadConfig();
      const sessionId = this.getSessionId();
      const response = await this.fetchImpl(`${API_BASE}/api/voice/session`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId || null }),
      });
      if (!response.ok) throw new Error(`Voice session failed: ${response.status}`);
      this.session = await response.json();
      this._syncFromSession(this.session, true);
      this.startMicrophone().catch(() => {});
      const speechStatus = this._shouldUseBrowserSpeechRecognition()
        ? this.startSpeechRecognition()
        : this._bypassBrowserSpeechRecognition();
      this._publish({
        speechRecognitionAvailable: Boolean(speechStatus && speechStatus.supported),
        voicePresenceOnly: true,
      });
      return this.session;
    } catch (error) {
      this.showError(`O.R.A.C.L.E. could not start: ${normalizeError(error, 'start failed')}`);
      throw error;
    }
  }

  async softInterrupt(reason = 'user_speech') {
    if (!this.session) return null;
    optimisticSoftInterrupt();
    try {
      const response = await this.fetchImpl(`${API_BASE}/api/voice/interrupt`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_session_id: this.session.voice_session_id,
          session_id: this.session.session_id || this.getSessionId() || null,
          reason,
        }),
      });
      if (!response.ok) throw new Error(`Voice interrupt failed: ${response.status}`);
      const data = await response.json();
      applyVoiceActions(data.actions);
      this.session = data;
      this._syncFromSession(data, true);
      return data;
    } catch (error) {
      this.showError(`O.R.A.C.L.E. interrupt failed: ${normalizeError(error, 'interrupt failed')}`);
      throw error;
    }
  }

  async hardCancel(reason = 'user_cancel') {
    if (!this.session) return null;
    optimisticSoftInterrupt();
    try {
      const response = await this.fetchImpl(`${API_BASE}/api/voice/cancel`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_session_id: this.session.voice_session_id,
          session_id: this.session.session_id || this.getSessionId() || null,
          reason,
        }),
      });
      if (!response.ok) throw new Error(`Voice cancel failed: ${response.status}`);
      const data = await response.json();
      applyVoiceActions(data.actions);
      this.session = data;
      this._syncFromSession(data, false);
      this.stopCartesiaRealtimeSttStream('cancelled');
      this.stopMicrophone('cancelled');
      this.stopSpeechRecognition('cancelled');
      this.closeVoiceSocket();
      this.showToast(data.run_stopped ? 'O.R.A.C.L.E. cancelled run' : 'O.R.A.C.L.E. cancelled');
      return data;
    } catch (error) {
      this.showError(`O.R.A.C.L.E. cancel failed: ${normalizeError(error, 'cancel failed')}`);
      throw error;
    }
  }

  async syncStatus() {
    if (!this.session) return null;
    const query = new URLSearchParams({
      voice_session_id: this.session.voice_session_id,
    });
    const response = await this.fetchImpl(`${API_BASE}/api/voice/status?${query.toString()}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Voice status failed: ${response.status}`);
    const data = await response.json();
    this.session = data;
    this._syncFromSession(data, data.state !== 'cancelled');
    return data;
  }

  async toggle() {
    if (!this.session || !this.status.active || this.status.state === 'cancelled') {
      return this.start();
    }
    if (this.status.state === 'interrupted') {
      return this.start();
    }
    return this.softInterrupt('user_speech');
  }

  _normalizeSpeechOptions(options = {}) {
    const lane = ORACLE_SPEECH_LANES.has(options.lane) ? options.lane : 'answer';
    const mode = ['auto', 'fast', 'server'].includes(options.mode) ? options.mode : 'auto';
    return {
      lane,
      mode,
      interrupt: options.interrupt !== false,
      dropIfSpeaking: options.dropIfSpeaking === true,
      toast: options.toast !== false,
    };
  }

  _isSpeechBusy() {
    return this.voiceSpeechLane !== 'idle'
      || this.status.speechState === 'speaking'
      || this.status.state === 'speaking';
  }

  _nowMs() {
    return window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
  }

  _extendOracleEchoGuard(durationMs = ORACLE_ECHO_GUARD_TAIL_MS) {
    this.oracleEchoGuardUntil = Math.max(this.oracleEchoGuardUntil || 0, this._nowMs() + durationMs);
    this._publish({ oracleEchoGuardUntil: this.oracleEchoGuardUntil });
  }

  _isOracleEchoGuardActive() {
    return this._isSpeechBusy() || this._nowMs() < (this.oracleEchoGuardUntil || 0);
  }

  _isCartesiaRealtimeSttFinalizing() {
    return Boolean(this.cartesiaRealtimeStt && this.cartesiaRealtimeStt.finalizing);
  }

  _isCartesiaRealtimeSttFinalizingError(error) {
    return /still finalizing the previous turn/i.test(normalizeError(error, ''));
  }

  _muteVoiceInputForPlayback() {
    this.oraclePlaybackInputMuted = true;
    this.oracleEchoGuardIgnoringSpeech = false;
    if (this.micCapture && typeof this.micCapture.clearBuffer === 'function') {
      this.micCapture.clearBuffer();
    }
    if (this.speechRecognition && typeof this.speechRecognition.stop === 'function') {
      this.stopSpeechRecognition('muted');
    }
    if (this.cartesiaRealtimeSttActive) {
      this.stopCartesiaRealtimeSttStream('muted');
    } else if (this.cartesiaRealtimeStt && typeof this.cartesiaRealtimeStt.stop === 'function') {
      this.cartesiaRealtimeStt.stop();
      this._setCartesiaRealtimeSttState('muted');
    }
    this._publish({
      oraclePlaybackInputMuted: true,
      oracleEchoGuardMuted: true,
    });
  }

  _resumeVoiceInputAfterPlayback() {
    if (!this.oraclePlaybackInputMuted) return;
    this.oraclePlaybackInputMuted = false;
    if (this.micCapture && typeof this.micCapture.clearBuffer === 'function') {
      this.micCapture.clearBuffer();
    }
    if (!this.session || !this.status.active || this.status.state === 'cancelled') {
      this._publish({ oraclePlaybackInputMuted: false });
      return;
    }
    if (this._shouldUseBrowserSpeechRecognition()) {
      this.startSpeechRecognition();
    } else if (this.speechRecognition && typeof this.speechRecognition.stop === 'function') {
      this.stopSpeechRecognition(this._shouldUseCartesiaRealtimeStt() ? 'cartesia_stt' : 'server_stt');
    }
    if (this._shouldUseCartesiaRealtimeStt()) {
      this._scheduleCartesiaRealtimeSttRewarm(250);
    }
    this._publish({
      oraclePlaybackInputMuted: false,
      oracleEchoGuardMuted: false,
    });
  }

  _isCurrentSpeechGeneration(generation) {
    return generation === this.voiceSpeechGeneration;
  }

  _shouldUseFastBrowserTts(speechText, speechOptions) {
    if (!this._canUseBrowserTtsFallback()) return false;
    if (speechOptions.mode === 'fast') return true;
    if (speechOptions.mode === 'server') return false;
    return speechOptions.lane === 'presence'
      || speechOptions.lane === 'narration'
      || speechText.length <= ORACLE_FAST_SPEECH_MAX_CHARS;
  }

  _shouldUseBrowserTtsBeforeCartesia(speechOptions) {
    return speechOptions.lane === 'presence'
      && speechOptions.mode === 'fast'
      && this._canUseBrowserTtsFallback();
  }

  async speak(text, options = {}) {
    const speechText = typeof text === 'string' ? text.trim() : '';
    if (!speechText) return false;
    const speechOptions = this._normalizeSpeechOptions(options);
    if (speechOptions.dropIfSpeaking && this._isSpeechBusy()) {
      this._publish({
        speechPlaybackDropped: true,
        speechLane: speechOptions.lane,
        speechPlaybackState: 'dropped',
      });
      return false;
    }
    if (speechOptions.interrupt) {
      stopAudioPlayback();
    }
    const speechGeneration = ++this.voiceSpeechGeneration;
    this.voiceSpeechLane = speechOptions.lane;
    if (!this.session) {
      await this.start();
    }
    if (!this.session) {
      if (this._isCurrentSpeechGeneration(speechGeneration)) {
        this.voiceSpeechLane = 'idle';
      }
      return false;
    }

    this.status = {
      ...this.status,
      active: true,
      state: 'speaking',
      speechState: 'speaking',
      label: 'Speaking',
    };
    this._publish({ speechPlaybackState: 'loading', speechLane: speechOptions.lane });
    if (speechOptions.toast) {
      this.showToast('O.R.A.C.L.E. speaking');
    }

    this._muteVoiceInputForPlayback();

    try {
      if (this._shouldUseBrowserTtsBeforeCartesia(speechOptions)) {
        this._publish({ speechPlaybackState: 'browser' });
        await this._playBrowserTts(speechText, { stopExisting: speechOptions.interrupt });
        return this._isCurrentSpeechGeneration(speechGeneration);
      }

      if (this._canUseCartesiaRealtimeTts()) {
        try {
          this._publish({ speechPlaybackState: 'cartesia_realtime' });
          await this.cartesiaRealtimeTts.speak(speechText, {
            stopExisting: false,
            timeoutMs: ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS,
          });
          return this._isCurrentSpeechGeneration(speechGeneration);
        } catch (cartesiaError) {
          if (this._isRecoverableCartesiaError(cartesiaError)) {
            this._markCartesiaRealtimeBlocked(cartesiaError, 'tts');
          }
          this._publish({
            speechPlaybackState: this._isCartesiaVoiceMode() ? 'cartesia_failed' : 'server_fallback',
            cartesiaRealtimeTtsError: normalizeError(cartesiaError, 'Cartesia realtime TTS failed'),
          });
          if (this._isCartesiaVoiceMode()) {
            return false;
          }
        }
      }

      if (this._shouldUseFastBrowserTts(speechText, speechOptions)) {
        this._publish({ speechPlaybackState: 'browser' });
        await this._playBrowserTts(speechText, { stopExisting: speechOptions.interrupt });
        return this._isCurrentSpeechGeneration(speechGeneration);
      }

      if (!this._canUseServerTts() && this._canUseBrowserTtsFallback()) {
        this._publish({ speechPlaybackState: 'browser' });
        await this._playBrowserTts(speechText, { stopExisting: speechOptions.interrupt });
        return this._isCurrentSpeechGeneration(speechGeneration);
      }

      const response = await this.fetchImpl(`${API_BASE}/api/voice/speak`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_session_id: this.session.voice_session_id,
          session_id: this.session.session_id || this.getSessionId() || null,
          text: speechText,
        }),
      });
      if (!this._isCurrentSpeechGeneration(speechGeneration)) {
        this._publish({ staleSpeechPlayback: true, speechLane: speechOptions.lane });
        return false;
      }
      if (!response.ok) {
        if (this._canUseBrowserTtsFallback()) {
          this._publish({ speechPlaybackState: 'browser' });
          await this._playBrowserTts(speechText, { stopExisting: speechOptions.interrupt });
          return this._isCurrentSpeechGeneration(speechGeneration);
        }
        throw new Error(`Voice speech failed: ${response.status}`);
      }
      const audioBlob = await response.blob();
      if (!this._isCurrentSpeechGeneration(speechGeneration)) {
        this._publish({ staleSpeechPlayback: true, speechLane: speechOptions.lane });
        return false;
      }
      try {
        await playOracleVoiceSpeech(audioBlob, { timeoutMs: ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS });
      } catch (playbackError) {
        if (this._canUseBrowserTtsFallback()) {
          this._publish({
            speechPlaybackState: 'browser',
            serverTtsPlaybackError: normalizeError(playbackError, 'server audio playback failed'),
          });
          await this._playBrowserTts(speechText, { stopExisting: speechOptions.interrupt });
          return this._isCurrentSpeechGeneration(speechGeneration);
        }
        throw playbackError;
      }
      return this._isCurrentSpeechGeneration(speechGeneration);
    } catch (error) {
      if (!this._isCurrentSpeechGeneration(speechGeneration)) {
        this._publish({ staleSpeechPlayback: true, speechLane: speechOptions.lane });
        return false;
      }
      this.showError(`O.R.A.C.L.E. speech failed: ${normalizeError(error, 'speech failed')}`);
      return false;
    } finally {
      if (!this._isCurrentSpeechGeneration(speechGeneration)) {
        return;
      }
      const nextState = this.session && this.session.state && this.session.state !== 'speaking'
        ? this.session.state
        : 'listening';
      this.voiceSpeechLane = 'idle';
      this._extendOracleEchoGuard();
      this._resumeVoiceInputAfterPlayback();
      this.status = {
        ...this.status,
        state: nextState,
        speechState: this.session && this.session.speech_state && this.session.speech_state !== 'speaking'
          ? this.session.speech_state
          : 'listening',
        label: this._labelForState(nextState),
      };
      this._publish({ speechPlaybackState: 'idle', speechLane: 'idle' });
    }
  }

  _canUseServerTts() {
    return Boolean(
      this.config &&
      this._isHybridVoiceMode() &&
      this.config.tts &&
      this.config.tts.available &&
      this.config.supports_tts_chunked_audio_stream
    );
  }

  _canUseCartesiaRealtimeTts() {
    return Boolean(
      this.cartesiaRealtimeTts
      && this._isCartesiaVoiceMode()
      && !this.status.cartesiaRealtimeBlocked
      && typeof this.cartesiaRealtimeTts.canUse === 'function'
      && this.cartesiaRealtimeTts.canUse(this.config)
    );
  }

  _canUseBrowserTtsFallback() {
    return Boolean(
      window.speechSynthesis &&
      typeof window.SpeechSynthesisUtterance === 'function'
    );
  }

  _findBrowserTtsVoice() {
    if (!this.config || !this.config.tts || !this.config.tts.voice) return null;
    const target = String(this.config.tts.voice || '').trim().toLowerCase();
    if (!target || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') {
      return null;
    }
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => voice.name && voice.name.toLowerCase() === target)
      || voices.find((voice) => voice.name && voice.name.toLowerCase().includes(target))
      || null;
  }

  _playBrowserTts(text, options = {}) {
    if (options.stopExisting !== false) {
      stopAudioPlayback();
    }
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this._findBrowserTtsVoice();
      if (voice) utterance.voice = voice;
      const speed = this.config && this.config.tts ? Number(this.config.tts.speed) : 1;
      if (Number.isFinite(speed) && speed > 0) {
        utterance.rate = speed;
      }
      const speechSynthesis = window.speechSynthesis;
      let timeoutId = null;
      let settled = false;
      const cleanup = () => {
        if (timeoutId) window.clearTimeout(timeoutId);
        timeoutId = null;
      };
      const finish = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      utterance.onstart = () => this._publish({ speechPlaybackState: 'browser' });
      utterance.onend = () => finish({ ended: true, provider: 'browser' });
      utterance.onerror = (event) => fail(new Error(`Browser TTS error: ${event.error || 'unknown'}`));
      if (typeof speechSynthesis.cancel === 'function') {
        speechSynthesis.cancel();
      }
      if (typeof speechSynthesis.resume === 'function') {
        speechSynthesis.resume();
      }
      timeoutId = window.setTimeout(() => fail(new Error('Browser TTS timed out')), ORACLE_BROWSER_TTS_TIMEOUT_MS);
      speechSynthesis.speak(utterance);
      if (typeof speechSynthesis.resume === 'function') {
        window.setTimeout(() => speechSynthesis.resume(), 0);
      }
    });
  }

  async narrate(eventType, message = '', options = {}) {
    const narrationEvent = typeof eventType === 'string' ? eventType.trim() : '';
    if (!narrationEvent) return null;
    if (!this.config) await this.loadConfig();
    if (this.config && this.config.supports_execution_narration_preview === false) return null;
    if (!this.session) {
      await this.start();
    }
    if (!this.session) return null;

    this._publish({ narrationState: 'checking', narrationEvent });

    try {
      const response = await this.fetchImpl(`${API_BASE}/api/voice/narration`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_session_id: this.session.voice_session_id,
          session_id: this.session.session_id || this.getSessionId() || null,
          event_type: narrationEvent,
          message: typeof message === 'string' ? message : '',
        }),
      });
      if (!response.ok) throw new Error(`Voice narration failed: ${response.status}`);
      const data = await response.json();

      if (data.should_speak) {
        this.status = {
          ...this.status,
          active: true,
          state: this.status.state === 'speaking' ? this.status.state : 'working',
          executionState: 'working',
          label: this.status.state === 'speaking' ? 'Speaking' : 'Working',
        };
        this._publish({ narrationState: 'allowed', narration: data });
        if (options.speak === true && data.text) {
          await this.speak(data.text, { lane: 'narration', mode: 'fast', interrupt: false, dropIfSpeaking: true, toast: false });
        }
        return data;
      }

      this._publish({ narrationState: 'suppressed', narration: data });
      return data;
    } catch (error) {
      this.showError(`O.R.A.C.L.E. narration failed: ${normalizeError(error, 'narration failed')}`);
      this._publish({ narrationState: 'error', error: normalizeError(error, 'narration failed') });
      return null;
    }
  }

  _handleNarrationRequest(event) {
    const detail = event && event.detail ? event.detail : {};
    const eventType = detail.eventType || detail.event_type || detail.type || '';
    const message = typeof detail.message === 'string' ? detail.message : '';
    const speak = detail.speak === true;
    const requireActive = detail.requireActive === true || detail.require_active === true;
    if (!eventType) return false;
    if (requireActive && (!this.session || !this.status.active || this.status.state === 'cancelled' || this.status.state === 'interrupted')) {
      return false;
    }
    this.narrate(eventType, message, { speak }).catch(() => {});
    return true;
  }

  async startMicrophone() {
    if (!this.micCapture || typeof this.micCapture.start !== 'function') return null;
    const status = await this.micCapture.start();
    this.status = {
      ...this.status,
      microphoneState: status.state,
      microphone: status,
    };
    this._publish();
    if (status && status.state === 'capturing' && this._shouldUseCartesiaRealtimeStt()) {
      this.startCartesiaRealtimeSttStream({ warm: true }).catch(() => {});
    }
    return status;
  }

  stopMicrophone(state = 'idle') {
    if (!this.micCapture || typeof this.micCapture.stop !== 'function') return;
    this.stopCartesiaRealtimeSttStream(state);
    this.micCapture.stop(state);
    this.status = {
      ...this.status,
      microphoneState: this.micCapture.status.state,
      microphone: this.micCapture.status,
    };
    this._publish();
  }

  startSpeechRecognition() {
    if (!this.speechRecognition || typeof this.speechRecognition.start !== 'function') return null;
    const status = this.speechRecognition.start();
    this.status = {
      ...this.status,
      speechRecognitionState: status.state,
      speechRecognition: status,
    };
    this._publish();
    return status;
  }

  stopSpeechRecognition(state = 'idle') {
    if (!this.speechRecognition || typeof this.speechRecognition.stop !== 'function') return;
    const status = this.speechRecognition.stop(state);
    this.status = {
      ...this.status,
      speechRecognitionState: status.state,
      speechRecognition: status,
    };
    this._publish();
  }

  async listMicrophoneDevices() {
    const mediaDevices = this.micCapture && this.micCapture.navigatorRef
      ? this.micCapture.navigatorRef.mediaDevices
      : null;
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') return [];
    const devices = await mediaDevices.enumerateDevices();
    return devices
      .filter(device => device && device.kind === 'audioinput')
      .map((device, index) => ({
        deviceId: device.deviceId || '',
        groupId: device.groupId || '',
        label: device.label || `Microphone ${index + 1}`,
      }));
  }

  selectMicrophoneDevice(device, options = {}) {
    if (!this.micCapture || typeof this.micCapture.setPreferredDevice !== 'function') return null;
    const selectedDevice = this.micCapture.setPreferredDevice(device, options);
    this.status = {
      ...this.status,
      microphoneState: this.micCapture.status.state,
      microphone: { ...this.micCapture.status },
    };
    this._publish({ selectedMicrophoneDevice: selectedDevice });
    return selectedDevice;
  }

  _handleVoiceActivityEvent(detail) {
    if (!detail) return;
    if (detail.voiceActivityEvent === 'speech_start') {
      if (this._isOracleEchoGuardActive()) {
        this.oracleEchoGuardIgnoringSpeech = true;
        if (this.micCapture && typeof this.micCapture.clearBuffer === 'function') {
          this.micCapture.clearBuffer();
        }
        this._publish({
          oracleEchoGuardIgnored: true,
          voiceActivityEvent: 'speech_start',
          speechPlaybackState: this.status.speechState,
        });
        return;
      }
      this.voiceSpeechTurnId += 1;
      this.voiceSpeechTurnSubmitted = false;
      this.voiceSubmittedSpeechTurnId = null;
      this.status = {
        ...this.status,
        voiceInputHealth: null,
      };
      const useCartesiaRealtimeStt = this._shouldUseCartesiaRealtimeStt();
      if (useCartesiaRealtimeStt) {
        if (this.cartesiaRealtimeSttActive) {
          this.cartesiaRealtimeSttSpeechTurnId = this.voiceSpeechTurnId;
          this._publish({ cartesiaRealtimeSttWarmTurnStarted: true, speechTurnId: this.voiceSpeechTurnId });
        } else {
          this.startCartesiaRealtimeSttStream({ warm: false }).catch(() => {});
        }
      }
      const useVoiceWebSocket = this._shouldUseVoiceWebSocket();
      const useServerSttSegment = this._shouldUseServerSpeechAudio();
      if (!useCartesiaRealtimeStt && (useVoiceWebSocket || useServerSttSegment)) {
        const preparedSegment = this._prepareSpeechAudioSegment();
        if (useVoiceWebSocket) {
          preparedSegment.then(() => this.startVoiceAudioStream()).catch(() => {});
        }
      } else if (!useCartesiaRealtimeStt && this.micCapture && typeof this.micCapture.clearBuffer === 'function') {
        this.micCapture.clearBuffer();
      }
      if (!this.status.active || this.status.state !== 'speaking' || this.vadInterruptInFlight) return;
      this.vadInterruptInFlight = true;
      this.softInterrupt('vad_speech_start')
        .catch(() => {})
        .finally(() => {
          this.vadInterruptInFlight = false;
        });
      return;
    }
    if (detail.voiceActivityEvent !== 'speech_end') return;
    if (this.oracleEchoGuardIgnoringSpeech) {
      this.oracleEchoGuardIgnoringSpeech = false;
      if (this._shouldUseCartesiaRealtimeStt() && this.cartesiaRealtimeSttActive) {
        this.stopCartesiaRealtimeSttStream('idle');
        this.startCartesiaRealtimeSttStream({ warm: true }).catch(() => {});
      }
      if (this.micCapture && typeof this.micCapture.clearBuffer === 'function') {
        this.micCapture.clearBuffer();
      }
      this._publish({ oracleEchoGuardDiscarded: true, voiceActivityEvent: 'speech_end' });
      return;
    }
    const speechEndReason = normalizeSpeechEndReason(
      detail.speechEndReason || (detail.voiceActivity && detail.voiceActivity.speechEndReason)
    );
    if (this._shouldUseCartesiaRealtimeStt()) {
      if (this.cartesiaRealtimeSttActive) {
        this.finalizeCartesiaRealtimeSttStream(speechEndReason).catch(() => {});
      }
      return;
    }
    if (this._shouldUseVoiceWebSocket()) {
      if (this.wsAudioStreamActive) {
        this.endVoiceAudioStream(speechEndReason).catch(() => {});
      }
      return;
    }
    this.transcribeBufferedAudioWithServerStt().catch(() => {});
  }

  async _prepareSpeechAudioSegment() {
    if (!this.micCapture) return false;
    if (typeof this.micCapture.restartSegment === 'function') {
      return this.micCapture.restartSegment();
    }
    if (typeof this.micCapture.clearBuffer === 'function') {
      this.micCapture.clearBuffer();
    }
    return false;
  }

  _shouldUseServerSpeechAudio() {
    return Boolean(
      this.config &&
      this._isHybridVoiceMode() &&
      !this._shouldUseCartesiaRealtimeStt() &&
      this.config.supports_server_stt_final_utterance &&
      !this._shouldUseVoiceWebSocket() &&
      (this._shouldPreferServerSpeechToChat() || !this._isBrowserSpeechRecognitionUsable())
    );
  }

  _shouldUseVoiceWebSocket() {
    return Boolean(
      this.config &&
      this._isHybridVoiceMode() &&
      !this._shouldUseCartesiaRealtimeStt() &&
      this.config.supports_ws_audio_stream &&
      (this._shouldPreferServerSpeechToChat() || !this._isBrowserSpeechRecognitionUsable()) &&
      window.WebSocket
    );
  }

  _shouldPreferServerSpeechToChat() {
    const bridge = this.config && this.config.speech_to_chat_bridge
      ? this.config.speech_to_chat_bridge
      : {};
    return Boolean(
      this.config &&
      this._isHybridVoiceMode() &&
      this.config.supports_server_stt_final_utterance &&
      (bridge.supports_speech_to_chat === true || this.config.supports_ws_audio_stream === true)
    );
  }

  _shouldUseBrowserSpeechRecognition() {
    return Boolean(
      this.speechRecognition &&
      !this._shouldUseCartesiaRealtimeStt() &&
      typeof this.speechRecognition.start === 'function'
    );
  }

  _isBrowserSpeechRecognitionUsable() {
    if (!this.speechRecognition || !this.speechRecognition.status) return false;
    const status = this.speechRecognition.status;
    return Boolean(status.supported && !['error', 'unavailable', 'unsupported'].includes(status.state));
  }

  _bypassBrowserSpeechRecognition() {
    if (this.speechRecognition && typeof this.speechRecognition.stop === 'function') {
      this.speechRecognition.stop('server_stt');
    }
    const status = this.speechRecognition && this.speechRecognition.status
      ? { ...this.speechRecognition.status, state: 'server_stt' }
      : { supported: false, state: 'server_stt' };
    this.status = {
      ...this.status,
      speechRecognitionState: 'server_stt',
      speechRecognition: status,
    };
    this._publish({ speechRecognitionBypassed: true });
    return status;
  }

  _shouldUseCartesiaRealtimeStt() {
    return Boolean(
      this.cartesiaRealtimeStt
      && this._isCartesiaVoiceMode()
      && !this.status.cartesiaRealtimeBlocked
      && typeof this.cartesiaRealtimeStt.canUse === 'function'
      && this.cartesiaRealtimeStt.canUse(this.config)
    );
  }

  _isRecoverableCartesiaError(error) {
    if (!error) return false;
    if (error.recoverable === true) return true;
    const blocker = typeof error.setupBlocker === 'string' ? error.setupBlocker : '';
    if (blocker && blocker.startsWith('cartesia_')) return true;
    const message = normalizeError(error, '');
    if (/Cartesia realtime (STT|TTS) socket/i.test(message)) return true;
    const status = Number(error.status);
    return Number.isInteger(status) && status >= 400 && status < 600;
  }

  _markCartesiaRealtimeBlocked(error, capability = 'stt') {
    const setupBlocker = error && typeof error.setupBlocker === 'string' && error.setupBlocker
      ? error.setupBlocker
      : capability === 'stt'
        ? 'cartesia_stt_socket_failed'
        : 'cartesia_provider_unavailable';
    this.status = {
      ...this.status,
      cartesiaRealtimeBlocked: true,
      cartesiaRealtimeSetupBlocker: setupBlocker,
      cartesiaRealtimeBlockedCapability: capability,
    };
    this._publish({
      cartesiaRealtimeProviderBlocked: true,
      cartesiaRuntimeBlocker: setupBlocker,
      cartesiaRealtimeBlockedCapability: capability,
    });
    return setupBlocker;
  }

  async startCartesiaRealtimeSttStream(options = {}) {
    if (!this.session || this.cartesiaRealtimeSttActive || !this._shouldUseCartesiaRealtimeStt()) return false;
    if (!this.micCapture || !this.micCapture.stream) return false;
    if (this._isCartesiaRealtimeSttFinalizing()) {
      this._publish({ cartesiaRealtimeSttRewarmDeferred: true, cartesiaRealtimeSttState: 'transcribing' });
      this._scheduleCartesiaRealtimeSttRewarm(250);
      return false;
    }
    const warm = options.warm === true;
    this.cartesiaRealtimeSttActive = true;
    this.cartesiaRealtimeSttSpeechTurnId = warm ? null : this.voiceSpeechTurnId;
    this._setCartesiaRealtimeSttState('connecting');
    this._setVoiceAudioStreamState('streaming', { cartesiaRealtimeStt: true, cartesiaRealtimeWarm: warm });
    this.status = {
      ...this.status,
      speechState: 'listening',
      label: 'Listening',
    };
    try {
      await this.cartesiaRealtimeStt.start(this.micCapture.stream, {
        onState: (state, diagnostics) => this._setCartesiaRealtimeSttState(state, diagnostics),
        onPartialTranscript: (text, diagnostics) => this._handleCartesiaRealtimeSttPartial(text, diagnostics),
        onFinalTranscript: (text, diagnostics) => this._handleCartesiaRealtimeSttFinal(text, diagnostics),
        onError: (error) => this._handleCartesiaRealtimeSttError(error),
      }, {
        config: this.config,
      });
      return true;
    } catch (error) {
      this.cartesiaRealtimeSttActive = false;
      this.cartesiaRealtimeSttSpeechTurnId = null;
      this._handleCartesiaRealtimeSttError(error);
      return false;
    }
  }

  async finalizeCartesiaRealtimeSttStream(speechEndReason = ORACLE_TRAILING_SILENCE_END_REASON) {
    if (!this.cartesiaRealtimeSttActive || !this.cartesiaRealtimeStt) return false;
    this.cartesiaRealtimeSttActive = false;
    this._setCartesiaRealtimeSttState('transcribing', { speechEndReason });
    this._setVoiceAudioStreamState('transcribing', { cartesiaRealtimeStt: true, speechEndReason });
    this.status = {
      ...this.status,
      speechState: 'transcribing',
      label: 'Transcribing',
    };
    this._publish({ serverTranscriptionState: 'transcribing', cartesiaRealtimeStt: true });
    return this.cartesiaRealtimeStt.finalize();
  }

  stopCartesiaRealtimeSttStream(state = 'idle') {
    this.cartesiaRealtimeSttActive = false;
    this.cartesiaRealtimeSttSpeechTurnId = null;
    if (this.cartesiaRealtimeStt && typeof this.cartesiaRealtimeStt.stop === 'function') {
      this.cartesiaRealtimeStt.stop();
    }
    this._setCartesiaRealtimeSttState(state);
  }

  _handleCartesiaRealtimeSttPartial(text, diagnostics) {
    const partialTranscript = typeof text === 'string' ? text.trim() : '';
    if (!partialTranscript) return false;
    const safeDiagnostics = this._sanitizeTranscriptDiagnostics(diagnostics);
    this._setLastTranscriptDiagnostics(safeDiagnostics);
    this._setCartesiaRealtimeSttState('transcribing', safeDiagnostics || {});
    this.status = {
      ...this.status,
      speechState: 'transcribing',
      label: 'Transcribing',
      partialTranscript,
      partialTranscriptSupported: true,
    };
    this._publish({
      partialTranscript,
      transcriptDiagnostics: safeDiagnostics,
      serverTranscriptionState: 'transcribing',
      cartesiaRealtimeStt: true,
    });
    return true;
  }

  _handleCartesiaRealtimeSttFinal(text, diagnostics) {
    const finalText = typeof text === 'string' ? text.trim() : '';
    if (!finalText) return false;
    const safeDiagnostics = this._sanitizeTranscriptDiagnostics(diagnostics);
    const transcriptSource = this._voiceTranscriptSource('voice.cartesia_stt', {
      mimeType: 'audio/pcm;encoding=pcm_f32le',
      submitToChat: true,
      speechTurnId: this.cartesiaRealtimeSttSpeechTurnId || this.voiceSpeechTurnId,
    });
    this.cartesiaRealtimeSttSpeechTurnId = null;
    this._setLastTranscriptDiagnostics(safeDiagnostics);
    this._setCartesiaRealtimeSttState('idle', safeDiagnostics || {});
    this._setVoiceAudioStreamState('idle', { cartesiaRealtimeStt: true });
    const accepted = this.handleFinalTranscript(finalText, transcriptSource);
    this._publish({
      transcriptSource,
      transcriptDiagnostics: safeDiagnostics,
      transcriptSubmitted: Boolean(accepted),
      serverTranscriptionState: 'ready',
      cartesiaRealtimeStt: true,
    });
    return accepted;
  }

  _handleCartesiaRealtimeSttError(error) {
    this.cartesiaRealtimeSttActive = false;
    this.cartesiaRealtimeSttSpeechTurnId = null;
    if (this._isCartesiaRealtimeSttFinalizingError(error)) {
      this._setCartesiaRealtimeSttState('transcribing', { setupBlocker: null, rewarmDeferred: true });
      this._setVoiceAudioStreamState('transcribing', { cartesiaRealtimeStt: true, rewarmDeferred: true });
      this._scheduleCartesiaRealtimeSttRewarm(250);
      this._publish({
        cartesiaRealtimeSttRewarmDeferred: true,
        cartesiaRealtimeSttError: normalizeError(error, 'Cartesia STT finalizing'),
      });
      return;
    }
    const recoverable = this._isRecoverableCartesiaError(error);
    const setupBlocker = recoverable ? this._markCartesiaRealtimeBlocked(error, 'stt') : null;
    this._setCartesiaRealtimeSttState(recoverable ? 'setup' : 'error', recoverable ? { setupBlocker } : {});
    this._setVoiceAudioStreamState(recoverable ? 'idle' : 'error', { cartesiaRealtimeStt: true, setupBlocker });
    this.status = {
      ...this.status,
      speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
      label: this._labelForState(this.status.state),
    };
    if (recoverable && this.speechRecognition && typeof this.speechRecognition.start === 'function') {
      this.startSpeechRecognition();
    } else if (!recoverable) {
      this.showError(`O.R.A.C.L.E. STT failed: ${normalizeError(error, 'Cartesia STT failed')}`);
    }
    this._publish({
      serverTranscriptionState: 'idle',
      cartesiaRealtimeProviderBlocked: recoverable,
      cartesiaRuntimeBlocker: setupBlocker,
      cartesiaRealtimeSttError: normalizeError(error, 'Cartesia STT failed'),
    });
  }


  connectVoiceSocket() {
    if (this.voiceSocket && this.voiceSocketReady) return Promise.resolve(this.voiceSocket);
    if (this.voiceSocket && this.voiceSocket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        this.voiceSocket.addEventListener('open', () => {
          this._setVoiceSocketState('connected');
          resolve(this.voiceSocket);
        }, { once: true });
        this.voiceSocket.addEventListener('error', (event) => {
          this._setVoiceSocketState('error');
          this._setVoiceAudioStreamState('error');
          reject(event);
        }, { once: true });
      });
    }

    this.voiceSocketReady = false;
    this._setVoiceSocketState('connecting');
    this.voiceSocket = new WebSocket(`${WS_BASE}/api/voice/ws`);
    this.voiceSocket.addEventListener('message', (event) => this._handleVoiceSocketMessage(event));
    this.voiceSocket.addEventListener('close', () => {
      this.voiceSocketReady = false;
      this.wsAudioStreamActive = false;
      this.voiceAudioStreamEnding = false;
      this._clearVoiceAudioStreamMaxTimer();
      this._setVoiceSocketState('closed');
      if (this.status.voiceAudioStreamState !== 'error') {
        this._setVoiceAudioStreamState('idle');
      }
    });
    return new Promise((resolve, reject) => {
      this.voiceSocket.addEventListener('open', () => {
        this.voiceSocketReady = true;
        this._setVoiceSocketState('connected');
        resolve(this.voiceSocket);
      }, { once: true });
      this.voiceSocket.addEventListener('error', (event) => {
        this._setVoiceSocketState('error');
        this._setVoiceAudioStreamState('error');
        reject(event);
      }, { once: true });
    });
  }

  async startVoiceAudioStream() {
    if (!this.session || this.wsAudioStreamActive) return false;
    const socket = await this.connectVoiceSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    this.wsAudioStreamActive = true;
    this.voiceAudioStreamSpeechTurnId = this.voiceSpeechTurnId;
    this._setVoiceAudioStreamState('streaming');
    this._startVoiceAudioStreamMaxTimer();
    socket.send(JSON.stringify({
      type: 'voice.audio.start',
      voice_session_id: this.session.voice_session_id,
      session_id: this.session.session_id || this.getSessionId() || null,
      mime_type: this.micCapture && this.micCapture.status ? this.micCapture.status.mimeType || 'audio/webm' : 'audio/webm',
    }));
    return true;
  }

  async _handleMicrophoneChunk(chunk) {
    if (!this.wsAudioStreamActive || !this.voiceSocket || this.voiceSocket.readyState !== WebSocket.OPEN) return false;
    if (!chunk || !chunk.blob || typeof chunk.blob.arrayBuffer !== 'function') return false;
    const audio = arrayBufferToBase64(await chunk.blob.arrayBuffer());
    this.voiceSocket.send(JSON.stringify({
      type: 'voice.audio.chunk',
      audio,
    }));
    return true;
  }

  async endVoiceAudioStream(speechEndReason = ORACLE_TRAILING_SILENCE_END_REASON) {
    if (!this.wsAudioStreamActive || !this.voiceSocket || this.voiceSocket.readyState !== WebSocket.OPEN) return false;
    if (this.voiceAudioStreamEnding) return false;
    this.voiceAudioStreamEnding = true;
    const endReason = normalizeSpeechEndReason(speechEndReason);
    this._clearVoiceAudioStreamMaxTimer();
    if (this.micCapture && typeof this.micCapture.flushCurrentData === 'function') {
      try {
        await this.micCapture.flushCurrentData();
      } catch (_) {}
    }
    this.voiceSocket.send(JSON.stringify({
      type: 'voice.audio.end',
      end_reason: endReason,
    }));
    this.wsAudioStreamActive = false;
    this.voiceAudioStreamEnding = false;
    this._setVoiceAudioStreamState('transcribing');
    this.status = {
      ...this.status,
      speechState: 'transcribing',
      label: 'Transcribing',
    };
    this._publish({ serverTranscriptionState: 'transcribing' });
    return true;
  }

  closeVoiceSocket() {
    this.wsAudioStreamActive = false;
    this.voiceAudioStreamEnding = false;
    this.voiceAudioStreamSpeechTurnId = null;
    this._clearVoiceAudioStreamMaxTimer();
    this._setVoiceAudioStreamState('idle');
    this.voiceSocketReady = false;
    if (this.voiceSocket && this.voiceSocket.readyState <= WebSocket.OPEN) {
      try { this.voiceSocket.close(); } catch (_) {}
    }
    this.voiceSocket = null;
    this._setVoiceSocketState('closed');
  }

  _handleVoiceSocketMessage(event) {
    let data = null;
    try {
      data = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (data.type === 'voice.transcript.final' && data.text) {
      this._handleVoiceSocketFinalTranscript(data);
      return;
    }
    if (data.type === 'voice.transcript.empty') {
      this._handleVoiceSocketEmptyTranscript(data);
      return;
    }
    if (data.type === 'voice.transcript.partial') {
      const partialTranscript = data && typeof data.text === 'string' ? data.text.trim() : '';
      if (!partialTranscript) return;
      const diagnostics = this._sanitizeTranscriptDiagnostics(data.diagnostics);
      this._setLastTranscriptDiagnostics(diagnostics);
      this._setVoiceAudioStreamState('transcribing');
      this.status = {
        ...this.status,
        speechState: 'transcribing',
        label: 'Transcribing',
        partialTranscript,
        partialTranscriptSupported: Boolean(this.config && this.config.supports_partial_transcripts),
      };
      this._publish({ partialTranscript, transcriptDiagnostics: diagnostics, serverTranscriptionState: 'transcribing' });
      return;
    }
    if (data.type === 'voice.error') {
      this.wsAudioStreamActive = false;
      this.voiceAudioStreamEnding = false;
      this.voiceAudioStreamSpeechTurnId = null;
      this._clearVoiceAudioStreamMaxTimer();
      this._setVoiceAudioStreamState('error');
      this.status = {
        ...this.status,
        speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
        label: this._labelForState(this.status.state),
      };
      this.showError(`O.R.A.C.L.E. audio stream failed: ${data.message || data.code || 'unknown error'}`);
      this._publish({ serverTranscriptionState: 'idle', error: data.message || data.code });
    }
  }

  _startVoiceAudioStreamMaxTimer() {
    this._clearVoiceAudioStreamMaxTimer();
    this.voiceAudioStreamMaxTimer = window.setTimeout(() => this.endVoiceAudioStream(ORACLE_MAX_SPEECH_END_REASON), ORACLE_MAX_AUDIO_STREAM_MS);
  }

  _clearVoiceAudioStreamMaxTimer() {
    if (!this.voiceAudioStreamMaxTimer) return;
    window.clearTimeout(this.voiceAudioStreamMaxTimer);
    this.voiceAudioStreamMaxTimer = null;
  }

  _handleVoiceSocketEmptyTranscript(data) {
    this._clearVoiceAudioStreamMaxTimer();
    const transcriptSource = {
      source: 'voice.websocket',
      voiceSessionId: data.voice_session_id,
      sessionId: data.session_id,
      mimeType: data.mime_type,
      submitToChat: false,
      speechTurnId: this.voiceAudioStreamSpeechTurnId || this.voiceSpeechTurnId,
    };
    this.voiceAudioStreamSpeechTurnId = null;
    this._setLastTranscriptSource(transcriptSource);
    this._setVoiceAudioStreamState('idle');
    this.status = {
      ...this.status,
      speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
      label: this._labelForState(this.status.state),
    };
    this._publish({
      transcriptEmpty: true,
      transcriptSubmitted: false,
      transcriptSource,
      serverTranscriptionState: 'ready',
    });
    return false;
  }

  _handleVoiceSocketFinalTranscript(data) {
    this._clearVoiceAudioStreamMaxTimer();
    const text = data && typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return false;
    const diagnostics = this._sanitizeTranscriptDiagnostics(data.diagnostics);
    const transcriptSource = {
      source: 'voice.websocket',
      voiceSessionId: data.voice_session_id,
      sessionId: data.session_id,
      mimeType: data.mime_type,
      submitToChat: data.submit_to_chat === true,
      speechTurnId: this.voiceAudioStreamSpeechTurnId || this.voiceSpeechTurnId,
    };
    this.voiceAudioStreamSpeechTurnId = null;
    this._setLastTranscriptSource(transcriptSource);
    this._setLastTranscriptDiagnostics(diagnostics);
    this._setVoiceAudioStreamState('idle');
    if (data.submit_to_chat !== true) {
      this.status = {
        ...this.status,
        speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
        label: this._labelForState(this.status.state),
      };
      this._publish({
          finalTranscript: text,
          transcriptSubmitted: false,
          transcriptSource,
          transcriptDiagnostics: diagnostics,
          serverTranscriptionState: 'ready',
        });
        return false;
      }
      const accepted = this.handleFinalTranscript(data.text, transcriptSource);
      this._publish({
        transcriptSource,
        transcriptDiagnostics: diagnostics,
        transcriptSubmitted: Boolean(accepted),
        serverTranscriptionState: 'ready',
      });
      return accepted;
    }

  _setVoiceSocketState(state, extra = {}) {
    this.status = {
      ...this.status,
      voiceSocketState: state,
    };
    this._publish({ voiceSocketState: state, ...extra });
  }

  _setVoiceAudioStreamState(state, extra = {}) {
    this.status = {
      ...this.status,
      voiceAudioStreamState: state,
    };
    this._publish({ voiceAudioStreamState: state, ...extra });
  }

  _setCartesiaRealtimeSttState(state, extra = {}) {
    const latency = this._sanitizeTranscriptDiagnostics(extra);
    this.status = {
      ...this.status,
      cartesiaRealtimeSttState: state,
      ...(latency ? { cartesiaRealtimeSttLatency: latency } : {}),
    };
    this._publish({
      cartesiaRealtimeSttState: state,
      ...(latency ? { cartesiaRealtimeSttLatency: latency } : {}),
      ...extra,
    });
    if (state === 'ready') {
      this._scheduleCartesiaRealtimeSttRewarm();
    }
  }

  _scheduleCartesiaRealtimeSttRewarm(delayMs = 0) {
    if (!this.session || !this.status.active || this.status.state === 'cancelled') return;
    if (this.cartesiaRealtimeSttActive || !this._shouldUseCartesiaRealtimeStt()) return;
    window.setTimeout(() => {
      if (!this.session || !this.status.active || this.status.state === 'cancelled') return;
      if (this.cartesiaRealtimeSttActive || !this._shouldUseCartesiaRealtimeStt()) return;
      if (this._isCartesiaRealtimeSttFinalizing()) {
        this._publish({ cartesiaRealtimeSttRewarmDeferred: true, cartesiaRealtimeSttState: 'transcribing' });
        this._scheduleCartesiaRealtimeSttRewarm(250);
        return;
      }
      if (this.cartesiaRealtimeStt && typeof this.cartesiaRealtimeStt.stop === 'function') {
        this.cartesiaRealtimeStt.stop();
      }
      this.startCartesiaRealtimeSttStream({ warm: true }).catch(() => {});
    }, Math.max(0, Number(delayMs) || 0));
  }

  _setLastTranscriptSource(transcriptSource) {
    this.status = {
      ...this.status,
      lastTranscriptSource: transcriptSource,
    };
  }

  _sanitizeTranscriptDiagnostics(diagnostics) {
    if (!diagnostics || typeof diagnostics !== 'object') return null;
    const safe = {};
    for (const key of ['provider', 'mode', 'model', 'encoding', 'quality_gate', 'transport']) {
      const value = diagnostics[key];
      if (typeof value === 'string' && value) {
        safe[key] = value.slice(0, 80);
      }
    }
    for (const key of ['bytes_received', 'chunk_count', 'decode_attempt', 'socket_reused', 'completed', 'failed']) {
      const value = diagnostics[key];
      if (Number.isInteger(value) && value >= 0) {
        safe[key] = value;
      }
    }
    for (const key of [
      'decode_ms',
      'avg_logprob',
      'no_speech_prob',
      'compression_ratio',
      'language_probability',
      'socket_ready_ms',
      'turn_to_socket_ready_ms',
      'finalize_to_final_ms',
      'turn_to_final_ms',
    ]) {
      const value = diagnostics[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        safe[key] = value;
      }
    }
    return Object.keys(safe).length ? safe : null;
  }

  _setLastTranscriptDiagnostics(diagnostics) {
    this.status = {
      ...this.status,
      lastTranscriptDiagnostics: diagnostics,
    };
  }

  _setLastTranscriptFilter(filter) {
    const voiceInputHealth = this._voiceInputHealthForFilter(filter);
    const rejected = voiceInputHealth && voiceInputHealth.key !== 'accepted';
    this.status = {
      ...this.status,
      lastTranscriptFilter: filter,
      voiceInputHealth: rejected ? voiceInputHealth : null,
      voiceInputRejectCount: rejected ? (this.status.voiceInputRejectCount || 0) + 1 : 0,
    };
  }

  _voiceInputHealthForFilter(filter) {
    if (!filter || typeof filter !== 'object') return null;
    const reason = filter.reason || '';
    const heardText = typeof filter.heardText === 'string' ? filter.heardText : '';
    const suffix = heardText ? ` Heard: "${heardText}"` : '';
    if (reason === 'background_noise') {
      return {
        key: 'background_noise',
        label: 'Noise',
        title: `Background audio was not sent to chat.${suffix}`,
      };
    }
    if (reason === 'oracle_playback_echo') {
      return {
        key: 'oracle_playback_echo',
        label: 'Echo',
        title: `O.R.A.C.L.E. playback echo was ignored.${suffix}`,
      };
    }
    if (reason === 'duplicate_voice_transcript') {
      return {
        key: 'duplicate_voice_transcript',
        label: 'Repeat',
        title: `Repeated transcript was not sent twice.${suffix}`,
      };
    }
    if (reason === 'accepted') {
      return {
        key: 'accepted',
        label: 'Heard',
        title: 'Voice input accepted',
      };
    }
    return null;
  }

  async transcribeBufferedAudioWithServerStt() {
    if (!this.config || !this.config.supports_server_stt_final_utterance) return false;
    if (this._shouldUseVoiceWebSocket()) return false;
    if (this.serverSttInFlight) return false;
    if (
      !this._shouldPreferServerSpeechToChat() &&
      this.speechRecognition &&
      this.speechRecognition.status &&
      this.speechRecognition.status.supported
    ) return false;
    if (!this.micCapture || typeof this.micCapture.consumeBufferedAudio !== 'function') return false;
    const audioBlob = this.micCapture.consumeBufferedAudio();
    if (!audioBlob || audioBlob.size <= 0) return false;

    this.serverSttInFlight = true;
    this.status = {
      ...this.status,
      speechState: 'transcribing',
      label: 'Transcribing',
    };
    this._publish({ serverTranscriptionState: 'transcribing' });

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'oracle-utterance.webm');
      const response = await this.fetchImpl(`${API_BASE}/api/stt/transcribe`, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      if (!response.ok) throw new Error(`Server STT failed: ${response.status}`);
      const data = await response.json();
      const text = data && typeof data.text === 'string' ? data.text.trim() : '';
      if (!text) return false;
      return this.handleFinalTranscript(text, this._voiceTranscriptSource('voice.server_stt_final', {
        mimeType: audioBlob.type || 'audio/webm',
      }));
    } catch (error) {
      this.showError(`O.R.A.C.L.E. transcription failed: ${normalizeError(error, 'server STT failed')}`);
      return false;
    } finally {
      this.serverSttInFlight = false;
      this.status = {
        ...this.status,
        speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
        label: this._labelForState(this.status.state),
      };
      this._publish({ serverTranscriptionState: 'idle' });
    }
  }

  _voiceTranscriptSource(source, extra = {}) {
    const transcriptSource = {
      source: source,
      voiceSessionId: this.session ? this.session.voice_session_id : null,
      sessionId: this.session && this.session.session_id ? this.session.session_id : this.getSessionId() || null,
      submitToChat: true,
      speechTurnId: this.voiceSpeechTurnId,
    };
    return {
      ...transcriptSource,
      ...extra,
    };
  }

  handleFinalTranscript(transcript, transcriptSource = {}) {
    const text = typeof transcript === 'string' ? transcript.trim() : '';
    if (!text) return false;
    const isVoiceTranscript = typeof transcriptSource.source === 'string' && transcriptSource.source.startsWith('voice.');
    const prepared = isVoiceTranscript
      ? this._prepareVoiceTranscriptForChat(text, transcriptSource)
      : { accepted: true, text, filter: null };
    if (!prepared.accepted) {
      this._setLastTranscriptSource(transcriptSource);
      this._setLastTranscriptFilter(prepared.filter);
      this.status = {
        ...this.status,
        speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
        label: this._labelForState(this.status.state),
      };
      this._publish({
        finalTranscript: text,
        transcriptSubmitted: false,
        transcriptRejected: true,
        transcriptRejectReason: prepared.filter ? prepared.filter.reason : 'voice_filter',
        transcriptSource,
        transcriptFilter: prepared.filter,
      });
      return false;
    }
    if (prepared.filter) {
      this._setLastTranscriptFilter(prepared.filter);
    }
    const transcriptSpeechTurnId = Number.isInteger(transcriptSource.speechTurnId)
      ? transcriptSource.speechTurnId
      : this.voiceSpeechTurnId;
    if (
      isVoiceTranscript &&
      this.voiceSpeechTurnSubmitted &&
      transcriptSource.speechTurnId === this.voiceSubmittedSpeechTurnId
    ) {
      this._publish({
        finalTranscript: prepared.text,
        transcriptSubmitted: false,
        transcriptSource,
        voiceTurnDuplicateTranscript: true,
        transcriptFilter: prepared.filter,
      });
      return false;
    }
    this._setLastTranscriptSource(transcriptSource);
    this.status = {
      ...this.status,
      speechState: 'transcribing',
      label: 'Transcribing',
    };
    this._publish({ finalTranscript: prepared.text, transcriptSource, transcriptFilter: prepared.filter });
    const accepted = this.onFinalTranscript(prepared.text, {
      session: this.session,
      status: { ...this.status },
      transcriptSource,
      transcriptFilter: prepared.filter,
    });
    if (isVoiceTranscript && accepted) {
      this.voiceSpeechTurnSubmitted = true;
      this.voiceSubmittedSpeechTurnId = transcriptSpeechTurnId;
      this._rememberAcceptedVoiceTranscript(prepared.text);
    }
    this.status = {
      ...this.status,
      speechState: this.session && this.session.speech_state ? this.session.speech_state : 'idle',
      label: this._labelForState(this.status.state),
    };
    this._publish({
      finalTranscript: prepared.text,
      transcriptSubmitted: Boolean(accepted),
      transcriptSource,
      transcriptFilter: prepared.filter,
      transcriptAutocorrected: Boolean(prepared.filter && prepared.filter.autocorrected),
    });
    return accepted;
  }

  _prepareVoiceTranscriptForChat(transcript, transcriptSource = {}) {
    const rawText = typeof transcript === 'string' ? transcript.trim() : '';
    const normalized = rawText
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.?!;:])/g, '$1')
      .trim();
    const source = transcriptSource.source || 'voice';
    if (this._isOracleEchoGuardActive()) {
      return {
        accepted: false,
        text: normalized,
        filter: {
          reason: 'oracle_playback_echo',
          source,
          heardText: normalized.slice(0, 80),
        },
      };
    }
    if (!normalized || this._looksLikeBackgroundNoiseTranscript(normalized)) {
      return {
        accepted: false,
        text: normalized,
        filter: {
          reason: 'background_noise',
          source,
          heardText: normalized.slice(0, 80),
        },
      };
    }
    const collapsed = this._collapseRepeatedVoiceWords(normalized);
    const corrected = this._autocorrectVoiceTranscript(collapsed);
    if (this._isDuplicateVoiceTranscript(corrected)) {
      return {
        accepted: false,
        text: corrected,
        filter: {
          reason: 'duplicate_voice_transcript',
          source,
          heardText: corrected.slice(0, 80),
        },
      };
    }
    const filter = {
      reason: 'accepted',
      source,
      autocorrected: corrected !== rawText,
      backgroundNoiseChecked: true,
    };
    return {
      accepted: true,
      text: corrected,
      filter,
    };
  }

  _looksLikeBackgroundNoiseTranscript(transcript) {
    const text = typeof transcript === 'string' ? transcript.trim() : '';
    if (!text) return true;
    if (!/[a-z0-9]/i.test(text)) return true;
    if (this._looksLikeDanglingVoiceFragment(text)) return true;
    if (this._looksLikeShortUncommandedFragment(text)) return true;
    if (this._looksLikeUnaddressedMediaTranscript(text)) return true;
    return ORACLE_NOISE_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text));
  }

  _looksLikeShortUncommandedFragment(transcript) {
    const normalized = String(transcript || '')
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .trim();
    if (!normalized) return true;
    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length > 2) return false;
    return !ORACLE_SHORT_VOICE_INTENT_PATTERNS.some((pattern) => pattern.test(transcript))
      && !ORACLE_DIRECTED_VOICE_PATTERNS.some((pattern) => pattern.test(transcript));
  }

  _looksLikeUnaddressedMediaTranscript(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return true;
    return !ORACLE_DIRECTED_VOICE_PATTERNS.some((pattern) => pattern.test(text));
  }

  _looksLikeDanglingVoiceFragment(transcript) {
    const words = String(transcript || '')
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0 || words.length > 4) return false;
    const lastWord = words[words.length - 1];
    return ['with', 'to', 'for', 'from', 'of', 'and', 'or', 'but', 'the', 'a', 'an'].includes(lastWord);
  }

  _collapseRepeatedVoiceWords(transcript) {
    return transcript.replace(/\b([a-z][a-z']{1,24})(?:\s+\1\b){2,}/gi, '$1');
  }

  _voiceTranscriptKey(transcript) {
    return String(transcript || '')
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _isDuplicateVoiceTranscript(transcript) {
    const key = this._voiceTranscriptKey(transcript);
    if (!key || !this.lastAcceptedVoiceTranscript) return false;
    return key === this.lastAcceptedVoiceTranscript
      && this._nowMs() - this.lastAcceptedVoiceTranscriptAt < ORACLE_DUPLICATE_TRANSCRIPT_WINDOW_MS;
  }

  _rememberAcceptedVoiceTranscript(transcript) {
    const key = this._voiceTranscriptKey(transcript);
    if (!key) return;
    this.lastAcceptedVoiceTranscript = key;
    this.lastAcceptedVoiceTranscriptAt = this._nowMs();
  }

  _autocorrectVoiceTranscript(transcript) {
    return transcript
      .replace(/\bO(?:[\s.]+)R(?:[\s.]+)A(?:[\s.]+)C(?:[\s.]+)L(?:[\s.]+)E\b/gi, 'O.R.A.C.L.E.')
      .replace(/\boracole\b/gi, 'oracle')
      .replace(/\bodyseus\b/gi, 'Odysseus')
      .replace(/\bcartesh?a\b/gi, 'Cartesia')
      .replace(/\bs\s*t\s*t\b/gi, 'STT')
      .replace(/\bt\s*t\s*s\b/gi, 'TTS')
      .trim();
  }

  _syncFromSession(session, active) {
    const state = session.state || 'idle';
    this.status = {
      ...this.status,
      available: true,
      active,
      state,
      speechState: session.speech_state || 'idle',
      executionState: session.execution_state || 'idle',
      microphoneState: this.micCapture ? this.micCapture.status.state : this.status.microphoneState,
      microphone: this.micCapture ? { ...this.micCapture.status } : this.status.microphone,
      speechRecognitionState: this.speechRecognition ? this.speechRecognition.status.state : this.status.speechRecognitionState,
      speechRecognition: this.speechRecognition ? { ...this.speechRecognition.status } : this.status.speechRecognition,
      label: this._labelForState(state),
    };
    this._publish();
  }

  _labelForState(state) {
    if (state === 'listening') return 'Listening';
    if (state === 'interrupted') return 'Interrupted';
    if (state === 'cancelled') return 'Cancelled';
    if (state === 'working') return 'Working';
    if (state === 'speaking') return 'Speaking';
    if (state === 'thinking') return 'Thinking';
    if (state === 'transcribing') return 'Transcribing';
    return 'Ready';
  }

  _publish(extra = {}) {
    const { status: _childStatus, session: _childSession, config: _childConfig, ...safeExtra } = extra || {};
    const detail = {
      ...safeExtra,
      status: { ...this.status },
      session: this.session,
      config: this.config,
    };
    this.dispatchEvent(new CustomEvent('oraclevoice:state', { detail }));
    window.dispatchEvent(new CustomEvent('oraclevoice:state', { detail }));
  }
}

export default {
  OracleVoiceRuntime,
};
