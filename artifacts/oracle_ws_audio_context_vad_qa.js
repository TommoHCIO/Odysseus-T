const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const tabs = await getJson('http://127.0.0.1:9226/json/list');
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:7000'))
    || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('No CDP page tab found');

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:7000/?codexqa=voice-ws-audio-context-vad-v364' });
  await new Promise(resolve => setTimeout(resolve, 3500));

  const expression = `
(async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  window.__oracleQa = { states: [], mic: [], sent: [], received: [], lifecycle: [], chatStreams: [], errors: [] };

  window.addEventListener('oraclevoice:state', event => {
    const d = event.detail || {};
    const s = d.status || {};
    window.__oracleQa.states.push({
      at: Date.now(),
      state: s.state,
      speechState: s.speechState,
      microphoneState: s.microphoneState,
      voiceActivityState: s.voiceActivityState,
      voiceAudioStreamState: s.voiceAudioStreamState,
      voiceSocketState: s.voiceSocketState,
      serverTranscriptionState: d.serverTranscriptionState || null,
      finalTranscript: d.finalTranscript || null,
      transcriptEmpty: d.transcriptEmpty === true,
      transcriptSubmitted: d.transcriptSubmitted,
      transcriptSource: d.transcriptSource || null,
      error: d.error || null,
    });
  });

  window.addEventListener('oraclevoice:microphone', event => {
    const d = event.detail || {};
    const s = d.status || {};
    window.__oracleQa.mic.push({
      at: Date.now(),
      state: s.state,
      mimeType: s.mimeType,
      chunkCount: s.chunkCount,
      voiceActivityState: s.voiceActivityState,
      voiceActivityLevel: d.voiceActivity && d.voiceActivity.level,
      voiceActivityEvent: d.voiceActivityEvent || null,
      hasChunk: Boolean(d.chunk),
    });
  });

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const socket = protocols === undefined ? new OriginalWebSocket(url) : new OriginalWebSocket(url, protocols);
    window.__oracleQa.lifecycle.push({ type: 'construct', url: String(url) });
    const originalSend = socket.send.bind(socket);
    socket.send = (data) => {
      try {
        const parsed = JSON.parse(data);
        window.__oracleQa.sent.push({
          type: parsed.type,
          audioLength: parsed.audio ? parsed.audio.length : 0,
          mimeType: parsed.mime_type || null,
        });
      } catch (_) {
        window.__oracleQa.sent.push({ type: 'raw', length: String(data || '').length });
      }
      return originalSend(data);
    };
    socket.addEventListener('open', () => window.__oracleQa.lifecycle.push({ type: 'open' }));
    socket.addEventListener('close', event => window.__oracleQa.lifecycle.push({ type: 'close', code: event.code }));
    socket.addEventListener('error', () => window.__oracleQa.lifecycle.push({ type: 'error' }));
    socket.addEventListener('message', event => {
      try { window.__oracleQa.received.push(JSON.parse(event.data)); }
      catch (_) { window.__oracleQa.received.push({ type: 'raw', data: String(event.data || '').slice(0, 120) }); }
    });
    return socket;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  Object.assign(window.WebSocket, OriginalWebSocket);

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = String(args[0] && args[0].url ? args[0].url : args[0]);
    if (url.includes('/api/chat_stream')) {
      const init = args[1] || {};
      const body = init.body;
      const entry = { url, method: init.method || 'GET', fields: {} };
      if (body && typeof body.forEach === 'function') {
        body.forEach((value, key) => {
          entry.fields[key] = typeof value === 'string' ? value : '[non-string]';
        });
      }
      window.__oracleQa.chatStreams.push(entry);
      return new Response('data: {"type":"done"}\\n\\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return originalFetch(...args);
  };

  const RealAudioContext = window.AudioContext;
  const RealWebkitAudioContext = window.webkitAudioContext;
  let analyserSamples = 0;
  class FakeAnalyser {
    constructor() {
      this.fftSize = 1024;
      this.smoothingTimeConstant = 0.25;
    }
    getByteTimeDomainData(buffer) {
      analyserSamples += 1;
      const speech = analyserSamples >= 4 && analyserSamples <= 7;
      for (let index = 0; index < buffer.length; index += 1) {
        buffer[index] = speech
          ? (index % 2 === 0 ? 84 : 172)
          : 128;
      }
    }
  }
  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 48000;
    }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createAnalyser() { return new FakeAnalyser(); }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
  }
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  async function writeGeneratedTrackAudio(writer, sampleRate) {
    const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
    let timestamp = 0;
    const silence = new Float32Array(frameSize);
    const tone = new Float32Array(frameSize);
    for (let index = 0; index < frameSize; index += 1) {
      tone[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.6;
    }
    const writeChunk = async (data) => {
      await writer.write(new AudioData({
        format: 'f32',
        sampleRate,
        numberOfFrames: data.length,
        numberOfChannels: 1,
        timestamp,
        data,
      }));
      timestamp += Math.round((data.length / sampleRate) * 1000000);
      await wait(20);
    };
    for (let lead = 0; lead < 12; lead += 1) await writeChunk(silence);
    for (let speech = 0; speech < 140; speech += 1) await writeChunk(tone);
    for (let tail = 0; tail < 90; tail += 1) await writeChunk(silence);
    await writer.close();
  }

  navigator.mediaDevices.getUserMedia = async () => {
    const track = new MediaStreamTrackGenerator({ kind: 'audio' });
    const writer = track.writable.getWriter();
    writeGeneratedTrackAudio(writer, 48000).catch(error => {
      window.__oracleQa.errors.push(String(error && error.message || error));
      try { writer.close(); } catch (_) {}
    });
    window.__oracleQa.audioContextSource = {
      fakeAnalyser: true,
      generatedTrack: true,
      hasRealAudioContext: Boolean(RealAudioContext || RealWebkitAudioContext),
    };
    return new MediaStream([track]);
  };

  for (let attempt = 0; attempt < 20 && !window.oracleVoiceRuntime; attempt += 1) {
    await wait(500);
  }
  const runtime = window.oracleVoiceRuntime;
  if (!runtime) throw new Error('oracleVoiceRuntime missing');
  if (runtime.speechRecognition) {
    runtime.speechRecognition.status = { ...runtime.speechRecognition.status, supported: false, state: 'unavailable' };
    runtime.speechRecognition.start = () => runtime.speechRecognition.status;
    runtime.speechRecognition.stop = () => runtime.speechRecognition.status;
  }
  await runtime.loadConfig();
  if (runtime.session && runtime.status && runtime.status.active) {
    try { await runtime.hardCancel('qa_reset'); await wait(800); } catch (_) {}
  }

  const button = document.querySelector('#oracle-voice-btn');
  if (!button) throw new Error('Voice Orb button missing');
  button.click();
  await wait(26000);
  const result = {
    config: runtime.config,
    status: runtime.status,
    audioContextSource: window.__oracleQa.audioContextSource || null,
    sentTypes: window.__oracleQa.sent.map(x => x.type),
    sentAudioLengths: window.__oracleQa.sent.filter(x => x.type === 'voice.audio.chunk').map(x => x.audioLength),
    receivedTypes: window.__oracleQa.received.map(x => x.type),
    receivedPayloads: window.__oracleQa.received,
    lifecycle: window.__oracleQa.lifecycle,
    chatStreams: window.__oracleQa.chatStreams,
    errors: window.__oracleQa.errors,
    speechStarts: window.__oracleQa.mic.filter(x => x.voiceActivityEvent === 'speech_start'),
    speechEnds: window.__oracleQa.mic.filter(x => x.voiceActivityEvent === 'speech_end'),
    maxVoiceActivityLevel: Math.max(0, ...window.__oracleQa.mic.map(x => Number(x.voiceActivityLevel) || 0)),
    lastStates: window.__oracleQa.states.slice(-24),
    speechEvents: window.__oracleQa.mic.filter(x => x.voiceActivityEvent || x.hasChunk).slice(-60),
    sourceChecks: {
      runtimePrepare: (await fetch('/static/js/voiceRuntime.js').then(r => r.text())).includes('_prepareSpeechAudioSegment'),
      micRestart: (await fetch('/static/js/voiceMicCapture.js').then(r => r.text())).includes('restartSegment'),
      vadResume: (await fetch('/static/js/voiceActivityDetection.js').then(r => r.text())).includes('audioContext.resume().catch(() => {})'),
      swV363: (await fetch('/static/sw.js').then(r => r.text())).includes('odysseus-v363'),
    },
  };
  try { await runtime.hardCancel('qa_cleanup'); } catch (_) {}
  window.AudioContext = RealAudioContext;
  window.webkitAudioContext = RealWebkitAudioContext;
  return result;
})()
`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 26000,
  });
  if (result.exceptionDetails) {
    console.log(JSON.stringify({ exceptionDetails: result.exceptionDetails }, null, 2));
    ws.close();
    process.exit(1);
  }
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
