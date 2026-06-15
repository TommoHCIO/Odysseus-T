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
  await send('Page.navigate', { url: 'http://127.0.0.1:7000/?codexqa=voice-ws-real-audio-context-vad-v364' });
  await new Promise(resolve => setTimeout(resolve, 3500));

  const expression = `
(async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const qa = window.__oracleQa = { states: [], mic: [], sent: [], received: [], lifecycle: [], chatStreams: [], errors: [] };

  window.addEventListener('oraclevoice:state', event => {
    const d = event.detail || {};
    const s = d.status || {};
    qa.states.push({
      at: Date.now(),
      state: s.state,
      speechState: s.speechState,
      microphoneState: s.microphoneState,
      voiceActivityState: s.voiceActivityState,
      voiceAudioStreamState: s.voiceAudioStreamState,
      voiceSocketState: s.voiceSocketState,
      finalTranscript: d.finalTranscript || null,
      transcriptSubmitted: d.transcriptSubmitted,
      transcriptSource: d.transcriptSource || null,
      error: d.error || null,
    });
  });
  window.addEventListener('oraclevoice:microphone', event => {
    const d = event.detail || {};
    const s = d.status || {};
    qa.mic.push({
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
    qa.lifecycle.push({ type: 'construct', url: String(url) });
    const originalSend = socket.send.bind(socket);
    socket.send = (data) => {
      try {
        const parsed = JSON.parse(data);
        qa.sent.push({ type: parsed.type, audioLength: parsed.audio ? parsed.audio.length : 0 });
      } catch (_) {
        qa.sent.push({ type: 'raw', length: String(data || '').length });
      }
      return originalSend(data);
    };
    socket.addEventListener('open', () => qa.lifecycle.push({ type: 'open' }));
    socket.addEventListener('close', event => qa.lifecycle.push({ type: 'close', code: event.code }));
    socket.addEventListener('error', () => qa.lifecycle.push({ type: 'error' }));
    socket.addEventListener('message', event => {
      try { qa.received.push(JSON.parse(event.data)); }
      catch (_) { qa.received.push({ type: 'raw', data: String(event.data || '').slice(0, 120) }); }
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
      const entry = { url, method: init.method || 'GET', fields: {} };
      if (init.body && typeof init.body.forEach === 'function') {
        init.body.forEach((value, key) => {
          entry.fields[key] = typeof value === 'string' ? value : '[non-string]';
        });
      }
      qa.chatStreams.push(entry);
      return new Response('data: {"type":"done"}\\n\\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    return originalFetch(...args);
  };

  navigator.mediaDevices.getUserMedia = async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    if (ctx.resume) await ctx.resume();
    const destination = ctx.createMediaStreamDestination();

    const gain = ctx.createGain();
    gain.gain.value = 0.45;
    gain.connect(destination);

    const start = ctx.currentTime + 0.25;
    for (const [offset, frequency, volume] of [[0, 440, 0.55], [0.08, 660, 0.35], [0.16, 880, 0.25]]) {
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0, start + offset);
      envelope.gain.linearRampToValueAtTime(volume, start + offset + 0.04);
      envelope.gain.setValueAtTime(volume, start + offset + 2.1);
      envelope.gain.linearRampToValueAtTime(0, start + offset + 2.5);
      oscillator.connect(envelope);
      envelope.connect(gain);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 2.55);
    }

    setTimeout(() => {
      try { ctx.close(); } catch (_) {}
    }, 7000);
    qa.audioContextSource = {
      realAnalyserExpected: true,
      sourceState: ctx.state,
      sampleRate: ctx.sampleRate,
      tracks: destination.stream.getAudioTracks().length,
    };
    return destination.stream;
  };

  for (let attempt = 0; attempt < 20 && !window.oracleVoiceRuntime; attempt += 1) await wait(500);
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
  await wait(20000);

  const result = {
    config: runtime.config,
    status: runtime.status,
    audioContextSource: qa.audioContextSource || null,
    sentTypes: qa.sent.map(x => x.type),
    receivedTypes: qa.received.map(x => x.type),
    receivedPayloads: qa.received,
    lifecycle: qa.lifecycle,
    chatStreams: qa.chatStreams,
    errors: qa.errors,
    speechStarts: qa.mic.filter(x => x.voiceActivityEvent === 'speech_start'),
    speechEnds: qa.mic.filter(x => x.voiceActivityEvent === 'speech_end'),
    maxVoiceActivityLevel: Math.max(0, ...qa.mic.map(x => Number(x.voiceActivityLevel) || 0)),
    speechEvents: qa.mic.filter(x => x.voiceActivityEvent || x.hasChunk).slice(-60),
    sourceChecks: {
      runtimePrepare: (await fetch('/static/js/voiceRuntime.js').then(r => r.text())).includes('_prepareSpeechAudioSegment'),
      micRestart: (await fetch('/static/js/voiceMicCapture.js').then(r => r.text())).includes('restartSegment'),
      vadResume: (await fetch('/static/js/voiceActivityDetection.js').then(r => r.text())).includes('audioContext.resume().catch(() => {})'),
      swV363: (await fetch('/static/sw.js').then(r => r.text())).includes('odysseus-v363'),
    },
  };
  try { await runtime.hardCancel('qa_cleanup'); } catch (_) {}
  return result;
})()
`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: 28000,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    console.log(JSON.stringify({ exceptionDetails: result.exceptionDetails }, null, 2));
    ws.close();
    process.exit(1);
  }
  const value = result.result.value;
  const finalPayload = (value.receivedPayloads || []).find((payload) => payload.type === 'voice.transcript.final');
  const partialPayload = (value.receivedPayloads || []).find((payload) => payload.type === 'voice.transcript.partial');
  const finalDiagnostics = finalPayload && finalPayload.diagnostics;
  const partialDiagnostics = partialPayload && partialPayload.diagnostics;
  const statusDiagnostics = value.status && value.status.lastTranscriptDiagnostics;
  const failures = [];
  if (!value.audioContextSource || value.audioContextSource.sourceState !== 'running') failures.push('real AudioContext did not run');
  if (!value.speechStarts || value.speechStarts.length < 1) failures.push('production VAD did not emit speech_start');
  if (!value.speechEnds || value.speechEnds.length < 1) failures.push('production VAD did not emit speech_end');
  if (!(value.maxVoiceActivityLevel > 0)) failures.push('real analyser never reported a positive voice activity level');
  for (const type of ['voice.audio.start', 'voice.audio.chunk', 'voice.audio.end']) {
    if (!(value.sentTypes || []).includes(type)) failures.push(`missing sent websocket event ${type}`);
  }
  if (!finalPayload || !finalPayload.text) failures.push('missing final websocket transcript');
  if (!partialDiagnostics || partialDiagnostics.provider !== 'local') failures.push('missing partial transcript STT diagnostics');
  if (!finalDiagnostics || finalDiagnostics.provider !== 'local') failures.push('missing final transcript STT diagnostics');
  if (finalDiagnostics && typeof finalDiagnostics.decode_ms !== 'number') failures.push('final transcript diagnostics missing decode_ms');
  if (!statusDiagnostics || statusDiagnostics.provider !== 'local') failures.push('runtime status missing lastTranscriptDiagnostics');
  if (statusDiagnostics && typeof statusDiagnostics.decode_ms !== 'number') failures.push('runtime status diagnostics missing decode_ms');
  if (!(value.chatStreams || []).some((entry) => entry.fields && entry.fields.voice_transcript_source && entry.fields.voice_transcript_source.includes('voice.websocket'))) {
    failures.push('chat_stream did not include voice.websocket provenance');
  }
  if ((value.errors || []).length) failures.push(`browser QA errors: ${value.errors.join('; ')}`);
  if (failures.length) {
    console.log(JSON.stringify({ failures, result: value }, null, 2));
    ws.close();
    process.exit(1);
  }
  console.log(JSON.stringify(value, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
