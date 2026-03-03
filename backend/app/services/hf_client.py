"""
Base async HTTP client for the HuggingFace Inference API.
All model-specific services build on top of this.
"""
import httpx
import asyncio
import logging
from typing import Any, Dict, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class HFClient:
    """Thin async wrapper around the HuggingFace Inference API."""

    def __init__(self):
        self.base_url = settings.HF_API_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {settings.HF_API_TOKEN}",
            "Content-Type": "application/json",
        }
        # Shared async client (reuse connection pool)
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def post_json(
        self,
        model_id: str,
        payload: Dict[str, Any],
        wait_for_model: bool = True,
    ) -> Any:
        """POST a JSON payload to a HF model endpoint and return parsed JSON."""
        url = f"{self.base_url}/{model_id}"
        params = {"wait_for_model": "true"} if wait_for_model else {}

        response = await self.client.post(
            url, headers=self.headers, json=payload, params=params
        )
        response.raise_for_status()
        return response.json()

    async def post_binary(
        self,
        model_id: str,
        data: bytes,
        content_type: str = "audio/wav",
        wait_for_model: bool = True,
    ) -> bytes:
        """POST raw binary data (e.g. audio) and return raw bytes response."""
        url = f"{self.base_url}/{model_id}"
        headers = {
            "Authorization": f"Bearer {settings.HF_API_TOKEN}",
            "Content-Type": content_type,
        }
        params = {"wait_for_model": "true"} if wait_for_model else {}

        response = await self.client.post(
            url, headers=headers, content=data, params=params
        )
        response.raise_for_status()
        return response.content

    async def post_json_get_binary(
        self,
        model_id: str,
        payload: Dict[str, Any],
        wait_for_model: bool = True,
    ) -> bytes:
        """POST JSON payload and expect a binary (audio) response (e.g. TTS)."""
        url = f"{self.base_url}/{model_id}"
        params = {"wait_for_model": "true"} if wait_for_model else {}

        response = await self.client.post(
            url, headers=self.headers, json=payload, params=params
        )
        response.raise_for_status()
        return response.content

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()


# Singleton instance
hf_client = HFClient()
