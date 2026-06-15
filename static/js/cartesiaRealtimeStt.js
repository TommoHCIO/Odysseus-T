const CARTESIA_STT_WEBSOCKET_URL = 'wss://api.cartesia.ai/stt/websocket';
const CARTESIA_STT_PROXY_PATH = '/api/voice/cartesia-stt/ws';
const CARTESIA_VERSION = '2026-03-01';
const CARTESIA_STT_MODEL = 'ink-2';
const CARTESIA_STT_ENCODING = 'pcm_f32le';
const CARTESIA_STT_QUEUE_LIMIT = 80;
const CARTESIA_STT_CONNECT_TIMEOUT_MS = 4000;

function realtimeSttAvailable(config) {
  const tokenStats = config && config.realtime_provider_tokens && config.realtime_provider_tokens.cartesia;
  const proxyStats = config && config.cartesia_stt_proxy;
  return Boolean((tokenStats && tokenStats.available) || (proxyStats && proxyStats.available));
}

function normalizeTranscriptText(value) {
  return typeof value === 'string' ? value : '';
}

function float32ToArrayBuffer(samples) {
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  return copy.buffer;
}

function socketState(WebSocketImpl, name, fallback) {
  return typeof WebSocketImpl[name] === 'number' ? WebSocketImpl[name] : fallback;
}

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function elapsedMs(startMs, endMs = nowMs()) {
  if (typeof startMs !== 'number' || !Number.isFinite(startMs)) return null;
  return Math.max(0, Math.round(endMs - startMs));
}

async function providerTokenError(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  const detail = payload && payload.detail ? payload.detail : {};
  const setupBlocker = detail.setup_blocker || payload.setup_blocker || `http_${response.status}`;
  const message = detail.message || payload.message || fallbackMessage || 'Cartesia STT token failed';
  const error = new Error(`${message}: ${setupBlocker}`);
  error.status = response.status;
  error.setupBlocker = setupBlocker;
  error.provider = 'cartesia';
  error.recoverable = true;
  return error;
}

function cartesiaSttSocketError(message, event = null) {
  const error = new Error(message || 'Cartesia realtime STT socket failed');
  error.provider = 'cartesia';
  error.setupBlocker = 'cartesia_stt_socket_failed';
  error.recoverable = true;
  if (event && typeof event.code === 'number') {
    error.socketCode = event.code;
  }
  if (event && typeof event.reason === 'string' && event.reason) {
    error.socketReason = event.reason.slice(0, 160);
  }
  return error;
}

export class CartesiaRealtimeSttClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || window.fetch.bind(window);
    this.WebSocketImpl = options.WebSocketImpl || window.WebSocket;
    this.AudioContextImpl = options.AudioContextImpl || window.AudioContext || window.webkitAudioContext;
    this.endpoint = options.endpoint || CARTESIA_STT_WEBSOCKET_URL;
    this.ws = null;
    this.audioContext = null;
    this.source = null;
    this.processor = null;
    this.silentSink = null;
    this.pendingChunks = [];
    this.finalChunks = [];
    this.finalizing = false;
    this.closed = false;
    this.handlers = {};
    this.config = null;
    this.socketReady = false;
    this.connectTimer = null;
    this.turnStartedAt = null;
    this.socketConnectStartedAt = null;
    this.socketOpenedAt = null;
    this.finalizeStartedAt = null;
    this.activeTransport = 'idle';
  }

  canUse(config) {
    return Boolean(
      realtimeSttAvailable(config)
      && this.WebSocketImpl
      && this.AudioContextImpl
    );
  }

  async requestToken() {
    const response = await this.fetchImpl('/api/voice/provider-token', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'cartesia',
        grants: { stt: true },
        expires_in: 120,
      }),
    });
    if (!response.ok) {
      throw await providerTokenError(response, 'Cartesia STT token failed');
    }
    const payload = await response.json();
    if (!payload || !payload.token) {
      throw new Error('Cartesia STT token response missing token');
    }
    return payload;
  }

  buildWebSocketUrl(tokenPayload, sampleRate) {
    const url = new URL(this.endpoint);
    url.searchParams.set('model', CARTESIA_STT_MODEL);
    url.searchParams.set('encoding', CARTESIA_STT_ENCODING);
    url.searchParams.set('sample_rate', String(Math.round(sampleRate)));
    url.searchParams.set('cartesia_version', tokenPayload.cartesia_version || CARTESIA_VERSION);
    url.searchParams.set('access_token', tokenPayload.token);
    return url.toString();
  }

  buildProxyWebSocketUrl(sampleRate) {
    const proxyStats = this.config && this.config.cartesia_stt_proxy ? this.config.cartesia_stt_proxy : {};
    const proxyPath = proxyStats.path || CARTESIA_STT_PROXY_PATH;
    const url = new URL(proxyPath, window.location.origin);
    url.protocol = url.protocol.replace(/^http/, 'ws');
    url.searchParams.set('model', CARTESIA_STT_MODEL);
    url.searchParams.set('encoding', CARTESIA_STT_ENCODING);
    url.searchParams.set('sample_rate', String(Math.round(sampleRate)));
    url.searchParams.set('cartesia_version', CARTESIA_VERSION);
    return url.toString();
  }

  async start(stream, handlers = {}, options = {}) {
    if (!stream) {
      throw new Error('Cartesia STT requires an active microphone stream');
    }
    if (this.finalizing) {
      throw new Error('Cartesia STT is still finalizing the previous turn');
    }
    this.closed = false;
    this.finalizing = false;
    this.finalChunks = [];
    this.pendingChunks = [];
    this.handlers = handlers || {};
    this.config = options.config || null;
    this.turnStartedAt = nowMs();
    this.finalizeStartedAt = null;
    await this._ensureAudioContext();
    await this._ensureSocket();
    this._connectAudioGraph(stream);
    this._emitState(this.socketReady ? 'streaming' : 'connecting', this._latencyDiagnostics());
    return true;
  }

  async _ensureAudioContext() {
    if (this.audioContext) {
      if (typeof this.audioContext.resume === 'function') {
        await this.audioContext.resume().catch(() => {});
      }
      return this.audioContext;
    }
    this.audioContext = new this.AudioContextImpl();
    if (this.audioContext && typeof this.audioContext.resume === 'function') {
      await this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  _shouldUseProxy() {
    const proxyStats = this.config && this.config.cartesia_stt_proxy ? this.config.cartesia_stt_proxy : {};
    return Boolean(proxyStats.available);
  }

  async _ensureSocket() {
    if (this._isSocketOpen()) {
      this.socketReady = true;
      this._flushPendingChunks();
      this._emitState('streaming', this._latencyDiagnostics({ socket_reused: 1 }));
      return this.ws;
    }
    if (this._isSocketConnecting()) {
      return this.ws;
    }
    this.socketReady = false;
    const useProxy = this._shouldUseProxy();
    const tokenPayload = useProxy ? null : await this.requestToken();
    const socketUrl = useProxy
      ? this.buildProxyWebSocketUrl(this.audioContext.sampleRate)
      : this.buildWebSocketUrl(tokenPayload, this.audioContext.sampleRate);
    this.activeTransport = useProxy ? 'proxy' : 'direct';
    this.socketConnectStartedAt = nowMs();
    this.socketOpenedAt = null;
    this.ws = new this.WebSocketImpl(socketUrl);
    const socket = this.ws;
    socket.binaryType = 'arraybuffer';
    this._startConnectTimer();
    socket.onopen = () => {
      if (this.ws !== socket) return;
      this._clearConnectTimer();
      this.socketReady = true;
      this.socketOpenedAt = nowMs();
      this._emitState('streaming', this._latencyDiagnostics());
      this._flushPendingChunks();
    };
    socket.onerror = (event) => {
      if (this.ws !== socket) return;
      this._fail(cartesiaSttSocketError('Cartesia realtime STT socket failed', event));
    };
    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this._clearConnectTimer();
      this.socketReady = false;
      if (!this.closed && !this.finalizing && !this.socketReady && event && event.code !== 1000) {
        this._fail(cartesiaSttSocketError('Cartesia realtime STT socket closed before it was ready', event));
        return;
      }
      this._emitState(this.finalizing ? 'closed' : 'idle', this._latencyDiagnostics());
    };
    socket.onmessage = (event) => {
      if (this.ws !== socket) return;
      this._handleMessage(event);
    };
    return socket;
  }

  _isSocketOpen() {
    return Boolean(this.ws && this.ws.readyState === socketState(this.WebSocketImpl, 'OPEN', 1));
  }

  _isSocketConnecting() {
    return Boolean(this.ws && this.ws.readyState === socketState(this.WebSocketImpl, 'CONNECTING', 0));
  }

  _startConnectTimer() {
    this._clearConnectTimer();
    this.connectTimer = window.setTimeout(() => {
      if (!this._isSocketOpen()) {
        this._fail(cartesiaSttSocketError('Cartesia realtime STT socket timed out'));
      }
    }, CARTESIA_STT_CONNECT_TIMEOUT_MS);
  }

  _clearConnectTimer() {
    if (!this.connectTimer) return;
    window.clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  finalize() {
    if (this.closed || this.finalizing) return false;
    this.finalizing = true;
    this.finalizeStartedAt = nowMs();
    this._disconnectAudioGraph();
    this._sendText('finalize');
    this._emitState('transcribing', this._latencyDiagnostics());
    return true;
  }

  stop() {
    this.closed = true;
    this.finalizing = false;
    this.pendingChunks = [];
    this.finalChunks = [];
    this._clearConnectTimer();
    this._disconnectAudioGraph();
    this.socketReady = false;
    if (this.ws && this.ws.readyState <= socketState(this.WebSocketImpl, 'OPEN', 1)) {
      try {
        this.ws.close();
      } catch (error) {
        // The browser may already be closing this socket.
      }
    }
    this.ws = null;
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this._emitState('idle', this._latencyDiagnostics());
  }

  _connectAudioGraph(stream) {
    const audioContext = this.audioContext;
    this._disconnectAudioGraph();
    this.source = audioContext.createMediaStreamSource(stream);
    this.processor = audioContext.createScriptProcessor(4096, 1, 1);
    this.silentSink = audioContext.createGain();
    this.silentSink.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (this.closed || this.finalizing) return;
      const channel = event.inputBuffer && event.inputBuffer.getChannelData
        ? event.inputBuffer.getChannelData(0)
        : null;
      if (!channel || !channel.length) return;
      this._sendRaw(float32ToArrayBuffer(channel));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.silentSink);
    this.silentSink.connect(audioContext.destination);
  }

  _disconnectAudioGraph() {
    for (const node of [this.source, this.processor, this.silentSink]) {
      if (node && typeof node.disconnect === 'function') {
        try { node.disconnect(); } catch (error) {}
      }
    }
    if (this.processor) {
      this.processor.onaudioprocess = null;
    }
    this.source = null;
    this.processor = null;
    this.silentSink = null;
  }

  _sendRaw(buffer) {
    if (this._isSocketOpen()) {
      this.ws.send(buffer);
      return;
    }
    this.pendingChunks.push(buffer);
    if (this.pendingChunks.length > CARTESIA_STT_QUEUE_LIMIT) {
      this.pendingChunks.shift();
    }
  }

  _sendText(value) {
    if (this._isSocketOpen()) {
      this.ws.send(value);
    }
  }

  _flushPendingChunks() {
    const chunks = this.pendingChunks.splice(0);
    for (const chunk of chunks) {
      this._sendRaw(chunk);
    }
  }

  _handleMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (message.type === 'error') {
      const error = cartesiaSttSocketError(message.message || message.title || 'Cartesia realtime STT failed');
      if (typeof message.status_code === 'number') {
        error.status = message.status_code;
      }
      if (typeof message.error_code === 'string' && message.error_code) {
        error.setupBlocker = `cartesia_stt_${message.error_code}`.slice(0, 80);
      }
      this._fail(error);
      return;
    }
    if (message.type === 'flush_done' || message.type === 'done') {
      const finalDiagnostics = this._latencyDiagnostics({ completed: 1 });
      this._flushFinalTranscript(finalDiagnostics);
      this.finalizing = false;
      this._emitState(this._isSocketOpen() ? 'ready' : 'idle', finalDiagnostics);
      return;
    }
    if (message.type !== 'transcript') return;
    const text = normalizeTranscriptText(message.text);
    if (!text) return;
    if (message.is_final === true) {
      this.finalChunks.push(text);
      return;
    }
    if (typeof this.handlers.onPartialTranscript === 'function') {
      this.handlers.onPartialTranscript(text, message);
    }
  }

  _latencyDiagnostics(extra = {}) {
    const diagnostics = {
      provider: 'cartesia',
      transport: this.activeTransport || 'unknown',
      socket_ready_ms: elapsedMs(this.socketConnectStartedAt, this.socketOpenedAt || nowMs()),
      turn_to_socket_ready_ms: elapsedMs(this.turnStartedAt, this.socketOpenedAt || nowMs()),
      finalize_to_final_ms: elapsedMs(this.finalizeStartedAt),
      turn_to_final_ms: elapsedMs(this.turnStartedAt),
      ...extra,
    };
    for (const key of Object.keys(diagnostics)) {
      if (diagnostics[key] === null || diagnostics[key] === undefined) {
        delete diagnostics[key];
      }
    }
    return diagnostics;
  }

  _flushFinalTranscript(diagnostics = {}) {
    const text = this.finalChunks.join('').trim();
    this.finalChunks = [];
    if (!text) return false;
    if (typeof this.handlers.onFinalTranscript === 'function') {
      this.handlers.onFinalTranscript(text, {
        provider: 'cartesia',
        mode: 'manual_finalize',
        model: CARTESIA_STT_MODEL,
        encoding: CARTESIA_STT_ENCODING,
        ...diagnostics,
      });
    }
    return true;
  }

  _emitState(state, diagnostics = {}) {
    if (typeof this.handlers.onState === 'function') {
      this.handlers.onState(state, diagnostics);
    }
  }

  _fail(error) {
    this._clearConnectTimer();
    this._disconnectAudioGraph();
    this.socketReady = false;
    const socket = this.ws;
    this.ws = null;
    if (socket && socket.readyState <= socketState(this.WebSocketImpl, 'OPEN', 1)) {
      try {
        socket.close();
      } catch (_) {}
    }
    if (typeof this.handlers.onError === 'function') {
      this.handlers.onError(error);
    }
    this._emitState('error', this._latencyDiagnostics({ failed: 1 }));
  }
}

export function canUseCartesiaRealtimeStt(config) {
  return realtimeSttAvailable(config);
}

export default {
  CartesiaRealtimeSttClient,
  canUseCartesiaRealtimeStt,
};
