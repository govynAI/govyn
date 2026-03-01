# Requirements: Govyn

**Defined:** 2026-02-28
**Core Value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level.

## v1.3 Requirements

Requirements for v1.3 Framework SDKs. Each maps to roadmap phases.

### Specification

- [x] **SPEC-01**: Shared SDK spec defines header names (`X-Govyn-Agent`), env vars (`GOVYN_PROXY_URL`, `GOVYN_AGENT_ID`), error codes, and URL conventions across both SDKs
- [x] **SPEC-02**: Spec defines API key convention (placeholder `"govyn-passthrough"` vs scoped `gvn_*` keys)

### Python SDK

- [ ] **PSDK-01**: User can replace `openai.OpenAI()` with `GovynOpenAI(agent_id=...)` and all existing code works unchanged
- [ ] **PSDK-02**: User can replace `openai.AsyncOpenAI()` with `GovynAsyncOpenAI(agent_id=...)` for async usage
- [x] **PSDK-03**: User can replace `anthropic.Anthropic()` with `GovynAnthropic(agent_id=...)` and all existing code works unchanged
- [x] **PSDK-04**: User can replace `anthropic.AsyncAnthropic()` with `GovynAsyncAnthropic(agent_id=...)` for async usage
- [ ] **PSDK-05**: User can configure proxy URL and agent ID via environment variables instead of constructor args
- [x] **PSDK-06**: User receives `GovynBudgetExceededError` with clear message when budget limit is hit
- [x] **PSDK-07**: User receives `GovynLoopDetectedError` with clear message when loop detection triggers
- [x] **PSDK-08**: User can call `check_proxy()` to verify proxy reachability before making API calls
- [x] **PSDK-09**: Package includes `py.typed` marker for type checker support
- [x] **PSDK-10**: User can `pip install govynai` to get the SDK from PyPI

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
| SPEC-01 | Phase 16 | Complete |
| SPEC-02 | Phase 16 | Complete |
| PSDK-01 | Phase 17 | Pending |
| PSDK-02 | Phase 17 | Pending |
| PSDK-03 | Phase 17 | Complete |
| PSDK-04 | Phase 17 | Complete |
| PSDK-05 | Phase 17 | Pending |
| PSDK-06 | Phase 17 | Complete |
| PSDK-07 | Phase 17 | Complete |
| PSDK-08 | Phase 17 | Complete |
| PSDK-09 | Phase 17 | Complete |
| PSDK-10 | Phase 17 | Complete |
| NSDK-01 | Phase 18 | Pending |
| NSDK-02 | Phase 18 | Pending |
| NSDK-03 | Phase 18 | Pending |
| NSDK-04 | Phase 18 | Pending |
| NSDK-05 | Phase 18 | Pending |
| NSDK-06 | Phase 18 | Pending |
| NSDK-07 | Phase 18 | Pending |
| NSDK-08 | Phase 18 | Pending |
| NSDK-09 | Phase 18 | Pending |
| TEST-01 | Phase 19 | Pending |
| TEST-02 | Phase 19 | Pending |
| TEST-03 | Phase 19 | Pending |
| TEST-04 | Phase 19 | Pending |
| DOCS-01 | Phase 20 | Pending |
| DOCS-02 | Phase 20 | Pending |
| DOCS-03 | Phase 20 | Pending |
| FWRK-01 | Phase 20 | Pending |
| FWRK-02 | Phase 20 | Pending |

**Coverage:**
- v1.3 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after v1.3 roadmap creation (all 30 requirements mapped)*
