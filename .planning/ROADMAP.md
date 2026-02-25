# Roadmap: Govyn

## Overview

Govyn is an API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. This roadmap delivers the product across phases grouped into milestones.

## Milestones

- ✅ **v1.0 Core Proxy MVP** — Phases 1-5 (shipped 2026-02-25)
- 📋 **v1.1 Policy Engine** — Phases 6-9 (policy schema, rule types, model routing, templates)
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

### v1.1 Policy Engine

#### Phase 6: Policy Schema & Core Engine

**Goal:** Define the YAML policy schema, build the parser with strict validation, create the core evaluation engine with scoping hierarchy, integrate into the request pipeline with standardized error responses and event emission.

**Requirements:** SCHEMA-01, SCHEMA-02, SCHEMA-03, EVAL-01, EVAL-02, EVAL-03, EVAL-04, EVAL-05

**What gets built:**
- Policy YAML schema definition with `version: 1` field and six policy type skeletons
- Strict schema parser with line-number error reporting (leveraging yaml library source maps)
- PolicyEngine class: loads policies into memory, evaluates synchronously on every request
- Scoping hierarchy: global → per-agent → per-target-API, most-restrictive-wins precedence
- Integration into server.ts request pipeline between route matching and request forwarding
- Standardized 403 error response contract (per PRODUCT_SPEC section 5)
- Policy event types added to existing event system (policy_enforced, policy_denied)
- Policy evaluation result included in action log entries

**Success criteria:**
- Policy YAML files load and validate with helpful error messages
- Engine evaluates policies synchronously on every proxied request
- Scoping precedence works correctly (most restrictive wins)
- Blocked requests return standardized 403 with policy name and reason
- Events emitted and logged for all policy evaluations
- 100 policies evaluate in <5ms (benchmark test)

**Estimated plans:** 3

---

#### Phase 7: Policy Rule Types

**Goal:** Implement the five core rule type evaluators that plug into the policy engine: block, rate_limit, budget_limit, content_filter, and time_window.

**Requirements:** RULE-01, RULE-02, RULE-03, RULE-04, RULE-05

**What gets built:**
- Block evaluator: matches on regex patterns (request body/headers), target API provider/endpoint, and action type classification
- Rate limit evaluator: per-agent per-policy sliding window counters with configurable window and threshold
- Budget limit evaluator: spending limit enforcement within policy scoping (complementing existing budget enforcer via cost aggregator integration)
- Content filter evaluator: built-in PII patterns (SSN, credit card, email, phone) plus configurable custom regex
- Time window evaluator: allow/deny based on current time vs configured time periods (e.g., 09:00-17:00 UTC, with timezone and day-of-week support)

**Success criteria:**
- `block` policy denies requests matching regex on body, target API, or action type
- `rate_limit` correctly tracks sliding window per agent and returns 429 with retry_after_seconds
- `budget_limit` blocks when scoped spend exceeds limit
- `content_filter` catches SSN (XXX-XX-XXXX), credit card (16 digits), and custom patterns
- `time_window` blocks outside configured hours and allows within
- All rule types produce structured error responses with policy name and reason
- Each rule type has unit tests and integration tests through the proxy pipeline

**Estimated plans:** 2

---

#### Phase 8: Smart Model Routing

**Goal:** Implement the model_route policy type with rich criteria matching, provider-aware model aliases, safeguards, and dual-model cost logging.

**Requirements:** RULE-06, RULE-07, RULE-08, RULE-09

**What gets built:**
- Model route evaluator with configurable criteria: input_tokens_estimate, system/user prompt keyword matching (contains/no_contains), agent ID, time of day, tool_calls_present detection, conversation turn count
- Model alias system: abstract tiers (cheap/standard/premium) mapped to provider-specific model strings per provider configuration
- Safeguards: passthrough default when no rule matches, max_downgrade_level (prevent routing below a tier), per-agent routing opt-out (`routing: disabled`)
- Request body rewriting: modify `model` field in JSON before forwarding to upstream
- Cost tracking integration: record both `requested_model` and `actual_model` in cost aggregator and action logs
- Provider-aware routing: aliases resolve differently per provider (e.g., "cheap" = haiku for Anthropic, gpt-4o-mini for OpenAI)

**Success criteria:**
- Short prompt (<500 tokens) routes to cheap model when rule configured
- Keyword-based routing correctly matches system/user prompt content
- Model aliases resolve to correct provider-specific model strings
- Passthrough default: no rule match → request unchanged
- max_downgrade_level prevents routing below configured tier
- Per-agent opt-out works (routing: disabled)
- Cost tracking records both requested_model and actual_model
- Model rewrite is transparent to agent (response format unchanged)

**Estimated plans:** 2

---

#### Phase 9: Hot Reload, CLI & Policy Templates

**Goal:** Add file-watch hot reload for policy changes, the `govyn policy validate` CLI command, and 10+ pre-built policy templates with full test coverage.

**Requirements:** RELOAD-01, RELOAD-02, CLI-01, TMPL-01, TMPL-02

**What gets built:**
- File watcher (fs.watch/chokidar) monitoring policy YAML files for changes
- Hot reload: parse and validate changed file → if valid, swap in-memory policy store atomically; if invalid, log error and keep previous policies
- Reload latency: changes detected and applied within 1 second
- `govyn policy validate <file>` CLI command: validates policy files against schema, reports errors with line numbers, exits with appropriate code
- 10+ pre-built policy templates as YAML files in `templates/policies/`:
  - production-safety (block destructive patterns: DELETE FROM, DROP TABLE, rm -rf)
  - budget-control (daily/monthly limits per agent)
  - pii-protection (block SSN, credit card, email, phone patterns)
  - business-hours-only (restrict to 09:00-17:00 weekdays)
  - read-only-mode (block all write/delete operations)
  - emergency-lockdown (block all requests globally)
  - smart-model-routing (route to cheaper models for simple tasks)
  - rate-limit-standard (10 calls/minute per agent)
  - cost-conscious (model routing + budget limits combined)
  - development-sandbox (allow all but log everything at full depth)
  - high-security (content filter + time window + approval-ready stubs)
- Template documentation with usage examples
- Test coverage for all templates (validation + evaluation through engine)

**Success criteria:**
- Policy file change detected and reloaded within 1 second
- Invalid policy change rejected with error log, previous policies remain active
- `govyn policy validate` reports schema errors with line numbers
- `govyn policy validate` catches type-specific errors (invalid regex, missing fields)
- All 10+ templates pass validation
- All templates have integration tests proving they evaluate correctly
- Templates documented with copy-paste examples

**Estimated plans:** 2

---

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
| 6. Policy Schema & Core Engine | v1.1 | 0/3 | Not started | — |
| 7. Policy Rule Types | v1.1 | 0/2 | Not started | — |
| 8. Smart Model Routing | v1.1 | 0/2 | Not started | — |
| 9. Hot Reload, CLI & Policy Templates | v1.1 | 0/2 | Not started | — |
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
