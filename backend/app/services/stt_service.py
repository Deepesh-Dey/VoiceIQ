"""
Speech-to-Text service using openai/whisper-large-v3-turbo on HuggingFace.

The HF Inference Provider API for ASR accepts a raw binary audio payload:
  POST https://router.huggingface.co/hf-inference/models/<model>
  Authorization: Bearer <token>
  Content-Type: audio/wav        (or audio/flac, audio/mpeg, etc.)
  Body: <raw audio bytes>

The browser-side voiceInterface.js records PCM and encodes it as WAV,
so no server-side audio conversion is required.
"""
import asyncio
import logging
import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/wav") -> str:
    """
    Send raw WAV bytes to Whisper via the HuggingFace Inference API.

    Args:
        audio_bytes:  Raw WAV audio data (16-bit PCM, 16kHz mono).
        content_type: MIME type – always audio/wav from the browser recorder.

    Returns:
        Transcribed text string.
    """
    url = f"{settings.HF_API_BASE_URL}/{settings.STT_MODEL}"

    headers = {
        "Authorization": f"Bearer {settings.HF_API_TOKEN}",
        "Content-Type": content_type,
    }

    last_exc: Exception = Exception("Unknown error")
    for attempt in range(1, 4):          # up to 3 attempts
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(url, headers=headers, content=audio_bytes)
                response.raise_for_status()
                result = response.json()

            # HF ASR response: {"text": "..."} or [{"generated_text": "..."}]
            if isinstance(result, dict):
                text = result.get("text", "").strip()
            elif isinstance(result, list) and result:
                text = (result[0].get("text") or result[0].get("generated_text") or "").strip()
            else:
                text = ""

            logger.info(f"STT transcript ({len(audio_bytes)} bytes): {text[:80]}...")
            return text

        except (httpx.ConnectError, httpx.TimeoutException) as e:
            last_exc = e
            logger.warning(f"STT attempt {attempt}/3 failed (network): {e}. Retrying…")
            await asyncio.sleep(1.5 * attempt)   # 1.5 s, 3 s back-off
        except Exception as e:
            logger.error(f"STT error: {e}")
            raise RuntimeError(f"Speech-to-text failed: {e}") from e

    logger.error(f"STT failed after 3 attempts: {last_exc}")
    raise RuntimeError(f"Speech-to-text failed (network): {last_exc}") from last_exc
