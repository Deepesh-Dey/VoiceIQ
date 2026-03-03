"""
Text-to-Speech service using facebook/mms-tts-eng on HuggingFace.
Returns raw audio bytes (WAV) ready to be sent to the browser.
"""
import logging
from app.services.hf_client import hf_client
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


async def synthesize_speech(text: str) -> bytes:
    """
    Convert text to speech using HuggingFace TTS model.

    Args:
        text: The text string to synthesize.

    Returns:
        Raw WAV audio bytes.
    """
    if not text or not text.strip():
        raise ValueError("Cannot synthesize empty text.")

    try:
        audio_bytes = await hf_client.post_json_get_binary(
            model_id=settings.TTS_MODEL,
            payload={"inputs": text.strip()},
            wait_for_model=True,
        )
        logger.info(f"TTS synthesized {len(audio_bytes)} bytes for text: {text[:60]}...")
        return audio_bytes

    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise RuntimeError(f"Text-to-speech failed: {e}") from e
