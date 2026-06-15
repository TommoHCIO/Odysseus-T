import { OracleVoiceActivityDetector } from './voiceActivityDetection.js';

const DEFAULT_TIMESLICE_MS = 250;
const DEFAULT_MAX_BUFFERED_CHUNKS = 120;
export const ORACLE_MIC_DEVICE_ID_STORAGE_KEY = 'odysseus.oracle.preferredMicrophoneDeviceId';
export const ORACLE_MIC_DEVICE_LABEL_STORAGE_KEY = 'odysseus.oracle.preferredMicrophoneDeviceLabel';

function pickSupportedMimeType(mediaRecorderClass) {
  if (!mediaRecorderClass || typeof mediaRecorderClass.isTypeSupported !== 'function') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(type => mediaRecorderClass.isTypeSupported(type)) || '';
}

function normalizeCaptureError(error) {
  const name = error && error.name ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { state: 'denied', message: 'Microphone access denied. Check browser permissions.' };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { state: 'unavailable', message: 'No microphone found.' };
  }
  return { state: 'error', message: error && error.message ? `Microphone error: ${error.message}` : 'Microphone error.' };
}

function isDeviceSelectionError(error) {
  const name = error && error.name ? error.name : '';
  return name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError';
}

function readStorage(windowRef, key) {
  try {
    return windowRef && windowRef.localStorage ? String(windowRef.localStorage.getItem(key) || '').trim() : '';
  } catch (_) {
    return '';
  }
}

function writeStorage(windowRef, key, value) {
  try {
    if (!windowRef || !windowRef.localStorage) return;
    if (value) windowRef.localStorage.setItem(key, value);
    else windowRef.localStorage.removeItem(key);
  } catch (_) {}
}

function selectedAudioTrackLabel(stream) {
  if (!stream || typeof stream.getAudioTracks !== 'function') return '';
  const track = stream.getAudioTracks()[0];
  return track && track.label ? track.label : '';
}

export class OracleMicCapture extends EventTarget {
  constructor(options = {}) {
    super();
    this.windowRef = options.windowRef || window;
    this.navigatorRef = options.navigatorRef || this.windowRef.navigator;
    this.timesliceMs = options.timesliceMs || DEFAULT_TIMESLICE_MS;
    this.maxBufferedChunks = options.maxBufferedChunks || DEFAULT_MAX_BUFFERED_CHUNKS;
    this.showError = options.showError || (() => {});
    this.onChunk = options.onChunk || (() => {});
    this.voiceActivityDetector = options.voiceActivityDetector || new OracleVoiceActivityDetector({ windowRef: this.windowRef });
    this.preferredDeviceId = String(options.preferredDeviceId || '').trim();
    this.preferredDeviceLabel = String(options.preferredDeviceLabel || '').trim();
    this.stream = null;
    this.mediaRecorder = null;
    this.chunks = [];
    this.status = {
      supported: this.isSupported(),
      state: 'idle',
      chunkCount: 0,
      lastChunkAt: null,
      mimeType: '',
      error: null,
      selectedDeviceLabel: '',
      preferredDeviceLabel: this.getPreferredDevice().label || '',
      voiceActivityState: this.voiceActivityDetector ? this.voiceActivityDetector.status.state : 'idle',
      voiceActivity: this.voiceActivityDetector ? { ...this.voiceActivityDetector.status } : null,
    };
    if (this.voiceActivityDetector && typeof this.voiceActivityDetector.addEventListener === 'function') {
      this.voiceActivityDetector.addEventListener('oraclevoice:activity', (event) => {
        const voiceActivity = event.detail && event.detail.status ? event.detail.status : this.voiceActivityDetector.status;
        this._setStatus({
          voiceActivityState: voiceActivity.state,
          voiceActivity: { ...voiceActivity },
        }, {
          voiceActivity: { ...voiceActivity },
          voiceActivityEvent: event.detail && event.detail.type ? event.detail.type : '',
        });
      });
    }
  }

  isSupported() {
    return Boolean(
      this.windowRef &&
      this.windowRef.isSecureContext &&
      this.navigatorRef &&
      this.navigatorRef.mediaDevices &&
      typeof this.navigatorRef.mediaDevices.getUserMedia === 'function' &&
      this.windowRef.MediaRecorder
    );
  }

  async start() {
    if (this.status.state === 'capturing' || this.status.state === 'requesting') {
      return { ...this.status };
    }

    if (!this.isSupported()) {
      this._setStatus({
        supported: false,
        state: 'unavailable',
        error: 'Microphone capture is not available in this browser.',
      });
      this.showError('Microphone capture is not available in this browser.');
      return { ...this.status };
    }

    this._setStatus({ supported: true, state: 'requesting', error: null });

    try {
      const preferredDevice = this.getPreferredDevice();
      let stream = null;
      let preferredDeviceError = null;
      try {
        stream = await this.navigatorRef.mediaDevices.getUserMedia({
          audio: this._audioConstraints(preferredDevice),
        });
      } catch (error) {
        if (!preferredDevice.deviceId || !isDeviceSelectionError(error)) throw error;
        preferredDeviceError = normalizeCaptureError(error).message;
        stream = await this.navigatorRef.mediaDevices.getUserMedia({
          audio: this._audioConstraints(null),
        });
      }
      const MediaRecorderClass = this.windowRef.MediaRecorder;
      const mimeType = pickSupportedMimeType(MediaRecorderClass);
      const recorderOptions = mimeType ? { mimeType } : undefined;
      const recorder = this._createRecorder(stream, recorderOptions, { stopTracksOnStop: true });

      this.stream = stream;
      this.mediaRecorder = recorder;
      this.chunks = [];
      if (this.voiceActivityDetector && typeof this.voiceActivityDetector.start === 'function') {
        this.voiceActivityDetector.start(stream);
      }
      recorder.start(this.timesliceMs);
      this._setStatus({
        state: 'capturing',
        mimeType: recorder.mimeType || mimeType || 'audio/webm',
        chunkCount: 0,
        lastChunkAt: null,
        error: null,
        selectedDeviceLabel: selectedAudioTrackLabel(stream),
        preferredDeviceLabel: preferredDevice.label || '',
        preferredDeviceError,
        voiceActivityState: this.voiceActivityDetector ? this.voiceActivityDetector.status.state : 'idle',
        voiceActivity: this.voiceActivityDetector ? { ...this.voiceActivityDetector.status } : null,
      });
      return { ...this.status };
    } catch (error) {
      this._handleError(error);
      return { ...this.status };
    }
  }

  setPreferredDevice(device, options = {}) {
    const persist = options.persist !== false;
    const nextDevice = device || {};
    this.preferredDeviceId = String(nextDevice.deviceId || '').trim();
    this.preferredDeviceLabel = String(nextDevice.label || '').trim();
    if (persist) {
      writeStorage(this.windowRef, ORACLE_MIC_DEVICE_ID_STORAGE_KEY, this.preferredDeviceId);
      writeStorage(this.windowRef, ORACLE_MIC_DEVICE_LABEL_STORAGE_KEY, this.preferredDeviceLabel);
    }
    this._setStatus({
      preferredDeviceLabel: this.preferredDeviceLabel,
      preferredDeviceError: null,
    });
    return this.getPreferredDevice();
  }

  getPreferredDevice() {
    const deviceId = this.preferredDeviceId || readStorage(this.windowRef, ORACLE_MIC_DEVICE_ID_STORAGE_KEY);
    const label = this.preferredDeviceLabel || readStorage(this.windowRef, ORACLE_MIC_DEVICE_LABEL_STORAGE_KEY);
    return { deviceId, label };
  }

  stop(state = 'idle') {
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (_) {
        this._stopTracks();
      }
    } else {
      this._stopTracks();
    }
    if (this.voiceActivityDetector && typeof this.voiceActivityDetector.stop === 'function') {
      this.voiceActivityDetector.stop(state);
    }
    this.mediaRecorder = null;
    this._setStatus({ state });
  }

  getBufferedChunks() {
    return this.chunks.slice();
  }

  consumeBufferedAudio() {
    if (!this.chunks.length) return null;
    const mimeType = this.status.mimeType || (this.chunks[0] && this.chunks[0].mimeType) || 'audio/webm';
    const audioBlob = new Blob(this.chunks.map(chunk => chunk.blob), { type: mimeType });
    this.clearBuffer();
    return audioBlob;
  }

  clearBuffer() {
    this.chunks = [];
    this._setStatus({ chunkCount: 0, lastChunkAt: null });
  }

  async restartSegment() {
    const currentRecorder = this.mediaRecorder;
    const stream = this.stream;
    if (!stream || !currentRecorder || currentRecorder.state === 'inactive') {
      this.clearBuffer();
      return false;
    }

    const stopped = new Promise((resolve) => {
      currentRecorder.ondataavailable = () => {};
      currentRecorder.onerror = null;
      currentRecorder.onstop = () => resolve();
    });

    try {
      currentRecorder.stop();
      await Promise.race([
        stopped,
        new Promise(resolve => setTimeout(resolve, 250)),
      ]);
    } catch (_) {
      // Keep the active microphone stream and attempt a fresh recorder below.
    }

    if (!this.stream) return false;

    const MediaRecorderClass = this.windowRef.MediaRecorder;
    const mimeType = this.status.mimeType || pickSupportedMimeType(MediaRecorderClass);
    const recorderOptions = mimeType ? { mimeType } : undefined;
    const recorder = this._createRecorder(stream, recorderOptions, { stopTracksOnStop: true });
    this.mediaRecorder = recorder;
    this.clearBuffer();
    recorder.start(this.timesliceMs);
    this._setStatus({
      state: 'capturing',
      mimeType: recorder.mimeType || mimeType || 'audio/webm',
      error: null,
    });
    return true;
  }

  async flushCurrentData() {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive' || typeof recorder.requestData !== 'function') {
      return false;
    }

    let settled = false;
    return new Promise((resolve) => {
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (typeof recorder.removeEventListener === 'function') {
          recorder.removeEventListener('dataavailable', handleData);
        }
        resolve(result);
      };
      const handleData = (event) => {
        finish(Boolean(event && event.data && event.data.size > 0));
      };
      if (typeof recorder.addEventListener === 'function') {
        recorder.addEventListener('dataavailable', handleData, { once: true });
      }
      try {
        recorder.requestData();
      } catch (_) {
        finish(false);
        return;
      }
      this.windowRef.setTimeout(() => finish(false), Math.max(80, this.timesliceMs));
    });
  }

  _createRecorder(stream, recorderOptions, options = {}) {
    const MediaRecorderClass = this.windowRef.MediaRecorder;
    const recorder = new MediaRecorderClass(stream, recorderOptions);
    const stopTracksOnStop = options.stopTracksOnStop !== false;
    recorder.ondataavailable = (event) => {
      if (!event || !event.data || event.data.size <= 0) return;
      this._rememberChunk(event.data);
    };
    recorder.onerror = (event) => {
      const error = event && event.error ? event.error : new Error('Recorder error');
      this._handleError(error);
    };
    recorder.onstop = () => {
      if (stopTracksOnStop) {
        this._stopTracks();
      }
      if (this.status.state !== 'idle' && this.status.state !== 'cancelled') {
        this._setStatus({ state: 'idle' });
      }
    };
    return recorder;
  }

  _audioConstraints(preferredDevice = null) {
    const constraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (preferredDevice && preferredDevice.deviceId) {
      return {
        ...constraints,
        deviceId: { exact: preferredDevice.deviceId },
      };
    }
    return constraints;
  }

  _rememberChunk(blob) {
    const chunk = {
      blob,
      mimeType: blob.type || this.status.mimeType,
      capturedAt: new Date().toISOString(),
    };
    this.chunks.push(chunk);
    if (this.chunks.length > this.maxBufferedChunks) {
      this.chunks.shift();
    }
    this.status.chunkCount += 1;
    this.status.lastChunkAt = chunk.capturedAt;
    this.onChunk(chunk);
    this._publish({ chunk });
  }

  _handleError(error) {
    this._stopTracks();
    this.mediaRecorder = null;
    const normalized = normalizeCaptureError(error);
    this._setStatus({ state: normalized.state, error: normalized.message });
    this.showError(normalized.message);
  }

  _stopTracks() {
    if (this.stream && typeof this.stream.getTracks === 'function') {
      this.stream.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }
    this.stream = null;
  }

  _setStatus(patch, extra = {}) {
    this.status = { ...this.status, ...patch };
    this._publish(extra);
  }

  _publish(extra = {}) {
    const voiceActivity = this.voiceActivityDetector ? { ...this.voiceActivityDetector.status } : this.status.voiceActivity;
    const detail = {
      status: { ...this.status, voiceActivity },
      voiceActivity,
      ...extra,
    };
    this.dispatchEvent(new CustomEvent('oraclevoice:microphone', { detail }));
    this.windowRef.dispatchEvent(new CustomEvent('oraclevoice:microphone', { detail }));
  }
}

export default {
  OracleMicCapture,
};
