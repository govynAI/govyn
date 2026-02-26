# Deferred Items - Phase 09

## Pre-existing TypeScript Errors

**policy-parser.ts (lines 346, 357, 367, 380):** TS2322 type narrowing issues where optional properties are assigned to required types in Policy union. These errors exist before Phase 09 changes and are not caused by the hot-reload work. Filed for Phase 9.1 gap closure.
