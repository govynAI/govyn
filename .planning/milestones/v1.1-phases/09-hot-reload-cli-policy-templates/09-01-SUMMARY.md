---
phase: 09-hot-reload-cli-policy-templates
plan: 01
subsystem: policy
tags: [fs-watch, hot-reload, debounce, policy-engine, yaml]

# Dependency graph
requires:
  - phase: 06-policy-schema-core-engine
    provides: PolicyEngine with loadFromFile() and loadFromYaml()
  - phase: 07-policy-rule-types
    provides: All policy type evaluators (block, rate_limit, etc.)
provides:
  - PolicyWatcher class for file-watch hot reload of policy YAML
  - policy_reloaded and policy_reload_failed event types in GovynEvent
  - PolicyWatcher wired into both index.ts and cli.ts bootstrap
affects: [09-02-cli-validate, 09-03-policy-templates]

# Tech tracking
tech-stack:
  added: []
  patterns: [fs.watch debounced file watcher, atomic policy reload with rollback]

key-files:
  created: [src/policy-watcher.ts, tests/policy-watcher.test.ts, tests/integration-reload.test.ts]
  modified: [src/events.ts, src/index.ts, src/cli.ts]

key-decisions:
  - "fs.watch() chosen over fs.watchFile() for event-driven sub-second detection (no chokidar dependency)"
  - "Debounce default 200ms to coalesce rapid editor saves without noticeable delay"
  - "Both 'change' and 'rename' fs.watch events trigger reload (handles cross-OS editor quirks)"
  - "CLI bootstrap now creates PolicyEngine + PolicyWatcher (was missing PolicyEngine entirely)"

patterns-established:
  - "File watcher pattern: debounced fs.watch -> validate -> atomic swap (rollback on failure)"
  - "Event-driven reload observability via govynEvents policy_reloaded/policy_reload_failed"

requirements-completed: [RELOAD-01, RELOAD-02]

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 09 Plan 01: Hot Reload Summary

**PolicyWatcher class with fs.watch debounced file watching, atomic reload via PolicyEngine.loadFromFile(), and safe rollback on invalid YAML**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T23:50:31Z
- **Completed:** 2026-02-25T23:54:48Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- PolicyWatcher class watches policy YAML files using Node.js fs.watch() with configurable debounce
- Invalid policy changes are safely rejected with error logging; previous valid policies remain active
- PolicyWatcher wired into both src/index.ts and src/cli.ts production bootstrap
- 5 unit tests + 3 integration tests prove hot reload works end-to-end with sub-second latency

## Task Commits

Each task was committed atomically:

1. **Task 1: Create PolicyWatcher with file watching, debounce, and atomic reload** - `4f098c1` (feat)
2. **Task 2: Wire PolicyWatcher into server bootstrap and add integration tests** - `4b3b326` (feat)

## Files Created/Modified
- `src/policy-watcher.ts` - PolicyWatcher class with fs.watch, debounce, start/stop lifecycle
- `src/events.ts` - Added policy_reloaded and policy_reload_failed event types
- `src/index.ts` - Wire PolicyWatcher after policy loading when policiesFile configured
- `src/cli.ts` - Added PolicyEngine creation + PolicyWatcher to CLI bootstrap
- `tests/policy-watcher.test.ts` - 5 unit tests (detect, invalid rollback, debounce, stop, nonexistent)
- `tests/integration-reload.test.ts` - 3 integration tests (end-to-end, invalid preserve, latency)

## Decisions Made
- Used fs.watch() over fs.watchFile() for event-driven, sub-second detection (no external dependency)
- Default debounce of 200ms coalesces rapid saves without noticeable delay
- Both 'change' and 'rename' events from fs.watch trigger reload to handle cross-OS editor behavior
- CLI bootstrap was missing PolicyEngine entirely; added full PolicyEngine + watcher setup (Rule 2: missing critical functionality)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] CLI bootstrap lacked PolicyEngine**
- **Found during:** Task 2 (Wire into cli.ts)
- **Issue:** The CLI's startProxy() function called startServer() without a PolicyEngine, so CLI-started servers had no policy enforcement at all
- **Fix:** Added PolicyEngine creation, setCostAggregator, loadFromFile, and PolicyWatcher to CLI bootstrap (matching index.ts pattern)
- **Files modified:** src/cli.ts
- **Verification:** TypeScript compiles, all 508 tests pass
- **Committed in:** 4b3b326 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential fix for CLI bootstrap correctness. No scope creep.

## Issues Encountered
- Policy YAML test fixtures initially missing required `version: 1` field, causing parser to reject them. Fixed by adding version field to all test YAML constants.
- Pre-existing TypeScript strict errors in policy-parser.ts (type narrowing for optional properties). Not caused by this plan's changes; logged to deferred-items.md.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- PolicyWatcher is fully operational and tested
- Ready for Plan 09-02 (CLI validate command) and Plan 09-03 (policy templates)
- Pre-existing tsc errors in policy-parser.ts should be addressed in Phase 9.1 gap closure

## Self-Check: PASSED

- All 6 files verified present on disk
- Both task commits (4f098c1, 4b3b326) verified in git log
- All 508 tests pass (zero regressions)

---
*Phase: 09-hot-reload-cli-policy-templates*
*Completed: 2026-02-25*
