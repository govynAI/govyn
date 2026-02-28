# Stack Research

**Domain:** Python SDK + Node.js SDK (drop-in proxy wrappers for openai/anthropic clients)
**Researched:** 2026-02-28
**Confidence:** HIGH

## Context

This is a subsequent-milestone research document. The Govyn proxy (Node.js/TypeScript, <5ms overhead, SSE passthrough, versioned routes `/v1/openai/*` and `/v1/anthropic/*`) is fully operational. The task is to ship two SDKs that make onboarding frictionless: agents call `GovynOpenAI(...)` or `GovynAnthropic(...)` and the proxy is transparently in the middle with zero other code changes.

The core insight driving both SDKs: the official openai and anthropic client libraries already support a `base_url` / `baseURL` constructor parameter. The entire SDK is a thin wrapper that pre-wires that parameter to the Govyn proxy URL, injects the `X-Govyn-Agent` header, and validates configuration. No HTTP reimplementation required.

---

## Python SDK

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `openai` | `>=2.0.0, <3` | Upstream client being wrapped (OpenAI path) | Latest major; openai-agents-python mandates v2.x, not v1.x. `base_url` and `http_client` constructor params are stable. [HIGH confidence — PyPI releases Feb 2026] |
| `anthropic` | `>=0.84.0, <1` | Upstream client being wrapped (Anthropic path) | Latest stable (0.84.0 released Feb 25, 2026). `base_url` constructor param is supported. [HIGH confidence — PyPI] |
| `httpx` | `>=0.25.0, <1` | HTTP transport shared by both upstream clients | Both openai (requires `>=0.23.0`) and anthropic (requires `>=0.25.0`) already pull this in. No additional dependency needed — use `httpx.Client` / `httpx.AsyncClient` for custom header injection. [HIGH confidence — both pyproject.tomls verified] |
| Python | `>=3.9` | Minimum runtime | Both openai and anthropic SDKs require 3.9+. Aligns with current ecosystem; 3.9 goes EOL Oct 2025 but still widely deployed. [HIGH confidence — official pyproject.toml files] |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `hatchling` | `>=1.27` | Build backend | Modern PEP 517 build backend; preferred over setuptools for new packages. govynai is already on PyPI — migrate pyproject.toml from setuptools to hatchling for cleaner config. [MEDIUM confidence — packaging.python.org] |
| `pytest` | `>=8.0` | Test runner | Standard; already used in the Node side via vitest convention. |
| `pytest-asyncio` | `>=0.24` | Async test support | `openai.AsyncOpenAI` and `anthropic.AsyncAnthropic` need async test fixtures. Required for streaming tests. [HIGH confidence — pytest-asyncio PyPI] |
| `respx` | `>=0.22` | Mock httpx requests in tests | RESPX intercepts httpx at the transport layer — same layer used by openai/anthropic SDKs. Correct tool for testing that requests reach the right proxy URL with right headers, without hitting a real proxy. [HIGH confidence — respx docs, HTTPX third-party page] |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `hatch` | Build/publish/env management | Matches hatchling build backend; `hatch build` produces wheel + sdist for PyPI upload |
| `mypy` | Static type checking | Both openai and anthropic ship complete type stubs — govynai wrapper should match their type signatures exactly to be a true drop-in |
| `ruff` | Linting + formatting | Fast, single-tool replacement for flake8+isort+black. The Python analog to the project's existing eslint setup |

### Pattern: How the Python SDK Works

The official clients expose `base_url` and `http_client` constructor params:

```python
# openai v2.x
from openai import OpenAI, AsyncOpenAI
client = OpenAI(
    api_key="any-govyn-api-key",
    base_url="http://localhost:4000/v1/openai",
    http_client=httpx.Client(headers={"X-Govyn-Agent": "my-agent"})
)

# anthropic v0.84+
from anthropic import Anthropic, AsyncAnthropic
client = Anthropic(
    api_key="any-govyn-api-key",
    base_url="http://localhost:4000/v1/anthropic",
    http_client=httpx.Client(headers={"X-Govyn-Agent": "my-agent"})
)
```

The govynai SDK wraps this pattern behind `GovynOpenAI` / `GovynAnthropic` classes:

```python
# What users write
from govynai import GovynOpenAI
client = GovynOpenAI(agent="my-agent")

# Full equivalence — inherits openai.OpenAI; every method works identically
```

### Installation

```bash
# Package dependencies (declared in pyproject.toml)
# openai>=2.0.0,<3
# anthropic>=0.84.0,<1
# httpx>=0.25.0,<1

# Dev
pip install hatch
hatch run test
```

---

## Node.js SDK

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `openai` | `>=4.0.0, <7` (peer) | Upstream client being wrapped (OpenAI path) | npm package `openai` latest is v6.2.0 (Feb 2026). `baseURL` constructor param is stable across v4/v5/v6. Declare as peerDependency — agent's environment already has it installed. [HIGH confidence — npm, WebSearch] |
| `@anthropic-ai/sdk` | `>=0.70.0, <1` (peer) | Upstream client being wrapped (Anthropic path) | Latest is 0.78.0. `baseURL` and `defaultHeaders` constructor params supported. Declare as peerDependency. [HIGH confidence — npm] |
| TypeScript | `>=5.0` | Language | Existing project uses TS 5.7.3. SDK must ship `.d.ts` declarations to be a true drop-in (consumers get the same autocomplete as with openai/anthropic directly) |
| Node.js | `>=20` | Minimum runtime | Matches existing proxy constraint (`engines.node: >=20`). openai npm requires Node 20 LTS or later. [HIGH confidence — openai npm page] |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | `>=4.19` | Dev: TypeScript execution | Already in project devDependencies — reuse for SDK development |
| `vitest` | `>=3.0` | Test runner | Already in project — extend vitest.config.ts workspace config to include `sdk-node/` package. [HIGH confidence — vitest docs] |
| `@types/node` | `>=22` | Node type definitions | Already in project devDependencies |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsc` | Build SDK to `dist/` | Reuse existing `tsconfig.json` pattern; add `sdk-node/tsconfig.json` that emits to `sdk-node/dist/` |
| `vitest` | Test runner | Root-level vitest workspace config covers all packages — no separate test runner needed |
| `eslint` | Linting | Reuse existing `eslint.config.js` |

### Pattern: How the Node.js SDK Works

Both official clients expose `baseURL` in their constructor `ClientOptions`:

```typescript
// openai v6
import OpenAI from 'openai';
const client = new OpenAI({
  apiKey: "any-govyn-api-key",
  baseURL: "http://localhost:4000/v1/openai",
  defaultHeaders: { "X-Govyn-Agent": "my-agent" }
});

// @anthropic-ai/sdk v0.78
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: "any-govyn-api-key",
  baseURL: "http://localhost:4000/v1/anthropic",
  defaultHeaders: { "X-Govyn-Agent": "my-agent" }
});
```

The govyn SDK wraps this via subclassing:

```typescript
// What users write
import { GovynOpenAI } from 'govyn';
const client = new GovynOpenAI({ agent: 'my-agent' });

// Inherits openai.OpenAI — every method, type, and overload works identically
```

### Installation

```bash
# User installs:
npm install govyn

# User's project must already have (peer dependencies):
npm install openai @anthropic-ai/sdk
```

---

## Monorepo Structure

Both SDKs live inside the existing monorepo. No new repository needed.

```
govyn/
  src/                    # existing proxy (Node.js)
  sdk-python/             # NEW: Python SDK package
    govynai/
      __init__.py         # GovynOpenAI, GovynAnthropic exports
      openai.py
      anthropic.py
    tests/
    pyproject.toml
  sdk-node/               # NEW: TypeScript SDK package
    src/
      index.ts            # GovynOpenAI, GovynAnthropic exports
    tests/
    package.json
    tsconfig.json
  package.json            # existing (proxy + govyn npm package)
  pyproject.toml          # existing placeholder → migrate here or keep sdk-python's own
```

The govyn npm package (`package.json` at root) is the vehicle for the Node.js SDK — add `sdk-node/` exports to the existing package rather than creating a new npm package. This keeps `npm install govyn` as the one-liner users need.

The Python package `govynai` gets its own `sdk-python/pyproject.toml` with proper package config (the root `pyproject.toml` is currently a placeholder).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Subclass `openai.OpenAI` directly | Reimplement the HTTP client | Never — any proxy SDK that reimplements HTTP loses full API compatibility by definition. Subclassing delegates all methods to the parent and gets free upgrades. |
| `respx` for Python test mocking | `pytest-httpx` | Either works; respx has cleaner route-pattern API and better SSE/streaming support in recent versions |
| `hatchling` build backend (Python) | `setuptools` (current) | If the project already had complex packaging needs (C extensions, data files) — but a pure-Python SDK doesn't need setuptools |
| peerDependencies for openai/anthropic (Node.js) | bundled dependencies | Bundling would conflict with the agent's existing openai installation and create two incompatible openai instances |
| Extend existing `govyn` npm package | Publish `govynai-js` separately | Separate package adds friction; agent devs already `npm install govyn` for proxy setup. Single package wins. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `openai` v1.x (Python) | openai-agents-python requires v2.x; v1.x is EOL for the agentic ecosystem | `openai>=2.0.0,<3` |
| `aiohttp` as HTTP client | openai/anthropic SDKs use httpx natively; mixing clients adds unnecessary dependency | `httpx` (already a transitive dep) |
| `requests` (Python) | Synchronous only, no native SSE streaming; incompatible with openai/anthropic's httpx-based transport | `httpx` |
| Monkey-patching `openai.api_base` | Pre-v1.0 pattern, removed in openai v1.x; breaks with every upstream upgrade | `base_url` constructor param |
| `axios` for Node.js SDK HTTP | openai/anthropic Node SDKs use native fetch (Node 20+); no need for axios | Native fetch via upstream SDK |
| Publishing a separate `govynai-js` npm package | Requires users to install two packages and remember two names | Extend the existing `govyn` npm package |
| `unittest.mock.patch` on upstream SDK internals | Brittle, breaks on upstream refactors | `respx` (mocks at transport level, not implementation level) |

---

## Stack Patterns by Variant

**If agent uses openai Python client today:**
- `from govynai import GovynOpenAI` — one import swap, zero other changes
- All `client.chat.completions.create(...)` calls work identically
- Streaming (`stream=True`) works because the proxy already handles SSE passthrough

**If agent uses anthropic Python client today:**
- `from govynai import GovynAnthropic` — one import swap
- All `client.messages.create(...)` calls work identically

**If agent uses openai Node.js client today:**
- `import { GovynOpenAI } from 'govyn'` — one import swap
- TypeScript types are preserved (GovynOpenAI extends OpenAI)

**If agent uses @anthropic-ai/sdk Node.js client today:**
- `import { GovynAnthropic } from 'govyn'` — one import swap
- TypeScript types preserved (GovynAnthropic extends Anthropic)

**If agent uses both openai and anthropic:**
- Replace each independently; the SDK exports both classes
- Agent identification (`agent` param) is per-client, not global

**If agent developer self-hosts Govyn proxy:**
- `GovynOpenAI({ agent: "...", proxyUrl: "http://my-proxy:4000" })`
- Default `proxyUrl` resolves to `http://localhost:4000`

**If agent developer uses Govyn cloud:**
- `GovynOpenAI({ agent: "...", apiKey: "gvn_xxx", proxyUrl: "https://proxy.govynai.com" })`

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `openai>=2.0.0` (Python) | `httpx>=0.23.0,<1` | openai v2.x requires httpx >=0.23; govynai requires >=0.25 (anthropic constraint) |
| `anthropic>=0.84.0` (Python) | `httpx>=0.25.0,<1` | Sets the floor for httpx version in govynai |
| `openai` npm `>=4.0.0` | Node.js `>=20` | v4+ uses native fetch; no polyfill needed on Node 20 |
| `@anthropic-ai/sdk` npm `>=0.70.0` | Node.js `>=18` | Node 18+ supported; Govyn proxy requires 20 anyway |
| `govynai` (Python) | Python `>=3.9` | Set by anthropic SDK floor |
| `govyn` (Node.js) | Node.js `>=20` | Set by proxy's existing engine constraint |

---

## Sources

- [openai/openai-python pyproject.toml](https://github.com/openai/openai-python/blob/main/pyproject.toml) — httpx `>=0.23.0,<1`, Python `>=3.9`, version 2.24.0 confirmed [HIGH confidence]
- [anthropics/anthropic-sdk-python pyproject.toml](https://github.com/anthropics/anthropic-sdk-python/blob/main/pyproject.toml) — httpx `>=0.25.0,<1`, Python `>=3.9`, version 0.84.0 confirmed [HIGH confidence]
- [openai npm package](https://www.npmjs.com/package/openai) — v6.2.0, Node 20+, ESM+CJS [HIGH confidence]
- [@anthropic-ai/sdk npm package](https://www.npmjs.com/package/@anthropic-ai/sdk) — v0.78.0, `baseURL` constructor param confirmed [HIGH confidence]
- [DeepWiki: openai-python custom HTTP clients](https://deepwiki.com/openai/openai-python/7.4-custom-http-clients-and-proxies) — `base_url`, `http_client`, `DefaultHttpxClient` params [MEDIUM confidence — DeepWiki, not official]
- [Liona Docs: Anthropic SDK base_url](https://liona.ai/docs/connecting/anthropic-sdk) — `baseURL` in Anthropic TS SDK constructor confirmed [MEDIUM confidence]
- [respx PyPI](https://pypi.org/project/respx/) — httpx transport-level mocking, Python >=3.8, HTTPX >=0.25 [HIGH confidence]
- [pytest-asyncio PyPI](https://pypi.org/project/pytest-asyncio/) — async test support [HIGH confidence]
- [Python Packaging User Guide — pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/) — hatchling as preferred build backend [HIGH confidence]
- [Vitest monorepo setup](https://www.thecandidstartup.org/2025/09/08/vitest-3-monorepo-setup.html) — workspace config for multi-package monorepos [MEDIUM confidence]

---

*Stack research for: Python SDK + Node.js SDK drop-in proxy wrappers (Govyn v1.3)*
*Researched: 2026-02-28*
