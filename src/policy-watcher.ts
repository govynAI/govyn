/**
 * PolicyWatcher — file-watch hot reload for policy YAML files.
 *
 * Watches a policy YAML file for changes using Node.js fs.watch() and
 * reloads policies into the PolicyEngine on valid changes. Invalid
 * changes are rejected with error logging, preserving previous policies.
 *
 * Features:
 * - Debounced file change detection (coalesces rapid saves)
 * - Atomic reload via PolicyEngine.loadFromFile() (only replaces on success)
 * - Event emission via govynEvents for observability
 * - Clean start/stop lifecycle with no resource leaks
 */

import * as fs from 'node:fs';
import type { PolicyEngine } from './policy-engine.js';
import { govynEvents } from './events.js';

export interface PolicyWatcherOptions {
  /** Debounce interval in milliseconds (default: 200ms). */
  debounceMs?: number;
}

export class PolicyWatcher {
  private engine: PolicyEngine;
  private filePath: string;
  private debounceMs: number;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: PolicyEngine, filePath: string, options?: PolicyWatcherOptions) {
    this.engine = engine;
    this.filePath = filePath;
    this.debounceMs = options?.debounceMs ?? 200;
  }

  /**
   * Begin watching the policy file for changes.
   *
   * Uses fs.watch() for event-driven, sub-second detection.
   * Both 'change' and 'rename' events trigger reload (handles OS quirks
   * where some editors fire 'rename' on save).
   */
  start(): void {
    if (this.watcher) return; // Already watching

    // Check file exists before starting watcher
    if (!fs.existsSync(this.filePath)) {
      console.log(`[govyn] Policy watcher: file not found, skipping watch: ${this.filePath}`);
      return;
    }

    try {
      this.watcher = fs.watch(this.filePath, (_eventType) => {
        // Treat both 'change' and 'rename' as triggers (OS quirk handling)
        this.scheduleReload();
      });

      // Handle watcher errors gracefully (e.g., file deleted while watching)
      this.watcher.on('error', (err) => {
        console.error(`[govyn] Policy watcher error: ${err.message}`);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[govyn] Policy watcher failed to start: ${message}`);
    }
  }

  /**
   * Stop watching the file and clean up resources.
   * Idempotent — safe to call multiple times.
   */
  stop(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Returns true if the watcher is currently active.
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * Schedule a debounced reload. Resets the timer on each call
   * so that rapid file changes are coalesced into a single reload.
   */
  private scheduleReload(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reload();
    }, this.debounceMs);
  }

  /**
   * Perform the actual policy reload from the file.
   * On success, emits policy_reloaded event.
   * On failure, emits policy_reload_failed event and keeps previous policies.
   */
  private reload(): void {
    const result = this.engine.loadFromFile(this.filePath);

    if (result.success) {
      console.log(
        `[govyn] Policy file reloaded: ${result.policies.length} policies loaded from ${this.filePath}`,
      );
      govynEvents.emit('event', {
        type: 'policy_reloaded',
        filePath: this.filePath,
        policyCount: result.policies.length,
      });
    } else {
      const firstError = result.errors.length > 0 ? result.errors[0].message : 'Unknown error';
      console.log(
        `[govyn] Policy reload failed (keeping previous policies): ${firstError}`,
      );
      govynEvents.emit('event', {
        type: 'policy_reload_failed',
        filePath: this.filePath,
        error: firstError,
      });
    }
  }
}
