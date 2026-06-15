const ICON_MIC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M8 22h8"/></svg>';
const ICON_WAVEFORM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h2"/><path d="M7 8v8"/><path d="M12 5v14"/><path d="M17 8v8"/><path d="M22 12h-2"/></svg>';
const ICON_LOADER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m7.8 16.2-2.9 2.9"/><path d="M6 12H2"/><path d="m7.8 7.8-2.9-2.9"/></svg>';
const ICON_VOLUME = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
const ICON_STOP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6h12v12H6z"/></svg>';
const ICON_X = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_MIC_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.1-2.1"/><path d="M19 10v1a7 7 0 0 1-.8 3.2"/><path d="M5 10v1a7 7 0 0 0 11.7 5.2"/><path d="M12 18v4"/><path d="M8 22h8"/></svg>';

const ORACLE_STATE_PRESENTATION = {
  idle: { label: 'Ready', icon: ICON_MIC, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  listening: { label: 'Listening', icon: ICON_MIC, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  transcribing: { label: 'Transcribing', icon: ICON_WAVEFORM, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  thinking: { label: 'Thinking', icon: ICON_LOADER, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  working: { label: 'Working', icon: ICON_LOADER, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  speaking: { label: 'Speaking', icon: ICON_VOLUME, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  interrupted: { label: 'Interrupted', icon: ICON_STOP, inactiveAction: 'Resume O.R.A.C.L.E.', activeAction: 'Resume O.R.A.C.L.E.' },
  cancelled: { label: 'Cancelled', icon: ICON_X, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Start O.R.A.C.L.E.' },
  initializing: { label: 'Waking', icon: ICON_LOADER, inactiveAction: 'Start O.R.A.C.L.E.', activeAction: 'Soft Interrupt O.R.A.C.L.E.' },
  unavailable: { label: 'Unavailable', icon: ICON_MIC_OFF, inactiveAction: 'O.R.A.C.L.E. unavailable', activeAction: 'O.R.A.C.L.E. unavailable' },
  microphone: { label: 'Microphone unavailable', icon: ICON_MIC_OFF, inactiveAction: 'Check microphone access', activeAction: 'Check microphone access' },
};
const ORACLE_HARD_HOLD_MS = 900;
const ORACLE_MIC_SELECT_ID = 'oracle-mic-select';
const ORACLE_PRESENCE_ID = 'oracle-voice-presence';
const ORACLE_ROUTE_ID = 'oracle-voice-route';
const ORACLE_SETUP_ID = 'oracle-voice-setup';
const ORACLE_SETUP_STATUS_ID = 'oracle-voice-setup-status';
const ORACLE_CARTESIA_KEY_ID = 'oracle-cartesia-key';
const ORACLE_CARTESIA_SAVE_ID = 'oracle-cartesia-save';
const ORACLE_CARTESIA_TEST_ID = 'oracle-cartesia-test';
const ORACLE_FILTERED_INPUT_PRESENCE_KEYS = new Set([
  'background_noise',
  'oracle_playback_echo',
  'duplicate_voice_transcript',
]);

function microphoneOptionValue(device, index) {
  if (!device) return '';
  return device.deviceId || `oracle-mic-${index}`;
}

function microphoneOptionLabel(device, index) {
  if (!device) return 'Microphone';
  const label = typeof device.label === 'string' ? device.label.trim() : '';
  return label || `Microphone ${index + 1}`;
}

function resolveVoicePresence(status, detail) {
  const state = status.state || 'idle';
  const speechState = status.speechState || 'idle';
  const executionState = status.executionState || 'idle';
  const configState = status.configState || '';
  const microphoneState = status.microphoneState || 'idle';
  const speechRecognitionState = status.speechRecognitionState || '';
  const voiceAudioStreamState = status.voiceAudioStreamState || detail.voiceAudioStreamState || '';
  const serverTranscriptionState = detail.serverTranscriptionState || '';
  const speechPlaybackState = detail.speechPlaybackState || '';
  const voiceInputHealth = status.voiceInputHealth || detail.voiceInputHealth || null;

  if (microphoneState === 'denied' || microphoneState === 'unavailable' || microphoneState === 'error') {
    return { key: 'microphone', label: 'Mic blocked' };
  }
  if (!status.available && configState !== 'error') return { key: 'initializing', label: 'Waking' };
  if (!status.available) return { key: 'unavailable', label: 'Unavailable' };
  if (state === 'cancelled') return { key: 'cancelled', label: 'Cancelled' };
  if (state === 'interrupted') return { key: 'interrupted', label: 'Interrupted' };
  if (
    state === 'speaking'
    || speechState === 'speaking'
    || (speechPlaybackState && !['idle', 'dropped'].includes(speechPlaybackState))
  ) {
    return { key: 'speaking', label: 'Speaking' };
  }
  if (
    state === 'transcribing'
    || speechState === 'transcribing'
    || voiceAudioStreamState === 'transcribing'
    || serverTranscriptionState === 'transcribing'
  ) {
    return { key: 'transcribing', label: 'Transcribing' };
  }
  if (status.active && voiceInputHealth && ORACLE_FILTERED_INPUT_PRESENCE_KEYS.has(voiceInputHealth.key)) {
    return {
      key: voiceInputHealth.key,
      label: voiceInputHealth.label || 'Filtered',
      title: voiceInputHealth.title || 'Voice input was filtered',
    };
  }
  if (state === 'thinking') return { key: 'thinking', label: 'Thinking' };
  if (state === 'working' || executionState === 'working') return { key: 'working', label: 'Working' };
  if (
    status.active
    || microphoneState === 'capturing'
    || speechRecognitionState === 'listening'
    || voiceAudioStreamState === 'streaming'
  ) {
    return { key: 'listening', label: 'Listening' };
  }
  return { key: 'idle', label: 'Ready' };
}

function resolveVoiceRoute(status, detail) {
  const config = detail.config || {};
  const voiceMode = config.voice_mode || {};
  const selectedMode = ['local', 'hybrid', 'cartesia'].includes(String(voiceMode.selected || '').toLowerCase())
    ? String(voiceMode.selected).toLowerCase()
    : 'hybrid';
  const providerTokens = config.realtime_provider_tokens || {};
  const cartesia = providerTokens.cartesia || {};
  const cartesiaRuntimeBlocker = detail.cartesiaRuntimeBlocker || status.cartesiaRealtimeSetupBlocker || '';
  const bridge = config.speech_to_chat_bridge || {};
  if (selectedMode === 'cartesia') {
    if (cartesiaRuntimeBlocker || detail.cartesiaRealtimeProviderBlocked === true || status.cartesiaRealtimeBlocked === true) {
      return {
        key: 'setup',
        label: 'Setup',
        title: `Cartesia token setup failed: ${cartesiaRuntimeBlocker || 'provider unavailable'}`,
      };
    }
    if (cartesia.available !== true) {
      return {
        key: 'setup',
        label: 'Setup',
        title: 'Cartesia mode needs a saved API key',
      };
    }
    return {
      key: 'cartesia',
      label: 'Cartesia',
      title: 'O.R.A.C.L.E. Cartesia realtime path is ready',
    };
  }
  if (selectedMode === 'local') {
    return {
      key: 'local',
      label: 'Local',
      title: 'O.R.A.C.L.E. browser-only voice path',
    };
  }
  if (
    config.supports_speech_to_chat === true
    || bridge.supports_speech_to_chat === true
    || config.supports_ws_audio_stream === true
  ) {
    return {
      key: 'hybrid',
      label: 'Hybrid',
      title: 'O.R.A.C.L.E. browser speech with server speech fallback',
    };
  }
  if (
    status.available
    && status.speechRecognition
    && status.speechRecognition.supported === true
    && !['error', 'unavailable', 'unsupported'].includes(status.speechRecognition.state)
  ) {
    return {
      key: 'local',
      label: 'Local',
      title: 'O.R.A.C.L.E. browser speech path is ready',
    };
  }
  if (status.available) {
    return {
      key: 'local',
      label: 'Local',
      title: 'O.R.A.C.L.E. local voice path is available',
    };
  }
  return {
    key: 'setup',
    label: 'Setup',
    title: 'O.R.A.C.L.E. voice path needs setup',
  };
}

export function mountVoiceOrb(runtime, options = {}) {
  const button = document.getElementById('oracle-voice-btn');
  const micSelect = document.getElementById(ORACLE_MIC_SELECT_ID);
  const presenceEl = document.getElementById(ORACLE_PRESENCE_ID);
  const routeEl = document.getElementById(ORACLE_ROUTE_ID);
  const setupEl = document.getElementById(ORACLE_SETUP_ID);
  const setupStatusEl = document.getElementById(ORACLE_SETUP_STATUS_ID);
  const cartesiaKeyInput = document.getElementById(ORACLE_CARTESIA_KEY_ID);
  const cartesiaSaveBtn = document.getElementById(ORACLE_CARTESIA_SAVE_ID);
  const cartesiaTestBtn = document.getElementById(ORACLE_CARTESIA_TEST_ID);
  const modeButtons = Array.from(document.querySelectorAll('[data-oracle-mode-option]'));
  let hardHoldTimer = null;
  let hardHoldTriggered = false;
  let hardHoldPointerId = null;
  let microphoneDevices = [];
  let microphoneRefreshInFlight = null;

  if (!button || !runtime) return null;

  button.innerHTML = [
    '<span class="oracle-voice-icon" aria-hidden="true">',
    ICON_MIC,
    '</span>',
    '<span class="oracle-voice-dot" aria-hidden="true"></span>',
    '<span class="oracle-voice-status a11y-visually-hidden" aria-live="polite">O.R.A.C.L.E. Ready</span>',
  ].join('');
  button.title = 'Start O.R.A.C.L.E.';
  button.setAttribute('aria-label', 'Start O.R.A.C.L.E.');
  button.setAttribute('aria-keyshortcuts', 'Shift+Enter');

  async function refreshMicrophoneDevices() {
    if (!micSelect || typeof runtime.listMicrophoneDevices !== 'function') return [];
    if (microphoneRefreshInFlight) return microphoneRefreshInFlight;

    microphoneRefreshInFlight = runtime.listMicrophoneDevices()
      .then((devices) => {
        microphoneDevices = Array.isArray(devices) ? devices : [];
        const preferredDevice = runtime.micCapture && typeof runtime.micCapture.getPreferredDevice === 'function'
          ? runtime.micCapture.getPreferredDevice()
          : {};
        const selectedDeviceLabel = runtime.status && runtime.status.microphone
          ? runtime.status.microphone.selectedDeviceLabel || ''
          : '';
        const selectedValue = preferredDevice.deviceId
          || microphoneDevices.find((device) => device.label && device.label === preferredDevice.label)?.deviceId
          || '';

        micSelect.innerHTML = '';
        const fallbackOption = document.createElement('option');
        fallbackOption.value = '';
        fallbackOption.textContent = selectedDeviceLabel
          ? `Current: ${selectedDeviceLabel}`
          : 'Default microphone';
        micSelect.appendChild(fallbackOption);

        microphoneDevices.forEach((device, index) => {
          const option = document.createElement('option');
          option.value = microphoneOptionValue(device, index);
          option.textContent = microphoneOptionLabel(device, index);
          option.dataset.deviceId = device.deviceId || '';
          option.dataset.deviceLabel = device.label || '';
          micSelect.appendChild(option);
        });

        micSelect.value = selectedValue;
        micSelect.disabled = microphoneDevices.length === 0;
        micSelect.title = selectedDeviceLabel || preferredDevice.label || 'O.R.A.C.L.E. microphone';
        return microphoneDevices;
      })
      .catch(() => {
        if (micSelect) {
          micSelect.disabled = true;
          micSelect.title = 'O.R.A.C.L.E. microphone unavailable';
        }
        return [];
      })
      .finally(() => {
        microphoneRefreshInFlight = null;
      });
    return microphoneRefreshInFlight;
  }

  if (micSelect) {
    micSelect.addEventListener('focus', () => {
      refreshMicrophoneDevices().catch(() => {});
    });
    micSelect.addEventListener('click', () => {
      refreshMicrophoneDevices().catch(() => {});
    });
    micSelect.addEventListener('change', async () => {
      const selectedOption = micSelect.options[micSelect.selectedIndex];
      const selectedDevice = microphoneDevices.find((device, index) => (
        microphoneOptionValue(device, index) === micSelect.value
      )) || {
        deviceId: selectedOption ? selectedOption.dataset.deviceId || '' : '',
        label: selectedOption ? selectedOption.dataset.deviceLabel || selectedOption.textContent || '' : '',
      };
      try {
        runtime.selectMicrophoneDevice(selectedDevice);
        micSelect.title = selectedDevice.label || 'O.R.A.C.L.E. microphone';
      } catch (_) {}
    });
    refreshMicrophoneDevices().catch(() => {});
  }

  function currentVoiceMode() {
    const config = runtime.config || {};
    const voiceMode = config.voice_mode || {};
    const selected = String(voiceMode.selected || '').trim().toLowerCase();
    return ['local', 'hybrid', 'cartesia'].includes(selected) ? selected : 'hybrid';
  }

  function currentCartesiaStatus() {
    const config = runtime.config || {};
    const tokens = config.realtime_provider_tokens || {};
    const cartesia = tokens.cartesia || {};
    const runtimeStatus = runtime.status || {};
    if (runtimeStatus.cartesiaRealtimeBlocked) {
      return {
        ...cartesia,
        available: false,
        setup_blocker: runtimeStatus.cartesiaRealtimeSetupBlocker || cartesia.setup_blocker || 'cartesia_provider_unavailable',
      };
    }
    return cartesia;
  }

  function setSetupStatus(message, kind = 'neutral') {
    if (!setupStatusEl) return;
    setupStatusEl.textContent = message;
    setupStatusEl.dataset.oracleSetupStatus = kind;
  }

  function renderSetupControls(route) {
    const selectedMode = currentVoiceMode();
    const cartesia = currentCartesiaStatus();
    modeButtons.forEach((modeButton) => {
      const mode = modeButton.dataset.oracleModeOption || '';
      const activeMode = mode === selectedMode;
      modeButton.classList.toggle('active', activeMode);
      modeButton.setAttribute('aria-pressed', activeMode ? 'true' : 'false');
    });
    if (!setupEl) return;
    setupEl.dataset.oracleMode = selectedMode;
    setupEl.dataset.oracleCartesiaReady = cartesia.available === true ? 'true' : 'false';
    if (selectedMode === 'cartesia' && cartesia.available !== true) {
      setSetupStatus(cartesia.setup_blocker || 'Cartesia key needed', 'warning');
    } else if (selectedMode === 'cartesia') {
      setSetupStatus('Cartesia ready', 'ready');
    } else {
      setSetupStatus(`${route.label} mode`, 'neutral');
    }
  }

  function closeSetup() {
    if (!setupEl || setupEl.classList.contains('hidden')) return;
    setupEl.classList.add('hidden');
    if (routeEl) routeEl.setAttribute('aria-expanded', 'false');
  }

  function toggleSetup() {
    if (!setupEl || !routeEl) return;
    const nextOpen = setupEl.classList.contains('hidden');
    setupEl.classList.toggle('hidden', !nextOpen);
    routeEl.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    if (nextOpen && currentVoiceMode() === 'cartesia' && cartesiaKeyInput) {
      cartesiaKeyInput.focus();
    }
  }

  if (routeEl && setupEl) {
    routeEl.addEventListener('click', (event) => {
      event.preventDefault();
      toggleSetup();
    });
    document.addEventListener('click', (event) => {
      if (
        setupEl.classList.contains('hidden')
        || setupEl.contains(event.target)
        || routeEl.contains(event.target)
      ) return;
      closeSetup();
    });
    setupEl.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSetup();
    });
  }

  modeButtons.forEach((modeButton) => {
    modeButton.addEventListener('click', async () => {
      const mode = modeButton.dataset.oracleModeOption || 'hybrid';
      try {
        setSetupStatus('Saving', 'neutral');
        await runtime.setVoiceMode(mode);
        const cartesia = currentCartesiaStatus();
        if (mode === 'cartesia' && cartesia.available !== true) {
          setSetupStatus('Cartesia key needed', 'warning');
        } else {
          setSetupStatus(mode === 'cartesia' ? 'Cartesia ready' : `${modeButton.textContent} saved`, 'ready');
        }
      } catch (_) {
        setSetupStatus('Save failed', 'error');
      }
    });
  });

  if (cartesiaSaveBtn && cartesiaKeyInput) {
    cartesiaSaveBtn.addEventListener('click', async () => {
      try {
        setSetupStatus('Saving key', 'neutral');
        await runtime.saveCartesiaApiKey(cartesiaKeyInput.value);
        cartesiaKeyInput.value = '';
        setSetupStatus('Cartesia ready', 'ready');
      } catch (error) {
        setSetupStatus(error && error.message ? error.message : 'Key save failed', 'error');
      }
    });
  }

  if (cartesiaTestBtn) {
    cartesiaTestBtn.addEventListener('click', async () => {
      try {
        setSetupStatus('Testing', 'neutral');
        const response = await runtime.fetchImpl('/api/voice/provider-latency-probe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'cartesia', grants: { stt: true, tts: true }, expires_in: 30 }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error((payload.detail && payload.detail.setup_blocker) || 'Cartesia test failed');
        }
        setSetupStatus('Token test ok', 'ready');
      } catch (error) {
        setSetupStatus(error && error.message ? error.message : 'Test failed', 'error');
      }
    });
  }

  button.addEventListener('click', async () => {
    if (hardHoldTriggered) {
      hardHoldTriggered = false;
      return;
    }
    try {
      await runtime.toggle();
    } catch (_) {}
  });

  function canHardInterrupt() {
    return Boolean(runtime.status && runtime.status.active && runtime.status.state !== 'cancelled');
  }

  function clearHardHold() {
    if (hardHoldTimer) {
      clearTimeout(hardHoldTimer);
      hardHoldTimer = null;
    }
    hardHoldPointerId = null;
    button.classList.remove('oracle-voice-holding');
    delete button.dataset.oracleHold;
  }

  function armHardHold(event) {
    if (!canHardInterrupt() || (typeof event.button === 'number' && event.button > 0)) return;
    hardHoldTriggered = false;
    hardHoldPointerId = event.pointerId;
    button.classList.add('oracle-voice-holding');
    button.dataset.oracleHold = 'armed';
    if (typeof button.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
    }
    hardHoldTimer = window.setTimeout(async () => {
      hardHoldTimer = null;
      hardHoldTriggered = true;
      button.classList.remove('oracle-voice-holding');
      button.dataset.oracleHold = 'fired';
      try {
        await runtime.hardCancel('user_hold_cancel');
      } catch (_) {}
    }, ORACLE_HARD_HOLD_MS);
  }

  button.addEventListener('pointerdown', armHardHold);
  button.addEventListener('pointerup', clearHardHold);
  button.addEventListener('pointercancel', clearHardHold);
  button.addEventListener('pointerleave', (event) => {
    if (hardHoldPointerId === event.pointerId) clearHardHold();
  });
  button.addEventListener('contextmenu', (event) => {
    if (canHardInterrupt()) event.preventDefault();
  });
  button.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || !event.shiftKey || !canHardInterrupt()) return;
    event.preventDefault();
    clearHardHold();
    hardHoldTriggered = true;
    try {
      await runtime.hardCancel('user_hold_cancel');
    } catch (_) {}
  });

  function render(event) {
    const detail = event.detail || {};
    const status = detail.status || {};
    const state = status.state || 'idle';
    const available = Boolean(status.available);
    const active = Boolean(status.active);
    const microphoneState = status.microphoneState || 'idle';
    const icon = button.querySelector('.oracle-voice-icon');
    const statusText = button.querySelector('.oracle-voice-status');
    const micUnavailable = microphoneState === 'denied' || microphoneState === 'unavailable' || microphoneState === 'error';
    const configLoading = !available && status.configState !== 'error' && !detail.error;
    const presentationKey = micUnavailable ? 'microphone' : (configLoading ? 'initializing' : (!available ? 'unavailable' : state));
    const presentation = ORACLE_STATE_PRESENTATION[presentationKey] || ORACLE_STATE_PRESENTATION.idle;
    const presence = resolveVoicePresence(status, detail);
    const route = resolveVoiceRoute(status, detail);
    const actionLabel = active ? `${presentation.activeAction} Hold for Hard Interrupt.` : presentation.inactiveAction;
    const accessibleLabel = `O.R.A.C.L.E. ${presentation.label}. ${route.label} voice route. ${actionLabel}`;

    button.classList.toggle('active', active);
    button.classList.toggle('oracle-voice-unavailable', !available && !configLoading);
    button.dataset.oracleState = configLoading ? 'initializing' : state;
    button.dataset.oracleStateLabel = presentation.label;
    button.dataset.oracleMicrophone = microphoneState;
    button.dataset.oraclePresence = presence.key;
    button.dataset.oracleRoute = route.key;

    if (icon) icon.innerHTML = presentation.icon;
    if (statusText) statusText.textContent = accessibleLabel;
    button.title = accessibleLabel;
    button.setAttribute('aria-label', accessibleLabel);
    if (presenceEl) {
      presenceEl.textContent = presence.label;
      presenceEl.dataset.oraclePresence = presence.key;
      presenceEl.title = presence.title || accessibleLabel;
    }
    if (routeEl) {
      routeEl.textContent = route.label;
      routeEl.dataset.oracleRoute = route.key;
      routeEl.title = route.title;
    }
    renderSetupControls(route);

    if (micSelect && (microphoneState === 'capturing' || status.microphone || status.active)) {
      refreshMicrophoneDevices().catch(() => {});
    }
  }

  runtime.addEventListener('oraclevoice:state', render);
  render({ detail: { status: runtime.status } });
  return { render, refreshMicrophoneDevices };
}

export default {
  mountVoiceOrb,
};
