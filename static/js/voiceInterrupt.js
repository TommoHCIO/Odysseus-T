import { clearAudioQueue, stopAudioPlayback } from './audioPlayback.js';

export function applyVoiceActions(actions = {}) {
  if (actions.stop_tts) {
    stopAudioPlayback();
  }
  if (actions.clear_audio_queue) {
    clearAudioQueue();
  }
}

export function optimisticSoftInterrupt() {
  applyVoiceActions({ stop_tts: true, clear_audio_queue: true });
}

export default {
  applyVoiceActions,
  optimisticSoftInterrupt,
};
