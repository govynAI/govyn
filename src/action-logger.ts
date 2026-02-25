/**
 * Async action logger for the Govyn proxy server.
 *
 * Writes structured JSONL log entries for every proxied request.
 * Supports two modes:
 * - metadata: summary fields only (default)
 * - full-payload: stores request/response bodies as separate JSON files
 *
 * Design:
 * - log() is synchronous and non-blocking (zero added latency)
 * - Entries are buffered in memory and flushed to disk on a 1-second interval
 * - storePayload() is fire-and-forget async (errors logged to stderr)
 * - Dual output: stdout AND/OR file, either disableable in config
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as zlib from 'node:zlib';
import type { LogEntry, LoggingConfig, LoggingMode } from './types.js';
import { LogRotator } from './log-rotator.js';

/**
 * ActionLogger writes structured JSONL log entries for proxied requests.
 *
 * Non-blocking by design: log() pushes to an in-memory buffer that is
 * flushed to disk on a 1-second unref'd interval. storePayload() writes
 * payload files asynchronously without awaiting in the request path.
 */
export class ActionLogger {
  /** Exposed config for consumers that need to read settings (e.g., maxBodySize) */
  readonly config: LoggingConfig;

  /** Internal write buffer — entries waiting to be flushed to disk */
  private buffer: string[] = [];

  /** Path to the current active JSONL log file */
  private currentFilePath: string;

  /** Path to the payloads subdirectory */
  private payloadsDir: string;

  /** Periodic flush interval handle */
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  /** Log rotator for size/time-based rotation and retention cleanup */
  private rotator: LogRotator;

  constructor(config: LoggingConfig) {
    this.config = config;

    // Create log directory and payloads subdirectory
    const logDir = path.resolve(config.directory);
    this.payloadsDir = path.join(logDir, 'payloads');
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(this.payloadsDir, { recursive: true });

    // Build initial JSONL file path: govyn-YYYY-MM-DD.jsonl
    const dateStr = new Date().toISOString().slice(0, 10);
    this.currentFilePath = path.join(logDir, `govyn-${dateStr}.jsonl`);

    // Create log rotator for rotation and retention
    this.rotator = new LogRotator(config);

    // Start periodic flush (every 1 second, unref'd so it doesn't keep the process alive)
    if (config.file) {
      this.flushInterval = setInterval(() => this.flush(), 1000);
      this.flushInterval.unref();
    }
  }

  /**
   * Read-only access to the log directory path.
   * Used by the log query API to locate JSONL files.
   */
  get logDirectory(): string {
    return this.config.directory;
  }

  /**
   * Get the full filesystem path to a payload file.
   *
   * @param payloadId - The payload ID (used as filename stem)
   * @returns Full path to the payload JSON file
   */
  getPayloadPath(payloadId: string): string {
    return path.join(this.payloadsDir, `${payloadId}.json`);
  }

  /**
   * Log a structured entry. Non-blocking — adds to buffer and optionally writes to stdout.
   * This is the zero-latency guarantee: no file I/O in the hot path.
   * Automatically sets storage_region from config if not already set on the entry.
   *
   * @param entry - The structured log entry to record
   */
  log(entry: LogEntry): void {
    // Ensure storage_region is set from config
    if (!entry.storage_region) {
      entry.storage_region = this.config.storageRegion;
    }
    const line = JSON.stringify(entry);

    if (this.config.stdout) {
      process.stdout.write(line + '\n');
    }

    if (this.config.file) {
      this.buffer.push(line);
    }
  }

  /**
   * Store a full payload (request + response bodies) as a separate JSON file.
   * Fully async — fire and forget. Errors are logged to stderr but never thrown.
   *
   * @param payloadId - Unique ID for this payload (used as filename)
   * @param requestBody - Raw request body buffer (or null)
   * @param responseBody - Raw response body buffer (or null)
   * @param truncated - Whether either body was truncated due to size limits
   */
  storePayload(
    payloadId: string,
    requestBody: Buffer | null,
    responseBody: Buffer | null,
    truncated: boolean,
  ): void {
    const maxSize = this.config.maxBodySize;

    // Truncate bodies if they exceed maxBodySize
    let reqBody = requestBody;
    let resBody = responseBody;
    let wasTruncated = truncated;

    if (reqBody && reqBody.length > maxSize) {
      reqBody = reqBody.subarray(0, maxSize);
      wasTruncated = true;
    }
    if (resBody && resBody.length > maxSize) {
      resBody = resBody.subarray(0, maxSize);
      wasTruncated = true;
    }

    const payload = {
      request_body: reqBody ? reqBody.toString('base64') : null,
      response_body: resBody ? resBody.toString('base64') : null,
      truncated: wasTruncated,
      stored_at: new Date().toISOString(),
    };

    const filePath = path.join(this.payloadsDir, `${payloadId}.json`);

    // Fire and forget — async write, errors go to stderr
    fs.promises.writeFile(filePath, JSON.stringify(payload), 'utf8').catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Failed to store payload ${payloadId}: ${message}\n`);
    });
  }

  /**
   * Flush buffered entries to the current JSONL file.
   * Uses synchronous append to ensure atomicity of the batch write.
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    // Check rotation before writing
    try {
      if (fs.existsSync(this.currentFilePath)) {
        const result = this.rotator.checkRotation(this.currentFilePath);
        if (result.shouldRotate) {
          const freshPath = this.rotator.rotate(this.currentFilePath);
          this.currentFilePath = freshPath;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Rotation check failed: ${message}\n`);
    }

    const lines = this.buffer.join('\n') + '\n';
    this.buffer = [];

    try {
      fs.appendFileSync(this.currentFilePath, lines, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Failed to flush log entries: ${message}\n`);
    }
  }

  /**
   * Get the logging mode for a specific agent.
   * Returns the agent-specific override if set, otherwise the default mode.
   *
   * @param agentId - The agent to look up
   * @returns The LoggingMode to use for this agent
   */
  getMode(agentId: string): LoggingMode {
    return this.config.agentModes.get(agentId) ?? this.config.defaultMode;
  }

  /**
   * Set the logging mode for a specific agent at runtime.
   * Does NOT persist to YAML — runtime-only toggle.
   *
   * @param agentId - The agent to configure
   * @param mode - The logging mode to set
   */
  setMode(agentId: string, mode: LoggingMode): void {
    this.config.agentModes.set(agentId, mode);
  }

  /**
   * Get the path of the current active JSONL log file.
   * Useful for rotation logic and diagnostics.
   */
  getCurrentFilePath(): string {
    return this.currentFilePath;
  }

  /**
   * Purge all log entries and associated payload files older than the given date.
   *
   * - Reads all JSONL files (current + rotated) in the log directory
   * - For each file: filters out entries with timestamps before the date
   * - Deletes payload files for removed entries that have has_payload=true
   * - Handles gzipped rotated files: decompress, filter, recompress or delete
   * - Returns counts of deleted log entries and deleted payload files
   *
   * @param date - Purge entries with timestamps strictly before this date
   * @returns Counts of deleted log entries and payload files
   */
  purgeBefore(date: Date): { deletedLogs: number; deletedPayloads: number } {
    // Flush buffer first so all entries are on disk
    this.flush();

    const logDir = path.resolve(this.config.directory);
    const dateIso = date.toISOString();
    let deletedLogs = 0;
    let deletedPayloads = 0;

    if (!fs.existsSync(logDir)) {
      return { deletedLogs, deletedPayloads };
    }

    const files = fs.readdirSync(logDir);

    for (const file of files) {
      const filePath = path.join(logDir, file);

      if (file.endsWith('.jsonl')) {
        // Process uncompressed JSONL files
        const result = this.purgeJsonlFile(filePath, dateIso);
        deletedLogs += result.deletedLogs;
        deletedPayloads += result.deletedPayloads;
      } else if (file.endsWith('.jsonl.gz')) {
        // Process gzipped rotated files
        const result = this.purgeGzipFile(filePath, dateIso);
        deletedLogs += result.deletedLogs;
        deletedPayloads += result.deletedPayloads;
      }
    }

    return { deletedLogs, deletedPayloads };
  }

  /**
   * Purge entries from a plain JSONL file.
   * Rewrites the file with only entries newer than the cutoff date.
   */
  private purgeJsonlFile(
    filePath: string,
    dateIso: string,
  ): { deletedLogs: number; deletedPayloads: number } {
    let deletedLogs = 0;
    let deletedPayloads = 0;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n').filter((l) => l.length > 0);
      const kept: string[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (entry.timestamp < dateIso) {
            // Entry is older than cutoff — remove it
            deletedLogs++;
            // Delete associated payload file if present
            if (entry.has_payload && entry.payload_id) {
              const payloadPath = path.join(this.payloadsDir, `${entry.payload_id}.json`);
              try {
                if (fs.existsSync(payloadPath)) {
                  fs.unlinkSync(payloadPath);
                  deletedPayloads++;
                }
              } catch {
                // Skip payload deletion errors
              }
            }
          } else {
            kept.push(line);
          }
        } catch {
          // Keep malformed lines (don't delete data we can't parse)
          kept.push(line);
        }
      }

      // Rewrite file with kept entries
      if (kept.length === 0) {
        fs.writeFileSync(filePath, '', 'utf8');
      } else {
        fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Purge error for ${filePath}: ${message}\n`);
    }

    return { deletedLogs, deletedPayloads };
  }

  /**
   * Purge entries from a gzipped rotated JSONL file.
   * Decompresses, filters, and either recompresses or deletes if empty.
   */
  private purgeGzipFile(
    filePath: string,
    dateIso: string,
  ): { deletedLogs: number; deletedPayloads: number } {
    let deletedLogs = 0;
    let deletedPayloads = 0;

    try {
      const compressed = fs.readFileSync(filePath);
      const content = zlib.gunzipSync(compressed).toString('utf8');
      const lines = content.trim().split('\n').filter((l) => l.length > 0);
      const kept: string[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as LogEntry;
          if (entry.timestamp < dateIso) {
            deletedLogs++;
            if (entry.has_payload && entry.payload_id) {
              const payloadPath = path.join(this.payloadsDir, `${entry.payload_id}.json`);
              try {
                if (fs.existsSync(payloadPath)) {
                  fs.unlinkSync(payloadPath);
                  deletedPayloads++;
                }
              } catch {
                // Skip payload deletion errors
              }
            }
          } else {
            kept.push(line);
          }
        } catch {
          kept.push(line);
        }
      }

      if (kept.length === 0) {
        // All entries removed — delete the gzip file
        fs.unlinkSync(filePath);
      } else {
        // Recompress with remaining entries
        const newContent = kept.join('\n') + '\n';
        const recompressed = zlib.gzipSync(Buffer.from(newContent, 'utf8'));
        fs.writeFileSync(filePath, recompressed);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Purge error for gzip ${filePath}: ${message}\n`);
    }

    return { deletedLogs, deletedPayloads };
  }

  /**
   * Close the logger: flush remaining buffer and stop the flush interval.
   */
  close(): void {
    this.flush();
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.rotator.stop();
  }

  /**
   * Generate a unique ID for log entries and payload files.
   * Uses crypto.randomUUID() for guaranteed uniqueness.
   */
  static generateId(): string {
    return crypto.randomUUID();
  }
}
