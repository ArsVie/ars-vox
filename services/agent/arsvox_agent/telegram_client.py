"""Telegram client. One approved chat (config.telegram.chat_id), preview-
then-confirm flow enforced by the policy engine. Mock mode records the
send locally without touching the network."""

import logging
import random
from abc import ABC, abstractmethod

import httpx

from arsvox_contracts import AppConfig

log = logging.getLogger(__name__)

API_BASE = "https://api.telegram.org"


class TelegramClient(ABC):
    name = "abstract"

    @abstractmethod
    async def send(self, chat_id: str, text: str) -> dict: ...


class MockTelegramClient(TelegramClient):
    """Simulated send: returns a fake update and leaves the audit trail."""

    name = "mock"

    async def send(self, chat_id: str, text: str) -> dict:
        log.info("telegram[mock] -> %s: %s", chat_id, text[:80])
        return {"ok": True, "mock": True, "message_id": random.randint(1, 10**7), "chat_id": chat_id}


class HttpTelegramClient(TelegramClient):
    def __init__(self, token: str):
        self.token = token

    async def send(self, chat_id: str, text: str) -> dict:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{API_BASE}/bot{self.token}/sendMessage",
                json={"chat_id": chat_id, "text": text},
            )
            resp.raise_for_status()
            return resp.json()


def build_telegram(config: AppConfig) -> TelegramClient:
    if config.telegram.mock:
        return MockTelegramClient()
    import os

    token = os.environ.get(config.telegram.token_env, "")
    if not token:
        log.warning(
            "telegram mock disabled but %s not set — falling back to mock",
            config.telegram.token_env,
        )
        return MockTelegramClient()
    return HttpTelegramClient(token)
