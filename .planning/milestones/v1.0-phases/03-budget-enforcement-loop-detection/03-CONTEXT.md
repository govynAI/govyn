# Phase 3: Budget Enforcement & Loop Detection - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Hard/soft budget limits per agent and loop detection with auto-kill. Agents exceeding spending limits are blocked with clear errors. Runaway looping agents are auto-killed before causing damage. Budget resets at midnight UTC (daily) and month start (monthly). Budget status queryable via API.

</domain>

<decisions>
## Implementation Decisions

### Budget error responses
- Full detail in error JSON: limit_type, limit_amount, current_spend, reset_time, agent_id
- HTTP 429 status code for budget-blocked requests, with Retry-After header set to reset time
- Govyn-native error format: consistent `{ error: { type, code, message, details } }` across all providers — budget errors are clearly from the proxy, not the provider
- Distinct error codes per reason: `budget_exceeded_daily`, `budget_exceeded_monthly`, `loop_detected` — agents can react differently to each

### Loop detection criteria
- Identical = same target endpoint + same request body hash (exact match)
- Default threshold: 10 identical calls within 60 seconds triggers loop detection (configurable per-agent in YAML)
- Per-agent tracking only — global/cross-agent patterns deferred to Phase 15 (Anomaly Detection)
- Exact matching only — near-identical/fuzzy pattern detection deferred to Phase 15

### Warning & notification
- Soft limit warning delivered via BOTH response header AND internal event emission
- Warning header includes full details: `X-Govyn-Budget-Warning: { percent_used, current_spend, limit, resets_at }`
- Soft warning threshold configurable per agent in YAML config, default 80%
- Budget status API: both `GET /api/budgets` (all agents) and `GET /api/budgets/:agentId` (single agent)

### Cooldown & recovery
- Default loop cooldown: 5 minutes (configurable per-agent in YAML)
- Manual unblock via API: `POST /api/agents/:agentId/unblock` — clears cooldown immediately
- Budget resets are hard resets — counter zeros out, no history kept in budget module (historical spend already tracked by Phase 2 cost aggregator)
- Budget limits are absolute dollar amounts only (e.g., `daily_limit: 10.00`) — relative/dynamic limits deferred to Phase 15

### Claude's Discretion
- Internal data structures for tracking budget state and loop counters
- Sliding window vs fixed window implementation for loop detection
- Event emission mechanism (in-process event bus vs other approach)
- Budget enforcement middleware ordering relative to other middleware

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

- Near-identical/fuzzy loop detection (same prompt with minor variations) — Phase 15: Anomaly Detection
- Global cross-agent loop detection — Phase 15: Anomaly Detection
- Relative/dynamic budget limits (e.g., "150% of yesterday") — Phase 15: Anomaly Detection

</deferred>

---

*Phase: 03-budget-enforcement-loop-detection*
*Context gathered: 2026-02-24*
