"""Health check utilities for verifying Govyn proxy connectivity."""

from __future__ import annotations

import os

import httpx

from ._constants import DEFAULT_PROXY_URL, ENV_PROXY_URL, HEALTH_ENDPOINT


def check_proxy(proxy_url: str | None = None, *, timeout: float = 5.0) -> bool:
    """Check if the Govyn proxy is reachable and healthy.

    Args:
        proxy_url: Proxy URL to check. Defaults to GOVYN_PROXY_URL env var
            or http://localhost:4000.
        timeout: Request timeout in seconds. Defaults to 5.0.

    Returns:
        True if proxy responds with {"status": "ok"}, False otherwise.
    """
    url = proxy_url or os.environ.get(ENV_PROXY_URL) or DEFAULT_PROXY_URL
    try:
        resp = httpx.get(
            f"{url.rstrip('/')}{HEALTH_ENDPOINT}",
            timeout=timeout,
        )
        return resp.status_code == 200 and resp.json().get("status") == "ok"
    except Exception:
        return False


async def async_check_proxy(
    proxy_url: str | None = None, *, timeout: float = 5.0
) -> bool:
    """Async version of check_proxy."""
    url = proxy_url or os.environ.get(ENV_PROXY_URL) or DEFAULT_PROXY_URL
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{url.rstrip('/')}{HEALTH_ENDPOINT}",
                timeout=timeout,
            )
            return resp.status_code == 200 and resp.json().get("status") == "ok"
    except Exception:
        return False
