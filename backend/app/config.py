from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # HuggingFace
    HF_API_TOKEN: str = "hf_placeholder"
    # New HF serverless inference router (old /models/ endpoint returns 410)
    HF_API_BASE_URL: str = "https://router.huggingface.co/hf-inference/models"

    # Model IDs (all from HuggingFace)
    STT_MODEL: str = "openai/whisper-large-v3-turbo"
    # Qwen2.5-7B-Instruct is warm on the HF global router and supports chat completions
    LLM_MODEL: str = "Qwen/Qwen2.5-7B-Instruct"
    TTS_MODEL: str = "facebook/mms-tts-eng"

    # App behaviour
    MAX_CONTEXT_CHARS: int = 4000        # max chars of business data sent to LLM
    SILENCE_THRESHOLD_SEC: float = 1.5   # seconds of silence before VAD triggers
    UPLOAD_DIR: str = "uploads"

    # CORS – add your frontend origin here if different
    ALLOWED_ORIGINS: list = ["*"]

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
