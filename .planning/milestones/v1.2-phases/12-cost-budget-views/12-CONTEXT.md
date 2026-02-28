# Phase 12: Cost & Budget Views - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can monitor agent spending with overview summaries, per-agent drill-downs, budget health indicators, and historical time-series charts. This phase builds the Costs page and agent detail page in the dashboard, consuming data from the existing `/api/costs` and `/api/budgets` proxy endpoints.

</domain>

<decisions>
## Implementation Decisions

### Overview layout
- Lead with summary stat cards at the top (Total Spend, Request Count, Active Agents, avg cost/request) — Stripe Dashboard / Vercel usage style
- Agent list presented as a sortable data table below the stats: columns for Agent name, Total Spend, Requests, Budget Used %, Last Active
- Each table row is clickable to navigate to the agent detail page
- Tab-style period switcher at the top of the page: Today | 7 Days | 30 Days | All Time — changing it updates both summary cards and agent table
- Overview/Dashboard home page gets a compact cost summary widget (today's total spend, top agent) alongside future widgets; full detail stays on Costs page

### Agent drill-down
- Separate detail page at `/costs/:agentId` — clean URL, bookmarkable, back button returns to overview
- Detail page shows model breakdown table (cost per model, request count, token counts) plus a time-series chart of that agent's spending
- Same period switcher as overview (Today | 7 Days | 30 Days | All Time), carries over the selected period from overview

### Chart style & interaction
- Area chart for cost over time (filled area under line — shows magnitude clearly)
- Stacked by agent on the overview chart, so each agent gets a distinct color showing contribution to total spend over time
- Recharts library (React-native, declarative, built on D3, popular for React dashboards)
- Detailed interactive tooltips on hover showing date, total cost, and per-agent breakdown when stacked

### Budget health indicators
- Progress bar with color zones: green (0-70%), yellow (70-90%), red (90-100%+)
- Badge shows status: 'OK' / 'Warning' / 'Exceeded'
- Budget indicators appear in both the agent table (as a column) and prominently on the agent detail page
- Agents without a budget show a muted 'No budget set' label/dash in the budget column
- Show both soft limit and hard limit: soft limit as a warning threshold marker on the progress bar, hard limit as the max

### Claude's Discretion
- Whether to show individual request-level cost entries on the agent detail page (based on what the API currently supports)
- Exact stat card styling and icon choices
- Loading skeleton design
- Error state handling for failed API calls
- Mobile responsive breakpoints

</decisions>

<specifics>
## Specific Ideas

- Summary cards similar to Stripe Dashboard or Vercel usage page — key numbers prominent, clean typography
- Budget progress bar should visually distinguish the soft limit marker from the hard limit endpoint
- Period switcher should feel like a segmented control / tab bar, not a dropdown

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EmptyState` component: Already used in CostsPage.tsx stub — replace with real content when data exists
- `Card` component (shadcn/ui): Available for summary stat cards
- `Badge` component (shadcn/ui): Available for budget status badges (OK/Warning/Exceeded)
- `Button`, `Popover`, `Tooltip` components: Available from shadcn/ui
- `PageHeader` component: Already used in CostsPage.tsx for page title
- `apiFetch()` wrapper: Handles proxy base URL, Content-Type headers — use for `/api/costs` and `/api/budgets` calls
- `ProxyConnectionContext`: Connection-aware data fetching with auto-reconnect

### Established Patterns
- CSS custom properties theming (dark/light mode via ThemeContext)
- Tailwind v4 with `@tailwindcss/vite` plugin
- React Router with Outlet layout pattern (AppLayout wraps all pages)
- localStorage for persistent settings (proxy URL already stored)
- EmptyState → real content conditional rendering pattern (`hasData` flag)

### Integration Points
- `CostsPage.tsx`: Replace empty state stub with cost overview content
- `OverviewPage.tsx`: Add compact cost summary widget alongside other future widgets
- React Router: Add new route for `/costs/:agentId` agent detail page
- Sidebar navigation: No changes needed — Costs nav item already exists

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-cost-budget-views*
*Context gathered: 2026-02-28*
