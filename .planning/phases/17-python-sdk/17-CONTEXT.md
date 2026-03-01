# Phase 17: Python SDK - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

A `govynai` pip package with drop-in wrapper classes (`GovynOpenAI`, `GovynAsyncOpenAI`, `GovynAnthropic`, `GovynAsyncAnthropic`) that subclass the official upstream SDKs, point at the Govyn proxy, inject agent headers, and surface typed governance errors. Users replace `openai.OpenAI()` with `GovynOpenAI(agent_id=...)` and all existing code works unchanged with governance enforced through the proxy.

</domain>

<decisions>
## Implementation Decisions

### Error Interception Strategy
- Catch upstream SDK exceptions: let the upstream SDK raise its own `RateLimitError`/`APIStatusError` on 429, then catch it, inspect the response body for the Govyn error envelope, and re-raise as `GovynBudgetExceededError` or `GovynLoopDetectedError`
- If the 429 body doesn't match the Govyn envelope format, re-raise the original upstream exception unchanged — no wrapping, no transformation
- Error interception must work for both regular and streaming calls (proxy sends 429 before any SSE chunks, so the initial response status is checkable in both paths)

### Error Hierarchy
- Independent exception hierarchy: `GovynError(Exception)` base class, with `GovynBudgetExceededError(GovynError)` and `GovynLoopDetectedError(GovynError)` as subclasses
- Exceptions are provider-agnostic — the same `GovynBudgetExceededError` is raised whether the call went through OpenAI or Anthropic wrappers
- Both exception types expose parsed `details` fields as properties (e.g., `error.limit_type`, `error.cooldown_seconds`) per the SDK spec

### Import Ergonomics
- Flat top-level imports: `from govynai import GovynOpenAI, GovynBudgetExceededError, check_proxy`
- Everything importable from the package root — no submodule paths required
- `__all__` in `__init__.py` lists all public symbols

### Lazy Provider Imports
- Import `openai`/`anthropic` only when `GovynOpenAI`/`GovynAnthropic` is instantiated, not at module import time
- If the upstream SDK isn't installed, raise `ImportError` with a clear message: `pip install govynai[openai]`
- This pairs with optional extras in the dependency strategy

### Docstrings
- Docstrings on wrapper classes (`GovynOpenAI`, `GovynAnthropic`, etc.) and `check_proxy()`
- Constructor parameters documented in class docstrings
- Error classes get a one-liner
- Internal helpers skip docstrings

### Typing
- Full type annotations on all public APIs
- `py.typed` marker included in the package
- Users get autocomplete and strict type checker support on all Govyn symbols

### Claude's Discretion
- Package location (`python-sdk/` vs other) and build system configuration
- Python version range for `requires-python`
- Dependency pinning strategy (extras vs required for upstream SDKs)
- Root `pyproject.toml` handling
- Test framework, mock library, and CI matrix choices
- Internal module organization (how files are split within the package)
- `check_proxy()` implementation details

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sdk-spec.md`: Canonical specification defining all constants, URL construction, constructor params, error codes, and naming conventions — the single source of truth
- Root `pyproject.toml`: Placeholder package config (empty packages, setuptools) — may need coordination with the new python-sdk/ package

### Established Patterns
- Proxy error envelope format verified in `src/proxy.ts` and `src/server.ts` — all governance errors use HTTP 429 with `{error: {type, code, message, details}}` structure
- Three error codes for v1.3: `budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected`
- `retry-after` header included on all 429 responses

### Integration Points
- Proxy routes: `/v1/openai` (OpenAI) and `/v1/anthropic` (Anthropic) — SDK constructs `base_url` from these
- Health endpoint: `GET /health` returns `{status: "ok", version, uptime_seconds}`
- Agent identification: `X-Govyn-Agent` header injected via `default_headers` constructor parameter
- API key: `govyn-passthrough` placeholder for passthrough mode, `gvn_*` scoped keys for key-storage mode

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-python-sdk*
*Context gathered: 2026-03-01*
