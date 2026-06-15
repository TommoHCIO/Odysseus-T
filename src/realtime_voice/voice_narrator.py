"""Always-on O.R.A.C.L.E. narration worker."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


class VoiceNarratorQueueFull(RuntimeError):
    """Raised when the narration queue is full."""


@dataclass
class _NarrationJob:
    text: str
    future: asyncio.Future


def _collect_tts_audio(tts_service: Any, text: str) -> Optional[bytes]:
    stream_fn = getattr(tts_service, "synthesize_stream", None)
    if callable(stream_fn):
        chunks = [chunk for chunk in stream_fn(text) if chunk]
        return b"".join(chunks) if chunks else None
    synthesize = getattr(tts_service, "synthesize", None)
    if callable(synthesize):
        return synthesize(text)
    return None


class VoiceNarrator:
    """Runtime-B worker that serializes server Text-to-Speech work.

    The browser remains responsible for audio playback. This worker keeps the
    backend narration path alive, queued, and off the request event loop.
    """

    def __init__(self, tts_service: Any, *, max_queue_size: int = 8):
        self.tts_service = tts_service
        self.max_queue_size = max_queue_size
        self._queue: asyncio.Queue[_NarrationJob] | None = None
        self._task: asyncio.Task | None = None
        self._processed = 0
        self._failed = 0
        self._last_error = ""

    @property
    def running(self) -> bool:
        return bool(self._task and not self._task.done())

    async def start(self) -> None:
        if self.running:
            return
        self._queue = asyncio.Queue(maxsize=self.max_queue_size)
        self._task = asyncio.create_task(self._run(), name="oracle-voice-narrator")
        logger.info("O.R.A.C.L.E. voice narrator worker started")

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self._queue:
            while not self._queue.empty():
                job = self._queue.get_nowait()
                if not job.future.done():
                    job.future.set_result(None)
                self._queue.task_done()
        logger.info("O.R.A.C.L.E. voice narrator worker stopped")

    async def synthesize(self, text: str) -> Optional[bytes]:
        speech_text = (text or "").strip()
        if not speech_text:
            return None
        if not self.running:
            await self.start()
        if self._queue is None:
            return None
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        try:
            self._queue.put_nowait(_NarrationJob(text=speech_text, future=future))
        except asyncio.QueueFull as exc:
            raise VoiceNarratorQueueFull("voice narrator queue is full") from exc
        return await future

    def get_stats(self) -> dict[str, Any]:
        tts_stats: dict[str, Any] = {}
        if self.tts_service is not None:
            try:
                stats = self.tts_service.get_stats()
                if isinstance(stats, dict):
                    tts_stats = stats
            except Exception as error:
                self._last_error = f"{type(error).__name__}: {error}"
        return {
            "running": self.running,
            "queue_size": self._queue.qsize() if self._queue is not None else 0,
            "max_queue_size": self.max_queue_size,
            "backend_tts_available": bool(
                tts_stats.get("available")
                and tts_stats.get("supports_chunked_audio_stream")
            ),
            "processed": self._processed,
            "failed": self._failed,
            "last_error": self._last_error or None,
        }

    async def _run(self) -> None:
        assert self._queue is not None
        while True:
            job = await self._queue.get()
            try:
                audio = await asyncio.to_thread(_collect_tts_audio, self.tts_service, job.text)
                if not job.future.done():
                    job.future.set_result(audio)
                if audio:
                    self._processed += 1
                    self._last_error = ""
                else:
                    self._failed += 1
                    self._last_error = "speech synthesis returned no audio"
            except Exception as error:
                self._failed += 1
                self._last_error = f"{type(error).__name__}: {error}"
                if not job.future.done():
                    job.future.set_result(None)
                logger.warning("O.R.A.C.L.E. voice narrator synthesis failed: %s", error)
            finally:
                self._queue.task_done()
