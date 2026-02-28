---
phase: 12-cost-budget-views
plan: 02
subsystem: ui
tags: [react, recharts, area-chart, cost-tracking, agent-detail, data-visualization]

# Dependency graph
requires:
  - phase: 12-cost-budget-views
    provides: "useCosts, useBudgets hooks, PeriodSwitcher, BudgetProgressBar, BudgetBadge, API types"
  - phase: 11-dashboard-foundation
    provides: "AppLayout, EmptyState, PageHeader, ProxyConnectionContext, apiFetch, shadcn/ui components"
provides:
  - "AgentCostDetailPage at /costs/:agentId with model table, area chart, budget health"
  - "CostAreaChart Recharts component with stacked and single modes"
  - "AgentModelTable for per-model cost breakdown"
  - "CostSummaryWidget for Overview page"
  - "Updated OverviewPage with cost widget when proxy connected"
affects: [overview-page-widgets, future-time-series-api]

# Tech tracking
tech-stack:
  added: [recharts]
  patterns: [Recharts area chart with custom tooltip, snapshot chart data from aggregated API response]

key-files:
  created:
    - dashboard/src/components/costs/CostAreaChart.tsx
    - dashboard/src/components/costs/AgentModelTable.tsx
    - dashboard/src/components/costs/CostSummaryWidget.tsx
    - dashboard/src/pages/AgentCostDetailPage.tsx
  modified:
    - dashboard/src/hooks/useCosts.ts
    - dashboard/src/pages/OverviewPage.tsx
    - dashboard/src/App.tsx
    - dashboard/package.json

key-decisions:
  - "useCosts hook extended with optional agentId param (option a) for per-agent filtering"
  - "Chart shows snapshot data point from aggregated API response until historical time-series API is available"
  - "Custom tooltip props interface instead of recharts TooltipProps (v3 type compatibility)"
  - "OverviewPage uses useProxyConnection().isConnected to gate between widget grid and EmptyState"

patterns-established:
  - "Recharts chart pattern: ResponsiveContainer wrapping AreaChart with CSS variable theming"
  - "Agent detail page pattern: useParams + useCosts(period, agentId) + separate budget fetch"
  - "Overview widget pattern: self-contained component fetching its own data via hooks"

requirements-completed: [COST-02, COST-04]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 12 Plan 02: Agent Cost Detail & Overview Widget Summary

**Agent cost detail page with Recharts area chart, model breakdown table, budget health display, and Overview page cost summary widget**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T13:43:49Z
- **Completed:** 2026-02-28T13:48:21Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Built CostAreaChart with stacked (multi-agent) and single (agent detail) modes using Recharts AreaChart with theme-compatible colors and custom tooltip
- Built AgentModelTable with cost-sorted model breakdown showing cost, requests, and token counts
- Created AgentCostDetailPage at /costs/:agentId with budget health card, summary stats, area chart, and model table
- Created CostSummaryWidget showing today's total spend and top agent on the Overview page
- Updated OverviewPage to display cost widget grid when proxy is connected, EmptyState when not
- Extended useCosts hook with optional agentId parameter for per-agent API filtering

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Recharts and build chart + model table components** - `85cd7d0` (feat)
2. **Task 2: Build agent detail page, overview widget, and wire routes** - `9f48304` (feat)

## Files Created/Modified

- `dashboard/package.json` - Added recharts dependency
- `dashboard/src/components/costs/CostAreaChart.tsx` - Recharts area chart with stacked/single modes, custom tooltip, 8-color palette
- `dashboard/src/components/costs/AgentModelTable.tsx` - Model breakdown table sorted by cost descending
- `dashboard/src/components/costs/CostSummaryWidget.tsx` - Compact cost widget for Overview page
- `dashboard/src/pages/AgentCostDetailPage.tsx` - Agent drill-down page with budget status, stats, chart, model table
- `dashboard/src/hooks/useCosts.ts` - Extended with optional agentId parameter for per-agent filtering
- `dashboard/src/pages/OverviewPage.tsx` - Updated to show CostSummaryWidget when proxy connected
- `dashboard/src/App.tsx` - Added /costs/:agentId route for agent detail page

## Decisions Made

- Extended useCosts hook with optional agentId parameter (option a from plan) rather than creating a separate hook, keeping the data-fetching pattern consistent
- Used a custom tooltip props interface rather than recharts TooltipProps due to recharts v3 type changes where active/payload/label are read from context and omitted from TooltipProps
- Chart renders snapshot data from the aggregated API response (single data point per period) since the proxy API does not yet support historical time-series; the chart component is built to handle multiple data points once the API provides them
- OverviewPage gates on proxy connection status to determine whether to show the widget grid or the EmptyState fallback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Recharts v3 tooltip type compatibility**
- **Found during:** Task 2 (build verification)
- **Issue:** Recharts v3 changed TooltipProps to omit active/payload/label (read from context instead), causing TypeScript errors
- **Fix:** Created custom CustomTooltipProps interface with the needed fields, imported Payload type from recharts/types/component/DefaultTooltipContent
- **Files modified:** dashboard/src/components/costs/CostAreaChart.tsx
- **Verification:** TypeScript compilation passes with strict mode and noUncheckedIndexedAccess
- **Committed in:** 9f48304 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed noUncheckedIndexedAccess array access**
- **Found during:** Task 2 (build verification)
- **Issue:** `data.agents[0]` in useMemo could be undefined with noUncheckedIndexedAccess enabled
- **Fix:** Moved agent variable extraction before useMemo, used null guard in chartData computation
- **Files modified:** dashboard/src/pages/AgentCostDetailPage.tsx
- **Verification:** TypeScript compilation passes
- **Committed in:** 9f48304 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for TypeScript strict mode compliance. No scope creep.

## Issues Encountered

None beyond the type fixes documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cost & Budget Views phase is complete (both plans executed)
- All cost monitoring pages functional: overview with stat cards/table, agent detail with model breakdown/chart
- Overview page now has live content (cost summary widget) instead of placeholder
- Time-series chart ready to display multi-point data when historical API endpoint is added

## Self-Check: PASSED

All 8 files verified present. Both task commits (85cd7d0, 9f48304) verified in git log.

---
*Phase: 12-cost-budget-views*
*Completed: 2026-02-28*
