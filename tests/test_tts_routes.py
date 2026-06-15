from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes.tts_routes import setup_tts_routes


def test_tts_stream_returns_chunked_audio():
    app = FastAPI()
    calls = []

    class FakeTtsService:
        available = True

        def synthesize_stream(self, text: str):
            calls.append(text)
            yield b"ID3"
            yield b"audio"

    app.include_router(setup_tts_routes(FakeTtsService()))
    client = TestClient(app)

    response = client.post("/api/tts/stream", json={"text": "hello"})

    assert response.status_code == 200
    assert response.content == b"ID3audio"
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert calls == ["hello"]


def test_tts_stream_reports_unavailable_service():
    app = FastAPI()

    class FakeTtsService:
        available = False

        def synthesize_stream(self, text: str):
            raise AssertionError("synthesize_stream should not be called")

    app.include_router(setup_tts_routes(FakeTtsService()))
    client = TestClient(app)

    response = client.post("/api/tts/stream", json={"text": "hello"})

    assert response.status_code == 503
    assert response.json()["detail"]["message"] == "TTS service not available"
