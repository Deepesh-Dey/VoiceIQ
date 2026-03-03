from fastapi import APIRouter, HTTPException
import logging

from app.services.llm_service import generate_reply
from app.services.data_processor import get_context
from app.models.schemas import ChatRequest, ChatResponse, ChatMessage

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Text-based chat endpoint.

    Accepts a user message + conversation history + session_id,
    injects the stored business data context, and returns the LLM reply.
    This endpoint is used when the user types instead of speaking.
    """
    context = get_context(request.session_id)

    history_dicts = [
        {"role": m.role, "content": m.content} for m in request.history
    ]

    try:
        reply_text = await generate_reply(
            user_message=request.message,
            history=history_dicts,
            business_context=context,
        )
    except RuntimeError as e:
        logger.error(f"Chat LLM error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

    # Build updated history
    updated_history = list(request.history) + [
        ChatMessage(role="user", content=request.message),
        ChatMessage(role="assistant", content=reply_text),
    ]

    return ChatResponse(
        session_id=request.session_id,
        reply=reply_text,
        history=updated_history,
    )
