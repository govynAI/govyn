# Requirements: Govyn

**Defined:** 2026-02-24
**Core Value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Proxy Foundation

- [x] **PRXY-01**: Proxy transparently forwards HTTP requests to OpenAI API with correct request/response format
- [x] **PRXY-02**: Proxy transparently forwards HTTP requests to Anthropic API with correct request/response format
- [x] **PRXY-03**: Proxy forwards requests to user-configured custom OpenAI-compatible endpoints
- [x] **PRXY-04**: Proxy supports versioned URL routing: /v1/openai/*, /v1/anthropic/*, /v1/custom/:name/*
- [ ] **PRXY-05**: Proxy streams SSE responses chunk-by-chunk without buffering entire response
- [ ] **PRXY-06**: Streaming response starts within 50ms of real API first token
- [ ] **PRXY-07**: Health check endpoint returns 200 with version and uptime
- [ ] **PRXY-08**: Configuration loaded from YAML file for proxy settings, API targets, agent definitions
- [ ] **PRXY-09**: Upstream 429 responses forwarded to agent with original rate limit headers preserved
- [x] **PRXY-10**: Proxy adds <50ms p95 latency overhead

### Agent Identification & Cost Tracking

- [ ] **COST-01**: Agents identified via X-Govyn-Agent header or scoped API keys
- [ ] **COST-02**: Per-request token counting (input/output) for OpenAI models from response usage field
- [ ] **COST-03**: Per-request token counting (input/output) for Anthropic models from response usage field
- [ ] **COST-04**: Real-time cost calculation using configurable model pricing table
- [ ] **COST-05**: In-memory cost aggregation by agent, model, and time period (hour/day/month rolling windows)
- [ ] **COST-06**: Cost summary API endpoint with agent and period filtering
- [ ] **COST-07**: Unknown models logged with warning, cost marked as "unpriced"
- [ ] **COST-08**: Cost calculated within 5% accuracy of provider billing

### Budget Enforcement & Loop Detection

- [ ] **BUDG-01**: Per-agent daily and monthly budget limits configurable in YAML
- [ ] **BUDG-02**: Hard limit blocks calls when budget exceeded with clear JSON error response
- [ ] **BUDG-03**: Soft limit forwards request but emits warning event
- [ ] **BUDG-04**: Loop detection blocks agent after N identical calls in M seconds (configurable)
- [ ] **BUDG-05**: Auto-kill blocks looping agent for configurable cooldown period
- [ ] **BUDG-06**: Budget resets at midnight UTC (daily) and month start (monthly)
- [ ] **BUDG-07**: Budget status queryable via API

### Action Logging

- [ ] **LOGG-01**: Every proxied request generates structured JSON log entry (timestamp, agent_id, target, model, tokens, cost, latency, status)
- [ ] **LOGG-02**: Logging is async and non-blocking — adds 0ms to request latency
- [ ] **LOGG-03**: Metadata-only mode captures summary without full content (default)
- [ ] **LOGG-04**: Full-payload mode captures entire request/response (configurable per-agent)
- [ ] **LOGG-05**: Log rotation with configurable max file size
- [ ] **LOGG-06**: Log query API endpoint with filtering

### Packaging & Deployment

- [ ] **PACK-01**: Docker container starts a working proxy with default config (image <100MB)
- [ ] **PACK-02**: `npx govyn` starts proxy locally
- [ ] **PACK-03**: `npx govyn init` interactive wizard generates working config
- [ ] **PACK-04**: README quickstart works in <5 minutes on fresh machine
- [ ] **PACK-05**: CI pipeline: lint, test, build, publish npm + Docker image
- [ ] **PACK-06**: Configurable log storage region (EU/US) for GDPR
- [ ] **PACK-07**: Log purge endpoint: DELETE /api/logs?before=DATE
- [ ] **PACK-08**: Load test passes: p95 latency <50ms overhead at 100 concurrent requests

### Policy Definition & Parser

- [ ] **PLCY-01**: Policy YAML schema with version field, validated by parser
- [ ] **PLCY-02**: Policy types: block, require_approval, rate_limit, budget_limit, content_filter, time_window
- [ ] **PLCY-03**: Policy scoping: global, per-agent, per-target-API (most specific wins)
- [ ] **PLCY-04**: Conflict resolution: most restrictive policy wins
- [ ] **PLCY-05**: `govyn policy validate <file>` CLI command
- [ ] **PLCY-06**: Hot-reload: policy file changes take effect without restart

### Policy Evaluation Engine

- [ ] **EVAL-01**: In-memory policy store loaded from parsed YAML
- [ ] **EVAL-02**: Evaluation pipeline finds matching policies and evaluates in priority order
- [ ] **EVAL-03**: Regex-based content pattern matching on request bodies
- [ ] **EVAL-04**: Target API matching by provider, endpoint, or action type
- [ ] **EVAL-05**: Time window evaluation (allowed hours enforcement)
- [ ] **EVAL-06**: Per-agent per-policy sliding window rate limit counters
- [ ] **EVAL-07**: Evaluation result: allow, block (with reason), or queue_for_approval
- [ ] **EVAL-08**: <5ms evaluation time for 100 active policies

### Approval Queue

- [ ] **APRV-01**: Policy trigger returns HTTP 202 immediately with approval_token and poll URL
- [ ] **APRV-02**: Poll endpoint returns current approval status (pending/approved/denied)
- [ ] **APRV-03**: Webhook notification to configured URL with action details and callback links
- [ ] **APRV-04**: Approve/deny callback endpoints
- [ ] **APRV-05**: Configurable timeout with default action (approve or deny)
- [ ] **APRV-06**: Approved requests resubmitted by agent with X-Govyn-Approval header, forwarded immediately
- [ ] **APRV-07**: Works identically on Cloudflare Workers and Docker deployments

### Policy Templates

- [ ] **TMPL-01**: 10+ pre-built policy templates (production-safety, budget-control, compliance-audit, pii-protection, business-hours-only, read-only-mode, staged-rollout, external-comms-approval, data-export-control, emergency-lockdown)
- [ ] **TMPL-02**: Template documentation with use-case descriptions
- [ ] **TMPL-03**: `govyn policy init` generates starter policies from templates
- [ ] **TMPL-04**: Each template tested against sample requests

### Dashboard Foundation

- [ ] **DASH-01**: React + TypeScript + Tailwind project with Clerk auth (sign up, sign in, team management)
- [ ] **DASH-02**: API key management: generate, revoke, list proxy API keys
- [ ] **DASH-03**: Dashboard layout: sidebar navigation, top bar with org/team selector
- [ ] **DASH-04**: Backend API connecting to PostgreSQL with database migrations
- [ ] **DASH-05**: Stripe integration: subscription management, plan selection, usage metering
- [ ] **DASH-06**: Plan enforcement: check org's tier on proxy requests, enforce agent limits and feature gates

### Cost & Activity Views

- [ ] **VIEW-01**: Cost overview page: total spend, by agent, by model, time-series chart
- [ ] **VIEW-02**: Agent list page: all agents with last active, total cost, status indicators
- [ ] **VIEW-03**: Agent detail page: call history, cost breakdown, active policies, budget status
- [ ] **VIEW-04**: Real-time activity feed with filtering by agent, team, target, risk level
- [ ] **VIEW-05**: Auto-refresh via WebSocket or polling for live data

### Policy Management UI

- [ ] **PMUI-01**: Policy list page with enable/disable toggles
- [ ] **PMUI-02**: Form-based policy editor (no YAML required in UI)
- [ ] **PMUI-03**: Policy dry-run: test sample request against policies
- [ ] **PMUI-04**: Policy version history with who/when tracking
- [ ] **PMUI-05**: Template browser: select, customize, deploy pre-built templates

### Approval Queue UI & Alerts

- [ ] **AQUE-01**: Pending approvals page listing actions waiting for approval
- [ ] **AQUE-02**: Approval detail: full context, triggering policy, agent info
- [ ] **AQUE-03**: Approve/deny buttons with optional reviewer note
- [ ] **AQUE-04**: Alert configuration: email and webhook alerts for budget thresholds, policy triggers, anomalies
- [ ] **AQUE-05**: Notification history log

### Session Replay

- [ ] **RPLY-01**: Session grouping: cluster related API calls into agent sessions
- [ ] **RPLY-02**: Session timeline visualization with step-through
- [ ] **RPLY-03**: Side-by-side session comparison
- [ ] **RPLY-04**: Session export as JSON
- [ ] **RPLY-05**: Failed session highlighting (errors or policy blocks)

### Anomaly Detection

- [ ] **ANOM-01**: Baseline calculation: rolling average of call frequency, cost, error rate per agent
- [ ] **ANOM-02**: Deviation alerting when metrics exceed N standard deviations
- [ ] **ANOM-03**: Cost spike detection (hourly cost exceeds 3x normal)
- [ ] **ANOM-04**: Enhanced loop detection: pattern matching across call sequences
- [ ] **ANOM-05**: Anomaly alerts via configured channels

### Framework SDKs

- [ ] **FSDK-01**: Python SDK wraps openai and anthropic clients, routes through Govyn proxy
- [ ] **FSDK-02**: Node.js SDK wraps openai and @anthropic-ai/sdk, routes through Govyn proxy
- [ ] **FSDK-03**: SDKs auto-inject agent ID, handle policy block errors, query budget status
- [ ] **FSDK-04**: LangChain callback handler integration
- [ ] **FSDK-05**: Documentation and examples for each SDK/integration

### Open Source Launch

- [ ] **LNCH-01**: Clean repo with comprehensive README (quickstart, architecture, contribution guide)
- [ ] **LNCH-02**: CONTRIBUTING.md with PR process, code style, issue templates
- [ ] **LNCH-03**: MIT license for proxy, proprietary for dashboard
- [ ] **LNCH-04**: GitHub Actions CI/CD with semantic versioning and automated releases
- [ ] **LNCH-05**: npm publish and Docker Hub publish
- [ ] **LNCH-06**: Terms of Service with governance disclaimer
- [ ] **LNCH-07**: Privacy Policy covering log data, PII, GDPR, right to deletion
- [ ] **LNCH-08**: Launch posts: HN, Reddit (r/AI_Agents, r/LocalLLaMA, r/SaaS), Twitter/X
- [ ] **LNCH-09**: Product Hunt launch for cloud dashboard

### Distribution & Growth

- [ ] **GROW-01**: VC network outreach: free Team tier for portfolio companies
- [ ] **GROW-02**: "Agent Incident Report" blog series
- [ ] **GROW-03**: Integration listings in framework ecosystems (LangChain, CrewAI docs)
- [ ] **GROW-04**: Community management: GitHub issues, Discord server
- [ ] **GROW-05**: Customer feedback loop: monthly check-ins with early adopters

## v2 Requirements

### Tool Call Governance (Non-LLM)

- **TOOL-01**: Framework SDK intercepts actual database/email/Slack/CRM tool calls before execution
- **TOOL-02**: Risk classification on non-LLM tool calls (read/write/delete/admin)
- **TOOL-03**: CrewAI integration plugin
- **TOOL-04**: OpenAI Agents SDK middleware
- **TOOL-05**: AutoGen plugin

### Multi-Agent Visibility

- **MAGT-01**: Trace requests across chains of agents (Agent A → Agent B → API)
- **MAGT-02**: Delegation tree visualization
- **MAGT-03**: Shared state conflict detection

### Enterprise Features

- **ENTR-01**: SSO/SAML authentication
- **ENTR-02**: SOC2-ready compliance export
- **ENTR-03**: Custom policy templates per org
- **ENTR-04**: Dedicated support tier

## Out of Scope

| Feature | Reason |
|---------|--------|
| Desktop/computer-use agent governance | Fundamentally different architecture (mouse/keyboard), <5% of deployments |
| Crypto/blockchain payment rails | SMB/enterprise want Stripe; crypto infra too early (ADR-015) |
| Native mobile app | Web dashboard first; mobile adds complexity without clear ROI |
| Kubernetes-native deployment | Different buyer (Fortune 500); we serve 5-50 person teams with `npx` |
| MCP/A2A protocol support | Enterprise protocol complexity; Agentgateway owns this space |
| Prompt-level governance | This is the problem we solve — our architecture makes prompt-level rules unnecessary |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PRXY-01 | Phase 1 | Complete |
| PRXY-02 | Phase 1 | Complete |
| PRXY-03 | Phase 1 | Complete |
| PRXY-04 | Phase 1 | Complete |
| PRXY-05 | Phase 1 | Pending |
| PRXY-06 | Phase 1 | Pending |
| PRXY-07 | Phase 1 | Pending |
| PRXY-08 | Phase 1 | Pending |
| PRXY-09 | Phase 1 | Pending |
| PRXY-10 | Phase 1 | Complete |
| COST-01 | Phase 2 | Pending |
| COST-02 | Phase 2 | Pending |
| COST-03 | Phase 2 | Pending |
| COST-04 | Phase 2 | Pending |
| COST-05 | Phase 2 | Pending |
| COST-06 | Phase 2 | Pending |
| COST-07 | Phase 2 | Pending |
| COST-08 | Phase 2 | Pending |
| BUDG-01 | Phase 3 | Pending |
| BUDG-02 | Phase 3 | Pending |
| BUDG-03 | Phase 3 | Pending |
| BUDG-04 | Phase 3 | Pending |
| BUDG-05 | Phase 3 | Pending |
| BUDG-06 | Phase 3 | Pending |
| BUDG-07 | Phase 3 | Pending |
| LOGG-01 | Phase 4 | Pending |
| LOGG-02 | Phase 4 | Pending |
| LOGG-03 | Phase 4 | Pending |
| LOGG-04 | Phase 4 | Pending |
| LOGG-05 | Phase 4 | Pending |
| LOGG-06 | Phase 4 | Pending |
| PACK-01 | Phase 5 | Pending |
| PACK-02 | Phase 5 | Pending |
| PACK-03 | Phase 5 | Pending |
| PACK-04 | Phase 5 | Pending |
| PACK-05 | Phase 5 | Pending |
| PACK-06 | Phase 5 | Pending |
| PACK-07 | Phase 5 | Pending |
| PACK-08 | Phase 5 | Pending |
| PLCY-01 | Phase 6 | Pending |
| PLCY-02 | Phase 6 | Pending |
| PLCY-03 | Phase 6 | Pending |
| PLCY-04 | Phase 6 | Pending |
| PLCY-05 | Phase 6 | Pending |
| PLCY-06 | Phase 6 | Pending |
| EVAL-01 | Phase 7 | Pending |
| EVAL-02 | Phase 7 | Pending |
| EVAL-03 | Phase 7 | Pending |
| EVAL-04 | Phase 7 | Pending |
| EVAL-05 | Phase 7 | Pending |
| EVAL-06 | Phase 7 | Pending |
| EVAL-07 | Phase 7 | Pending |
| EVAL-08 | Phase 7 | Pending |
| APRV-01 | Phase 8 | Pending |
| APRV-02 | Phase 8 | Pending |
| APRV-03 | Phase 8 | Pending |
| APRV-04 | Phase 8 | Pending |
| APRV-05 | Phase 8 | Pending |
| APRV-06 | Phase 8 | Pending |
| APRV-07 | Phase 8 | Pending |
| TMPL-01 | Phase 9 | Pending |
| TMPL-02 | Phase 9 | Pending |
| TMPL-03 | Phase 9 | Pending |
| TMPL-04 | Phase 9 | Pending |
| DASH-01 | Phase 10 | Pending |
| DASH-02 | Phase 10 | Pending |
| DASH-03 | Phase 10 | Pending |
| DASH-04 | Phase 10 | Pending |
| DASH-05 | Phase 10 | Pending |
| DASH-06 | Phase 10 | Pending |
| VIEW-01 | Phase 11 | Pending |
| VIEW-02 | Phase 11 | Pending |
| VIEW-03 | Phase 11 | Pending |
| VIEW-04 | Phase 11 | Pending |
| VIEW-05 | Phase 11 | Pending |
| PMUI-01 | Phase 12 | Pending |
| PMUI-02 | Phase 12 | Pending |
| PMUI-03 | Phase 12 | Pending |
| PMUI-04 | Phase 12 | Pending |
| PMUI-05 | Phase 12 | Pending |
| AQUE-01 | Phase 13 | Pending |
| AQUE-02 | Phase 13 | Pending |
| AQUE-03 | Phase 13 | Pending |
| AQUE-04 | Phase 13 | Pending |
| AQUE-05 | Phase 13 | Pending |
| RPLY-01 | Phase 14 | Pending |
| RPLY-02 | Phase 14 | Pending |
| RPLY-03 | Phase 14 | Pending |
| RPLY-04 | Phase 14 | Pending |
| RPLY-05 | Phase 14 | Pending |
| ANOM-01 | Phase 15 | Pending |
| ANOM-02 | Phase 15 | Pending |
| ANOM-03 | Phase 15 | Pending |
| ANOM-04 | Phase 15 | Pending |
| ANOM-05 | Phase 15 | Pending |
| FSDK-01 | Phase 16 | Pending |
| FSDK-02 | Phase 16 | Pending |
| FSDK-03 | Phase 16 | Pending |
| FSDK-04 | Phase 16 | Pending |
| FSDK-05 | Phase 16 | Pending |
| LNCH-01 | Phase 17 | Pending |
| LNCH-02 | Phase 17 | Pending |
| LNCH-03 | Phase 17 | Pending |
| LNCH-04 | Phase 17 | Pending |
| LNCH-05 | Phase 17 | Pending |
| LNCH-06 | Phase 17 | Pending |
| LNCH-07 | Phase 17 | Pending |
| LNCH-08 | Phase 17 | Pending |
| LNCH-09 | Phase 17 | Pending |
| GROW-01 | Phase 18 | Pending |
| GROW-02 | Phase 18 | Pending |
| GROW-03 | Phase 18 | Pending |
| GROW-04 | Phase 18 | Pending |
| GROW-05 | Phase 18 | Pending |

**Coverage:**
- v1 requirements: 95 total
- Mapped to phases: 95
- Unmapped: 0

---
*Requirements defined: 2026-02-24*
*Last updated: 2026-02-24 after initial definition*
