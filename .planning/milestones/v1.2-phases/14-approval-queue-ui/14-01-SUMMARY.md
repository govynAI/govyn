---
phase: 14-approval-queue-ui
plan: 1
subsystem: ui, api
tags: [react, postgres, approval-queue, auto-refresh, dashboard]

requires:
  - phase: 10-data-persistence-proxy-api
    provides: approval_requests table schema and ApprovalManager class
  - phase: 11-dashboard-foundation
    provides: React dashboard shell, proxy connection, api-client, hook patterns
  - phase: 13-policy-management-ui
    provides: PolicyTable pattern, sortable table components, EmptyState, PageHeader

provides:
  - GET /api/approvals list endpoint with status/agent filtering and pagination
  - ApprovalRequest TypeScript types for dashboard
  - useApprovals hook with auto-refresh for pending view
  - ApprovalTable sortable component with status badges and time-ago display
  - ApprovalsPage with pending/history tabs and quick approve/deny actions

affects: [14-02-approval-detail-actions, 15-alerts-webhooks-ui]

tech-stack:
  added: []
  patterns: [auto-refresh polling via setInterval in useEffect, tab-based view filtering, sql.unsafe for dynamic WHERE clauses]

key-files:
  created:
    - src/approval-api.ts
    - dashboard/src/hooks/useApprovals.ts
    - dashboard/src/components/approvals/ApprovalTable.tsx
  modified:
    - src/server.ts
    - src/index.ts
    - dashboard/src/types/api.ts
    - dashboard/src/pages/ApprovalsPage.tsx

key-decisions:
  - "sql.unsafe with parameterized values for dynamic WHERE clauses (status IN, agent_id filter)"
  - "Hoist sql variable from DB init block to pass through startServer to approval-api handler"
  - "Auto-refresh only on pending tab (10s interval) to reduce DB load on history views"
  - "Quick inline approve/deny with decided_by='dashboard' (notes modal deferred to 14-02)"

patterns-established:
  - "Tab-based filter pattern: pending vs history tabs controlling API status param"
  - "Auto-refresh hook pattern: useEffect with setInterval + cleanup on filter change"
  - "Pulsing dot animation for pending status badges"

requirements-completed: [APRV-03, APRV-06]

duration: 4min
completed: 2026-02-28
---

# Phase 14 Plan 1: Approval Queue List & Dashboard Summary

**Paginated approval list API with dashboard table, pending/history tabs, 10-second auto-refresh, and quick approve/deny actions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T17:44:19Z
- **Completed:** 2026-02-28T17:48:04Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Proxy serves GET /api/approvals with status, agent_id, limit, and offset query parameters
- Dashboard ApprovalTable with sortable columns, status badges (pulsing amber dot for pending), and time-ago display
- Pending tab auto-refreshes every 10 seconds; history tab shows resolved approvals statically
- Quick approve/deny action buttons call proxy API and refresh the list immediately

## Task Commits

Each task was committed atomically:

1. **Task 1: Create approval list API handler and wire into server** - `10f9f5e` (feat)
2. **Task 2: Add dashboard types, useApprovals hook, ApprovalTable, and update ApprovalsPage** - `1566546` (feat)

## Files Created/Modified
- `src/approval-api.ts` - Approval list API handler with dynamic SQL query building
- `src/server.ts` - Added approval list route before existing per-approval endpoints, added sql parameter
- `src/index.ts` - Hoisted sql variable to pass to startServer
- `dashboard/src/types/api.ts` - Added ApprovalRequest, ApprovalStatus, ApprovalsApiResponse types
- `dashboard/src/hooks/useApprovals.ts` - Data hook with connection gating and auto-refresh
- `dashboard/src/components/approvals/ApprovalTable.tsx` - Sortable table with status badges and action buttons
- `dashboard/src/pages/ApprovalsPage.tsx` - Full page with pending/history tabs replacing placeholder

## Decisions Made
- Used `sql.unsafe()` with parameterized values for dynamic WHERE clause building (status filter supports comma-separated values requiring dynamic IN clause)
- Hoisted `sql` variable from `config.database` try block to outer scope so it can be passed through `startServer` to the approval-api handler
- Auto-refresh restricted to pending tab only to avoid unnecessary DB queries on history view
- Quick approve/deny uses `decided_by: 'dashboard'` without notes (notes modal deferred to plan 14-02)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript `unknown[]` not assignable to postgres `ParameterOrJSON<never>[]` for `sql.unsafe` params -- resolved by typing values array as `(string | number)[]`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Approval list API and dashboard table ready for plan 14-02 (approval detail actions with notes modal)
- ApprovalTable accepts onApprove/onDeny callbacks ready for enhanced UX
- useApprovals hook provides refetch for post-action list refresh

---
*Phase: 14-approval-queue-ui*
*Completed: 2026-02-28*
