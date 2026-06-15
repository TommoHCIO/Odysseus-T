import { OracleVoiceRuntime } from './voiceRuntime.js';
import { mountVoiceOrb } from './voiceOrb.js';

export function initRealtimeVoice(options = {}) {
  const runtime = new OracleVoiceRuntime({
    getSessionId: options.getSessionId,
    onFinalTranscript: options.onFinalTranscript,
    showToast: options.showToast,
    showError: options.showError,
  });
  mountVoiceOrb(runtime, { showError: options.showError });
  runtime.init().catch(() => {});
  window.oracleVoiceRuntime = runtime;
  return runtime;
}

export default {
  initRealtimeVoice,
};
