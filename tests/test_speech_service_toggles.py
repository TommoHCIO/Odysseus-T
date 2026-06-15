import logging
from pathlib import Path

from services.stt.stt_service import STTService
from services.tts.tts_service import TTSService


def test_tts_disabled_toggle_blocks_synthesis(monkeypatch, tmp_path):
    service = TTSService(cache_dir=str(tmp_path))
    calls = {"endpoint": 0, "kokoro": 0}

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "tts_enabled": False,
        "tts_provider": "endpoint:voice-endpoint",
        "tts_model": "tts-1",
        "tts_voice": "alloy",
        "tts_speed": "1",
    })

    def fake_endpoint(*args, **kwargs):
        calls["endpoint"] += 1
        return b"audio"

    def fake_kokoro():
        calls["kokoro"] += 1
        return None

    monkeypatch.setattr(service, "_synthesize_api", fake_endpoint)
    monkeypatch.setattr(service, "_get_kokoro", fake_kokoro)

    assert service.available is False
    assert service.synthesize("hello") is None
    assert calls == {"endpoint": 0, "kokoro": 0}


def test_tts_stream_chunks_synthesized_audio(monkeypatch, tmp_path):
    service = TTSService(cache_dir=str(tmp_path))

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "tts_enabled": True,
        "tts_provider": "endpoint:voice-endpoint",
        "tts_model": "tts-1",
        "tts_voice": "alloy",
        "tts_speed": "1",
    })
    monkeypatch.setattr(service, "_synthesize_api", lambda *args, **kwargs: b"abcdef")

    chunks = list(service.synthesize_stream("hello", chunk_size=2))

    assert chunks == [b"ab", b"cd", b"ef"]


def test_tts_stats_report_chunked_audio_stream_for_server_providers(monkeypatch, tmp_path):
    service = TTSService(cache_dir=str(tmp_path))

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "tts_enabled": True,
        "tts_provider": "endpoint:voice-endpoint",
        "tts_model": "tts-1",
        "tts_voice": "alloy",
            "tts_speed": "1",
    })
    monkeypatch.setattr(
        service,
        "_resolve_endpoint_config",
        lambda endpoint_id: {"base_url": "http://localhost:8000/v1", "api_key": None},
        raising=False,
    )

    stats = service.get_stats()

    assert stats["available"] is True
    assert stats["supports_chunked_audio_stream"] is True


def test_tts_endpoint_stats_report_missing_endpoint_blocker(monkeypatch, tmp_path):
    service = TTSService(cache_dir=str(tmp_path))

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "tts_enabled": True,
        "tts_provider": "endpoint:missing-voice-endpoint",
        "tts_model": "tts-1",
        "tts_voice": "alloy",
        "tts_speed": "1",
    })
    monkeypatch.setattr(
        service,
        "_resolve_endpoint_config",
        lambda endpoint_id: None,
        raising=False,
    )

    stats = service.get_stats()

    assert service.available is False
    assert stats["available"] is False
    assert stats["ready"] is False
    assert stats["provider"] == "endpoint:missing-voice-endpoint"
    assert stats["endpoint_id"] == "missing-voice-endpoint"
    assert stats["setup_status"] == "endpoint_missing"
    assert stats["setup_blocker"] == "tts_endpoint_missing"
    assert stats["supports_chunked_audio_stream"] is False
    assert "OpenAI-compatible" in stats["install_hint"]


def test_stt_disabled_toggle_blocks_transcription(monkeypatch):
    service = STTService()
    calls = {"endpoint": 0, "whisper": 0}

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": False,
        "stt_provider": "endpoint:transcribe-endpoint",
        "stt_model": "whisper-1",
        "stt_language": "",
    })

    def fake_endpoint(*args, **kwargs):
        calls["endpoint"] += 1
        return "transcript"

    def fake_whisper():
        calls["whisper"] += 1
        return None

    monkeypatch.setattr(service, "_transcribe_api", fake_endpoint)
    monkeypatch.setattr(service, "_get_whisper", fake_whisper)

    assert service.available is False
    assert service.transcribe(b"audio") is None
    assert calls == {"endpoint": 0, "whisper": 0}


def test_stt_endpoint_transcription_requests_deterministic_json(monkeypatch):
    service = STTService()
    captured = {}

    monkeypatch.setattr(
        service,
        "_resolve_endpoint_config",
        lambda endpoint_id: {"base_url": "http://localhost:8000/v1", "api_key": "key"},
    )

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"text": "hello oracle"}

    def fake_post(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr("services.stt.stt_service.httpx.post", fake_post)

    assert service._transcribe_api(b"audio", "speaches-stt", "Systran/faster-whisper-small.en", "en") == "hello oracle"
    assert captured["url"] == "http://localhost:8000/v1/audio/transcriptions"
    assert captured["headers"]["Authorization"] == "Bearer key"
    assert captured["data"] == {
        "model": "Systran/faster-whisper-small.en",
        "response_format": "json",
        "temperature": "0",
        "language": "en",
    }


def test_stt_local_stats_report_partial_transcripts_when_whisper_available(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "",
    })
    monkeypatch.setattr(service, "_get_whisper", lambda: object())

    stats = service.get_stats()

    assert stats["available"] is True
    assert stats["provider"] == "local"
    assert stats["supports_partial_transcripts"] is True
    assert stats["supports_incremental_transcripts"] is True
    assert stats["speech_to_chat_quality"] == "diagnostic"
    assert stats["speech_to_chat_blocker"] == "local_rolling_buffer_diagnostic"


def test_stt_local_stats_report_dependency_blocker_when_whisper_missing(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "",
    })
    monkeypatch.setattr(service, "_local_dependency_available", lambda: False)
    monkeypatch.setattr(service, "_get_whisper", lambda: None)

    stats = service.get_stats()

    assert stats["available"] is False
    assert stats["provider"] == "local"
    assert stats["model_loaded"] is False
    assert stats["setup_status"] == "dependency_missing"
    assert stats["setup_blocker"] == "local_stt_dependency_missing"
    assert "faster-whisper" in stats["install_hint"]
    assert stats["supports_partial_transcripts"] is False
    assert stats["supports_incremental_transcripts"] is False


def test_stt_local_transcribe_stream_yields_segment_partials_and_final(monkeypatch):
    service = STTService()

    class Segment:
        def __init__(self, text):
            self.text = text

    class Info:
        language = "en"
        language_probability = 0.99

    class MockWhisper:
        def transcribe(self, *args, **kwargs):
            return [Segment(" hello "), Segment(" from oracle ")], Info()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(service, "_get_whisper", lambda: MockWhisper())

    events = list(service.transcribe_stream(b"audio"))

    assert [{key: event[key] for key in ("type", "text")} for event in events] == [
        {"type": "partial", "text": "hello"},
        {"type": "partial", "text": "hello from oracle"},
        {"type": "final", "text": "hello from oracle"},
    ]
    assert events[-1]["diagnostics"]["language_probability"] == 0.99


def test_stt_local_incremental_stream_emits_changed_partial_and_final(monkeypatch):
    service = STTService()
    calls = []

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })

    def fake_events(audio_bytes, language="", **_kwargs):
        calls.append((audio_bytes, language))
        if audio_bytes == b"hello":
            return [
                {"type": "partial", "text": "hello"},
                {"type": "final", "text": "hello"},
            ]
        return [
            {"type": "partial", "text": "hello"},
            {"type": "partial", "text": "hello oracle"},
            {"type": "final", "text": "hello oracle"},
        ]

    monkeypatch.setattr(service, "_get_whisper", lambda: object())
    monkeypatch.setattr(service, "_transcribe_local_events", fake_events)

    stream = service.start_incremental_stream(mime_type="audio/webm")

    first_partial = list(stream.accept_audio(b"hello"))
    second_partial = list(stream.accept_audio(b" oracle"))
    final = list(stream.finish())

    assert [(event["type"], event["text"]) for event in first_partial] == [("partial", "hello")]
    assert [(event["type"], event["text"]) for event in second_partial] == [("partial", "hello oracle")]
    assert [(event["type"], event["text"]) for event in final] == [("final", "hello oracle")]
    assert first_partial[0]["diagnostics"]["bytes_received"] == 5
    assert first_partial[0]["diagnostics"]["decode_attempt"] == 1
    assert second_partial[0]["diagnostics"]["bytes_received"] == 12
    assert second_partial[0]["diagnostics"]["decode_attempt"] == 2
    assert final[0]["diagnostics"]["bytes_received"] == 12
    assert final[0]["diagnostics"]["decode_attempt"] == 3
    assert calls == [
        (b"hello", "en"),
        (b"hello oracle", "en"),
        (b"hello oracle", "en"),
    ]


def test_stt_local_incremental_stream_reports_redacted_diagnostics(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(service, "_get_whisper", lambda: object())
    monkeypatch.setattr(service, "_transcribe_local_events", lambda *_args, **_kwargs: [
        {"type": "partial", "text": "hello"},
        {"type": "final", "text": "hello"},
    ])

    stream = service.start_incremental_stream(mime_type="audio/webm")

    partial = list(stream.accept_audio(b"hello"))[0]
    final = list(stream.finish())[0]

    assert partial["text"] == "hello"
    assert partial["diagnostics"]["provider"] == "local"
    assert partial["diagnostics"]["mode"] == "rolling_buffer"
    assert partial["diagnostics"]["bytes_received"] == 5
    assert partial["diagnostics"]["decode_attempt"] == 1
    assert isinstance(partial["diagnostics"]["decode_ms"], (int, float))
    assert "text" not in partial["diagnostics"]
    assert final["diagnostics"]["bytes_received"] == 5
    assert final["diagnostics"]["decode_attempt"] == 2


def test_stt_local_incremental_stream_preserves_quality_diagnostics(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })

    class Segment:
        text = " background speech "
        avg_logprob = -1.8
        no_speech_prob = 0.92
        compression_ratio = 2.1

    class Info:
        language = "en"
        language_probability = 0.74

    class MockWhisper:
        def transcribe(self, *_args, **_kwargs):
            return [Segment()], Info()

    monkeypatch.setattr(service, "_get_whisper", lambda: MockWhisper())

    stream = service.start_incremental_stream(mime_type="audio/webm")

    final = list(stream.accept_audio(b"audio")) + list(stream.finish())

    final_event = [event for event in final if event["type"] == "final"][0]
    assert final_event["text"] == "background speech"
    assert final_event["diagnostics"]["avg_logprob"] == -1.8
    assert final_event["diagnostics"]["no_speech_prob"] == 0.92
    assert final_event["diagnostics"]["compression_ratio"] == 2.1
    assert final_event["diagnostics"]["language_probability"] == 0.74


def test_stt_local_incremental_stream_suppresses_punctuation_only_partial_churn(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })

    def fake_events(audio_bytes, language="", **_kwargs):
        if audio_bytes == b"a":
            return [
                {"type": "partial", "text": "hello"},
                {"type": "final", "text": "hello"},
            ]
        if audio_bytes == b"ab":
            return [
                {"type": "partial", "text": "Hello!"},
                {"type": "final", "text": "Hello!"},
            ]
        return [
            {"type": "partial", "text": "Hello oracle!"},
            {"type": "final", "text": "Hello oracle!"},
        ]

    monkeypatch.setattr(service, "_get_whisper", lambda: object())
    monkeypatch.setattr(service, "_transcribe_local_events", fake_events)

    stream = service.start_incremental_stream(mime_type="audio/webm")

    first_partial = list(stream.accept_audio(b"a"))
    punctuation_only_partial = list(stream.accept_audio(b"b"))
    extended_partial = list(stream.accept_audio(b"c"))
    final = list(stream.finish())

    assert [(event["type"], event["text"]) for event in first_partial] == [("partial", "hello")]
    assert punctuation_only_partial == []
    assert [(event["type"], event["text"]) for event in extended_partial] == [("partial", "Hello oracle!")]
    assert [(event["type"], event["text"]) for event in final] == [("final", "Hello oracle!")]


def test_stt_local_incremental_stream_keeps_longer_partial_over_short_fragment_final(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })

    calls = 0

    def fake_events(audio_bytes, language="", **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return [
                {"type": "partial", "text": "so oracle testing"},
                {"type": "final", "text": "so oracle testing"},
            ]
        return [
            {"type": "final", "text": "law."},
        ]

    monkeypatch.setattr(service, "_get_whisper", lambda: object())
    monkeypatch.setattr(service, "_transcribe_local_events", fake_events)

    stream = service.start_incremental_stream(mime_type="audio/webm")

    partial = list(stream.accept_audio(b"audio"))
    final = list(stream.finish())

    assert [(event["type"], event["text"]) for event in partial] == [("partial", "so oracle testing")]
    assert [(event["type"], event["text"]) for event in final] == [("final", "so oracle testing")]
    assert final[0]["diagnostics"]["decode_attempt"] == 2


def test_stt_local_incremental_stream_treats_early_decode_failures_as_probe_misses(monkeypatch, caplog):
    service = STTService()

    class Segment:
        def __init__(self, text):
            self.text = text

    class Info:
        language = "en"
        language_probability = 0.99

    class MockWhisper:
        def transcribe(self, path, **_kwargs):
            if len(Path(path).read_bytes()) < 5:
                raise RuntimeError("Invalid data found when processing input")
            return [Segment(" hello oracle ")], Info()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "local",
        "stt_model": "base",
        "stt_language": "en",
    })
    monkeypatch.setattr(service, "_get_whisper", lambda: MockWhisper())

    stream = service.start_incremental_stream(mime_type="audio/webm")

    with caplog.at_level(logging.ERROR):
        assert list(stream.accept_audio(b"abc")) == []
        partial = list(stream.accept_audio(b"def"))
        final = list(stream.finish())

    assert [(event["type"], event["text"]) for event in partial] == [("partial", "hello oracle")]
    assert [(event["type"], event["text"]) for event in final] == [("final", "hello oracle")]
    assert partial[0]["diagnostics"]["bytes_received"] == 6
    assert partial[0]["diagnostics"]["decode_attempt"] == 2
    assert final[0]["diagnostics"]["bytes_received"] == 6
    assert final[0]["diagnostics"]["decode_attempt"] == 3

    assert [
        record for record in caplog.records
        if record.name == "services.stt.stt_service" and record.levelno >= logging.ERROR
    ] == []


def test_stt_local_whisper_uses_realtime_quality_decode_options(monkeypatch):
    service = STTService()
    calls = []

    class Info:
        language = "en"
        language_probability = 0.99

    class MockWhisper:
        def transcribe(self, path, **kwargs):
            calls.append(kwargs)
            return [], Info()

    monkeypatch.setattr(service, "_get_whisper", lambda: MockWhisper())

    assert list(service._transcribe_local_events(b"audio", "en")) == []

    assert calls[0] == {
        "language": "en",
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
    assert calls[1]["vad_filter"] is False


def test_stt_local_whisper_retries_without_internal_vad_when_browser_vad_audio_is_stripped(monkeypatch):
    service = STTService()
    calls = []

    class Segment:
        text = " hello oracle "
        avg_logprob = -0.2
        no_speech_prob = 0.05
        compression_ratio = 1.1

    class Info:
        language = "en"
        language_probability = 0.99

    class MockWhisper:
        def transcribe(self, path, **kwargs):
            calls.append(kwargs)
            if kwargs.get("vad_filter") is True:
                return [], Info()
            return [Segment()], Info()

    monkeypatch.setattr(service, "_get_whisper", lambda: MockWhisper())

    events = list(service._transcribe_local_events(b"audio", "en"))

    assert [(event["type"], event["text"]) for event in events] == [
        ("partial", "hello oracle"),
        ("final", "hello oracle"),
    ]
    assert [call["vad_filter"] for call in calls] == [True, False]
    assert events[-1]["diagnostics"]["vad_filter_retried_without_vad"] is True
    assert events[-1]["diagnostics"]["no_speech_prob"] == 0.05


def test_stt_endpoint_stats_do_not_claim_partial_transcripts(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "endpoint:transcribe-endpoint",
        "stt_model": "whisper-1",
        "stt_language": "",
    })
    monkeypatch.setattr(
        service,
        "_resolve_endpoint_config",
        lambda endpoint_id: {"base_url": "http://localhost:8000/v1", "api_key": None},
    )

    stats = service.get_stats()

    assert stats["available"] is True
    assert stats["provider"] == "endpoint:transcribe-endpoint"
    assert stats["supports_partial_transcripts"] is False
    assert stats["supports_incremental_transcripts"] is False
    assert stats["speech_to_chat_quality"] == "provider_grade"
    assert stats["speech_to_chat_blocker"] is None


def test_stt_endpoint_stats_report_missing_endpoint_blocker(monkeypatch):
    service = STTService()

    monkeypatch.setattr(service, "_load_settings", lambda: {
        "stt_enabled": True,
        "stt_provider": "endpoint:missing-transcribe-endpoint",
        "stt_model": "whisper-1",
        "stt_language": "",
    })
    monkeypatch.setattr(service, "_resolve_endpoint_config", lambda endpoint_id: None)

    stats = service.get_stats()

    assert service.available is False
    assert stats["available"] is False
    assert stats["provider"] == "endpoint:missing-transcribe-endpoint"
    assert stats["endpoint_id"] == "missing-transcribe-endpoint"
    assert stats["setup_status"] == "endpoint_missing"
    assert stats["setup_blocker"] == "stt_endpoint_missing"
    assert stats["speech_to_chat_quality"] == "unavailable"
    assert stats["speech_to_chat_blocker"] == "stt_endpoint_missing"
    assert "OpenAI-compatible" in stats["install_hint"]
