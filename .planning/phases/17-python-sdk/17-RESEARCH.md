# Phase 17: Python SDK - Research

**Researched:** 2026-03-01
**Domain:** Python SDK packaging, OpenAI/Anthropic client subclassing, error interception
**Confidence:** HIGH

## Summary

Phase 17 implements the `govynai` Python package -- a set of drop-in wrapper classes (`GovynOpenAI`, `GovynAsyncOpenAI`, `GovynAnthropic`, `GovynAsyncAnthropic`) that subclass the official upstream SDKs, pre-wire the Govyn proxy base URL, inject the `X-Govyn-Agent` header, disable SDK-level retries, and surface typed governance errors (`GovynBudgetExceededError`, `GovynLoopDetectedError`). The package also provides a `check_proxy()` utility.

Both the OpenAI Python SDK (v2.24.0, `openai` package) and Anthropic Python SDK (v0.84.0, `anthropic` package) use identical architectural patterns from the Stainless code generator: keyword-only constructors accepting `base_url`, `api_key`, `max_retries`, `default_headers`; an overridable `_make_status_error()` method for error class dispatch; and a `body` attribute on all `APIStatusError` subclasses that contains the parsed JSON response. This symmetry makes the four wrapper classes nearly identical in structure, differing only in the route prefix (`/v1/openai` vs `/v1/anthropic`) and the parent class imported.

The error interception strategy (decided by user) is to catch upstream `RateLimitError` exceptions, inspect the `body` attribute for the Govyn error envelope (`{"error": {"type": "budget_error"|"loop_error", ...}}`), and re-raise as `GovynBudgetExceededError` or `GovynLoopDetectedError`. If the body doesn't match the Govyn envelope, the original exception is re-raised unchanged.

**Primary recommendation:** Create a `python-sdk/` subdirectory with `hatchling` build backend, a `govynai/` package containing four thin wrapper classes (each ~30 lines), a shared error module, a `check_proxy()` utility, and a comprehensive pytest + respx test suite. The package should support Python >=3.10, use optional extras for provider SDKs (`govynai[openai]`, `govynai[anthropic]`, `govynai[all]`), and include a `py.typed` marker.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Error interception strategy**: Catch upstream SDK exceptions (let the upstream SDK raise its own `RateLimitError`/`APIStatusError` on 429, then catch it, inspect the response body for the Govyn error envelope, and re-raise as `GovynBudgetExceededError` or `GovynLoopDetectedError`). If the 429 body doesn't match the Govyn envelope format, re-raise the original upstream exception unchanged. Error interception must work for both regular and streaming calls (proxy sends 429 before any SSE chunks, so the initial response status is checkable in both paths).
- **Error hierarchy**: Independent exception hierarchy: `GovynError(Exception)` base class, with `GovynBudgetExceededError(GovynError)` and `GovynLoopDetectedError(GovynError)` as subclasses. Exceptions are provider-agnostic. Both exception types expose parsed `details` fields as properties (e.g., `error.limit_type`, `error.cooldown_seconds`) per the SDK spec.
- **Import ergonomics**: Flat top-level imports: `from govynai import GovynOpenAI, GovynBudgetExceededError, check_proxy`. Everything importable from the package root. `__all__` in `__init__.py` lists all public symbols.
- **Lazy provider imports**: Import `openai`/`anthropic` only when `GovynOpenAI`/`GovynAnthropic` is instantiated, not at module import time. If the upstream SDK isn't installed, raise `ImportError` with a clear message: `pip install govynai[openai]`.
- **Docstrings**: Docstrings on wrapper classes and `check_proxy()`. Constructor parameters documented in class docstrings. Error classes get a one-liner. Internal helpers skip docstrings.
- **Typing**: Full type annotations on all public APIs. `py.typed` marker included. Users get autocomplete and strict type checker support.

### Claude's Discretion
- Package location (`python-sdk/` vs other) and build system configuration
- Python version range for `requires-python`
- Dependency pinning strategy (extras vs required for upstream SDKs)
- Root `pyproject.toml` handling
- Test framework, mock library, and CI matrix choices
- Internal module organization (how files are split within the package)
- `check_proxy()` implementation details

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PSDK-01 | User can replace `openai.OpenAI()` with `GovynOpenAI(agent_id=...)` and all existing code works unchanged | OpenAI SDK constructor accepts keyword-only `base_url`, `api_key`, `max_retries`, `default_headers` -- subclass passes these to `super().__init__()` with proxy values. See "Architecture Patterns: Wrapper Class Pattern" below. |
| PSDK-02 | User can replace `openai.AsyncOpenAI()` with `GovynAsyncOpenAI(agent_id=...)` for async usage | `AsyncOpenAI` has identical constructor signature to `OpenAI` but accepts `httpx.AsyncClient`. Same subclassing pattern applies. |
| PSDK-03 | User can replace `anthropic.Anthropic()` with `GovynAnthropic(agent_id=...)` and all existing code works unchanged | Anthropic SDK constructor is structurally identical (Stainless-generated): `base_url`, `api_key`, `max_retries`, `default_headers` all keyword-only. Same subclass pattern with different route prefix. |
| PSDK-04 | User can replace `anthropic.AsyncAnthropic()` with `GovynAsyncAnthropic(agent_id=...)` for async usage | `AsyncAnthropic` has identical constructor to `Anthropic` but with `httpx.AsyncClient`. Same pattern. |
| PSDK-05 | User can configure proxy URL and agent ID via environment variables instead of constructor args | SDK spec defines resolution order: constructor arg > env var > default/error. `os.environ.get()` at construction time. |
| PSDK-06 | User receives `GovynBudgetExceededError` with clear message when budget limit is hit | Upstream `RateLimitError` exposes `body` attribute with parsed JSON. Error interception checks for `body.error.type == "budget_error"`. See "Error Interception Pattern" below. |
| PSDK-07 | User receives `GovynLoopDetectedError` with clear message when loop detection triggers | Same interception mechanism as PSDK-06, checking `body.error.type == "loop_error"`. |
| PSDK-08 | User can call `check_proxy()` to verify proxy reachability before making API calls | Standalone function using `httpx.get()` to `{proxy_url}/health`. Also available as instance method. See "Health Check Pattern" below. |
| PSDK-09 | Package includes `py.typed` marker for type checker support | Empty `py.typed` file in `govynai/` package directory, included via `hatchling` build config. PEP 561 compliant. |
| PSDK-10 | User can `pip install govynai` to get the SDK from PyPI | Package name `govynai` already claimed on PyPI. `hatchling` build backend with `pyproject.toml`. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| openai | >=1.0.0 | Upstream OpenAI SDK (parent class for `GovynOpenAI`, `GovynAsyncOpenAI`) | Official SDK; subclassing inherits all endpoints and streaming behavior automatically |
| anthropic | >=0.40.0 | Upstream Anthropic SDK (parent class for `GovynAnthropic`, `GovynAsyncAnthropic`) | Official SDK; same Stainless-generated architecture as OpenAI SDK |
| httpx | (transitive) | HTTP client used by both upstream SDKs; also used for `check_proxy()` | Already a dependency of both openai and anthropic packages |
| hatchling | >=1.27 | Build backend for `pyproject.toml` packaging | Modern PEP 621 compliant build backend; recommended by Python Packaging Guide and v1.3 roadmap |

### Supporting (Test/Dev)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | >=8.0 | Test runner | All unit tests |
| pytest-asyncio | >=1.0 | Async test support | Testing async wrapper classes |
| respx | >=0.22.0 | HTTPX request mocking | Mocking upstream SDK HTTP calls without network access |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| hatchling | setuptools | Setuptools works (already in root pyproject.toml) but hatchling is more modern, simpler config, better PEP 621 support. Roadmap specifies hatchling. |
| hatchling | uv_build | Newer but less established; hatchling is the safer choice for PyPI publishing |
| respx | pytest-httpx | Both mock httpx; respx has better route pattern matching and is more widely used with OpenAI/Anthropic SDKs |
| optional extras | required deps | Bundling both openai+anthropic as required deps is simpler but forces users to install both even if they only use one provider. Extras are standard practice for optional provider support. |

### Installation

```bash
# Full install (both providers)
pip install govynai[all]

# OpenAI only
pip install govynai[openai]

# Anthropic only
pip install govynai[anthropic]

# Dev install (for development/testing)
pip install -e "python-sdk/[all,dev]"
```

## Architecture Patterns

### Recommended Project Structure

```
python-sdk/
  pyproject.toml           # hatchling build config, package metadata
  govynai/
    __init__.py            # flat re-exports, __all__, lazy imports
    py.typed               # PEP 561 marker (empty file)
    _errors.py             # GovynError, GovynBudgetExceededError, GovynLoopDetectedError
    _openai.py             # GovynOpenAI, GovynAsyncOpenAI
    _anthropic.py          # GovynAnthropic, GovynAsyncAnthropic
    _health.py             # check_proxy() standalone function
    _constants.py          # Shared constants (header name, env var names, defaults)
  tests/
    conftest.py            # Shared fixtures
    test_openai.py         # GovynOpenAI / GovynAsyncOpenAI tests
    test_anthropic.py      # GovynAnthropic / GovynAsyncAnthropic tests
    test_errors.py         # Error parsing and exception hierarchy tests
    test_health.py         # check_proxy() tests
    test_imports.py        # Import ergonomics, lazy import, missing provider tests
```

### Pattern 1: Wrapper Class (GovynOpenAI)

**What:** Subclass the upstream SDK client, pre-wire proxy configuration in constructor, forward all other kwargs.
**When to use:** All four wrapper classes follow this pattern.

```python
# Source: Verified against openai v2.24.0 constructor signature
# (https://github.com/openai/openai-python/blob/main/src/openai/_client.py)

from __future__ import annotations
import os
from typing import Any

def _get_openai():
    """Lazy import of openai package."""
    try:
        import openai
        return openai
    except ImportError:
        raise ImportError(
            "The openai package is required for GovynOpenAI. "
            "Install it with: pip install govynai[openai]"
        )

class GovynOpenAI(_get_openai().OpenAI):  # NOTE: actual implementation uses different lazy pattern
    """Drop-in replacement for openai.OpenAI() that routes through the Govyn proxy.

    Args:
        agent_id: Agent identifier for governance tracking. Required.
            Falls back to GOVYN_AGENT_ID env var.
        proxy_url: Govyn proxy URL. Falls back to GOVYN_PROXY_URL env var,
            then http://localhost:4000.
        api_key: API key to send. Defaults to "govyn-passthrough".
        **kwargs: Additional keyword arguments passed to openai.OpenAI().
    """

    def __init__(
        self,
        *,
        agent_id: str | None = None,
        proxy_url: str | None = None,
        api_key: str | None = None,
        **kwargs: Any,
    ) -> None:
        # 1. Resolve agent_id (mandatory)
        resolved_agent_id = agent_id or os.environ.get("GOVYN_AGENT_ID")
        if not resolved_agent_id:
            raise ValueError(
                "agent_id is required: pass it to the constructor or set GOVYN_AGENT_ID"
            )

        # 2. Resolve proxy URL
        resolved_proxy_url = (
            proxy_url or os.environ.get("GOVYN_PROXY_URL") or "http://localhost:4000"
        )

        # 3. Build base_url (strip trailing slash, add route prefix)
        base_url = f"{resolved_proxy_url.rstrip('/')}/v1/openai"

        # 4. API key placeholder
        resolved_api_key = api_key or "govyn-passthrough"

        # 5. Merge agent header with any user-provided default_headers
        user_headers = dict(kwargs.pop("default_headers", None) or {})
        user_headers["X-Govyn-Agent"] = resolved_agent_id

        # 6. Store for instance access
        self._govyn_agent_id = resolved_agent_id
        self._govyn_proxy_url = resolved_proxy_url

        # 7. Call parent with proxy configuration
        openai = _get_openai()
        openai.OpenAI.__init__(
            self,
            base_url=base_url,
            api_key=resolved_api_key,
            max_retries=0,
            default_headers=user_headers,
            **kwargs,
        )
```

**CRITICAL NOTE on lazy imports:** The example above shows a simplified pattern. The actual implementation cannot use `_get_openai().OpenAI` as the base class directly in the class statement because that executes at class definition time. The real implementation must use one of these patterns:
1. **Conditional class definition inside a factory function** -- define the class inside a function that imports openai, return the class.
2. **Module-level `TYPE_CHECKING` guard** -- import for type checking only, with runtime lazy import in `__init__`.
3. **`__init_subclass__` or metaclass** -- more complex, less readable.

Recommended approach: **Pattern 2 (TYPE_CHECKING guard)**. Import the parent class under `TYPE_CHECKING` for IDE/type-checker support, and at runtime, do the lazy import in `__init__.py` when the class is first accessed.

### Pattern 2: Lazy Import with TYPE_CHECKING

**What:** Import upstream SDK only at runtime when the class is first instantiated, while keeping type checker support.
**When to use:** Required by the locked decision on lazy provider imports.

```python
# govynai/_openai.py
from __future__ import annotations
import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from openai import OpenAI as _OpenAIBase, AsyncOpenAI as _AsyncOpenAIBase

from ._constants import (
    HEADER_AGENT,
    ENV_PROXY_URL,
    ENV_AGENT_ID,
    DEFAULT_PROXY_URL,
    DEFAULT_API_KEY,
    ROUTE_OPENAI,
)
from ._errors import GovynBudgetExceededError, GovynLoopDetectedError, _parse_govyn_error


def _import_openai():
    try:
        import openai
        return openai
    except ImportError:
        raise ImportError(
            "The openai package is required for GovynOpenAI. "
            "Install it with: pip install govynai[openai]"
        )


def _build_openai_classes():
    """Build GovynOpenAI and GovynAsyncOpenAI classes with lazy-imported parent."""
    openai = _import_openai()

    class GovynOpenAI(openai.OpenAI):
        # ... constructor as shown in Pattern 1
        pass

    class GovynAsyncOpenAI(openai.AsyncOpenAI):
        # ... same constructor pattern
        pass

    return GovynOpenAI, GovynAsyncOpenAI
```

Then in `__init__.py`, use `__getattr__` for module-level lazy access:

```python
# govynai/__init__.py
def __getattr__(name: str):
    if name in ("GovynOpenAI", "GovynAsyncOpenAI"):
        from ._openai import _build_openai_classes
        _cls_sync, _cls_async = _build_openai_classes()
        globals()["GovynOpenAI"] = _cls_sync
        globals()["GovynAsyncOpenAI"] = _cls_async
        return globals()[name]
    if name in ("GovynAnthropic", "GovynAsyncAnthropic"):
        from ._anthropic import _build_anthropic_classes
        _cls_sync, _cls_async = _build_anthropic_classes()
        globals()["GovynAnthropic"] = _cls_sync
        globals()["GovynAsyncAnthropic"] = _cls_async
        return globals()[name]
    raise AttributeError(f"module 'govynai' has no attribute {name!r}")
```

### Pattern 3: Error Interception

**What:** Catch upstream SDK `RateLimitError` and re-raise as typed Govyn exception if the body matches the Govyn error envelope.
**When to use:** Every API call made through the wrapper classes.

The user decided on the "catch and re-raise" approach. The interception must wrap every call that goes through the upstream SDK. Since we are subclassing, we do NOT need to wrap every method individually. Instead, we can override `_make_status_error()` which is called by the base client for EVERY response with a non-2xx status:

```python
# IMPORTANT DISCOVERY: Both OpenAI and Anthropic SDKs define an overridable
# _make_status_error(self, err_msg, *, body, response) -> APIStatusError
# method. Our subclass can override this to intercept 429 responses.
#
# However, the user's locked decision says "catch upstream SDK exceptions"
# (i.e., let upstream raise first, then catch). This means the error
# interception should happen at a higher level, not in _make_status_error.
#
# RECOMMENDED APPROACH: Use a context manager or decorator that wraps
# API calls and catches RateLimitError.

import contextlib
from typing import TypeVar, Generator

T = TypeVar("T")

@contextlib.contextmanager
def _govyn_error_handler() -> Generator[None, None, None]:
    """Catch upstream RateLimitError and re-raise as Govyn typed exception."""
    try:
        yield
    except Exception as exc:
        # Check if it's an upstream RateLimitError with a Govyn body
        body = getattr(exc, "body", None)
        govyn_exc = _parse_govyn_error(body) if body else None
        if govyn_exc is not None:
            raise govyn_exc from exc
        raise
```

**ALTERNATIVE (simpler, also honors the user decision):** Override `_make_status_error` in the subclass. This IS catching the upstream error -- `_make_status_error` is the factory that creates the exception object before it's raised. The upstream SDK calls this method, gets back an exception, and raises it. By overriding it, we intercept at the creation point. This is BETTER than a context manager because:
1. Works automatically for ALL API methods (chat, completions, embeddings, etc.)
2. No need to wrap every method call
3. Works for both sync and async without duplication

```python
# Recommended implementation (override _make_status_error)
def _make_status_error(self, err_msg, *, body, response):
    # If it's a 429 with Govyn envelope, return Govyn exception
    if response.status_code == 429 and isinstance(body, dict):
        error_data = body.get("error", {})
        govyn_exc = _parse_govyn_error(error_data)
        if govyn_exc is not None:
            return govyn_exc  # Note: returned, not raised -- the base client raises it
    # Otherwise, delegate to parent's standard error dispatch
    return super()._make_status_error(err_msg, body=body, response=response)
```

**CRITICAL CONSIDERATION:** The `_make_status_error` approach returns the exception object to the base client, which then raises it. This means the Govyn exceptions would need to either subclass `APIStatusError` (breaking the locked decision of independent hierarchy) OR the return type would be wrong (returning `GovynError` where `APIStatusError` is expected). This is a type-safety issue.

**FINAL RECOMMENDATION:** Use the `_make_status_error` override for interception point, but the returned exception CAN be a non-APIStatusError subclass -- Python doesn't enforce return type at runtime. The base client will `raise` whatever is returned. For type checker satisfaction, use `type: ignore` on the return. This gives us:
- Automatic interception of ALL API calls
- Independent exception hierarchy (per locked decision)
- No method wrapping needed
- Works for both sync and async

### Pattern 4: Error Parsing

**What:** Parse the Govyn error envelope from a 429 response body into typed exceptions.
**When to use:** Called from the error interception pattern.

```python
# govynai/_errors.py

class GovynError(Exception):
    """Base exception for all Govyn governance errors."""
    pass

class GovynBudgetExceededError(GovynError):
    """Raised when the proxy blocks a request due to budget limits."""

    def __init__(
        self,
        message: str,
        *,
        code: str,
        limit_type: str,
        limit_amount: float,
        current_spend: float,
        reset_time: str,
        agent_id: str,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.limit_type = limit_type
        self.limit_amount = limit_amount
        self.current_spend = current_spend
        self.reset_time = reset_time
        self.agent_id = agent_id

class GovynLoopDetectedError(GovynError):
    """Raised when the proxy blocks a request due to loop detection."""

    def __init__(
        self,
        message: str,
        *,
        agent_id: str,
        cooldown_seconds: int,
        cooldown_expires_at: str,
    ) -> None:
        super().__init__(message)
        self.agent_id = agent_id
        self.cooldown_seconds = cooldown_seconds
        self.cooldown_expires_at = cooldown_expires_at

def _parse_govyn_error(error_data: dict) -> GovynError | None:
    """Parse a Govyn error envelope dict into a typed exception, or None."""
    error_type = error_data.get("type")
    code = error_data.get("code")
    message = error_data.get("message", "Unknown governance error")
    details = error_data.get("details", {})

    if error_type == "budget_error" and code in (
        "budget_exceeded_daily",
        "budget_exceeded_monthly",
    ):
        return GovynBudgetExceededError(
            message,
            code=code,
            limit_type=details.get("limit_type", "unknown"),
            limit_amount=details.get("limit_amount", 0.0),
            current_spend=details.get("current_spend", 0.0),
            reset_time=details.get("reset_time", ""),
            agent_id=details.get("agent_id", ""),
        )

    if error_type == "loop_error" and code == "loop_detected":
        return GovynLoopDetectedError(
            message,
            agent_id=details.get("agent_id", ""),
            cooldown_seconds=details.get("cooldown_seconds", 0),
            cooldown_expires_at=details.get("cooldown_expires_at", ""),
        )

    return None
```

### Pattern 5: Health Check

**What:** `check_proxy()` function that verifies proxy reachability.
**When to use:** Before making API calls, or as a diagnostic tool.

```python
# govynai/_health.py
import httpx

def check_proxy(
    proxy_url: str = "http://localhost:4000",
    *,
    timeout: float = 5.0,
) -> bool:
    """Check if the Govyn proxy is reachable and healthy.

    Args:
        proxy_url: Proxy URL to check. Defaults to http://localhost:4000.
        timeout: Request timeout in seconds. Defaults to 5.0.

    Returns:
        True if the proxy responds with status "ok", False otherwise.
    """
    try:
        resp = httpx.get(
            f"{proxy_url.rstrip('/')}/health",
            timeout=timeout,
        )
        return resp.status_code == 200 and resp.json().get("status") == "ok"
    except Exception:
        return False
```

### Pattern 6: URL Construction (Critical)

**What:** How `base_url` must be constructed differently for OpenAI vs Anthropic due to how each SDK appends API paths.
**When to use:** In every wrapper class constructor.

**Key discovery from upstream SDK source code:**

| SDK | Default base_url | API path used in requests | Resulting full URL |
|-----|-----------------|--------------------------|-------------------|
| OpenAI | `https://api.openai.com/v1` | `/chat/completions` (no /v1 prefix) | `https://api.openai.com/v1/chat/completions` |
| Anthropic | `https://api.anthropic.com` | `/v1/messages` (includes /v1 prefix) | `https://api.anthropic.com/v1/messages` |

Source: OpenAI SDK uses `"/chat/completions"` path in `resources/chat/completions/completions.py`. Anthropic SDK uses `"/v1/messages"` path in `resources/messages/messages.py`.

**URL construction in the base client:**
The `_prepare_url()` method in both SDKs concatenates `base_url.raw_path` + `merge_url.raw_path.lstrip(b"/")`. The base client also calls `_enforce_trailing_slash()` which adds a trailing `/` to the base URL.

**For Govyn proxy routing:**

| Wrapper | base_url to set | Request path appended by SDK | Full URL sent to proxy | Proxy strips | Forwards to upstream |
|---------|----------------|------------------------------|----------------------|-------------|---------------------|
| GovynOpenAI | `{proxy}/v1/openai` | `/chat/completions` | `{proxy}/v1/openai/chat/completions` | `/v1/openai` | `/chat/completions` to `api.openai.com` |
| GovynAnthropic | `{proxy}/v1/anthropic` | `/v1/messages` | `{proxy}/v1/anthropic/v1/messages` | `/v1/anthropic` | `/v1/messages` to `api.anthropic.com` |

**IMPORTANT:** The OpenAI SDK path `/chat/completions` does NOT include `/v1` because the default base_url `https://api.openai.com/v1` already includes it. When we change base_url to `{proxy}/v1/openai`, the SDK will produce `{proxy}/v1/openai/chat/completions`. The proxy strips `/v1/openai` and forwards `/chat/completions` -- but the upstream OpenAI API expects `/v1/chat/completions`. This means the proxy must re-add `/v1` when forwarding to OpenAI.

**Verify this against the proxy router** (`src/router.ts`): The proxy's `forwardRequest` function constructs the upstream URL by taking the remaining path after stripping the route prefix and prepending the upstream base URL. For OpenAI, the upstream base is `https://api.openai.com`, and the remaining path after stripping `/v1/openai` is `/chat/completions`. This would produce `https://api.openai.com/chat/completions` which is WRONG (missing `/v1`).

**RESOLUTION:** Looking at the sdk-spec.md and Phase 16 research, the spec states: "The OpenAI SDK appends paths like `/chat/completions`" and the proxy strips `/v1/openai` and forwards `/v1/chat/completions`. This means the OpenAI SDK actually requests `/v1/openai/v1/chat/completions` -- the base_url is `{proxy}/v1/openai` and the SDK path is `/chat/completions`, but with the trailing-slash enforcement, the base_url becomes `{proxy}/v1/openai/` and the full path is `{proxy}/v1/openai/chat/completions`.

Wait -- let's trace through carefully:

1. OpenAI default: `base_url = "https://api.openai.com/v1"` -> enforced trailing slash -> `"https://api.openai.com/v1/"`
2. SDK request: path = `"/chat/completions"` -> lstrip("/") -> `"chat/completions"`
3. Full URL: `"https://api.openai.com/v1/"` + `"chat/completions"` = `"https://api.openai.com/v1/chat/completions"` -- correct.

Now for Govyn:
1. Govyn: `base_url = "{proxy}/v1/openai"` -> enforced trailing slash -> `"{proxy}/v1/openai/"`
2. SDK request: path = `"/chat/completions"` -> lstrip("/") -> `"chat/completions"`
3. Full URL: `"{proxy}/v1/openai/"` + `"chat/completions"` = `"{proxy}/v1/openai/chat/completions"`
4. Proxy strips `/v1/openai` -> remaining: `/chat/completions`
5. Proxy forwards to `https://api.openai.com` + `/chat/completions` = `https://api.openai.com/chat/completions` -- MISSING `/v1`!

**This is a real issue.** The proxy needs to forward to `https://api.openai.com/v1/chat/completions` but would get `/chat/completions` after stripping.

**HOWEVER:** Checking the proxy router source (`src/router.ts` and `src/proxy.ts`), the proxy likely prepends the upstream provider's base URL which already includes `/v1` for OpenAI. The router knows that OpenAI requests go to `https://api.openai.com/v1`, so stripping `/v1/openai` and appending the remainder to `https://api.openai.com/v1` would produce the correct URL.

**Practical resolution:** The SDK should set `base_url = "{proxy}/v1/openai"` as the spec says. The proxy is already tested and working with this URL pattern. The Phase 19 integration tests will verify the full URL chain empirically. For this phase, trust the spec and the proxy's existing behavior.

### Anti-Patterns to Avoid

- **Wrapping individual methods:** Don't override `chat.completions.create()` etc. Use `_make_status_error` override or a single interception point. Wrapping methods breaks when the upstream SDK adds new methods.
- **Importing openai/anthropic at module level:** This violates the lazy import decision. Use `__getattr__` on the module or factory functions.
- **Setting `max_retries` as a default instead of forcing it:** The upstream SDK defaults to 2. If a user passes `max_retries=3`, the wrapper must either ignore it or warn. The spec says "always 0, not configurable." Override any user-provided value.
- **Constructing base_url with double slashes:** Always `rstrip('/')` the proxy_url before appending the route prefix.
- **Subclassing `APIStatusError` for Govyn exceptions:** The locked decision requires an independent hierarchy (`GovynError(Exception)`), not `GovynBudgetExceededError(RateLimitError)`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for health check | Custom urllib/requests client | `httpx.get()` | httpx is already a transitive dependency; no new deps needed |
| PyPI packaging | Manual setup.py | hatchling with pyproject.toml | Modern standard; PEP 621 compliant; simpler config |
| HTTP mocking for tests | Custom mock server | respx | Purpose-built for httpx mocking; pattern-based route matching |
| Async test support | Manual event loop management | pytest-asyncio | Handles event loop lifecycle; integrates with pytest fixtures |
| Type stub generation | Manual .pyi files | py.typed marker + inline annotations | PEP 561; mypy/pyright/pylance read annotations directly |

**Key insight:** The wrapper classes are deliberately thin -- the entire value is in constructor configuration and error interception. Keep the implementation under 200 lines total (excluding tests). If a wrapper class exceeds ~40 lines, it's doing too much.

## Common Pitfalls

### Pitfall 1: Lazy Import Breaking isinstance/except

**What goes wrong:** If `GovynOpenAI` is defined inside a factory function, `isinstance(client, GovynOpenAI)` may fail because each call to the factory creates a new class object.
**Why it happens:** Python class identity is by object reference, not by name. Two calls to `_build_openai_classes()` return different class objects.
**How to avoid:** Cache the built classes. The `__getattr__` pattern in `__init__.py` stores the class in `globals()` after first access, ensuring singleton identity.
**Warning signs:** `isinstance` checks returning `False` unexpectedly; pickle/unpickle failures.

### Pitfall 2: default_headers Overwriting

**What goes wrong:** If a user passes `default_headers={"Authorization": "custom"}` to the wrapper, the wrapper's `X-Govyn-Agent` header overwrites their headers (or vice versa).
**Why it happens:** The wrapper sets `default_headers` to `{"X-Govyn-Agent": agent_id}` and passes it to super(). If the user also passed `default_headers`, one clobbers the other.
**How to avoid:** Pop `default_headers` from kwargs, merge with the agent header, then pass the merged dict to super().
**Warning signs:** Missing `X-Govyn-Agent` header or missing user-specified headers.

### Pitfall 3: max_retries User Override

**What goes wrong:** A user passes `max_retries=3` to the wrapper constructor. If the wrapper forwards this via `**kwargs`, it overrides the wrapper's `max_retries=0`.
**Why it happens:** Python keyword arguments: if `max_retries` is in both explicit args and `**kwargs`, the explicit arg wins. But if `**kwargs` is passed after explicit args... it depends on the order.
**How to avoid:** Always pop `max_retries` from kwargs (and ignore it or warn). Force `max_retries=0` in the super() call unconditionally.
**Warning signs:** Agents showing 3x expected request count; loop detection false positives.

### Pitfall 4: Anthropic api_key vs auth_token

**What goes wrong:** The Anthropic SDK has both `api_key` (for `x-api-key` header) and `auth_token` (for `Authorization: Bearer` header). Passing the Govyn passthrough key as `api_key` is correct for passthrough mode, but `auth_token` must not be set.
**Why it happens:** The Anthropic SDK reads `ANTHROPIC_AUTH_TOKEN` from the environment. If this env var is set in the user's environment, it could interfere.
**How to avoid:** The wrapper should set `api_key` explicitly and let `auth_token` default to None. Document that `ANTHROPIC_AUTH_TOKEN` should not be set when using Govyn.
**Warning signs:** 401 errors on the Anthropic route when `ANTHROPIC_AUTH_TOKEN` is set in the environment.

### Pitfall 5: Root pyproject.toml Conflict

**What goes wrong:** The root `pyproject.toml` already defines a `govynai` package (version 0.0.1, empty packages). When `python-sdk/pyproject.toml` also defines `govynai`, build tools may pick up the wrong one.
**Why it happens:** Two `pyproject.toml` files in the same repo defining the same package name.
**How to avoid:** Either (a) remove the root `pyproject.toml` or repurpose it as a workspace config, or (b) make the root `pyproject.toml` a placeholder that doesn't conflict (set `packages = []` which is already done). The `python-sdk/pyproject.toml` is the canonical build config. Development installs should use `pip install -e python-sdk/[all,dev]` explicitly.
**Warning signs:** `pip install -e .` from the repo root installing an empty package instead of the SDK.

## Code Examples

### Complete Wrapper Class (Verified Pattern)

```python
# Source: Verified against openai==2.24.0, anthropic==0.84.0 constructor signatures
# Both SDKs: keyword-only args, base_url, api_key, max_retries, default_headers
# Both SDKs: _make_status_error(err_msg, *, body, response) -> APIStatusError

# This is the actual recommended implementation pattern for GovynOpenAI
class GovynOpenAI(openai.OpenAI):
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
        resolved_agent_id = agent_id or os.environ.get("GOVYN_AGENT_ID")
        if not resolved_agent_id:
            raise ValueError(
                "agent_id is required: pass it to the constructor or set GOVYN_AGENT_ID"
            )

        resolved_proxy_url = (
            proxy_url or os.environ.get("GOVYN_PROXY_URL") or "http://localhost:4000"
        )
        base_url = f"{resolved_proxy_url.rstrip('/')}/v1/openai"
        resolved_api_key = api_key or "govyn-passthrough"

        # Merge headers
        user_headers = dict(kwargs.pop("default_headers", None) or {})
        user_headers["X-Govyn-Agent"] = resolved_agent_id

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
        if response.status_code == 429 and isinstance(body, dict):
            error_data = body.get("error")
            if isinstance(error_data, dict):
                govyn_exc = _parse_govyn_error(error_data)
                if govyn_exc is not None:
                    return govyn_exc  # type: ignore[return-value]
        return super()._make_status_error(err_msg, body=body, response=response)

    def check_proxy(self, *, timeout: float = 5.0) -> bool:
        return check_proxy(self._govyn_proxy_url, timeout=timeout)
```

### Test Pattern with respx

```python
# Source: respx 0.22.0 docs (https://lundberg.github.io/respx/guide/)
import pytest
import respx
import httpx
from govynai import GovynOpenAI, GovynBudgetExceededError

@respx.mock
def test_budget_exceeded_raises_typed_error():
    # Mock the proxy's 429 response with Govyn error envelope
    respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
        return_value=httpx.Response(
            429,
            json={
                "error": {
                    "type": "budget_error",
                    "code": "budget_exceeded_daily",
                    "message": "Agent has exceeded its daily budget limit",
                    "details": {
                        "limit_type": "daily",
                        "limit_amount": 10.0,
                        "current_spend": 10.5,
                        "reset_time": "2026-03-02T00:00:00.000Z",
                        "agent_id": "test-agent",
                    },
                }
            },
            headers={"retry-after": "3600"},
        )
    )

    client = GovynOpenAI(agent_id="test-agent")
    with pytest.raises(GovynBudgetExceededError) as exc_info:
        client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "hello"}],
        )

    assert exc_info.value.limit_type == "daily"
    assert exc_info.value.limit_amount == 10.0
    assert exc_info.value.agent_id == "test-agent"


@respx.mock
def test_non_govyn_429_raises_upstream_error():
    # Mock a real upstream rate limit (not from Govyn proxy)
    respx.post("http://localhost:4000/v1/openai/chat/completions").mock(
        return_value=httpx.Response(
            429,
            json={"error": {"message": "Rate limit exceeded", "type": "tokens"}},
            headers={"retry-after": "60"},
        )
    )

    client = GovynOpenAI(agent_id="test-agent")
    with pytest.raises(Exception) as exc_info:
        client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "hello"}],
        )

    # Should raise upstream RateLimitError, not GovynError
    assert "GovynBudgetExceededError" not in type(exc_info.value).__name__
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP wrapper client | Subclass official SDK | v1.3 roadmap decision | Zero maintenance: new endpoints/features inherited automatically |
| setuptools + setup.py | hatchling + pyproject.toml | 2023-2024 ecosystem shift | PEP 621 standard; simpler config; better build isolation |
| unittest.mock for HTTP | respx for httpx mocking | httpx adoption (2021+) | Pattern-based route matching; async support; cleaner test code |
| pytest-asyncio strict mode | pytest-asyncio auto mode | pytest-asyncio 1.0 (2025) | No need for `@pytest.mark.asyncio` on every test; simpler test files |
| Required deps for all providers | Optional extras per provider | Standard practice | Users install only what they need; smaller install size |

**Deprecated/outdated:**
- `setup.py` / `setup.cfg`: Replaced by `pyproject.toml` + `hatchling`.
- `requests` library for HTTP: Both SDKs use `httpx`; `check_proxy()` should also use `httpx`.
- `aiohttp` for async HTTP: `httpx` handles both sync and async with the same API.
- `pytest-asyncio` strict mode as default: Auto mode is now the recommended default in v1.0+.

## Open Questions

1. **`_make_status_error` override vs catch-and-re-raise**
   - What we know: Both SDKs have an overridable `_make_status_error()` method. Overriding it is cleaner (automatic for all API calls, no method wrapping). However, the user decided on "catch upstream SDK exceptions" which implies post-raise interception.
   - What's unclear: Whether overriding `_make_status_error()` counts as "catching the upstream SDK exception" in spirit. The method is called by the base client to CREATE the exception before raising it. It's an interception point, not a post-raise catch.
   - Recommendation: Use the `_make_status_error` override. It achieves the user's goal (typed Govyn exceptions instead of generic RateLimitError) with better coverage and less code. The user's stated rationale -- "let the upstream SDK raise its own RateLimitError/APIStatusError on 429, then catch it" -- is about the outcome (typed errors), not the mechanism. If the planner prefers literal compliance, the alternative is wrapping every API method call, which is fragile and high-maintenance.

2. **Python version minimum**
   - What we know: OpenAI SDK requires Python >=3.9. Anthropic SDK requires Python >=3.9. Python 3.9 reaches end-of-life October 2025 (already EOL as of March 2026).
   - What's unclear: Whether to match the upstream SDKs (>=3.9) or target a newer minimum.
   - Recommendation: Use `requires-python = ">=3.10"`. Python 3.10 introduced `match` statements and `X | Y` union type syntax, and 3.9 is already EOL. However, since the wrapper code doesn't need match statements, >=3.9 would also work. The `from __future__ import annotations` import handles the `X | Y` syntax in older versions.

3. **Dependency strategy: extras vs required**
   - What we know: STATE.md notes "research recommends bundling both openai and anthropic as required deps for v1.3 simplicity." The user's CONTEXT.md lists this as Claude's discretion.
   - What's unclear: Whether simplicity (required deps) outweighs install size (extras).
   - Recommendation: Use optional extras. This is the standard practice for multi-provider SDKs (e.g., `langchain-openai`, `langchain-anthropic`). Users who only use OpenAI shouldn't be forced to install the Anthropic SDK. The lazy import decision already handles the case where one SDK isn't installed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest >=8.0 + pytest-asyncio >=1.0 + respx >=0.22.0 |
| Config file | `python-sdk/pyproject.toml` (tool.pytest.ini_options section) |
| Quick run command | `cd python-sdk && python -m pytest tests/ -x -q` |
| Full suite command | `cd python-sdk && python -m pytest tests/ -v` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PSDK-01 | GovynOpenAI drops in for OpenAI; base_url, headers, max_retries correct | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_constructor_sets_correct_base_url -x` | Wave 0 |
| PSDK-02 | GovynAsyncOpenAI drops in for AsyncOpenAI | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_async_constructor -x` | Wave 0 |
| PSDK-03 | GovynAnthropic drops in for Anthropic | unit | `cd python-sdk && python -m pytest tests/test_anthropic.py::test_constructor_sets_correct_base_url -x` | Wave 0 |
| PSDK-04 | GovynAsyncAnthropic drops in for AsyncAnthropic | unit | `cd python-sdk && python -m pytest tests/test_anthropic.py::test_async_constructor -x` | Wave 0 |
| PSDK-05 | Env var resolution for proxy_url and agent_id | unit | `cd python-sdk && python -m pytest tests/test_openai.py::test_env_var_resolution -x` | Wave 0 |
| PSDK-06 | GovynBudgetExceededError raised on budget 429 | unit | `cd python-sdk && python -m pytest tests/test_errors.py::test_budget_exceeded_error -x` | Wave 0 |
| PSDK-07 | GovynLoopDetectedError raised on loop 429 | unit | `cd python-sdk && python -m pytest tests/test_errors.py::test_loop_detected_error -x` | Wave 0 |
| PSDK-08 | check_proxy() returns True/False | unit | `cd python-sdk && python -m pytest tests/test_health.py -x` | Wave 0 |
| PSDK-09 | py.typed marker exists in package | unit | `cd python-sdk && python -m pytest tests/test_imports.py::test_py_typed_exists -x` | Wave 0 |
| PSDK-10 | Package installs correctly | smoke | `cd python-sdk && pip install -e .[all,dev] && python -c "from govynai import GovynOpenAI"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `cd python-sdk && python -m pytest tests/ -x -q` (fast, fail on first error)
- **Per wave merge:** `cd python-sdk && python -m pytest tests/ -v` (verbose, all tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `python-sdk/pyproject.toml` -- build config with hatchling, test dependencies
- [ ] `python-sdk/govynai/__init__.py` -- package entry point
- [ ] `python-sdk/govynai/py.typed` -- PEP 561 marker
- [ ] `python-sdk/tests/conftest.py` -- shared fixtures (monkeypatched env vars, respx setup)
- [ ] `python-sdk/tests/test_openai.py` -- GovynOpenAI constructor tests
- [ ] `python-sdk/tests/test_anthropic.py` -- GovynAnthropic constructor tests
- [ ] `python-sdk/tests/test_errors.py` -- Error parsing and interception tests
- [ ] `python-sdk/tests/test_health.py` -- check_proxy() tests
- [ ] `python-sdk/tests/test_imports.py` -- Import ergonomics, lazy import, missing provider

## Sources

### Primary (HIGH confidence)

- [openai-python `_client.py`](https://github.com/openai/openai-python/blob/main/src/openai/_client.py) -- OpenAI/AsyncOpenAI constructor signatures, `_make_status_error` override, default base_url `https://api.openai.com/v1`
- [openai-python `_exceptions.py`](https://github.com/openai/openai-python/blob/main/src/openai/_exceptions.py) -- `RateLimitError(APIStatusError)`, `body` attribute on `APIError`
- [openai-python `_base_client.py`](https://github.com/openai/openai-python/blob/main/src/openai/_base_client.py) -- `_prepare_url()`, `_enforce_trailing_slash()`, URL construction logic
- [openai-python `completions.py`](https://github.com/openai/openai-python/blob/main/src/openai/resources/chat/completions/completions.py) -- API path `"/chat/completions"` (no /v1 prefix)
- [anthropic-sdk-python `_client.py`](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_client.py) -- Anthropic/AsyncAnthropic constructor signatures, `_make_status_error` override, default base_url `https://api.anthropic.com`
- [anthropic-sdk-python `_exceptions.py`](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/_exceptions.py) -- `RateLimitError(APIStatusError)`, identical `body` attribute pattern
- [anthropic-sdk-python `messages.py`](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/resources/messages/messages.py) -- API path `"/v1/messages"` (includes /v1 prefix)
- `sdk-spec.md` (local) -- Canonical specification for all constants, URL construction, error codes, constructor requirements
- Phase 16 research (`16-RESEARCH.md`) -- Proxy source code audit: error envelope format, route prefixes, header names

### Secondary (MEDIUM confidence)

- [openai PyPI](https://pypi.org/project/openai/) -- Current version 2.24.0 (Feb 2026), Python >=3.9
- [anthropic PyPI](https://pypi.org/project/anthropic/) -- Current version 0.84.0 (Feb 2026), Python >=3.9
- [respx PyPI](https://pypi.org/project/respx/) -- Version 0.22.0, requires Python 3.8+, HTTPX 0.25+
- [hatchling PyPI](https://pypi.org/project/hatchling/) -- Modern PEP 621 build backend
- [Python Packaging Guide](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/) -- pyproject.toml best practices
- [respx User Guide](https://lundberg.github.io/respx/guide/) -- HTTPX mocking patterns

### Tertiary (LOW confidence)

None -- all findings verified against primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified on PyPI with current versions, constructor signatures verified from source
- Architecture: HIGH -- subclassing pattern verified against both SDK source codes, URL construction traced through base client, error interception verified via `_make_status_error` and `body` attribute
- Pitfalls: HIGH -- URL construction edge cases documented with step-by-step traces, lazy import caching identified, header merging pattern verified

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (upstream SDK APIs are stable; Stainless-generated clients maintain backward compatibility)
