---
phase: 10-data-persistence-proxy-api
plan: 02
subsystem: api
tags: [approval-queue, http-202, polling, single-use-token, require_approval, policy-engine]

# Dependency graph
requires:
  - phase: 10-data-persistence-proxy-api
    plan: 01
    provides: "PostgreSQL schema with approval_requests table, DbWriter.isAvailable()"
  - phase: 06-policy-schema-core-engine
    provides: "PolicyEngine, PolicyType union, policy parser infrastructure"
  - phase: 07-policy-rule-types
    provides: "Block policy AND-match criteria pattern, evaluator dispatch"
provides:
  - "ApprovalManager: create approval request, poll status, approve/deny, validate single-use token"
  - "ApprovalTimeoutChecker: auto-deny expired pending approvals every 30s"
  - "require_approval policy type with match criteria and configurable timeout"
  - "HTTP 202 response with polling URL for approval-flagged requests"
  - "GET /api/approvals/:id polling endpoint"
  - "POST /api/approvals/:id/approve and /api/approvals/:id/deny endpoints"
  - "X-Govyn-Approval header token bypass for approved re-sends"
  - "generateRequestSummary() helper for approval metadata"
affects: [14-approval-queue-ui, 11-dashboard-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns: [HTTP 202 polling, single-use token validation, async IIFE in body-read callback, approval hold vs denial precedence]

key-files:
  created:
    - src/approval.ts
    - src/approval-timeout.ts
    - tests/approval.test.ts
    - tests/approval-timeout.test.ts
    - tests/integration/approval-flow.test.ts
  modified:
    - src/policy-types.ts
    - src/policy-parser.ts
    - src/policy-engine.ts
    - src/server.ts
    - src/index.ts
    - src/db-writer.ts

key-decisions:
  - "Approval holds (require_approval) do not count as denials in PolicyEvaluationResult -- only block/rate_limit denials take precedence"
  - "Async IIFE wrapping body-read callback to support await for approval token DB validation"
  - "MockApprovalManager with in-memory Maps for integration tests (no real PostgreSQL required)"
  - "Approval token validation via X-Govyn-Approval header skips all policy evaluation"

patterns-established:
  - "HTTP 202 + Location header pattern: return polling URL for async operations"
  - "Single-use token: atomic UPDATE with WHERE token_used=false, marking consumed in one query"
  - "Approval precedence: deny policies take priority over approval holds, approval holds only trigger when request would otherwise be allowed"
  - "Mock manager pattern: in-memory Maps implementing same interface for integration tests"

requirements-completed: [APRV-01, APRV-02]

# Metrics
duration: 8min
completed: 2026-02-26
---

# Phase 10 Plan 02: Approval Queue Backend Summary

**Human-in-the-loop approval queue with require_approval policy type, HTTP 202 polling, single-use token re-send, and auto-timeout expiry**

## Performance

- **Duration:** 8 min
- **Started:** 2026-02-26T22:39:36Z
- **Completed:** 2026-02-26T22:47:43Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- `require_approval` policy type added to policy engine with AND-match criteria (model, provider, action_type, path)
- Full approval lifecycle: HTTP 202 -> poll -> approve/deny -> re-send with single-use token
- ApprovalTimeoutChecker auto-denies expired pending approvals (denied_timeout is distinct from denied)
- Approval-flagged requests always require DB availability (even in fail-open mode), returning 503 if unavailable
- 35 new tests (26 unit + 9 integration) covering all approval flow scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Require_approval policy type and ApprovalManager** - `2594d85` (feat)
2. **Task 2: Server integration -- HTTP 202, polling, token validation** - `f8bd6bf` (feat)

## Files Created/Modified
- `src/approval.ts` - ApprovalManager class with create, poll, approve, deny, validateAndConsumeToken; generateRequestSummary helper
- `src/approval-timeout.ts` - ApprovalTimeoutChecker with 30s interval auto-deny of expired pending requests
- `src/policy-types.ts` - Added require_approval to PolicyType union, RequireApprovalPolicy interface, ApprovalPolicyResult
- `src/policy-parser.ts` - Parser support for require_approval type with timeout_seconds and store_payload validation
- `src/policy-engine.ts` - evaluateRequireApproval() with AND-match logic; evaluate() treats approval holds separately from denials
- `src/server.ts` - HTTP 202 response, GET /api/approvals/:id, POST approve/deny, X-Govyn-Approval token bypass
- `src/index.ts` - ApprovalManager + ApprovalTimeoutChecker creation, SIGTERM/SIGINT graceful shutdown
- `src/db-writer.ts` - writeApprovalEvent() for audit trail logging
- `tests/approval.test.ts` - 20 tests for ApprovalManager + 6 for generateRequestSummary
- `tests/approval-timeout.test.ts` - 6 tests for ApprovalTimeoutChecker
- `tests/integration/approval-flow.test.ts` - 9 integration tests for full approval lifecycle

## Decisions Made
- Approval holds (require_approval with requiresApproval=true) set allowed=false in SinglePolicyResult but are NOT tracked as denials in the evaluate() loop. Only block/rate_limit/budget_limit/content_filter/time_window denials take precedence. The caller checks results for approval holds only when no real denials exist.
- Wrapped the body-read callback in an async IIFE to support await for both approval token validation and approval request creation (both require DB queries)
- Used MockApprovalManager (in-memory Maps) for integration tests rather than requiring a real PostgreSQL instance. Tests verify HTTP-level flow; SQL queries are tested separately in unit tests.
- Approval token validation via X-Govyn-Approval header happens before policy evaluation, so approved re-sends bypass all policy checks (not just the approval policy)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None beyond Phase 10 Plan 01 requirements (PostgreSQL connection). The approval queue uses the same approval_requests table created in the Plan 01 migration.

## Next Phase Readiness
- Approval queue backend is fully operational: policies can flag requests, agents can poll and re-send
- Phase 14 (Approval Queue UI) can build on the GET /api/approvals/:id and POST approve/deny endpoints
- Approve/deny operations are available via API for dashboard integration or direct use
- All indexes from Plan 01 schema support approval queries (status, agent_id, expires_at, approval_token)

## Self-Check: PASSED

- All 11 created/modified source files verified on disk
- Commit 2594d85 (Task 1) verified in git log
- Commit f8bd6bf (Task 2) verified in git log
- 595 tests pass (560 existing + 35 new, zero regressions)
- TypeScript compiles clean
- Build succeeds

---
*Phase: 10-data-persistence-proxy-api*
*Completed: 2026-02-26*
