# Requirements: Govyn

**Defined:** 2026-02-28
**Core Value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level.

## v1.3 Requirements

Requirements for v1.3 Framework SDKs. Each maps to roadmap phases.

### Specification

- [ ] **SPEC-01**: Shared SDK spec defines header names (`X-Govyn-Agent`), env vars (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`), error codes, and URL conventions across both SDKs
- [ ] **SPEC-02**: Spec defines API key convention (placeholder `"govyn-passthrough"` vs scoped `gvn_*` keys)

### Python SDK

- [ ] **PSDK-01**: User can replace `openai.OpenAI()` with `GovynOpenAI(agent_id=...)` and all existing code works unchanged
- [ ] **PSDK-02**: User can replace `openai.AsyncOpenAI()` with `GovynAsyncOpenAI(agent_id=...)` for async usage
- [ ] **PSDK-03**: User can replace `anthropic.Anthropic()` with `GovynAnthropic(agent_id=...)` and all existing code works unchanged
- [ ] **PSDK-04**: User can replace `anthropic.AsyncAnthropic()` with `GovynAsyncAnthropic(agent_id=...)` for async usage
- [ ] **PSDK-05**: User can configure proxy URL and agent ID via environment variables instead of constructor args
- [ ] **PSDK-06**: User receives `GovynBudgetExceededError` with clear message when budget limit is hit
- [ ] **PSDK-07**: User receives `GovynLoopDetectedError` with clear message when loop detection triggers
- [ ] **PSDK-08**: User can call `check_proxy()` to verify proxy reachability before making API calls
- [ ] **PSDK-09**: Package includes `py.typed` marker for type checker support
- [ ] **PSDK-10**: User can `pip install govynai` to get the SDK from PyPI

### Node.js SDK

- [ ] **NSDK-01**: User can replace `new OpenAI()` with `new GovynOpenAI({agentId: ...})` and all existing code works unchanged
- [ ] **NSDK-02**: User can replace `new Anthropic()` with `new GovynAnthropic({agentId: ...})` and all existing code works unchanged
- [ ] **NSDK-03**: User can configure proxy URL and agent ID via environment variables instead of constructor args
- [ ] **NSDK-04**: User receives `GovynBudgetExceededError` with clear message when budget limit is hit
- [ ] **NSDK-05**: User receives `GovynLoopDetectedError` with clear message when loop detection triggers
- [ ] **NSDK-06**: User can call `checkProxy()` to verify proxy reachability before making API calls
- [ ] **NSDK-07**: Package ships full TypeScript declarations
- [ ] **NSDK-08**: Package works with both ESM (`import`) and CJS (`require`) consumers
- [ ] **NSDK-09**: User can `npm install govyn` to get the SDK from npm

### Integration Tests

- [ ] **TEST-01**: Test suite spins up live Govyn proxy and runs SDK calls through it end-to-end
- [ ] **TEST-02**: Tests verify base URL path construction produces correct proxy routing (no silent 404s)
- [ ] **TEST-03**: Tests verify `X-Govyn-Agent` header is forwarded and agent is correctly identified
- [ ] **TEST-04**: Tests verify streaming SSE passthrough works through SDK wrappers

### Examples & Documentation

- [ ] **DOCS-01**: Python example script demonstrates 2-line migration from `openai.OpenAI()` to `GovynOpenAI()`
- [ ] **DOCS-02**: Node.js example script demonstrates 2-line migration from `new OpenAI()` to `new GovynOpenAI()`
- [ ] **DOCS-03**: Both SDK READMEs include quickstart with hero code showing the migration

### Framework Integration

- [ ] **FWRK-01**: LangChain integration enables routing LangChain LLM calls through Govyn proxy with per-agent identification
- [ ] **FWRK-02**: CrewAI agents can route through Govyn via the LangChain integration

## Future Requirements

### Observability

- **OBSV-01**: Session replay with step-through and comparison views
- **OBSV-02**: Anomaly detection (cost spikes, error loops, deviation alerting)
- **OBSV-03**: OpenTelemetry export for traces and metrics

### Advanced SDK

- **ASDK-01**: GovynPolicyDeniedError typed exception for 403 policy blocks
- **ASDK-02**: Budget warning response attribute (X-Govyn-Budget-Warning header surfaced on response)
- **ASDK-03**: govynai.configure() module-level defaults for framework integration

### Framework Ecosystem

- **FECO-01**: LangChain callback handler as separate package (govynai-langchain)
- **FECO-02**: AutoGen integration package

## Out of Scope

| Feature | Reason |
|---------|--------|
| Govyn Agent SDK (multi-provider abstraction) | Different product category — SDKs are wrappers, not abstractions |
| OpenTelemetry integration | Separate milestone, scope creep for SDK launch |
| Stripe billing | Requires dashboard work, not SDK-related |
| Mobile apps | Web dashboard first |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SPEC-01 | — | Pending |
| SPEC-02 | — | Pending |
| PSDK-01 | — | Pending |
| PSDK-02 | — | Pending |
| PSDK-03 | — | Pending |
| PSDK-04 | — | Pending |
| PSDK-05 | — | Pending |
| PSDK-06 | — | Pending |
| PSDK-07 | — | Pending |
| PSDK-08 | — | Pending |
| PSDK-09 | — | Pending |
| PSDK-10 | — | Pending |
| NSDK-01 | — | Pending |
| NSDK-02 | — | Pending |
| NSDK-03 | — | Pending |
| NSDK-04 | — | Pending |
| NSDK-05 | — | Pending |
| NSDK-06 | — | Pending |
| NSDK-07 | — | Pending |
| NSDK-08 | — | Pending |
| NSDK-09 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |
| TEST-04 | — | Pending |
| DOCS-01 | — | Pending |
| DOCS-02 | — | Pending |
| DOCS-03 | — | Pending |
| FWRK-01 | — | Pending |
| FWRK-02 | — | Pending |

**Coverage:**
- v1.3 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after initial definition*
