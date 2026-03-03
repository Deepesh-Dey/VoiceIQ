"""
Voice WebSocket route.

Protocol (low-latency bidirectional):
  Client → Server  TEXT   : {"type":"init","session_id":"<uuid>"}
  Client → Server  BINARY : raw WAV/WebM audio bytes (one utterance at a time)
  Server → Client  TEXT   : {"type":"transcript","text":"..."}   ← STT result
  Server → Client  TEXT   : {"type":"reply","text":"..."}        ← LLM reply
  Server → Client  TEXT   : {"type":"audio_start"}               ← audio incoming
  Server → Client  BINARY : raw WAV audio bytes                  ← TTS audio
  Server → Client  TEXT   : {"type":"audio_done"}                ← audio complete
  Server → Client  TEXT   : {"type":"error","message":"..."}     ← on failure

The VAD runs entirely in the browser (client-side), so each binary message
received here is already one complete utterance. This keeps latency minimal.
"""
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.services.stt_service import transcribe_audio
from app.services.llm_service import generate_reply
from app.services.data_processor import get_context

router = APIRouter()
logger = logging.getLogger(__name__)


async def _send_json(ws: WebSocket, data: dict):
    if ws.client_state == WebSocketState.CONNECTED:
        await ws.send_text(json.dumps(data))


async def _send_bytes(ws: WebSocket, data: bytes):
    if ws.client_state == WebSocketState.CONNECTED:
        await ws.send_bytes(data)


@router.websocket("/ws")
async def voice_ws(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice conversation.

    One WebSocket connection = one ongoing conversation session.
    Conversation history is maintained for the lifetime of the connection.
    """
    await websocket.accept()
    logger.info("Voice WebSocket connected.")

    session_id: str = ""
    conversation_history: list = []

    try:
        # ── Receive messages in a loop ────────────────────────────────────────
        while True:
            message = await websocket.receive()

            # ── TEXT frame (control / init messages) ─────────────────────────
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    await _send_json(websocket, {"type": "error", "message": "Invalid JSON control message."})
                    continue

                msg_type = data.get("type", "")

                if msg_type == "init":
                    session_id = data.get("session_id", "")
                    context = get_context(session_id)
                    await _send_json(websocket, {
                        "type": "ready",
                        "message": "Session initialised. Start speaking.",
                        "has_data": bool(context),
                    })
                    logger.info(f"Voice session initialised: {session_id}")

                elif msg_type == "ping":
                    await _send_json(websocket, {"type": "pong"})

                else:
                    await _send_json(websocket, {"type": "error", "message": f"Unknown message type: {msg_type}"})

            # ── BINARY frame (audio utterance from VAD) ───────────────────────
            elif "bytes" in message:
                audio_bytes: bytes = message["bytes"]

                if not audio_bytes:
                    continue

                # 1. Speech → Text  (browser sends WAV from voiceInterface.js)
                try:
                    transcript = await transcribe_audio(audio_bytes, content_type="audio/wav")
                except RuntimeError as e:
                    await _send_json(websocket, {"type": "error", "message": str(e)})
                    continue

                if not transcript:
                    await _send_json(websocket, {"type": "transcript", "text": "[inaudible]"})
                    continue

                await _send_json(websocket, {"type": "transcript", "text": transcript})

                # 2. Text → LLM reply
                context = get_context(session_id) if session_id else ""
                try:
                    reply_text = await generate_reply(
                        user_message=transcript,
                        history=conversation_history[-10:],
                        business_context=context,
                    )
                except RuntimeError as e:
                    await _send_json(websocket, {"type": "error", "message": str(e)})
                    continue

                await _send_json(websocket, {"type": "reply", "text": reply_text})

                # Save to history
                conversation_history.append({"role": "user", "content": transcript})
                conversation_history.append({"role": "assistant", "content": reply_text})

                # TTS is handled client-side via browser Web Speech API.
                # Signal completion immediately so the frontend re-arms the VAD.
                await _send_json(websocket, {"type": "audio_done"})

    except WebSocketDisconnect:
        logger.info(f"Voice WebSocket disconnected (session: {session_id})")
    except Exception as e:
        logger.error(f"Voice WebSocket error: {e}")
        try:
            await _send_json(websocket, {"type": "error", "message": "Internal server error."})
        except Exception:
            pass
