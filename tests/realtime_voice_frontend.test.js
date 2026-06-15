const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

function readProjectFile(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

test("O.R.A.C.L.E. frontend runtime is wired into the app shell", () => {
  const appSource = readProjectFile("static", "app.js");
  const htmlSource = readProjectFile("static", "index.html");

  assert.match(appSource, /import\s+realtimeVoiceModule\s+from\s+'\.\/js\/realtimeVoice\.js'/);
  assert.match(appSource, /realtimeVoiceModule\.initRealtimeVoice\(/);
  assert.match(appSource, /getCurrentSessionId\(\)/);
  assert.match(appSource, /oracle-voice-btn/);
  assert.match(htmlSource, /id="oracle-voice-btn"/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-panel"/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-interrupt-btn"/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-cancel-btn"/);
});

test("O.R.A.C.L.E. runtime calls backend voice control-plane routes", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /\/api\/voice\/config/);
  assert.match(runtimeSource, /\/api\/voice\/session/);
  assert.match(runtimeSource, /\/api\/voice\/interrupt/);
  assert.match(runtimeSource, /\/api\/voice\/cancel/);
  assert.match(runtimeSource, /\/api\/voice\/status/);
  assert.match(runtimeSource, /voice_session_id/);
  assert.match(runtimeSource, /session_id:\s*sessionId\s*\|\|\s*null/);
  assert.match(runtimeSource, /supports_speech_to_chat/);
  assert.doesNotMatch(runtimeSource, /showToast\('O\.R\.A\.C\.L\.E\. listening'\)/);
  assert.doesNotMatch(runtimeSource, /showToast\('O\.R\.A\.C\.L\.E\. mic ready; speech chat is not connected yet'\)/);
  assert.doesNotMatch(runtimeSource, /showToast\('O\.R\.A\.C\.L\.E\. transcribing'\)/);
});

test("O.R.A.C.L.E. runtime publish keeps parent availability over child event status", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /const\s+\{\s*status:\s*_childStatus,\s*session:\s*_childSession,\s*config:\s*_childConfig,\s*\.\.\.safeExtra\s*\}\s*=\s*extra\s*\|\|\s*\{\}/);
  assert.match(runtimeSource, /\.\.\.safeExtra[\s\S]*status:\s*\{\s*\.\.\.this\.status\s*\}/);
  assert.match(runtimeSource, /this\.speechRecognition\.addEventListener\('oraclevoice:speech-recognition'[\s\S]*this\._publish\(event\.detail\s*\|\|\s*\{\}\)/);
});

test("O.R.A.C.L.E. falls back to server STT when browser speech recognition is unavailable", () => {
  const speechSource = readProjectFile("static", "js", "oracleSpeechRecognition.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(speechSource, /SPEECH_RECOGNITION_UNAVAILABLE_ERRORS\s*=\s*new Set\(\['network',\s*'service-not-allowed'\]\)/);
  assert.match(speechSource, /supported:\s*unavailable\s*\?\s*false\s*:\s*this\.status\.supported/);
  assert.match(speechSource, /speechRecognitionUnavailable:\s*unavailable/);
  assert.doesNotMatch(speechSource, /\['aborted',\s*'no-speech',\s*'network'\]/);
  assert.match(runtimeSource, /_isBrowserSpeechRecognitionUsable\(\)/);
  assert.match(runtimeSource, /_shouldPreferServerSpeechToChat\(\)/);
  assert.match(runtimeSource, /this\._shouldPreferServerSpeechToChat\(\)\s*\|\|\s*!\s*this\._isBrowserSpeechRecognitionUsable\(\)/);
  assert.match(runtimeSource, /status\.supported\s*&&\s*!\['error',\s*'unavailable',\s*'unsupported'\]\.includes\(status\.state\)/);
});

test("O.R.A.C.L.E. races browser speech with server STT for lower-latency voice turns", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /_shouldUseBrowserSpeechRecognition\(\)/);
  assert.match(runtimeSource, /const\s+speechStatus\s*=\s*this\._shouldUseBrowserSpeechRecognition\(\)[\s\S]*\?\s*this\.startSpeechRecognition\(\)[\s\S]*:\s*this\._bypassBrowserSpeechRecognition\(\)/);
  assert.match(runtimeSource, /bridge\.supports_speech_to_chat\s*===\s*true/);
  assert.match(runtimeSource, /this\.config\.supports_ws_audio_stream\s*===\s*true/);
  assert.match(runtimeSource, /this\._shouldPreferServerSpeechToChat\(\)\s*\|\|\s*!\s*this\._isBrowserSpeechRecognitionUsable\(\)/);
  assert.match(runtimeSource, /voiceSpeechTurnId/);
  assert.match(runtimeSource, /voiceSpeechTurnSubmitted/);
  assert.match(runtimeSource, /voiceTurnDuplicateTranscript/);
  assert.match(runtimeSource, /transcriptSource\.speechTurnId/);
  assert.doesNotMatch(runtimeSource, /!\s*this\._shouldPreferServerSpeechToChat\(\)[\s\S]{0,160}this\.startSpeechRecognition\(\)/);
});

test("Voice Orb exposes compact state presentation without transcript UI", () => {
  const orbSource = readProjectFile("static", "js", "voiceOrb.js");
  const cssSource = readProjectFile("static", "style.css");
  const htmlSource = readProjectFile("static", "index.html");

  assert.match(orbSource, /ORACLE_STATE_PRESENTATION/);
  for (const label of [
    "Ready",
    "Listening",
    "Transcribing",
    "Thinking",
    "Working",
    "Speaking",
    "Interrupted",
    "Cancelled",
    "Waking",
  ]) {
    assert.match(orbSource, new RegExp(`label:\\s*['"]${label}['"]`));
  }

  assert.match(orbSource, /aria-live/);
  assert.match(orbSource, /oracle-voice-status/);
  assert.match(orbSource, /ORACLE_PRESENCE_ID/);
  assert.match(orbSource, /ORACLE_ROUTE_ID/);
  assert.match(orbSource, /ORACLE_SETUP_ID/);
  assert.match(orbSource, /ORACLE_CARTESIA_KEY_ID/);
  assert.match(orbSource, /resolveVoicePresence\(status,\s*detail\)/);
  assert.match(orbSource, /resolveVoiceRoute\(status,\s*detail\)/);
  assert.match(orbSource, /voiceInputHealth/);
  assert.match(orbSource, /background_noise/);
  assert.match(orbSource, /oracle_playback_echo/);
  assert.match(orbSource, /voiceMode\.selected/);
  assert.match(orbSource, /selectedMode === 'cartesia'/);
  assert.match(orbSource, /selectedMode === 'local'/);
  assert.match(orbSource, /configLoading/);
  assert.match(orbSource, /configState/);
  assert.match(orbSource, /presenceEl\.textContent\s*=\s*presence\.label/);
  assert.match(orbSource, /routeEl\.textContent\s*=\s*route\.label/);
  assert.match(orbSource, /dataset\.oraclePresence/);
  assert.match(orbSource, /dataset\.oracleRoute/);
  assert.match(orbSource, /runtime\.setVoiceMode\(mode\)/);
  assert.match(orbSource, /runtime\.saveCartesiaApiKey\(cartesiaKeyInput\.value\)/);
  assert.match(orbSource, /\/api\/voice\/provider-latency-probe/);
  assert.match(orbSource, /oracleStateLabel/);
  assert.doesNotMatch(orbSource, /showError\('O\.R\.A\.C\.L\.E\. voice is unavailable\.'\)/);
  assert.match(htmlSource, /id="oracle-voice-presence"/);
  assert.match(htmlSource, /id="oracle-voice-route"/);
  assert.match(htmlSource, /id="oracle-voice-setup"/);
  assert.match(htmlSource, /data-oracle-mode-option="local"/);
  assert.match(htmlSource, /data-oracle-mode-option="hybrid"/);
  assert.match(htmlSource, /data-oracle-mode-option="cartesia"/);
  assert.match(htmlSource, /id="oracle-cartesia-key"/);
  assert.match(htmlSource, /id="oracle-cartesia-save"/);
  assert.match(htmlSource, /id="oracle-cartesia-test"/);
  assert.match(cssSource, /\.oracle-voice-presence/);
  assert.match(cssSource, /\.oracle-voice-route/);
  assert.match(cssSource, /\.oracle-voice-setup/);
  assert.match(cssSource, /\.oracle-mode-option/);
  assert.match(cssSource, /\.oracle-credential-input/);
  assert.match(cssSource, /data-oracle-presence="listening"/);
  assert.match(cssSource, /data-oracle-presence="speaking"/);
  assert.match(cssSource, /data-oracle-presence="background_noise"/);
  assert.match(cssSource, /data-oracle-presence="oracle_playback_echo"/);
  assert.match(cssSource, /data-oracle-route="realtime"/);
  assert.match(cssSource, /data-oracle-route="cartesia"/);
  assert.match(cssSource, /data-oracle-route="hybrid"/);
  assert.match(cssSource, /data-oracle-route="local"/);
  assert.match(cssSource, /data-oracle-route="setup"/);
  assert.match(cssSource, /\[data-oracle-state="transcribing"\]/);
  assert.match(cssSource, /\[data-oracle-state="thinking"\]/);
  assert.match(cssSource, /\[data-oracle-state="speaking"\]/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-panel"/);
  assert.doesNotMatch(htmlSource, /oracle-voice-transcript/);
});

test("Voice Orb supports deliberate press-and-hold hard interrupt", () => {
  const orbSource = readProjectFile("static", "js", "voiceOrb.js");
  const cssSource = readProjectFile("static", "style.css");
  const htmlSource = readProjectFile("static", "index.html");

  assert.match(orbSource, /ORACLE_HARD_HOLD_MS/);
  assert.match(orbSource, /pointerdown/);
  assert.match(orbSource, /pointerup/);
  assert.match(orbSource, /pointercancel/);
  assert.match(orbSource, /runtime\.hardCancel\('user_hold_cancel'\)/);
  assert.match(orbSource, /runtime\.toggle\(\)/);
  assert.match(orbSource, /oracle-voice-holding/);
  assert.match(orbSource, /oracleHold/);
  assert.match(orbSource, /aria-keyshortcuts/);
  assert.match(orbSource, /Hold for Hard Interrupt/);

  assert.match(cssSource, /oracle-hold-fill/);
  assert.match(cssSource, /data-oracle-hold="armed"/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-cancel-btn"/);
});

test("soft interrupt applies local TTS and audio queue stop actions", () => {
  const interruptSource = readProjectFile("static", "js", "voiceInterrupt.js");
  const audioSource = readProjectFile("static", "js", "audioPlayback.js");

  assert.match(interruptSource, /actions\.stop_tts/);
  assert.match(interruptSource, /actions\.clear_audio_queue/);
  assert.match(interruptSource, /optimisticSoftInterrupt/);
  assert.match(audioSource, /stopOracleVoiceSpeech\(\)/);
  assert.match(audioSource, /window\.aiTTSManager\.stop\(\)/);
  assert.match(audioSource, /window\.speechSynthesis\.cancel\(\)/);
});

test("O.R.A.C.L.E. runtime can play Voice Session speech output", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const audioSource = readProjectFile("static", "js", "audioPlayback.js");

  assert.match(runtimeSource, /async\s+speak\(text,\s*options\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /\/api\/voice\/speak/);
  assert.match(runtimeSource, /voice_session_id:\s*this\.session\.voice_session_id/);
  assert.match(runtimeSource, /session_id:\s*this\.session\.session_id\s*\|\|\s*this\.getSessionId\(\)\s*\|\|\s*null/);
  assert.match(runtimeSource, /response\.blob\(\)/);
  assert.match(runtimeSource, /ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS\s*=\s*60000/);
  assert.match(runtimeSource, /playOracleVoiceSpeech\(audioBlob,\s*\{\s*timeoutMs:\s*ORACLE_SERVER_TTS_PLAYBACK_TIMEOUT_MS\s*\}/);
  assert.match(runtimeSource, /serverTtsPlaybackError/);
  assert.match(runtimeSource, /speechState:\s*'speaking'/);
  assert.match(runtimeSource, /O\.R\.A\.C\.L\.E\. speaking/);

  assert.match(audioSource, /export function playOracleVoiceSpeech/);
  assert.match(audioSource, /new Audio\(audioUrl\)/);
  assert.match(audioSource, /DEFAULT_ORACLE_VOICE_PLAYBACK_TIMEOUT_MS\s*=\s*60000/);
  assert.match(audioSource, /O\.R\.A\.C\.L\.E\. voice audio playback timed out/);
  assert.match(audioSource, /URL\.revokeObjectURL/);
});

test("O.R.A.C.L.E. voice UX prioritizes fast presence and droppable narration", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const chatSource = readProjectFile("static", "js", "chat.js");
  const appSource = readProjectFile("static", "app.js");

  assert.match(runtimeSource, /ORACLE_SPEECH_LANES/);
  assert.match(runtimeSource, /_normalizeSpeechOptions\(options\)/);
  assert.match(runtimeSource, /_shouldUseFastBrowserTts\(speechText,\s*speechOptions\)/);
  assert.match(runtimeSource, /dropIfSpeaking/);
  assert.match(runtimeSource, /speechPlaybackDropped:\s*true/);
  assert.match(runtimeSource, /voiceSpeechGeneration/);
  assert.match(runtimeSource, /staleSpeechPlayback:\s*true/);
  assert.match(runtimeSource, /this\.speak\(data\.text,\s*\{\s*lane:\s*'narration',\s*mode:\s*'fast',\s*interrupt:\s*false,\s*dropIfSpeaking:\s*true,\s*toast:\s*false\s*\}\)/);
  assert.match(appSource, /runtime\.speak\('Got it\.',\s*\{\s*lane:\s*'presence',\s*mode:\s*'fast',\s*interrupt:\s*true,\s*toast:\s*false\s*\}\)/);
  assert.match(chatSource, /runtime\.speak\(spoken,\s*\{\s*lane:\s*'answer',\s*mode:\s*'fast',\s*interrupt:\s*true,\s*toast:\s*false\s*\}\)/);
});

test("O.R.A.C.L.E. runtime can fall back to browser TTS when server speech is unavailable", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /_canUseBrowserTtsFallback\(\)/);
  assert.match(runtimeSource, /_playBrowserTts\(speechText,\s*\{\s*stopExisting:\s*speechOptions\.interrupt\s*\}\)/);
  assert.match(runtimeSource, /new\s+SpeechSynthesisUtterance\(text\)/);
  assert.match(runtimeSource, /ORACLE_BROWSER_TTS_TIMEOUT_MS\s*=\s*45000/);
  assert.match(runtimeSource, /serverTtsPlaybackError/);
  assert.match(runtimeSource, /speechSynthesis\.cancel\(\)/);
  assert.match(runtimeSource, /speechSynthesis\.resume\(\)/);
  assert.match(runtimeSource, /Browser TTS timed out/);
  assert.match(runtimeSource, /utterance\.onstart\s*=\s*\(\)\s*=>\s*this\._publish\(\{\s*speechPlaybackState:\s*'browser'\s*\}\)/);
  assert.match(runtimeSource, /speechSynthesis\.speak\(utterance\)/);
  assert.match(runtimeSource, /speechPlaybackState:\s*'browser'/);
  assert.match(runtimeSource, /O\.R\.A\.C\.L\.E\. speaking/);
});

test("O.R.A.C.L.E. can use Cartesia realtime TTS before server fallback", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const cartesiaSource = readProjectFile("static", "js", "cartesiaRealtimeTts.js");
  const audioSource = readProjectFile("static", "js", "audioPlayback.js");
  const swSource = readProjectFile("static", "sw.js");
  const presenceBrowserIndex = runtimeSource.indexOf("if (this._shouldUseBrowserTtsBeforeCartesia(speechOptions))");
  const fastBrowserIndex = runtimeSource.indexOf("if (this._shouldUseFastBrowserTts(speechText, speechOptions))");
  const cartesiaIndex = runtimeSource.indexOf("if (this._canUseCartesiaRealtimeTts())");

  assert.match(runtimeSource, /import\s+\{\s*CartesiaRealtimeTtsClient\s*\}\s+from\s+'\.\/cartesiaRealtimeTts\.js'/);
  assert.match(runtimeSource, /this\.cartesiaRealtimeTts\s*=\s*options\.cartesiaRealtimeTts\s*\|\|\s*new CartesiaRealtimeTtsClient/);
  assert.match(runtimeSource, /_canUseCartesiaRealtimeTts\(\)/);
  assert.match(runtimeSource, /_isCartesiaVoiceMode\(\)/);
  assert.match(runtimeSource, /_shouldUseBrowserTtsBeforeCartesia\(speechOptions\)/);
  assert.match(runtimeSource, /return\s+speechOptions\.lane\s*===\s*'presence'[\s\S]*speechOptions\.mode\s*===\s*'fast'[\s\S]*this\._canUseBrowserTtsFallback\(\)/);
  assert.match(runtimeSource, /_canUseCartesiaRealtimeTts\(\)\s*\{[\s\S]*this\._isCartesiaVoiceMode\(\)/);
  assert.match(runtimeSource, /_canUseServerTts\(\)\s*\{[\s\S]*this\._isHybridVoiceMode\(\)/);
  assert.match(runtimeSource, /speechPlaybackState:\s*'cartesia_realtime'/);
  assert.match(runtimeSource, /speechPlaybackState:\s*this\._isCartesiaVoiceMode\(\)\s*\?\s*'cartesia_failed'\s*:\s*'server_fallback'/);
  assert.match(runtimeSource, /cartesiaRealtimeTts\.speak\(speechText/);
  assert.match(runtimeSource, /cartesiaRealtimeTtsError/);
  assert.match(runtimeSource, /if\s*\(this\._isCartesiaVoiceMode\(\)\)\s*\{\s*return false;\s*\}/);
  assert.ok(presenceBrowserIndex > -1, "presence browser TTS branch must exist");
  assert.ok(fastBrowserIndex > -1, "fast browser TTS branch must exist");
  assert.ok(cartesiaIndex > -1, "Cartesia TTS branch must exist");
  assert.ok(presenceBrowserIndex < cartesiaIndex, "presence acknowledgements may use browser TTS before Cartesia");
  assert.ok(cartesiaIndex < fastBrowserIndex, "Cartesia answer speech must not be bypassed by generic fast browser TTS");
  assert.ok(runtimeSource.indexOf("_canUseCartesiaRealtimeTts()") < runtimeSource.indexOf("!this._canUseServerTts() && this._canUseBrowserTtsFallback()"));

  assert.match(cartesiaSource, /\/api\/voice\/provider-token/);
  assert.match(cartesiaSource, /CARTESIA_TTS_PROXY_PATH\s*=\s*'\/api\/voice\/cartesia-tts\/ws'/);
  assert.match(cartesiaSource, /buildProxyWebSocketUrl\(\)/);
  assert.match(cartesiaSource, /cartesia_tts_proxy/);
  assert.match(cartesiaSource, /const\s+useProxy\s*=\s*this\._shouldUseProxy\(\)/);
  assert.match(cartesiaSource, /useProxy\s*\?\s*this\.buildProxyWebSocketUrl\(\)\s*:\s*this\.buildWebSocketUrl\(this\.tokenPayload\)/);
  assert.match(cartesiaSource, /grants:\s*\{\s*tts:\s*true\s*\}/);
  assert.match(cartesiaSource, /wss:\/\/api\.cartesia\.ai\/tts\/websocket/);
  assert.match(cartesiaSource, /CARTESIA_TTS_VOICE_ID\s*=\s*'65209f8e-6140-4a20-b819-3cc2e21da19b'/);
  assert.match(cartesiaSource, /searchParams\.set\('cartesia_version'/);
  assert.match(cartesiaSource, /searchParams\.set\('access_token'/);
  assert.match(cartesiaSource, /model_id:\s*CARTESIA_TTS_MODEL/);
  assert.match(cartesiaSource, /voice:\s*\{\s*mode:\s*'id',\s*id:\s*CARTESIA_TTS_VOICE_ID,\s*\}/);
  assert.match(cartesiaSource, /context_id:\s*makeContextId\(\)/);
  assert.match(cartesiaSource, /encoding:\s*'pcm_f32le'/);
  assert.match(cartesiaSource, /type\s*===\s*'chunk'/);
  assert.match(cartesiaSource, /base64ToUint8Array\(message\.data\)/);
  assert.match(cartesiaSource, /PcmF32PlaybackQueue/);
  assert.match(cartesiaSource, /this\.playbackChain\s*=\s*Promise\.resolve\(\)/);
  assert.match(cartesiaSource, /playChunk\(bytes\)\s*\{[\s\S]*this\.playbackChain\s*=\s*this\.playbackChain\.then\(\(\)\s*=>\s*this\._playChunkNow\(bytes\)\)/);
  assert.match(cartesiaSource, /async\s+waitForEnd\(\)\s*\{[\s\S]*await\s+this\.playbackChain/);
  assert.match(cartesiaSource, /_ensureSocket\(\)/);
  assert.match(cartesiaSource, /_isSocketOpen\(\)/);
  assert.match(cartesiaSource, /_isSocketConnecting\(\)/);
  assert.match(cartesiaSource, /this\._isSocketOpen\(\)[\s\S]*return this\.ws/);
  assert.match(cartesiaSource, /this\._isSocketConnecting\(\)[\s\S]*return this\.ws/);
  assert.match(cartesiaSource, /cancelActiveRequest/);
  assert.match(cartesiaSource, /cancel:\s*true/);
  assert.match(cartesiaSource, /_messageBelongsToActiveRequest\(message\)/);
  assert.match(cartesiaSource, /request\.context_id\s*=\s*contextId/);
  assert.doesNotMatch(cartesiaSource, /message\.type === 'done'[\s\S]{0,460}ws\.close\(\)/);

  assert.match(audioSource, /stopCartesiaRealtimeTts\(\)/);
  assert.match(swSource, /cartesiaRealtimeTts\.js/);
  assert.match(swSource, /odysseus-v399/);
});

test("O.R.A.C.L.E. can use Cartesia realtime STT before browser or server speech fallback", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const cartesiaSource = readProjectFile("static", "js", "cartesiaRealtimeStt.js");
  const swSource = readProjectFile("static", "sw.js");

  assert.match(runtimeSource, /import\s+\{\s*CartesiaRealtimeSttClient\s*\}\s+from\s+'\.\/cartesiaRealtimeStt\.js'/);
  assert.match(runtimeSource, /this\.cartesiaRealtimeStt\s*=\s*options\.cartesiaRealtimeStt\s*\|\|\s*new CartesiaRealtimeSttClient/);
  assert.match(runtimeSource, /_shouldUseCartesiaRealtimeStt\(\)/);
  assert.match(runtimeSource, /_shouldUseCartesiaRealtimeStt\(\)\s*\{[\s\S]*this\._isCartesiaVoiceMode\(\)/);
  assert.match(runtimeSource, /_shouldUseVoiceWebSocket\(\)\s*\{[\s\S]*this\._isHybridVoiceMode\(\)/);
  assert.match(runtimeSource, /startCartesiaRealtimeSttStream\(options\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /finalizeCartesiaRealtimeSttStream\(speechEndReason\)/);
  assert.match(runtimeSource, /stopCartesiaRealtimeSttStream\('cancelled'\)/);
  assert.match(runtimeSource, /handleFinalTranscript\(finalText,\s*transcriptSource\)/);
  assert.match(runtimeSource, /_voiceTranscriptSource\('voice\.cartesia_stt'/);
  assert.match(runtimeSource, /cartesiaRealtimeSttState/);
  assert.match(runtimeSource, /cartesiaRealtimeSttLatency:\s*null/);
  assert.match(runtimeSource, /cartesiaRealtimeSttLatency/);
  assert.match(runtimeSource, /_isCartesiaRealtimeSttFinalizing\(\)/);
  assert.match(runtimeSource, /_isCartesiaRealtimeSttFinalizingError\(error\)/);
  assert.match(runtimeSource, /still finalizing the previous turn/i);
  assert.match(runtimeSource, /cartesiaRealtimeSttRewarmDeferred:\s*true/);
  assert.match(runtimeSource, /_scheduleCartesiaRealtimeSttRewarm\(250\)/);
  assert.match(runtimeSource, /_setCartesiaRealtimeSttState\('transcribing',\s*\{\s*setupBlocker:\s*null,\s*rewarmDeferred:\s*true\s*\}\)/);
  assert.match(runtimeSource, /socket_ready_ms/);
  assert.match(runtimeSource, /finalize_to_final_ms/);
  assert.match(runtimeSource, /turn_to_final_ms/);
  assert.ok(runtimeSource.indexOf("const useCartesiaRealtimeStt = this._shouldUseCartesiaRealtimeStt()") < runtimeSource.indexOf("const useVoiceWebSocket = this._shouldUseVoiceWebSocket()"));
  assert.match(runtimeSource, /!this\._shouldUseCartesiaRealtimeStt\(\)[\s\S]*this\.config\.supports_ws_audio_stream/);
  assert.match(runtimeSource, /!this\._shouldUseCartesiaRealtimeStt\(\)[\s\S]*typeof this\.speechRecognition\.start === 'function'/);

  assert.match(cartesiaSource, /\/api\/voice\/cartesia-stt\/ws/);
  assert.match(cartesiaSource, /buildProxyWebSocketUrl\(sampleRate/);
  assert.match(cartesiaSource, /cartesia_stt_proxy/);
  assert.match(cartesiaSource, /const\s+useProxy\s*=\s*this\._shouldUseProxy\(\)/);
  assert.match(cartesiaSource, /useProxy\s*\?\s*this\.buildProxyWebSocketUrl/);
  assert.match(cartesiaSource, /:\s*this\.buildWebSocketUrl\(tokenPayload/);
  assert.match(cartesiaSource, /\/api\/voice\/provider-token/);
  assert.match(cartesiaSource, /grants:\s*\{\s*stt:\s*true\s*\}/);
  assert.match(cartesiaSource, /wss:\/\/api\.cartesia\.ai\/stt\/websocket/);
  assert.match(cartesiaSource, /CARTESIA_STT_MODEL\s*=\s*'ink-2'/);
  assert.match(cartesiaSource, /CARTESIA_STT_ENCODING\s*=\s*'pcm_f32le'/);
  assert.match(cartesiaSource, /searchParams\.set\('model'/);
  assert.match(cartesiaSource, /searchParams\.set\('encoding'/);
  assert.match(cartesiaSource, /searchParams\.set\('sample_rate'/);
  assert.match(cartesiaSource, /searchParams\.set\('cartesia_version'/);
  assert.match(cartesiaSource, /searchParams\.set\('access_token'/);
  assert.match(cartesiaSource, /createMediaStreamSource\(stream\)/);
  assert.match(cartesiaSource, /createScriptProcessor\(4096,\s*1,\s*1\)/);
  assert.doesNotMatch(cartesiaSource, /async start\(stream,\s*handlers\s*=\s*\{\}\)[\s\S]{0,220}this\.stop\(\)/);
  assert.match(cartesiaSource, /_ensureSocket\(\)/);
  assert.match(cartesiaSource, /_isSocketOpen\(\)/);
  assert.match(cartesiaSource, /_isSocketConnecting\(\)/);
  assert.match(cartesiaSource, /this\._isSocketOpen\(\)[\s\S]*return this\.ws/);
  assert.match(cartesiaSource, /this\._isSocketConnecting\(\)[\s\S]*return this\.ws/);
  assert.match(cartesiaSource, /const socket = this\.ws/);
  assert.match(cartesiaSource, /this\.ws !== socket/);
  assert.match(cartesiaSource, /this\.ws\.send\(value\)/);
  assert.match(cartesiaSource, /'finalize'/);
  assert.match(cartesiaSource, /message\.type !== 'transcript'/);
  assert.match(cartesiaSource, /message\.is_final === true/);
  assert.match(cartesiaSource, /message\.type === 'flush_done'/);
  assert.match(cartesiaSource, /this\._emitState\(this\._isSocketOpen\(\) \? 'ready' : 'idle',\s*finalDiagnostics\)/);
  assert.match(cartesiaSource, /performance\.now\(\)/);
  assert.match(cartesiaSource, /_latencyDiagnostics\(extra\s*=\s*\{\}\)/);
  assert.match(cartesiaSource, /activeTransport\s*=\s*useProxy\s*\?\s*'proxy'\s*:\s*'direct'/);
  assert.match(cartesiaSource, /socket_ready_ms/);
  assert.match(cartesiaSource, /turn_to_socket_ready_ms/);
  assert.match(cartesiaSource, /finalize_to_final_ms/);
  assert.match(cartesiaSource, /turn_to_final_ms/);
  assert.match(cartesiaSource, /handlers\.onState\(state,\s*diagnostics\)/);
  assert.match(runtimeSource, /cartesiaRealtimeStt\.start\(this\.micCapture\.stream,[\s\S]*config:\s*this\.config/);
  assert.match(runtimeSource, /startCartesiaRealtimeSttStream\(\{\s*warm:\s*true\s*\}\)/);
  assert.match(runtimeSource, /cartesiaRealtimeSttWarmTurnStarted:\s*true/);
  assert.match(runtimeSource, /_scheduleCartesiaRealtimeSttRewarm\(\)/);
  assert.match(runtimeSource, /_scheduleCartesiaRealtimeSttRewarm\(delayMs\s*=\s*0\)/);
  assert.match(runtimeSource, /Math\.max\(0,\s*Number\(delayMs\)\s*\|\|\s*0\)/);
  assert.match(runtimeSource, /this\.cartesiaRealtimeStt\.stop\(\)/);

  assert.match(swSource, /cartesiaRealtimeStt\.js/);
  assert.match(swSource, /odysseus-v399/);
});

test("O.R.A.C.L.E. filters voice transcript noise and autocorrects before chat submission", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /ORACLE_NOISE_TRANSCRIPT_PATTERNS/);
  assert.match(runtimeSource, /_prepareVoiceTranscriptForChat\(transcript,\s*transcriptSource\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /_looksLikeBackgroundNoiseTranscript\(normalized\)/);
  assert.match(runtimeSource, /_collapseRepeatedVoiceWords\(normalized\)/);
  assert.match(runtimeSource, /_autocorrectVoiceTranscript\(collapsed\)/);
  assert.match(runtimeSource, /transcriptRejected:\s*true/);
  assert.match(runtimeSource, /transcriptRejectReason/);
  assert.match(runtimeSource, /transcriptAutocorrected/);
  assert.match(runtimeSource, /lastTranscriptFilter:\s*null/);
  assert.match(runtimeSource, /voiceInputHealth:\s*null/);
  assert.match(runtimeSource, /voiceInputRejectCount:\s*0/);
  assert.match(runtimeSource, /_voiceInputHealthForFilter/);
  assert.match(runtimeSource, /heardText:\s*normalized\.slice\(0,\s*80\)/);
  assert.match(runtimeSource, /_setLastTranscriptFilter\(prepared\.filter\)/);
  assert.match(runtimeSource, /onFinalTranscript\(prepared\.text/);
  assert.doesNotMatch(runtimeSource, /onFinalTranscript\(text,/);
  assert.match(runtimeSource, /thank\\s\+you\\s\+for\\s\+watching/);
  assert.match(runtimeSource, /like\\s\+and\\s\+subscribe/);
  assert.match(runtimeSource, /got\\s\+it/);
  assert.match(runtimeSource, /on\\s\+average/);
  assert.match(runtimeSource, /i\\s\+started\\s\+with/);
  assert.match(runtimeSource, /_looksLikeDanglingVoiceFragment\(text\)/);
  assert.match(runtimeSource, /ORACLE_SHORT_VOICE_INTENT_PATTERNS/);
  assert.match(runtimeSource, /ORACLE_DIRECTED_VOICE_PATTERNS/);
  assert.match(runtimeSource, /_looksLikeShortUncommandedFragment\(text\)/);
  assert.match(runtimeSource, /_looksLikeUnaddressedMediaTranscript\(text\)/);
  assert.match(runtimeSource, /oracle_playback_echo/);
  assert.match(runtimeSource, /duplicate_voice_transcript/);
  assert.match(runtimeSource, /oracleEchoGuardIgnored:\s*true/);
  assert.match(runtimeSource, /oracleEchoGuardDiscarded:\s*true/);
  assert.match(runtimeSource, /oracleEchoGuardIgnoringSpeech/);
  assert.match(runtimeSource, /oraclePlaybackInputMuted\s*=\s*false/);
  assert.match(runtimeSource, /_muteVoiceInputForPlayback\(\)/);
  assert.match(runtimeSource, /_resumeVoiceInputAfterPlayback\(\)/);
  assert.match(runtimeSource, /stopSpeechRecognition\('muted'\)/);
  assert.match(runtimeSource, /stopCartesiaRealtimeSttStream\('muted'\)/);
  assert.match(runtimeSource, /oraclePlaybackInputMuted:\s*true/);
  assert.match(runtimeSource, /oraclePlaybackInputMuted:\s*false/);
  assert.match(runtimeSource, /oracole/);
  assert.match(runtimeSource, /cartesh\?a/);
});

test("O.R.A.C.L.E. treats Cartesia token failures as setup-blocked fallback states", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const sttSource = readProjectFile("static", "js", "cartesiaRealtimeStt.js");
  const ttsSource = readProjectFile("static", "js", "cartesiaRealtimeTts.js");
  const orbSource = readProjectFile("static", "js", "voiceOrb.js");

  assert.match(sttSource, /async function providerTokenError\(response,\s*fallbackMessage/);
  assert.match(sttSource, /error\.setupBlocker\s*=\s*setupBlocker/);
  assert.match(sttSource, /error\.recoverable\s*=\s*true/);
  assert.match(sttSource, /Cartesia STT token failed/);
  assert.match(sttSource, /function cartesiaSttSocketError\(message,\s*event\s*=\s*null\)/);
  assert.match(sttSource, /error\.setupBlocker\s*=\s*'cartesia_stt_socket_failed'/);
  assert.match(sttSource, /error\.recoverable\s*=\s*true/);
  assert.match(sttSource, /CARTESIA_STT_CONNECT_TIMEOUT_MS\s*=\s*4000/);
  assert.match(sttSource, /_startConnectTimer\(\)/);
  assert.match(sttSource, /Cartesia realtime STT socket timed out/);
  assert.match(sttSource, /socket\.onerror\s*=\s*\(event\)\s*=>\s*\{/);
  assert.match(sttSource, /if \(this\.ws !== socket\) return;[\s\S]*Cartesia realtime STT socket failed/);
  assert.match(ttsSource, /async function providerTokenError\(response,\s*fallbackMessage/);
  assert.match(ttsSource, /error\.setupBlocker\s*=\s*setupBlocker/);
  assert.match(ttsSource, /error\.recoverable\s*=\s*true/);

  assert.match(runtimeSource, /cartesiaRealtimeBlocked:\s*false/);
  assert.match(runtimeSource, /cartesiaRealtimeSetupBlocker:\s*null/);
  assert.match(runtimeSource, /_isRecoverableCartesiaError\(error\)/);
  assert.match(runtimeSource, /Cartesia realtime \(STT\|TTS\) socket/);
  assert.match(runtimeSource, /cartesia_stt_socket_failed/);
  assert.match(runtimeSource, /_isCartesiaRealtimeSttFinalizingError\(error\)[\s\S]*return;/);
  assert.match(runtimeSource, /_markCartesiaRealtimeBlocked\(error,\s*'stt'\)/);
  assert.match(runtimeSource, /startSpeechRecognition\(\)/);
  assert.match(runtimeSource, /cartesiaRealtimeProviderBlocked:\s*true/);
  assert.doesNotMatch(runtimeSource, /showError\(`O\.R\.A\.C\.L\.E\. Cartesia STT failed/);

  assert.match(orbSource, /cartesiaRealtimeProviderBlocked/);
  assert.match(orbSource, /cartesiaRuntimeBlocker/);
  assert.match(orbSource, /Cartesia token setup failed/);
});

test("O.R.A.C.L.E. runtime consumes execution narration previews safely", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /async\s+narrate\(eventType,\s*message\s*=\s*''/);
  assert.match(runtimeSource, /supports_execution_narration_preview/);
  assert.match(runtimeSource, /\/api\/voice\/narration/);
  assert.match(runtimeSource, /voice_session_id:\s*this\.session\.voice_session_id/);
  assert.match(runtimeSource, /event_type:\s*narrationEvent/);
  assert.match(runtimeSource, /narrationState:\s*'checking'/);
  assert.match(runtimeSource, /narrationState:\s*'suppressed'/);
  assert.match(runtimeSource, /if\s*\(data\.should_speak\)/);
  assert.match(runtimeSource, /options\.speak\s*===\s*true/);
  assert.match(runtimeSource, /await\s+this\.speak\(data\.text,\s*\{\s*lane:\s*'narration',\s*mode:\s*'fast',\s*interrupt:\s*false,\s*dropIfSpeaking:\s*true,\s*toast:\s*false\s*\}\)/);
});

test("O.R.A.C.L.E. runtime accepts browser narration request events", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /oraclevoice:narration-request/);
  assert.match(runtimeSource, /window\.addEventListener\('oraclevoice:narration-request'/);
  assert.match(runtimeSource, /_handleNarrationRequest\(event\)/);
  assert.match(runtimeSource, /event\.detail/);
  assert.match(runtimeSource, /detail\.eventType\s*\|\|\s*detail\.event_type/);
  assert.match(runtimeSource, /detail\.message/);
  assert.match(runtimeSource, /const\s+speak\s*=\s*detail\.speak\s*===\s*true/);
  assert.match(runtimeSource, /detail\.requireActive\s*===\s*true/);
  assert.match(runtimeSource, /!this\.status\.active/);
  assert.match(runtimeSource, /this\.narrate\(eventType,\s*message,\s*\{\s*speak\s*\}\)/);
  assert.doesNotMatch(runtimeSource, /oracle-voice-transcript/);
});

test("chat streams request O.R.A.C.L.E. narration without leaking raw output", () => {
  const chatSource = readProjectFile("static", "js", "chat.js");

  assert.match(chatSource, /function\s+_requestOracleNarration\(eventType,\s*message/);
  assert.match(chatSource, /window\.oracleVoiceRuntime/);
  assert.match(chatSource, /status\.active/);
  assert.match(chatSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(chatSource, /source:\s*'chat_stream'/);
  assert.match(chatSource, /requireActive:\s*true/);
  assert.match(chatSource, /eventType:\s*eventType/);
  assert.match(chatSource, /message:\s*message/);
  assert.match(chatSource, /_requestOracleNarration\('chat\.stream\.started'/);
  assert.match(chatSource, /_requestOracleNarration\('chat\.stream\.completed'/);
  assert.doesNotMatch(chatSource, /oraclevoice:narration-request'[\s\S]{0,240}accumulated/);
  assert.doesNotMatch(chatSource, /oraclevoice:narration-request'[\s\S]{0,240}roundText/);
});

test("agent tool events request O.R.A.C.L.E. narration without leaking tool payloads", () => {
  const chatSource = readProjectFile("static", "js", "chat.js");

  assert.match(chatSource, /function\s+_oracleToolLabel\(tool\)/);
  assert.match(chatSource, /replace\(\s*\/\[\^a-zA-Z0-9 _\.-\]\+/);
  assert.match(chatSource, /slice\(0,\s*40\)/);
  assert.match(chatSource, /json\.type\s*===\s*'tool_start'/);
  assert.match(chatSource, /json\.type\s*===\s*'tool_output'/);
  assert.match(chatSource, /_requestOracleNarration\('tool\.started'/);
  assert.match(chatSource, /_requestOracleNarration\(ok\s*\?\s*'tool\.completed'\s*:\s*'tool\.failed'/);
  assert.match(chatSource, /_oracleToolLabel\(json\.tool\)/);
  assert.match(chatSource, /requireActive:\s*true/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('tool\.[\s\S]{0,320}json\.output/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('tool\.[\s\S]{0,320}json\.command/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('tool\.[\s\S]{0,320}json\.tail/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('tool\.[\s\S]{0,320}json\.params/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('tool\.[\s\S]{0,320}json\.arguments/);
});

test("research events request O.R.A.C.L.E. narration without leaking research payloads", () => {
  const chatSource = readProjectFile("static", "js", "chat.js");

  assert.match(chatSource, /const\s+ORACLE_RESEARCH_PHASE_LABELS\s*=/);
  assert.match(chatSource, /function\s+_requestOracleResearchProgress\(data,\s*streamSessionId\)/);
  assert.match(chatSource, /_requestOracleNarration\('research\.progress'/);
  assert.match(chatSource, /_requestOracleNarration\('research\.sources\.ready'/);
  assert.match(chatSource, /_requestOracleNarration\('research\.findings\.ready'/);
  assert.match(chatSource, /_requestOracleNarration\('research\.completed'/);
  assert.match(chatSource, /json\.type\s*===\s*'research_progress'/);
  assert.match(chatSource, /json\.type\s*===\s*'research_sources'/);
  assert.match(chatSource, /json\.type\s*===\s*'research_findings'/);
  assert.match(chatSource, /json\.type\s*===\s*'research_done'/);
  assert.match(chatSource, /requireActive:\s*true/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}holder\._researchQuery/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}rp\.query/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}rp\.title/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}json\.data/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}_findingsData/);
  assert.doesNotMatch(chatSource, /_requestOracleNarration\('research\.[\s\S]{0,360}_sourcesData/);
});

test("Council workflow events request O.R.A.C.L.E. narration without leaking deliberation payloads", () => {
  const groupSource = readProjectFile("static", "js", "group.js");

  assert.match(groupSource, /const\s+ORACLE_COUNCIL_PHASE_LABELS\s*=/);
  assert.match(groupSource, /function\s+_requestOracleCouncilNarration\(eventType,\s*phaseKey/);
  assert.match(groupSource, /window\.oracleVoiceRuntime/);
  assert.match(groupSource, /status\.active/);
  assert.match(groupSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(groupSource, /source:\s*'council_workflow'/);
  assert.match(groupSource, /requireActive:\s*true/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.workflow\.started'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.phase\.started',\s*'position'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.phase\.started',\s*'evidence'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.phase\.started',\s*'convergence'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.phase\.started',\s*'consensus'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.phase\.started',\s*'synthesis'/);
  assert.match(groupSource, /_requestOracleCouncilNarration\('council\.workflow\.completed'/);
  assert.doesNotMatch(groupSource, /oraclevoice:narration-request'[\s\S]{0,420}originalTask/);
  assert.doesNotMatch(groupSource, /oraclevoice:narration-request'[\s\S]{0,420}transcript/);
  assert.doesNotMatch(groupSource, /oraclevoice:narration-request'[\s\S]{0,420}response/);
  assert.doesNotMatch(groupSource, /oraclevoice:narration-request'[\s\S]{0,420}json\.output/);
});

test("skill test events request O.R.A.C.L.E. narration without leaking test payloads", () => {
  const skillsSource = readProjectFile("static", "js", "skills.js");

  assert.match(skillsSource, /const\s+ORACLE_SKILL_TEST_MESSAGES\s*=/);
  assert.match(skillsSource, /function\s+_requestOracleSkillTestNarration\(eventType,\s*messageKey/);
  assert.match(skillsSource, /window\.oracleVoiceRuntime/);
  assert.match(skillsSource, /status\.active/);
  assert.match(skillsSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(skillsSource, /source:\s*'skill_test'/);
  assert.match(skillsSource, /requireActive:\s*true/);
  assert.match(skillsSource, /_requestOracleSkillTestNarration\('skill\.test\.started',\s*'started'/);
  assert.match(skillsSource, /_requestOracleSkillTestNarration\('skill\.test\.progress',\s*'progress'/);
  assert.match(skillsSource, /_requestOracleSkillTestNarration\('skill\.test\.evaluating',\s*'evaluating'/);
  assert.match(skillsSource, /_requestOracleSkillTestNarration\('skill\.test\.completed',\s*'completed'/);
  assert.match(skillsSource, /_requestOracleSkillTestNarration\('skill\.test\.failed',\s*'failed'/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}ev\./);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}job\./);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}name/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}task/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}model/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}tool/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}command/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}output/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}text/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}error/);
  assert.doesNotMatch(skillsSource, /_requestOracleSkillTestNarration\('skill\.[\s\S]{0,320}verdict/);
});

test("code runner events request O.R.A.C.L.E. narration without leaking code or output", () => {
  const codeRunnerSource = readProjectFile("static", "js", "codeRunner.js");

  assert.match(codeRunnerSource, /const\s+ORACLE_CODE_RUN_MESSAGES\s*=/);
  assert.match(codeRunnerSource, /function\s+_requestOracleCodeRunNarration\(eventType,\s*messageKey/);
  assert.match(codeRunnerSource, /window\.oracleVoiceRuntime/);
  assert.match(codeRunnerSource, /status\.active/);
  assert.match(codeRunnerSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(codeRunnerSource, /source:\s*'code_run'/);
  assert.match(codeRunnerSource, /requireActive:\s*true/);
  assert.match(codeRunnerSource, /_requestOracleCodeRunNarration\('code\.run\.started',\s*'started'/);
  assert.match(codeRunnerSource, /_requestOracleCodeRunNarration\('code\.run\.completed',\s*'completed'/);
  assert.match(codeRunnerSource, /_requestOracleCodeRunNarration\('code\.run\.failed',\s*'failed'/);
  assert.doesNotMatch(codeRunnerSource, /_requestOracleCodeRunNarration\('code\.[^\n]*(code|lang|command|stdout|stderr|output|result|data|error)/);
});

test("workspace preview events request O.R.A.C.L.E. narration without leaking preview internals", () => {
  const workspaceSource = readProjectFile("static", "js", "workspace.js");

  assert.match(workspaceSource, /const\s+ORACLE_WORKSPACE_PREVIEW_MESSAGES\s*=/);
  assert.match(workspaceSource, /function\s+_requestOracleWorkspacePreviewNarration\(eventType,\s*messageKey/);
  assert.match(workspaceSource, /window\.oracleVoiceRuntime/);
  assert.match(workspaceSource, /status\.active/);
  assert.match(workspaceSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(workspaceSource, /source:\s*'workspace_preview'/);
  assert.match(workspaceSource, /requireActive:\s*true/);
  assert.match(workspaceSource, /_requestOracleWorkspacePreviewNarration\('workspace\.preview\.started',\s*'started'/);
  assert.match(workspaceSource, /_requestOracleWorkspacePreviewNarration\('workspace\.preview\.ready',\s*'ready'/);
  assert.match(workspaceSource, /_requestOracleWorkspacePreviewNarration\('workspace\.preview\.failed',\s*'failed'/);
  assert.match(workspaceSource, /_requestOracleWorkspacePreviewNarration\('workspace\.preview\.stopped',\s*'stopped'/);
  assert.doesNotMatch(workspaceSource, /_requestOracleWorkspacePreviewNarration\('workspace\.[^\n]*(kind|id|item|title|body|build|command|url|log|error|data|result|response)/);
});

test("compare run events request O.R.A.C.L.E. narration without leaking comparison payloads", () => {
  const compareSource = readProjectFile("static", "js", "compare", "index.js");

  assert.match(compareSource, /const\s+ORACLE_COMPARE_RUN_MESSAGES\s*=/);
  assert.match(compareSource, /function\s+_requestOracleCompareRunNarration\(eventType,\s*messageKey/);
  assert.match(compareSource, /window\.oracleVoiceRuntime/);
  assert.match(compareSource, /status\.active/);
  assert.match(compareSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(compareSource, /source:\s*'compare_run'/);
  assert.match(compareSource, /requireActive:\s*true/);
  assert.match(compareSource, /_requestOracleCompareRunNarration\('compare\.run\.started',\s*'started'/);
  assert.match(compareSource, /_requestOracleCompareRunNarration\('compare\.run\.completed',\s*'completed'/);
  assert.match(compareSource, /_requestOracleCompareRunNarration\('compare\.run\.failed',\s*'failed'/);
  assert.match(compareSource, /_requestOracleCompareRunNarration\('compare\.run\.stopped',\s*'stopped'/);
  assert.doesNotMatch(compareSource, /_requestOracleCompareRunNarration\('compare\.[^\n]*(message|prompt|model|candidate|answer|result|search|source|url|metric|vote|session|error|data)/);
});

test("scheduled task events request O.R.A.C.L.E. narration without leaking task payloads", () => {
  const tasksSource = readProjectFile("static", "js", "tasks.js");

  assert.match(tasksSource, /const\s+ORACLE_TASK_RUN_MESSAGES\s*=/);
  assert.match(tasksSource, /function\s+_requestOracleTaskRunNarration\(eventType,\s*messageKey/);
  assert.match(tasksSource, /window\.oracleVoiceRuntime/);
  assert.match(tasksSource, /status\.active/);
  assert.match(tasksSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(tasksSource, /source:\s*'scheduled_task'/);
  assert.match(tasksSource, /requireActive:\s*true/);
  assert.match(tasksSource, /_requestOracleTaskRunNarration\('task\.run\.started',\s*'started'/);
  assert.match(tasksSource, /_requestOracleTaskRunNarration\('task\.run\.completed',\s*'completed'/);
  assert.match(tasksSource, /_requestOracleTaskRunNarration\('task\.run\.failed',\s*'failed'/);
  assert.match(tasksSource, /_requestOracleTaskRunNarration\('task\.run\.stopped',\s*'stopped'/);
  assert.doesNotMatch(tasksSource, /_requestOracleTaskRunNarration\('task\.[^\n]*(name|prompt|body|action|model|result|output|error|id|notification|entry|data|taskName)/);
});

test("Cookbook job events request O.R.A.C.L.E. narration without leaking model job payloads", () => {
  const cookbookSource = readProjectFile("static", "js", "cookbookRunning.js");

  assert.match(cookbookSource, /const\s+ORACLE_COOKBOOK_JOB_MESSAGES\s*=/);
  assert.match(cookbookSource, /function\s+_requestOracleCookbookJobNarration\(eventType,\s*messageKey/);
  assert.match(cookbookSource, /window\.oracleVoiceRuntime/);
  assert.match(cookbookSource, /status\.active/);
  assert.match(cookbookSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(cookbookSource, /source:\s*'cookbook_job'/);
  assert.match(cookbookSource, /requireActive:\s*true/);
  assert.match(cookbookSource, /_requestOracleCookbookJobNarration\('cookbook\.job\.started',\s*'started'/);
  assert.match(cookbookSource, /_requestOracleCookbookJobNarration\('cookbook\.job\.completed',\s*'completed'/);
  assert.match(cookbookSource, /_requestOracleCookbookJobNarration\('cookbook\.job\.failed',\s*'failed'/);
  assert.match(cookbookSource, /_requestOracleCookbookJobNarration\('cookbook\.job\.stopped',\s*'stopped'/);
  assert.doesNotMatch(cookbookSource, /_requestOracleCookbookJobNarration\('cookbook\.[^\n]*(name|repo|model|cmd|command|host|port|endpoint|url|output|tail|error|session|id|task|payload|data|status|progress)/);
});

test("MCP Marketplace events request O.R.A.C.L.E. narration without leaking integration payloads", () => {
  const adminSource = readProjectFile("static", "js", "admin.js");

  assert.match(adminSource, /const\s+ORACLE_MCP_MARKETPLACE_MESSAGES\s*=/);
  assert.match(adminSource, /function\s+_requestOracleMcpMarketplaceNarration\(eventType,\s*messageKey/);
  assert.match(adminSource, /window\.oracleVoiceRuntime/);
  assert.match(adminSource, /status\.active/);
  assert.match(adminSource, /new CustomEvent\('oraclevoice:narration-request'/);
  assert.match(adminSource, /source:\s*'mcp_marketplace'/);
  assert.match(adminSource, /requireActive:\s*true/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.install\.started',\s*'started'/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.install\.completed',\s*'completed'/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.install\.failed',\s*'failed'/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.action\.started',\s*'started'/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.action\.completed',\s*'completed'/);
  assert.match(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.marketplace\.action\.failed',\s*'failed'/);
  assert.doesNotMatch(adminSource, /_requestOracleMcpMarketplaceNarration\('mcp\.[^\n]*(entry|server|name|id|config|field|value|tool|schema|log|error|package|url|data|response|payload)/);
});

test("service worker precaches O.R.A.C.L.E. frontend modules", () => {
  const swSource = readProjectFile("static", "sw.js");

  for (const file of [
    "audioPlayback.js",
    "cartesiaRealtimeStt.js",
    "cartesiaRealtimeTts.js",
    "voiceMicCapture.js",
    "oracleSpeechRecognition.js",
    "voiceInterrupt.js",
    "voiceRuntime.js",
    "voiceOrb.js",
    "realtimeVoice.js",
  ]) {
    assert.match(swSource, new RegExp(`/static/js/${file}`));
  }
  assert.match(swSource, /\/static\/js\/cookbookRunning\.js/);
  assert.match(swSource, /\/static\/js\/admin\.js/);
  assert.match(swSource, /odysseus-v399/);
});

test("full sidebar suppresses the compact icon rail", () => {
  const cssSource = readProjectFile("static", "style.css");

  assert.match(cssSource, /body:has\(#sidebar:not\(\.hidden\)\) #icon-rail:not\(\.mobile-mini\)/);
  assert.match(cssSource, /body:has\(#sidebar:not\(\.hidden\)\) #icon-rail:not\(\.mobile-mini\)\s*\{[^}]*display:\s*none\s*!important/s);
});

test("O.R.A.C.L.E. microphone capture uses browser media APIs with safe cleanup", () => {
  const captureSource = readProjectFile("static", "js", "voiceMicCapture.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /import\s+\{\s*OracleMicCapture\s*\}\s+from\s+'\.\/voiceMicCapture\.js'/);
  assert.match(runtimeSource, /startMicrophone\(\)/);
  assert.match(runtimeSource, /stopMicrophone\('cancelled'\)/);
  assert.match(captureSource, /navigatorRef\.mediaDevices\.getUserMedia/);
  assert.match(captureSource, /new MediaRecorderClass\(stream,\s*recorderOptions\)/);
  assert.match(captureSource, /recorder\.start\(this\.timesliceMs\)/);
  assert.match(captureSource, /track\.stop\(\)/);
  assert.match(captureSource, /NotAllowedError/);
  assert.match(captureSource, /isSecureContext/);
  assert.match(captureSource, /async\s+restartSegment\(\)/);
  assert.match(captureSource, /currentRecorder\.ondataavailable\s*=\s*\(\)\s*=>\s*\{\}/);
  assert.match(captureSource, /currentRecorder\.onstop\s*=\s*\(\)\s*=>\s*resolve\(\)/);
  assert.match(captureSource, /async\s+flushCurrentData\(\)/);
  assert.match(captureSource, /recorder\.requestData\(\)/);
});

test("O.R.A.C.L.E. microphone capture publishes local voice activity", () => {
  const vadSource = readProjectFile("static", "js", "voiceActivityDetection.js");
  const captureSource = readProjectFile("static", "js", "voiceMicCapture.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const swSource = readProjectFile("static", "sw.js");

  assert.match(vadSource, /class\s+OracleVoiceActivityDetector\s+extends\s+EventTarget/);
  assert.match(vadSource, /createMediaStreamSource\(stream\)/);
  assert.match(vadSource, /speechThreshold/);
  assert.match(vadSource, /DEFAULT_SPEECH_THRESHOLD\s*=\s*0\.016/);
  assert.match(vadSource, /silenceThreshold/);
  assert.match(vadSource, /DEFAULT_SILENCE_THRESHOLD\s*=\s*0\.011/);
  assert.match(vadSource, /noiseWarmupMs/);
  assert.match(vadSource, /DEFAULT_SPEECH_START_MS\s*=\s*80/);
  assert.match(vadSource, /DEFAULT_NOISE_WARMUP_MS\s*=\s*160/);
  assert.match(vadSource, /noiseFloor/);
  assert.match(vadSource, /adaptiveSpeechThreshold/);
  assert.match(vadSource, /adaptiveSilenceThreshold/);
  assert.match(vadSource, /speechNoiseMargin/);
  assert.match(vadSource, /silenceNoiseMargin/);
  assert.match(vadSource, /speechContinuationRatio/);
  assert.match(vadSource, /_speechContinuationThreshold/);
  assert.match(vadSource, /activeSpeechThreshold/);
  assert.match(vadSource, /isSpeechLevel\s*=\s*!warmingUp\s*&&\s*level\s*>=\s*activeSpeechThreshold/);
  assert.match(vadSource, /isSilenceLevel\s*=\s*level\s*<=\s*adaptiveSilenceThreshold/);
  assert.match(vadSource, /DEFAULT_MAX_SPEECH_MS\s*=\s*12000/);
  assert.match(vadSource, /speechStartedAt/);
  assert.match(vadSource, /nonSpeechMs/);
  assert.match(vadSource, /Date\.now\(\)/);
  assert.match(vadSource, /currentTime\s*-\s*this\.status\.speechStartedAt/);
  assert.match(vadSource, /postSpeechQuietMs\s*>=\s*this\.speechEndMs/);
  assert.match(vadSource, /speechElapsedMs\s*>=\s*this\.maxSpeechMs/);
  assert.match(vadSource, /speechEndReason/);
  assert.match(vadSource, /max_speech_ms/);
  assert.match(vadSource, /trailing_silence/);
  assert.match(vadSource, /speech_start/);
  assert.match(vadSource, /speech_end/);
  assert.match(vadSource, /oraclevoice:activity/);
  assert.match(vadSource, /audioContext\.resume\(\)\.catch\(\(\)\s*=>\s*\{\}\)/);

  assert.match(captureSource, /import\s+\{\s*OracleVoiceActivityDetector\s*\}\s+from\s+'\.\/voiceActivityDetection\.js'/);
  assert.match(captureSource, /voiceActivityDetector\.start\(stream\)/);
  assert.match(captureSource, /voiceActivityDetector\.stop\(state\)/);
  assert.match(captureSource, /voiceActivityState/);

  assert.match(runtimeSource, /speech_start/);
  assert.match(runtimeSource, /vad_speech_start/);
  assert.match(runtimeSource, /softInterrupt\('vad_speech_start'\)/);
  assert.match(swSource, /\/static\/js\/voiceActivityDetection\.js/);
});

test("O.R.A.C.L.E. can transcribe VAD-bounded audio through server STT fallback", () => {
  const captureSource = readProjectFile("static", "js", "voiceMicCapture.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(captureSource, /consumeBufferedAudio\(\)/);
  assert.match(captureSource, /new Blob\(this\.chunks\.map\(chunk => chunk\.blob\)/);
  assert.match(runtimeSource, /supports_server_stt_final_utterance/);
  assert.match(runtimeSource, /serverSttInFlight/);
  assert.match(runtimeSource, /voiceActivityEvent\s*!==\s*'speech_end'/);
  assert.match(runtimeSource, /!\s*this\._shouldPreferServerSpeechToChat\(\)[\s\S]*this\.speechRecognition\.status\.supported/);
  assert.match(runtimeSource, /\/api\/stt\/transcribe/);
  assert.match(runtimeSource, /formData\.append\('file', audioBlob, 'oracle-utterance\.webm'\)/);
  assert.match(runtimeSource, /handleFinalTranscript\(text,\s*this\._voiceTranscriptSource\('voice\.server_stt_final'/);
  assert.match(runtimeSource, /this\._publish\(\{\s*serverTranscriptionState:\s*'transcribing'\s*\}\)/);
});

test("O.R.A.C.L.E. preserves provenance for browser and server final transcripts", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /_voiceTranscriptSource\(source,\s*extra\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /source:\s*source/);
  assert.match(runtimeSource, /voiceSessionId:\s*this\.session\s*\?\s*this\.session\.voice_session_id\s*:\s*null/);
  assert.match(runtimeSource, /sessionId:\s*this\.session\s*&&\s*this\.session\.session_id\s*\?\s*this\.session\.session_id\s*:\s*this\.getSessionId\(\)\s*\|\|\s*null/);
  assert.match(runtimeSource, /submitToChat:\s*true/);
  assert.match(runtimeSource, /onFinalTranscript:\s*\(transcript\)\s*=>\s*this\.handleFinalTranscript\(transcript,\s*this\._voiceTranscriptSource\('voice\.browser_speech'\)\)/);
  assert.match(runtimeSource, /handleFinalTranscript\(text,\s*this\._voiceTranscriptSource\('voice\.server_stt_final'/);
  assert.match(runtimeSource, /mimeType:\s*audioBlob\.type\s*\|\|\s*'audio\/webm'/);
  assert.match(runtimeSource, /transcriptSource,\s*\.\.\.extra/);
  assert.match(runtimeSource, /transcriptSource,\s*\}/);
});

test("O.R.A.C.L.E. streams VAD-bounded audio over the voice websocket when available", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /supports_ws_audio_stream/);
  assert.match(runtimeSource, /new WebSocket\(`\$\{WS_BASE\}\/api\/voice\/ws`\)/);
  assert.match(runtimeSource, /voice\.audio\.start/);
  assert.match(runtimeSource, /voice\.audio\.chunk/);
  assert.match(runtimeSource, /voice\.audio\.end/);
  assert.match(runtimeSource, /flushCurrentData\(\)/);
  assert.match(runtimeSource, /end_reason/);
  assert.match(runtimeSource, /speechEndReason/);
  assert.match(runtimeSource, /max_speech_ms/);
  assert.match(runtimeSource, /ORACLE_MAX_AUDIO_STREAM_MS\s*=\s*12000/);
  assert.match(runtimeSource, /voiceAudioStreamMaxTimer/);
  assert.match(runtimeSource, /setTimeout\(\(\)\s*=>\s*this\.endVoiceAudioStream\(ORACLE_MAX_SPEECH_END_REASON\)/);
  assert.match(runtimeSource, /voice\.transcript\.final/);
  assert.match(runtimeSource, /arrayBufferToBase64/);
  assert.match(runtimeSource, /handleFinalTranscript\(data\.text/);
  assert.match(runtimeSource, /_prepareSpeechAudioSegment\(\)/);
  assert.match(runtimeSource, /restartSegment\(\)/);
});

test("O.R.A.C.L.E. does not run server STT fallback when websocket audio is available", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /_shouldUseServerSpeechAudio\(\)\s*\{[\s\S]*!this\._shouldUseVoiceWebSocket\(\)/);
  assert.match(runtimeSource, /async\s+transcribeBufferedAudioWithServerStt\(\)\s*\{[\s\S]*this\._shouldUseVoiceWebSocket\(\)[\s\S]*return false/);
  assert.match(runtimeSource, /if\s*\(this\._shouldUseVoiceWebSocket\(\)\)\s*\{[\s\S]*this\.endVoiceAudioStream\(speechEndReason\)\.catch\(\(\)\s*=>\s*\{\}\);[\s\S]*return;/);
});

test("O.R.A.C.L.E. gates websocket final transcripts with server submit intent and source metadata", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /_handleVoiceSocketFinalTranscript\(data\)/);
  assert.match(runtimeSource, /data\.submit_to_chat\s*!==\s*true/);
  assert.match(runtimeSource, /handleFinalTranscript\(data\.text,\s*transcriptSource\)/);
  assert.match(runtimeSource, /source:\s*'voice\.websocket'/);
  assert.match(runtimeSource, /voiceSessionId:\s*data\.voice_session_id/);
  assert.match(runtimeSource, /sessionId:\s*data\.session_id/);
  assert.match(runtimeSource, /mimeType:\s*data\.mime_type/);
  assert.match(runtimeSource, /submitToChat:\s*data\.submit_to_chat\s*===\s*true/);
  assert.match(runtimeSource, /serverTranscriptionState:\s*'ready'/);
  assert.doesNotMatch(runtimeSource, /handleFinalTranscript\(data\.partialTranscript/);
});

test("O.R.A.C.L.E. treats empty websocket transcripts as a completed non-submit result", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /voice\.transcript\.empty/);
  assert.match(runtimeSource, /_handleVoiceSocketEmptyTranscript\(data\)/);
  assert.match(runtimeSource, /source:\s*'voice\.websocket'/);
  assert.match(runtimeSource, /transcriptEmpty:\s*true/);
  assert.match(runtimeSource, /transcriptSubmitted:\s*false/);
  assert.match(runtimeSource, /serverTranscriptionState:\s*'ready'/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\('idle'\)/);
  assert.doesNotMatch(runtimeSource, /handleFinalTranscript\(data\.text,\s*transcriptSource\)[\s\S]{0,200}transcriptEmpty/);
});

test("O.R.A.C.L.E. stores final transcript source in runtime status without transcript UI", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const htmlSource = readProjectFile("static", "index.html");
  const sourceStatusUpdates = runtimeSource.match(/_setLastTranscriptSource\(transcriptSource\);/g) || [];

  assert.match(runtimeSource, /lastTranscriptSource:\s*null/);
  assert.match(runtimeSource, /_setLastTranscriptSource\(transcriptSource\)/);
  assert.match(runtimeSource, /lastTranscriptSource:\s*transcriptSource/);
  assert.ok(sourceStatusUpdates.length >= 2);
  assert.doesNotMatch(runtimeSource, /lastTranscriptText/);
  assert.doesNotMatch(htmlSource, /oracle-voice-transcript/);
});

test("O.R.A.C.L.E. stores redacted STT diagnostics in runtime status without transcript text", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const htmlSource = readProjectFile("static", "index.html");

  assert.match(runtimeSource, /lastTranscriptDiagnostics:\s*null/);
  assert.match(runtimeSource, /_sanitizeTranscriptDiagnostics\(data\.diagnostics\)/);
  assert.match(runtimeSource, /_setLastTranscriptDiagnostics\(diagnostics\)/);
  assert.match(runtimeSource, /lastTranscriptDiagnostics:\s*diagnostics/);
  assert.match(runtimeSource, /bytes_received/);
  assert.match(runtimeSource, /decode_attempt/);
  assert.match(runtimeSource, /decode_ms/);
  assert.match(runtimeSource, /quality_gate/);
  assert.match(runtimeSource, /avg_logprob/);
  assert.match(runtimeSource, /no_speech_prob/);
  assert.doesNotMatch(runtimeSource, /lastTranscriptText/);
  assert.doesNotMatch(runtimeSource, /lastTranscriptDiagnostics:\s*[^,\n]*(text|transcript)/);
  assert.doesNotMatch(htmlSource, /oracle-voice-transcript/);
});

test("O.R.A.C.L.E. physical microphone QA harness keeps the real microphone path", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /physical microphone/i);
  assert.match(harnessSource, /#oracle-voice-btn/);
  assert.match(harnessSource, /window\.oracleVoiceRuntime/);
  assert.match(harnessSource, /voice\.transcript\.final/);
  assert.match(harnessSource, /lastTranscriptDiagnostics/);
  assert.match(harnessSource, /voice\.websocket/);
  assert.match(harnessSource, /speechRecognition\.status\s*=\s*\{\s*\.\.\.runtime\.speechRecognition\.status,\s*supported:\s*false/s);
  assert.doesNotMatch(harnessSource, /navigator\.mediaDevices\.getUserMedia\s*=\s*(?!==)/);
  assert.doesNotMatch(harnessSource, /createMediaStreamDestination/);
  assert.doesNotMatch(harnessSource, /MediaStreamTrackGenerator/);
  assert.doesNotMatch(harnessSource, /createOscillator/);
  assert.doesNotMatch(harnessSource, /_handleVoiceActivityEvent/);
});

test("O.R.A.C.L.E. physical microphone QA harness prints compact summary by default", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_FULL_RESULT/);
  assert.match(harnessSource, /buildSummary\(value,\s*passed\s*=\s*true\)/);
  assert.match(harnessSource, /finalTranscripts/);
  assert.match(harnessSource, /partialTranscripts/);
  assert.match(harnessSource, /websocketSentCounts/);
  assert.match(harnessSource, /websocketReceivedCounts/);
  assert.match(harnessSource, /lastTranscriptDiagnostics/);
  assert.match(harnessSource, /PRINT_FULL_RESULT\s*\?\s*value\s*:\s*buildSummary\(value\)/);
  assert.match(harnessSource, /summary:\s*buildSummary\(value,\s*false\)/);
  assert.match(harnessSource, /process\.exit\(0\)/);
});

test("O.R.A.C.L.E. physical microphone QA harness summarizes latency evidence", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /latencyMs/);
  assert.match(harnessSource, /latencyTargetsMs/);
  assert.match(harnessSource, /latencyBudget/);
  assert.match(harnessSource, /firstSpeechStartToFirstPartial/);
  assert.match(harnessSource, /firstSpeechStartToFirstFinal/);
  assert.match(harnessSource, /firstAudioEndToFirstFinal/);
  assert.match(harnessSource, /firstSpeechStartToFirstAudioChunk/);
  assert.match(harnessSource, /withinTarget/);
  assert.match(harnessSource, /overBy/);
  assert.match(harnessSource, /missing/);
  assert.match(harnessSource, /targets_ms/);
  assert.match(harnessSource, /first_transcript/);
  assert.match(harnessSource, /durationBetween/);
});

test("O.R.A.C.L.E. physical microphone QA harness reports Cartesia STT latency and transcript filtering", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /cartesiaRealtimeSttLatency/);
  assert.match(harnessSource, /cartesiaRealtimeSttStates/);
  assert.match(harnessSource, /speechPlaybackStates/);
  assert.match(harnessSource, /lastTranscriptFilter/);
  assert.match(harnessSource, /transcriptFilters/);
  assert.match(harnessSource, /transcriptRejected/);
  assert.match(harnessSource, /transcriptAutocorrected/);
  assert.match(harnessSource, /selectedVoiceMode\(value\)/);
  assert.match(harnessSource, /expectedVoiceSource\(value\)/);
  assert.match(harnessSource, /voice\.cartesia_stt/);
  assert.match(harnessSource, /usesCartesiaSttPath\(value\)/);
  assert.match(harnessSource, /runtime status missing Cartesia realtime STT latency diagnostics/);
  assert.match(harnessSource, /cartesiaLatencyStatus/);
  assert.match(harnessSource, /voiceTranscriptFilter/);
  assert.match(harnessSource, /cartesiaRealtimeSttErrors/);
  assert.match(harnessSource, /websocketLifecycleCounts/);
});

test("O.R.A.C.L.E. physical microphone QA harness can require expected transcript text", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_EXPECTED_TEXT/);
  assert.match(harnessSource, /normalizeTranscriptText/);
  assert.match(harnessSource, /transcriptMatchesExpectedText/);
  assert.match(harnessSource, /expectedText/);
  assert.match(harnessSource, /expectedTranscriptMatch/);
  assert.match(harnessSource, /recentHeardTranscriptText/);
  assert.match(harnessSource, /expectedTextFailureMessage/);
  assert.match(harnessSource, /unexpectedChatMessages/);
  assert.match(harnessSource, /unexpected chat transcript\(s\) submitted/);
  assert.match(harnessSource, /expected transcript submitted/);
  assert.match(harnessSource, /Cartesia heard background\/no directed speech instead of expected text/);
  assert.match(harnessSource, /final Cartesia transcript did not match expected text/);
  assert.match(harnessSource, /chat submitted transcript did not match expected text/);
});

test("O.R.A.C.L.E. physical microphone QA harness reports input calibration", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_COUNTDOWN_MS/);
  assert.match(harnessSource, /showQaCue/);
  assert.match(harnessSource, /SPEAK NOW/);
  assert.match(harnessSource, /enumerateDevices\(\)/);
  assert.match(harnessSource, /audioinput/);
  assert.match(harnessSource, /activeAudioTracks/);
  assert.match(harnessSource, /inputCalibration/);
  assert.match(harnessSource, /maxVoiceActivityLevel/);
  assert.match(harnessSource, /minAdaptiveSpeechThreshold/);
  assert.match(harnessSource, /levelToThresholdRatio/);
  assert.match(harnessSource, /physical microphone input never reached speech start threshold/);
});

test("O.R.A.C.L.E. physical microphone QA harness can select a real input device", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_DEVICE_LABEL/);
  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_DEVICE_INDEX/);
  assert.match(harnessSource, /pickAudioInputDevice/);
  assert.match(harnessSource, /selectedMicrophoneDevice/);
  assert.match(harnessSource, /runtime\.micCapture\.setPreferredDevice\(selectedDevice\)/);
  assert.doesNotMatch(harnessSource, /originalGetUserMedia\.call/);
  assert.match(harnessSource, /requested microphone device was not found/);
});

test("O.R.A.C.L.E. microphone capture uses the preferred microphone device", () => {
  const captureSource = readProjectFile("static", "js", "voiceMicCapture.js");
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(captureSource, /ORACLE_MIC_DEVICE_ID_STORAGE_KEY/);
  assert.match(captureSource, /setPreferredDevice\(device/);
  assert.match(captureSource, /getPreferredDevice\(\)/);
  assert.match(captureSource, /deviceId:\s*\{\s*exact:\s*preferredDevice\.deviceId\s*\}/);
  assert.match(captureSource, /selectedDeviceLabel/);
  assert.match(harnessSource, /runtime\.micCapture\.setPreferredDevice\(selectedDevice/);
  assert.doesNotMatch(harnessSource, /getUserMedia\s*=\s*\(constraints\s*=\s*\)\s*=>/);
});

test("O.R.A.C.L.E. exposes an in-app microphone selector", () => {
  const htmlSource = readProjectFile("static", "index.html");
  const orbSource = readProjectFile("static", "js", "voiceOrb.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const cssSource = readProjectFile("static", "style.css");

  assert.match(htmlSource, /id="oracle-mic-select"/);
  assert.match(htmlSource, /aria-label="O\.R\.A\.C\.L\.E\. microphone"/);
  assert.match(orbSource, /ORACLE_MIC_SELECT_ID/);
  assert.match(orbSource, /refreshMicrophoneDevices/);
  assert.match(orbSource, /runtime\.listMicrophoneDevices\(\)/);
  assert.match(orbSource, /runtime\.selectMicrophoneDevice\(selectedDevice\)/);
  assert.match(orbSource, /selectedDeviceLabel/);
  assert.match(runtimeSource, /async\s+listMicrophoneDevices\(\)/);
  assert.match(runtimeSource, /enumerateDevices\(\)/);
  assert.match(runtimeSource, /kind\s*===\s*'audioinput'/);
  assert.match(runtimeSource, /selectMicrophoneDevice\(device/);
  assert.match(runtimeSource, /setPreferredDevice\(device/);
  assert.match(cssSource, /\.oracle-mic-select/);
  assert.doesNotMatch(htmlSource, /id="oracle-voice-panel"/);
});

test("O.R.A.C.L.E. physical microphone QA harness can expect diagnostic non-submit results", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_EXPECT_NON_SUBMIT/);
  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_EXPECT_QUALITY_GATE/);
  assert.match(harnessSource, /expectedNonSubmit/);
  assert.match(harnessSource, /expected non-submit transcript was submitted to chat/);
  assert.match(harnessSource, /last transcript quality gate did not match expected gate/);
  assert.match(harnessSource, /chat_stream did not include expected voice provenance/);
  assert.match(harnessSource, /!EXPECT_NON_SUBMIT/);
});

test("O.R.A.C.L.E. physical microphone QA harness can keep browser speech enabled", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /ORACLE_PHYSICAL_MIC_ALLOW_BROWSER_SPEECH/);
  assert.match(harnessSource, /ALLOW_BROWSER_SPEECH/);
  assert.match(harnessSource, /browserFinalTranscripts/);
  assert.match(harnessSource, /voice\.browser_speech/);
  assert.match(harnessSource, /if\s*\(!allowBrowserSpeech\s*&&\s*runtime\.speechRecognition\)/);
  assert.match(harnessSource, /chat_stream did not include expected voice provenance/);
});

test("O.R.A.C.L.E. physical microphone QA harness only requires local diagnostics for local STT", () => {
  const harnessSource = readProjectFile("artifacts", "oracle_physical_mic_qa.js");

  assert.match(harnessSource, /expectsLocalSttDiagnostics/);
  assert.match(harnessSource, /sttProvider === 'local'/);
  assert.match(harnessSource, /expectsLocalSttDiagnostics && \(!finalDiagnostics/);
  assert.match(harnessSource, /expectsLocalSttDiagnostics && \(!statusDiagnostics/);
});

test("O.R.A.C.L.E. publishes voice websocket and audio stream state", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /voiceSocketState:\s*'idle'/);
  assert.match(runtimeSource, /voiceAudioStreamState:\s*'idle'/);
  assert.match(runtimeSource, /_setVoiceSocketState\(state,\s*extra\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\(state,\s*extra\s*=\s*\{\}\)/);
  assert.match(runtimeSource, /_setVoiceSocketState\('connecting'/);
  assert.match(runtimeSource, /_setVoiceSocketState\('connected'/);
  assert.match(runtimeSource, /_setVoiceSocketState\('closed'/);
  assert.match(runtimeSource, /_setVoiceSocketState\('error'/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\('streaming'/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\('transcribing'/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\('idle'/);
  assert.match(runtimeSource, /_setVoiceAudioStreamState\('error'/);
  assert.doesNotMatch(runtimeSource, /oracle-voice-transcript/);
});

test("O.R.A.C.L.E. handles provider partial transcript websocket events without submitting them", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /supports_partial_transcripts/);
  assert.match(runtimeSource, /voice\.transcript\.partial/);
  assert.match(runtimeSource, /partialTranscript/);
  assert.doesNotMatch(runtimeSource, /handleFinalTranscript\(data\.partialTranscript\)/);
});

test("O.R.A.C.L.E. wires browser speech recognition into chat submission", () => {
  const speechSource = readProjectFile("static", "js", "oracleSpeechRecognition.js");
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");
  const realtimeSource = readProjectFile("static", "js", "realtimeVoice.js");
  const appSource = readProjectFile("static", "app.js");
  const chatSource = readProjectFile("static", "js", "chat.js");

  assert.match(speechSource, /window\.SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
  assert.match(speechSource, /continuous\s*=\s*false/);
  assert.match(speechSource, /bounded utterance/i);
  assert.match(speechSource, /interimResults\s*=\s*true/);
  assert.match(speechSource, /onresult/);
  assert.match(speechSource, /DUPLICATE_FINAL_TRANSCRIPT_WINDOW_MS/);
  assert.match(speechSource, /_isDuplicateFinalTranscript\(finalText\)/);
  assert.match(speechSource, /duplicateFinalTranscript:\s*true/);
  assert.match(speechSource, /onFinalTranscript/);

  assert.match(runtimeSource, /import\s+\{\s*OracleSpeechRecognition\s*\}\s+from\s+'\.\/oracleSpeechRecognition\.js'/);
  assert.match(runtimeSource, /startSpeechRecognition\(\)/);
  assert.match(runtimeSource, /stopSpeechRecognition\('cancelled'\)/);
  assert.match(runtimeSource, /handleFinalTranscript\(transcript,\s*this\._voiceTranscriptSource\('voice\.browser_speech'\)\)/);
  assert.match(runtimeSource, /onFinalTranscript/);

  assert.match(realtimeSource, /onFinalTranscript:\s*options\.onFinalTranscript/);
  assert.match(appSource, /handleOracleFinalTranscript/);
  assert.match(appSource, /handleOracleFinalTranscript\(transcript,\s*context\s*=\s*\{\}\)/);
  assert.match(appSource, /window\.__odysseusNextVoiceTranscriptSource/);
  assert.match(appSource, /const\s+voiceSource\s*=\s*context\.transcriptSource/);
  assert.match(appSource, /source:\s*voiceSource\.source/);
  assert.match(appSource, /voiceSessionId:\s*voiceSource\.voiceSessionId/);
  assert.match(appSource, /sessionId:\s*voiceSource\.sessionId/);
  assert.match(appSource, /mimeType:\s*voiceSource\.mimeType/);
  assert.match(appSource, /submitToChat:\s*voiceSource\.submitToChat\s*===\s*true/);
  assert.doesNotMatch(appSource, /JSON\.stringify\(context\.transcriptSource/);
  assert.match(appSource, /button\[form="chat-form"\]\[type="submit"\], \.send-btn/);
  assert.match(appSource, /function\s+submitOracleVoiceTranscript\(submitBtn\)/);
  assert.match(appSource, /form\.requestSubmit\(submitBtn\)/);
  assert.match(appSource, /new\s+SubmitEvent\('submit'/);
  assert.doesNotMatch(appSource, /setTimeout\(\(\)\s*=>\s*submitBtn\.click\(\)/);
  assert.match(chatSource, /window\.__odysseusNextVoiceTranscriptSource/);
  assert.match(chatSource, /fd\.append\('voice_transcript_source'/);
  assert.match(chatSource, /delete\s+window\.__odysseusNextVoiceTranscriptSource/);
});

test("O.R.A.C.L.E. narrates voice-originated answer highlights instead of full structured responses", () => {
  const chatSource = readProjectFile("static", "js", "chat.js");
  const appSource = readProjectFile("static", "app.js");
  const voiceTurnDeclaration = chatSource.indexOf("const voiceTurnShouldSpeakResponse = _isOracleVoiceTranscriptSource(voiceTranscriptSource)");
  const streamStartedNarration = chatSource.indexOf("_requestOracleNarration('chat.stream.started'");

  assert.match(chatSource, /function\s+_isOracleVoiceTranscriptSource\(rawSource\)/);
  assert.match(chatSource, /source\.startsWith\('voice\.'\)/);
  assert.match(chatSource, /parsed\.submitToChat\s*===\s*true/);
  assert.match(chatSource, /const\s+voiceTurnShouldSpeakResponse\s*=\s*_isOracleVoiceTranscriptSource\(voiceTranscriptSource\)/);
  assert.ok(voiceTurnDeclaration > -1, 'voice turn response flag must be declared');
  assert.ok(streamStartedNarration > -1, 'chat stream narration request must exist');
  assert.ok(
    voiceTurnDeclaration < streamStartedNarration,
    'voice turn response flag must be declared before chat.stream.started narration uses it'
  );
  assert.match(appSource, /function\s+speakOracleVoicePresenceAck\(context\s*=\s*\{\}\)/);
  assert.match(appSource, /runtime\.speak\('Got it\.',\s*\{\s*lane:\s*'presence',\s*mode:\s*'fast',\s*interrupt:\s*true,\s*toast:\s*false\s*\}\)\.catch\(\(\)\s*=>\s*\{\}\)/);
  assert.match(appSource, /speakOracleVoicePresenceAck\(context\)/);
  assert.doesNotMatch(appSource, /speakOracleVoicePresenceAck[\s\S]{0,520}status\.state\s*===\s*'interrupted'/);
  assert.match(chatSource, /_requestOracleNarration\('chat\.stream\.started',\s*'I am working on your chat request\.',\s*\{\s*speak:\s*!\s*voiceTurnShouldSpeakResponse\s*\}\)/);
  assert.match(chatSource, /stripToolBlocks\(typeof rawText === 'string' \? rawText : ''\)/);
  assert.match(chatSource, /extractThinkingBlocks\(text\)/);
  assert.match(chatSource, /ORACLE_ANSWER_HIGHLIGHT_MAX_CHARS/);
  assert.match(chatSource, /ORACLE_ANSWER_SUMMARY_CUE/);
  assert.match(chatSource, /ORACLE_ANSWER_DEEMPHASIS_CUE/);
  assert.match(chatSource, /function\s+_oracleIsStructuredSpeakableLine\(line\)/);
  assert.match(chatSource, /function\s+_oracleAnswerSentenceScore\(sentence,\s*index\)/);
  assert.match(chatSource, /function\s+_oraclePickAnswerNarrationSentences\(sentences\)/);
  assert.match(chatSource, /function\s+_oracleBuildAnswerNarration\(rawText\)/);
  assert.match(chatSource, /function\s+_oracleSpeakAssistantHighlights\(rawText\)/);
  assert.match(chatSource, /summary\|result\|done\|ready\|fixed\|added\|changed\|important\|key\|main\|caveat\|warning\|blocked\|next/);
  assert.match(chatSource, /here is\|below is\|for example\|the code\|the command\|the file\|stack trace\|log output/);
  assert.match(chatSource, /```\[\\s\\S\]\*\?```/);
  assert.match(chatSource, /[├└│]/);
  assert.match(chatSource, /runtime\.speak\(spoken,\s*\{\s*lane:\s*'answer',\s*mode:\s*'fast',\s*interrupt:\s*true,\s*toast:\s*false\s*\}\)/);
  assert.match(chatSource, /const\s+streamingTTS\s*=\s*!!\([\s\S]*&&\s*!\s*voiceTurnShouldSpeakResponse[\s\S]*\)/);
  assert.match(chatSource, /if\s*\(\s*accumulated\s*&&\s*window\.aiTTSManager\s*&&\s*window\.aiTTSManager\.autoPlay\s*&&\s*!\s*voiceTurnShouldSpeakResponse\s*\)/);
  assert.match(chatSource, /voiceTurnShouldSpeakResponse\s*\?\s*_oracleSpeakAssistantHighlights\(accumulated\)/);
  assert.doesNotMatch(chatSource, /ORACLE_ANSWER_CLAUSE_MIN_CHARS/);
  assert.doesNotMatch(chatSource, /function\s+_createOracleAnswerClauseQueue\(\)/);
  assert.doesNotMatch(chatSource, /answerClauseQueue/);
  assert.doesNotMatch(chatSource, /function\s+_oracleSpeakAssistantResponse\(rawText\)/);
  assert.doesNotMatch(chatSource, /runtime\.speak\(clause/);
  assert.doesNotMatch(chatSource, /voiceTurnShouldSpeakResponse\s*&&\s*_oracleSpeakAssistantResponse\(accumulated\)/);
  assert.match(chatSource, /chat\.stream\.completed',\s*'The chat response is ready\.',\s*\{\s*speak:\s*true\s*\}/);
});

test("O.R.A.C.L.E. rejects low-confidence browser speech finals before chat submission", () => {
  const speechSource = readProjectFile("static", "js", "oracleSpeechRecognition.js");

  assert.match(speechSource, /MIN_FINAL_TRANSCRIPT_CONFIDENCE/);
  assert.match(speechSource, /_finalTranscriptConfidence\(result\)/);
  assert.match(speechSource, /_isLowConfidenceFinalTranscript\(finalConfidence\)/);
  assert.match(speechSource, /Number\.isFinite\(confidence\)/);
  assert.match(speechSource, /rejectedFinalTranscript:\s*true/);
  assert.match(speechSource, /rejectionReason:\s*'low_confidence'/);
  assert.match(speechSource, /rejectedTranscript:\s*finalText/);
  assert.match(speechSource, /this\.onFinalTranscript\(finalText\)/);
});

test("interrupted O.R.A.C.L.E. resumes listening instead of interrupting again", () => {
  const runtimeSource = readProjectFile("static", "js", "voiceRuntime.js");

  assert.match(runtimeSource, /this\.status\.state\s*===\s*'interrupted'/);
  assert.match(runtimeSource, /return\s+this\.start\(\)/);
});

test("sidebar New Chat uses the direct app new-chat handler", () => {
  const appSource = readProjectFile("static", "app.js");
  const sidebarLayoutSource = readProjectFile("static", "js", "sidebar-layout.js");

  assert.match(appSource, /async function startNewChatFromSidebar\(/);
  assert.match(appSource, /sidebarNewChatBtn\.addEventListener\('click',\s*startNewChatFromSidebar\)/);
  assert.doesNotMatch(sidebarLayoutSource, /sidebar-new-chat-btn[\s\S]{0,240}brandBtn\.click\(\)/);
});
