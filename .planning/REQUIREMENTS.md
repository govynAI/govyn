# Requirements: Govyn

**Defined:** 2026-02-25
**Core Value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level.

## v1.1 Requirements

Requirements for the Policy Engine milestone. Each maps to roadmap phases.

### Schema — Policy Schema & Configuration

- [ ] **SCHEMA-01**: User can define policies in versioned YAML format with a `policies` section
- [ ] **SCHEMA-02**: Policy schema is validated strictly with helpful error messages including line numbers
- [ ] **SCHEMA-03**: Six policy types supported: block, rate_limit, budget_limit, content_filter, time_window, model_route

### Eval — Policy Evaluation Engine

- [ ] **EVAL-01**: Policy engine evaluates all matching policies synchronously on every proxied request
- [ ] **EVAL-02**: 100 active policies evaluate in <5ms (synchronous, no I/O on hot path)
- [ ] **EVAL-03**: Policies scope to global, per-agent, or per-target-API with most-restrictive-wins precedence
- [ ] **EVAL-04**: Blocked requests return standardized 403 error with policy name, type, and human-readable reason
- [ ] **EVAL-05**: Policy enforcement events emitted via existing event system and included in action log entries

### Rule — Policy Rule Types

- [ ] **RULE-01**: Block policy denies requests matching configurable criteria: regex patterns on request body/headers, target API provider/endpoint, and action type classification
- [ ] **RULE-02**: Rate limit policy enforces per-agent sliding window call limits with configurable window and threshold
- [ ] **RULE-03**: Budget limit policy enforces spending limits within policy scoping (complementing existing budget enforcer)
- [ ] **RULE-04**: Content filter policy blocks requests containing sensitive patterns (SSN, credit card, configurable PII regex)
- [ ] **RULE-05**: Time window policy restricts API access to configured time periods (e.g., 09:00-17:00 UTC)
- [ ] **RULE-06**: Model route policy rewrites model field based on configurable criteria (token estimate, prompt keywords, agent ID, time of day, tool call presence, conversation turns)
- [ ] **RULE-07**: Model aliases map abstract tiers (cheap/standard/premium) to provider-specific model strings
- [ ] **RULE-08**: Model route safeguards: passthrough default when no rule matches, max_downgrade_level, per-agent routing opt-out
- [ ] **RULE-09**: Cost tracking logs both requested_model and actual_model for model-routed requests

### Reload — Hot Reload

- [ ] **RELOAD-01**: Policy file changes detected and reloaded within 1 second without proxy restart
- [ ] **RELOAD-02**: Invalid policy changes rejected with error logging, previous valid policies kept active

### CLI — CLI Tooling

- [ ] **CLI-01**: `govyn policy validate <file>` validates policy files and reports schema errors with line numbers

### Tmpl — Policy Templates

- [ ] **TMPL-01**: 10+ pre-built policy templates covering common governance scenarios (production-safety, budget-control, pii-protection, business-hours-only, read-only-mode, emergency-lockdown, etc.)
- [ ] **TMPL-02**: All policy templates pass validation and have test coverage

## Future Requirements

Deferred to later milestones. Tracked but not in current roadmap.

### Approval Queue (v1.2)

- **APPR-01**: Human-in-the-loop approval queue with async HTTP 202 + polling pattern
- **APPR-02**: Approval timeout and escalation handling
- **APPR-03**: Approval audit trail with approve/deny/notes

### Dashboard (v1.2/v1.3)

- **DASH-01**: React + TypeScript + Tailwind dashboard with Clerk auth
- **DASH-02**: Cost overview and per-agent drill-down
- **DASH-03**: Policy management UI (list, editor, dry-run testing, version history)
- **DASH-04**: Approval queue UI with approve/deny/notes
- **DASH-05**: Alert configuration (email/webhook on budget thresholds, policy triggers)

### SDKs & Integrations (v1.3+)

- **SDK-01**: Python SDK (drop-in replacement for openai/anthropic clients)
- **SDK-02**: Node.js SDK (drop-in replacement for openai/anthropic clients)
- **SDK-03**: LangChain callback handler and framework plugins
- **SDK-04**: OpenTelemetry export for traces and metrics

### Commercial (v1.3+)

- **COMM-01**: Stripe billing integration (Starter $29, Team $99, Enterprise $299)
- **COMM-02**: Dual key mode: Key Storage (strongest enforcement) and Passthrough (lowest friction)
- **COMM-03**: Self-hosted proxy + cloud dashboard deployment model
- **COMM-04**: Session replay with step-through and comparison views
- **COMM-05**: Anomaly detection (cost spikes, error loops, deviation alerting)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Approval queue / HTTP 202 pattern | Deferred to v1.2 — ship policy evaluation first |
| Dashboard UI for policy management | Deferred to v1.2/v1.3 — build UI after collecting usage feedback |
| Dual key mode changes | Orthogonal to policy engine; ships with dashboard (ADR-019) |
| Framework SDK integrations | Policy engine doesn't depend on SDKs; SDKs wrap existing proxy API |
| Slack/email notifications | Dashboard feature; policy engine emits events for future consumers |
| Database persistence for policies | Policies are YAML files; DB persistence comes with dashboard |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SCHEMA-01 | Phase 6 | Pending |
| SCHEMA-02 | Phase 6 | Pending |
| SCHEMA-03 | Phase 6 | Pending |
| EVAL-01 | Phase 6 | Pending |
| EVAL-02 | Phase 6 | Pending |
| EVAL-03 | Phase 6 | Pending |
| EVAL-04 | Phase 6 | Pending |
| EVAL-05 | Phase 6 | Pending |
| RULE-01 | Phase 7 | Pending |
| RULE-02 | Phase 7 | Pending |
| RULE-03 | Phase 7 | Pending |
| RULE-04 | Phase 7 | Pending |
| RULE-05 | Phase 7 | Pending |
| RULE-06 | Phase 8 | Pending |
| RULE-07 | Phase 8 | Pending |
| RULE-08 | Phase 8 | Pending |
| RULE-09 | Phase 8 | Pending |
| RELOAD-01 | Phase 9 | Pending |
| RELOAD-02 | Phase 9 | Pending |
| CLI-01 | Phase 9 | Pending |
| TMPL-01 | Phase 9 | Pending |
| TMPL-02 | Phase 9 | Pending |

**Coverage:**
- v1.1 requirements: 22 total
- Mapped to phases: 22 ✓
- Unmapped: 0

---
*Requirements defined: 2026-02-25*
*Last updated: 2026-02-25 after roadmap mapping*
