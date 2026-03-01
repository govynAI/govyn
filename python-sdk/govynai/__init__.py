"""govynai - Python SDK for the Govyn AI agent governance proxy."""

from __future__ import annotations

from ._errors import GovynBudgetExceededError, GovynError, GovynLoopDetectedError

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
]


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
        from ._health import check_proxy as _check_proxy

        globals()["check_proxy"] = _check_proxy
        return _check_proxy

    raise AttributeError(f"module 'govynai' has no attribute {name!r}")
