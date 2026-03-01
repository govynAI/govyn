---
phase: 17-python-sdk
plan: 02
subsystem: sdk
tags: [python, openai, subclassing, error-interception, govynai, respx]

# Dependency graph
requires:
  - phase: 17-python-sdk plan 01
    provides: Package scaffold, _constants.py, _errors.py, __init__.py with lazy imports
  - phase: 16-sdk-specification
    provides: sdk-spec.md canonical specification for constructor params, URL construction, error parsing
provides:
  - GovynOpenAI drop-in replacement for openai.OpenAI with proxy routing
  - GovynAsyncOpenAI drop-in replacement for openai.AsyncOpenAI with proxy routing
  - _make_status_error override for intercepting Govyn governance 429 errors
  - conftest.py with clean_env fixture for test isolation
affects: [17-python-sdk plan 03, 18-node-sdk]

# Tech tracking
tech-stack:
  added: [openai>=2.0, respx, pytest-asyncio]
  patterns: [lazy-class-construction, _cached_classes singleton, _make_status_error override]

key-files:
  created:
    - python-sdk/govynai/_openai.py
    - python-sdk/tests/test_openai.py
    - python-sdk/tests/conftest.py
  modified: []

key-decisions:
  - "Used _make_status_error override instead of catch-and-re-raise for error interception -- prevents constructing an exception only to discard it"
  - "Lazy class construction via _get_classes() with _cached_classes caching preserves class identity for isinstance checks"
  - "Header casing preserved as X-Govyn-Agent in _custom_headers dict (not lowercased)"

patterns-established:
  - "_get_classes() pattern: lazily import upstream SDK and build subclass inside a function, cache result in module-level variable"
  - "_resolve_params() shared resolver for agent_id, proxy_url, api_key -- reusable for Anthropic wrapper"
  - "conftest.py clean_env fixture with autouse=True monkeypatching for test isolation"

requirements-completed: [PSDK-01, PSDK-02, PSDK-05]

# Metrics
duration: 15min
completed: 2026-03-01
---

# Phase 17 Plan 02: OpenAI Wrapper Summary

**GovynOpenAI and GovynAsyncOpenAI subclassing openai SDK with lazy import, proxy routing, forced max_retries=0, agent header injection, and _make_status_error governance error interception**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-01T03:06:06Z
- **Completed:** 2026-03-01T03:21:06Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- GovynOpenAI and GovynAsyncOpenAI are true subclasses of openai.OpenAI / openai.AsyncOpenAI (isinstance works)
- Constructor resolves agent_id (mandatory), proxy_url, api_key per sdk-spec.md section 5 with env var fallback
- _make_status_error intercepts Govyn 429 responses and raises GovynBudgetExceededError or GovynLoopDetectedError
- Non-Govyn 429s and non-429 errors pass through to upstream SDK error handling unchanged
- 20 tests covering constructors, env vars, validation, error interception (sync + async), and isinstance

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement GovynOpenAI and GovynAsyncOpenAI with tests** - `d31adb5` (feat)

_Prerequisite:_
- **Plan 01 scaffold (deviation):** `295ea2c` (feat) - Package scaffold with pyproject.toml, constants, errors, __init__.py

## Files Created/Modified
- `python-sdk/govynai/_openai.py` - GovynOpenAI and GovynAsyncOpenAI wrapper classes with lazy import pattern
- `python-sdk/tests/test_openai.py` - 20 tests for constructor, env vars, validation, error interception, isinstance
- `python-sdk/tests/conftest.py` - clean_env fixture monkeypatching GOVYN_* and SDK env vars

## Decisions Made
- Used `_make_status_error` override instead of catch-and-re-raise pattern -- cleaner pre-raise interception that prevents constructing an upstream exception only to discard it
- Headers stored with original casing (X-Govyn-Agent) in `_custom_headers` dict -- httpx handles case-insensitive wire format
- Lazy class construction via `_get_classes()` with `_cached_classes` module-level caching ensures class identity for isinstance checks across multiple imports

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created Plan 01 prerequisite artifacts**
- **Found during:** Pre-task analysis
- **Issue:** Plan 02 depends on Plan 01 (package scaffold, constants, errors), but Plan 01 had not been executed -- python-sdk/ directory did not exist
- **Fix:** Created all Plan 01 artifacts: pyproject.toml, __init__.py, py.typed, _constants.py, _errors.py, tests/test_errors.py
- **Files modified:** 7 files in python-sdk/
- **Verification:** `pip install -e python-sdk/[all,dev]` succeeded, all 10 error tests passed
- **Committed in:** `295ea2c`

**2. [Rule 1 - Bug] Fixed header casing in test assertions**
- **Found during:** Task 1 (test verification)
- **Issue:** Linter-generated tests used lowercase `x-govyn-agent` in `_custom_headers.get()` but the dict stores original casing `X-Govyn-Agent`
- **Fix:** Changed assertions to use correct casing `X-Govyn-Agent` and `Custom`
- **Files modified:** python-sdk/tests/test_openai.py
- **Verification:** All 33 tests pass (20 openai + 13 errors)
- **Committed in:** `d31adb5` (part of Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for execution. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- GovynOpenAI and GovynAsyncOpenAI ready for use
- Plan 03 (Anthropic wrapper) can proceed -- uses same _resolve_params() and _get_classes() patterns
- _health.py module auto-generated by linter but not committed in this plan -- will be handled in Plan 03 or 04

## Self-Check: PASSED

- [x] python-sdk/govynai/_openai.py exists
- [x] python-sdk/tests/test_openai.py exists
- [x] python-sdk/tests/conftest.py exists
- [x] .planning/phases/17-python-sdk/17-02-SUMMARY.md exists
- [x] Commit 295ea2c (Plan 01 prerequisite) exists
- [x] Commit d31adb5 (Plan 02 Task 1) exists

---
*Phase: 17-python-sdk*
*Completed: 2026-03-01*
