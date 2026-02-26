---
phase: 06-policy-schema-core-engine
plan: 03
subsystem: api
tags: [policy-engine, integration, server, events, logging, error-responses, typescript, vitest]

# Dependency graph
requires:
  - phase: 06-policy-schema-core-engine
    plan: 01
    provides: "Policy type system, parsePolicies(), parsePoliciesFromFile()"
  - phase: 06-policy-schema-core-engine
    plan: 02
    provides: "PolicyEngine class with evaluate(), scope matching, most-restrictive-wins"
provides:
  - "PolicyEngine wired into server.ts request pipeline between route matching and forwarding"
  - "Standardized 403 error responses with govyn_policy_violation per PRODUCT_SPEC Section 5"
  - "Standardized 429 error responses with govyn_rate_limited and retry-after header"
  - "policy_denied and policy_enforced events emitted via govynEvents"
  - "policy_result field in action log entries for policy decisions"
  - "PolicyEngine.loadFromFile() for YAML policy file loading"
  - "policies_file configurable in govyn.config.yaml"
  - "7 integration tests for policy pipeline"
affects: [07-policy-rule-types, 08-smart-model-routing, 09-hot-reload-cli-templates]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Policy evaluation as middleware between route matching and forwarding", "Structured error response per PRODUCT_SPEC Section 5 contract", "Event emission for policy decisions (policy_enforced/policy_denied)"]

key-files:
  created:
    - tests/integration-policy.test.ts
  modified:
    - src/server.ts
    - src/index.ts
    - src/config.ts
    - src/types.ts
    - src/events.ts
    - src/policy-engine.ts

key-decisions:
  - "PolicyEngine is optional in startServer() — backward compatible, no breakage if not passed"
  - "Policy evaluation runs after route matching, before forwarding — denials never reach upstream"
  - "Error response JSON matches PRODUCT_SPEC Section 5 contract exactly (type, message, policy, agent, retry_after_seconds)"
  - "Rate limit denials return 429 with Retry-After header; all other denials return 403"

patterns-established:
  - "Policy middleware pattern: evaluate between route match and forward, short-circuit on denial"
  - "PRODUCT_SPEC error contract: { error: { type, message, policy, agent, retry_after_seconds } }"
  - "Policy events: policy_enforced for allowed, policy_denied for blocked — same bus as budget/loop events"

requirements-completed: [EVAL-04, EVAL-05]

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 6 Plan 03: Policy Engine Integration Summary

**PolicyEngine wired into server request pipeline with standardized 403/429 error responses per PRODUCT_SPEC, policy events, and action log integration**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T19:40:27Z
- **Completed:** 2026-02-25T19:44:15Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- PolicyEngine integrated into server.ts request pipeline between route matching and forwarding, with optional parameter for backward compatibility
- Standardized error responses: 403 with govyn_policy_violation for block denials, 429 with govyn_rate_limited and Retry-After header for rate limit denials, matching PRODUCT_SPEC Section 5 contract
- Policy events emitted via existing govynEvents bus: policy_enforced for allowed requests, policy_denied for blocked requests
- policy_result field included in action log entries with allowed/denied_by/evaluation timing
- 7 integration tests covering error contract, scoping, passthrough, events, and logging

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend types, events, and config for policy integration** - `a80ec92` (feat)
2. **Task 2: Wire PolicyEngine into server pipeline and index.ts bootstrap** - `17e6755` (feat)

## Files Created/Modified
- `src/events.ts` - Added policy_enforced and policy_denied event types to GovynEvent union
- `src/types.ts` - Added policy_result field to LogEntry, policiesFile to ProxyConfig
- `src/config.ts` - Added policies_file to RawConfig, parsing in loadConfig()
- `src/server.ts` - PolicyEngine parameter in startServer(), policy evaluation middleware, 403/429 error responses, event emission, action log entries
- `src/index.ts` - PolicyEngine creation, YAML file loading, pass to startServer()
- `src/policy-engine.ts` - Added loadFromFile() method for YAML policy file loading
- `tests/integration-policy.test.ts` - 7 integration tests for policy pipeline (403 error contract, scoping, passthrough, events, logging)

## Decisions Made
- PolicyEngine is optional in startServer() signature — no breakage for existing callers, full backward compatibility
- Policy evaluation runs after route matching but before forwarding — denied requests never reach upstream providers
- Error response JSON structure matches PRODUCT_SPEC Section 5 exactly: `{ error: { type, message, policy, agent, retry_after_seconds } }`
- Rate limit denials (policy type rate_limit) return 429 with Retry-After header; all other denials return 403

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 6 complete: policy schema, parser, engine, and server integration all in place
- PolicyEngine evaluates block policies immediately; other types (rate_limit, content_filter, etc.) allow by default until Phase 7 plugs in real evaluators
- Error response contract established for all downstream consumers (SDKs, dashboards)
- Event bus integration enables monitoring and alerting on policy decisions
- Ready for Phase 7: type-specific evaluators (regex matching, rate windows, budget periods)

## Self-Check: PASSED

All files and commits verified:
- src/events.ts: FOUND
- src/types.ts: FOUND
- src/config.ts: FOUND
- src/server.ts: FOUND
- src/index.ts: FOUND
- src/policy-engine.ts: FOUND
- tests/integration-policy.test.ts: FOUND
- Commit a80ec92: FOUND
- Commit 17e6755: FOUND

---
*Phase: 06-policy-schema-core-engine*
*Completed: 2026-02-25*
