# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across 18 phases grouped into 5 milestones: first building a deployable proxy MVP (Phases 1-5), then adding a policy engine with human-in-the-loop approvals (Phases 6-9), then a full SaaS dashboard (Phases 10-13), then advanced observability and SDK features (Phases 14-16), and finally open-source launch and growth (Phases 17-18).

## Milestones

- 📋 **Milestone 1: Core Proxy MVP** — Phases 1-5 (proxy foundation, cost tracking, budgets, logging, packaging)
- 📋 **Milestone 2: Policy Engine** — Phases 6-9 (policy definition, evaluation, approval queue, templates)
- 📋 **Milestone 3: Dashboard** — Phases 10-13 (dashboard foundation, cost views, policy UI, approval UI)
- 📋 **Milestone 4: Advanced Features** — Phases 14-16 (session replay, anomaly detection, SDKs)
- 📋 **Milestone 5: Launch & Growth** — Phases 17-18 (open source launch, distribution)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3...): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

### Milestone 1: Core Proxy MVP

- [ ] **Phase 1: Proxy Server Foundation** - Transparent HTTP proxy with versioned routing, SSE streaming passthrough, and YAML configuration
- [ ] **Phase 2: Agent Identification & Cost Tracking** - Per-agent identification, token counting, real-time cost calculation, and cost summary API
- [ ] **Phase 3: Budget Enforcement & Loop Detection** - Hard/soft budget limits per agent, loop detection, auto-kill, and budget reset logic
- [ ] **Phase 4: Action Logging** - Async structured JSON logging with metadata/full-payload modes, log rotation, and query API
- [ ] **Phase 5: Packaging, Testing & Deployment** - Docker container, npm package, init wizard, CI pipeline, GDPR controls, and load testing

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

## Phase Details

---

### Phase 1: Proxy Server Foundation

**Goal**: Developers can route LLM API calls through the proxy and get transparent forwarding to OpenAI, Anthropic, and custom endpoints, with streaming SSE passthrough and YAML-driven configuration
**Depends on**: Nothing (first phase)
**Requirements**: PRXY-01, PRXY-02, PRXY-03, PRXY-04, PRXY-05, PRXY-06, PRXY-07, PRXY-08, PRXY-09, PRXY-10
**Success Criteria** (what must be TRUE):
  1. A curl request sent to the proxy with an OpenAI-format body returns a correct completion from the real OpenAI API
  2. A curl request sent to the proxy with an Anthropic-format body returns a correct completion from the real Anthropic API
  3. A streaming response begins forwarding chunks to the caller within 50ms of the real API returning its first token
  4. The health endpoint at /health returns 200 with version and uptime
  5. Upstream 429 errors are forwarded to the agent with original rate-limit headers preserved intact
**Plans**: 2 plans

Plans:
- [ ] 01-01-PLAN.md — Monorepo setup, TypeScript, HTTP proxy server with versioned routing (PRXY-01, PRXY-02, PRXY-03, PRXY-04, PRXY-10)
- [ ] 01-02-PLAN.md — SSE streaming passthrough, YAML config loader, health endpoint, 429 handling (PRXY-05, PRXY-06, PRXY-07, PRXY-08, PRXY-09)

---

### Phase 2: Agent Identification & Cost Tracking

**Goal**: Every proxied request is attributed to a specific agent with accurate token counts and real-time cost calculation available via API
**Depends on**: Phase 1
**Requirements**: COST-01, COST-02, COST-03, COST-04, COST-05, COST-06, COST-07, COST-08
**Success Criteria** (what must be TRUE):
  1. A request with X-Govyn-Agent header is attributed to the named agent in cost aggregates
  2. Cost calculated for 100 test requests is within 5% of provider billing for OpenAI and Anthropic models
  3. The cost summary API endpoint returns correct per-agent and per-period breakdowns
  4. Requests using unknown models are logged with a warning and the cost is marked as "unpriced"
**Plans**: TBD

Plans:
- [ ] 02-01: Agent identification (header + scoped API key), token counting (OpenAI + Anthropic)
- [ ] 02-02: Cost calculation engine, pricing table, in-memory aggregator, cost summary API

---

### Phase 3: Budget Enforcement & Loop Detection

**Goal**: Agents that exceed their spending limits are blocked with clear errors, and runaway looping agents are auto-killed before they can cause damage
**Depends on**: Phase 2
**Requirements**: BUDG-01, BUDG-02, BUDG-03, BUDG-04, BUDG-05, BUDG-06, BUDG-07
**Success Criteria** (what must be TRUE):
  1. An agent exceeding its daily budget limit is blocked on the next request with a parseable JSON error specifying the limit and current spend
  2. An agent making 20+ identical calls within 60 seconds is auto-blocked with a loop_detected error
  3. Soft limit requests are forwarded but a warning event is emitted
  4. Budget status for any agent is queryable via API
  5. Budget limits are resettable: daily at midnight UTC, monthly at month start
**Plans**: TBD

Plans:
- [ ] 03-01: Budget config, enforcement middleware, hard/soft limit behavior, budget status API
- [ ] 03-02: Loop detection, auto-kill with configurable cooldown, budget reset logic

---

### Phase 4: Action Logging

**Goal**: Every proxied request generates a structured log entry asynchronously without adding latency, with configurable payload depth and a queryable log API
**Depends on**: Phase 3
**Requirements**: LOGG-01, LOGG-02, LOGG-03, LOGG-04, LOGG-05, LOGG-06
**Success Criteria** (what must be TRUE):
  1. Every proxied request generates a structured JSON log entry with timestamp, agent_id, target, model, tokens, cost, latency, and status fields
  2. Logging adds zero milliseconds to request latency (async, non-blocking)
  3. Full-payload mode captures the entire request and response body for an agent when configured
  4. Metadata mode captures only the summary fields without storing full content
  5. The log query API returns filtered results by agent, time range, or status
**Plans**: TBD

Plans:
- [ ] 04-01: Async structured log writer, metadata/full-payload modes, log rotation
- [ ] 04-02: Log query API with filtering

---

### Phase 5: Packaging, Testing & Deployment

**Goal**: Any developer can run the proxy locally in under 5 minutes using npx or Docker, and the entire test suite validates correctness and performance before every release
**Depends on**: Phase 4
**Requirements**: PACK-01, PACK-02, PACK-03, PACK-04, PACK-05, PACK-06, PACK-07, PACK-08
**Success Criteria** (what must be TRUE):
  1. `docker run govyn` starts a working proxy with default config using an image under 100MB
  2. `npx govyn` starts the proxy locally without additional setup
  3. `npx govyn init` wizard completes and produces a working configuration file
  4. A developer following the README quickstart has the proxy running and logs a first request in under 5 minutes on a fresh machine
  5. The CI pipeline passes lint, unit tests, integration tests, and load test showing p95 latency under 50ms overhead at 100 concurrent requests
**Plans**: TBD

Plans:
- [ ] 05-01: Dockerfile, docker-compose, npm package, npx govyn init wizard
- [ ] 05-02: CI pipeline, unit tests, integration tests, streaming tests
- [ ] 05-03: Load tests, failure mode tests, GDPR log region flag, log purge endpoint

---

### Phase 6: Policy Definition & Parser

**Goal**: Teams can write YAML policy files that define governance rules, validate them with the CLI, and have them take effect immediately without restarting the proxy
**Depends on**: Phase 5
**Requirements**: PLCY-01, PLCY-02, PLCY-03, PLCY-04, PLCY-05, PLCY-06
**Success Criteria** (what must be TRUE):
  1. A YAML policy file with version field is parsed and validated with clear errors for schema violations
  2. All six policy rule types (block, require_approval, rate_limit, budget_limit, content_filter, time_window) are accepted by the parser
  3. `govyn policy validate <file>` reports valid or invalid with specific error locations
  4. Changing a policy file on disk causes the proxy to reload policies without restarting
  5. When two policies conflict, the most restrictive one wins
**Plans**: TBD

Plans:
- [ ] 06-01: Policy YAML schema, parser, all rule types, scoping, conflict resolution
- [ ] 06-02: Hot-reload file watcher, govyn policy validate CLI command

---

### Phase 7: Policy Evaluation Engine

**Goal**: Every proxied request is evaluated against all active policies in under 5ms, producing an allow, block, or queue_for_approval decision with the correct reason
**Depends on**: Phase 6
**Requirements**: EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05, EVAL-06, EVAL-07, EVAL-08
**Success Criteria** (what must be TRUE):
  1. A request matching a block policy is rejected with a structured error identifying the policy
  2. A request matching a require_approval policy produces a queue_for_approval outcome
  3. Content pattern matching (regex) correctly blocks requests whose bodies match a configured pattern
  4. Time window evaluation blocks requests outside the configured allowed hours
  5. Policy evaluation for 100 active policies completes in under 5ms
**Plans**: TBD

Plans:
- [ ] 07-01: In-memory policy store, evaluation pipeline, target API matching
- [ ] 07-02: Regex content matching, time window evaluation, sliding window rate limit counters

---

### Phase 8: Approval Queue

**Goal**: When a policy requires human approval, the agent receives an immediate HTTP 202 with a token and can poll for the decision, while a human approves or denies via webhook or callback
**Depends on**: Phase 7
**Requirements**: APRV-01, APRV-02, APRV-03, APRV-04, APRV-05, APRV-06, APRV-07
**Success Criteria** (what must be TRUE):
  1. An agent triggering a require_approval policy receives HTTP 202 with approval_token and poll URL within normal proxy latency (no connection held open)
  2. The poll endpoint returns the current status (pending/approved/denied) accurately
  3. A webhook notification is POSTed to the configured URL with action details and approve/deny callback links
  4. After approval, an agent re-sending the request with X-Govyn-Approval header has it forwarded immediately
  5. A timed-out approval triggers the configured default action (approve or deny)
**Plans**: TBD

Plans:
- [ ] 08-01: In-memory approval queue, HTTP 202 response, poll endpoint
- [ ] 08-02: Webhook notification, approve/deny callback endpoints, timeout handling

---

### Phase 9: Policy Templates

**Goal**: Teams can bootstrap governance for common scenarios by selecting pre-built policy templates rather than writing YAML from scratch
**Depends on**: Phase 8
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04
**Success Criteria** (what must be TRUE):
  1. At least 10 named policy templates are available (production-safety, budget-control, compliance-audit, pii-protection, business-hours-only, read-only-mode, staged-rollout, external-comms-approval, data-export-control, emergency-lockdown)
  2. Each template has documented use-case descriptions
  3. `govyn policy init` generates starter policy files from selected templates
  4. Each template passes its own acceptance tests against sample requests
**Plans**: TBD

Plans:
- [ ] 09-01: 10+ policy templates with documentation
- [ ] 09-02: govyn policy init command, template test suite

---

### Phase 10: Dashboard Foundation

**Goal**: Teams can sign up, authenticate, manage API keys, and subscribe to a paid plan through a working React dashboard backed by PostgreSQL
**Depends on**: Phase 9
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06
**Success Criteria** (what must be TRUE):
  1. A new user can sign up, sign in, and manage team members through Clerk auth
  2. Users can generate, list, and revoke proxy API keys from the dashboard
  3. The dashboard layout renders with sidebar navigation and org/team selector
  4. The backend API connects to PostgreSQL and database migrations run cleanly
  5. A user can select a subscription plan through Stripe and have feature gates enforced on proxy requests
**Plans**: TBD

Plans:
- [ ] 10-01: React+TypeScript+Tailwind project, Clerk auth integration, dashboard layout
- [ ] 10-02: API key management, PostgreSQL backend, database migrations
- [ ] 10-03: Stripe billing integration, plan enforcement on proxy requests

---

### Phase 11: Cost & Activity Views

**Goal**: Teams can see live cost breakdowns across all agents and inspect individual agent activity in real time from the dashboard
**Depends on**: Phase 10
**Requirements**: VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05
**Success Criteria** (what must be TRUE):
  1. The cost overview page shows total spend, spend by agent, spend by model, and a time-series chart
  2. The agent list page shows all agents with last active timestamp, total cost, and status indicators
  3. The agent detail page shows call history, cost breakdown, active policies, and budget status for a specific agent
  4. The activity feed shows a real-time stream of agent actions filterable by agent, team, target, and risk level
  5. Live data updates without manual page refresh via WebSocket or polling
**Plans**: TBD

Plans:
- [ ] 11-01: Cost overview page, agent list page, agent detail page
- [ ] 11-02: Real-time activity feed with filtering, auto-refresh WebSocket/polling

---

### Phase 12: Policy Management UI

**Goal**: Non-technical team members can manage governance policies through a form-based UI without writing YAML, with dry-run testing and version history
**Depends on**: Phase 11
**Requirements**: PMUI-01, PMUI-02, PMUI-03, PMUI-04, PMUI-05
**Success Criteria** (what must be TRUE):
  1. The policy list page shows all active policies with working enable/disable toggles
  2. A user can create or edit a policy through a form without writing any YAML
  3. A user can dry-run a sample request against current policies and see what decision would be made
  4. Policy version history shows who changed a policy and when
  5. A user can browse pre-built templates, customize one, and deploy it as an active policy
**Plans**: TBD

Plans:
- [ ] 12-01: Policy list page with enable/disable, form-based policy editor
- [ ] 12-02: Policy dry-run testing, version history, template browser

---

### Phase 13: Approval Queue UI & Alerts

**Goal**: Reviewers can see pending agent actions awaiting approval, act on them with a click, and configure alerts for budget thresholds and policy triggers
**Depends on**: Phase 12
**Requirements**: AQUE-01, AQUE-02, AQUE-03, AQUE-04, AQUE-05
**Success Criteria** (what must be TRUE):
  1. The pending approvals page lists all actions waiting for human review
  2. Each approval detail page shows the full context of what the agent tried to do and which policy triggered
  3. A reviewer can approve or deny an action with an optional note using dashboard buttons
  4. Alert rules can be configured for email and webhook delivery on budget thresholds, policy triggers, and anomalies
  5. A notification history log shows all alerts that have been sent
**Plans**: TBD

Plans:
- [ ] 13-01: Pending approvals page, approval detail view, approve/deny actions
- [ ] 13-02: Alert configuration UI, notification history log

---

### Phase 14: Session Replay

**Goal**: Developers can step through a complete agent session call-by-call in the dashboard and compare two sessions side-by-side to understand behavioral differences
**Depends on**: Phase 13
**Requirements**: RPLY-01, RPLY-02, RPLY-03, RPLY-04, RPLY-05
**Success Criteria** (what must be TRUE):
  1. Related API calls are automatically grouped into agent sessions
  2. A session timeline lets the user step forward and backward through each call in sequence
  3. Two sessions can be viewed side-by-side for comparison
  4. A session can be exported as JSON for offline analysis
  5. Sessions containing errors or policy blocks are visually highlighted in the session list
**Plans**: TBD

Plans:
- [ ] 14-01: Session grouping logic, session timeline step-through view
- [ ] 14-02: Side-by-side comparison, JSON export, failed session highlighting

---

### Phase 15: Anomaly Detection

**Goal**: The system automatically detects abnormal agent behavior (cost spikes, error loops, statistical deviations) and alerts configured channels without manual monitoring
**Depends on**: Phase 14
**Requirements**: ANOM-01, ANOM-02, ANOM-03, ANOM-04, ANOM-05
**Success Criteria** (what must be TRUE):
  1. A per-agent baseline of call frequency, cost, and error rate is calculated and updated continuously
  2. An alert fires when any metric exceeds N standard deviations from the agent's baseline
  3. A cost spike alert fires when an agent's hourly cost exceeds 3x its normal rate
  4. Pattern-based loop detection identifies repeated call sequences beyond just identical-call matching
  5. Anomaly alerts are delivered through configured channels (email, webhook)
**Plans**: TBD

Plans:
- [ ] 15-01: Baseline calculation engine, deviation alerting, cost spike detection
- [ ] 15-02: Enhanced loop pattern detection, anomaly alert delivery

---

### Phase 16: Framework SDKs

**Goal**: Python and Node.js developers can drop the Govyn SDK in as a one-line replacement for their existing openai/anthropic clients, with automatic agent ID injection and policy error handling
**Depends on**: Phase 15
**Requirements**: FSDK-01, FSDK-02, FSDK-03, FSDK-04, FSDK-05
**Success Criteria** (what must be TRUE):
  1. The Python SDK wraps the openai and anthropic clients and routes all calls through the Govyn proxy
  2. The Node.js SDK wraps openai and @anthropic-ai/sdk and routes all calls through the Govyn proxy
  3. Both SDKs automatically inject the agent ID header, surface policy block errors in a structured way, and can query budget status
  4. The LangChain callback handler integrates with LangChain's callback system and proxies calls through Govyn
  5. Documentation and working examples exist for each SDK and the LangChain integration
**Plans**: TBD

Plans:
- [ ] 16-01: Python SDK wrapping openai and anthropic clients
- [ ] 16-02: Node.js SDK wrapping openai and @anthropic-ai/sdk
- [ ] 16-03: LangChain callback handler, documentation and examples

---

### Phase 17: Open Source Launch

**Goal**: The Govyn proxy is publicly released as a polished open-source project with complete documentation, automated releases, and a coordinated launch across developer communities
**Depends on**: Phase 16
**Requirements**: LNCH-01, LNCH-02, LNCH-03, LNCH-04, LNCH-05, LNCH-06, LNCH-07, LNCH-08, LNCH-09
**Success Criteria** (what must be TRUE):
  1. The GitHub repo is clean and public with a comprehensive README covering quickstart, architecture, and contribution guide
  2. CONTRIBUTING.md exists with PR process, code style, and issue templates
  3. MIT license is applied to the proxy codebase
  4. GitHub Actions CI/CD pipeline produces automated releases with semantic versioning
  5. The npm package and Docker Hub image are published and publicly accessible
  6. Terms of Service and Privacy Policy documents are published covering GDPR and log data handling
  7. Launch posts go live on Hacker News, Reddit (r/AI_Agents, r/LocalLLaMA, r/SaaS), and Twitter/X, and the cloud dashboard is submitted to Product Hunt
**Plans**: TBD

Plans:
- [ ] 17-01: Repo cleanup, README, CONTRIBUTING.md, MIT license file
- [ ] 17-02: GitHub Actions CI/CD, npm publish, Docker Hub publish
- [ ] 17-03: Terms of Service, Privacy Policy, launch posts, Product Hunt submission

---

### Phase 18: Distribution & Growth

**Goal**: Govyn reaches early adopters through VC portfolio networks, content marketing, and framework ecosystem listings, establishing a feedback loop with paying customers
**Depends on**: Phase 17
**Requirements**: GROW-01, GROW-02, GROW-03, GROW-04, GROW-05
**Success Criteria** (what must be TRUE):
  1. VC network outreach is executed with free Team tier offers for portfolio companies
  2. At least one "Agent Incident Report" blog post analyzing a public agent failure is published
  3. Govyn is listed as an integration in the LangChain and/or CrewAI documentation
  4. Community infrastructure exists (GitHub issues open, Discord server live)
  5. A regular feedback cadence with early adopters is established
**Plans**: TBD

Plans:
- [ ] 18-01: VC network outreach, blog series kickoff
- [ ] 18-02: Framework ecosystem listings, Discord setup, early adopter feedback cadence

---

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Proxy Server Foundation | M1: Core Proxy MVP | 0/2 | Planned | - |
| 2. Agent Identification & Cost Tracking | M1: Core Proxy MVP | 0/2 | Not started | - |
| 3. Budget Enforcement & Loop Detection | M1: Core Proxy MVP | 0/2 | Not started | - |
| 4. Action Logging | M1: Core Proxy MVP | 0/2 | Not started | - |
| 5. Packaging, Testing & Deployment | M1: Core Proxy MVP | 0/3 | Not started | - |
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
