from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import os
import pathlib

from app.config import get_settings
from app.routes import upload, voice, chat

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure upload directory exists
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    yield


app = FastAPI(
    title="Business Voice Assistant API",
    description="Voice-enabled business data analysis powered by HuggingFace",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS – allow all origins (tighten in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(upload.router, prefix="/api/upload", tags=["Upload"])
app.include_router(chat.router,   prefix="/api/chat",   tags=["Chat"])
app.include_router(voice.router,  prefix="/api/voice",  tags=["Voice"])


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "models": {
        "stt": settings.STT_MODEL,
        "llm": settings.LLM_MODEL,
        "tts": settings.TTS_MODEL,
    }}


# ── Serve frontend static files ───────────────────────────────────────────────
# Must be mounted LAST so it doesn’t shadow any /api/* routes.
# Path: backend/app/main.py → ↑↑↑ repo root → frontend/
_FRONTEND_DIR = pathlib.Path(__file__).parent.parent.parent / "frontend"
if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
