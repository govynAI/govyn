# Phase 7: Policy Rule Types - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the five core rule type evaluators (block, rate_limit, budget_limit, content_filter, time_window) that plug into the Phase 6 PolicyEngine skeleton. Each evaluator replaces the skeleton's stub logic with real matching/enforcement. The model_route type is Phase 8 scope.

</domain>

<decisions>
## Implementation Decisions

### Block match logic
- Multiple match criteria combine with AND logic — all criteria must be true to trigger a block
- Action type classification is inferred from the API endpoint path (e.g., /chat/completions = 'chat', /images/generations = 'image_generation', /embeddings = 'embedding')
- Match values are literal strings by default; add a `regex: true` flag to enable regex mode per match field
- Model field is supported as a match criterion — block policies can restrict which models agents access (e.g., block 'gpt-4' for a specific agent)

### Rate limit behavior
- In-memory sliding window counters — reset on server restart, no persistence layer needed
- Dynamic `retry_after_seconds` calculated as time until the oldest request in the window expires (gives agents precise retry timing)
- All requests count toward the limit, including requests denied by other policies (prevents hammering)
- Error response includes usage info: remaining quota, window size, and reset time in the JSON error body

### Content filter scope
- Parse the request body as JSON, extract all string values, and scan those (avoids false positives from JSON structure/keys)
- Scan outgoing request bodies only — response scanning is not in scope
- Built-in PII patterns (SSN, credit card, email, phone) are opt-in per pattern — policy author explicitly lists which to enable (e.g., `patterns: [ssn, credit_card]`)
- Custom regex patterns configured alongside built-in pattern names in the same list
- Pattern name reveal in error responses is configurable per policy via a `reveal_pattern` flag — defaults to generic ("content blocked by policy X"), opt-in to specific ("SSN pattern detected")

### Budget limit behavior
- Integrates with the existing cost aggregator from earlier phases
- Spending limits enforced within policy scoping (global, per-agent, per-target)

### Time window configuration
- Configurable IANA timezone per policy (e.g., `timezone: America/New_York`) — not UTC-only
- Day-of-week supports shorthand presets (`weekdays`, `weekends`, `daily`) plus individual named days (`monday`, `wednesday`, `friday`)
- Mode is configurable: `allow` (access permitted during window) or `deny` (access blocked during window) — policy author chooses
- Single time range per policy (one start/end pair) — for complex schedules, create multiple policies

### Claude's Discretion
- Budget limit period handling (daily/weekly/monthly reset mechanics)
- Exact built-in PII regex patterns (precision vs recall tradeoff)
- Rate limit sliding window data structure implementation
- Action type classification mapping (which endpoints map to which action types)
- Error response structure details beyond the decisions above

</decisions>

<specifics>
## Specific Ideas

- Rate limit error responses should help agents self-regulate — include enough info for smart retry logic
- Content filter should avoid false positives from JSON structure, which is why parsed string scanning was chosen over raw body regex
- Block match with model field serves as a hard restriction complement to Phase 8's model routing

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-policy-rule-types*
*Context gathered: 2026-02-25*
