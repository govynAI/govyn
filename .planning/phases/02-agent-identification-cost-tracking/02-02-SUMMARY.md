---
phase: 02-agent-identification-cost-tracking
plan: "02"
subsystem: api
tags: [cost-tracking, aggregation, in-memory, rest-api, proxy, openai, anthropic, sse]

# Dependency graph
requires:
  - phase: 02-agent-identification-cost-tracking
    plan: "01"
    provides: resolveAgentId, extractTokenUsage, extractTokenUsageFromSSE, calculateCost, loadPricing, AgentIdentity, TokenUsage

provides:
  - CostAggregator class — in-memory cost record storage with time-window filtering (hour/day/month/all)
  - handleCostApi() — GET /api/costs handler with agent and period query filters
  - forwardRequest() with cost pipeline — token extraction and cost recording after every proxied request
  - startServer() updated to accept CostAggregator and resolve agent identity per request
  - CostRecord, CostSummary, TimePeriod types

affects:
  - 03-budget-enforcement (uses CostAggregator for budget checks)
  - 04-logging (will persist CostRecord to durable storage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-blocking cost recording: token extraction and recordCost() happen after pipe to client, on stream end event"
    - "Dual-path token extraction: non-streaming buffers response body chunks; SSE buffers string chunks alongside pipe"
    - "Flat record array with query-time filtering — no pre-aggregated buckets, no eviction in Phase 2 MVP"
    - "Type-compatible Map reuse: ProxyConfig.pricing (Map<string, {inputPricePerMillion, outputPricePerMillion}>) is structurally identical to PricingTable"

key-files:
  created:
    - src/cost-aggregator.ts
    - src/cost-api.ts
    - tests/cost-aggregator.test.ts
    - tests/cost-api.test.ts
    - tests/integration-cost.test.ts
  modified:
    - src/types.ts
    - src/proxy.ts
    - src/server.ts
    - src/index.ts
    - tests/health.test.ts
    - tests/streaming.test.ts
    - tests/error-forwarding.test.ts
    - tests/proxy.test.ts

key-decisions:
  - "Non-blocking cost recording: cost is recorded after response delivery via stream end event — zero latency impact on client"
  - "Flat record array with query-time filter: simpler than pre-bucketed time windows, sufficient for Phase 2 in-memory store"
  - "startServer() accepts CostAggregator explicitly: single shared aggregator instance, no global state"
  - "ProxyConfig.pricing cast to PricingTable: structurally equivalent types avoid redundant conversion"

patterns-established:
  - "Pattern 4: Non-blocking post-response hooks — listen on 'end' event of upstream, never await before piping"
  - "Pattern 5: Shared aggregator via dependency injection — aggregator created in index.ts and passed through server to proxy"
  - "Pattern 6: Query-time filtering over pre-aggregated buckets — reads all records and filters on demand (Phase 2 scale)"

requirements-completed: [COST-05, COST-06, COST-08]

# Metrics
duration: 7min
completed: 2026-02-24
---

# Phase 2 Plan 02: Cost Aggregation and API Summary

**In-memory cost aggregator with rolling time windows, GET /api/costs endpoint with agent/period filtering, and full cost pipeline wired into the proxy — every proxied request is attributed to an agent, tokens counted, cost calculated, and queryable in real time**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-24T20:24:02Z
- **Completed:** 2026-02-24T20:31:00Z
- **Tasks:** 3
- **Files modified:** 13 (5 created as new modules, 3 test files, 5 modified)

## Accomplishments

- CostAggregator stores all cost records in memory with getSummary() filtering by agentId and time period (hour/day/month/all) using UTC boundary calculations
- GET /api/costs endpoint returns JSON with per-agent summaries, per-model breakdown, unpriced model list, and totals; supports ?agent= and ?period= (including ?period=today alias) query params; returns 405 for non-GET
- forwardRequest() updated with non-blocking cost pipeline: both non-streaming (on 'end' of response) and SSE (on 'end' of upstream) paths buffer data concurrently with piping to client, then extract tokens and record cost after delivery
- startServer() updated to resolve agent identity per request via resolveAgentId() and route GET /api/costs to handleCostApi()
- 28 new tests (12 aggregator + 9 API + 7 integration); all 113 tests pass (0 regressions against 85 Phase 1 + 02-01 tests)
- TypeScript compiles cleanly with strict mode

## Task Commits

Each task was committed atomically:

1. **Task 1: In-memory cost aggregator with rolling time windows** - `d42705b` (feat)
2. **Task 2: Cost summary API endpoint** - `82cbede` (feat)
3. **Task 3: Wire agent identification, token counting, and cost tracking into proxy pipeline** - `950e134` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified

- `src/cost-aggregator.ts` — CostAggregator class with recordCost, getSummary (time-window filtering), getModelSummary, getUnpricedModels, clear
- `src/cost-api.ts` — handleCostApi() HTTP handler for GET /api/costs with query param support and JSON response shaping
- `src/types.ts` — Added CostRecord, CostSummary, TimePeriod types
- `src/proxy.ts` — Updated forwardRequest() with agentId/pricingTable/aggregator params; non-blocking token extraction and cost recording for both non-streaming and SSE paths
- `src/server.ts` — Updated startServer() to accept CostAggregator; added resolveAgentId call and /api/costs routing
- `src/index.ts` — Creates CostAggregator, logs pricing size, passes aggregator to startServer
- `tests/cost-aggregator.test.ts` — 12 unit tests covering all CostAggregator methods and time-period filtering
- `tests/cost-api.test.ts` — 9 integration-style tests for handleCostApi with real HTTP server and pre-populated aggregator
- `tests/integration-cost.test.ts` — 7 end-to-end tests: agent attribution, unknown agent default, multi-agent separation, response integrity, unknown model handling, token accuracy, accumulation
- `tests/health.test.ts`, `tests/streaming.test.ts`, `tests/error-forwarding.test.ts`, `tests/proxy.test.ts` — Updated to pass CostAggregator and complete ProxyConfig (agents/pricing maps) to startServer

## Decisions Made

- **Non-blocking cost recording:** Per ADR-002 (fail-open) and the latency requirement, cost recording happens in the 'end' event handler AFTER all data is piped to the client. The client never waits for cost math.
- **Flat record array with query-time filtering:** Instead of maintaining pre-aggregated hour/day/month buckets, we keep a flat `CostRecord[]` and filter at query time. Correct for Phase 2 in-memory scale; Phase 4 logging will handle persistence and indexed queries.
- **startServer receives CostAggregator explicitly:** Avoids module-level singletons. The aggregator is created in index.ts and injected into server and proxy — consistent with the no-global-state pattern.
- **ProxyConfig.pricing cast to PricingTable:** `ProxyConfig.pricing` is `Map<string, { inputPricePerMillion, outputPricePerMillion }>` which is structurally identical to `PricingTable` from pricing.ts. A cast avoids a redundant conversion while maintaining correct types.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Updated existing Phase 1 tests for new function signatures**
- **Found during:** Task 3 (proxy pipeline wiring)
- **Issue:** `startServer()` signature changed from `(config)` to `(config, aggregator)`, and `ProxyConfig` now requires `agents` and `pricing` fields. The 4 existing test files (health, streaming, error-forwarding, proxy) would not compile without updates.
- **Fix:** Added `CostAggregator` import and `new CostAggregator()` argument to all `startServer()` calls. Added `agents: new Map()` and `pricing: new Map()` to all `ProxyConfig` literals in existing tests.
- **Files modified:** tests/health.test.ts, tests/streaming.test.ts, tests/error-forwarding.test.ts, tests/proxy.test.ts
- **Verification:** All 113 tests pass, TypeScript compiles cleanly
- **Committed in:** 950e134 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical update for new function signatures)
**Impact on plan:** Necessary — existing tests would fail TypeScript compilation and at runtime without these changes. No scope creep; the fix is mechanical (add the new required arguments).

## Issues Encountered

None — all three modules built cleanly on the first attempt. The proxy pipeline correctly handles both streaming and non-streaming paths for token extraction without requiring changes to the SSE piping logic.

## User Setup Required

None - no external service configuration required. Cost tracking is enabled automatically on startup with built-in default pricing for 11 major models.

## Next Phase Readiness

- Full cost tracking pipeline is operational end-to-end
- Phase 3 budget enforcement can import CostAggregator and call getSummary() with period filters to compare against configured budget limits
- CostRecord.priced flag enables budget policies to distinguish priced vs. unpriced models
- Phase 4 logging will replace or supplement the in-memory store with a durable backend

---
*Phase: 02-agent-identification-cost-tracking*
*Completed: 2026-02-24*

## Self-Check: PASSED

All created files exist on disk and all task commits are present in git history.

| Item | Status |
|------|--------|
| src/cost-aggregator.ts | FOUND |
| src/cost-api.ts | FOUND |
| src/types.ts (updated) | FOUND |
| src/proxy.ts (updated) | FOUND |
| src/server.ts (updated) | FOUND |
| src/index.ts (updated) | FOUND |
| tests/cost-aggregator.test.ts | FOUND |
| tests/cost-api.test.ts | FOUND |
| tests/integration-cost.test.ts | FOUND |
| Commit d42705b (Task 1) | FOUND |
| Commit 82cbede (Task 2) | FOUND |
| Commit 950e134 (Task 3) | FOUND |
