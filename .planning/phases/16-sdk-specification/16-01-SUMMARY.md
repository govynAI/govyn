---
phase: 16-sdk-specification
plan: 01
subsystem: docs
tags: [sdk, specification, cross-language, contract]

# Dependency graph
requires:
  - phase: 15-alert-configuration-delivery
    provides: Complete v1.2 proxy with all governance features implemented
provides:
  - "Canonical SDK specification document (sdk-spec.md) defining constants, URL construction, header injection, API key convention, constructor requirements, error codes, health check, behavioral rules, and cross-language naming conventions"
affects: [17-python-sdk, 18-nodejs-sdk, 19-integration-tests, 20-documentation-framework-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SDK specification as single source of truth for cross-language consistency"
    - "Error envelope format: {error: {type, code, message, details}} on HTTP 429"
    - "Constructor resolution chain: arg > env var > default (or error for mandatory params)"

key-files:
  created:
    - sdk-spec.md
  modified: []

key-decisions:
  - "agent_id mandatory with explicit error, no silent 'unknown' default"
  - "max_retries=0 to prevent double-billing and loop detection false positives"
  - "Passthrough API key mode as recommended default over scoped keys"
  - "base_url is derived from proxy_url + route prefix, not user-configurable"
  - "Future error codes (policy_violation 403, budget warning header) documented but deferred to post-v1.3"

patterns-established:
  - "Error code enum: budget_exceeded_daily, budget_exceeded_monthly, loop_detected"
  - "Class names identical across languages (GovynOpenAI, GovynBudgetExceededError), method names follow language convention"
  - "Health check function: check_proxy() / checkProxy() with 5s default timeout"

requirements-completed: [SPEC-01, SPEC-02]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 16 Plan 01: SDK Specification Summary

**Complete SDK specification defining constants, URL construction, error codes with JSON envelopes, API key convention (passthrough vs scoped keys), and behavioral rules for cross-language consistency**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-01T01:18:22Z
- **Completed:** 2026-03-01T01:20:53Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Created `sdk-spec.md` as the single source of truth for both Python SDK (Phase 17) and Node.js SDK (Phase 18)
- Defined all 11 canonical constants, URL construction formulas for both providers, and header injection rules
- Documented exhaustive error code enum (3 codes) with full JSON response envelopes and error parsing pseudocode
- Specified API key convention with passthrough and scoped key modes, constructor resolution chains, and 5 behavioral rules

## Task Commits

Each task was committed atomically:

1. **Task 1: Write sdk-spec.md -- Constants, URL Construction, Header Injection, and API Key Convention** - `b86920f` (feat)
2. **Task 2: Write sdk-spec.md -- Error Codes, Health Check, and Behavioral Rules** - `23054e6` (feat)

## Files Created/Modified
- `sdk-spec.md` - Complete SDK specification document (10 sections, 412 lines)

## Decisions Made
- agent_id mandatory: raise explicit error if not provided via constructor or env var
- max_retries=0: locked decision to prevent double-billing and loop detection issues
- Passthrough mode recommended as default API key convention
- base_url derived from proxy_url, not user-configurable
- Future error codes (HTTP 403 policy violation, budget warning header) documented for completeness but explicitly deferred to post-v1.3

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 (Python SDK) can begin implementation using sdk-spec.md as the canonical reference
- Phase 18 (Node.js SDK) can begin implementation using sdk-spec.md as the canonical reference
- Both phases have all constants, error formats, URL formulas, and behavioral rules defined
- Each SDK phase must empirically verify exact base_url values due to per-language path construction differences

## Self-Check: PASSED

- FOUND: sdk-spec.md
- FOUND: 16-01-SUMMARY.md
- FOUND: b86920f (Task 1 commit)
- FOUND: 23054e6 (Task 2 commit)

---
*Phase: 16-sdk-specification*
*Completed: 2026-03-01*
