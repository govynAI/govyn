# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across phases grouped into milestones.

## Milestones

- ✅ **v1.0 Core Proxy MVP** — Phases 1-5 (shipped 2026-02-25)
- ✅ **v1.1 Policy Engine** — Phases 6-9.1 (shipped 2026-02-26)
- ✅ **v1.2 Dashboard & Governance Platform** — Phases 10-15 (shipped 2026-02-28)
- 🚧 **v1.3 Framework SDKs** — Phases 16-20 (in progress)

## Phases

<details>
<summary>✅ v1.0 Core Proxy MVP (Phases 1-5) — SHIPPED 2026-02-25</summary>

- [x] Phase 1: Proxy Server Foundation (2/2 plans) — completed 2026-02-24
- [x] Phase 2: Agent Identification & Cost Tracking (2/2 plans) — completed 2026-02-24
- [x] Phase 3: Budget Enforcement & Loop Detection (2/2 plans) — completed 2026-02-25
- [x] Phase 4: Action Logging (2/2 plans) — completed 2026-02-25
- [x] Phase 5: Packaging, Testing & Deployment (4/4 plans) — completed 2026-02-25

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Policy Engine (Phases 6-9.1) — SHIPPED 2026-02-26</summary>

- [x] Phase 6: Policy Schema & Core Engine (3/3 plans) — completed 2026-02-25
- [x] Phase 7: Policy Rule Types (2/2 plans) — completed 2026-02-25
- [x] Phase 7.1: Fix Policy Engine Integration Bugs (1/1 plan) — completed 2026-02-25
- [x] Phase 8: Smart Model Routing (2/2 plans) — completed 2026-02-25
- [x] Phase 9: Hot Reload, CLI & Policy Templates (3/3 plans) — completed 2026-02-26
- [x] Phase 9.1: Parser Validation & Tech Debt Cleanup (1/1 plan) — completed 2026-02-26

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

<details>
<summary>✅ v1.2 Dashboard & Governance Platform (Phases 10-15) — SHIPPED 2026-02-28</summary>

- [x] Phase 10: Data Persistence & Proxy API (2/2 plans) — completed 2026-02-26
- [x] Phase 11: Dashboard Foundation (3/3 plans) — completed 2026-02-27
- [x] Phase 12: Cost & Budget Views (3/3 plans) — completed 2026-02-28
- [x] Phase 13: Policy Management UI (2/2 plans) — completed 2026-02-28
- [x] Phase 14: Approval Queue UI (2/2 plans) — completed 2026-02-28
- [x] Phase 15: Alert Configuration & Delivery (2/2 plans) — completed 2026-02-28

Full details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

</details>

### 🚧 v1.3 Framework SDKs (In Progress)

**Milestone Goal:** Python and Node.js drop-in SDK replacements for openai/anthropic clients, routing all LLM calls through the Govyn proxy with per-agent identification, typed governance errors, integration tests, and LangChain/CrewAI support.

- [x] **Phase 16: SDK Specification** — Shared spec document defining header names, env vars, error codes, URL conventions, and API key convention across both SDKs
- [ ] **Phase 17: Python SDK** — `govynai` package on PyPI — GovynOpenAI, GovynAsyncOpenAI, GovynAnthropic, GovynAsyncAnthropic, typed errors, check_proxy(), env vars, py.typed
- [ ] **Phase 18: Node.js SDK** — `govyn` npm package — GovynOpenAI, GovynAnthropic, typed errors, checkProxy(), TypeScript declarations, dual CJS+ESM build
- [ ] **Phase 19: Integration Tests** — Live proxy end-to-end test suite verifying routing correctness, agent header forwarding, and streaming SSE passthrough for both SDKs
- [ ] **Phase 20: Documentation & Framework Integration** — Example scripts, SDK READMEs with hero quickstarts, LangChain integration routing through GovynOpenAI, CrewAI compatibility via LangChain

## Phase Details

### Phase 16: SDK Specification

**Goal**: A versioned shared spec document defines the constants, conventions, and error codes that both SDKs must implement identically, eliminating cross-language inconsistency before any code is written
**Depends on**: Phase 15 (v1.2 complete)
**Requirements**: SPEC-01, SPEC-02
**Success Criteria** (what must be TRUE):
  1. A spec document exists at `sdk-spec.md` listing the canonical header name (`X-Govyn-Agent`), env vars (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`), default proxy URL, and `max_retries=0` requirement
  2. The spec defines the API key convention — placeholder `"govyn-passthrough"` for passthrough mode vs. scoped `gvn_*` keys for key-storage mode, with guidance on which to use
  3. The spec defines all error codes (`budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected`) used by both SDKs for typed error parsing
**Plans**: 1 plan

Plans:
- [x] 16-01: Write sdk-spec.md — constants, URL construction, headers, API key convention, error codes, health check, and behavioral rules

### Phase 17: Python SDK

**Goal**: Users can replace `openai.OpenAI()` or `anthropic.Anthropic()` with `GovynOpenAI()` or `GovynAnthropic()` and have all their existing code work unchanged, with governance enforced through the proxy
**Depends on**: Phase 16
**Requirements**: PSDK-01, PSDK-02, PSDK-03, PSDK-04, PSDK-05, PSDK-06, PSDK-07, PSDK-08, PSDK-09, PSDK-10
**Success Criteria** (what must be TRUE):
  1. User can replace `openai.OpenAI()` / `openai.AsyncOpenAI()` with `GovynOpenAI(agent_id=...)` / `GovynAsyncOpenAI(agent_id=...)` and all subsequent API calls work without any other code change
  2. User can replace `anthropic.Anthropic()` / `anthropic.AsyncAnthropic()` with `GovynAnthropic(agent_id=...)` / `GovynAsyncAnthropic(agent_id=...)` and all subsequent API calls work without any other code change
  3. User can set `GOVYN_PROXY_URL` and `GOVYN_AGENT_ID` environment variables instead of passing constructor arguments, and the SDK reads them automatically
  4. User receives a `GovynBudgetExceededError` or `GovynLoopDetectedError` with a clear human-readable message when the proxy enforces a governance rule, not a generic HTTP error
  5. `pip install govynai` installs the SDK from PyPI and the package includes a `py.typed` marker so type checkers recognize it
**Plans**: TBD

Plans:
- [x] 17-01: Create `python-sdk/` package structure with `hatchling` build config, `pyproject.toml`, `govynai/__init__.py`, and `py.typed` marker
- [x] 17-02: Implement `GovynOpenAI` and `GovynAsyncOpenAI` classes with base URL construction, header injection, max_retries override, and env var resolution
- [x] 17-03: Implement `GovynAnthropic` and `GovynAsyncAnthropic` classes, `GovynBudgetExceededError`, `GovynLoopDetectedError`, and `check_proxy()` utility
- [ ] 17-04: Write pytest + pytest-asyncio + respx test suite; publish to PyPI

### Phase 18: Node.js SDK

**Goal**: Users can replace `new OpenAI()` or `new Anthropic()` with `new GovynOpenAI({agentId: ...})` or `new GovynAnthropic({agentId: ...})` and have all their existing TypeScript/JavaScript code work unchanged, with both ESM and CJS consumers supported
**Depends on**: Phase 16
**Requirements**: NSDK-01, NSDK-02, NSDK-03, NSDK-04, NSDK-05, NSDK-06, NSDK-07, NSDK-08, NSDK-09
**Success Criteria** (what must be TRUE):
  1. User can replace `new OpenAI()` with `new GovynOpenAI({agentId: ...})` and all subsequent API calls work without any other code change
  2. User can replace `new Anthropic()` with `new GovynAnthropic({agentId: ...})` and all subsequent API calls work without any other code change
  3. User receives `GovynBudgetExceededError` or `GovynLoopDetectedError` with a clear message when governance triggers, and can import these types with full TypeScript declarations
  4. The package works with both `import` (ESM) and `require` (CJS) — explicitly verified with a CJS require test before publishing
  5. `npm install govyn` installs the SDK and the package ships full `.d.ts` and `.d.cts` TypeScript declarations
**Plans**: TBD

Plans:
- [ ] 18-01: Set up `sdk/` directory with `tsup` dual CJS+ESM build, `package.json` exports map, peer dependencies, and vitest workspace config
- [ ] 18-02: Implement `GovynOpenAI`, `GovynAnthropic`, `GovynBudgetExceededError`, `GovynLoopDetectedError`, `checkProxy()`, env var resolution, and vitest tests; publish to npm

### Phase 19: Integration Tests

**Goal**: A test suite spins up a live Govyn proxy and runs both SDK wrappers through real end-to-end proxy calls, verifying correct routing, agent identification, and streaming passthrough — not mocked transport
**Depends on**: Phase 17, Phase 18
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Running the integration test suite starts a local Govyn proxy, makes SDK calls through it, and all tests pass without manual setup
  2. Tests confirm that base URL path construction produces the correct proxy routing path with no silent 404s (double-slash or missing segment)
  3. Tests confirm that the `X-Govyn-Agent` header is forwarded on every request and the proxy correctly identifies the agent
  4. Tests confirm that streaming SSE responses pass through both SDK wrappers and deliver chunks to the caller
**Plans**: TBD

Plans:
- [ ] 19-01: Build integration test harness (live proxy startup, teardown, shared fixtures) and write tests for routing correctness, agent header forwarding, and streaming SSE passthrough for both SDKs

### Phase 20: Documentation & Framework Integration

**Goal**: Users can migrate from raw openai/anthropic clients in two lines of code following the quickstart in each SDK README, and LangChain / CrewAI users can route their agent calls through Govyn without any extra configuration
**Depends on**: Phase 17, Phase 18
**Requirements**: DOCS-01, DOCS-02, DOCS-03, FWRK-01, FWRK-02
**Success Criteria** (what must be TRUE):
  1. A Python example script exists showing the before/after migration (add one import, change one constructor) with no other code changes required
  2. A Node.js example script exists showing the before/after migration with no other code changes required
  3. Both SDK READMEs open with a hero code block showing the 2-line migration and install command
  4. A user can pass a `GovynOpenAI` instance as the LangChain LLM and have all LangChain LLM calls route through Govyn with the configured agent ID
  5. A CrewAI agent configured with a `GovynOpenAI` LLM instance routes all calls through Govyn via the LangChain integration
**Plans**: TBD

Plans:
- [ ] 20-01: Write Python and Node.js example scripts, update both SDK READMEs with hero quickstarts, implement and test LangChain integration that routes through `GovynOpenAI`, verify CrewAI compatibility via LangChain integration

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Proxy Server Foundation | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Agent Identification & Cost Tracking | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Budget Enforcement & Loop Detection | v1.0 | 2/2 | Complete | 2026-02-25 |
| 4. Action Logging | v1.0 | 2/2 | Complete | 2026-02-25 |
| 5. Packaging, Testing & Deployment | v1.0 | 4/4 | Complete | 2026-02-25 |
| 6. Policy Schema & Core Engine | v1.1 | 3/3 | Complete | 2026-02-25 |
| 7. Policy Rule Types | v1.1 | 2/2 | Complete | 2026-02-25 |
| 7.1 Fix Policy Engine Integration Bugs | v1.1 | 1/1 | Complete | 2026-02-25 |
| 8. Smart Model Routing | v1.1 | 2/2 | Complete | 2026-02-25 |
| 9. Hot Reload, CLI & Policy Templates | v1.1 | 3/3 | Complete | 2026-02-26 |
| 9.1 Parser Validation & Tech Debt Cleanup | v1.1 | 1/1 | Complete | 2026-02-26 |
| 10. Data Persistence & Proxy API | v1.2 | 2/2 | Complete | 2026-02-26 |
| 11. Dashboard Foundation | v1.2 | 3/3 | Complete | 2026-02-27 |
| 12. Cost & Budget Views | v1.2 | 3/3 | Complete | 2026-02-28 |
| 13. Policy Management UI | v1.2 | 2/2 | Complete | 2026-02-28 |
| 14. Approval Queue UI | v1.2 | 2/2 | Complete | 2026-02-28 |
| 15. Alert Configuration & Delivery | v1.2 | 2/2 | Complete | 2026-02-28 |
| 16. SDK Specification | v1.3 | Complete    | 2026-03-01 | 2026-03-01 |
| 17. Python SDK | v1.3 | 3/4 | In progress | - |
| 18. Node.js SDK | v1.3 | 0/2 | Not started | - |
| 19. Integration Tests | v1.3 | 0/1 | Not started | - |
| 20. Documentation & Framework Integration | v1.3 | 0/1 | Not started | - |
