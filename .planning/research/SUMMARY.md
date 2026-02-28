# Project Research Summary

**Project:** Govyn v1.3 — Python SDK (govynai) + Node.js SDK (govyn)
**Domain:** Drop-in proxy wrapper SDKs for openai and anthropic AI clients
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

Govyn v1.3 ships two thin client SDKs that make the existing governance proxy frictionless to adopt. The fundamental insight confirmed across all four research areas is that both the OpenAI and Anthropic client libraries already accept a `base_url`/`baseURL` constructor parameter, meaning the SDK is not an HTTP reimplementation — it is a subclass that pre-wires three things: the proxy URL, the `X-Govyn-Agent` identification header, and a placeholder API key. The entire implementation surface is small: four Python classes (`GovynOpenAI`, `GovynAsyncOpenAI`, `GovynAnthropic`, `GovynAsyncAnthropic`) and two TypeScript classes (`GovynOpenAI`, `GovynAnthropic`). Users change one import line and one constructor call; every subsequent API call is identical to their current code.

The recommended approach is subclassing the official SDK clients rather than wrapping or reimplementing. This gives zero maintenance overhead for new upstream features (structured outputs, new model names, realtime API), preserves full type safety for TypeScript consumers, and ensures streaming SSE passthrough works without any SDK-side code. The proxy already handles all governance — budget enforcement, policy evaluation, loop detection, cost tracking — so the SDK's job is purely routing and identification. Both SDKs live in the existing monorepo (`sdk/` for Node.js, `python-sdk/` for Python) as independently publishable packages.

The key risks are operational rather than architectural. SDK-level retry logic (`max_retries=2` default in both openai and anthropic clients) causes double billing and spurious loop detection if not overridden. Base URL construction is non-obvious and produces silent 404s when wrong. The Node.js SDK must ship a dual CJS/ESM build to work across the full ecosystem. The agent header must be injected via `default_headers` at the constructor, not per-request, and must be validated as required at construction time — if it silently defaults to "unknown", all governance is effectively disabled with no error surfaced. All of these risks have known solutions documented in the research.

## Key Findings

### Recommended Stack

Both SDKs follow the same dependency model: subclass the official upstream client, use `httpx` (already a transitive dependency) for any custom transport configuration, and declare the upstream client as a pinned dependency (Python) or peer dependency (Node.js). No new HTTP infrastructure is needed. The Python package targets Python 3.9+ with `openai>=2.0.0,<3` and `anthropic>=0.84.0,<1`; tests use `pytest` + `pytest-asyncio` + `respx` for transport-level mocking. The Node.js package targets Node 20+ with `openai>=4.0.0,<7` and `@anthropic-ai/sdk>=0.70.0,<1` declared as peer dependencies; tests use the existing vitest workspace. Build tooling is `hatchling`/`hatch` for Python and `tsc`/`tsup` for Node.js.

**Core technologies:**
- `openai>=2.0.0` (Python) / `openai>=4.0.0` (Node.js peer): Upstream client being subclassed for OpenAI path — stable `base_url`/`baseURL` constructor param confirmed against official repos
- `anthropic>=0.84.0` (Python) / `@anthropic-ai/sdk>=0.70.0` (Node.js peer): Upstream client being subclassed for Anthropic path — same constructor pattern confirmed
- `httpx>=0.25.0`: Shared HTTP transport already pulled in by both upstream clients; needed for `default_headers` injection in Python; no new dependency
- `respx>=0.22`: Python test mocking at the httpx transport layer — correct level for testing proxy URL construction and header injection without running a real proxy
- `tsup`: Node.js dual CJS+ESM build — required to avoid breaking CJS consumers in enterprise environments
- `pytest-asyncio>=0.24`: Required for testing `AsyncOpenAI`/`AsyncAnthropic` streaming paths in Python

### Expected Features

The ecosystem gold standard (Portkey, Helicone, LiteLLM) is a one-import-swap with full API compatibility. Users test the SDK by searching for `openai.` calls — if anything other than the import and constructor changes, the SDK fails the drop-in test. Feature research is split between what must ship in v1.3 and what should wait for user validation.

**Must have (table stakes) — v1.3:**
- `GovynOpenAI` + `GovynAsyncOpenAI` (Python) and `GovynOpenAI` (Node.js) — core wrappers around openai client
- `GovynAnthropic` + `GovynAsyncAnthropic` (Python) and `GovynAnthropic` (Node.js) — core wrappers around anthropic client
- `GOVYN_PROXY_URL` and `GOVYN_AGENT_ID` environment variable support — 12-factor app configuration
- `GovynBudgetExceededError` and `GovynLoopDetectedError` typed exceptions — parse `error.code` from proxy 429 responses
- `check_proxy()` / `checkProxy()` health check utility — verifies proxy reachability before governance errors confuse users
- Published to PyPI as `govynai` and npm as `govyn` with TypeScript declarations and `py.typed` marker

**Should have (differentiators) — v1.3.x after validation:**
- `GovynPolicyDeniedError` — typed exception for 403 policy blocks; add when users report 403 confusion
- Budget warning response attribute (`X-Govyn-Budget-Warning` header surfaced on response object) — add when programmatic budget awareness is requested
- `govynai.configure()` module-level defaults — add when LangChain integration requests arrive

**Defer (v2+):**
- OpenTelemetry export integration — separate milestone, scope creep for SDK launch
- LangChain / CrewAI / AutoGen framework callback handlers — ship as separate packages (`govynai-langchain`), driven by demand signal
- Govyn Agent SDK (higher-level multi-provider abstraction) — different product category

### Architecture Approach

The SDK layer sits entirely above the existing proxy, which requires no changes. Each SDK class extends its upstream counterpart (`GovynOpenAI extends openai.OpenAI`, etc.) and overrides only the constructor to pre-wire `base_url`/`baseURL` to `{proxy_url}/v1/openai` or `/v1/anthropic`, inject `X-Govyn-Agent: {agent_id}` via `default_headers`/`defaultHeaders`, set `max_retries=0`, and use a placeholder or govyn-scoped API key. All API methods, return types, streaming behavior, and exception shapes are inherited unchanged. Two directory trees are created: `sdk/` for the Node.js package and `python-sdk/` for the Python package, each with independent publish configuration.

**Major components:**
1. `GovynOpenAI` / `GovynAnthropic` classes (both languages) — thin constructor-override subclasses; the entire implementation per class is ~30 lines
2. Environment variable resolution layer — reads `GOVYN_PROXY_URL` and `GOVYN_AGENT_ID` with constructor args taking precedence; raises clear error if agent ID is absent
3. Govyn error parsing layer — intercepts 429/403 proxy responses before surface as generic HTTP errors; maps `error.code` to typed exception types
4. Package entrypoints — `govynai/__init__.py` and `sdk/src/index.ts` re-export all classes and utilities
5. Existing proxy core (`src/`) — zero changes required; `resolveAgentId()` already handles `X-Govyn-Agent` as priority-1 identifier

### Critical Pitfalls

1. **Base URL path construction (silent 404s)** — Set `base_url` to `{proxy_url}/v1/openai` (not the server root, not the full path). The SDK must auto-construct this so users never specify it. Test with end-to-end integration against a real proxy to catch double-slash edge cases.
2. **SDK retry logic causes double billing and spurious loop detection** — Override `max_retries=0` in every SDK constructor. The proxy's budget enforcer counts each request independently; SDK retries are invisible to the proxy. Document why retries are disabled.
3. **Agent header not injected — governance silently disabled** — Use `default_headers={"X-Govyn-Agent": agent_id}` at construction, not per-request. Make `agent_id` a required parameter; raise `ValueError`/`Error` at construction if neither constructor arg nor `GOVYN_AGENT_ID` env var is set.
4. **ESM/CJS dual-format packaging (Node.js)** — Use `tsup` to produce both `dist/cjs/` and `dist/esm/` with `.d.ts` and `.d.cts` declarations. Test explicitly with `require()` from a CJS project before publishing.
5. **SSE stream connection pool exhaustion** — Test 25 sequential streaming requests in the same process to verify pool is released. Document use of context managers for streaming helpers.

## Implications for Roadmap

Based on research, the work naturally sequences into three phases: shared specification, Python SDK, Node.js SDK. The proxy is stable and unchanged; both SDK phases can proceed with high confidence against a live proxy.

### Phase 1: Shared SDK Specification

**Rationale:** Python and Node.js SDKs must use identical header names, environment variable names, error type names, and proxy URL conventions. Specifying these in a shared document before implementation prevents inconsistency that is expensive to fix post-publish. This is a 1-2 hour task, not a development phase — it gates both SDK phases.
**Delivers:** A versioned spec document (e.g., `sdk-spec.md`) defining: header name `X-Govyn-Agent`, env vars `GOVYN_PROXY_URL`/`GOVYN_AGENT_ID`, error codes (`budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected`, `policy_denied`), default proxy URL `http://localhost:4000`, `max_retries=0` requirement, placeholder API key convention (`"govyn-passthrough"`).
**Avoids:** Cross-SDK inconsistency that would confuse users switching between languages.

### Phase 2: Python SDK (govynai package)

**Rationale:** Python first for three reasons established in architecture research: (1) `govynai` is already claimed on PyPI and delivers immediate value, (2) Python is the dominant language for AI agent development, (3) simpler build pipeline with no compile step or dual-format requirement eases iteration. The streaming pitfall (pool exhaustion) applies primarily to the Python httpx transport.
**Delivers:** `govynai` published to PyPI — `GovynOpenAI`, `GovynAsyncOpenAI`, `GovynAnthropic`, `GovynAsyncAnthropic`, `GovynBudgetExceededError`, `GovynLoopDetectedError`, `check_proxy()`, env var support, `py.typed` marker, README quickstart.
**Stack:** Python 3.9+, `openai>=2.0.0`, `anthropic>=0.84.0`, `httpx>=0.25.0`, `hatchling` build, `pytest`+`pytest-asyncio`+`respx` for tests.
**Pitfalls to address:** base_url construction (Pitfall 1), SDK retries (Pitfall 2), stream pool exhaustion (Pitfall 3), `proxies=` removal (Pitfall 4), agent header injection (Pitfall 5), Anthropic version header passthrough (Pitfall 7).
**Sub-phases:** (a) OpenAI wrappers + tests, (b) Anthropic wrappers + tests, (c) error types + utilities, (d) package config + PyPI publish.

### Phase 3: Node.js SDK (govyn npm package)

**Rationale:** Node.js second because Python is higher-priority for initial users, and the Node.js build pipeline has one significant additional complexity (ESM/CJS dual-format) that should be tackled with confidence after the pattern is proven in Python.
**Delivers:** `govyn` npm package extended with `GovynOpenAI`, `GovynAnthropic`, `GovynBudgetExceededError`, `GovynLoopDetectedError`, `checkProxy()`, TypeScript declarations (`.d.ts` + `.d.cts`), CJS + ESM outputs.
**Stack:** TypeScript 5.x, Node 20+, `openai>=4.0.0` (peer), `@anthropic-ai/sdk>=0.70.0` (peer), `tsup` build, `vitest` tests.
**Pitfalls to address:** ESM/CJS dual-format (Pitfall 6), base_url construction (Pitfall 1), SDK retries (Pitfall 2), agent header injection (Pitfall 5).
**Note:** Clarify before starting whether SDK exports extend the existing `govyn` npm package root or publish under a sub-path (`govyn/sdk`). Architecture research flags this as unresolved.

### Phase Ordering Rationale

- Spec-first eliminates the most expensive category of bugs (cross-SDK inconsistency) with minimal time investment.
- Python before Node.js respects the AI agent ecosystem's language distribution and delivers user value faster given the PyPI name is already claimed.
- Both SDK phases are independent of each other and could run concurrently if two engineers are available — but sequentially is recommended to share learned patterns from Python → Node.js.
- No proxy changes are required in any phase, which means the proxy team is unblocked throughout.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Node.js SDK):** npm package structure needs clarification — whether to extend the existing `govyn` package exports or create a sub-package. The current `govyn` package is the proxy CLI; merging SDK exports requires careful `exports` field configuration to avoid bundling conflicts.
- **Phase 2 (Python SDK) — `extras_require`:** Whether to use `pip install govynai[openai]` / `govynai[anthropic]` optional extras or bundle both as required dependencies. Research indicates bundling both is simpler for v1.3; extras add complexity without clear user benefit when the package is small.

Phases with standard patterns (research not needed):
- **Phase 1 (Spec):** Writing a spec document — no research needed.
- **Phase 2 core implementation:** Subclassing `openai.OpenAI` is thoroughly documented in official repos and community precedents; the pattern is unambiguous.
- **Phase 3 core implementation:** Same subclass pattern; `tsup` dual-format is a solved problem with known configuration.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified against official PyPI and npm releases as of Feb 2026; constructor params confirmed against official SDK source code on GitHub |
| Features | HIGH | Core feature set derived from proxy source code (primary source); competitor analysis (Portkey, Helicone) cross-validates the ecosystem norm; anti-features have clear rationale grounded in Govyn's architecture |
| Architecture | HIGH | Component boundaries verified against existing proxy source (`src/agents.ts`, `src/router.ts`, `src/providers/*.ts`); subclass pattern confirmed against official upstream repos; integration points require no proxy changes |
| Pitfalls | HIGH | Each critical pitfall sourced to specific GitHub issues, community forum threads, or SDK changelogs with real-world reports; not speculative |

**Overall confidence:** HIGH

### Gaps to Address

- **npm package structure:** Whether SDK exports extend root `govyn` package or publish as a separate entry point needs a decision before Phase 3 begins. Options: (a) add `sdk/` exports to root `package.json` exports map, (b) publish `@govyn/sdk` as a scoped package, (c) use the existing `govyn` package with a `sdk` sub-path. Architecture research recommends option (a) but flags it as unresolved.
- **Python extras vs. bundled deps:** Feature research recommends bundling `openai` and `anthropic` as required deps for simplicity; STACK.md suggests optional extras pattern. Resolve before Phase 2 packaging step.
- **Govyn API key convention:** The `api_key` placeholder (`"govyn-passthrough"`) is used in examples, but the scoped API key path (`gvn_*`) is the stronger governance mode. Documentation should clearly differentiate the two modes; SDK error messages should guide users to the appropriate one.
- **Integration test infrastructure:** Both SDK phases require a live Govyn proxy instance for end-to-end tests. Whether this runs in CI (via Docker Compose) or is tested locally only needs to be decided before Phase 2 begins.

## Sources

### Primary (HIGH confidence)
- `src/agents.ts`, `src/router.ts`, `src/providers/openai.ts`, `src/providers/anthropic.ts` — existing proxy source confirming header handling, route patterns, and upstream forwarding behavior
- [openai/openai-python pyproject.toml](https://github.com/openai/openai-python/blob/main/pyproject.toml) — confirmed `httpx>=0.23.0`, Python `>=3.9`, version 2.24.0
- [anthropics/anthropic-sdk-python pyproject.toml](https://github.com/anthropics/anthropic-sdk-python/blob/main/pyproject.toml) — confirmed `httpx>=0.25.0`, Python `>=3.9`, version 0.84.0
- [openai npm](https://www.npmjs.com/package/openai) — v6.2.0, Node 20+, `baseURL` constructor param
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) — v0.78.0, `baseURL` + `defaultHeaders` confirmed
- [openai-python issue #763](https://github.com/openai/openai-python/issues/763) — streaming pool exhaustion (fixed 1.2.3)
- [OpenAI Community — proxies kwarg removed 1.56.0](https://community.openai.com/t/error-with-openai-1-56-0-client-init-got-an-unexpected-keyword-argument-proxies/1040332)
- [OpenAI Community — double-path 404 bug](https://community.openai.com/t/404-invalid-url-post-v1-chat-completions-chat-completions/680371)
- [respx PyPI](https://pypi.org/project/respx/) — transport-level httpx mocking

### Secondary (MEDIUM confidence)
- [Portkey Python SDK](https://github.com/Portkey-AI/portkey-python-sdk) — drop-in pattern via OpenAI SDK, competitor reference
- [Helicone — Proxy vs Async Integration](https://docs.helicone.ai/references/proxy-vs-async) — base_url + header injection pattern
- [DeepWiki: openai-python custom HTTP clients](https://deepwiki.com/openai/openai-python/7.4-custom-http-clients-and-proxies) — `base_url`, `http_client` params
- [TypeScript ESM/CJS dual publishing 2025](https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing) — dual-format complexity and tsup approach
- [Anthropic SDK request lifecycle](https://deepwiki.com/anthropics/anthropic-sdk-python/4.4-request-lifecycle-and-retry-logic) — `default_headers` merge order
- [Vitest monorepo setup](https://www.thecandidstartup.org/2025/09/08/vitest-3-monorepo-setup.html) — workspace config for multi-package monorepos

### Tertiary (LOW confidence — needs validation during implementation)
- `pip install govynai[openai]` optional extras pattern — PEP 508 standard but may add unnecessary complexity for v1.3; validate during Phase 2 packaging

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
