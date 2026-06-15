// Shared audio playback controls for O.R.A.C.L.E. interrupt handling.

import { stopCartesiaRealtimeTts } from './cartesiaRealtimeTts.js';

let oracleVoiceAudio = null;
let oracleVoiceAudioUrl = null;
let oracleVoiceResolve = null;
let oracleVoicePlaybackTimeout = null;

const DEFAULT_ORACLE_VOICE_PLAYBACK_TIMEOUT_MS = 60000;

function clearOracleVoicePlaybackTimeout() {
  if (oracleVoicePlaybackTimeout) {
    window.clearTimeout(oracleVoicePlaybackTimeout);
    oracleVoicePlaybackTimeout = null;
  }
}

function cleanupOracleVoiceAudio(audio, audioUrl) {
  clearOracleVoicePlaybackTimeout();
  if (oracleVoiceAudio === audio) {
    oracleVoiceAudio = null;
  }
  if (oracleVoiceAudioUrl === audioUrl) {
    oracleVoiceAudioUrl = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
  }
}

export function stopOracleVoiceSpeech() {
  const audio = oracleVoiceAudio;
  const audioUrl = oracleVoiceAudioUrl;
  const resolve = oracleVoiceResolve;
  clearOracleVoicePlaybackTimeout();
  oracleVoiceAudio = null;
  oracleVoiceAudioUrl = null;
  oracleVoiceResolve = null;

  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch (error) {
      console.warn('O.R.A.C.L.E. failed to stop voice speech:', error);
    }
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
  }
  if (resolve) resolve({ stopped: true });
}

export function playOracleVoiceSpeech(audioBlob, options = {}) {
  stopOracleVoiceSpeech();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  if (options.playbackRate) {
    audio.playbackRate = options.playbackRate;
  }
  oracleVoiceAudio = audio;
  oracleVoiceAudioUrl = audioUrl;

  return new Promise((resolve, reject) => {
    oracleVoiceResolve = resolve;
    audio.onended = () => {
      oracleVoiceResolve = null;
      cleanupOracleVoiceAudio(audio, audioUrl);
      resolve({ ended: true });
    };
    audio.onerror = () => {
      oracleVoiceResolve = null;
      cleanupOracleVoiceAudio(audio, audioUrl);
      reject(new Error('O.R.A.C.L.E. voice audio playback failed'));
    };
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_ORACLE_VOICE_PLAYBACK_TIMEOUT_MS;
    oracleVoicePlaybackTimeout = window.setTimeout(() => {
      oracleVoiceResolve = null;
      cleanupOracleVoiceAudio(audio, audioUrl);
      reject(new Error('O.R.A.C.L.E. voice audio playback timed out'));
    }, timeoutMs);
    audio.play().catch((error) => {
      oracleVoiceResolve = null;
      cleanupOracleVoiceAudio(audio, audioUrl);
      reject(error);
    });
  });
}

export function stopAudioPlayback() {
  stopCartesiaRealtimeTts();
  stopOracleVoiceSpeech();

  try {
    if (window.aiTTSManager && typeof window.aiTTSManager.stop === 'function') {
      window.aiTTSManager.stop();
    }
  } catch (error) {
    console.warn('O.R.A.C.L.E. failed to stop AI TTS:', error);
  }

  try {
    if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
      window.speechSynthesis.cancel();
    }
  } catch (error) {
    console.warn('O.R.A.C.L.E. failed to cancel browser speech:', error);
  }
}

export function clearAudioQueue() {
  stopAudioPlayback();
}

export default {
  playOracleVoiceSpeech,
  stopOracleVoiceSpeech,
  stopAudioPlayback,
  clearAudioQueue,
};
