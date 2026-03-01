"""GovynOpenAI and GovynAsyncOpenAI wrapper classes.

Drop-in replacements for openai.OpenAI and openai.AsyncOpenAI that route
through the Govyn proxy with automatic agent identification, retry disabling,
and governance error interception.
"""

from __future__ import annotations

import os
from typing import Any

from ._constants import (
    DEFAULT_API_KEY,
    DEFAULT_PROXY_URL,
    ENV_AGENT_ID,
    ENV_PROXY_URL,
    HEADER_AGENT,
    ROUTE_OPENAI,
)
from ._errors import _parse_govyn_error


def _import_openai():
    try:
        import openai

        return openai
    except ImportError:
        raise ImportError(
            "The openai package is required for GovynOpenAI. "
            "Install it with: pip install govynai[openai]"
        ) from None


def _resolve_params(
    agent_id: str | None,
    proxy_url: str | None,
    api_key: str | None,
) -> tuple[str, str, str]:
    """Resolve constructor params per sdk-spec.md section 5."""
    resolved_agent_id = agent_id or os.environ.get(ENV_AGENT_ID)
    if not resolved_agent_id:
        raise ValueError(
            "agent_id is required: pass it to the constructor or set GOVYN_AGENT_ID"
        )
    resolved_proxy_url = (
        proxy_url or os.environ.get(ENV_PROXY_URL) or DEFAULT_PROXY_URL
    )
    resolved_api_key = api_key or DEFAULT_API_KEY
    return resolved_agent_id, resolved_proxy_url, resolved_api_key


_cached_classes = None


def _get_classes():
    global _cached_classes
    if _cached_classes is not None:
        return _cached_classes

    openai = _import_openai()

    class GovynOpenAI(openai.OpenAI):
        """Drop-in replacement for openai.OpenAI() that routes through the Govyn proxy.

        Args:
            agent_id: Agent identifier for governance tracking. Required.
                Falls back to GOVYN_AGENT_ID env var.
            proxy_url: Govyn proxy URL. Falls back to GOVYN_PROXY_URL env var,
                then http://localhost:4000.
            api_key: API key to send. Defaults to "govyn-passthrough".
            **kwargs: Additional arguments passed to openai.OpenAI().
        """

        _govyn_agent_id: str
        _govyn_proxy_url: str

        def __init__(
            self,
            *,
            agent_id: str | None = None,
            proxy_url: str | None = None,
            api_key: str | None = None,
            **kwargs: Any,
        ) -> None:
            resolved_agent_id, resolved_proxy_url, resolved_api_key = (
                _resolve_params(agent_id, proxy_url, api_key)
            )
            base_url = f"{resolved_proxy_url.rstrip('/')}{ROUTE_OPENAI}"

            # Merge user headers with agent header
            user_headers = dict(kwargs.pop("default_headers", None) or {})
            user_headers[HEADER_AGENT] = resolved_agent_id

            # Force max_retries=0 regardless of user input
            kwargs.pop("max_retries", None)

            self._govyn_agent_id = resolved_agent_id
            self._govyn_proxy_url = resolved_proxy_url

            super().__init__(
                base_url=base_url,
                api_key=resolved_api_key,
                max_retries=0,
                default_headers=user_headers,
                **kwargs,
            )

        def _make_status_error(self, err_msg, *, body, response):
            """Override error dispatch to intercept Govyn governance errors."""
            if response.status_code == 429 and isinstance(body, dict):
                error_data = body.get("error")
                if isinstance(error_data, dict):
                    govyn_exc = _parse_govyn_error(error_data)
                    if govyn_exc is not None:
                        return govyn_exc  # type: ignore[return-value]
            return super()._make_status_error(err_msg, body=body, response=response)

        def check_proxy(self, *, timeout: float = 5.0) -> bool:
            """Check if the Govyn proxy is reachable."""
            from ._health import check_proxy as _check

            return _check(self._govyn_proxy_url, timeout=timeout)

    class GovynAsyncOpenAI(openai.AsyncOpenAI):
        """Drop-in replacement for openai.AsyncOpenAI() that routes through the Govyn proxy.

        Args:
            agent_id: Agent identifier for governance tracking. Required.
                Falls back to GOVYN_AGENT_ID env var.
            proxy_url: Govyn proxy URL. Falls back to GOVYN_PROXY_URL env var,
                then http://localhost:4000.
            api_key: API key to send. Defaults to "govyn-passthrough".
            **kwargs: Additional arguments passed to openai.AsyncOpenAI().
        """

        _govyn_agent_id: str
        _govyn_proxy_url: str

        def __init__(
            self,
            *,
            agent_id: str | None = None,
            proxy_url: str | None = None,
            api_key: str | None = None,
            **kwargs: Any,
        ) -> None:
            resolved_agent_id, resolved_proxy_url, resolved_api_key = (
                _resolve_params(agent_id, proxy_url, api_key)
            )
            base_url = f"{resolved_proxy_url.rstrip('/')}{ROUTE_OPENAI}"

            user_headers = dict(kwargs.pop("default_headers", None) or {})
            user_headers[HEADER_AGENT] = resolved_agent_id

            kwargs.pop("max_retries", None)

            self._govyn_agent_id = resolved_agent_id
            self._govyn_proxy_url = resolved_proxy_url

            super().__init__(
                base_url=base_url,
                api_key=resolved_api_key,
                max_retries=0,
                default_headers=user_headers,
                **kwargs,
            )

        def _make_status_error(self, err_msg, *, body, response):
            """Override error dispatch to intercept Govyn governance errors."""
            if response.status_code == 429 and isinstance(body, dict):
                error_data = body.get("error")
                if isinstance(error_data, dict):
                    govyn_exc = _parse_govyn_error(error_data)
                    if govyn_exc is not None:
                        return govyn_exc  # type: ignore[return-value]
            return super()._make_status_error(err_msg, body=body, response=response)

        async def check_proxy(self, *, timeout: float = 5.0) -> bool:
            """Check if the Govyn proxy is reachable."""
            from ._health import async_check_proxy

            return await async_check_proxy(self._govyn_proxy_url, timeout=timeout)

    _cached_classes = (GovynOpenAI, GovynAsyncOpenAI)
    return _cached_classes
