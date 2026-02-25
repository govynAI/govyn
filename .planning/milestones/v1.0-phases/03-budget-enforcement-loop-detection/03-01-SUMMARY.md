---
phase: 03-budget-enforcement-loop-detection
plan: "01"
subsystem: api
tags: [budget, spending-limits, event-bus, middleware, enforcement]

# Dependency graph
requires:
  - phase: 02-agent-identification-cost-tracking
    provides: CostAggregator with getSummary() for daily/monthly spend queries

provides:
  - BudgetEnforcer class with checkBudget() and getStatus() methods
  - govynEvents singleton event bus for internal notifications
  - GET /api/budgets and GET /api/budgets/:agentId budget status API
  - Budget enforcement middleware (hard block 429 / soft warn header)
  - BudgetConfig, BudgetCheckResult, BudgetStatus types

affects:
  - 03-02-loop-detection (uses govynEvents for loop_detected events)
  - future alerting/webhook phases (subscribe to govynEvents)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BudgetEnforcer class with dependency-injected CostAggregator
    - In-process typed event bus via Node.js EventEmitter singleton
    - Govyn-native error format for budget errors with budget-specific codes

key-files:
  created:
    - src/budget-enforcer.ts
    - src/budget-api.ts
    - src/events.ts
    - tests/budget-enforcer.test.ts
    - tests/budget-api.test.ts
  modified:
    - src/types.ts
    - src/config.ts
    - src/server.ts
    - src/proxy.ts
    - src/streaming.ts
    - src/index.ts
    - govyn.config.yaml

key-decisions:
  - "BudgetEnforcer uses CostAggregator.getSummary() for spend queries — no separate spend tracking, reuses existing aggregation"
  - "startServer() accepts BudgetEnforcer as optional third parameter — backward compatible, defaults to config.budgets-based enforcer"
  - "Soft limit warning delivered via BOTH X-Govyn-Budget-Warning response header AND internal govynEvents emission"
  - "govynEvents is a singleton EventEmitter — lightweight, no external dependencies, easy to consume"
  - "Budget check happens before route matching — agents over hard limit never reach upstream regardless of route"

patterns-established:
  - "Budget enforcement as middleware: checkBudget() called before forwardRequest() in request handler"
  - "Internal events via govynEvents.emit('event', payload) — type-safe GovynEvent union"
  - "Optional extraHeaders param pattern in handleStreamingResponse() for adding govyn-specific headers to SSE"

requirements-completed: [BUDG-01, BUDG-02, BUDG-03, BUDG-07]

# Metrics
duration: 6min
completed: 2026-02-25
---

# Phase 3 Plan 01: Budget Enforcement Summary

**Per-agent hard/soft budget limits with HTTP 429 blocking, X-Govyn-Budget-Warning SSE/non-SSE header, govynEvents bus, and GET /api/budgets status API**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-25T00:20:43Z
- **Completed:** 2026-02-25T00:26:51Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- BudgetEnforcer class enforces daily/monthly hard limits (block with 429) and soft limits (warn with header + event)
- In-process event bus (govynEvents) for budget_warning and budget_exceeded events enables future alerting/webhooks
- GET /api/budgets and GET /api/budgets/:agentId return real-time spend/limit/remaining status per agent
- 29 new tests (18 unit + 11 integration), 142 total tests passing with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Budget types, config parsing, and BudgetEnforcer class** - `a4ffb53` (feat)
2. **Task 2: Wire budget enforcement into server, add budget status API, and create event bus** - `b4bd7a3` (feat)

**Plan metadata:** (to be added after final commit)

## Files Created/Modified

- `src/types.ts` - Added BudgetConfig, BudgetCheckResult, BudgetStatus types; added `budgets` field to ProxyConfig
- `src/config.ts` - Parse `budgets` YAML section into BudgetConfig map with defaults
- `src/budget-enforcer.ts` - BudgetEnforcer class: checkBudget(), getStatus(), getAllStatuses()
- `src/events.ts` - govynEvents singleton EventEmitter and GovynEvent union type
- `src/budget-api.ts` - handleBudgetApi for GET /api/budgets and GET /api/budgets/:agentId
- `src/server.ts` - Budget enforcement middleware, /api/budgets routing, optional BudgetEnforcer param
- `src/proxy.ts` - Optional budgetWarning param, sets X-Govyn-Budget-Warning header on responses
- `src/streaming.ts` - Optional extraHeaders param for including govyn headers in SSE responses
- `src/index.ts` - Create BudgetEnforcer from config, pass to startServer
- `govyn.config.yaml` - Added commented-out budgets example section
- `tests/budget-enforcer.test.ts` - 18 unit tests for BudgetEnforcer logic
- `tests/budget-api.test.ts` - 11 integration tests for budget API and enforcement middleware

## Decisions Made

- BudgetEnforcer uses the existing CostAggregator.getSummary() for spend queries — no duplicate data structures
- startServer() signature made backward-compatible: BudgetEnforcer is optional third parameter
- Soft limit warning delivered via BOTH header AND internal event — per locked plan decision
- govynEvents is a simple Node.js EventEmitter singleton — no external dependencies, no complexity overhead
- Budget check happens before route matching — hard-blocked agents never touch upstream

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `budgets: new Map()` to existing test ProxyConfig objects**
- **Found during:** Task 1 (adding `budgets` as required field to ProxyConfig)
- **Issue:** TypeScript required the new `budgets` field in all ProxyConfig objects; existing tests in health.test.ts, streaming.test.ts, error-forwarding.test.ts, proxy.test.ts, integration-cost.test.ts would fail to compile
- **Fix:** Added `budgets: new Map()` to each existing test ProxyConfig literal
- **Files modified:** tests/health.test.ts, tests/streaming.test.ts, tests/error-forwarding.test.ts, tests/proxy.test.ts, tests/integration-cost.test.ts
- **Verification:** TypeScript compiles cleanly, all existing tests pass
- **Committed in:** a4ffb53 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added optional extraHeaders parameter to handleStreamingResponse()**
- **Found during:** Task 2 (implementing X-Govyn-Budget-Warning header for SSE responses)
- **Issue:** handleStreamingResponse() hard-coded its headers in writeHead(), making it impossible to add the budget warning header for SSE paths
- **Fix:** Added optional `extraHeaders?: Record<string, string>` parameter, spread into writeHead() call
- **Files modified:** src/streaming.ts
- **Verification:** SSE responses carry X-Govyn-Budget-Warning header when budget warning applies
- **Committed in:** b4bd7a3 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

None - implementation proceeded as planned with the two auto-fixes above.

## User Setup Required

None - no external service configuration required. Budget limits are configured via YAML.

## Next Phase Readiness

- Budget enforcement complete — agents over hard limits are blocked at the proxy with clear error messages
- govynEvents event bus ready for loop detection events in Phase 3 Plan 02
- All requirements BUDG-01 through BUDG-07 verified with automated tests

## Self-Check: PASSED

- All 12 key files verified to exist on disk
- Task 1 commit a4ffb53 verified in git log
- Task 2 commit b4bd7a3 verified in git log

---
*Phase: 03-budget-enforcement-loop-detection*
*Completed: 2026-02-25*
