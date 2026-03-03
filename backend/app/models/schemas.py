from pydantic import BaseModel
from typing import Optional, List, Dict, Any


# ─── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    session_id: str
    filename: str
    rows: int
    columns: List[str]
    preview: List[Dict[str, Any]]
    message: str


# ─── Chat ─────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str          # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    session_id: str
    message: str
    history: Optional[List[ChatMessage]] = []


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    history: List[ChatMessage]


# ─── Voice ─────────────────────────────────────────────────────────────────────

class VoiceTranscriptEvent(BaseModel):
    type: str = "transcript"
    text: str


class VoiceReplyEvent(BaseModel):
    type: str = "reply"
    text: str


class VoiceErrorEvent(BaseModel):
    type: str = "error"
    message: str


class VoiceAudioEvent(BaseModel):
    type: str = "audio_ready"
    message: str = "audio chunk is being streamed"
