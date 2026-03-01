# Phase 16: SDK Specification - Research

**Researched:** 2026-03-01
**Domain:** SDK specification design / cross-language contract documentation
**Confidence:** HIGH

## Summary

Phase 16 is a documentation-only phase: write a single `sdk-spec.md` file that serves as the canonical contract for both the Python SDK (Phase 17) and Node.js SDK (Phase 18). The spec must define every constant, convention, error format, and behavioral requirement so that both SDKs implement identical behavior without cross-referencing each other's code.

The Govyn proxy already implements all the conventions the spec must document. Research consisted of auditing the proxy source code (`src/agents.ts`, `src/server.ts`, `src/proxy.ts`, `src/budget-enforcer.ts`, `src/router.ts`, `src/types.ts`, `src/health.ts`) to extract the exact header names, error response shapes, error codes, URL routing patterns, and API key conventions already in production. No new libraries or external dependencies are needed.

**Primary recommendation:** Write `sdk-spec.md` by extracting existing conventions from the proxy source code, organized into sections that SDK implementers can read top-to-bottom: constants, URL construction, header injection, API key convention, constructor requirements, error response parsing, health check, and versioning.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SPEC-01 | Shared SDK spec defines header names (`X-Govyn-Agent`), env vars (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`), error codes, and URL conventions across both SDKs | All constants verified in proxy source: header in `src/agents.ts` line 30, error codes in `src/types.ts` lines 161-162, URL patterns in `src/router.ts` lines 16-18, env var names from roadmap decisions. See "Architecture Patterns" sections below for exact values. |
| SPEC-02 | Spec defines API key convention (placeholder `"govyn-passthrough"` vs scoped `gvn_*` keys) | API key pattern verified in `govyn.config.yaml` comments (lines 19-24 show `gvn_*` prefix), `src/agents.ts` shows bearer token lookup. Passthrough placeholder `"govyn-passthrough"` defined in roadmap decisions. See "API Key Convention" section below. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Markdown | N/A | Spec document format | Human-readable, version-controllable, GitHub-rendered |

### Supporting

No additional libraries needed. This is a pure documentation phase.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Markdown spec | OpenAPI/AsyncAPI schema | Over-engineered for 2 SDK implementations; markdown is sufficient and more readable |
| Single spec file | Multiple spec files per section | Unnecessary fragmentation; one file is easier to reference |

## Architecture Patterns

### Spec Document Structure

The `sdk-spec.md` document should be organized into the following sections, derived from proxy source analysis:

```
sdk-spec.md
  1. Version & Changelog
  2. Constants
     - Header names
     - Environment variables
     - Default values
  3. URL Construction
     - Base URL format
     - Provider path prefixes
  4. Header Injection
     - X-Govyn-Agent header
     - API key handling
  5. API Key Convention
     - Passthrough mode ("govyn-passthrough")
     - Key-storage mode (gvn_* keys)
  6. Constructor Requirements
     - agent_id mandatory
     - max_retries=0
     - base_url construction
  7. Error Response Parsing
     - Budget exceeded (daily/monthly)
     - Loop detected
     - Error envelope format
  8. Health Check
     - GET /health contract
  9. Behavioral Rules
     - No SDK-level retries
     - Streaming passthrough
```

### Pattern 1: Constants Table

**What:** A single table of all canonical constant values
**When to use:** Every SDK implementer references this as the source of truth

Verified constants from proxy source code:

| Constant | Value | Source |
|----------|-------|--------|
| Agent header name | `X-Govyn-Agent` | `src/agents.ts` line 30: `req.headers['x-govyn-agent']` |
| Proxy URL env var | `GOVYN_PROXY_URL` | Roadmap decision (not yet in proxy, SDK-side only) |
| Agent ID env var | `GOVYN_AGENT_ID` | Roadmap decision (not yet in proxy, SDK-side only) |
| Default proxy URL | `http://localhost:4000` | `govyn.config.yaml` line 3: `port: 4000` |
| OpenAI route prefix | `/v1/openai` | `src/router.ts` line 16: `const ROUTE_OPENAI = '/v1/openai'` |
| Anthropic route prefix | `/v1/anthropic` | `src/router.ts` line 17: `const ROUTE_ANTHROPIC = '/v1/anthropic'` |
| Health endpoint | `GET /health` | `src/server.ts` line 200 |
| Budget warning header | `X-Govyn-Budget-Warning` | `src/proxy.ts` line 305: `'x-govyn-budget-warning'` |
| Approval header | `X-Govyn-Approval` | `src/server.ts` line 508: `req.headers['x-govyn-approval']` |

### Pattern 2: URL Construction Formula

**What:** How SDKs must construct the base URL for upstream clients
**When to use:** Both SDKs must produce identical URL construction

For OpenAI SDK wrapper:
```
base_url = {GOVYN_PROXY_URL}/v1/openai
```
The OpenAI SDK appends paths like `/chat/completions` to the base_url, producing:
```
{GOVYN_PROXY_URL}/v1/openai/v1/chat/completions
```
The proxy router strips `/v1/openai` and forwards `/v1/chat/completions` to `https://api.openai.com`.

For Anthropic SDK wrapper:
```
base_url = {GOVYN_PROXY_URL}/v1/anthropic
```
The Anthropic SDK appends paths like `/v1/messages` to the base_url, producing:
```
{GOVYN_PROXY_URL}/v1/anthropic/v1/messages
```
The proxy router strips `/v1/anthropic` and forwards `/v1/messages` to `https://api.anthropic.com`.

**CRITICAL:** The exact base_url value depends on how each upstream SDK appends paths. The OpenAI Python SDK uses `base_url` as the root and appends `/chat/completions` (it strips a trailing `/v1` if present). The Anthropic Python SDK uses `base_url` as the root and appends `/v1/messages`. This path-construction behavior must be tested empirically for each SDK language and documented in the spec.

### Pattern 3: Error Response Envelope

**What:** The JSON error response format the proxy returns on governance blocks
**When to use:** SDKs parse these to raise typed exceptions

**Budget exceeded response** (from `src/server.ts` lines 403-419):
```json
{
  "error": {
    "type": "budget_error",
    "code": "budget_exceeded_daily",
    "message": "Agent has exceeded its daily budget limit",
    "details": {
      "limit_type": "daily",
      "limit_amount": 10.00,
      "current_spend": 10.50,
      "reset_time": "2026-03-02T00:00:00.000Z",
      "agent_id": "research-agent"
    }
  }
}
```
HTTP status: `429`
Headers: `retry-after: {seconds_until_reset}`

**Loop detected response** (from `src/proxy.ts` lines 91-109):
```json
{
  "error": {
    "type": "loop_error",
    "code": "loop_detected",
    "message": "Agent blocked: repeated identical requests detected",
    "details": {
      "agent_id": "research-agent",
      "cooldown_seconds": 300,
      "cooldown_expires_at": "2026-03-01T12:05:00.000Z"
    }
  }
}
```
HTTP status: `429`
Headers: `retry-after: {cooldown_seconds}`

### Pattern 4: API Key Convention

**What:** Two modes for API key handling, defined by what the SDK sends in the Authorization header
**When to use:** Spec must document both modes with guidance

**Passthrough mode** (recommended default):
- SDK sends `Authorization: Bearer govyn-passthrough` (or for Anthropic, `x-api-key: govyn-passthrough`)
- Proxy strips this placeholder and injects the real API key from its env var (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- Use when: The proxy holds all real API keys (recommended setup)

**Key-storage mode** (scoped keys):
- Operator generates scoped keys like `gvn_ra_xxxx` per agent
- SDK sends `Authorization: Bearer gvn_ra_xxxx`
- Proxy uses this to identify the agent (via `src/agents.ts` API key lookup) AND injects the real upstream API key
- Use when: Agent identity must be cryptographically tied to specific keys, not self-reported headers

The spec should note that when `X-Govyn-Agent` header is present, it takes priority over API-key-based identification (see `src/agents.ts` resolution order).

### Anti-Patterns to Avoid

- **Inventing new header names:** Use exactly `X-Govyn-Agent`, not `X-Agent-Id` or `Govyn-Agent`. The proxy reads `x-govyn-agent` (lowercased by Node.js HTTP parser).
- **Allowing SDK retries:** Setting `max_retries` to anything other than 0 causes the proxy to count each retry as a separate request, leading to double-billing and incorrect loop detection.
- **Hardcoding provider-specific paths:** The URL construction must account for how each upstream SDK appends paths. Hardcoding `/v1/chat/completions` in the wrapper defeats the purpose of being a drop-in replacement.
- **Silently defaulting agent_id:** If neither constructor arg nor env var provides agent_id, the SDK must raise an explicit error, not default to "unknown". This is a locked decision from the roadmap.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Error code parsing | Custom string matching | Structured enum/constant map from spec | Cross-language consistency requires a single source of truth |
| URL path construction | Manual string concatenation | Documented formula per provider per SDK | Path double-slash and missing-segment bugs are the #1 integration issue (per TEST-02) |
| Retry logic | Custom retry wrapper | `max_retries=0` in upstream SDK constructor | The proxy handles rate limiting; SDK retries cause double-billing |

**Key insight:** The spec is the "don't hand-roll" mechanism itself. Without it, each SDK implementer would reverse-engineer proxy behavior independently, producing subtle inconsistencies.

## Common Pitfalls

### Pitfall 1: URL Double-Slash Bug
**What goes wrong:** SDK produces `http://localhost:4000//v1/openai/v1/chat/completions` (double slash) or `http://localhost:4000/v1/openai/chat/completions` (missing `/v1` in upstream path).
**Why it happens:** The OpenAI SDK's `base_url` handling differs between Python and Node. The Python SDK strips a trailing `/v1` from `base_url` if present (treating it as a version prefix), while the Node SDK may not.
**How to avoid:** The spec must document the exact `base_url` value for each SDK language, verified by testing actual request URLs. Integration tests (TEST-02) specifically verify this.
**Warning signs:** HTTP 404 responses from the proxy or from the upstream API.

### Pitfall 2: Forgetting max_retries=0
**What goes wrong:** SDK retries a 429 response, and the proxy counts the retry as a new request. If the 429 was for budget exceeded, the retry also gets 429'd (wasted). If it was for rate limiting from upstream, the retry gets counted as a separate billable request.
**Why it happens:** Both OpenAI and Anthropic SDKs default to `max_retries=2`. A subclass that doesn't override this inherits the default.
**How to avoid:** Spec mandates `max_retries=0`. SDK constructors must set this before calling `super().__init__()`.
**Warning signs:** Agents showing 3x the expected request count in cost tracking.

### Pitfall 3: Inconsistent Error Code Strings
**What goes wrong:** Python SDK checks for `"budget_exceeded"` while Node SDK checks for `"budget_exceeded_daily"`. One raises the typed error, the other falls through to a generic error.
**Why it happens:** Error codes are strings, and without a spec, each implementer guesses the format.
**How to avoid:** Spec defines the exhaustive error code enum: `budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected`. Both SDKs parse these identically.
**Warning signs:** One SDK raises typed governance errors while the other raises generic HTTP errors for the same proxy response.

### Pitfall 4: Anthropic API Key Header Difference
**What goes wrong:** SDK sends `Authorization: Bearer ...` to the Anthropic route, but Anthropic uses `x-api-key` not `Authorization`.
**Why it happens:** OpenAI and Anthropic use different authentication header conventions.
**How to avoid:** The spec must note that the proxy's header mapping handles this (see `src/providers/anthropic.ts` line 67: sets `x-api-key`). The SDK wrapper just needs to pass the placeholder key in whatever format the upstream SDK expects.
**Warning signs:** 401 errors on the Anthropic route despite working OpenAI route.

### Pitfall 5: Missing Agent ID Validation
**What goes wrong:** SDK silently starts with agent_id="unknown" because no env var or constructor arg was provided.
**Why it happens:** Developer forgets to set `GOVYN_AGENT_ID` and the SDK doesn't error.
**How to avoid:** Spec mandates: raise `ValueError` (Python) or `Error` (Node) if `agent_id` is not provided via constructor or env var. This is a locked roadmap decision.
**Warning signs:** All requests attributed to "unknown" agent in cost tracking.

## Code Examples

### Error Parsing Logic (Pseudocode)

The spec should define the canonical error parsing algorithm that both SDKs implement:

```
# Source: src/server.ts lines 403-419, src/proxy.ts lines 91-109

function parseGovynError(httpStatus, responseBody):
  if httpStatus != 429:
    return null  # not a governance error

  parsed = JSON.parse(responseBody)
  error = parsed.error
  if not error:
    return null  # not a Govyn error envelope

  code = error.code
  type = error.type

  if type == "budget_error" and code in ["budget_exceeded_daily", "budget_exceeded_monthly"]:
    return BudgetExceededError(
      message=error.message,
      code=code,
      limit_type=error.details.limit_type,
      limit_amount=error.details.limit_amount,
      current_spend=error.details.current_spend,
      reset_time=error.details.reset_time,
      agent_id=error.details.agent_id,
    )

  if type == "loop_error" and code == "loop_detected":
    return LoopDetectedError(
      message=error.message,
      agent_id=error.details.agent_id,
      cooldown_seconds=error.details.cooldown_seconds,
      cooldown_expires_at=error.details.cooldown_expires_at,
    )

  return null  # unknown governance error — pass through as-is
```

### Health Check Contract

```
# Source: src/health.ts

GET /health -> 200
{
  "status": "ok",
  "version": "0.0.1",
  "uptime_seconds": 123
}
```

SDKs implement `check_proxy()` / `checkProxy()` that hits this endpoint and returns a success/failure indication.

### Constructor Requirements (Pseudocode)

```
# Source: Roadmap decisions, verified against upstream SDK defaults

class GovynOpenAI(OpenAI):
  def __init__(self, agent_id=None, proxy_url=None, api_key=None, **kwargs):
    # 1. Resolve agent_id (constructor > env var > error)
    agent_id = agent_id or env("GOVYN_AGENT_ID")
    if not agent_id:
      raise ValueError("agent_id is required")

    # 2. Resolve proxy URL
    proxy_url = proxy_url or env("GOVYN_PROXY_URL") or "http://localhost:4000"

    # 3. Build base_url (provider-specific path)
    base_url = f"{proxy_url}/v1/openai"

    # 4. API key placeholder
    api_key = api_key or "govyn-passthrough"

    # 5. Inject agent header
    default_headers = {"X-Govyn-Agent": agent_id}

    # 6. Force no retries
    super().__init__(
      base_url=base_url,
      api_key=api_key,
      max_retries=0,
      default_headers=default_headers,
      **kwargs
    )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SDK wraps HTTP client | SDK subclasses official client | v1.3 roadmap decision | Zero maintenance: upstream SDK additions (new endpoints, streaming improvements) are inherited automatically |
| Agent ID optional | Agent ID mandatory | v1.3 roadmap decision | Prevents "unknown" agent attribution; clear errors at construction time |
| SDK retries by default | max_retries=0 mandatory | v1.3 roadmap decision | Prevents double-billing and loop detection false positives |

**Deprecated/outdated:**
- Wrapper pattern (creating a new HTTP client that mimics the OpenAI/Anthropic SDK interface): replaced by subclassing for zero maintenance overhead.

## Open Questions

1. **Exact base_url value per SDK per language**
   - What we know: The proxy routes are `/v1/openai/*` and `/v1/anthropic/*`. Each upstream SDK appends API paths differently.
   - What's unclear: The exact `base_url` string that produces correct paths for each of the 4 SDK variants (OpenAI Python, OpenAI Node, Anthropic Python, Anthropic Node). The OpenAI Python SDK may strip a trailing `/v1` from the base_url.
   - Recommendation: The spec should document the formula (`{proxy_url}/v1/{provider}`) and note that each SDK plan (Phase 17, Phase 18) must verify the exact value empirically. The spec defines the intent; the implementation plans validate the URL.

2. **Budget warning header surfacing**
   - What we know: The proxy sends `X-Govyn-Budget-Warning` with JSON payload on responses when budget is approaching limits.
   - What's unclear: Whether the v1.3 SDKs should surface this header (it's listed as a future requirement ASDK-02).
   - Recommendation: Spec should document the header exists and its format, but mark SDK surfacing as "future" per the deferred decision in the roadmap.

3. **Policy denied error (403)**
   - What we know: The proxy returns HTTP 403 with `type: "govyn_policy_violation"` when a policy blocks a request (see `src/server.ts` lines 577-598).
   - What's unclear: Whether the v1.3 SDKs should have a `GovynPolicyDeniedError`. It's listed as future requirement ASDK-01.
   - Recommendation: Spec should document the 403 error format for completeness but mark the typed exception as "future". v1.3 SDKs should pass 403 responses through as-is.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.0.4 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPEC-01 | Spec document contains header names, env vars, error codes, URL conventions | manual-only | Visual review of `sdk-spec.md` | N/A |
| SPEC-02 | Spec document defines API key convention (passthrough vs scoped) | manual-only | Visual review of `sdk-spec.md` | N/A |

**Justification for manual-only:** SPEC-01 and SPEC-02 are documentation requirements. The output is a markdown file, not executable code. Verification is achieved by reviewing the document against the success criteria checklist. The downstream SDK phases (17, 18) and integration test phase (19) provide the automated validation that the spec is correct and complete.

### Sampling Rate
- **Per task commit:** N/A (documentation only)
- **Per wave merge:** N/A
- **Phase gate:** Manual checklist review of `sdk-spec.md` against success criteria

### Wave 0 Gaps
None -- no test infrastructure needed for a documentation-only phase.

## Sources

### Primary (HIGH confidence)
- `src/agents.ts` -- X-Govyn-Agent header name, agent resolution priority order
- `src/server.ts` -- budget exceeded error response format (lines 403-419), CORS headers, routing
- `src/proxy.ts` -- loop detected error response format (lines 85-109), budget warning header
- `src/types.ts` -- BudgetCheckResult.code enum values (line 161)
- `src/router.ts` -- URL route prefixes /v1/openai, /v1/anthropic (lines 16-18)
- `src/health.ts` -- GET /health response contract
- `src/providers/openai.ts` -- OpenAI header mapping, X-Govyn-Agent forwarding
- `src/providers/anthropic.ts` -- Anthropic header mapping, x-api-key vs Authorization
- `govyn.config.yaml` -- default port 4000, gvn_* API key prefix in comments
- `.planning/milestones/v1.3-ROADMAP.md` -- locked decisions (subclass, max_retries=0, agent_id required)
- `.planning/REQUIREMENTS.md` -- SPEC-01, SPEC-02 requirement text

### Secondary (MEDIUM confidence)
- [OpenAI Python SDK GitHub](https://github.com/openai/openai-python) -- `base_url`, `max_retries` (default 2), `default_headers` constructor parameters
- [Anthropic Python SDK GitHub](https://github.com/anthropics/anthropic-sdk-python) -- `base_url`, `max_retries` (default 2), `default_headers` constructor parameters
- [OpenAI Node SDK GitHub](https://github.com/openai/openai-node) -- `baseURL`, `maxRetries` (default 2), `defaultHeaders` constructor parameters
- [Anthropic Node SDK GitHub](https://github.com/anthropics/anthropic-sdk-typescript) -- `baseURL`, `maxRetries` (default 2), `defaultHeaders` constructor parameters

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no libraries needed, pure documentation phase
- Architecture: HIGH -- all conventions extracted directly from existing proxy source code
- Pitfalls: HIGH -- error formats, URL construction, and retry behavior verified against source

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable -- proxy conventions unlikely to change during v1.3 implementation)
