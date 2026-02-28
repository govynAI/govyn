# Phase 13: Policy Management UI - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

View, inspect, and edit all governance policies directly from the dashboard without touching YAML files on disk. Users can list policies, toggle them, view/edit YAML with syntax highlighting and live validation, create new policies from templates, and delete policies. All changes sync to the proxy via REST API.

</domain>

<decisions>
## Implementation Decisions

### Policy list layout
- Table rows (consistent with AgentCostTable pattern on Costs page)
- Columns: name, type, scope, status (with inline toggle switch)
- Filter dropdowns for policy type and scope level
- Click anywhere on row (except toggle) navigates to `/policies/:policyName` detail page
- Inline toggle switch in Status column for enable/disable — one click, immediate visual feedback

### YAML editor
- CodeMirror 6 for the in-browser editor (~50KB gzipped, YAML syntax highlighting, line numbers, bracket matching)
- Live as-you-type validation — debounced (e.g., 500ms after typing stops), leveraging PolicyParser's line-number error reporting
- Inline line markers (red squiggly underlines via CodeMirror diagnostics) + collapsible error panel below editor listing all errors with line numbers
- Click an error in the panel to jump to the affected line

### Detail view structure
- Full-width editor layout with compact metadata header bar above
- Header shows: back button, policy name, type badge, scope badge, enabled status, toggle switch, Save button
- Editor shows single policy YAML only (not the entire policy file) — backend reconstructs the full file on save
- Delete policy button with confirmation dialog on the detail page

### New policy creation
- "New Policy" button on the policy list page
- User picks a policy type (block, rate_limit, budget_limit, content_filter, time_window, model_route, require_approval)
- Editor pre-fills with a type-specific starter template including required fields and example values

### Save & sync flow
- New RESTful proxy API endpoints:
  - `GET /api/policies` — list all policies
  - `GET /api/policies/:name` — single policy detail
  - `PUT /api/policies/:name` — update policy YAML
  - `POST /api/policies` — create new policy
  - `DELETE /api/policies/:name` — remove policy
  - `PATCH /api/policies/:name` — toggle enabled/disabled
- Save button disabled when validation errors exist — prevents invalid policies from reaching proxy
- Toast notification on successful save: "Policy saved and reloaded"
- Server-side validation as a safety net (PolicyParser on proxy side)

### Claude's Discretion
- Unsaved changes warning when navigating away (browser confirm dialog vs none)
- Toast notification library/implementation (shadcn toast, sonner, or custom)
- Exact CodeMirror theme and keybindings configuration
- Loading states and skeleton patterns for the policy list
- Policy list sort order (alphabetical, by type, by enabled status)
- Error state handling when proxy is disconnected

</decisions>

<specifics>
## Specific Ideas

- Table layout should match the density and feel of AgentCostTable on the Costs page
- Policy detail page follows the `/costs/:agentId` navigation pattern (separate page, back button)
- Type-specific templates reduce creation errors — each of the 7 policy types gets a valid starter YAML
- Inline markers + error panel gives an IDE-like editing experience

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AgentCostTable` (dashboard/src/components/costs/AgentCostTable.tsx): Table pattern with row click navigation, badges, loading states
- `Badge` (dashboard/src/components/ui/badge.tsx): For policy type and scope badges in list and detail views
- `Card` (dashboard/src/components/ui/card.tsx): For wrapping the editor and error panel
- `PageHeader` (dashboard/src/components/layout/PageHeader.tsx): Consistent page titles
- `EmptyState` (dashboard/src/components/EmptyState.tsx): For when no policies are loaded
- `PolicyParser` (src/policy-parser.ts): YAML validation with line-number error reporting — reuse for client-side validation (or call via API)
- `PolicyEngine.getPolicies()` (src/policy-engine.ts): Returns all loaded policies — backend for GET /api/policies

### Established Patterns
- Data hooks pattern: `useCosts`, `useBudgets` — create `usePolicies` hook following same pattern
- `apiFetch` wrapper (dashboard/src/lib/api-client.ts): Prepends proxy base URL, handles headers
- `DashboardPeriod` / `toApiPeriod` type pattern (dashboard/src/types/api.ts): Add Policy types here
- Proxy serves API via raw `http.createServer()` with route matching — add policy routes following cost-api/budget-api pattern

### Integration Points
- `PoliciesPage.tsx`: Placeholder page ready to replace with real implementation
- `App.tsx` route `/policies` already wired
- `Sidebar.tsx` nav entry for Policies already exists with Shield icon
- Proxy `server.ts`: Add routing for `/api/policies*` endpoints alongside existing `/api/costs` and `/api/budgets`
- `PolicyWatcher`: Already handles hot-reload when YAML file changes on disk — API writes trigger this automatically

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-policy-management-ui*
*Context gathered: 2026-02-28*
