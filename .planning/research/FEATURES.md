# Feature Research

**Domain:** Drop-in replacement SDKs for OpenAI and Anthropic Python/Node.js clients (proxy-aware)
**Researched:** 2026-02-28
**Confidence:** HIGH (Python/Node SDK patterns well-documented; competitor patterns verified via Portkey, Helicone)

---

## Context: What "Drop-In" Means Here

Users have existing code using `openai.OpenAI(...)` or `anthropic.Anthropic(...)`. They want to route those calls through the Govyn proxy with governance — budget enforcement, policy evaluation, loop detection, cost tracking — without rewriting their application code.

The gold-standard pattern in the ecosystem (Portkey, Helicone, LiteLLM) is: change one import + add two constructor arguments. Everything else — streaming, tool calls, async patterns, error shapes — must be identical to the upstream SDK.

Govyn's existing proxy already handles the HTTP side. The SDKs are client-side convenience wrappers that (a) configure `base_url` to point at the proxy, (b) inject the `X-Govyn-Agent` header on every request, and (c) strip real provider API keys from the client environment so the proxy holds them.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `base_url` auto-configuration to proxy | Core purpose of SDK; manual config is friction users will skip | LOW | Set to `http://localhost:4000/v1/openai` or `/v1/anthropic` based on provider |
| `X-Govyn-Agent` header injection on every request | Agent identification is the prerequisite for all governance features | LOW | Inject as `default_headers` / `defaultHeaders` at client init; overridable per-request via `extra_headers` |
| Sync client wrapper (Python: `GovynOpenAI`, Node: same) | Synchronous is the default usage path for simple scripts and agents | LOW | Subclass or wrap `openai.OpenAI` / `anthropic.Anthropic` with preset `base_url` + `default_headers` |
| Async client wrapper (Python: `GovynAsyncOpenAI`, Node: same) | LangChain, agents frameworks, FastAPI all use async paths | LOW | Mirror sync wrapper; `AsyncOpenAI` / async `Anthropic` equivalent |
| Streaming passthrough (SSE) | Most production agent code uses streaming; broken streaming = SDK is unusable | LOW | No special SDK work needed — proxy already handles SSE; SDK just needs to not break the stream |
| Error passthrough (4xx/5xx shapes) | Agent code catches OpenAI/Anthropic error types; SDK must not rewrap them | LOW | Budget-exceeded 429s use Govyn error format — SDK should surface these as a typed exception |
| Zero code changes beyond import and constructor | Developers test SDK drop-in by searching for `openai.` calls; they expect zero other changes | MEDIUM | Must preserve all method signatures, return types, and exception types from upstream SDK |
| Environment variable configuration (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`) | Twelve-factor apps configure via env; constructor args should be optional fallbacks | LOW | Read `GOVYN_PROXY_URL` for base URL, `GOVYN_AGENT_ID` for agent header; standard pattern across Helicone, Portkey |
| Python 3.9+ support | OpenAI Python SDK requires Python 3.9+; SDK must match | LOW | OpenAI SDK minimum is Python 3.9 (confirmed: latest version 1.99.9 as of August 2025) |
| Node.js ESM + CommonJS support | npm package must work in both module systems | MEDIUM | govyn npm package already published; SDK needs dual CJS/ESM output in the package |
| TypeScript type safety | govynai SDK users are using TypeScript; full type inference expected | LOW | Extend or re-export types from `openai` and `@anthropic-ai/sdk` |
| pip install govynai / npm install govynai | Users expect a named package; govynai on PyPI already claimed (PEP 541 pending for govyn) | LOW | `govynai` on PyPI; `govyn` on npm already published |
| README with 5-line quickstart | SDK adoption requires immediate clarity; users bounce if setup is >3 steps | LOW | Pattern: `pip install govynai`, set `GOVYN_PROXY_URL`, change import, done |

### Differentiators (Competitive Advantage)

Features that set Govyn SDK apart from Helicone/Portkey wrappers.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Govyn error type for budget exceeded / loop detected | Governance-specific errors (429 from budget or loop) need a distinct SDK exception type so agents can handle them meaningfully — not just a generic HTTP 429 | MEDIUM | Define `GovynBudgetExceededError`, `GovynLoopDetectedError` as typed exceptions; parse proxy error body's `error.code` field (`budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected`) |
| Budget warning header surfacing | Proxy already adds `X-Govyn-Budget-Warning` header on soft-limit nearing; SDK can expose this as a response attribute | MEDIUM | Wrap response to expose `response.govyn_budget_warning` (Python dict / TS object) — gives agents programmatic awareness before hard cutoff |
| Agent ID set once, enforced on every call | Users forget to add headers per-call; SDK enforces it at the constructor level so governance is non-optional once SDK is used | LOW | This is the architectural differentiator: SDK makes governance mechanical, not optional |
| Govyn error context on policy deny | When a policy `block` rule fires, proxy returns 403 with `denied_by` in body; SDK surfaces `GovynPolicyDeniedError` with `policy_name` attribute | MEDIUM | Requires reading `error.code == 'policy_denied'` from proxy response |
| Proxy health check helper (`govyn.check_proxy()`) | Common friction: users aren't sure if the proxy is running; helper pings the proxy health endpoint and returns version/status | LOW | Call `GET /health` on the proxy; simple utility function, not a core SDK class |
| `configure()` module-level function (Python) | LangChain and framework integrations need global config without constructor injection; `govynai.configure(proxy_url=..., agent_id=...)` sets module-level defaults | LOW | Stores in module-level state; subsequent `GovynOpenAI()` calls use these defaults without args |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem like good additions but create problems for this SDK.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| SDK-side cost tracking / budget enforcement | "SDK could track spend locally without the proxy" | Defeats the proxy architecture entirely — the whole point is that governance happens at the infrastructure level, not in code that agents can bypass | Keep all enforcement in the proxy; SDK only surfaces what the proxy communicates |
| Retry logic on budget-exceeded errors | "Retry after a delay when budget resets" | Agent code shouldn't silently retry governance blocks; that's a policy circumvention pattern | Raise `GovynBudgetExceededError` and let the agent's error handler decide; document the `reset_time` field |
| Automatic fallback to direct API on proxy failure | "SDK should call OpenAI directly if the proxy is down" | Completely breaks governance enforcement — proxy outage would become an unmonitored governance gap | Fail-open is the proxy's job (ADR-002); SDK should raise `GovynProxyUnavailableError` and let the caller decide |
| Model name rewriting in SDK | "SDK could remap model names to go through the proxy routing" | Proxy already has model_route policy rules; SDK-side routing creates a second inconsistent layer | Use proxy policy `model_route` rules; document this in the SDK |
| Storing or caching API keys in SDK | "SDK could hold real API keys so users don't need to configure the proxy" | Reintroduces the exact security problem Govyn solves — keys back in agent code | SDK uses a Govyn API key (scoped key `gvn_*`) as `api_key`, never the real provider key |
| Full observability SDK (spans, traces) | "Add OpenTelemetry tracing to SDK" | Scope creep; observability is a future milestone; adding it now creates maintenance burden and API surface to freeze | Defer to OpenTelemetry export phase; SDK's job is routing, not observability |
| LangChain / CrewAI callback handlers in SDK | "Bundle framework integrations in the SDK package" | Adds heavy optional dependencies to a lightweight SDK; framework versions change constantly | Ship as separate packages (e.g., `govynai-langchain`); in scope as future milestone |

---

## Feature Dependencies

```
[GovynOpenAI client wrapper]
    └──requires──> [base_url auto-config to proxy]
    └──requires──> [X-Govyn-Agent header injection]
    └──requires──> [Proxy running at configured URL]

[Govyn error types (GovynBudgetExceededError)]
    └──requires──> [GovynOpenAI client wrapper]
    └──requires──> [Proxy returning structured error body with error.code]

[Budget warning surfacing on response]
    └──requires──> [GovynOpenAI client wrapper]
    └──requires──> [Proxy emitting X-Govyn-Budget-Warning header]
    └──requires──> [Non-streaming AND streaming response wrapper]

[configure() module-level defaults]
    └──enhances──> [GovynOpenAI client wrapper]

[govyn.check_proxy() utility]
    └──requires──> [Proxy health endpoint (GET /health)]

[GovynAsyncOpenAI]
    └──mirrors──> [GovynOpenAI] (same pattern, async variant)

[Python SDK (govynai package)]
    └──independent-of──> [Node.js SDK (govyn npm package)]

[GovynPolicyDeniedError]
    └──requires──> [Proxy returning 403 with error.code = policy_denied]
    └──depends-on-existing──> [Policy engine (v1.1 shipped)]
```

### Dependency Notes

- **X-Govyn-Agent requires proxy to be running:** SDK is useless without the proxy — documentation must be clear about this ordering.
- **Budget warning surfacing requires both paths:** Proxy adds `X-Govyn-Budget-Warning` on both streaming and non-streaming responses; SDK wrapper must expose it from both.
- **Govyn error types require structured proxy error body:** The proxy already returns `{ error: { type, code, message, details } }` format for budget and loop errors — SDK just needs to parse `error.code`.
- **Python and Node SDKs are independent deliverables** that can be built in parallel; shared concepts (error types, header names, env var names) should be documented in a shared spec first to keep them consistent.

---

## MVP Definition

### Launch With (v1.3)

Minimum viable product — what's needed to validate the concept and unblock real users.

- [ ] `GovynOpenAI` (Python) — sync wrapper around `openai.OpenAI` with `base_url` and `default_headers` preset; takes `proxy_url` and `agent_id` args
- [ ] `GovynAsyncOpenAI` (Python) — async variant; same API as `GovynOpenAI` but wraps `openai.AsyncOpenAI`
- [ ] `GovynAnthropic` (Python) — sync wrapper around `anthropic.Anthropic` with `base_url` and `default_headers` preset
- [ ] `GovynAsyncAnthropic` (Python) — async variant
- [ ] `GovynOpenAI` (Node.js / TypeScript) — wraps `openai.OpenAI` with proxy URL + agent header defaults
- [ ] `GovynAnthropic` (Node.js / TypeScript) — wraps `@anthropic-ai/sdk` Anthropic client
- [ ] `GOVYN_PROXY_URL` and `GOVYN_AGENT_ID` environment variable support in both SDKs
- [ ] `GovynBudgetExceededError` and `GovynLoopDetectedError` typed exceptions in both SDKs — parse `error.code` from proxy 429 responses
- [ ] `govyn.check_proxy()` / `govyn.checkProxy()` health check utility in both SDKs
- [ ] Published to PyPI as `govynai` and npm as `govyn` with TypeScript types
- [ ] README quickstart: 5 lines from zero to governed agent call

### Add After Validation (v1.x)

Features to add once core is working and users are using it.

- [ ] `GovynPolicyDeniedError` — add after first user reports confusion about 403 policy blocks
- [ ] Budget warning surfacing on response object — add when users request programmatic budget awareness
- [ ] `govynai.configure()` module-level defaults (Python) — add when LangChain integration requests come in
- [ ] LangChain callback handler — separate package `govynai-langchain`, add when LangChain users report integration friction

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] OpenTelemetry export integration — separate phase in roadmap, adds observability spans to proxy calls
- [ ] CrewAI / AutoGen framework plugins — `govynai-crewai`, `govynai-autogen`; add based on demand signal
- [ ] Govyn Agent SDK (higher-level abstraction) — abstracts multi-provider routing, approval polling, etc.; different product than drop-in replacement

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| GovynOpenAI sync wrapper (Python) | HIGH | LOW | P1 |
| GovynAnthropic sync wrapper (Python) | HIGH | LOW | P1 |
| GovynOpenAI async wrapper (Python) | HIGH | LOW | P1 |
| GovynAnthropic async wrapper (Python) | HIGH | LOW | P1 |
| GovynOpenAI wrapper (Node.js/TS) | HIGH | LOW | P1 |
| GovynAnthropic wrapper (Node.js/TS) | HIGH | LOW | P1 |
| GOVYN_PROXY_URL / GOVYN_AGENT_ID env vars | HIGH | LOW | P1 |
| GovynBudgetExceededError + GovynLoopDetectedError | MEDIUM | LOW | P1 |
| check_proxy() / checkProxy() utility | MEDIUM | LOW | P1 |
| PyPI + npm publish | HIGH | LOW | P1 |
| GovynPolicyDeniedError | MEDIUM | LOW | P2 |
| Budget warning response attribute | MEDIUM | MEDIUM | P2 |
| govynai.configure() module defaults | MEDIUM | LOW | P2 |
| LangChain callback handler | HIGH | MEDIUM | P2 |
| OpenTelemetry export | MEDIUM | HIGH | P3 |
| Framework mega-package (CrewAI, AutoGen) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.3 launch
- P2: Add in v1.3.x when users request it
- P3: Defer to future milestone

---

## Competitor Feature Analysis

| Feature | Helicone SDK | Portkey SDK | Govyn SDK Approach |
|---------|--------------|-------------|---------------------|
| Drop-in compatibility | Change base_url + add Helicone-Auth header; stays on OpenAI SDK entirely | Replace `import OpenAI` with `import Portkey`; built on OpenAI SDK | Same: thin wrapper with preset base_url + default_headers; full upstream SDK compatibility |
| Agent / user identification | `Helicone-User-Id` header; per-request metadata dict | `x-portkey-metadata` header with user/session info | `X-Govyn-Agent` header at client init; agent maps to governance config server-side |
| Budget enforcement | No — observability only, no enforcement | No — routing/caching/fallback but no enforcement | Yes — enforced at proxy level; SDK surfaces errors when blocked |
| Config via env vars | `HELICONE_API_KEY` + set `baseURL` manually | `PORTKEY_API_KEY` env var; base_url manual | `GOVYN_PROXY_URL` + `GOVYN_AGENT_ID`; full env-first configuration |
| Error typing for governance blocks | Generic HTTP errors | Generic HTTP errors | Typed `GovynBudgetExceededError` / `GovynLoopDetectedError` |
| Self-hosted | Helicone is SaaS-first; OSS gateway available separately | Portkey is SaaS-first | Govyn proxy is self-hosted by design; SDK points at user's own proxy |
| Async support | Yes | Yes | Yes — both sync and async variants |
| Framework integrations | LangChain, OpenAI Agents SDK | LangChain, Vercel AI SDK | v1.3: base wrappers only; v1.3.x: LangChain |

---

## Implementation Notes

### The Simplest Correct Implementation (Python)

The key insight from studying Portkey, Helicone, and LiteLLM: the simplest correct implementation is **not subclassing** but **composition with passthrough**. Create a thin wrapper that instantiates the real SDK client with preset `base_url` and `default_headers`, then delegates all attribute access to it. This ensures any new methods added to the upstream SDK automatically work without SDK updates.

```python
# Conceptual pattern (not final code)
class GovynOpenAI:
    def __init__(self, agent_id=None, proxy_url=None, **kwargs):
        agent_id = agent_id or os.environ.get("GOVYN_AGENT_ID", "unknown")
        proxy_url = proxy_url or os.environ.get("GOVYN_PROXY_URL", "http://localhost:4000")
        self._client = openai.OpenAI(
            base_url=f"{proxy_url}/v1/openai",
            default_headers={"X-Govyn-Agent": agent_id},
            api_key="govyn",  # proxy holds real key; this is a placeholder
            **kwargs
        )

    def __getattr__(self, name):
        return getattr(self._client, name)
```

### The Simplest Correct Implementation (Node.js/TypeScript)

Same delegation pattern using a Proxy object or direct property forwarding. The OpenAI Node SDK supports `baseURL` and `defaultHeaders` at construction time identically to the Python SDK.

### API Key Handling

The real provider API key lives in the proxy's environment. The SDK's `api_key` / `apiKey` parameter must be set to something — the proxy doesn't validate it and uses its own env-var key. Using `"govyn"` as a placeholder is clear and doesn't look like a missing configuration.

Users with scoped Govyn API keys (`gvn_*`) should pass their scoped key as `api_key`, which the proxy uses to identify the agent via the key lookup path (alternative to `X-Govyn-Agent` header).

### Streaming

No special handling required in the SDK. The proxy already passes SSE through transparently. The upstream SDK's streaming implementation works unchanged because the proxy preserves all response headers including `content-type: text/event-stream`.

### Error Handling: Where to Parse Proxy Errors

The SDK wraps the HTTP response; when the proxy returns 429, the SDK must intercept before surfacing as a generic HTTP error. The proxy error body structure is:
```json
{
  "error": {
    "type": "budget_error",
    "code": "budget_exceeded_daily",
    "message": "...",
    "details": { "reset_time": "...", "current_spend": 10.00, "limit": 10.00 }
  }
}
```
Parse `error.code` to determine the specific Govyn error type.

---

## Sources

- [OpenAI Python SDK — official repo](https://github.com/openai/openai-python) — base_url, default_headers, AsyncOpenAI pattern (HIGH confidence)
- [Anthropic Python SDK — official repo](https://github.com/anthropics/anthropic-sdk-python) — base_url, default_headers, async pattern (HIGH confidence)
- [Anthropic TypeScript SDK — official repo](https://github.com/anthropics/anthropic-sdk-typescript) — baseURL, defaultHeaders, streaming (HIGH confidence)
- [Portkey Python SDK](https://github.com/Portkey-AI/portkey-python-sdk) — drop-in pattern via OpenAI SDK inheritance (MEDIUM confidence — implementation details inferred from README)
- [Portkey Node SDK](https://github.com/Portkey-AI/portkey-node-sdk) — Node.js drop-in pattern (MEDIUM confidence)
- [Helicone — Proxy vs Async Integration](https://docs.helicone.ai/references/proxy-vs-async) — base_url pattern, header injection approach (MEDIUM confidence)
- [LiteLLM Request Headers](https://docs.litellm.ai/docs/proxy/request_headers) — x-* header forwarding conventions (MEDIUM confidence)
- [OpenAI community — extra_headers proxy issue](https://github.com/openai/openai-python/issues/1975) — known quirk with default headers in proxy scenarios (MEDIUM confidence)
- Govyn proxy source: `src/router.ts`, `src/proxy.ts`, `src/types.ts` — proxy URL patterns, header names, error shapes (HIGH confidence — primary source)

---

*Feature research for: Govyn v1.3 — Python SDK and Node.js SDK*
*Researched: 2026-02-28*
