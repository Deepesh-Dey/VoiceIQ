"""
LLM service using mistralai/Mistral-7B-Instruct-v0.3 on HuggingFace.

Uses HuggingFace's OpenAI-compatible chat completions endpoint for
clean message formatting and streaming-friendly responses.
"""
import logging
import re
import httpx
from typing import List, Dict, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _strip_markdown(text: str) -> str:
    """Remove common Markdown formatting so text reads naturally as speech."""
    # Remove headers (##, ###, etc.)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    # Remove bold/italic (**text**, *text*, __text__, _text_)
    text = re.sub(r'\*{1,2}(.+?)\*{1,2}', r'\1', text)
    text = re.sub(r'_{1,2}(.+?)_{1,2}', r'\1', text)
    # Remove inline code `...`
    text = re.sub(r'`(.+?)`', r'\1', text)
    # Remove list bullet/number prefixes
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    # Remove horizontal rules
    text = re.sub(r'^[-*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    # Collapse multiple blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# Global HF router – provider is auto-selected per model
# Correct URL: https://router.huggingface.co/v1/chat/completions
HF_ROUTER_CHAT_URL = "https://router.huggingface.co/v1/chat/completions"

SYSTEM_PROMPT = """You are an intelligent business data analyst assistant.
You have been provided with the client's business data below.
Answer questions clearly and concisely based on this data.
When the data does not contain enough information, say so honestly.
Keep your spoken responses natural – avoid bullet points or markdown formatting
since your reply will be converted to speech.

--- BUSINESS DATA CONTEXT ---
{context}
--- END CONTEXT ---
"""


async def generate_reply(
    user_message: str,
    history: List[Dict[str, str]],
    business_context: str,
) -> str:
    """
    Send a chat message to the LLM with full conversation history
    and the business data context baked into the system prompt.

    Args:
        user_message:      The latest user message to respond to.
        history:           Previous turns [{"role": ..., "content": ...}, ...].
        business_context:  Compressed text representation of uploaded business data.

    Returns:
        The assistant's reply as a plain text string.
    """
    system_content = SYSTEM_PROMPT.format(
        context=business_context[:settings.MAX_CONTEXT_CHARS]
        if business_context
        else "No business data uploaded yet. Help the user upload their data files."
    )

    messages = [{"role": "system", "content": system_content}]
    # Append prior turns (cap at last 10 to stay within context window)
    messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_message})

    headers = {
        "Authorization": f"Bearer {settings.HF_API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "max_tokens": 512,
        "temperature": 0.7,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(HF_ROUTER_CHAT_URL, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

        raw_reply = data["choices"][0]["message"]["content"].strip()
        reply = _strip_markdown(raw_reply)
        logger.info(f"LLM reply ({len(reply)} chars): {reply[:80]}...")
        return reply

    except Exception as e:
        logger.error(f"LLM error: {e}")
        raise RuntimeError(f"LLM generation failed: {e}") from e
