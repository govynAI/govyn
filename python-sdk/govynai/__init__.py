"""Govyn AI governance proxy SDK."""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = [
    "GovynOpenAI",
    "GovynAsyncOpenAI",
    "GovynAnthropic",
    "GovynAsyncAnthropic",
    "GovynError",
    "GovynBudgetExceededError",
    "GovynLoopDetectedError",
    "check_proxy",
    "async_check_proxy",
]

# Eager imports -- always available
from ._errors import GovynBudgetExceededError, GovynError, GovynLoopDetectedError


def __getattr__(name: str):
    if name in ("GovynOpenAI", "GovynAsyncOpenAI"):
        from ._openai import _get_classes

        sync_cls, async_cls = _get_classes()
        globals()["GovynOpenAI"] = sync_cls
        globals()["GovynAsyncOpenAI"] = async_cls
        return globals()[name]

    if name in ("GovynAnthropic", "GovynAsyncAnthropic"):
        from ._anthropic import _get_classes

        sync_cls, async_cls = _get_classes()
        globals()["GovynAnthropic"] = sync_cls
        globals()["GovynAsyncAnthropic"] = async_cls
        return globals()[name]

    if name == "check_proxy":
        from ._health import check_proxy

        globals()["check_proxy"] = check_proxy
        return check_proxy

    if name == "async_check_proxy":
        from ._health import async_check_proxy

        globals()["async_check_proxy"] = async_check_proxy
        return async_check_proxy

    raise AttributeError(f"module 'govynai' has no attribute {name!r}")
