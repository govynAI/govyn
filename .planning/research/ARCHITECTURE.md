# Architecture Research

**Domain:** SDK wrapper layer over existing HTTP proxy
**Researched:** 2026-02-28
**Confidence:** HIGH (proxy internals from source; SDK constructor params from official repos; integration pattern from established ecosystem precedents)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SDK LAYER (NEW — v1.3)                        │
│                                                                       │
│  ┌─────────────────────────┐  ┌──────────────────────────────────┐   │
│  │  govynai (PyPI)          │  │  govyn SDK (npm)                 │   │
│  │  ── GovynOpenAI()        │  │  ── GovynOpenAI()                │   │
│  │  ── GovynAnthropic()     │  │  ── GovynAnthropic()             │   │
│  └──────────┬──────────────┘  └────────────┬─────────────────────┘   │
│             │  thin wrappers: set base_url + X-Govyn-Agent header     │
└─────────────┼────────────────────────────────────────────────────────┘
              │ HTTP  (agent's machine → Govyn proxy)
┌─────────────▼────────────────────────────────────────────────────────┐
│                  EXISTING PROXY CORE (unchanged)                      │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  server.ts  — HTTP request handler                            │    │
│  │    ├── resolveAgentId()  (X-Govyn-Agent header, Bearer token) │    │
│  │    ├── budgetEnforcer.checkBudget()                           │    │
│  │    ├── policyEngine.evaluate()                                │    │
│  │    └── forwardRequest()  → upstream API                       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Routes: /v1/openai/*  /v1/anthropic/*  /v1/custom/:name/*           │
│  Agent ID: X-Govyn-Agent header  OR  scoped Bearer token             │
└─────────────────────────┬─────────────────────────────────────────────┘
                          │ HTTPS (proxy → upstream)
              ┌───────────┴───────────┐
              │                       │
    ┌─────────▼────────┐  ┌──────────▼────────┐
    │  api.openai.com   │  │  api.anthropic.com │
    └──────────────────┘  └───────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `GovynOpenAI` (Python) | Subclass of `openai.OpenAI`; overrides `base_url` to Govyn proxy, injects `X-Govyn-Agent` via `default_headers` | NEW |
| `GovynAnthropic` (Python) | Subclass of `anthropic.Anthropic`; overrides `base_url`, injects `X-Govyn-Agent` via `default_headers` | NEW |
| `GovynOpenAI` (Node.js) | Subclass of `OpenAI` from `openai` npm package; overrides `baseURL`, injects via `defaultHeaders` | NEW |
| `GovynAnthropic` (Node.js) | Subclass of `Anthropic` from `@anthropic-ai/sdk`; overrides `baseURL`, injects via `defaultHeaders` | NEW |
| `server.ts` → `resolveAgentId()` | Already reads `X-Govyn-Agent` header (priority 1) and Bearer token (priority 2). No changes needed. | EXISTING — unchanged |
| Proxy routing | Already handles `/v1/openai/*` and `/v1/anthropic/*`. No changes needed. | EXISTING — unchanged |
| `mapOpenAIHeaders()` | Already forwards `x-govyn-agent` to upstream (line 41 in providers/openai.ts). Govyn strips it before upstream. | EXISTING — already strips header |
| `mapAnthropicHeaders()` | Already forwards `x-govyn-agent`. Same as above. | EXISTING — already strips header |

## New vs Modified Components

### Strictly NEW (v1.3 only)

| Component | Language | File Location (proposed) | Notes |
|-----------|----------|--------------------------|-------|
| `GovynOpenAI` class | Python | `python-sdk/govynai/openai.py` | Extends `openai.OpenAI` |
| `GovynAnthropic` class | Python | `python-sdk/govynai/anthropic.py` | Extends `anthropic.Anthropic` |
| `GovynAsyncOpenAI` class | Python | `python-sdk/govynai/openai.py` | Extends `openai.AsyncOpenAI` |
| `GovynAsyncAnthropic` class | Python | `python-sdk/govynai/anthropic.py` | Extends `anthropic.AsyncAnthropic` |
| `GovynOpenAI` class | Node.js | `sdk/src/openai.ts` | Extends `openai.OpenAI` |
| `GovynAnthropic` class | Node.js | `sdk/src/anthropic.ts` | Extends `@anthropic-ai/sdk.Anthropic` |
| Python package entrypoint | Python | `python-sdk/govynai/__init__.py` | Exports all four classes |
| Node.js package entrypoint | TypeScript | `sdk/src/index.ts` | Exports both classes |
| Python package config | Python | `python-sdk/pyproject.toml` | Separate from root pyproject.toml |
| Node.js package config | JSON | `sdk/package.json` | Separate npm package |
| Tests (Python) | Python | `python-sdk/tests/` | pytest with mocked HTTP |
| Tests (Node.js) | TypeScript | `sdk/tests/` | Vitest with mocked HTTP |

### EXISTING — No Changes Required

| Component | Why Unchanged |
|-----------|---------------|
| `src/server.ts` | Already resolves `X-Govyn-Agent` header as priority 1 agent ID |
| `src/agents.ts` | Already handles header + Bearer token resolution |
| `src/router.ts` | Already routes `/v1/openai/*` and `/v1/anthropic/*` |
| `src/providers/openai.ts` | Already strips and re-injects Authorization; already forwards `x-govyn-agent` |
| `src/providers/anthropic.ts` | Same as above |
| `src/proxy.ts` | Fully transparent; no SDK awareness needed |
| `govyn.config.yaml` | No proxy-side changes for SDK |

### EXISTING — Minor Additions Only

| Component | What Changes | Why |
|-----------|-------------|-----|
| `src/providers/openai.ts` `mapOpenAIHeaders()` | Remove `x-govyn-agent` from forwarded headers list (it should be consumed by proxy, not sent upstream to OpenAI) | Currently line 41 forwards it to OpenAI, which ignores it — harmless but noisy. Strip it instead. |
| `src/providers/anthropic.ts` `mapAnthropicHeaders()` | Same — remove `x-govyn-agent` from forwarded list | Same reason |

Note: Whether to strip `x-govyn-agent` before forwarding upstream is a minor cleanup, not a hard requirement. Upstream providers silently ignore unknown headers. This is a "nice to have" cleanup.

## Recommended Project Structure

```
govyn/                              # monorepo root (existing)
├── src/                            # proxy core (EXISTING, unchanged)
├── dashboard/                      # React dashboard (EXISTING, unchanged)
│
├── sdk/                            # NEW: Node.js SDK package
│   ├── package.json                # name: "govyn", separate publish config
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                # exports GovynOpenAI, GovynAnthropic
│   │   ├── openai.ts               # GovynOpenAI class
│   │   └── anthropic.ts            # GovynAnthropic class
│   └── tests/
│       ├── openai.test.ts
│       └── anthropic.test.ts
│
└── python-sdk/                     # NEW: Python SDK package
    ├── pyproject.toml              # name: "govynai", separate from root
    ├── govynai/
    │   ├── __init__.py             # from govynai import GovynOpenAI, GovynAnthropic
    │   ├── openai.py               # GovynOpenAI, GovynAsyncOpenAI
    │   └── anthropic.py            # GovynAnthropic, GovynAsyncAnthropic
    └── tests/
        ├── test_openai.py
        └── test_anthropic.py
```

### Structure Rationale

- **`sdk/` separate from `src/`:** The proxy core (`src/`) is zero-dependency Node.js. The SDK introduces `openai` and `@anthropic-ai/sdk` as peer dependencies. Keeping them in separate directories prevents accidental inclusion in the proxy build.
- **`python-sdk/` as sibling to `sdk/`:** Python and Node.js SDKs are separate PyPI/npm packages. Sibling directories with their own `pyproject.toml` and `package.json` allow independent publishing.
- **`pyproject.toml` at root vs `python-sdk/pyproject.toml`:** The root `pyproject.toml` is currently a stub (no packages installed). The Python SDK should have its own at `python-sdk/pyproject.toml` to avoid conflicts with the root.

## Architectural Patterns

### Pattern 1: Thin Subclass with Constructor Override

**What:** The SDK classes extend the official clients (`openai.OpenAI`, `anthropic.Anthropic`) and override only `base_url`/`baseURL` and inject `X-Govyn-Agent` via `default_headers`/`defaultHeaders`. All API methods (`chat.completions.create`, `messages.create`, streaming, etc.) are inherited unchanged.

**When to use:** Always. This is the entire SDK pattern.

**Trade-offs:**
- Pro: Zero maintenance surface — new SDK features from OpenAI/Anthropic work automatically
- Pro: True drop-in replacement — user changes 2 lines of code, everything else is identical
- Pro: Streaming SSE, async, structured outputs all work with zero SDK code
- Con: User still needs both `openai`/`anthropic` package AND `govynai` installed (govynai declares them as dependencies)

**Python example:**

```python
# govynai/openai.py
from openai import OpenAI, AsyncOpenAI

GOVYN_PROXY_DEFAULT = "http://localhost:4000"
GOVYN_AGENT_HEADER = "X-Govyn-Agent"

class GovynOpenAI(OpenAI):
    def __init__(
        self,
        *,
        proxy_url: str = GOVYN_PROXY_DEFAULT,
        agent_id: str,
        govyn_api_key: str | None = None,
        **kwargs,
    ):
        # Build base_url: proxy_url + /v1/openai
        base_url = proxy_url.rstrip("/") + "/v1/openai"

        # Inject agent identification header
        existing_headers = kwargs.pop("default_headers", {}) or {}
        default_headers = {**existing_headers, GOVYN_AGENT_HEADER: agent_id}

        # Use govyn_api_key as Bearer token if provided (scoped key mode)
        # Otherwise pass a dummy key (proxy holds real keys)
        api_key = govyn_api_key or kwargs.pop("api_key", "govyn-passthrough")

        super().__init__(
            api_key=api_key,
            base_url=base_url,
            default_headers=default_headers,
            **kwargs,
        )
```

**Node.js example:**

```typescript
// sdk/src/openai.ts
import OpenAI from 'openai';

const GOVYN_PROXY_DEFAULT = 'http://localhost:4000';
const GOVYN_AGENT_HEADER = 'X-Govyn-Agent';

export class GovynOpenAI extends OpenAI {
  constructor({
    proxyUrl = GOVYN_PROXY_DEFAULT,
    agentId,
    govynApiKey,
    ...rest
  }: OpenAI.ClientOptions & {
    proxyUrl?: string;
    agentId: string;
    govynApiKey?: string;
  }) {
    const baseURL = proxyUrl.replace(/\/$/, '') + '/v1/openai';
    const existingHeaders = (rest.defaultHeaders as Record<string, string>) ?? {};

    super({
      ...rest,
      apiKey: govynApiKey ?? rest.apiKey ?? 'govyn-passthrough',
      baseURL,
      defaultHeaders: { ...existingHeaders, [GOVYN_AGENT_HEADER]: agentId },
    });
  }
}
```

### Pattern 2: Anthropic Base URL Routing

**What:** Anthropic's base URL override works the same way as OpenAI's, but the upstream path prefix must be `/v1/anthropic` and Govyn's `mapAnthropicHeaders()` handles the `x-api-key` injection server-side.

**When to use:** GovynAnthropic class only.

**Key detail:** The Anthropic SDK sends requests to `/v1/messages`, `/v1/complete`, etc. When `base_url` is set to `http://localhost:4000/v1/anthropic`, the full upstream path becomes `/v1/anthropic/v1/messages`. This is correct — Govyn strips the `/v1/anthropic` prefix and forwards `/v1/messages` to `api.anthropic.com`.

**Example:**

```python
# govynai/anthropic.py
from anthropic import Anthropic, AsyncAnthropic

class GovynAnthropic(Anthropic):
    def __init__(
        self,
        *,
        proxy_url: str = "http://localhost:4000",
        agent_id: str,
        govyn_api_key: str | None = None,
        **kwargs,
    ):
        base_url = proxy_url.rstrip("/") + "/v1/anthropic"

        existing_headers = kwargs.pop("default_headers", {}) or {}
        default_headers = {**existing_headers, "X-Govyn-Agent": agent_id}

        # Anthropic uses api_key differently (x-api-key header) but same pattern
        api_key = govyn_api_key or kwargs.pop("api_key", "govyn-passthrough")

        super().__init__(
            api_key=api_key,
            base_url=base_url,
            default_headers=default_headers,
            **kwargs,
        )
```

### Pattern 3: Environment-Variable-Driven Configuration

**What:** Allow `proxy_url` and `agent_id` to be read from environment variables as fallbacks (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`), with constructor arguments taking precedence.

**When to use:** Enables configuration without code changes — useful for containerized deployments where env vars are standard.

**Trade-offs:**
- Pro: Agent can be configured entirely via env vars (12-factor app friendly)
- Pro: `agent_id` doesn't need to be hardcoded per environment
- Con: Slight magic; agent identity comes from env, not visible in source

**Example:**

```python
import os

class GovynOpenAI(OpenAI):
    def __init__(self, *, proxy_url: str | None = None, agent_id: str | None = None, **kwargs):
        resolved_proxy = proxy_url or os.environ.get("GOVYN_PROXY_URL", "http://localhost:4000")
        resolved_agent = agent_id or os.environ.get("GOVYN_AGENT_ID")
        if not resolved_agent:
            raise ValueError("agent_id is required (or set GOVYN_AGENT_ID env var)")
        ...
```

## Data Flow

### SDK Request Flow (Happy Path)

```
[User Code]
  client = GovynOpenAI(proxy_url="http://proxy:4000", agent_id="my-agent")
  response = client.chat.completions.create(model="gpt-4o", messages=[...])
    ↓
[openai Python lib / openai npm package — inherited, no Govyn code]
  POST http://proxy:4000/v1/openai/v1/chat/completions
  Headers:
    Authorization: Bearer govyn-passthrough   ← dummy key (proxy ignores it)
    X-Govyn-Agent: my-agent                   ← govyn reads this
    Content-Type: application/json
    Body: {"model": "gpt-4o", "messages": [...]}
    ↓
[Govyn proxy server.ts]
  resolveAgentId() → "my-agent" (from X-Govyn-Agent header)
  budgetEnforcer.checkBudget("my-agent")      ← enforced
  policyEngine.evaluate(...)                  ← enforced
  matchRoute("/v1/openai/v1/chat/completions") → openai provider
    ↓
[proxy.ts forwardRequest()]
  mapOpenAIHeaders() → strips X-Govyn-Agent, sets Authorization: Bearer $OPENAI_API_KEY
  POST https://api.openai.com/v1/chat/completions
    ↓
[OpenAI upstream]
  Response: {"choices": [...], "usage": {...}}
    ↓
[proxy.ts — response path]
  extractTokenUsage() → cost calculation
  aggregator.recordCost()                     ← cost tracked
  actionLogger.log()                          ← logged
  dbWriter.writeCostRecord()                  ← persisted
    ↓
[openai Python lib / npm — inherited stream/response handling]
[User Code receives response — identical to direct OpenAI call]
```

### SDK Streaming Flow

Streaming works without any SDK-side changes. The openai/anthropic official clients handle SSE internally. Govyn's proxy already has SSE passthrough (`handleStreamingResponse` in `streaming.ts`). The SDK sets `stream=True` / `stream: true`, the official client opens an SSE connection through the proxy, and Govyn pipes chunks through unchanged.

```
[User Code]  stream = client.chat.completions.create(model="gpt-4o", ..., stream=True)
              for chunk in stream: print(chunk.choices[0].delta.content)
    ↓
[openai lib]  Opens SSE stream → proxy /v1/openai/v1/chat/completions
    ↓
[proxy streaming.ts]  handleStreamingResponse() pipes chunks chunk-by-chunk
                      SSE token extraction happens after stream end
    ↓
[openai lib]  Yields chunks to user code — identical to direct call
```

### Agent Identification Flow (SDK Path)

```
SDK Constructor
  agent_id="my-agent"
  → defaultHeaders["X-Govyn-Agent"] = "my-agent"

Every API call (inherited from official client)
  → sends X-Govyn-Agent: my-agent in request headers

Proxy agents.ts resolveAgentId()
  → reads req.headers["x-govyn-agent"]  (priority 1)
  → returns { agentId: "my-agent", source: "header" }
```

No changes to proxy agent identification — the SDK just reliably sets the header.

### Scoped API Key Flow (Alternative to Header)

```
SDK Constructor
  govyn_api_key="gvn_ra_xxxx"
  → api_key="gvn_ra_xxxx"  (sent as Authorization: Bearer gvn_ra_xxxx)

Proxy agents.ts resolveAgentId()
  → header not present; reads Authorization Bearer token
  → matches against agents[].apiKeys in govyn.config.yaml
  → returns { agentId: "research-agent", source: "api-key" }
```

This is the stronger governance mode — proxy-side API key lookup, agent cannot self-report a different identity.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| openai PyPI package | `govynai` declares `openai>=1.0.0` as dependency; `GovynOpenAI` extends `openai.OpenAI` | User still calls `openai` methods — no API surface change |
| anthropic PyPI package | `govynai` declares `anthropic>=0.20.0` as dependency; `GovynAnthropic` extends `anthropic.Anthropic` | Same |
| openai npm package | `govyn` SDK declares `openai` as peer dependency; `GovynOpenAI` extends `OpenAI` | User keeps `openai` in their deps |
| @anthropic-ai/sdk npm | `govyn` SDK declares `@anthropic-ai/sdk` as peer dependency; `GovynAnthropic` extends `Anthropic` | Same |
| Govyn proxy (`/v1/openai/*`) | SDK sets `base_url` to `{proxy_url}/v1/openai`; all calls route through proxy | No proxy code changes |
| Govyn proxy (`/v1/anthropic/*`) | SDK sets `base_url` to `{proxy_url}/v1/anthropic`; same | No proxy code changes |

### Internal Boundaries (Proxy Side — Unchanged)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SDK → Proxy | Standard HTTP with `X-Govyn-Agent` header | agents.ts already handles this |
| Proxy → OpenAI upstream | `mapOpenAIHeaders()` replaces agent key with real OPENAI_API_KEY | No changes needed |
| Proxy → Anthropic upstream | `mapAnthropicHeaders()` replaces with real ANTHROPIC_API_KEY | No changes needed |
| Cost tracking | Unchanged — `extractTokenUsage()` works on response bodies regardless of caller | No changes needed |
| Policy enforcement | Unchanged — policies evaluated before forwarding; SDK requests look identical to direct requests | No changes needed |

### Header Contract (Critical)

The proxy's `X-Govyn-Agent` header handling is the only coupling between SDK and proxy:

```
SDK side:      default_headers["X-Govyn-Agent"] = agent_id
Proxy side:    req.headers["x-govyn-agent"]  → resolveAgentId() priority 1
```

This contract is already implemented on the proxy side (agents.ts line 30). The SDK must consistently set this header. The proxy already strips it before forwarding upstream (or safely forwards it — upstreams ignore unknown headers).

## Suggested Build Order

### Phase 1: Python SDK (govynai package)

Build Python first for three reasons:
1. The `govynai` PyPI package is already claimed — delivers immediate value
2. Python is the dominant language for AI agent development (LangChain, CrewAI, AutoGen are all Python-first)
3. Simpler test infrastructure (pytest, no compile step)

**Sequence within Phase 1:**
1. `GovynOpenAI` and `GovynAsyncOpenAI` — OpenAI is higher adoption
2. `GovynAnthropic` and `GovynAsyncAnthropic`
3. `__init__.py` exports and package config (`pyproject.toml` with dependencies)
4. Tests: unit (mock HTTP), integration (real proxy running locally)
5. Publish to PyPI as `govynai`

### Phase 2: Node.js SDK (govyn package)

Build Node.js second:
1. `GovynOpenAI` TypeScript class
2. `GovynAnthropic` TypeScript class
3. Package exports, `package.json`, TypeScript declaration files
4. Tests with Vitest (matches existing proxy test infrastructure)
5. Publish to npm as `govyn`

**Note on npm package name:** The `govyn` npm package is already published (per PROJECT.md). The SDK will likely be a separate package (e.g., `@govyn/sdk` or `govyn-sdk`) OR the existing `govyn` package exports will be extended. Clarify before starting Phase 2.

### Dependencies Between Phases

- Phase 2 does NOT depend on Phase 1 — both can start concurrently if needed
- Both depend on the proxy being reachable for integration tests
- No proxy code changes are required for either phase — proxy is stable

## Anti-Patterns

### Anti-Pattern 1: Reimplementing HTTP Client Logic

**What people do:** Write a custom HTTP client from scratch that mimics the OpenAI/Anthropic wire format.

**Why it's wrong:** Creates a maintenance burden that grows with every new upstream feature (structured outputs, realtime API, new models). Streaming is particularly complex to reimplement correctly.

**Do this instead:** Extend the official client. The proxy is already transparent — the official SDK's HTTP calls go through unchanged. Zero reimplementation needed.

### Anti-Pattern 2: Embedding Proxy URL in the Package

**What people do:** Hardcode a cloud proxy URL (e.g., `https://proxy.govynai.com`) as the default in the SDK.

**Why it's wrong:** The proxy is self-hosted — users run it locally or in their own infrastructure. A hardcoded cloud URL would break self-hosted setups and imply a SaaS dependency that doesn't exist yet.

**Do this instead:** Default to `http://localhost:4000` (local dev default). Allow override via constructor arg or `GOVYN_PROXY_URL` env var.

### Anti-Pattern 3: Making `agent_id` Optional

**What people do:** Make `agent_id` optional with a fallback like `"default"` or `"unknown"`.

**Why it's wrong:** The entire value of Govyn is per-agent governance. An SDK that silently uses `"unknown"` defeats the purpose — all costs go to unknown, all budgets are unenforced.

**Do this instead:** Make `agent_id` a required parameter. Raise `ValueError` if not provided and `GOVYN_AGENT_ID` env var is also not set.

### Anti-Pattern 4: Wrapping Rather Than Extending

**What people do:** Create a `GovynClient` with a `.openai` and `.anthropic` property that holds the real client.

**Why it's wrong:** Breaks drop-in replacement — user has to change every API call from `client.chat.completions.create(...)` to `client.openai.chat.completions.create(...)`.

**Do this instead:** Extend via subclassing. `GovynOpenAI` IS an `OpenAI` — same attribute access, same method calls, same type hints.

### Anti-Pattern 5: Separate Package Per Provider

**What people do:** Publish `govynai-openai` and `govynai-anthropic` as separate packages.

**Why it's wrong:** Fragmented install experience. Users want `pip install govynai` and be done.

**Do this instead:** One package, multiple classes. Optional dependencies (extras) for each provider if needed: `pip install govynai[openai]`, `pip install govynai[anthropic]`, `pip install govynai[all]`.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Single proxy, local dev | Default `proxy_url=http://localhost:4000`; no changes needed |
| Team deployment (Docker/VPS) | Users set `GOVYN_PROXY_URL=http://proxy.internal:4000`; no SDK code changes |
| Multi-region proxy | SDK is stateless — just change `proxy_url`; proxy itself handles regional deployment |
| High-throughput agents | SDK is a thin constructor wrapper; no SDK-side bottlenecks; proxy is the scaling surface |

## Sources

- [openai/openai-python GitHub](https://github.com/openai/openai-python) — `base_url`, `default_headers`, `api_key` constructor params (HIGH confidence — official repo)
- [anthropics/anthropic-sdk-python GitHub](https://github.com/anthropics/anthropic-sdk-python) — same constructor pattern (HIGH confidence)
- [openai/openai-node GitHub](https://github.com/openai/openai-node) — `baseURL`, `defaultHeaders` constructor options (HIGH confidence)
- [anthropics/anthropic-sdk-typescript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) — `baseURL`, `apiKey`, `defaultHeaders` (HIGH confidence)
- Govyn source: `src/agents.ts` lines 30-33 — X-Govyn-Agent header already handled (HIGH confidence — source code)
- Govyn source: `src/providers/openai.ts` line 41 — x-govyn-agent already in forwarded headers list (HIGH confidence — source code)
- Govyn source: `src/router.ts` — `/v1/openai/*` and `/v1/anthropic/*` routes confirmed (HIGH confidence — source code)
- LiteLLM proxy integration pattern (MEDIUM confidence — widely-used precedent for base_url override SDKs)

---
*Architecture research for: Govyn Python SDK + Node.js SDK (v1.3)*
*Researched: 2026-02-28*
