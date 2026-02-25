/**
 * Log file rotation and retention for the Govyn proxy server.
 *
 * Handles:
 * - Size-based rotation: rotates when a log file exceeds configured max size
 * - Time-based rotation: rotates when a log file is older than the configured interval
 * - Gzip compression: rotated files are compressed with zlib.gzipSync()
 * - Retention cleanup: auto-deletes expired log files and payload files
 *
 * Design:
 * - All rotation I/O is synchronous (runs inside flush() which is already on a timer)
 * - Cleanup runs on a 1-hour unref'd interval (does not prevent process exit)
 * - Cleanup failures never crash the process (wrapped in try/catch)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import type { LoggingConfig } from './types.js';

/**
 * LogRotator manages log file rotation with gzip compression and
 * configurable retention cleanup for both log files and payload files.
 */
export class LogRotator {
  private readonly config: LoggingConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: LoggingConfig) {
    this.config = config;

    // Run cleanup every hour; unref'd so it doesn't keep the process alive
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 3600 * 1000);
    this.cleanupInterval.unref();
  }

  /**
   * Check whether the given log file should be rotated.
   *
   * @param currentFilePath - Path to the active JSONL log file
   * @returns Whether rotation is needed and which trigger fired
   */
  checkRotation(currentFilePath: string): { shouldRotate: boolean; reason: 'size' | 'time' | null } {
    try {
      const stat = fs.statSync(currentFilePath);

      // Size check: file exceeds rotationMaxSizeMb
      const maxBytes = this.config.rotationMaxSizeMb * 1024 * 1024;
      if (stat.size > maxBytes) {
        return { shouldRotate: true, reason: 'size' };
      }

      // Time check: file is older than rotationIntervalHours
      const maxAge = this.config.rotationIntervalHours * 3600 * 1000;
      const fileAge = Date.now() - stat.mtimeMs;
      if (fileAge > maxAge) {
        return { shouldRotate: true, reason: 'time' };
      }

      return { shouldRotate: false, reason: null };
    } catch {
      // File doesn't exist or can't be read — no rotation needed
      return { shouldRotate: false, reason: null };
    }
  }

  /**
   * Rotate the given log file: compress with gzip, write to rotated path,
   * and delete the original.
   *
   * @param currentFilePath - Path to the active JSONL log file to rotate
   * @returns Path to a fresh log file (ActionLogger should create on next write)
   */
  rotate(currentFilePath: string): string {
    const dir = path.dirname(currentFilePath);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');

    // Rotated filename: govyn-YYYY-MM-DD-HHmmss.jsonl.gz
    const rotatedName = `govyn-${dateStr}-${timeStr}.jsonl.gz`;
    const rotatedPath = path.join(dir, rotatedName);

    // Read, compress, write
    const content = fs.readFileSync(currentFilePath);
    const compressed = zlib.gzipSync(content);
    fs.writeFileSync(rotatedPath, compressed);

    // Delete original
    fs.unlinkSync(currentFilePath);

    // Return the path for the new current file (same date-based naming)
    const freshDateStr = new Date().toISOString().slice(0, 10);
    return path.join(dir, `govyn-${freshDateStr}.jsonl`);
  }

  /**
   * Scan for and delete expired log files and payload files.
   *
   * - Log files (.jsonl.gz): deleted if older than retentionDays
   * - Payload files (.json in payloads/): deleted if older than payloadRetentionDays
   *
   * Failures are logged to stderr but never crash the process.
   */
  cleanupExpired(): void {
    try {
      const logDir = path.resolve(this.config.directory);
      let logsCleaned = 0;
      let payloadsCleaned = 0;

      // Clean up rotated log files (.jsonl.gz)
      const maxLogAge = this.config.retentionDays * 24 * 3600 * 1000;
      const now = Date.now();

      if (fs.existsSync(logDir)) {
        const files = fs.readdirSync(logDir);
        for (const file of files) {
          if (!file.endsWith('.jsonl.gz')) continue;
          const filePath = path.join(logDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxLogAge) {
              fs.unlinkSync(filePath);
              logsCleaned++;
            }
          } catch {
            // Skip individual file errors
          }
        }
      }

      // Clean up payload files (.json in payloads/)
      const payloadsDir = path.join(logDir, 'payloads');
      const maxPayloadAge = this.config.payloadRetentionDays * 24 * 3600 * 1000;

      if (fs.existsSync(payloadsDir)) {
        const payloadFiles = fs.readdirSync(payloadsDir);
        for (const file of payloadFiles) {
          if (!file.endsWith('.json')) continue;
          const filePath = path.join(payloadsDir, file);
          try {
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxPayloadAge) {
              fs.unlinkSync(filePath);
              payloadsCleaned++;
            }
          } catch {
            // Skip individual file errors
          }
        }
      }

      if (logsCleaned > 0 || payloadsCleaned > 0) {
        process.stderr.write(
          `[govyn] Cleaned up ${logsCleaned} expired log files, ${payloadsCleaned} expired payload files\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[govyn] Cleanup error: ${message}\n`);
    }
  }

  /**
   * Stop the periodic cleanup interval.
   */
  stop(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
