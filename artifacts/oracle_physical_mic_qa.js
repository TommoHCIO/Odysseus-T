const http = require('http');

const LISTEN_MS = Number(process.env.ORACLE_PHYSICAL_MIC_LISTEN_MS || process.argv[2] || 30000);
const PRINT_FULL_RESULT = process.env.ORACLE_PHYSICAL_MIC_FULL_RESULT === '1';
const EXPECTED_TEXT = String(process.env.ORACLE_PHYSICAL_MIC_EXPECTED_TEXT || '').trim();
const EXPECT_NON_SUBMIT = process.env.ORACLE_PHYSICAL_MIC_EXPECT_NON_SUBMIT === '1';
const EXPECT_QUALITY_GATE = String(process.env.ORACLE_PHYSICAL_MIC_EXPECT_QUALITY_GATE || '').trim();
const ALLOW_BROWSER_SPEECH = process.env.ORACLE_PHYSICAL_MIC_ALLOW_BROWSER_SPEECH === '1';
const COUNTDOWN_MS = Number(process.env.ORACLE_PHYSICAL_MIC_COUNTDOWN_MS || 3000);
const DEVICE_LABEL = String(process.env.ORACLE_PHYSICAL_MIC_DEVICE_LABEL || '').trim();
const DEVICE_INDEX = process.env.ORACLE_PHYSICAL_MIC_DEVICE_INDEX === undefined
  ? null
  : Number(process.env.ORACLE_PHYSICAL_MIC_DEVICE_INDEX);

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

function countTypes(types) {
  const counts = {};
  for (const type of types || []) {
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function transcriptTexts(payloads, type) {
  return (payloads || [])
    .filter(payload => payload && payload.type === type && payload.text)
    .map(payload => payload.text);
}

function normalizeTranscriptText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function transcriptMatchesExpectedText(candidate, expectedText = EXPECTED_TEXT) {
  const candidateText = normalizeTranscriptText(candidate);
  const expected = normalizeTranscriptText(expectedText);
  if (!expected) return true;
  if (!candidateText) return false;
  if (candidateText.includes(expected)) return true;
  const candidateWords = new Set(candidateText.split(' ').filter(Boolean));
  const expectedWords = Array.from(new Set(expected.split(' ').filter(Boolean)));
  return expectedWords.length > 0 && expectedWords.every(word => candidateWords.has(word));
}

function firstAt(items, predicate) {
  const item = (items || []).find(predicate);
  return item && Number.isFinite(item.at) ? item.at : null;
}

function durationBetween(startAt, endAt) {
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;
  return Math.max(0, endAt - startAt);
}

function latencySummary(value) {
  const speechStartAt = firstAt(value.speechStarts, () => true);
  const firstPartialAt = firstAt(value.receivedPayloads, payload => payload.type === 'voice.transcript.partial');
  const firstFinalAt = firstAt(value.receivedPayloads, payload => payload.type === 'voice.transcript.final');
  const firstAudioEndAt = firstAt(value.sentPayloads, payload => payload.type === 'voice.audio.end');
  const firstAudioChunkAt = firstAt(value.sentPayloads, payload => payload.type === 'voice.audio.chunk');
  return {
    firstSpeechStartToFirstAudioChunk: durationBetween(speechStartAt, firstAudioChunkAt),
    firstSpeechStartToFirstPartial: durationBetween(speechStartAt, firstPartialAt),
    firstSpeechStartToFirstFinal: durationBetween(speechStartAt, firstFinalAt),
    firstAudioEndToFirstFinal: durationBetween(firstAudioEndAt, firstFinalAt),
  };
}

function targetValue(targets, key) {
  const value = targets && targets[key];
  return Number.isFinite(value) ? value : null;
}

function latencyTargets(value) {
  const targets = value.config && value.config.targets_ms;
  return {
    firstSpeechStartToFirstAudioChunk: targetValue(targets, 'speech_start'),
    firstSpeechStartToFirstPartial: targetValue(targets, 'first_transcript'),
    firstSpeechStartToFirstFinal: targetValue(targets, 'first_transcript'),
    firstAudioEndToFirstFinal: targetValue(targets, 'first_transcript'),
  };
}

function budgetResult(measuredMs, targetMs) {
  const missing = !Number.isFinite(measuredMs) || !Number.isFinite(targetMs);
  if (missing) {
    return {
      measuredMs,
      targetMs,
      status: 'missing',
      withinTarget: false,
      overBy: null,
      missing: true,
    };
  }

  const overBy = Math.max(0, measuredMs - targetMs);
  return {
    measuredMs,
    targetMs,
    status: overBy === 0 ? 'withinTarget' : 'overTarget',
    withinTarget: overBy === 0,
    overBy,
    missing: false,
  };
}

function latencyBudget(latencyMs, latencyTargetsMs) {
  return {
    firstSpeechStartToFirstAudioChunk: budgetResult(
      latencyMs.firstSpeechStartToFirstAudioChunk,
      latencyTargetsMs.firstSpeechStartToFirstAudioChunk,
    ),
    firstSpeechStartToFirstPartial: budgetResult(
      latencyMs.firstSpeechStartToFirstPartial,
      latencyTargetsMs.firstSpeechStartToFirstPartial,
    ),
    firstSpeechStartToFirstFinal: budgetResult(
      latencyMs.firstSpeechStartToFirstFinal,
      latencyTargetsMs.firstSpeechStartToFirstFinal,
    ),
    firstAudioEndToFirstFinal: budgetResult(
      latencyMs.firstAudioEndToFirstFinal,
      latencyTargetsMs.firstAudioEndToFirstFinal,
    ),
  };
}

function numericValues(items, key) {
  return (items || [])
    .map(item => Number(item && item[key]))
    .filter(value => Number.isFinite(value));
}

function inputCalibration(value) {
  const vadTail = value.vadTail || [];
  const thresholds = numericValues(vadTail, 'adaptiveSpeechThreshold');
  const maxVoiceActivityLevel = Number(value.maxVoiceActivityLevel) || 0;
  const minAdaptiveSpeechThreshold = thresholds.length ? Math.min(...thresholds) : null;
  return {
    maxVoiceActivityLevel,
    minAdaptiveSpeechThreshold,
    levelToThresholdRatio: Number.isFinite(minAdaptiveSpeechThreshold) && minAdaptiveSpeechThreshold > 0
      ? maxVoiceActivityLevel / minAdaptiveSpeechThreshold
      : null,
    reachedSpeechThreshold: Number.isFinite(minAdaptiveSpeechThreshold)
      ? maxVoiceActivityLevel >= minAdaptiveSpeechThreshold
      : null,
  };
}

function expectedTranscriptMatch(value) {
  const receivedPayloads = value.receivedPayloads || [];
  const chatStreams = value.chatStreams || [];
  const finalTranscripts = [
    ...transcriptTexts(receivedPayloads, 'voice.transcript.final'),
    ...(value.browserFinalTranscripts || []),
  ];
  const chatMessages = chatStreams.map(entry => entry.fields && entry.fields.message).filter(Boolean);
  const matchingChatMessages = EXPECTED_TEXT
    ? chatMessages.filter(text => transcriptMatchesExpectedText(text))
    : [];
  const unexpectedChatMessages = EXPECTED_TEXT
    ? chatMessages.filter(text => !transcriptMatchesExpectedText(text))
    : [];
  return {
    required: Boolean(EXPECTED_TEXT),
    expectedText: EXPECTED_TEXT || null,
    finalTranscriptMatches: EXPECTED_TEXT
      ? finalTranscripts.some(text => transcriptMatchesExpectedText(text))
      : null,
    chatTranscriptMatches: EXPECTED_TEXT
      ? chatMessages.some(text => transcriptMatchesExpectedText(text))
      : null,
    matchingChatCount: EXPECTED_TEXT ? matchingChatMessages.length : null,
    unexpectedChatMessages,
  };
}

function recentHeardTranscriptText(value) {
  const finalTranscripts = [
    ...transcriptTexts(value.receivedPayloads || [], 'voice.transcript.final'),
    ...(value.browserFinalTranscripts || []),
  ].filter(Boolean);
  const filterHeard = (value.status && value.status.lastTranscriptFilter && value.status.lastTranscriptFilter.heardText)
    ? [value.status.lastTranscriptFilter.heardText]
    : [];
  return [...finalTranscripts, ...filterHeard].slice(-3).join(' | ');
}

function expectedTextFailureMessage(value) {
  const heardText = recentHeardTranscriptText(value);
  const filters = value.transcriptFilters || [];
  const backgroundFiltered = filters.some(filter => filter && filter.reason === 'background_noise')
    || (value.status && value.status.lastTranscriptFilter && value.status.lastTranscriptFilter.reason === 'background_noise');
  if (usesCartesiaSttPath(value) && backgroundFiltered) {
    return heardText
      ? `Cartesia heard background/no directed speech instead of expected text: ${heardText}`
      : 'Cartesia heard background/no directed speech instead of expected text';
  }
  return usesCartesiaSttPath(value)
    ? 'final Cartesia transcript did not match expected text'
    : 'final websocket transcript did not match expected text';
}

function expectedNonSubmit(value) {
  const chatStreams = value.chatStreams || [];
  const lastTranscriptSource = value.status && value.status.lastTranscriptSource;
  const lastTranscriptDiagnostics = value.status && value.status.lastTranscriptDiagnostics;
  const submitToChat = lastTranscriptSource && lastTranscriptSource.submitToChat;
  const qualityGate = lastTranscriptDiagnostics && lastTranscriptDiagnostics.quality_gate;
  return {
    required: EXPECT_NON_SUBMIT,
    expectedQualityGate: EXPECT_QUALITY_GATE || null,
    submitToChat: typeof submitToChat === 'boolean' ? submitToChat : null,
    chatStreamCount: chatStreams.length,
    qualityGate: qualityGate || null,
    passed: EXPECT_NON_SUBMIT
      ? submitToChat === false
        && chatStreams.length === 0
        && (!EXPECT_QUALITY_GATE || qualityGate === EXPECT_QUALITY_GATE)
      : null,
  };
}

function selectedVoiceMode(value) {
  const mode = value.config && value.config.voice_mode && value.config.voice_mode.selected;
  return typeof mode === 'string' ? mode : '';
}

function expectedVoiceSource(value) {
  if (ALLOW_BROWSER_SPEECH) return 'voice.browser_speech';
  return selectedVoiceMode(value) === 'cartesia'
    ? 'voice.cartesia_stt'
    : 'voice.websocket';
}

function usesVoiceWebsocketPath(value) {
  return expectedVoiceSource(value) === 'voice.websocket';
}

function usesCartesiaSttPath(value) {
  return expectedVoiceSource(value) === 'voice.cartesia_stt';
}

function buildSummary(value, passed = true) {
  const receivedPayloads = value.receivedPayloads || [];
  const chatStreams = value.chatStreams || [];
  const latencyMs = latencySummary(value);
  const latencyTargetsMs = latencyTargets(value);
  return {
    passed,
    listenMs: value.listenMs,
    microphoneRealPath: value.microphoneRealPath,
    speechRecognitionState: value.status && value.status.speechRecognitionState,
    stt: value.config && value.config.stt,
    bridge: value.config && value.config.speech_to_chat_bridge,
    vad: {
      speechStarts: (value.speechStarts || []).length,
      speechEnds: (value.speechEnds || []).length,
      maxVoiceActivityLevel: value.maxVoiceActivityLevel,
    },
    microphoneDevices: value.microphoneDevices || [],
    selectedMicrophoneDevice: value.selectedMicrophoneDevice || null,
    activeAudioTracks: value.activeAudioTracks || [],
    inputCalibration: inputCalibration(value),
    websocketSentCounts: countTypes(value.sentTypes),
    websocketReceivedCounts: countTypes(value.receivedTypes),
    websocketLifecycleCounts: countTypes((value.lifecycle || []).map(entry => entry.type)),
    websocketLifecycleTail: (value.lifecycle || []).slice(-12),
    cartesiaRealtimeSttState: value.status && value.status.cartesiaRealtimeSttState,
    cartesiaRealtimeSttLatency: value.status && value.status.cartesiaRealtimeSttLatency,
    cartesiaRuntimeBlocker: value.status && value.status.cartesiaRealtimeSetupBlocker,
    cartesiaRealtimeSttErrors: value.cartesiaRealtimeSttErrors || [],
    cartesiaRealtimeSttStates: value.cartesiaRealtimeSttStates || [],
    speechPlaybackStates: value.speechPlaybackStates || [],
    voiceInputHealth: value.status && value.status.voiceInputHealth,
    latencyMs,
    latencyTargetsMs,
    latencyBudget: latencyBudget(latencyMs, latencyTargetsMs),
    expectedText: EXPECTED_TEXT || null,
    expectedTranscriptMatch: expectedTranscriptMatch(value),
    expectedNonSubmit: expectedNonSubmit(value),
    partialTranscripts: transcriptTexts(receivedPayloads, 'voice.transcript.partial'),
    finalTranscripts: transcriptTexts(receivedPayloads, 'voice.transcript.final'),
    browserFinalTranscripts: value.browserFinalTranscripts || [],
    chatMessages: chatStreams.map(entry => entry.fields && entry.fields.message).filter(Boolean),
    chatSources: chatStreams
      .map(entry => entry.fields && entry.fields.voice_transcript_source)
      .filter(Boolean),
    lastTranscriptSource: value.status && value.status.lastTranscriptSource,
    lastTranscriptDiagnostics: value.status && value.status.lastTranscriptDiagnostics,
    lastTranscriptFilter: value.status && value.status.lastTranscriptFilter,
    transcriptFilters: value.transcriptFilters || [],
    microphoneErrors: value.microphoneErrors || [],
    browserErrors: value.errors || [],
    sourceChecks: value.sourceChecks || {},
  };
}

async function main() {
  const tabs = await getJson('http://127.0.0.1:9226/json/list');
  const tab = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:7000'))
    || tabs.find(t => t.type === 'page');
  if (!tab) throw new Error('No CDP page tab found at http://127.0.0.1:9226');

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
  await send('Page.navigate', { url: 'http://127.0.0.1:7000/?codexqa=voice-physical-mic-hitl-v1' });
  await new Promise(resolve => setTimeout(resolve, 3500));

  console.log(`Physical microphone QA armed for ${LISTEN_MS} ms.`);
  console.log(`Browser cue will count down for ${COUNTDOWN_MS} ms, then show SPEAK NOW.`);
  if (EXPECTED_TEXT) {
    console.log(`Expected transcript text: ${EXPECTED_TEXT}`);
  }
  if (ALLOW_BROWSER_SPEECH) {
    console.log('Browser SpeechRecognition remains enabled for this run.');
  }
  if (DEVICE_LABEL) {
    console.log(`Requested microphone label contains: ${DEVICE_LABEL}`);
  }
  if (Number.isInteger(DEVICE_INDEX)) {
    console.log(`Requested microphone device index: ${DEVICE_INDEX}`);
  }

  const expression = `
(async () => {
    const listenMs = ${JSON.stringify(LISTEN_MS)};
    const countdownMs = ${JSON.stringify(COUNTDOWN_MS)};
    const requestedDeviceLabel = ${JSON.stringify(DEVICE_LABEL)};
    const requestedDeviceIndex = ${JSON.stringify(DEVICE_INDEX)};
    const allowBrowserSpeech = ${JSON.stringify(ALLOW_BROWSER_SPEECH)};
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const qa = window.__oraclePhysicalMicQa = { states: [], mic: [], sent: [], received: [], lifecycle: [], chatStreams: [], errors: [] };

  function showQaCue(text, phase = 'info') {
    let node = document.querySelector('#oracle-physical-mic-qa-cue');
    if (!node) {
      node = document.createElement('div');
      node.id = 'oracle-physical-mic-qa-cue';
      node.setAttribute('role', 'status');
      node.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'inset:auto 24px 24px 24px',
        'padding:16px 18px',
        'border-radius:8px',
        'background:#111827',
        'color:#f9fafb',
        'font:600 18px/1.35 system-ui,-apple-system,Segoe UI,sans-serif',
        'box-shadow:0 16px 48px rgba(0,0,0,.35)',
        'text-align:center',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(node);
    }
    node.dataset.phase = phase;
    node.textContent = text;
  }

  function redactDeviceId(value) {
    const text = String(value || '');
    if (!text) return '';
    if (text.length <= 12) return '[redacted]';
    return text.slice(0, 6) + '...' + text.slice(-4);
  }

  function sanitizeAudioSettings(settings = {}) {
    return {
      deviceId: redactDeviceId(settings.deviceId),
      groupId: redactDeviceId(settings.groupId),
      sampleRate: settings.sampleRate,
      sampleSize: settings.sampleSize,
      channelCount: settings.channelCount,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
    };
  }

  async function listRawAudioInputDevices() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'audioinput');
  }

  function describeAudioInputDevice(device, index) {
    if (!device) return null;
    return {
      index,
      label: device.label || '(permission required or unlabeled microphone)',
      deviceId: redactDeviceId(device.deviceId),
      groupId: redactDeviceId(device.groupId),
    };
  }

  async function listAudioInputs() {
    return (await listRawAudioInputDevices()).map((device, index) => describeAudioInputDevice(device, index));
  }

  function pickAudioInputDevice(devices, label, index) {
    if (Number.isInteger(index) && index >= 0 && index < devices.length) return devices[index];
    const wanted = String(label || '').trim().toLowerCase();
    if (!wanted) return null;
    return devices.find(device => String(device.label || '').toLowerCase().includes(wanted)) || null;
  }

  function activeAudioTracks(runtime) {
    const stream = runtime && runtime.micCapture && runtime.micCapture.stream;
    if (!stream || typeof stream.getAudioTracks !== 'function') return [];
    return stream.getAudioTracks().map((track, index) => ({
      index,
      label: track.label || '(unlabeled active microphone)',
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      settings: typeof track.getSettings === 'function' ? sanitizeAudioSettings(track.getSettings()) : {},
    }));
  }

  window.addEventListener('oraclevoice:state', event => {
    const d = event.detail || {};
    const s = d.status || {};
    qa.states.push({
      at: Date.now(),
      state: s.state,
      speechState: s.speechState,
      microphoneState: s.microphoneState,
      voiceActivityState: s.voiceActivityState,
      voiceActivityLevel: s.voiceActivity && s.voiceActivity.level,
      voiceAudioStreamState: s.voiceAudioStreamState,
      voiceSocketState: s.voiceSocketState,
      cartesiaRealtimeSttState: s.cartesiaRealtimeSttState,
      cartesiaRealtimeSttLatency: s.cartesiaRealtimeSttLatency || null,
      cartesiaRealtimeSetupBlocker: s.cartesiaRealtimeSetupBlocker || null,
      cartesiaRuntimeBlocker: d.cartesiaRuntimeBlocker || null,
      cartesiaRealtimeSttError: d.cartesiaRealtimeSttError || null,
      lastTranscriptSource: s.lastTranscriptSource || null,
      lastTranscriptDiagnostics: s.lastTranscriptDiagnostics || null,
      lastTranscriptFilter: s.lastTranscriptFilter || null,
      finalTranscript: d.finalTranscript || null,
      transcriptSubmitted: d.transcriptSubmitted,
      transcriptRejected: d.transcriptRejected,
      transcriptAutocorrected: d.transcriptAutocorrected,
      transcriptSource: d.transcriptSource || null,
      transcriptDiagnostics: d.transcriptDiagnostics || null,
      transcriptFilter: d.transcriptFilter || null,
      speechPlaybackState: d.speechPlaybackState || null,
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
      error: s.error || null,
      voiceActivityState: s.voiceActivityState,
      voiceActivityLevel: d.voiceActivity && d.voiceActivity.level,
      noiseFloor: d.voiceActivity && d.voiceActivity.noiseFloor,
      adaptiveSpeechThreshold: d.voiceActivity && d.voiceActivity.adaptiveSpeechThreshold,
      adaptiveSilenceThreshold: d.voiceActivity && d.voiceActivity.adaptiveSilenceThreshold,
      listeningMs: d.voiceActivity && d.voiceActivity.listeningMs,
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
        qa.sent.push({ at: Date.now(), type: parsed.type, audioLength: parsed.audio ? parsed.audio.length : 0 });
      } catch (_) {
        qa.sent.push({ at: Date.now(), type: 'raw', length: String(data || '').length });
      }
      return originalSend(data);
    };
    socket.addEventListener('open', () => qa.lifecycle.push({ at: Date.now(), type: 'open' }));
    socket.addEventListener('close', event => qa.lifecycle.push({ at: Date.now(), type: 'close', code: event.code }));
    socket.addEventListener('error', () => qa.lifecycle.push({ at: Date.now(), type: 'error' }));
    socket.addEventListener('message', event => {
      try { qa.received.push({ at: Date.now(), ...JSON.parse(event.data) }); }
      catch (_) { qa.received.push({ at: Date.now(), type: 'raw', data: String(event.data || '').slice(0, 120) }); }
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
      const entry = { at: Date.now(), url, method: init.method || 'GET', fields: {} };
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

  for (let attempt = 0; attempt < 20 && !window.oracleVoiceRuntime; attempt += 1) await wait(500);
  const runtime = window.oracleVoiceRuntime;
  if (!runtime) throw new Error('oracleVoiceRuntime missing');

  const microphoneRealPath = Boolean(
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    window.MediaRecorder
  );

    if (!allowBrowserSpeech && runtime.speechRecognition) {
      runtime.speechRecognition.status = { ...runtime.speechRecognition.status, supported: false, state: 'unavailable' };
      runtime.speechRecognition.start = () => runtime.speechRecognition.status;
      runtime.speechRecognition.stop = () => runtime.speechRecognition.status;
  }

  await runtime.loadConfig();
  if (runtime.session && runtime.status && runtime.status.active) {
    try { await runtime.hardCancel('physical_mic_qa_reset'); await wait(800); } catch (_) {}
  }

  const prePermissionAudioInputs = await listRawAudioInputDevices();
  const selectedDevice = pickAudioInputDevice(prePermissionAudioInputs, requestedDeviceLabel, requestedDeviceIndex);
  if ((requestedDeviceLabel || Number.isInteger(requestedDeviceIndex)) && !selectedDevice) {
    qa.errors.push('requested microphone device was not found');
  }
  if (selectedDevice && runtime.micCapture && typeof runtime.micCapture.setPreferredDevice === 'function') {
    qa.selectedMicrophoneDevice = describeAudioInputDevice(
      selectedDevice,
      prePermissionAudioInputs.indexOf(selectedDevice),
    );
    runtime.micCapture.setPreferredDevice(selectedDevice);
  }

  const button = document.querySelector('#oracle-voice-btn');
  if (!button) throw new Error('Voice Orb button missing');
  showQaCue('O.R.A.C.L.E. mic QA: opening microphone. Wait for SPEAK NOW.', 'arming');
  button.click();
  await wait(500);
  const audioInputs = await listAudioInputs();
  showQaCue('O.R.A.C.L.E. mic QA: get ready...', 'countdown');
  await wait(Math.max(0, countdownMs));
  showQaCue('SPEAK NOW: say the expected phrase clearly, then stay quiet.', 'speak');
  await wait(listenMs);
  showQaCue('O.R.A.C.L.E. mic QA: collecting results...', 'done');

      const result = {
    config: runtime.config,
    status: runtime.status,
    microphoneRealPath,
    listenMs,
    sentTypes: qa.sent.map(x => x.type),
    sentPayloads: qa.sent,
    receivedTypes: qa.received.map(x => x.type),
    receivedPayloads: qa.received,
    lifecycle: qa.lifecycle,
        chatStreams: qa.chatStreams,
        browserFinalTranscripts: qa.states.map(x => x.finalTranscript).filter(Boolean),
        cartesiaRealtimeSttStates: qa.states.map(x => x.cartesiaRealtimeSttState).filter(Boolean),
        cartesiaRealtimeSttErrors: qa.states
          .map(x => x.cartesiaRealtimeSttError || x.cartesiaRuntimeBlocker || x.error)
          .filter(Boolean),
        speechPlaybackStates: qa.states.map(x => x.speechPlaybackState).filter(Boolean),
        transcriptFilters: qa.states.map(x => x.transcriptFilter || x.lastTranscriptFilter).filter(Boolean),
        errors: qa.errors,
    microphoneDevices: audioInputs,
    selectedMicrophoneDevice: qa.selectedMicrophoneDevice || null,
    activeAudioTracks: activeAudioTracks(runtime),
    speechStarts: qa.mic.filter(x => x.voiceActivityEvent === 'speech_start'),
    speechEnds: qa.mic.filter(x => x.voiceActivityEvent === 'speech_end'),
    maxVoiceActivityLevel: Math.max(0, ...qa.mic.map(x => Number(x.voiceActivityLevel) || 0)),
    microphoneStates: qa.mic.map(x => x.state),
    microphoneErrors: qa.mic.map(x => x.error).filter(Boolean),
    stateTail: qa.states.slice(-30),
    vadTail: qa.mic.slice(-80).map(x => ({
      at: x.at,
      state: x.voiceActivityState,
      level: x.voiceActivityLevel,
      noiseFloor: x.noiseFloor,
      adaptiveSpeechThreshold: x.adaptiveSpeechThreshold,
      adaptiveSilenceThreshold: x.adaptiveSilenceThreshold,
      listeningMs: x.listeningMs,
      event: x.voiceActivityEvent,
    })),
    speechEvents: qa.mic.filter(x => x.voiceActivityEvent || x.hasChunk || x.error).slice(-80),
    sourceChecks: {
      runtimePrepare: (await fetch('/static/js/voiceRuntime.js').then(r => r.text())).includes('_prepareSpeechAudioSegment'),
      micRestart: (await fetch('/static/js/voiceMicCapture.js').then(r => r.text())).includes('restartSegment'),
      vadResume: (await fetch('/static/js/voiceActivityDetection.js').then(r => r.text())).includes('audioContext.resume().catch(() => {})'),
      cartesiaLatencyStatus: (await fetch('/static/js/voiceRuntime.js').then(r => r.text())).includes('cartesiaRealtimeSttLatency'),
      voiceTranscriptFilter: (await fetch('/static/js/voiceRuntime.js').then(r => r.text())).includes('_prepareVoiceTranscriptForChat'),
    },
  };
  try { await runtime.hardCancel('physical_mic_qa_cleanup'); } catch (_) {}
  return result;
})()
`;
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: Math.max(35000, LISTEN_MS + 10000),
    userGesture: true,
  });
  if (result.exceptionDetails) {
    console.log(JSON.stringify({ exceptionDetails: result.exceptionDetails }, null, 2));
    ws.close();
    process.exit(1);
  }

  const value = result.result.value;
  const finalPayload = (value.receivedPayloads || []).find((payload) => payload.type === 'voice.transcript.final');
  const finalDiagnostics = finalPayload && finalPayload.diagnostics;
  const statusDiagnostics = value.status && value.status.lastTranscriptDiagnostics;
  const finalTranscripts = [
    ...transcriptTexts(value.receivedPayloads || [], 'voice.transcript.final'),
    ...(value.browserFinalTranscripts || []),
  ];
  const chatMessages = (value.chatStreams || []).map(entry => entry.fields && entry.fields.message).filter(Boolean);
  const calibration = inputCalibration(value);
  const expectedSource = expectedVoiceSource(value);
  const sttProvider = value.config && value.config.stt && value.config.stt.provider;
  const expectsLocalSttDiagnostics = sttProvider === 'local';
  const failures = [];
  if (!value.microphoneRealPath) failures.push('real microphone path is unavailable');
  if (!ALLOW_BROWSER_SPEECH && calibration.reachedSpeechThreshold === false) {
    failures.push('physical microphone input never reached speech start threshold');
  }
  if (!ALLOW_BROWSER_SPEECH && (!value.speechStarts || value.speechStarts.length < 1)) failures.push('production VAD did not emit speech_start from physical microphone');
  if (!ALLOW_BROWSER_SPEECH && (!value.speechEnds || value.speechEnds.length < 1)) failures.push('production VAD did not emit speech_end from physical microphone');
  if (!(value.maxVoiceActivityLevel > 0)) failures.push('physical microphone never reported a positive voice activity level');
  if (usesVoiceWebsocketPath(value)) {
    for (const type of ['voice.audio.start', 'voice.audio.chunk', 'voice.audio.end']) {
      if (!(value.sentTypes || []).includes(type)) failures.push(`missing sent websocket event ${type}`);
    }
  }
  if (usesVoiceWebsocketPath(value) && (!finalPayload || !finalPayload.text)) failures.push('missing final websocket transcript');
  if (usesVoiceWebsocketPath(value) && expectsLocalSttDiagnostics && (!finalDiagnostics || finalDiagnostics.provider !== 'local')) failures.push('missing final transcript STT diagnostics');
  if (usesVoiceWebsocketPath(value) && expectsLocalSttDiagnostics && (!statusDiagnostics || statusDiagnostics.provider !== 'local')) failures.push('runtime status missing lastTranscriptDiagnostics');
  if (usesCartesiaSttPath(value) && !(value.status && value.status.cartesiaRealtimeSttLatency && value.status.cartesiaRealtimeSttLatency.provider === 'cartesia')) {
    failures.push('runtime status missing Cartesia realtime STT latency diagnostics');
  }
  if (EXPECTED_TEXT && !finalTranscripts.some(text => transcriptMatchesExpectedText(text))) {
    failures.push(expectedTextFailureMessage(value));
  }
  if (!EXPECT_NON_SUBMIT && EXPECTED_TEXT && !chatMessages.some(text => transcriptMatchesExpectedText(text))) {
    failures.push('chat submitted transcript did not match expected text');
  }
  if (!EXPECT_NON_SUBMIT && EXPECTED_TEXT) {
    const unexpectedChatMessages = chatMessages.filter(text => !transcriptMatchesExpectedText(text));
    const matchingChatMessages = chatMessages.filter(text => transcriptMatchesExpectedText(text));
    if (unexpectedChatMessages.length) {
      failures.push(`unexpected chat transcript(s) submitted: ${unexpectedChatMessages.join(' | ')}`);
    }
    if (matchingChatMessages.length > 1) {
      failures.push(`expected transcript submitted ${matchingChatMessages.length} times`);
    }
  }
  if (EXPECT_NON_SUBMIT && expectedNonSubmit(value).submitToChat !== false) {
    failures.push('expected non-submit transcript was submitted to chat');
  }
  if (EXPECT_NON_SUBMIT && (value.chatStreams || []).length > 0) {
    failures.push('expected non-submit transcript was submitted to chat');
  }
  if (EXPECT_NON_SUBMIT && EXPECT_QUALITY_GATE && (!statusDiagnostics || statusDiagnostics.quality_gate !== EXPECT_QUALITY_GATE)) {
    failures.push('last transcript quality gate did not match expected gate');
  }
  if (!EXPECT_NON_SUBMIT && !(value.chatStreams || []).some((entry) => entry.fields && entry.fields.voice_transcript_source && entry.fields.voice_transcript_source.includes(expectedSource))) {
    failures.push('chat_stream did not include expected voice provenance');
  }
  if ((value.microphoneErrors || []).length) failures.push(`microphone errors: ${value.microphoneErrors.join('; ')}`);
  if ((value.errors || []).length) failures.push(`browser QA errors: ${value.errors.join('; ')}`);
  if (failures.length) {
    const failureOutput = PRINT_FULL_RESULT
      ? { failures, result: value }
      : { failures, summary: buildSummary(value, false) };
    console.log(JSON.stringify(failureOutput, null, 2));
    ws.close();
    process.exit(1);
  }
  console.log(JSON.stringify(PRINT_FULL_RESULT ? value : buildSummary(value), null, 2));
  ws.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
