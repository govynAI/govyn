/**
 * Log query API handler for the Govyn proxy server.
 *
 * Routes:
 *   GET /api/logs              - List log entries with filtering and cursor-based pagination
 *   GET /api/logs/:id          - Get a single log entry by ID
 *   GET /api/logs/:id/payload  - Get stored payload content for a log entry
 *
 * Non-GET methods return 405. Logging disabled returns 503.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as http from 'node:http';
import type { ActionLogger } from './action-logger.js';
import type { LogEntry } from './types.js';

/**
 * Send a JSON response.
 */
function sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const bodyStr = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(bodyStr).toString(),
  });
  res.end(bodyStr);
}

/**
 * Decode a cursor string to a file+line position.
 * Cursor format: base64-encoded "{file}:{line}"
 */
function decodeCursor(cursor: string): { file: string; line: number } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const colonIdx = decoded.lastIndexOf(':');
    if (colonIdx === -1) return null;
    const file = decoded.slice(0, colonIdx);
    const line = parseInt(decoded.slice(colonIdx + 1), 10);
    if (isNaN(line)) return null;
    return { file, line };
  } catch {
    return null;
  }
}

/**
 * Encode a file+line position to a cursor string.
 */
function encodeCursor(file: string, line: number): string {
  return Buffer.from(`${file}:${line}`).toString('base64');
}

/**
 * Check whether a log entry matches the given filters.
 */
function matchesFilters(
  entry: LogEntry,
  filters: {
    agent?: string;
    status?: number;
    start?: string;
    end?: string;
    model?: string;
    provider?: string;
  },
): boolean {
  if (filters.agent && entry.agent_id !== filters.agent) return false;
  if (filters.status !== undefined && entry.status !== filters.status) return false;
  if (filters.start && entry.timestamp < filters.start) return false;
  if (filters.end && entry.timestamp > filters.end) return false;
  if (filters.model && entry.model !== filters.model) return false;
  if (filters.provider && entry.provider !== filters.provider) return false;
  return true;
}

/**
 * Read all JSONL files in the log directory, sorted newest-first by filename.
 * Returns array of { filename, filepath } objects.
 */
function getLogFiles(logDirectory: string): { filename: string; filepath: string }[] {
  const resolvedDir = path.resolve(logDirectory);
  if (!fs.existsSync(resolvedDir)) return [];

  const files = fs.readdirSync(resolvedDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort((a, b) => b.localeCompare(a)); // Newest first (descending)

  return files.map((filename) => ({
    filename,
    filepath: path.join(resolvedDir, filename),
  }));
}

/**
 * Parse JSONL file into an array of LogEntry objects.
 * Skips malformed lines silently.
 */
function parseJsonlFile(filepath: string): LogEntry[] {
  try {
    const content = fs.readFileSync(filepath, 'utf8');
    const lines = content.trim().split('\n').filter((l) => l.length > 0);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Handle log API requests.
 *
 * @param req - The incoming HTTP request
 * @param res - The outgoing HTTP response
 * @param actionLogger - The ActionLogger instance (provides logDirectory and getPayloadPath)
 */
export function handleLogApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  actionLogger: ActionLogger,
): void {
  const method = req.method ?? 'GET';
  const rawUrl = req.url ?? '/api/logs';

  // Handle DELETE for log purge
  if (method === 'DELETE') {
    handlePurge(req, res, actionLogger);
    return;
  }

  // Only allow GET (and DELETE handled above)
  if (method !== 'GET') {
    sendJson(res, 405, {
      error: {
        type: 'method_not_allowed',
        code: 'method_not_allowed',
        message: 'Only GET and DELETE requests are supported for /api/logs',
        details: { allowed_methods: ['GET', 'DELETE'] },
      },
    });
    return;
  }

  // Parse URL
  const parsedUrl = new URL(rawUrl, 'http://localhost');
  const pathname = parsedUrl.pathname;

  // Route: GET /api/logs/:id/payload
  const payloadMatch = pathname.match(/^\/api\/logs\/([^/]+)\/payload$/);
  if (payloadMatch) {
    handleGetPayload(res, actionLogger, payloadMatch[1]!);
    return;
  }

  // Route: GET /api/logs/:id
  const idMatch = pathname.match(/^\/api\/logs\/([^/]+)$/);
  if (idMatch && idMatch[1] !== undefined) {
    // Avoid matching the bare /api/logs path (idMatch[1] would be empty string with some regex variants)
    const id = idMatch[1];
    if (id.length > 0) {
      handleGetById(res, actionLogger, id);
      return;
    }
  }

  // Route: GET /api/logs (list with filters)
  handleList(res, actionLogger, parsedUrl.searchParams);
}

/**
 * GET /api/logs - List log entries with filtering and cursor-based pagination.
 */
function handleList(
  res: http.ServerResponse,
  actionLogger: ActionLogger,
  params: URLSearchParams,
): void {
  const logDir = actionLogger.logDirectory;

  // Parse filters
  const filters: {
    agent?: string;
    status?: number;
    start?: string;
    end?: string;
    model?: string;
    provider?: string;
  } = {};

  const agentParam = params.get('agent');
  if (agentParam) filters.agent = agentParam;

  const statusParam = params.get('status');
  if (statusParam) {
    const statusNum = parseInt(statusParam, 10);
    if (!isNaN(statusNum)) filters.status = statusNum;
  }

  const startParam = params.get('start');
  if (startParam) filters.start = startParam;

  const endParam = params.get('end');
  if (endParam) filters.end = endParam;

  const modelParam = params.get('model');
  if (modelParam) filters.model = modelParam;

  const providerParam = params.get('provider');
  if (providerParam) filters.provider = providerParam;

  // Parse pagination
  const limitParam = params.get('limit');
  let limit = 50;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 200);
    }
  }

  const cursorParam = params.get('cursor');
  const cursorPos = cursorParam ? decodeCursor(cursorParam) : null;

  // Get log files (newest first)
  const logFiles = getLogFiles(logDir);

  const results: LogEntry[] = [];
  let skipMode = cursorPos !== null;
  let nextCursorFile: string | null = null;
  let nextCursorLine: number | null = null;
  let done = false;

  for (const { filename, filepath } of logFiles) {
    if (done) break;

    const entries = parseJsonlFile(filepath);

    for (let lineIdx = 0; lineIdx < entries.length; lineIdx++) {
      if (done) break;

      // If we have a cursor, skip until we reach the cursor position
      if (skipMode) {
        if (filename === cursorPos!.file && lineIdx === cursorPos!.line) {
          skipMode = false;
          // Fall through to process this entry (cursor points to first entry of next page)
        } else {
          continue;
        }
      }

      const entry = entries[lineIdx]!;

      if (!matchesFilters(entry, filters)) continue;

      if (results.length < limit) {
        results.push(entry);
      } else {
        // We have limit + 1 match — there's a next page
        nextCursorFile = filename;
        nextCursorLine = lineIdx;
        done = true;
      }
    }
  }

  const hasMore = nextCursorFile !== null;
  const cursor = hasMore ? encodeCursor(nextCursorFile!, nextCursorLine!) : null;

  sendJson(res, 200, {
    entries: results,
    cursor,
    has_more: hasMore,
  });
}

/**
 * GET /api/logs/:id - Get a single log entry by ID.
 */
function handleGetById(
  res: http.ServerResponse,
  actionLogger: ActionLogger,
  id: string,
): void {
  const logDir = actionLogger.logDirectory;
  const logFiles = getLogFiles(logDir);

  for (const { filepath } of logFiles) {
    const entries = parseJsonlFile(filepath);
    for (const entry of entries) {
      if (entry.id === id) {
        sendJson(res, 200, entry);
        return;
      }
    }
  }

  sendJson(res, 404, {
    error: {
      type: 'not_found',
      code: 'log_entry_not_found',
      message: `Log entry not found: ${id}`,
      details: { id },
    },
  });
}

/**
 * DELETE /api/logs?before=DATE - Purge log entries and payloads older than the given date.
 */
function handlePurge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  actionLogger: ActionLogger,
): void {
  const rawUrl = req.url ?? '/api/logs';
  const parsedUrl = new URL(rawUrl, 'http://localhost');
  const beforeParam = parsedUrl.searchParams.get('before');

  if (!beforeParam) {
    sendJson(res, 400, {
      error: {
        type: 'invalid_request',
        code: 'missing_parameter',
        message: "Missing required 'before' query parameter",
        details: { expected: 'ISO 8601 date string (e.g., 2024-01-15T00:00:00Z)' },
      },
    });
    return;
  }

  const beforeDate = new Date(beforeParam);
  if (isNaN(beforeDate.getTime())) {
    sendJson(res, 400, {
      error: {
        type: 'invalid_request',
        code: 'invalid_date',
        message: `Invalid date format: '${beforeParam}'. Use ISO 8601 format.`,
        details: { expected: 'ISO 8601 date string (e.g., 2024-01-15T00:00:00Z)' },
      },
    });
    return;
  }

  const result = actionLogger.purgeBefore(beforeDate);

  sendJson(res, 200, {
    success: true,
    deleted_logs: result.deletedLogs,
    deleted_payloads: result.deletedPayloads,
  });
}

/**
 * GET /api/logs/:id/payload - Get stored payload for a log entry.
 */
function handleGetPayload(
  res: http.ServerResponse,
  actionLogger: ActionLogger,
  id: string,
): void {
  const logDir = actionLogger.logDirectory;
  const logFiles = getLogFiles(logDir);

  // Find the log entry first
  let entry: LogEntry | null = null;
  for (const { filepath } of logFiles) {
    const entries = parseJsonlFile(filepath);
    for (const e of entries) {
      if (e.id === id) {
        entry = e;
        break;
      }
    }
    if (entry) break;
  }

  if (!entry) {
    sendJson(res, 404, {
      error: {
        type: 'not_found',
        code: 'log_entry_not_found',
        message: `Log entry not found: ${id}`,
        details: { id },
      },
    });
    return;
  }

  if (!entry.has_payload || !entry.payload_id) {
    sendJson(res, 404, {
      error: {
        type: 'not_found',
        code: 'no_payload',
        message: 'No payload stored for this log entry',
        details: { id },
      },
    });
    return;
  }

  const payloadPath = actionLogger.getPayloadPath(entry.payload_id);

  if (!fs.existsSync(payloadPath)) {
    sendJson(res, 404, {
      error: {
        type: 'not_found',
        code: 'payload_expired',
        message: 'Payload file not found (may have been cleaned up by retention)',
        details: { id, payload_id: entry.payload_id },
      },
    });
    return;
  }

  try {
    const content = fs.readFileSync(payloadPath, 'utf8');
    const payload = JSON.parse(content);
    sendJson(res, 200, payload);
  } catch {
    sendJson(res, 500, {
      error: {
        type: 'internal_error',
        code: 'payload_read_error',
        message: 'Failed to read payload file',
        details: { id, payload_id: entry.payload_id },
      },
    });
  }
}
