const fs = require('fs');
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
  await send('Page.navigate', { url: 'http://127.0.0.1:7000/?codexqa=voice-ws-track-generator-v363' });
  await new Promise(resolve => setTimeout(resolve, 3500));

  const wavBase64 = fs.readFileSync('artifacts/oracle-stt-smoke.wav').toString('base64');
  const expression = `
(async () => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const wavBase64 = '${wavBase64}';
  const wavBytes = Uint8Array.from(atob(wavBase64), c => c.charCodeAt(0));

  function ascii(offset, length) {
    return Array.from(wavBytes.slice(offset, offset + length)).map(x => String.fromCharCode(x)).join('');
  }

  function parseWavPcm16() {
    const view = new DataView(wavBytes.buffer);
    let offset = 12;
    let channels = 1;
    let sampleRate = 16000;
    let bitsPerSample = 16;
    let dataOffset = 0;
    let dataSize = 0;
    while (offset + 8 <= wavBytes.length) {
      const id = ascii(offset, 4);
      const size = view.getUint32(offset + 4, true);
      const body = offset + 8;
      if (id === 'fmt ') {
        channels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        bitsPerSample = view.getUint16(body + 14, true);
      } else if (id === 'data') {
        dataOffset = body;
        dataSize = size;
        break;
      }
      offset = body + size + (size % 2);
    }
    if (!dataOffset || bitsPerSample !== 16) {
      throw new Error('Expected PCM16 WAV test fixture');
    }
    const frameCount = Math.floor(dataSize / (channels * 2));
    const samples = new Float32Array(frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = view.getInt16(dataOffset + ((frame * channels + channel) * 2), true) / 32768;
        sum += sample;
      }
      const boosted = (sum / channels) * 2.2;
      samples[frame] = Math.max(-1, Math.min(1, boosted));
    }
    return { samples, sampleRate };
  }

  async function writeAudio(writer, samples, sampleRate) {
    const frameSize = Math.max(1, Math.floor(sampleRate * 0.02));
    let timestamp = 0;
    const silence = new Float32Array(frameSize);
    for (let lead = 0; lead < 6; lead += 1) {
      await writer.write(new AudioData({ format: 'f32', sampleRate, numberOfFrames: frameSize, numberOfChannels: 1, timestamp, data: silence }));
      timestamp += Math.round((frameSize / sampleRate) * 1000000);
      await wait(20);
    }
    for (let repeat = 0; repeat < 5; repeat += 1) {
      for (let offset = 0; offset < samples.length; offset += frameSize) {
        const chunk = samples.slice(offset, Math.min(samples.length, offset + frameSize));
        await writer.write(new AudioData({ format: 'f32', sampleRate, numberOfFrames: chunk.length, numberOfChannels: 1, timestamp, data: chunk }));
        timestamp += Math.round((chunk.length / sampleRate) * 1000000);
        await wait(20);
      }
    }
    for (let tail = 0; tail < 70; tail += 1) {
      await writer.write(new AudioData({ format: 'f32', sampleRate, numberOfFrames: frameSize, numberOfChannels: 1, timestamp, data: silence }));
      timestamp += Math.round((frameSize / sampleRate) * 1000000);
      await wait(20);
    }
    await writer.close();
  }

  const parsedWav = parseWavPcm16();
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

  navigator.mediaDevices.getUserMedia = async () => {
    const track = new MediaStreamTrackGenerator({ kind: 'audio' });
    const writer = track.writable.getWriter();
    writeAudio(writer, parsedWav.samples, parsedWav.sampleRate).catch(error => {
      window.__oracleQa.errors.push(String(error && error.message || error));
      try { writer.close(); } catch (_) {}
    });
    return new MediaStream([track]);
  };

  if (!window.oracleVoiceRuntime) await wait(1500);
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
  const waitForChunk = async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const latest = window.__oracleQa.mic[window.__oracleQa.mic.length - 1];
      if (latest && latest.chunkCount > 0) return latest.chunkCount;
      await wait(200);
    }
    return 0;
  };
  const firstChunkCount = await waitForChunk();
  window.__oracleQa.lifecycle.push({ type: 'qa_force_speech_start', firstChunkCount });
  runtime._handleVoiceActivityEvent({ voiceActivityEvent: 'speech_start' });
  await wait(11000);
  window.__oracleQa.lifecycle.push({ type: 'qa_force_speech_end' });
  runtime._handleVoiceActivityEvent({ voiceActivityEvent: 'speech_end' });
  await wait(9000);
  const result = {
    config: runtime.config,
    status: runtime.status,
    sentTypes: window.__oracleQa.sent.map(x => x.type),
    sentAudioLengths: window.__oracleQa.sent.filter(x => x.type === 'voice.audio.chunk').map(x => x.audioLength),
    receivedTypes: window.__oracleQa.received.map(x => x.type),
    receivedPayloads: window.__oracleQa.received,
    lifecycle: window.__oracleQa.lifecycle,
    chatStreams: window.__oracleQa.chatStreams,
    errors: window.__oracleQa.errors,
    lastStates: window.__oracleQa.states.slice(-24),
    speechEvents: window.__oracleQa.mic.filter(x => x.voiceActivityEvent || x.hasChunk).slice(-40),
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
    timeout: 30000,
  });
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
