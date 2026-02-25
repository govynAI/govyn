# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across 18 phases grouped into 5 milestones.

## Milestones

- ✅ **v1.0 Core Proxy MVP** — Phases 1-5 (shipped 2026-02-25)
- 📋 **Milestone 2: Policy Engine** — Phases 6-9 (policy definition, evaluation, approval queue, templates)
- 📋 **Milestone 3: Dashboard** — Phases 10-13 (dashboard foundation, cost views, policy UI, approval UI)
- 📋 **Milestone 4: Advanced Features** — Phases 14-16 (session replay, anomaly detection, SDKs)
- 📋 **Milestone 5: Launch & Growth** — Phases 17-18 (open source launch, distribution)

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

### Milestone 2: Policy Engine

- [ ] **Phase 6: Policy Definition & Parser** - YAML policy schema, parser, all rule types, scoping, conflict resolution, hot-reload, and CLI validation
- [ ] **Phase 7: Policy Evaluation Engine** - In-memory policy store, evaluation pipeline, pattern matching, time windows, rate limit counters, <5ms performance
- [ ] **Phase 8: Approval Queue** - HTTP 202 async pattern, poll endpoint, webhook notifications, approve/deny callbacks, timeout handling
- [ ] **Phase 9: Policy Templates** - 10+ pre-built templates, documentation, CLI init command, template testing

### Milestone 3: Dashboard

- [ ] **Phase 10: Dashboard Foundation** - React+TypeScript+Tailwind with Clerk auth, API key management, PostgreSQL backend, Stripe billing, plan enforcement
- [ ] **Phase 11: Cost & Activity Views** - Cost overview, agent list, agent detail, real-time activity feed with auto-refresh
- [ ] **Phase 12: Policy Management UI** - Policy list with toggles, form editor, dry-run testing, version history, template browser
- [ ] **Phase 13: Approval Queue UI & Alerts** - Pending approvals page, approval detail, approve/deny UI, alert configuration, notification history

### Milestone 4: Advanced Features

- [ ] **Phase 14: Session Replay** - Session grouping, step-through timeline, side-by-side comparison, JSON export, failed session highlighting
- [ ] **Phase 15: Anomaly Detection** - Baseline calculation, deviation alerting, cost spike detection, enhanced loop detection, anomaly alert delivery
- [ ] **Phase 16: Framework SDKs** - Python SDK, Node.js SDK, auto-injection, LangChain callback handler, documentation and examples

### Milestone 5: Launch & Growth

- [ ] **Phase 17: Open Source Launch** - Clean repo, comprehensive README, CONTRIBUTING.md, MIT license, CI/CD, npm+Docker publish, ToS, Privacy Policy, launch posts
- [ ] **Phase 18: Distribution & Growth** - VC outreach, blog series, framework ecosystem listings, community management, customer feedback loop

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Proxy Server Foundation | v1.0 | 2/2 | Complete | 2026-02-24 |
| 2. Agent Identification & Cost Tracking | v1.0 | 2/2 | Complete | 2026-02-24 |
| 3. Budget Enforcement & Loop Detection | v1.0 | 2/2 | Complete | 2026-02-25 |
| 4. Action Logging | v1.0 | 2/2 | Complete | 2026-02-25 |
| 5. Packaging, Testing & Deployment | v1.0 | 4/4 | Complete | 2026-02-25 |
| 6. Policy Definition & Parser | M2: Policy Engine | 0/2 | Not started | - |
| 7. Policy Evaluation Engine | M2: Policy Engine | 0/2 | Not started | - |
| 8. Approval Queue | M2: Policy Engine | 0/2 | Not started | - |
| 9. Policy Templates | M2: Policy Engine | 0/2 | Not started | - |
| 10. Dashboard Foundation | M3: Dashboard | 0/3 | Not started | - |
| 11. Cost & Activity Views | M3: Dashboard | 0/2 | Not started | - |
| 12. Policy Management UI | M3: Dashboard | 0/2 | Not started | - |
| 13. Approval Queue UI & Alerts | M3: Dashboard | 0/2 | Not started | - |
| 14. Session Replay | M4: Advanced Features | 0/2 | Not started | - |
| 15. Anomaly Detection | M4: Advanced Features | 0/2 | Not started | - |
| 16. Framework SDKs | M4: Advanced Features | 0/3 | Not started | - |
| 17. Open Source Launch | M5: Launch & Growth | 0/3 | Not started | - |
| 18. Distribution & Growth | M5: Launch & Growth | 0/2 | Not started | - |
