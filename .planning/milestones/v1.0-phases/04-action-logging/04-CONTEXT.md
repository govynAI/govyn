# Phase 4: Action Logging - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Every proxied request generates a structured JSON log entry asynchronously without adding latency. Supports configurable payload depth (metadata-only vs full-payload per agent) and a queryable log API with filtering. Log rotation and retention are included. Policy-level logging, session grouping, and anomaly detection are separate phases.

</domain>

<decisions>
## Implementation Decisions

### Log storage backend
- JSON Lines (.jsonl) files for log entries
- Log directory configurable in YAML (`logging.directory`), sensible default if not set
- Dual output: write to files AND stream to stdout — either can be disabled in config
- Stdout output supports Docker/cloud container logging workflows

### Payload mode configuration
- Global default: metadata-only mode (summary fields without full content)
- Per-agent override to full-payload mode, configurable in YAML
- Runtime API toggle: POST endpoint to switch an agent's logging mode without config reload
- Full payloads (request/response bodies) stored as separate files, not inline in log entries — log entry contains a reference ID to the payload file
- Configurable max body size cap (default ~1MB) — bodies exceeding cap are truncated with a `truncated: true` flag

### Query API design
- Cursor-based pagination — returns cursor token for next page, handles live ingestion cleanly
- Supported filters: agent ID, time range (start/end), status (success/error), model/target provider
- Raw log entries only — no aggregate queries (cost API from Phase 2 handles aggregation)
- Separate detail endpoint for individual log entries: GET /api/logs/:id for metadata, GET /api/logs/:id/payload for stored body
- List endpoint returns lightweight entries without payload content

### Log lifecycle
- Rotation triggers: both size-based AND time-based — whichever fires first
- Size and time thresholds configurable in YAML
- Rotated log files compressed with gzip
- Configurable retention period with auto-delete (e.g., default 30 days)
- Separate retention period for payload files — allows keeping metadata logs longer than full payloads
- Cascade cleanup: when payload retention expires, associated payload files are deleted

### Claude's Discretion
- Log file organization on disk (directory structure, naming convention)
- Async write implementation details (buffering strategy, flush intervals)
- Exact default values for rotation size, time interval, and retention days
- Internal log entry ID generation scheme

</decisions>

<specifics>
## Specific Ideas

- Dual file + stdout output mirrors how production logging tools work — stdout for container orchestrators, files for local dev and direct inspection
- Payload files kept separate from log entries to keep the query API fast and log files manageable
- Payload retention can be shorter than metadata retention — useful for keeping an audit trail without storing large bodies indefinitely

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-action-logging*
*Context gathered: 2026-02-25*
