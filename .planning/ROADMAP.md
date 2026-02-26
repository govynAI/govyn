# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across phases grouped into milestones.

## Milestones

- ✅ **v1.0 Core Proxy MVP** — Phases 1-5 (shipped 2026-02-25)
- ✅ **v1.1 Policy Engine** — Phases 6-9.1 (shipped 2026-02-26)
- 🚧 **v1.2 Dashboard & Governance Platform** — Phases 10-15 (data persistence, dashboard, cost views, policy UI, approval UI, alerts)
- 📋 **v1.3 Advanced Features** — Phases 16-18 (session replay, anomaly detection, SDKs)
- 📋 **v1.4 Launch & Growth** — Phases 19-20 (open source launch, distribution)

## Phases

<details>
<summary>✅ v1.0 Core Proxy MVP (Phases 1-5) — SHIPPED 2026-02-25</summary>

- [x] Phase 1: Proxy Server Foundation (2/2 plans) — completed 2026-02-24
- [x] Phase 2: Agent Identification & Cost Tracking (2/2 plans) — completed 2026-02-24
- [x] Phase 3: Budget Enforcement & Loop Detection (2/2 plans) — completed 2026-02-25
- [x] Phase 4: Action Logging (2/2 plans) — completed 2026-02-25
- [x] Phase 5: Packaging, Testing & Deployment (4/4 plans) — completed 2026-02-25

Full details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v1.1 Policy Engine (Phases 6-9.1) — SHIPPED 2026-02-26</summary>

- [x] Phase 6: Policy Schema & Core Engine (3/3 plans) — completed 2026-02-25
- [x] Phase 7: Policy Rule Types (2/2 plans) — completed 2026-02-25
- [x] Phase 7.1: Fix Policy Engine Integration Bugs (1/1 plan) — completed 2026-02-25
- [x] Phase 8: Smart Model Routing (2/2 plans) — completed 2026-02-25
- [x] Phase 9: Hot Reload, CLI & Policy Templates (3/3 plans) — completed 2026-02-26
- [x] Phase 9.1: Parser Validation & Tech Debt Cleanup (1/1 plan) — completed 2026-02-26

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

### 🚧 v1.2 Dashboard & Governance Platform (In Progress)

**Milestone Goal:** Turn Govyn from a CLI-only proxy into a visual governance platform where both devs and team leads can monitor costs, manage policies, approve agent actions, and configure alerts.

- [ ] **Phase 10: Data Persistence & Proxy API** - PostgreSQL schema, proxy DB writes, approval queue backend (HTTP 202 + polling)
- [ ] **Phase 11: Dashboard Foundation** - React + TypeScript + Tailwind app with Clerk auth, proxy API connection, navigation, theme
- [ ] **Phase 12: Cost & Budget Views** - Cost overview, per-agent drill-down, budget status indicators, time-series charts
- [ ] **Phase 13: Policy Management UI** - Policy list, detail view, enable/disable toggles, in-browser YAML editor
- [ ] **Phase 14: Approval Queue UI** - Pending approvals list, approve/deny actions, notes, approval history
- [ ] **Phase 15: Alert Configuration & Delivery** - Budget and policy alert rules, webhook delivery, alert history

## Phase Details

### Phase 10: Data Persistence & Proxy API
**Goal**: Proxy persists all governance data to PostgreSQL and exposes API endpoints for the dashboard to consume, including the approval queue backend
**Depends on**: Phase 9.1 (v1.1 complete)
**Requirements**: DATA-01, DATA-02, DATA-03, APRV-01, APRV-02
**Success Criteria** (what must be TRUE):
  1. Proxy writes cost records, policy evaluations, and approval events to PostgreSQL on every request
  2. Database schema supports time-windowed aggregation queries (daily/weekly/monthly cost rollups)
  3. Database migrations run automatically when the proxy starts
  4. When a policy flags a request for human approval, the proxy returns HTTP 202 with a polling URL instead of forwarding the request
  5. An agent can poll the approval endpoint and receive the current decision status (pending, approved, or denied)
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD

### Phase 11: Dashboard Foundation
**Goal**: Users can access a standalone React dashboard that authenticates via Clerk, connects to the proxy API, and provides the navigation shell for all governance features
**Depends on**: Phase 10
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04
**Success Criteria** (what must be TRUE):
  1. User can sign up, sign in, and sign out of the dashboard via Clerk authentication
  2. Dashboard displays real-time proxy connection status (connected/disconnected indicator)
  3. Dashboard has a responsive sidebar navigation layout that works on desktop and tablet viewports
  4. User can toggle between dark and light theme, and the preference persists across sessions
**Plans**: TBD

Plans:
- [ ] 11-01: TBD
- [ ] 11-02: TBD

### Phase 12: Cost & Budget Views
**Goal**: Users can monitor agent spending with overview summaries, per-agent drill-downs, budget health indicators, and historical trends
**Depends on**: Phase 11
**Requirements**: COST-01, COST-02, COST-03, COST-04
**Success Criteria** (what must be TRUE):
  1. User can view a cost overview page showing total spend across all agents with summary stats
  2. User can click into any agent to see its individual cost breakdown (by provider, model, time period)
  3. User can see budget status indicators for each agent showing remaining budget, percentage used, and proximity to soft/hard limits
  4. User can view time-series cost charts and switch between daily, weekly, and monthly granularity
**Plans**: TBD

Plans:
- [ ] 12-01: TBD
- [ ] 12-02: TBD

### Phase 13: Policy Management UI
**Goal**: Users can view, inspect, and edit all governance policies directly from the dashboard without touching YAML files on disk
**Depends on**: Phase 11
**Requirements**: PLCY-01, PLCY-02, PLCY-03, PLCY-04
**Success Criteria** (what must be TRUE):
  1. User can view a list of all policies showing each policy's status (enabled/disabled), scope (global/agent/target), and rule type
  2. User can click into any policy to see its full YAML configuration and metadata
  3. User can toggle any policy between enabled and disabled from the policy list or detail view
  4. User can edit a policy's YAML in an in-browser editor with syntax highlighting, and validation errors appear before saving
**Plans**: TBD

Plans:
- [ ] 13-01: TBD
- [ ] 13-02: TBD

### Phase 14: Approval Queue UI
**Goal**: Users can review, approve, and deny agent requests that require human authorization, with full audit trail
**Depends on**: Phase 11, Phase 10 (approval backend)
**Requirements**: APRV-03, APRV-04, APRV-05, APRV-06
**Success Criteria** (what must be TRUE):
  1. User can view a list of pending approval requests showing the requesting agent, target API, and request details
  2. User can approve or deny any pending request from the dashboard with a single action
  3. User can add free-text notes when approving or denying a request (notes are persisted with the decision)
  4. User can view approval history showing past decisions with who decided, when, the outcome, and any notes
**Plans**: TBD

Plans:
- [ ] 14-01: TBD
- [ ] 14-02: TBD

### Phase 15: Alert Configuration & Delivery
**Goal**: Users can set up automated alerts for budget thresholds and policy triggers, delivered via webhook, with a history of all fired alerts
**Depends on**: Phase 11, Phase 10 (persistence)
**Requirements**: ALRT-01, ALRT-02, ALRT-03, ALRT-04
**Success Criteria** (what must be TRUE):
  1. User can configure budget threshold alerts (e.g., fire when an agent reaches 80% of its daily limit)
  2. User can configure policy trigger alerts (e.g., fire when a specific block rule activates)
  3. When an alert condition is met, a webhook POST is sent to the user-configured URL with alert details
  4. User can view alert history in the dashboard showing which alerts fired, when, and their payload
**Plans**: TBD

Plans:
- [ ] 15-01: TBD
- [ ] 15-02: TBD

### 📋 v1.3 Advanced Features (Future)

- [ ] **Phase 16: Session Replay** — Session grouping, step-through timeline, side-by-side comparison, JSON export
- [ ] **Phase 17: Anomaly Detection** — Baseline calculation, deviation alerting, cost spike detection, enhanced loop detection
- [ ] **Phase 18: Framework SDKs** — Python SDK, Node.js SDK, LangChain callback handler, documentation

### 📋 v1.4 Launch & Growth (Future)

- [ ] **Phase 19: Open Source Launch** — Clean repo, comprehensive README, CONTRIBUTING.md, MIT license, CI/CD, npm+Docker publish, launch posts
- [ ] **Phase 20: Distribution & Growth** — VC outreach, blog series, framework ecosystem listings, community management

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Proxy Server Foundation | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Agent Identification & Cost Tracking | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Budget Enforcement & Loop Detection | v1.0 | 2/2 | Complete | 2026-02-25 |
| 4. Action Logging | v1.0 | 2/2 | Complete | 2026-02-25 |
| 5. Packaging, Testing & Deployment | v1.0 | 4/4 | Complete | 2026-02-25 |
| 6. Policy Schema & Core Engine | v1.1 | 3/3 | Complete | 2026-02-25 |
| 7. Policy Rule Types | v1.1 | 2/2 | Complete | 2026-02-25 |
| 7.1 Fix Policy Engine Integration Bugs | v1.1 | 1/1 | Complete | 2026-02-25 |
| 8. Smart Model Routing | v1.1 | 2/2 | Complete | 2026-02-25 |
| 9. Hot Reload, CLI & Policy Templates | v1.1 | 3/3 | Complete | 2026-02-26 |
| 9.1 Parser Validation & Tech Debt Cleanup | v1.1 | 1/1 | Complete | 2026-02-26 |
| 10. Data Persistence & Proxy API | v1.2 | 0/? | Not started | - |
| 11. Dashboard Foundation | v1.2 | 0/? | Not started | - |
| 12. Cost & Budget Views | v1.2 | 0/? | Not started | - |
| 13. Policy Management UI | v1.2 | 0/? | Not started | - |
| 14. Approval Queue UI | v1.2 | 0/? | Not started | - |
| 15. Alert Configuration & Delivery | v1.2 | 0/? | Not started | - |
| 16. Session Replay | v1.3 | — | Future | — |
| 17. Anomaly Detection | v1.3 | — | Future | — |
| 18. Framework SDKs | v1.3 | — | Future | — |
| 19. Open Source Launch | v1.4 | — | Future | — |
| 20. Distribution & Growth | v1.4 | — | Future | — |
