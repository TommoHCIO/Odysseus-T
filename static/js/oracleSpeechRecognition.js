const DUPLICATE_FINAL_TRANSCRIPT_WINDOW_MS = 2500;
const MIN_FINAL_TRANSCRIPT_CONFIDENCE = 0.55;
const SPEECH_RECOGNITION_UNAVAILABLE_ERRORS = new Set(['network', 'service-not-allowed']);

function getSpeechRecognitionClass(windowRef = window) {
  if (!windowRef) return null;
  if (windowRef === window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    return SpeechRecognition || null;
  }
  return windowRef.SpeechRecognition || windowRef.webkitSpeechRecognition || null;
}

export class OracleSpeechRecognition extends EventTarget {
  constructor(options = {}) {
    super();
    this.windowRef = options.windowRef || window;
    this.onFinalTranscript = options.onFinalTranscript || (() => {});
    this.onInterimTranscript = options.onInterimTranscript || (() => {});
    this.showError = options.showError || (() => {});
    this.recognition = null;
    this.restartTimer = null;
    this.shouldBeRunning = false;
    this.lastFinalTranscriptAt = 0;
    this.status = {
      supported: Boolean(getSpeechRecognitionClass(this.windowRef)),
      state: 'idle',
      interimTranscript: '',
      lastFinalTranscript: '',
      lastFinalTranscriptConfidence: null,
      lastRejectedTranscript: '',
      lastError: null,
    };
  }

  start() {
    if (!this.status.supported) {
      this.status = { ...this.status, state: 'unsupported' };
      this._publish();
      return this.status;
    }
    this.shouldBeRunning = true;
    if (this.status.state === 'listening') return this.status;
    this._clearRestart();
    this._createRecognition();
    try {
      this.recognition.start();
      this.status = { ...this.status, state: 'listening', lastError: null };
      this._publish();
    } catch (error) {
      const message = normalizeSpeechError(error);
      const unavailable = isSpeechRecognitionUnavailableError(message);
      this.status = {
        ...this.status,
        supported: unavailable ? false : this.status.supported,
        state: unavailable ? 'unavailable' : 'error',
        lastError: message,
      };
      this._publish();
    }
    return this.status;
  }

  stop(state = 'idle') {
    this.shouldBeRunning = false;
    this._clearRestart();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        try {
          this.recognition.abort();
        } catch (_abortError) {
          // The browser recognizer may already be stopped.
        }
      }
    }
    this.status = {
      ...this.status,
      state,
      interimTranscript: '',
    };
    this._publish();
    return this.status;
  }

  _createRecognition() {
    const SpeechRecognition = getSpeechRecognitionClass(this.windowRef);
    this.recognition = new SpeechRecognition();
    // Bounded utterance mode lets Chrome finalize short commands more reliably.
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.lang = (this.windowRef.navigator && this.windowRef.navigator.language) || 'en-US';
    this.recognition.onresult = (event) => this._handleResult(event);
    this.recognition.onerror = (event) => this._handleError(event);
    this.recognition.onend = () => this._handleEnd();
  }

  _handleResult(event) {
    let finalTranscript = '';
    let interimTranscript = '';
    let finalConfidence = null;
    const startIndex = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    for (let index = startIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result && result[0] ? result[0].transcript.trim() : '';
      if (!transcript) continue;
      if (result.isFinal) {
        finalTranscript += `${transcript} `;
        finalConfidence = highestTranscriptConfidence(finalConfidence, this._finalTranscriptConfidence(result));
      } else {
        interimTranscript += `${transcript} `;
      }
    }

    const interim = interimTranscript.trim();
    if (interim) {
      this.status = { ...this.status, interimTranscript: interim };
      this.onInterimTranscript(interim);
      this._publish({ interimTranscript: interim });
    }

    const finalText = finalTranscript.trim();
    if (finalText) {
      if (this._isLowConfidenceFinalTranscript(finalConfidence)) {
        this.status = {
          ...this.status,
          interimTranscript: '',
          lastRejectedTranscript: finalText,
          lastFinalTranscriptConfidence: finalConfidence,
        };
        this._publish({
          rejectedFinalTranscript: true,
          rejectedTranscript: finalText,
          finalTranscriptConfidence: finalConfidence,
          rejectionReason: 'low_confidence',
        });
        return;
      }
      if (this._isDuplicateFinalTranscript(finalText)) {
        this._publish({
          finalTranscript: finalText,
          finalTranscriptConfidence: finalConfidence,
          duplicateFinalTranscript: true,
        });
        return;
      }
      this.status = {
        ...this.status,
        interimTranscript: '',
        lastFinalTranscript: finalText,
        lastFinalTranscriptConfidence: finalConfidence,
      };
      this.lastFinalTranscriptAt = Date.now();
      this.onFinalTranscript(finalText);
      this._publish({ finalTranscript: finalText, finalTranscriptConfidence: finalConfidence });
    }
  }

  _finalTranscriptConfidence(result) {
    const confidence = result && result[0] ? result[0].confidence : null;
    return Number.isFinite(confidence) ? confidence : null;
  }

  _isLowConfidenceFinalTranscript(finalConfidence) {
    const confidence = finalConfidence;
    return Number.isFinite(confidence)
      && confidence > 0
      && confidence < MIN_FINAL_TRANSCRIPT_CONFIDENCE;
  }

  _isDuplicateFinalTranscript(finalText) {
    const normalizedText = normalizeTranscriptText(finalText);
    const normalizedLast = normalizeTranscriptText(this.status.lastFinalTranscript);
    if (!normalizedText || normalizedText !== normalizedLast) return false;
    return Date.now() - this.lastFinalTranscriptAt <= DUPLICATE_FINAL_TRANSCRIPT_WINDOW_MS;
  }

  _handleError(event) {
    const message = normalizeSpeechError(event);
    const unavailable = isSpeechRecognitionUnavailableError(message);
    if (unavailable) {
      this.shouldBeRunning = false;
    }
    this.status = {
      ...this.status,
      supported: unavailable ? false : this.status.supported,
      state: unavailable ? 'unavailable' : 'error',
      lastError: message,
    };
    if (!['aborted', 'no-speech'].includes(event.error) && !unavailable) {
      this.showError(`O.R.A.C.L.E. speech recognition failed: ${message}`);
    }
    this._publish({ error: message, speechRecognitionUnavailable: unavailable });
  }

  _handleEnd() {
    if (!this.shouldBeRunning) {
      this.status = { ...this.status, state: this.status.state === 'cancelled' ? 'cancelled' : 'idle' };
      this._publish();
      return;
    }
    this.status = { ...this.status, state: 'restarting' };
    this._publish();
    this._clearRestart();
    this.restartTimer = this.windowRef.setTimeout(() => this.start(), 250);
  }

  _clearRestart() {
    if (!this.restartTimer) return;
    this.windowRef.clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  _publish(extra = {}) {
    const detail = { status: { ...this.status }, ...extra };
    this.dispatchEvent(new CustomEvent('oraclevoice:speech-recognition', { detail }));
  }
}

function normalizeSpeechError(error) {
  if (!error) return 'unknown speech recognition error';
  if (error.error) return error.error;
  if (error.message) return error.message;
  return String(error);
}

function isSpeechRecognitionUnavailableError(error) {
  return SPEECH_RECOGNITION_UNAVAILABLE_ERRORS.has(String(error || '').trim());
}

function normalizeTranscriptText(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function highestTranscriptConfidence(currentConfidence, nextConfidence) {
  if (!Number.isFinite(nextConfidence)) return currentConfidence;
  if (!Number.isFinite(currentConfidence)) return nextConfidence;
  return Math.max(currentConfidence, nextConfidence);
}

export default {
  OracleSpeechRecognition,
};
