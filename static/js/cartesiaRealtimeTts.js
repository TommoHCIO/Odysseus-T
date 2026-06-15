const CARTESIA_TTS_WEBSOCKET_URL = 'wss://api.cartesia.ai/tts/websocket';
const CARTESIA_TTS_PROXY_PATH = '/api/voice/cartesia-tts/ws';
const CARTESIA_VERSION = '2026-03-01';
const CARTESIA_TTS_MODEL = 'sonic-3.5';
const CARTESIA_TTS_VOICE_ID = '65209f8e-6140-4a20-b819-3cc2e21da19b';
const CARTESIA_TTS_SAMPLE_RATE = 44100;
const CARTESIA_TTS_TIMEOUT_MS = 60000;

let activePcmQueue = null;
let activeTtsClient = null;

function makeContextId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `oracle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function base64ToUint8Array(value) {
  const binary = window.atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

class PcmF32PlaybackQueue {
  constructor({ sampleRate = CARTESIA_TTS_SAMPLE_RATE } = {}) {
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextImpl) {
      throw new Error('Web Audio is unavailable');
    }
    this.audioContext = new AudioContextImpl({ sampleRate });
    this.sampleRate = sampleRate;
    this.sources = new Set();
    this.nextStartTime = 0;
    this.playbackChain = Promise.resolve();
    this.stopped = false;
  }

  async resume() {
    if (this.audioContext.state === 'suspended' && typeof this.audioContext.resume === 'function') {
      await this.audioContext.resume();
    }
  }

  async _playChunkNow(bytes) {
    if (this.stopped || !bytes || !bytes.byteLength) return;
    await this.resume();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const samples = new Float32Array(buffer);
    if (!samples.length) return;
    const audioBuffer = this.audioContext.createBuffer(1, samples.length, this.sampleRate);
    audioBuffer.copyToChannel(samples, 0);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.onended = () => this.sources.delete(source);
    const now = this.audioContext.currentTime;
    const startAt = Math.max(now, this.nextStartTime || now);
    this.nextStartTime = startAt + audioBuffer.duration;
    this.sources.add(source);
    source.start(startAt);
  }

  playChunk(bytes) {
    this.playbackChain = this.playbackChain.then(() => this._playChunkNow(bytes));
    return this.playbackChain;
  }

  async waitForEnd() {
    await this.playbackChain;
    const remainingMs = Math.max(0, (this.nextStartTime - this.audioContext.currentTime) * 1000);
    if (remainingMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remainingMs + 25));
    }
  }

  stop() {
    this.stopped = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch (error) {
        // Source may already have ended.
      }
    }
    this.sources.clear();
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      this.audioContext.close().catch(() => {});
    }
  }
}

function realtimeTtsAvailable(config) {
  const tokenStats = config && config.realtime_provider_tokens && config.realtime_provider_tokens.cartesia;
  const proxyStats = config && config.cartesia_tts_proxy;
  return Boolean((tokenStats && tokenStats.available) || (proxyStats && proxyStats.available));
}

function socketState(WebSocketImpl, name, fallback) {
  return typeof WebSocketImpl[name] === 'number' ? WebSocketImpl[name] : fallback;
}

async function providerTokenError(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  const detail = payload && payload.detail ? payload.detail : {};
  const setupBlocker = detail.setup_blocker || payload.setup_blocker || `http_${response.status}`;
  const message = detail.message || payload.message || fallbackMessage || 'Cartesia token failed';
  const error = new Error(`${message}: ${setupBlocker}`);
  error.status = response.status;
  error.setupBlocker = setupBlocker;
  error.provider = 'cartesia';
  error.recoverable = true;
  return error;
}

export function stopCartesiaRealtimeTts() {
  if (activeTtsClient && typeof activeTtsClient.cancelActiveRequest === 'function') {
    activeTtsClient.cancelActiveRequest('interrupted');
  }
  if (activePcmQueue) {
    activePcmQueue.stop();
    activePcmQueue = null;
  }
  activeTtsClient = null;
}

export class CartesiaRealtimeTtsClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || window.fetch.bind(window);
    this.WebSocketImpl = options.WebSocketImpl || window.WebSocket;
    this.playbackFactory = options.playbackFactory || ((playbackOptions) => new PcmF32PlaybackQueue(playbackOptions));
    this.endpoint = options.endpoint || CARTESIA_TTS_WEBSOCKET_URL;
    this.ws = null;
    this.socketReady = false;
    this.tokenPayload = null;
    this.activeRequest = null;
    this.config = null;
    this.activeTransport = 'idle';
  }

  canUse(config) {
    this.config = config || null;
    return Boolean(
      realtimeTtsAvailable(config)
      && this.WebSocketImpl
      && (window.AudioContext || window.webkitAudioContext)
    );
  }

  async requestToken() {
    const response = await this.fetchImpl('/api/voice/provider-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'cartesia',
        grants: { tts: true },
        expires_in: 120,
      }),
    });
    if (!response.ok) {
      throw await providerTokenError(response, 'Cartesia token failed');
    }
    const payload = await response.json();
    if (!payload || !payload.token) {
      throw new Error('Cartesia token response missing token');
    }
    return payload;
  }

  buildWebSocketUrl(tokenPayload) {
    const url = new URL(this.endpoint);
    url.searchParams.set('cartesia_version', tokenPayload.cartesia_version || CARTESIA_VERSION);
    url.searchParams.set('access_token', tokenPayload.token);
    return url.toString();
  }

  buildProxyWebSocketUrl() {
    const proxyStats = this.config && this.config.cartesia_tts_proxy ? this.config.cartesia_tts_proxy : {};
    const proxyPath = proxyStats.path || CARTESIA_TTS_PROXY_PATH;
    const url = new URL(proxyPath, window.location.origin);
    url.protocol = url.protocol.replace(/^http/, 'ws');
    url.searchParams.set('cartesia_version', CARTESIA_VERSION);
    return url.toString();
  }

  buildGenerationRequest(text, tokenPayload = {}) {
    return {
      model_id: CARTESIA_TTS_MODEL,
      transcript: text,
      voice: {
        mode: 'id',
        id: CARTESIA_TTS_VOICE_ID,
      },
      language: 'en',
      context_id: makeContextId(),
      output_format: {
        container: 'raw',
        encoding: 'pcm_f32le',
        sample_rate: CARTESIA_TTS_SAMPLE_RATE,
      },
      add_timestamps: false,
      continue: false,
      _token_expires_in: tokenPayload.expires_in,
    };
  }

  async _ensureSocket() {
    if (this._isSocketOpen()) {
      this.socketReady = true;
      return this.ws;
    }
    if (this._isSocketConnecting()) {
      return this.ws;
    }
    this.socketReady = false;
    const useProxy = this._shouldUseProxy();
    this.tokenPayload = useProxy ? null : await this.requestToken();
    this.activeTransport = useProxy ? 'proxy' : 'direct';
    this.ws = new this.WebSocketImpl(useProxy ? this.buildProxyWebSocketUrl() : this.buildWebSocketUrl(this.tokenPayload));
    this.ws.onopen = () => {
      this.socketReady = true;
    };
    this.ws.onerror = () => {
      this._failActiveRequest(new Error('Cartesia realtime TTS socket failed'));
    };
    this.ws.onclose = () => {
      this.socketReady = false;
      this.ws = null;
      this.tokenPayload = null;
      this.activeTransport = 'idle';
      this._failActiveRequest(new Error('Cartesia realtime TTS socket closed'));
    };
    this.ws.onmessage = (event) => this._handleMessage(event);
    return this.ws;
  }

  _isSocketOpen() {
    return Boolean(this.ws && this.ws.readyState === socketState(this.WebSocketImpl, 'OPEN', 1));
  }

  _isSocketConnecting() {
    return Boolean(this.ws && this.ws.readyState === socketState(this.WebSocketImpl, 'CONNECTING', 0));
  }

  _shouldUseProxy() {
    const proxyStats = this.config && this.config.cartesia_tts_proxy ? this.config.cartesia_tts_proxy : {};
    return Boolean(proxyStats.available);
  }

  _waitForSocketOpen(socket) {
    if (this._isSocketOpen()) return Promise.resolve(socket);
    return new Promise((resolve, reject) => {
      const done = () => {
        if (socket.removeEventListener) {
          socket.removeEventListener('open', onOpen);
          socket.removeEventListener('error', onError);
          socket.removeEventListener('close', onClose);
        }
      };
      const onOpen = () => {
        done();
        this.socketReady = true;
        resolve(socket);
      };
      const onError = () => {
        done();
        reject(new Error('Cartesia realtime TTS socket failed'));
      };
      const onClose = () => {
        done();
        reject(new Error('Cartesia realtime TTS socket closed'));
      };
      if (socket.addEventListener) {
        socket.addEventListener('open', onOpen, { once: true });
        socket.addEventListener('error', onError, { once: true });
        socket.addEventListener('close', onClose, { once: true });
      } else {
        const previousOpen = socket.onopen;
        const previousError = socket.onerror;
        const previousClose = socket.onclose;
        socket.onopen = (event) => {
          if (typeof previousOpen === 'function') previousOpen(event);
          onOpen();
        };
        socket.onerror = (event) => {
          if (typeof previousError === 'function') previousError(event);
          onError();
        };
        socket.onclose = (event) => {
          if (typeof previousClose === 'function') previousClose(event);
          onClose();
        };
      }
    });
  }

  speak(text, options = {}) {
    const speechText = typeof text === 'string' ? text.trim() : '';
    if (!speechText) return Promise.resolve(false);
    if (options.stopExisting !== false) {
      stopCartesiaRealtimeTts();
    }

    return new Promise((resolve, reject) => {
      const contextId = makeContextId();
      const playback = this.playbackFactory({ sampleRate: CARTESIA_TTS_SAMPLE_RATE });
      let settled = false;
      let sawAudio = false;
      const timeoutId = window.setTimeout(() => {
        this.cancelActiveRequest('timeout');
        settle(reject, new Error('Cartesia realtime TTS timed out'));
      }, Number(options.timeoutMs) || CARTESIA_TTS_TIMEOUT_MS);

      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        if (activePcmQueue === playback) {
          activePcmQueue = null;
        }
        if (activeTtsClient === this) {
          activeTtsClient = null;
        }
        if (this.activeRequest && this.activeRequest.contextId === contextId) {
          this.activeRequest = null;
        }
        fn(value);
      };

      this.activeRequest = {
        contextId,
        playback,
        resolve,
        reject,
        settle,
        sawAudio: () => sawAudio,
        markAudio: () => { sawAudio = true; },
      };
      activePcmQueue = playback;
      activeTtsClient = this;

      this._ensureSocket()
        .then((socket) => this._waitForSocketOpen(socket))
        .then((socket) => {
          if (!this.activeRequest || this.activeRequest.contextId !== contextId) {
            return false;
          }
          const request = this.buildGenerationRequest(speechText, this.tokenPayload || {});
          request.context_id = contextId;
          socket.send(JSON.stringify(request));
          return true;
        })
        .catch((error) => {
          if (this.activeRequest && this.activeRequest.contextId === contextId) {
            playback.stop();
            settle(reject, error);
          }
        });
    });
  }

  cancelActiveRequest(reason = 'cancelled') {
    const request = this.activeRequest;
    if (!request) return false;
    if (this._isSocketOpen()) {
      try {
        this.ws.send(JSON.stringify({
          context_id: request.contextId,
          cancel: true,
        }));
      } catch (error) {}
    }
    if (request.playback) {
      request.playback.stop();
    }
    request.settle(request.resolve, {
      ended: false,
      provider: 'cartesia',
      streamed: true,
      interrupted: true,
      reason,
      sawAudio: request.sawAudio(),
    });
    return true;
  }

  _messageBelongsToActiveRequest(message) {
    if (!this.activeRequest) return false;
    if (!message || !message.context_id) return true;
    return message.context_id === this.activeRequest.contextId;
  }

  _handleMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (!this._messageBelongsToActiveRequest(message)) return;
    const request = this.activeRequest;
    if (!request) return;
    if (message.type === 'error') {
      if (request.playback) request.playback.stop();
      request.settle(request.reject, new Error(message.message || message.title || 'Cartesia realtime TTS failed'));
      return;
    }
    if (message.type === 'chunk' && message.data) {
      request.markAudio();
      request.playback.playChunk(base64ToUint8Array(message.data)).catch((error) => {
        if (request.playback) request.playback.stop();
        request.settle(request.reject, error);
      });
      return;
    }
    if (message.type === 'done' || message.done === true) {
      request.playback.waitForEnd()
        .then(() => request.settle(request.resolve, {
          ended: true,
          provider: 'cartesia',
          streamed: true,
          sawAudio: request.sawAudio(),
        }))
        .catch((error) => request.settle(request.reject, error));
    }
  }

  _failActiveRequest(error) {
    const request = this.activeRequest;
    if (!request) return;
    if (request.playback) request.playback.stop();
    request.settle(request.reject, error);
  }

  close() {
    this.cancelActiveRequest('closed');
    if (this.ws && this.ws.readyState <= socketState(this.WebSocketImpl, 'OPEN', 1)) {
      try { this.ws.close(); } catch (error) {}
    }
    this.ws = null;
    this.socketReady = false;
    this.tokenPayload = null;
  }
}

export function canUseCartesiaRealtimeTts(config) {
  return realtimeTtsAvailable(config);
}

export default {
  CartesiaRealtimeTtsClient,
  canUseCartesiaRealtimeTts,
  stopCartesiaRealtimeTts,
};
