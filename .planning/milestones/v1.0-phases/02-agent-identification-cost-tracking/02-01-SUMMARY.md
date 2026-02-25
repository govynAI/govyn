---
phase: 02-agent-identification-cost-tracking
plan: "01"
subsystem: api
tags: [agents, tokens, pricing, cost-tracking, openai, anthropic, sse]

# Dependency graph
requires:
  - phase: 01-proxy-server-foundation
    provides: ProxyConfig type, ProviderType, HTTP proxy server infrastructure

provides:
  - resolveAgentId() — identifies agents from X-Govyn-Agent header or API key scoping
  - extractTokenUsage() — parses OpenAI and Anthropic JSON response bodies for token counts
  - extractTokenUsageFromSSE() — parses SSE event streams for token counts
  - calculateCost() — computes USD cost from token usage and pricing table
  - loadPricing() — builds pricing table from defaults + YAML config overrides
  - AgentConfig, AgentIdentity, TokenUsage types
  - agents and pricing fields on ProxyConfig

affects:
  - 02-02-proxy-hot-path (wires these modules into request/response pipeline)
  - 03-cost-aggregation (uses CostResult and TokenUsage for aggregation)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Null-safe extraction: token/cost functions return null rather than throwing on malformed input"
    - "Resolution priority chain: header > api-key > default for agent identification"
    - "Default+override pattern: getDefaultPricing() + config overlay in loadPricing()"

key-files:
  created:
    - src/agents.ts
    - src/tokens.ts
    - src/pricing.ts
    - tests/agents.test.ts
    - tests/tokens.test.ts
    - tests/pricing.test.ts
  modified:
    - src/types.ts
    - src/config.ts
    - govyn.config.yaml

key-decisions:
  - "Agent header accepted as-is without config validation — agents self-identify per ADR-014"
  - "Pricing table uses built-in defaults with config overrides, not config-only — reduces setup friction"
  - "Unknown models get priced=false and totalCost=0 with console.warn (not throw) — fail-open for cost"
  - "Token extraction returns null (not throws) on malformed input — proxy never crashes on bad upstream response"
  - "Anthropic SSE totalTokens computed from message_start (input) + message_delta (output) events"

patterns-established:
  - "Pattern 1: Agent resolution chain — header takes absolute priority over API key"
  - "Pattern 2: Null-safe module boundaries — functions return null on missing data, never throw"
  - "Pattern 3: Pricing defaults + overlay — built-in table ensures out-of-box experience, config overrides for customization"

requirements-completed: [COST-01, COST-02, COST-03, COST-04, COST-07, COST-08]

# Metrics
duration: 4min
completed: 2026-02-24
---

# Phase 2 Plan 01: Agent Identification and Cost Tracking Modules Summary

**Agent identification via X-Govyn-Agent header and API key scoping, token extraction from OpenAI/Anthropic JSON and SSE responses, and cost calculation with built-in default pricing for 11 major models**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-24T20:16:44Z
- **Completed:** 2026-02-24T20:20:46Z
- **Tasks:** 3
- **Files modified:** 9 (3 created as new modules, 3 test files, 3 modified)

## Accomplishments

- Agent identification resolves from X-Govyn-Agent header (self-identification), Authorization Bearer token (API key scoping), or defaults to 'unknown' — header always wins over API key
- Token extraction covers OpenAI (prompt_tokens/completion_tokens) and Anthropic (input_tokens/output_tokens) for both buffered JSON and SSE streaming responses
- Pricing engine with 11 built-in default models (Feb 2026 prices), YAML config overrides, and safe handling of unknown models (priced=false, zero cost, warning log)
- 39 new tests pass; all 46 Phase 1 tests continue to pass (85 total, 0 failures)
- TypeScript compiles cleanly with strict mode

## Task Commits

Each task was committed atomically:

1. **Task 1: Agent identification module and config extension** - `6976331` (feat)
2. **Task 2: Token extraction from OpenAI and Anthropic response bodies** - `1f964fe` (feat)
3. **Task 3: Pricing table and cost calculation engine** - `9d1c82d` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified

- `src/agents.ts` — resolveAgentId() — header > API-key > default resolution chain
- `src/tokens.ts` — extractTokenUsage() and extractTokenUsageFromSSE() for OpenAI and Anthropic formats
- `src/pricing.ts` — getDefaultPricing(), loadPricing(), calculateCost() with 11 default model prices
- `src/types.ts` — Added AgentConfig, AgentIdentity, TokenUsage interfaces; extended ProxyConfig with agents and pricing fields
- `src/config.ts` — Parses agents section (Map<string, AgentConfig>) and pricing section from YAML
- `govyn.config.yaml` — Added commented-out example agents and pricing sections
- `tests/agents.test.ts` — 10 tests for all agent resolution scenarios
- `tests/tokens.test.ts` — 15 tests for token extraction (JSON + SSE, both providers)
- `tests/pricing.test.ts` — 14 tests for default pricing, overrides, cost math, and unknown model warning

## Decisions Made

- **Agent header not validated against config:** Per ADR-014, agents self-identify via X-Govyn-Agent header. Any string value is accepted. This avoids requiring agents to be pre-registered to use the header.
- **Pricing defaults reduce setup friction:** Built-in prices for 11 major models mean the proxy can calculate costs immediately without any YAML config. Config overrides let users correct prices if providers change rates.
- **Unknown models: warn and return zero (not throw):** Consistent with ADR-002 (fail-open). A new model being released won't crash the proxy or block requests — it just marks the cost as unpriced with a warning in logs.
- **SSE token extraction: message_start + message_delta for Anthropic:** Anthropic SSE sends input_tokens in message_start and final output_tokens in message_delta. Both must be present to return a result.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created src/pricing.ts before src/config.ts import**

- **Found during:** Task 1 (config.ts extension)
- **Issue:** The plan specifies pricing.ts in Task 3, but config.ts needed to import loadPricing() in Task 1 to build ProxyConfig with a pricing field. The import would fail if pricing.ts didn't exist when running tests.
- **Fix:** Created src/pricing.ts as part of Task 1 (committed in the same task commit 6976331). This was additive — no work from Task 3 was skipped; Task 3 only added the test file for pricing.
- **Files modified:** src/pricing.ts (created early), tests/pricing.test.ts (created in Task 3)
- **Verification:** All tests pass, TypeScript compiles without errors
- **Committed in:** 6976331 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary forward dependency resolution. All three modules were built as specified; execution order was adjusted to satisfy the import graph.

## Issues Encountered

None - all three modules built cleanly on the first attempt.

## User Setup Required

None - no external service configuration required. Agents and pricing sections in govyn.config.yaml are optional (commented out by default).

## Next Phase Readiness

- All three building-block modules are complete and tested
- Plan 02-02 can now wire resolveAgentId, extractTokenUsage, and calculateCost into the proxy hot path
- ProxyConfig already carries agents and pricing fields — no config changes needed in 02-02
- Token extraction from SSE requires buffering chunks; Plan 02-02 should integrate with the existing streaming pipeline

---
*Phase: 02-agent-identification-cost-tracking*
*Completed: 2026-02-24*

## Self-Check: PASSED

All created files exist on disk and all task commits are present in git history.
