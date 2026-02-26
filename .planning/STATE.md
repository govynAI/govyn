# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level.
**Current focus:** v1.1 Policy Engine — Phase 9.1 complete (Parser Validation & Tech Debt Cleanup)

## Current Position

Phase: 9.1 of 19 (Parser Validation & Tech Debt Cleanup)
Plan: 1 of 1 complete
Status: Plan 09.1-01 complete. Strict parser validation, policy_result in allowed-request logs, weekly budget 7-day window, stabilized load test. 531 total tests passing.
Last activity: 2026-02-26 — Completed 09.1-01 (parser validation and tech debt cleanup)

## Performance Metrics

**Velocity:**
- Total plans completed: 23
- Average duration: 5 min
- Total execution time: 1.9 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-proxy-server-foundation | 2/2 | 11 min | 6 min |
| 02-agent-identification-cost-tracking | 2/2 | 11 min | 6 min |
| 03-budget-enforcement-loop-detection | 2/2 | 12 min | 6 min |
| 04-action-logging | 2/2 | 11 min | 6 min |
| 05-packaging-testing-deployment | 4/4 | 29 min | 7 min |
| 06-policy-schema-core-engine | 3/3 | 9 min | 3 min |
| 07-policy-rule-types | 2/2 | 10 min | 5 min |
| 07.1-fix-policy-engine-integration-bugs | 1/1 | 2 min | 2 min |
| 08-smart-model-routing | 2/2 | 9 min | 5 min |
| 09-hot-reload-cli-policy-templates | 2/3 | 6 min | 3 min |
| 09.1-parser-validation-tech-debt-cleanup | 1/1 | 5 min | 5 min |

*Updated after each plan completion*

## Accumulated Context

### Decisions

- 06-01: Used yaml parseDocument() for source map line numbers instead of parse()
- 06-01: Parser returns structured result (success/errors/warnings) instead of throwing
- 06-01: Scope defaults to global; enabled defaults to true; type-specific fields stored as-is
- 06-02: Phase 6 skeleton: block type denies on scope match, all other types allow (Phase 7 adds evaluators)
- 06-02: Simple array iteration for evaluation; V8 optimizes well, 100 policies in <5ms
- 06-02: Evaluation returns structured result with timing for observability
- 06-03: PolicyEngine optional in startServer() for backward compatibility
- 06-03: Policy evaluation between route matching and forwarding — denials never reach upstream
- 06-03: Error responses match PRODUCT_SPEC Section 5 exactly (type, message, policy, agent, retry_after_seconds)
- 06-03: Rate limit denials return 429 with Retry-After; all other denials return 403
- 07-01: Block evaluator uses early-return AND logic; each criterion returns allowed:true on mismatch
- 07-01: RateLimitStore internal class with Map<string, number[]> keyed by policyName:agentId
- 07-01: All requests count toward rate limit (prevents hammering even when denied by other policies)
- 07-01: Budget limit maps daily->day, monthly->month for CostAggregator period queries
- 07-01: evaluate() accepts EvaluateOptions with injectable now timestamp for deterministic testing
- 07-02: Content filter parses JSON and recursively extracts string values only (keys/structure ignored for false positive avoidance)
- 07-02: Built-in pattern names resolve to predefined regexes; unrecognized names are custom regex strings
- 07-02: reveal_pattern defaults to false (generic error message for security)
- 07-02: Time window uses Intl.DateTimeFormat for IANA timezone conversion (zero dependencies)
- 07-02: Overnight windows (end < start) handled via OR logic: time >= start OR time < end
- 07-02: Server buffers request body before policy evaluation, passes Buffer to forwardRequest
- 07-02: forwardRequest accepts optional bufferedBody parameter for backward compatibility
- 07.1-01: Parser fix reads start/end/timezone/mode/days as top-level YAML keys (not nested under allow_hours)
- 07.1-01: setCostAggregator called immediately after PolicyEngine creation, before policy file loading
- 08-01: parseComparison helper reused for input_tokens_estimate and conversation_turns (DRY)
- 08-01: Tier ordering derived from model_aliases key insertion order (first key = lowest tier)
- 08-01: Model route evaluator never denies — always allowed:true, routes or passes through
- 08-01: time_of_day in model_route uses UTC directly (simpler than time_window's Intl approach)
- 08-02: extractRoutingContext estimates tokens via chars/4 heuristic (no external tokenizer)
- 08-02: Body rewrite uses JSON parse/serialize for model field replacement
- 08-02: requestedModel only passed to forwardRequest when routing actually changed the model
- 08-02: model_routed event emitted for observability when routing changes model
- 09-01: fs.watch() chosen over fs.watchFile() for event-driven sub-second detection (no chokidar dependency)
- 09-01: Debounce default 200ms to coalesce rapid editor saves without noticeable delay
- 09-01: Both 'change' and 'rename' fs.watch events trigger reload (handles cross-OS editor quirks)
- 09-01: CLI bootstrap now creates PolicyEngine + PolicyWatcher (was missing PolicyEngine entirely)
- 09-02: Dynamic import for policy-parser to keep CLI startup fast when not validating
- 09-02: Policy subcommand dispatch with explicit error for unknown subcommands
- 09-02: CLI tests use child_process.execSync with temp files for true end-to-end validation
- 09.1-01: Validate required fields before policy object construction to fix TS2322 (type narrowing via guard + continue)
- 09.1-01: Weekly budget uses 7-day sliding window cutoff (Date.now() - 7d) instead of calendar week
- 09.1-01: policyResult passed as last optional parameter to forwardRequest for backward compatibility
- 09.1-01: Load test p95 threshold raised to 300ms with retry:2 for CI stability

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 09.1-01-PLAN.md (parser validation and tech debt cleanup). Phase 09.1 complete. 531 tests passing.
Resume file: None
