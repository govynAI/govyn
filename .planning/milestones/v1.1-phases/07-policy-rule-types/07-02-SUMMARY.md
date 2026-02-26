---
phase: 07-policy-rule-types
plan: 02
subsystem: policy
tags: [policy-engine, content-filter, time-window, pii-detection, timezone, body-buffering]

# Dependency graph
requires:
  - phase: 07-policy-rule-types
    plan: 01
    provides: Block, rate_limit, budget_limit evaluators, evaluatePolicy dispatcher, EvaluateOptions
  - phase: 06-policy-schema-core-engine
    provides: PolicyEngine skeleton, policy types, parser, scope matching
provides:
  - Content filter evaluator with built-in PII patterns (SSN, credit card, email, phone) and custom regex
  - Time window evaluator with IANA timezone, day presets, overnight windows, allow/deny modes
  - Server body buffering and header passing to PolicyRequestContext
  - extractModelFromBody helper for model-based policy matching
  - Integration tests for all five rule types through proxy pipeline
affects: [08-model-routing, server-integration, policy-enforcement]

# Tech tracking
tech-stack:
  added: []
  patterns: [recursive-json-value-extraction, intl-timezone-conversion, body-buffering-for-policy-then-forward]

key-files:
  created: []
  modified:
    - src/policy-engine.ts
    - src/policy-types.ts
    - src/server.ts
    - src/proxy.ts
    - tests/policy-engine.test.ts
    - tests/integration-policy.test.ts

key-decisions:
  - "Content filter parses JSON and recursively extracts string values only (keys/structure ignored to avoid false positives)"
  - "Built-in pattern names resolve to predefined regexes; unrecognized names treated as custom regex strings"
  - "reveal_pattern flag defaults to false for security (generic 'content blocked' message)"
  - "Time window uses Intl.DateTimeFormat for IANA timezone conversion (zero dependencies)"
  - "Overnight windows (end < start) handled via OR logic: currentMinutes >= start OR currentMinutes < end"
  - "Server buffers request body before policy evaluation, then passes Buffer to forwardRequest"
  - "forwardRequest accepts optional bufferedBody parameter for backward compatibility"

patterns-established:
  - "Body buffering for policy-then-forward: server.ts buffers body, evaluates policies, passes Buffer to forwardRequest"
  - "Recursive JSON string extraction: extractStringValues traverses objects/arrays to find all string leaf values"
  - "Injectable Date via EvaluateOptions.now: time_window converts ms timestamp to Date for Intl formatting"

requirements-completed: [RULE-04, RULE-05]

# Metrics
duration: 5min
completed: 2026-02-25
---

# Phase 7 Plan 02: Content Filter and Time Window Evaluators Summary

**Content filter with PII pattern scanning on parsed JSON string values, time window with IANA timezone and overnight window support, plus body buffering for full request context in policy evaluation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-25T21:35:45Z
- **Completed:** 2026-02-25T21:40:45Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Content filter evaluator scanning parsed JSON string values for SSN, credit card, email, phone, and custom regex patterns
- Time window evaluator with IANA timezone via Intl.DateTimeFormat, day presets (weekdays/weekends/daily), overnight windows, allow/deny modes
- Server body buffering enabling content filter and model extraction before forwarding
- 21 new unit tests (11 content filter + 10 time window) and 5 new integration tests covering all five rule types
- All 72 targeted tests passing (60 unit + 12 integration)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define content_filter and time_window types and write failing tests** - `feb7757` (test)
2. **Task 2: Implement evaluators, wire server body/header passing, add integration tests** - `662c47f` (feat)

_TDD RED/GREEN cycle: Task 1 wrote 21 failing tests, Task 2 implemented evaluators and added 5 integration tests to make all 72 pass._

## Files Created/Modified
- `src/policy-types.ts` - Updated ContentFilterPolicy (required patterns, reveal_pattern) and TimeWindowPolicy (start/end/days/timezone/mode)
- `src/policy-engine.ts` - Added evaluateContentFilter, evaluateTimeWindow, expandDayPresets, extractStringValues, BUILTIN_PATTERNS
- `src/server.ts` - Added body buffering before policy evaluation, extractModelFromBody, passes body/headers/model to PolicyRequestContext
- `src/proxy.ts` - Added optional bufferedBody parameter to forwardRequest for pre-buffered body passthrough
- `tests/policy-engine.test.ts` - Added 21 tests: 11 content filter, 10 time window
- `tests/integration-policy.test.ts` - Added 5 tests: rate_limit 429, content_filter block/allow, block match criteria, budget_limit

## Decisions Made
- Content filter parses JSON body and recursively extracts string values only -- keys and JSON structure are ignored to avoid false positives (e.g., key "ssn_field" does not trigger SSN detection)
- Built-in pattern names (ssn, credit_card, email, phone) resolve to predefined regexes; any unrecognized pattern name is treated as a custom regex string
- reveal_pattern defaults to false: error messages say "Content blocked by policy 'X'" without revealing which pattern matched, for security
- Time window uses Intl.DateTimeFormat with IANA timezone names for timezone conversion -- zero external dependencies
- Overnight windows where end < start (e.g., 22:00-06:00) use OR logic: time >= start OR time < end
- Server buffers the full request body before policy evaluation, then passes the Buffer to forwardRequest to avoid double-reading the stream
- forwardRequest accepts optional bufferedBody parameter; if not provided, it reads from req stream as before (backward compat)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All five Phase 7 evaluators (block, rate_limit, budget_limit, content_filter, time_window) are production-ready with full test coverage
- Phase 7 is complete -- model_route is Phase 8 scope
- Server now passes full request context (body, headers, model) to policy engine, ready for Phase 8 model routing

## Self-Check: PASSED

- [x] src/policy-engine.ts exists and contains evaluateContentFilter
- [x] src/policy-types.ts exists and contains reveal_pattern
- [x] src/server.ts exists and contains body: bodyString
- [x] src/proxy.ts exists and contains bufferedBody
- [x] tests/policy-engine.test.ts exists and contains content filter tests
- [x] tests/integration-policy.test.ts exists and contains rate_limit 429 test
- [x] Commit feb7757 exists (Task 1 - test)
- [x] Commit 662c47f exists (Task 2 - feat)

---
*Phase: 07-policy-rule-types*
*Completed: 2026-02-25*
