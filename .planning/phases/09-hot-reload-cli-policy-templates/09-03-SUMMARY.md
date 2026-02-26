---
phase: 09-hot-reload-cli-policy-templates
plan: 03
subsystem: templates
tags: [yaml, policy-templates, governance, model-routing, pii, rate-limiting, budget]

# Dependency graph
requires:
  - phase: 07-policy-rule-types
    provides: "Block, rate_limit, budget_limit, content_filter, time_window evaluators"
  - phase: 08-smart-model-routing
    provides: "Model route evaluator with criteria matching and alias resolution"
provides:
  - "11 pre-built policy template YAML files in templates/policies/"
  - "Validation and evaluation test coverage for all templates"
  - "Showcase smart model routing template with Anthropic and OpenAI tiers"
affects: [documentation, packaging, dashboard-template-browser]

# Tech tracking
tech-stack:
  added: []
  patterns: ["JS-compatible regex patterns in YAML (no inline (?i) flag)"]

key-files:
  created:
    - templates/policies/production-safety.yaml
    - templates/policies/budget-control.yaml
    - templates/policies/pii-protection.yaml
    - templates/policies/business-hours-only.yaml
    - templates/policies/read-only-mode.yaml
    - templates/policies/emergency-lockdown.yaml
    - templates/policies/smart-model-routing.yaml
    - templates/policies/rate-limit-standard.yaml
    - templates/policies/cost-conscious.yaml
    - templates/policies/development-sandbox.yaml
    - templates/policies/high-security.yaml
    - tests/policy-templates.test.ts
  modified: []

key-decisions:
  - "Used JS-compatible character class regex ([Dd][Ee][Ll]...) instead of inline (?i) flag for case-insensitive SQL pattern matching"
  - "smart-model-routing max_downgrade_level: standard prevents Haiku routing, ensuring minimum quality floor"
  - "emergency-lockdown disabled by default (operator enables during emergencies)"
  - "high-security template combines 3 policy types (content_filter + time_window + block) for defense in depth"

patterns-established:
  - "Policy template structure: version 1 header, policies array, descriptive YAML comments with customization guidance"
  - "Template naming: kebab-case matching the governance scenario (e.g., production-safety, business-hours-only)"

requirements-completed: [TMPL-01, TMPL-02]

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 9 Plan 03: Policy Templates Summary

**11 pre-built YAML policy templates covering safety, budgets, PII, time windows, model routing, rate limiting, and multi-layer security with 38 test assertions**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T23:50:36Z
- **Completed:** 2026-02-25T23:54:44Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Created 11 policy template YAML files covering all specified governance scenarios
- Smart model routing template showcases Anthropic (Haiku/Sonnet/Opus) and OpenAI (GPT-4o-mini/GPT-4o) tiers per ADR-021
- All templates include descriptive YAML comments with customization guidance
- 38 tests across 2 suites (validation + evaluation) proving correct enforcement behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Create 11 policy template YAML files** - `a280601` (feat)
2. **Task 2: Add validation and evaluation tests for all templates** - `98b5f5a` (test)

## Files Created/Modified
- `templates/policies/production-safety.yaml` - Block destructive SQL, shell commands, credential exposure
- `templates/policies/budget-control.yaml` - Daily ($50) and monthly ($500) spending limits
- `templates/policies/pii-protection.yaml` - SSN, credit card, email, phone content filtering
- `templates/policies/business-hours-only.yaml` - Weekday 09:00-17:00 UTC time window
- `templates/policies/read-only-mode.yaml` - Block write/delete/create path patterns
- `templates/policies/emergency-lockdown.yaml` - Disabled kill switch for all requests
- `templates/policies/smart-model-routing.yaml` - Anthropic + OpenAI model tier routing
- `templates/policies/rate-limit-standard.yaml` - 10 requests per 60 seconds
- `templates/policies/cost-conscious.yaml` - Aggressive model routing + tight budget limits
- `templates/policies/development-sandbox.yaml` - Permissive rate limits for dev/testing
- `templates/policies/high-security.yaml` - PII filter + time window + destructive pattern blocking
- `tests/policy-templates.test.ts` - 38 tests validating and evaluating all templates

## Decisions Made
- Used JavaScript-compatible character class regex `[Dd][Ee][Ll]...` instead of PCRE inline `(?i)` flag, since the policy engine uses `new RegExp()` which does not support inline flags
- Smart model routing `max_downgrade_level: standard` on Anthropic policy prevents routing below Sonnet, ensuring quality floor even when rules suggest Haiku
- Emergency lockdown uses `enabled: false` by default so it can be deployed as a dormant kill switch
- High-security template combines 3 policy types for defense-in-depth approach

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed JavaScript-incompatible regex (?i) flag in templates**
- **Found during:** Task 1 verification (via Task 2 tests)
- **Issue:** `(?i)` inline case-insensitive flag is not valid JavaScript RegExp syntax; the policy engine uses `new RegExp(pattern)` which throws on `(?i)`
- **Fix:** Replaced `(?i)` with character class alternation `[Dd][Ee][Ll][Ee][Tt][Ee]` for case-insensitive SQL keyword matching
- **Files modified:** `templates/policies/production-safety.yaml`, `templates/policies/high-security.yaml`
- **Verification:** All 38 tests pass after fix
- **Committed in:** a280601 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for correctness. No scope creep.

## Issues Encountered
None beyond the regex compatibility issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 9 complete: hot reload (09-01), CLI validate (09-02), and templates (09-03) all delivered
- Ready for Phase 9.1 (parser validation and tech debt cleanup)
- Templates can be referenced in documentation and packaging

## Self-Check: PASSED

- All 12 created files exist on disk
- Both task commits (a280601, 98b5f5a) found in git log
- 508/508 tests pass in full suite (no regressions)

---
*Phase: 09-hot-reload-cli-policy-templates*
*Completed: 2026-02-25*
