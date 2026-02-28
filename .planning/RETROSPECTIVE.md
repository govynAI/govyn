# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.2 — Dashboard & Governance Platform

**Shipped:** 2026-02-28
**Phases:** 6 | **Plans:** 14

### What Was Built
- PostgreSQL persistence layer with fire-and-forget DB writes and versioned migrations
- Full React dashboard with Clerk auth, responsive sidebar, dark/light theming
- Cost monitoring with per-agent drill-down, Recharts charts, budget health indicators
- Policy management with CodeMirror 6 YAML editor, live validation, 7 templates
- Human-in-the-loop approval queue with HTTP 202 + polling, modal with notes, audit trail
- Alert configuration with budget/policy trigger rules, webhook delivery, cooldown enforcement

### What Worked
- Fire-and-forget DB write pattern kept proxy latency at zero while adding persistence
- Separate dashboard app (not embedded in proxy) allowed rapid UI iteration without touching proxy code
- Phase-per-feature parallelism — phases 12-15 had minimal cross-dependencies, enabling fast sequential execution
- Consistent UI patterns (sortable tables, toggle switches, expandable rows, toast notifications) across all dashboard pages reduced cognitive overhead
- YAML Document API (parseDocument) for policy CRUD preserved comments and formatting — avoided user frustration

### What Was Inefficient
- shadcn CLI output path issue hit twice (11-01 and 11-02) — could have been caught after first occurrence
- Chart implementation required a gap closure phase (12-03) because stacked chart on costs overview was missed in initial planning
- Tailwind v4 + shadcn/ui required manual CSS variable setup since shadcn doesn't natively support Tailwind v4 yet

### Patterns Established
- 3-state connection model (connected/reconnecting/disconnected) with differentiated ping intervals
- Data-fetching hooks that gate on proxy connection before fetching
- Optimistic UI updates with revert-on-error for toggle operations
- Fragment-based expandable table rows for detail panels
- Conditional field sets driven by radio button type selection in forms
- In-memory cooldown caches to avoid DB reads in event handling hot paths

### Key Lessons
1. Gap closure phases work well — better to ship fast and close gaps than to over-plan upfront
2. Consistent component patterns (tables, badges, modals, toasts) across pages dramatically speed up later phases
3. Fire-and-forget writes are the right default for proxy persistence — zero latency impact, acceptable data loss risk
4. Browser-compatible YAML validation (yaml parseDocument) eliminates server roundtrip for editor validation

### Cost Observations
- Model mix: quality profile (opus for planning, sonnet for execution)
- Total execution time: ~66 min across 14 plans (avg 4.7 min/plan)
- Notable: v1.2 plans averaged faster than v1.0/v1.1 due to established patterns and component reuse

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Avg/Plan | Key Change |
|-----------|--------|-------|----------|------------|
| v1.0 | 5 | 12 | 6 min | Foundation — establishing patterns |
| v1.1 | 6 | 12 | 4 min | Gap closure phases introduced (7.1, 9.1) |
| v1.2 | 6 | 14 | 4.7 min | Full-stack feature phases, UI component reuse |

### Cumulative Quality

| Milestone | LOC | Files Changed | Deviations |
|-----------|-----|---------------|------------|
| v1.0 | 15,401 | 112 | N/A |
| v1.1 | 23,696 | 31 (+7,660) | 2 gap-closure phases |
| v1.2 | 35,724 | 93 (+15,750) | 1 gap-closure plan, 7 auto-fixed issues |

### Top Lessons (Verified Across Milestones)

1. Zero-latency hot path is sacred — async writes, in-memory evaluation, fire-and-forget persistence
2. Gap closure phases/plans are a feature, not a failure — they produce cleaner results than over-planning
3. Consistent patterns compound — each milestone executes faster than the last due to established conventions
