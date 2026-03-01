---
phase: 17-python-sdk
plan: 01
subsystem: sdk
tags: [python, pypi, hatchling, pip, pep561, error-handling]

# Dependency graph
requires:
  - phase: 16-sdk-specification
    provides: sdk-spec.md with canonical constants, error codes, and naming conventions
provides:
  - Installable govynai Python package scaffold with hatchling build config
  - All 8 SDK constants matching sdk-spec.md exactly
  - Independent error hierarchy (GovynError -> Exception, GovynBudgetExceededError, GovynLoopDetectedError)
  - _parse_govyn_error function handling all 3 v1.3 error codes
  - py.typed PEP 561 marker for type checker support
  - Lazy __getattr__ in __init__.py for deferred provider imports
affects: [17-python-sdk, 18-nodejs-sdk, 19-integration-tests]

# Tech tracking
tech-stack:
  added: [hatchling, pytest, pytest-asyncio, respx, govynai]
  patterns: [lazy-import-via-getattr, independent-error-hierarchy, constants-module]

key-files:
  created:
    - python-sdk/pyproject.toml
    - python-sdk/govynai/__init__.py
    - python-sdk/govynai/py.typed
    - python-sdk/govynai/_constants.py
    - python-sdk/govynai/_errors.py
    - python-sdk/tests/test_constants.py
    - python-sdk/tests/test_errors.py
  modified: []

key-decisions:
  - "Removed async_check_proxy from __all__ -- sdk-spec.md only specifies check_proxy as public API"
  - "httpx added as core dependency for check_proxy health endpoint support"

patterns-established:
  - "Lazy imports via __getattr__ with globals() caching for class identity preservation"
  - "Independent error hierarchy: GovynError(Exception) base, not subclassing upstream SDK errors"
  - "Constants as module-level variables with type annotations in _constants.py"

requirements-completed: [PSDK-06, PSDK-07, PSDK-09, PSDK-10]

# Metrics
duration: 8min
completed: 2026-03-01
---

# Phase 17 Plan 01: Package Scaffold Summary

**Installable govynai package with hatchling build, 8 constants from sdk-spec.md, independent error hierarchy (GovynError/GovynBudgetExceededError/GovynLoopDetectedError), and py.typed marker**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-01T03:05:44Z
- **Completed:** 2026-03-01T03:13:46Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Package scaffold with hatchling build config, optional extras for openai/anthropic/all/dev
- All 8 constants from sdk-spec.md section 1 in _constants.py with exact string values
- Independent error hierarchy: GovynError(Exception), GovynBudgetExceededError, GovynLoopDetectedError with parsed detail properties
- _parse_govyn_error handles all 3 v1.3 error codes and returns None for non-Govyn errors
- py.typed PEP 561 marker for type checker support
- 25 tests (12 constants + 13 errors) all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create package scaffold and constants module** - `1cfea6e` (feat)
2. **Task 2: Implement error hierarchy and parse function** - `64807a0` (feat)

## Files Created/Modified
- `python-sdk/pyproject.toml` - Hatchling build config with optional extras for openai/anthropic/all/dev
- `python-sdk/govynai/__init__.py` - Package entry point with __all__, lazy __getattr__, eager error imports
- `python-sdk/govynai/py.typed` - PEP 561 empty marker file
- `python-sdk/govynai/_constants.py` - All 8 constants from sdk-spec.md (HEADER_AGENT, ENV_PROXY_URL, etc.)
- `python-sdk/govynai/_errors.py` - GovynError, GovynBudgetExceededError, GovynLoopDetectedError, _parse_govyn_error
- `python-sdk/tests/test_constants.py` - 12 tests for constants, py.typed, lazy imports, __all__
- `python-sdk/tests/test_errors.py` - 13 tests for hierarchy, parsing, catchability, flat imports

## Decisions Made
- Removed `async_check_proxy` from `__all__` -- sdk-spec.md section 9 only specifies `check_proxy` as the public health check API
- httpx added as core dependency (required for health check function in Plan 03)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed hatchling build-backend path**
- **Found during:** Task 1 (package scaffold)
- **Issue:** pyproject.toml from research had `build-backend = "hatchling.backends"` instead of `"hatchling.build"`
- **Fix:** Corrected to `build-backend = "hatchling.build"`
- **Files modified:** python-sdk/pyproject.toml
- **Verification:** `pip install -e ".[all,dev]"` succeeds
- **Committed in:** 1cfea6e (Task 1 commit)

**2. [Rule 1 - Bug] Removed async_check_proxy from __all__**
- **Found during:** Task 1 (package scaffold)
- **Issue:** Research spike included `async_check_proxy` in `__all__` but sdk-spec.md does not list it as a public API
- **Fix:** Removed from `__all__` and `__getattr__` lazy import
- **Files modified:** python-sdk/govynai/__init__.py
- **Verification:** test_govynai_all_exports passes with exact expected set
- **Committed in:** 1cfea6e (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs from research spike)
**Impact on plan:** Both fixes aligned code with sdk-spec.md. No scope creep.

## Issues Encountered
None - research spike had established the core implementation, plan execution refined it to match spec exactly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Package scaffold complete with all shared modules (constants, errors)
- Plans 02 and 03 can now implement GovynOpenAI/GovynAnthropic wrapper classes that import from _constants and _errors
- Editable install works, test infrastructure ready

## Self-Check: PASSED

All 8 created files verified present on disk. Both task commits (1cfea6e, 64807a0) verified in git log.

---
*Phase: 17-python-sdk*
*Completed: 2026-03-01*
