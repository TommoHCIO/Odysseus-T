# routes/tts_routes.py
"""
TTS API routes — multi-provider (local Kokoro, API endpoint, browser).
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
import logging

logger = logging.getLogger(__name__)

class TTSRequest(BaseModel):
    text: str
    format: str = "audio"  # "audio" or "base64"


def _audio_mime(audio_data: bytes) -> str:
    is_mp3 = audio_data[:3] == b'ID3' or (
        len(audio_data) >= 2
        and audio_data[0] == 0xff
        and (audio_data[1] & 0xe0) == 0xe0
    )
    return "audio/mpeg" if is_mp3 else "audio/wav"

def setup_tts_routes(tts_service):
    """Setup TTS routes with the provided TTS service"""
    router = APIRouter(prefix="/api/tts", tags=["tts"])

    @router.get("/stats")
    async def get_tts_stats():
        """Get TTS service statistics"""
        try:
            return tts_service.get_stats()
        except Exception as e:
            logger.error(f"Failed to get TTS stats: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @router.post("/synthesize")
    async def synthesize_speech(request: TTSRequest):
        """Synthesize speech from text"""
        try:
            if not tts_service.available:
                raise HTTPException(
                    status_code=503,
                    detail={"message": "TTS service not available"}
                )
            
            if request.format == "base64":
                audio_b64 = tts_service.synthesize_to_base64(request.text)
                if not audio_b64:
                    raise HTTPException(
                        status_code=500,
                        detail={"message": "Synthesis failed"}
                    )
                return {"audio": audio_b64}
            
            else:  # audio format
                audio_data = tts_service.synthesize(request.text)
                if not audio_data:
                    raise HTTPException(
                        status_code=500,
                        detail={"message": "Synthesis failed"}
                    )
                
                mime = _audio_mime(audio_data)
                return Response(
                    content=audio_data,
                    media_type=mime,
                    headers={
                        "Content-Disposition": "inline; filename=speech.mp3" if "mpeg" in mime else "inline; filename=speech.wav"
                    }
                )
        
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Synthesis error: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail={"message": f"Synthesis failed: {str(e)}"}
            )

    @router.post("/stream")
    async def stream_speech(request: TTSRequest):
        """Stream synthesized speech bytes.

        Current providers may still synthesize before yielding bytes; this route
        gives O.R.A.C.L.E. and clients a stable chunked audio transport contract.
        """
        try:
            if not tts_service.available:
                raise HTTPException(
                    status_code=503,
                    detail={"message": "TTS service not available"}
                )

            stream_fn = getattr(tts_service, "synthesize_stream", None)
            if callable(stream_fn):
                stream = iter(stream_fn(request.text))
            else:
                audio_data = tts_service.synthesize(request.text)
                stream = iter([audio_data] if audio_data else [])

            first_chunk = next(stream, None)
            if not first_chunk:
                raise HTTPException(
                    status_code=500,
                    detail={"message": "Synthesis failed"}
                )

            def audio_chunks():
                yield first_chunk
                yield from stream

            mime = _audio_mime(first_chunk)
            return StreamingResponse(
                audio_chunks(),
                media_type=mime,
                headers={
                    "Content-Disposition": "inline; filename=speech.mp3" if "mpeg" in mime else "inline; filename=speech.wav"
                },
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Streaming synthesis error: {e}", exc_info=True)
            raise HTTPException(
                status_code=500,
                detail={"message": f"Synthesis failed: {str(e)}"}
            )

    @router.post("/clear-cache")
    async def clear_tts_cache():
        """Clear TTS cache"""
        try:
            tts_service.clear_cache()
            return {"success": True, "message": "Cache cleared"}
        except Exception as e:
            logger.error(f"Failed to clear cache: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    return router
