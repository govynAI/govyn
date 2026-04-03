<p align="center">
  <strong>Govyn</strong><br>
  Open-source AI agent governance proxy
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/providers-OpenAI%20%7C%20Anthropic%20%7C%20Google%20%7C%20Mistral-5b82d6" alt="Multi-Provider">
  <img src="https://img.shields.io/badge/type-API%20Proxy-brightgreen" alt="API Proxy">
</p>

---

An API proxy that sits between your AI agents and LLM providers. Your agents get a proxy URL — never real API keys. Budget enforcement, loop detection, policy-as-code, and smart model routing happen at the infrastructure layer, not inside your agent's code.

```bash
git clone https://github.com/govynAI/govyn.git && cd govyn && npm install && npm start
```

**SDK governance is a door lock — effective until someone finds another door. Govyn is a wall. There are no other doors.**

## The Problem

Every AI agent governance tool on the market is a library you import — an in-process wrapper that disappears the moment any code makes a direct HTTP call. This is the approach that failed when [Meta's alignment director lost 200+ emails](https://marklaursen.com/blog/ai-agents-need-governance-not-guardrails) because context window compaction silently stripped her safety instructions.

SDK-based governance is enforced by convention, not architecture. It works only as long as every line of code cooperates. In production, with autonomous agents that write and execute their own code, [that assumption is dangerous](https://govynai.com/blog/proxy-vs-sdk-ai-agent-governance).

## How Govyn Works

```
  Your Agent                    Govyn Proxy                   LLM Provider
  +--------+                   +-------------+                +-----------+
  |        |  proxy URL        |             |  real API key  |           |
  |  Agent +------------------>+  1. Auth    +--------------->+  OpenAI   |
  |        |  (no real key)    |  2. Policy  |                |  Anthropic|
  |        |                   |  3. Budget  |  response      |  Google   |
  |        |<------------------+  4. Loop    +<---------------+  Mistral  |
  |        |  response         |  5. Route   |                |           |
  +--------+                   |  6. Log     |                +-----------+
                               +-------------+
```

1. **Agent sends request** — standard API call to the proxy URL. No knowledge of the real API key.
2. **Policy evaluation** — YAML-defined rules checked in-memory. Model restrictions, content filters, human approval queues.
3. **Budget check** — per-agent daily/monthly spend limits with hard cutoffs. Not warnings — hard stops.
4. **Loop detection** — detects repetitive request patterns and [kills them before they burn your API budget overnight](https://govynai.com/blog/openclaw-agent-governance).
5. **Smart model routing** — downgrades simple requests to cheaper models transparently. Haiku instead of Opus, GPT-4o-mini instead of GPT-4o. [60-80% cost savings](https://govynai.com/blog/cut-ai-api-costs-without-code-changes) on qualifying requests.
6. **Forward and log** — injects real API key, forwards to provider, logs the full round trip.

None of these checks depend on the agent's cooperation. The agent cannot skip a step, forget an instruction, or lose context.

## Quick Start

```bash
# Clone and install
git clone https://github.com/govynAI/govyn.git
cd govyn
npm install

# Configure your provider keys
cp .env.example .env
# Edit .env with your OpenAI/Anthropic/Google API keys

# Start the proxy
npm start
```

Point your agent at the proxy URL instead of the provider URL:

```bash
# Before (agent holds real key)
OPENAI_API_KEY=sk-real-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# After (agent holds proxy token only)
OPENAI_API_KEY=proxy-token-here
OPENAI_BASE_URL=http://localhost:3000/v1
```

Zero agent code changes. Change the base URL and key. That's it.

## SDK Wrappers vs. Govyn

| | SDK Wrapper | Govyn Proxy |
|---|---|---|
| **Agent holds API keys** | Yes — can bypass wrapper | No — proxy holds keys |
| **Bypassable** | Yes — direct HTTP call skips it | No — no key means no access |
| **Survives context compaction** | No — instructions can be stripped | Yes — enforcement is external |
| **Budget enforcement** | In-process, trust-based | Infrastructure-level, hard cutoff |
| **Loop detection** | Requires agent self-awareness | Proxy detects patterns externally |
| **Audit trail** | Depends on agent logging | Every request logged at proxy |
| **Agent code changes** | Required (import library) | None — change the base URL |

## Policy-as-Code

Governance rules live in YAML files in version control. Every change is reviewed, auditable, and rollback-ready.

```yaml
# policies/production.yaml
agents:
  research-agent:
    allowed_models:
      - claude-sonnet-4-6
      - gpt-4o-mini
    budget:
      daily: 10.00
      monthly: 200.00
    rate_limit: 60/minute
    content_filters:
      - block_patterns: ["DELETE FROM", "DROP TABLE", "rm -rf"]
    require_approval:
      - model: claude-opus-4-6  # expensive model needs human OK

  code-agent:
    allowed_models:
      - claude-sonnet-4-6
    budget:
      daily: 25.00
      monthly: 500.00
    smart_routing:
      enabled: true
      downgrade_simple_to: claude-haiku-4-5
```

## Key Technical Features

**Semantic Caching** — Vector embeddings with cosine similarity on structured JSON arguments, plus deterministic SHA-256 hashing. 53-73% cost reduction in production workloads. 0% false-positive rate by caching only stateless tool invocations. [How we made it tamper-resistant](https://govynai.com/blog/tamper-resistant-ai-caching).

**Streaming-Aware Telemetry** — Extracts token counts and cost metrics inline from SSE streams (OpenAI and Anthropic formats) without buffering. [How to detect token count manipulation](https://govynai.com/blog/detecting-token-count-manipulation).

**MCP Governance Gateway** — HTTP-based tool discovery, JSON-RPC forwarding, and default-deny policy enforcement. Control which agents can invoke which external MCP tools at per-tool granularity.

**Multi-Tenant Security** — Per-org AES-256-GCM BYOK encryption, HMAC-SHA256 prefix-indexed key lookup, zero-downtime key rotation, SSRF protection, ReDoS-safe regex evaluation, timing-safe authentication. [Full security architecture deep dive](https://govynai.com/blog/ssrf-injection-defense-ai-proxy).

## Govyn Cloud

The open-source proxy handles governance enforcement on your own infrastructure. [Govyn Cloud](https://govynai.com) adds managed features that build on top of the proxy:

- **Semantic caching** — Hash-based exact-match and embedding-based semantic similarity caching for tool calls. Policy-driven, per-tool TTL, auto-suggest cacheable tools from observed patterns. Reduces redundant LLM calls by serving cached results for identical or semantically similar stateless tool calls.
- **Safety inspector** — 5 SQL-based analyzers observe agent behavior and auto-suggest policies (model routing, rate limits, budgets, content filters, cache policies). One-click apply with projected impact and confidence scores. Observe mode lets you trial policies without enforcement.
- **MCP governance** — MCP server registry with encrypted auth, JSON-RPC tool discovery, and default-deny proxy gateway. Extends the proxy model to MCP tool-calling protocols with full policy enforcement and telemetry.
- **Compliance export** — PDF compliance reports with 5 audit sections, R2 storage, scheduled and on-demand generation, email delivery via Resend. Provides auditable proof of governance for regulated environments.
- **Team CLI** — Browser OAuth login, live activity tail, YAML policy import/export, and commands for all cloud features. Terminal-first workflow for engineering teams.
- **Dashboard** — React SPA with Clerk auth, cost overview, agent detail, activity feed, policy management, approval queue, cache statistics, alert configuration, and billing management via Stripe.
- **Multi-tenant isolation** — Per-org proxy auth tokens, AES-256-GCM transit encryption, encryption key rotation, and prefix-based O(1) API key lookup.
- **Transactional emails** — 9 branded email templates (welcome, budget alerts, anomaly alerts, approval notifications, billing lifecycle, compliance reports) via Resend.

[Try Govyn Cloud →](https://govynai.com)

## Stack

TypeScript (strict), Node.js, PostgreSQL (Neon), Prisma, Cloudflare Workers/KV/Vectorize/R2/Workers AI, multi-provider LLM integration.

## Contributing

Contributions are welcome. The core architectural principle is non-negotiable: **agents never hold real API keys**. Everything else is open for improvement.

Areas where contributions are especially valuable:

- Additional LLM provider support
- Policy engine extensions (new rule types, evaluation strategies)
- Dashboard and observability improvements
- Documentation and examples

## Further Reading

**Architecture & Philosophy**
- [AI Agents Need Governance, Not Guardrails](https://marklaursen.com/blog/ai-agents-need-governance-not-guardrails) — the full analysis of why SDK wrappers fail and proxy-based governance works
- [Proxy vs SDK: Why Architecture Matters](https://govynai.com/blog/proxy-vs-sdk-ai-agent-governance) — comparative analysis of both approaches

**Real-World Cases**
- [How Replit's Database Deletion Could Have Been Prevented in 3 Lines of YAML](https://govynai.com/blog/replit-database-deletion-prevention) — policy-based governance for destructive actions
- [Your OpenClaw Agent Runs at 3am. What Stops It?](https://govynai.com/blog/openclaw-agent-governance) — loop detection and autonomous execution governance
- [We Cut Our AI API Bill by 73%](https://govynai.com/blog/cut-ai-api-costs-without-code-changes) — smart model routing in production

**Security**
- [Defense in Depth: SSRF, DNS Rebinding, and Injection Protection](https://govynai.com/blog/ssrf-injection-defense-ai-proxy) — six security hardening layers
- [Why Shared Secrets Are the Biggest Risk in Multi-Tenant AI](https://govynai.com/blog/multi-tenant-security-shared-secrets) — per-org encryption and isolation
- [Tamper-Resistant AI Response Caching](https://govynai.com/blog/tamper-resistant-ai-caching) — preventing cache poisoning
- [Detecting Token Count Manipulation](https://govynai.com/blog/detecting-token-count-manipulation) — independent BPE verification for billing integrity

**Commercial**
- [Govyn Cloud](https://govynai.com) — managed SaaS platform

## Related Projects

- **[Maestro](https://github.com/mbanderas/maestro)** — Research-grounded multi-agent orchestrator for AI coding agents. Maestro coordinates your agents; Govyn governs them. They are designed to work together.

## Community

Questions, bug reports, or governance use cases to share? [Open a discussion](https://github.com/govynAI/govyn/discussions) or [file an issue](https://github.com/govynAI/govyn/issues).

## License

MIT
