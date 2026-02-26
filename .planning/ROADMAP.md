# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across phases grouped into milestones.

## Milestones

- ✅ **v1.0 Core Proxy MVP** — Phases 1-5 (shipped 2026-02-25)
- ✅ **v1.1 Policy Engine** — Phases 6-9.1 (shipped 2026-02-26)
- 📋 **v1.2 Approval Queue & Dashboard** — Phases 10-14 (approval queue, dashboard foundation, cost views, policy UI, approval UI)
- 📋 **v1.3 Advanced Features** — Phases 15-17 (session replay, anomaly detection, SDKs)
- 📋 **v1.4 Launch & Growth** — Phases 18-19 (open source launch, distribution)

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

### v1.2 Approval Queue & Dashboard (Future)

- [ ] **Phase 10: Approval Queue** — HTTP 202 async pattern, poll endpoint, approve/deny callbacks, timeout handling (ADR-017)
- [ ] **Phase 11: Dashboard Foundation** — React+TypeScript+Tailwind with Clerk auth, API key management, PostgreSQL backend, Stripe billing
- [ ] **Phase 12: Cost & Activity Views** — Cost overview, agent list, agent detail, real-time activity feed
- [ ] **Phase 13: Policy Management UI** — Policy list with toggles, form editor, dry-run testing, version history, template browser
- [ ] **Phase 14: Approval Queue UI & Alerts** — Pending approvals page, approve/deny UI, alert configuration, notification history

### v1.3 Advanced Features (Future)

- [ ] **Phase 15: Session Replay** — Session grouping, step-through timeline, side-by-side comparison, JSON export
- [ ] **Phase 16: Anomaly Detection** — Baseline calculation, deviation alerting, cost spike detection, enhanced loop detection
- [ ] **Phase 17: Framework SDKs** — Python SDK, Node.js SDK, LangChain callback handler, documentation

### v1.4 Launch & Growth (Future)

- [ ] **Phase 18: Open Source Launch** — Clean repo, comprehensive README, CONTRIBUTING.md, MIT license, CI/CD, npm+Docker publish, launch posts
- [ ] **Phase 19: Distribution & Growth** — VC outreach, blog series, framework ecosystem listings, community management

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
| 10. Approval Queue | v1.2 | — | Future | — |
| 11. Dashboard Foundation | v1.2 | — | Future | — |
| 12. Cost & Activity Views | v1.2 | — | Future | — |
| 13. Policy Management UI | v1.2 | — | Future | — |
| 14. Approval Queue UI & Alerts | v1.2 | — | Future | — |
| 15. Session Replay | v1.3 | — | Future | — |
| 16. Anomaly Detection | v1.3 | — | Future | — |
| 17. Framework SDKs | v1.3 | — | Future | — |
| 18. Open Source Launch | v1.4 | — | Future | — |
| 19. Distribution & Growth | v1.4 | — | Future | — |
