# Phase 10: Data Persistence & Proxy API - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Proxy persists all governance data (cost records, policy evaluations, approval events) to PostgreSQL and exposes API endpoints for the dashboard to consume. Includes the approval queue backend where agents can be paused pending human review. Dashboard UI for approvals is Phase 14. Dashboard UI for cost/budget viewing is Phase 12.

</domain>

<decisions>
## Implementation Decisions

### Approval timeout & expiry
- Auto-deny after configurable timeout (default: 30 minutes)
- Timeout is configurable per policy rule in YAML (each approval rule can set its own timeout)
- Denied responses include a distinct status: `denied_timeout` vs `denied` — agents can differentiate between human denial and timeout expiry
- Expired approval records remain in the database for audit trail purposes

### Proxy resilience when DB unavailable
- Behavior is configurable: fail-open (keep proxying, skip persistence) or fail-closed (reject requests)
- Default: fail-open — matches existing in-memory behavior, least surprising for new users
- In fail-open mode, records during DB outage are dropped silently (not buffered in memory). The JSONL file log still captures them if file logging is enabled
- Exception: approval-flagged requests ALWAYS require DB availability, even in fail-open mode. If DB is down and a policy triggers approval, the request is rejected — can't approve what you can't track

### Data retention
- Retention period is configurable (default: 90 days)
- Applies to cost records and policy evaluation logs
- Approval records (decisions, who approved, notes, timestamps) are retained longer than cost data — separate retention setting, default to 1 year
- Before deleting old cost records, aggregate them into daily summary rows per agent/model — preserves trend data for historical charts indefinitely without raw record storage
- Cleanup runs on a schedule (implementation detail left to Claude)

### Approval context & flow
- Configurable payload storage: default metadata-only, operators can opt-in to full request payload storage per policy
- Required metadata on every approval request (regardless of payload setting): agent ID, target model, which policy rule triggered, estimated cost, timestamp, plus a truncated preview/summary of the request content
- Polling endpoint returns status only (`pending`, `approved`, `denied`, `denied_timeout`) — does NOT forward the LLM response
- When approved, the agent re-sends the original request through the proxy with an approval token in a header (e.g., `X-Govyn-Approval: <token>`)
- Proxy validates the approval token and passes the request through without re-triggering the approval policy
- Approval tokens are single-use and tied to the original request context

### Claude's Discretion
- Database schema design (table structure, indexes, partitioning strategy)
- Migration framework choice and implementation
- Exact aggregation schedule and batch sizes for retention cleanup
- API endpoint URL structure and response formats
- Connection pooling and PostgreSQL client library choice
- Approval token generation mechanism (JWT, UUID, etc.)
- Truncation length for request summary in approval metadata

</decisions>

<specifics>
## Specific Ideas

- The proxy currently stores cost data in-memory (`CostAggregator`) and logs to JSONL files (`ActionLogger`). PostgreSQL persistence should complement, not replace, the JSONL file logging — file logs remain as a secondary record
- Approval flow: agent sends request → policy flags it → proxy returns HTTP 202 with polling URL → agent polls → human approves/denies in dashboard (Phase 14) → agent gets status → agent re-sends with approval token → proxy forwards to LLM
- The `denied_timeout` status should feel first-class, not like an error — agents should be able to programmatically handle timeouts differently from explicit denials

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-data-persistence-proxy-api*
*Context gathered: 2026-02-26*
