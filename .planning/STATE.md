---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Framework SDKs
status: in_progress
last_updated: "2026-03-01T03:27:33Z"
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 9
  completed_plans: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-28)

**Core value:** Agents never hold real API keys. The proxy holds credentials and enforces governance at the infrastructure level — not the prompt level.
**Current focus:** v1.3 — Phase 17: Python SDK

## Current Position

Phase: 17 of 20 (Python SDK)
Plan: Complete (all 4 plans done)
Status: Phase 17 complete; PyPI publish deferred to manual action
Last activity: 2026-03-01 — Plan 17-04 complete (integration wiring, 81 tests passing, wheel built)

Progress: [█████████████░░░░░░░░░░░░░░░░░] 44%

## Performance Metrics

**Velocity:**
- Total plans completed: 40
- Average duration: 5 min
- Total execution time: 3.2 hours

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 16    | 01   | 2 min    | 2     | 1     |
| 17    | 01   | 8 min    | 2     | 7     |
| 17    | 02   | 15 min   | 1     | 3     |
| 17    | 03   | 6 min    | 1     | 5     |
| 17    | 04   | 21 min   | 1     | 2     |

## Accumulated Context

### Decisions

- [v1.3 Roadmap]: Subclass official clients rather than wrap — zero maintenance overhead for upstream feature additions
- [v1.3 Roadmap]: Python first (simpler build pipeline, dominant AI dev language, PyPI name already claimed)
- [v1.3 Roadmap]: `max_retries=0` required in all SDK constructors — proxy counts each request independently
- [v1.3 Roadmap]: `agent_id` required at construction time — raise clear error if absent (not silent "unknown")
- [v1.3 Roadmap]: `tsup` for Node.js dual CJS+ESM build; integration tests require live proxy (not mocked transport)
- [Phase 16]: Passthrough API key mode (`govyn-passthrough`) as recommended default over scoped `gvn_*` keys
- [Phase 16]: `base_url` derived from `proxy_url` + route prefix, not user-configurable
- [Phase 16]: Future error codes (HTTP 403 policy violation, budget warning header) documented but deferred to post-v1.3
- [Phase 17-01]: Removed async_check_proxy from __all__ -- sdk-spec.md only specifies check_proxy as public API
- [Phase 17-01]: httpx added as core dependency for check_proxy health endpoint support
- [Phase 17-02]: Used _make_status_error override instead of catch-and-re-raise -- prevents constructing an exception only to discard it
- [Phase 17-02]: Lazy class construction via _get_classes() with _cached_classes caching preserves class identity for isinstance checks
- [Phase 17-03]: Inlined _resolve_params in _anthropic.py to avoid cross-module coupling with _openai.py
- [Phase 17-03]: async_check_proxy uses httpx.AsyncClient context manager for proper resource cleanup
- [Phase 17-04]: Added async_check_proxy to __all__ for async user ergonomics (9 public symbols)
- [Phase 17-04]: Used subprocess isolation for lazy import tests to avoid in-process module cache contamination
- [Phase 17-04]: Used python -m build instead of hatch build for wheel generation on Windows

### Pending Todos

None.

### Blockers/Concerns

- [Phase 18]: npm package structure needs decision before planning — extend root `govyn` package exports map vs. separate sub-path. Architecture research recommends option (a) but flags as unresolved.
- [Phase 17]: Python deps bundled vs. optional extras — research recommends bundling both `openai` and `anthropic` as required deps for v1.3 simplicity.

## Session Continuity

Last session: 2026-03-01
Stopped at: Completed 17-04-PLAN.md (integration wiring, all tests pass, wheel built)
Resume file: None
