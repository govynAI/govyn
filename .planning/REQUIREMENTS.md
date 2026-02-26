# Requirements: Govyn

**Defined:** 2026-02-26
**Core Value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level.

## v1.2 Requirements

Requirements for Dashboard & Governance Platform. Each maps to roadmap phases.

### Dashboard Foundation

- [ ] **DASH-01**: User can access dashboard via Clerk authentication (sign up, sign in, sign out)
- [ ] **DASH-02**: Dashboard connects to proxy API and displays real-time connection status
- [ ] **DASH-03**: Dashboard has responsive navigation layout with sidebar and main content area
- [ ] **DASH-04**: User can toggle between dark and light theme

### Data Persistence

- [ ] **DATA-01**: Proxy persists cost records, policy evaluations, and approval events to PostgreSQL
- [ ] **DATA-02**: Database schema supports time-windowed aggregation queries for cost data
- [ ] **DATA-03**: Database migrations run automatically on proxy startup

### Cost & Budgets

- [ ] **COST-01**: User can view total cost overview across all agents
- [ ] **COST-02**: User can drill down into per-agent cost breakdown
- [ ] **COST-03**: User can see budget status indicators (remaining, percentage used, soft/hard limit proximity)
- [ ] **COST-04**: User can view time-series cost charts with daily/weekly/monthly granularity

### Policy Management

- [ ] **PLCY-01**: User can view list of all policies with status (enabled/disabled), scope, and type
- [ ] **PLCY-02**: User can view policy details including full YAML configuration
- [ ] **PLCY-03**: User can toggle policies between enabled and disabled from the dashboard
- [ ] **PLCY-04**: User can edit policies via in-browser YAML editor with syntax highlighting and validation

### Approval Queue

- [ ] **APRV-01**: Proxy returns HTTP 202 with polling URL when a policy flags a request for human approval
- [ ] **APRV-02**: Agent can poll the approval endpoint to check decision status (pending/approved/denied)
- [ ] **APRV-03**: User can view list of pending approval requests in the dashboard
- [ ] **APRV-04**: User can approve or deny a pending request from the dashboard
- [ ] **APRV-05**: User can add notes when approving or denying a request
- [ ] **APRV-06**: User can view approval history with decision, notes, and timestamp

### Alerts

- [ ] **ALRT-01**: User can configure budget threshold alerts (e.g., 80% of daily limit)
- [ ] **ALRT-02**: User can configure policy trigger alerts (e.g., when a block rule fires)
- [ ] **ALRT-03**: Alerts are delivered via webhook to user-configured URL
- [ ] **ALRT-04**: User can view alert history in the dashboard

## Future Requirements

Deferred to later milestones. Tracked but not in current roadmap.

### Billing

- **BILL-01**: Stripe billing integration with tiered plans (Starter $29, Team $99, Enterprise $299)
- **BILL-02**: Usage-based billing metering and overage handling

### Session Replay

- **RPLY-01**: Session replay with step-through and comparison views
- **RPLY-02**: Timeline visualization of agent request sequences

### Anomaly Detection

- **ANOM-01**: Cost spike detection and deviation alerting
- **ANOM-02**: Error loop detection with automatic notifications

### SDKs & Integrations

- **SDK-01**: Python SDK as drop-in replacement for openai/anthropic clients
- **SDK-02**: Node.js SDK as drop-in replacement for openai/anthropic clients
- **SDK-03**: LangChain callback handler and framework plugins

### Infrastructure

- **INFR-01**: Self-hosted proxy + cloud dashboard deployment model
- **INFR-02**: Dual key mode: Key Storage (strongest enforcement) and Passthrough (lowest friction)
- **INFR-03**: Fail-open default with configurable fail-closed mode
- **INFR-04**: OpenTelemetry export for traces and metrics
- **INFR-05**: Email delivery for alerts

## Out of Scope

| Feature | Reason |
|---------|--------|
| Stripe billing | Deferred — focus on dashboard + governance first |
| Session replay | Complex, not needed for governance platform MVP |
| Anomaly detection | Requires historical data patterns — build after persistence is solid |
| Email alerts | Webhook-only for v1.2 — email adds SMTP/provider complexity |
| CSV/JSON cost export | Nice-to-have, deferred to keep v1.2 focused |
| Bulk approval actions | Core approve/deny first, bulk operations later |
| Policy dry-run testing | Visual editor first, dry-run adds simulation engine complexity |
| Policy version history | Requires git-like diffing infrastructure, deferred |
| Mobile app | Web dashboard first |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DASH-01 | Phase 11 | Pending |
| DASH-02 | Phase 11 | Pending |
| DASH-03 | Phase 11 | Pending |
| DASH-04 | Phase 11 | Pending |
| DATA-01 | Phase 10 | Pending |
| DATA-02 | Phase 10 | Pending |
| DATA-03 | Phase 10 | Pending |
| COST-01 | Phase 12 | Pending |
| COST-02 | Phase 12 | Pending |
| COST-03 | Phase 12 | Pending |
| COST-04 | Phase 12 | Pending |
| PLCY-01 | Phase 13 | Pending |
| PLCY-02 | Phase 13 | Pending |
| PLCY-03 | Phase 13 | Pending |
| PLCY-04 | Phase 13 | Pending |
| APRV-01 | Phase 10 | Pending |
| APRV-02 | Phase 10 | Pending |
| APRV-03 | Phase 14 | Pending |
| APRV-04 | Phase 14 | Pending |
| APRV-05 | Phase 14 | Pending |
| APRV-06 | Phase 14 | Pending |
| ALRT-01 | Phase 15 | Pending |
| ALRT-02 | Phase 15 | Pending |
| ALRT-03 | Phase 15 | Pending |
| ALRT-04 | Phase 15 | Pending |

**Coverage:**
- v1.2 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-26*
*Last updated: 2026-02-26 after roadmap creation*
