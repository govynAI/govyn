# Govyn

## What This Is

An API proxy that sits between AI agents and every tool/API they call, enforcing policies, tracking costs, logging actions, and enabling replay — so agents physically cannot bypass governance rules. Open-source proxy core with a SaaS dashboard for teams deploying AI agents in production.

Shipped v1.0: transparent HTTP proxy with per-agent cost tracking, budget enforcement, loop detection, structured logging, Docker + npm packaging.

Shipped v1.1: YAML policy-as-code engine with 6 rule types (block, rate_limit, budget_limit, content_filter, time_window, model_route), in-memory evaluation (<5ms for 100 policies), hot reload, CLI validation, and 11 pre-built templates.

Shipped v1.2: Full-stack governance dashboard — React + TypeScript + Tailwind with Clerk auth, PostgreSQL persistence, cost monitoring with per-agent drill-down, policy management with in-browser YAML editor, human-in-the-loop approval queue with HTTP 202 polling, and webhook-based alert configuration.

## Core Value

Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level. If the proxy blocks an action, the agent has no alternative path to the real API.

## Requirements

### Validated

- ✓ LLM API proxy that transparently forwards requests to OpenAI, Anthropic, and any OpenAI-compatible API — v1.0
- ✓ Streaming SSE passthrough with <50ms p95 added latency — v1.0 (achieved <5ms per-request overhead)
- ✓ Per-request token counting and real-time cost calculation across providers — v1.0
- ✓ Budget enforcement with per-agent daily/monthly hard and soft limits — v1.0
- ✓ Loop detection and auto-kill for runaway agents — v1.0
- ✓ Structured action logging (async, non-blocking) with configurable depth — v1.0
- ✓ Agent identification via X-Govyn-Agent header or scoped API keys — v1.0
- ✓ YAML configuration for proxy settings, providers, agents, budgets — v1.0
- ✓ Docker container and npm package deployment — v1.0
- ✓ Versioned API: /v1/openai/*, /v1/anthropic/*, /v1/custom/:name/* — v1.0
- ✓ CLI tool (govyn init) — v1.0
- ✓ YAML policy-as-code engine with block, rate_limit, budget_limit, content_filter, time_window, model_route rules — v1.1
- ✓ In-memory policy evaluation (<5ms for 100 policies) with scoping hierarchy (global → agent → target) — v1.1
- ✓ Smart model routing with criteria matching, provider-aware aliases, safeguards, and dual-model cost tracking — v1.1
- ✓ Hot reload: file-watch with <1s detection, atomic policy swap, invalid-change rejection — v1.1
- ✓ `govyn policy validate` CLI command with line-number error reporting — v1.1
- ✓ 11 pre-built policy templates (production-safety, budget-control, pii-protection, business-hours-only, etc.) — v1.1
- ✓ React + TypeScript + Tailwind dashboard with Clerk auth (sign up, sign in, sign out) — v1.2
- ✓ PostgreSQL persistence via Neon with fire-and-forget writes, versioned migrations, retention management — v1.2
- ✓ Cost overview with per-agent drill-down, budget status indicators, Recharts time-series charts — v1.2
- ✓ Policy management UI with CodeMirror 6 YAML editor, live validation, 7 type-specific templates — v1.2
- ✓ Human-in-the-loop approval queue — HTTP 202 + polling, dashboard approve/deny with notes, audit trail — v1.2
- ✓ Alert configuration with budget threshold and policy trigger rules, webhook delivery, alert history — v1.2

### Active (v1.3)

- [ ] Python SDK — drop-in replacement for openai/anthropic Python clients, routes through Govyn proxy
- [ ] Node.js SDK — drop-in replacement for openai/anthropic Node clients, routes through Govyn proxy

### Future

- [ ] Stripe billing integration (Starter $29, Team $99, Enterprise $299)
- [ ] Session replay with step-through and comparison views
- [ ] Anomaly detection (cost spikes, error loops, deviation alerting)
- [ ] LangChain callback handler and framework plugins
- [ ] Self-hosted proxy + cloud dashboard deployment model
- [ ] Dual key mode: Key Storage (strongest enforcement) and Passthrough (lowest friction)
- [ ] Fail-open default with configurable fail-closed mode
- [ ] OpenTelemetry export for traces and metrics

### Out of Scope

- Desktop/computer-use agent governance (Simular, OpenClaw-style mouse/keyboard automation) — fundamentally different architecture, covers <5% of current agent deployments
- Crypto/blockchain payment rails — enterprise and SMB customers want standard Stripe billing (ADR-015)
- Native mobile apps — web dashboard first
- Competing with Agentgateway/Solo.io on Kubernetes/MCP/A2A enterprise infrastructure — different buyer, different stack, different price point

## Current State

Shipped v1.2 Dashboard & Governance Platform. Govyn is now a full-stack governance product with proxy + dashboard + persistence.

**Next milestone:** v1.3 Framework SDKs — Python and Node.js drop-in replacements

## Context

**Current state:** Shipped v1.2 Dashboard & Governance Platform with 35,724 LOC TypeScript. Tech stack: Node.js/TypeScript proxy, React + TypeScript + Tailwind dashboard, PostgreSQL (Neon), Clerk auth, Vitest, YAML config. Docker + npm packaging. Full governance dashboard with cost monitoring, policy management, approval queue, and alert configuration.

**Market position:** No proxy-architecture governance product exists for non-enterprise teams. All direct competitors (AgentBudget, TealTiger, AgentGuard47, Coralogix, AgentOps) use SDK/wrapper models where real API keys remain in the agent's environment. The proxy model is architecturally unbypassable — "a wall, not a door lock."

**Competitive landscape (Feb 2026):**
- SDK competitors do cost tracking but not infrastructure-enforced governance
- Enterprise proxy (Agentgateway) targets Fortune 500 on Kubernetes — different buyer entirely
- Adjacent funded players (Lumia $18M, Alinia, Asteroid YC W25) focus on security/compliance, not general governance + cost + debugging
- No single tool combines policy-as-code + cost control + session replay

**Evidence of need:** Production failures from Replit (database deletion), Amazon (service outage), Anthropic (hallucinated payments), Meta (email deletion despite "ask first" rules) — all caused by agents with direct, ungoverned API access.

**Distribution:** 200+ VC contacts for portfolio company outreach. Open-source launch on HN/Reddit. Framework ecosystem listings (LangChain, CrewAI docs).

**Domain:** GovynAI.com. Packages: govyn on npm (published), govynai on PyPI (published, PEP 541 claim pending for govyn).

## Constraints

- **Architecture**: Proxy, not SDK — this is the core differentiator and non-negotiable (ADR-001)
- **Latency**: <50ms p95 added latency, <20ms aspiration (ADR-013)
- **Streaming**: SSE passthrough is first-class, not a bolt-on (ADR-005)
- **Open source**: Proxy core must be fully functional without dashboard (ADR-003)
- **Runtime**: Must run on Cloudflare Workers (cloud) and Docker/Node (self-hosted) (ADR-011)
- **Stack**: Node.js/TypeScript proxy, React+TypeScript+Tailwind dashboard, PostgreSQL (Neon), R2/S3 logs, Clerk auth (ADR-010, ADR-012)
- **Solo founder**: Monorepo structure, ship fast, minimize operational complexity

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Proxy architecture, not SDK | Agents physically can't bypass governance without real API keys (ADR-001) | ✓ Good — v1.0 proxy works, <5ms per-request overhead |
| Fail-open default | Being a SPOF is biggest adoption blocker; fail-open means our bugs don't cause customer outages (ADR-002) | ✓ Good — unknown models return "unpriced" not errors |
| Open-source proxy, SaaS dashboard | Trust through transparency; monetize via dashboard following Sentry/PostHog model (ADR-003) | — Pending (dashboard not yet built) |
| Dual key mode (storage vs. passthrough) | Passthrough removes trust barrier; key storage for maximum enforcement; conversion path between them (ADR-019) | — Pending |
| YAML policy format | Human-readable, diff-friendly, version-controllable; dashboard provides visual editor (ADR-008) | ✓ Good — YAML config validated in v1.0, policy engine shipped in v1.1 with strict parser and line-number errors |
| In-memory policy evaluation | <5ms on hot path; DB only for persistence and dashboard reads (ADR-006) | ✓ Good — 100 policies in <5ms, synchronous evaluation on every request |
| Async logging, never block hot path | Latency is #1 concern for proxy; losing a log entry acceptable, adding latency is not (ADR-007) | ✓ Good — 0ms added latency, async flush on 1s interval |
| Cloudflare Workers for cloud proxy | Edge execution (300+ locations), native streaming support, minimal network hop (ADR-011) | — Pending |
| PostgreSQL via Neon | Handles structured queries, JSONB for flexible schemas, time-series for cost aggregation (ADR-012) | — Pending (dashboard in v1.2) |
| Async approval queue (HTTP 202 + polling) | CF Workers can't hold connections; pattern works across all deployment models (ADR-017) | — Pending (approval queue in v1.2) |
| Customer holds own API keys (default) | "Give a startup my API keys" is non-starter; passthrough mode forwards without storing (ADR-004, ADR-019) | ✓ Good — env var keys, never written to config |
| Versioned API and policy schema | Customers depend on proxy contract for production agents; breaking changes need migration path (ADR-018) | ✓ Good — /v1/ prefix established, policy schema version: 1 |
| No crypto/blockchain | Enterprise/SMB want standard Stripe billing; crypto infra is early and niche (ADR-015) | ✓ Good — no demand signal |
| Node.js http module (no frameworks) | Zero-dependency proxy forwarding for minimum latency (ADR-013) | ✓ Good — proven in v1.0 and v1.1 load tests |
| Real HTTP server pairs for testing | More reliable than mocked sockets, catches real integration issues | ✓ Good — 531 tests passing |
| In-memory cost aggregation with flat records | Simple query-time filtering, sufficient for single-node proxy scale | ✓ Good — works for v1.0/v1.1, DB aggregation deferred to dashboard |
| yaml parseDocument() for source maps | Line-number error reporting requires AST access, not just parsed values | ✓ Good — parser reports exact YAML line numbers for errors |
| fs.watch() over chokidar/fs.watchFile | Event-driven sub-second detection with zero dependencies | ✓ Good — <1s reload, handles cross-OS editor quirks |
| Model route never denies | Routing is optimization, not enforcement — always allowed:true, routes or passes through | ✓ Good — clean separation from deny-type policies |
| Token estimation via chars/4 | No external tokenizer dependency; sufficient accuracy for routing criteria | ✓ Good — simple, fast, no dependency |
| Dashboard as separate React app | UI iteration independent of proxy; monorepo with separate build (ADR-010) | ✓ Good — rapid dashboard dev without touching proxy |
| PostgreSQL via Neon | Structured queries, JSONB, time-series aggregation (ADR-012) | ✓ Good — fire-and-forget writes, zero proxy latency impact |
| Clerk auth for dashboard | Managed auth, social login, minimal setup | ✓ Good — sign up/in/out working, team-ready |
| Async approval queue (HTTP 202 + polling) | CF Workers can't hold connections; universal deployment pattern (ADR-017) | ✓ Good — full lifecycle working (request → poll → approve/deny → re-send) |
| Webhook-only alerts (no email) | Email adds SMTP/provider complexity; webhook covers automation use cases | ✓ Good — webhook delivery with cooldown, extensible |
| postgres (porsager/postgres) | ESM-native, zero-dependency PostgreSQL client | ✓ Good — clean ESM imports, simple API |
| Fire-and-forget DB writes | Proxy latency is sacred; losing a log entry is acceptable | ✓ Good — 0ms added latency with full persistence |
| CodeMirror 6 for YAML editor | Lightweight, extensible, theme-able via CSS variables | ✓ Good — syntax highlighting, inline lint markers, scrollToLine |
| Tailwind v4 via Vite plugin | No PostCSS config needed, future-proof | ⚠️ Revisit — shadcn/ui doesn't natively support v4 yet |

---
*Last updated: 2026-02-28 after v1.3 milestone start*
