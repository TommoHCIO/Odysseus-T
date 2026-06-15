# services/stt/stt_service.py
"""Multi-provider Speech-to-Text service — dispatches to local Whisper, OpenAI-compatible API, or browser."""

import io
import importlib.util
import logging
import httpx
import re
import tempfile
import time
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class LocalIncrementalSTTStream:
    """Conservative rolling-buffer incremental STT adapter for local Whisper."""

    def __init__(self, service: "STTService", language: str = ""):
        self.service = service
        self.language = language
        self.audio_buffer = bytearray()
        self.last_partial_text = ""
        self.last_partial_key = ""
        self.last_final_text = ""
        self.decode_attempts = 0

    @staticmethod
    def _partial_key(text: str) -> str:
        return re.sub(r"\W+", " ", text.lower()).strip()

    @staticmethod
    def _word_count(key: str) -> int:
        return len([word for word in key.split(" ") if word])

    def _select_final_text(self, final_text: str) -> str:
        final_key = self._partial_key(final_text)
        previous_key = self.last_partial_key
        if (
            final_key
            and previous_key
            and self._word_count(final_key) <= 1
            and self._word_count(previous_key) >= 3
        ):
            return self.last_partial_text
        return final_text

    def _diagnostics(self, *, decode_ms: float, event_diagnostics: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        diagnostics = {
            "provider": "local",
            "mode": "rolling_buffer",
            "bytes_received": len(self.audio_buffer),
            "decode_attempt": self.decode_attempts,
            "decode_ms": round(decode_ms, 3),
        }
        if isinstance(event_diagnostics, dict):
            for key in ("avg_logprob", "no_speech_prob", "compression_ratio", "language_probability"):
                value = event_diagnostics.get(key)
                if isinstance(value, (int, float)):
                    diagnostics[key] = round(float(value), 6)
        return diagnostics

    def _events_for_buffer(self, *, log_decode_errors: bool = False):
        self.decode_attempts += 1
        started = time.perf_counter()
        events = list(self.service._transcribe_local_events(
            bytes(self.audio_buffer),
            self.language,
            log_decode_errors=log_decode_errors,
        ))
        decode_ms = (time.perf_counter() - started) * 1000
        final_text = ""
        final_event_diagnostics: Dict[str, Any] = {}
        emitted_partial = False
        for event in events:
            if not isinstance(event, dict):
                continue
            event_type = str(event.get("type") or "").strip()
            text = str(event.get("text") or "").strip()
            if not text:
                continue
            if event_type == "final":
                final_text = text
                final_event_diagnostics = event.get("diagnostics") if isinstance(event.get("diagnostics"), dict) else {}
                continue
            if event_type != "partial":
                continue
            partial_key = self._partial_key(text)
            if partial_key and partial_key == self.last_partial_key:
                continue
            diagnostics = self._diagnostics(
                decode_ms=decode_ms,
                event_diagnostics=event.get("diagnostics") if isinstance(event.get("diagnostics"), dict) else {},
            )
            self.last_partial_text = text
            self.last_partial_key = partial_key
            emitted_partial = True
            yield {"type": "partial", "text": text, "diagnostics": diagnostics}
        if final_text:
            self.last_final_text = final_text
            final_key = self._partial_key(final_text)
            if not emitted_partial and final_key != self.last_partial_key:
                diagnostics = self._diagnostics(decode_ms=decode_ms, event_diagnostics=final_event_diagnostics)
                self.last_partial_text = final_text
                self.last_partial_key = final_key
                yield {"type": "partial", "text": final_text, "diagnostics": diagnostics}

    def accept_audio(self, audio_bytes: bytes):
        if not audio_bytes:
            return
        self.append_audio(audio_bytes)
        yield from self._events_for_buffer(log_decode_errors=False)

    def append_audio(self, audio_bytes: bytes) -> None:
        if not audio_bytes:
            return
        self.audio_buffer.extend(audio_bytes)

    def finish(self):
        if not self.audio_buffer:
            return
        final_text = ""
        self.decode_attempts += 1
        started = time.perf_counter()
        events = list(self.service._transcribe_local_events(bytes(self.audio_buffer), self.language))
        decode_ms = (time.perf_counter() - started) * 1000
        final_event_diagnostics: Dict[str, Any] = {}
        for event in events:
            if not isinstance(event, dict):
                continue
            event_type = str(event.get("type") or "").strip()
            text = str(event.get("text") or "").strip()
            if event_type == "final" and text:
                final_text = text
                final_event_diagnostics = event.get("diagnostics") if isinstance(event.get("diagnostics"), dict) else {}
        final_text = final_text or self.last_final_text or self.last_partial_text
        if final_text:
            final_text = self._select_final_text(final_text)
        if final_text:
            self.last_final_text = final_text
            diagnostics = self._diagnostics(decode_ms=decode_ms, event_diagnostics=final_event_diagnostics)
            yield {"type": "final", "text": final_text, "diagnostics": diagnostics}


class STTService:
    """Multi-provider STT service.

    Reads provider config from data/settings.json on each call.
    Providers:
      "disabled"        — no STT
      "browser"         — client-side Web Speech API (no server transcription)
      "local"           — faster-whisper on CPU/GPU
      "endpoint:<id>"   — OpenAI-compatible /audio/transcriptions via ModelEndpoint
    """

    def __init__(self):
        self._whisper_model = None  # lazy-init

    # ── Settings ──

    def _load_settings(self) -> dict:
        from src.settings import load_settings
        saved = load_settings()
        return {
            "stt_enabled": saved.get("stt_enabled", False),
            "stt_provider": saved.get("stt_provider", "disabled"),
            "stt_model": saved.get("stt_model", "base"),
            "stt_language": saved.get("stt_language", ""),
        }

    @property
    def available(self) -> bool:
        settings = self._load_settings()
        if settings.get("stt_enabled") is False:
            return False
        provider = settings["stt_provider"]
        if provider == "disabled":
            return False
        if provider == "browser":
            return True  # handled client-side
        if provider == "local":
            return self._get_whisper() is not None
        if provider.startswith("endpoint:"):
            endpoint_id = provider.split(":", 1)[1]
            return self._resolve_endpoint_config(endpoint_id) is not None
        return False

    # ── Local Whisper ──

    def _local_dependency_available(self) -> bool:
        return importlib.util.find_spec("faster_whisper") is not None

    def _get_whisper(self):
        if self._whisper_model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError:
                logger.warning("faster-whisper not installed. Install with: pip install faster-whisper")
                return None
            try:
                settings = self._load_settings()
                model_size = settings.get("stt_model", "base")
                # faster-whisper runs on CTranslate2, not torch. torch is only
                # used (optionally) to detect a CUDA device for acceleration —
                # if it's missing or unusable we just run on CPU. Keeping this
                # probe separate (and tolerant of any failure, e.g. a broken
                # CUDA/torch install that raises OSError on import) means a
                # torch-less or torch-broken machine still does CPU
                # transcription instead of failing with a misleading
                # "faster-whisper not installed" error.
                try:
                    import torch
                    use_cuda = torch.cuda.is_available()
                except Exception:
                    use_cuda = False
                device = "cuda" if use_cuda else "cpu"
                compute_type = "float16" if device == "cuda" else "int8"
                self._whisper_model = WhisperModel(model_size, device=device, compute_type=compute_type)
                logger.info(f"faster-whisper model '{model_size}' loaded on {device}")
            except Exception as e:
                logger.error(f"Failed to load whisper model: {e}")
                return None
        return self._whisper_model

    def _local_transcribe_options(self, language: str = "") -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 200,
            },
            "hallucination_silence_threshold": 1.0,
        }
        if language:
            kwargs["language"] = language
        return kwargs

    @staticmethod
    def _local_quality_diagnostics(info: Any, segments: list[Any]) -> Dict[str, Any]:
        diagnostics: Dict[str, Any] = {}
        avg_logprobs = [
            float(getattr(segment, "avg_logprob"))
            for segment in segments
            if isinstance(getattr(segment, "avg_logprob", None), (int, float))
        ]
        no_speech_probs = [
            float(getattr(segment, "no_speech_prob"))
            for segment in segments
            if isinstance(getattr(segment, "no_speech_prob", None), (int, float))
        ]
        compression_ratios = [
            float(getattr(segment, "compression_ratio"))
            for segment in segments
            if isinstance(getattr(segment, "compression_ratio", None), (int, float))
        ]
        language_probability = getattr(info, "language_probability", None)
        if avg_logprobs:
            diagnostics["avg_logprob"] = sum(avg_logprobs) / len(avg_logprobs)
        if no_speech_probs:
            diagnostics["no_speech_prob"] = max(no_speech_probs)
        if compression_ratios:
            diagnostics["compression_ratio"] = max(compression_ratios)
        if isinstance(language_probability, (int, float)):
            diagnostics["language_probability"] = float(language_probability)
        return diagnostics

    def _transcribe_local_events(self, audio_bytes: bytes, language: str = "", *, log_decode_errors: bool = True):
        model = self._get_whisper()
        if not model:
            return
        tmp_path = None
        try:
            # Write to temp file (faster-whisper needs a file path or file-like)
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            kwargs = self._local_transcribe_options(language)
            segments, info = model.transcribe(tmp_path, **kwargs)
            segments = list(segments)
            has_segment_text = any((getattr(segment, "text", "") or "").strip() for segment in segments)
            retried_without_vad = False
            if not has_segment_text and kwargs.get("vad_filter"):
                fallback_kwargs = dict(kwargs)
                fallback_kwargs["vad_filter"] = False
                segments, info = model.transcribe(tmp_path, **fallback_kwargs)
                segments = list(segments)
                if any((getattr(segment, "text", "") or "").strip() for segment in segments):
                    retried_without_vad = True
                    logger.info("Local STT recovered text after retrying without faster-whisper VAD")
            accumulated = []
            segment_window = []
            for segment in segments:
                segment_text = (getattr(segment, "text", "") or "").strip()
                if not segment_text:
                    continue
                accumulated.append(segment_text)
                segment_window.append(segment)
                diagnostics = self._local_quality_diagnostics(info, segment_window)
                if retried_without_vad:
                    diagnostics["vad_filter_retried_without_vad"] = True
                yield {
                    "type": "partial",
                    "text": " ".join(accumulated),
                    "diagnostics": diagnostics,
                }

            text = " ".join(accumulated)
            logger.info(f"Local STT: {len(text)} chars, lang={info.language}, prob={info.language_probability:.2f}")
            if text:
                diagnostics = self._local_quality_diagnostics(info, segment_window)
                if retried_without_vad:
                    diagnostics["vad_filter_retried_without_vad"] = True
                yield {
                    "type": "final",
                    "text": text,
                    "diagnostics": diagnostics,
                }
        except Exception as e:
            if log_decode_errors:
                logger.error(f"Local STT transcription failed: {e}", exc_info=True)
            else:
                logger.debug("Local incremental STT probe could not decode the current buffer: %s", e)
        finally:
            if tmp_path:
                Path(tmp_path).unlink(missing_ok=True)

    def _transcribe_local(self, audio_bytes: bytes, language: str = "") -> Optional[str]:
        final_text = None
        for event in self._transcribe_local_events(audio_bytes, language):
            if event.get("type") == "final":
                final_text = event.get("text") or ""
        return final_text

    # ── API endpoint ──

    def _resolve_endpoint_config(self, endpoint_id: str) -> Optional[Dict[str, Any]]:
        from src.database import SessionLocal, ModelEndpoint

        db = SessionLocal()
        try:
            ep = db.query(ModelEndpoint).filter(ModelEndpoint.id == endpoint_id).first()
            if not ep:
                return None
            if getattr(ep, "is_enabled", True) is False:
                return None
            base_url = str(getattr(ep, "base_url", "") or "").rstrip("/")
            if not base_url:
                return None
            return {
                "base_url": base_url,
                "api_key": getattr(ep, "api_key", None),
            }
        finally:
            db.close()

    def _transcribe_api(self, audio_bytes: bytes, endpoint_id: str, model: str, language: str = "") -> Optional[str]:
        endpoint_config = self._resolve_endpoint_config(endpoint_id)
        if not endpoint_config:
            logger.error(f"STT endpoint {endpoint_id} not found or disabled")
            return None
        base_url = endpoint_config["base_url"]
        api_key = endpoint_config.get("api_key")

        url = base_url + "/audio/transcriptions"
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        files = {"file": ("audio.webm", io.BytesIO(audio_bytes), "audio/webm")}
        data = {
            "model": model or "whisper-1",
            "response_format": "json",
            "temperature": "0",
        }
        if language:
            data["language"] = language

        try:
            r = httpx.post(url, headers=headers, files=files, data=data, timeout=60)
            r.raise_for_status()
            result = r.json()
            text = result.get("text", "")
            logger.info(f"API STT: {len(text)} chars from {base_url}")
            return text
        except Exception as e:
            logger.error(f"API STT transcription failed: {e}")
            return None

    # ── Public interface ──

    def transcribe(self, audio_bytes: bytes) -> Optional[str]:
        settings = self._load_settings()
        if settings.get("stt_enabled") is False:
            return None
        provider = settings["stt_provider"]
        model = settings["stt_model"]
        language = settings.get("stt_language", "")

        if provider in ("disabled", "browser"):
            return None

        if provider == "local":
            return self._transcribe_local(audio_bytes, language)
        elif provider.startswith("endpoint:"):
            endpoint_id = provider.split(":", 1)[1]
            return self._transcribe_api(audio_bytes, endpoint_id, model, language)
        else:
            logger.error(f"Unknown STT provider: {provider}")
            return None

    def transcribe_stream(self, audio_bytes: bytes):
        settings = self._load_settings()
        if settings.get("stt_enabled") is False:
            return
        provider = settings["stt_provider"]
        language = settings.get("stt_language", "")

        if provider == "local":
            yield from self._transcribe_local_events(audio_bytes, language)
            return

        text = self.transcribe(audio_bytes)
        if text:
            yield {"type": "final", "text": text}

    def start_incremental_stream(self, **_kwargs):
        settings = self._load_settings()
        if settings.get("stt_enabled") is False:
            return None
        if settings.get("stt_provider") != "local":
            return None
        if self._get_whisper() is None:
            return None
        return LocalIncrementalSTTStream(self, settings.get("stt_language", ""))

    def get_stats(self) -> Dict[str, Any]:
        settings = self._load_settings()
        provider = settings["stt_provider"]
        stt_enabled = settings.get("stt_enabled", False)
        # If toggle is off, report as disabled
        effective_provider = provider if stt_enabled else "disabled"
        available = self.available and stt_enabled

        stats = {
            "available": available,
            "provider": effective_provider,
            "model": settings["stt_model"],
            "language": settings.get("stt_language", ""),
            "setup_status": "ready" if available else "disabled",
            "setup_blocker": None if available else "stt_disabled",
            "supports_partial_transcripts": False,
            "supports_incremental_transcripts": False,
            "speech_to_chat_quality": "unavailable",
            "speech_to_chat_blocker": "stt_disabled" if not available else None,
        }

        if provider == "local":
            whisper = self._get_whisper()
            dependency_available = self._local_dependency_available()
            stats["model_loaded"] = whisper is not None
            stats["supports_partial_transcripts"] = bool(stats["available"] and whisper is not None)
            stats["supports_incremental_transcripts"] = bool(stats["available"] and whisper is not None)
            stats["speech_to_chat_quality"] = "diagnostic" if stats["supports_incremental_transcripts"] else "unavailable"
            stats["speech_to_chat_blocker"] = (
                "local_rolling_buffer_diagnostic"
                if stats["supports_incremental_transcripts"]
                else stats["setup_blocker"]
            )
            if not stt_enabled:
                stats["setup_status"] = "disabled"
                stats["setup_blocker"] = "stt_disabled"
                stats["speech_to_chat_blocker"] = "stt_disabled"
            elif not dependency_available and whisper is None:
                stats["setup_status"] = "dependency_missing"
                stats["setup_blocker"] = "local_stt_dependency_missing"
                stats["speech_to_chat_blocker"] = "local_stt_dependency_missing"
                stats["install_hint"] = "Install faster-whisper to use the local Speech-to-Text provider."
            elif whisper is None:
                stats["setup_status"] = "model_unavailable"
                stats["setup_blocker"] = "local_stt_model_unavailable"
                stats["speech_to_chat_blocker"] = "local_stt_model_unavailable"
            else:
                stats["setup_status"] = "ready"
                stats["setup_blocker"] = None
        elif provider == "browser":
            stats["model"] = "Browser (Web Speech API)"
            stats["setup_status"] = "ready" if stt_enabled else "disabled"
            stats["setup_blocker"] = None if stt_enabled else "stt_disabled"
            stats["speech_to_chat_quality"] = "browser"
            stats["speech_to_chat_blocker"] = None if stt_enabled else "stt_disabled"
        elif provider.startswith("endpoint:"):
            endpoint_id = provider.split(":", 1)[1]
            endpoint_config = self._resolve_endpoint_config(endpoint_id) if stt_enabled else None
            stats["endpoint_id"] = endpoint_id
            if not stt_enabled:
                stats["setup_status"] = "disabled"
                stats["setup_blocker"] = "stt_disabled"
                stats["speech_to_chat_quality"] = "unavailable"
                stats["speech_to_chat_blocker"] = "stt_disabled"
            elif endpoint_config is None:
                stats["available"] = False
                stats["setup_status"] = "endpoint_missing"
                stats["setup_blocker"] = "stt_endpoint_missing"
                stats["speech_to_chat_quality"] = "unavailable"
                stats["speech_to_chat_blocker"] = "stt_endpoint_missing"
                stats["install_hint"] = "Configure an enabled OpenAI-compatible Speech-to-Text endpoint before selecting this provider."
            else:
                stats["setup_status"] = "ready"
                stats["setup_blocker"] = None
                stats["speech_to_chat_quality"] = "provider_grade"
                stats["speech_to_chat_blocker"] = None

        return stats


# Module-level singleton
_stt_service = None

def get_stt_service() -> STTService:
    global _stt_service
    if _stt_service is None:
        _stt_service = STTService()
    return _stt_service
