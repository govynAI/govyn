/**
 * Unit tests for PolicyWatcher.
 *
 * Tests file-watch hot reload for policy YAML files:
 * 1. Watcher detects file change and reloads policies
 * 2. Invalid YAML change keeps previous policies
 * 3. Debounce coalesces rapid changes into a single reload
 * 4. stop() cleans up watcher (no reload after stop)
 * 5. start() on nonexistent file logs warning but does not crash
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PolicyEngine } from '../src/policy-engine.js';
import { PolicyWatcher } from '../src/policy-watcher.js';
import { govynEvents } from '../src/events.js';
import type { GovynEvent } from '../src/events.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const VALID_POLICY_YAML = `version: 1
policies:
  - name: test-block
    type: block
    scope: global
    enabled: true
`;

const VALID_POLICY_YAML_V2 = `version: 1
policies:
  - name: test-block-updated
    type: block
    scope: global
    enabled: true
  - name: test-block-2
    type: block
    scope: global
    enabled: true
`;

const INVALID_YAML = `version: 1
policies:
  - name: bad-policy
    type: invalid_type_that_does_not_exist
    scope: global
    enabled: true
`;

let tmpDir: string;
let tmpFile: string;

function createTempPolicyFile(content: string): string {
  fs.writeFileSync(tmpFile, content, 'utf8');
  return tmpFile;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('PolicyWatcher', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govyn-pw-test-'));
    tmpFile = path.join(tmpDir, 'policies.yaml');
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      const files = fs.readdirSync(tmpDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
    govynEvents.removeAllListeners();
  });

  it('detects file change and reloads policies', async () => {
    const engine = new PolicyEngine();
    createTempPolicyFile(VALID_POLICY_YAML);
    engine.loadFromFile(tmpFile);
    expect(engine.getPolicies()).toHaveLength(1);

    const watcher = new PolicyWatcher(engine, tmpFile, { debounceMs: 50 });

    const reloadPromise = new Promise<GovynEvent>((resolve) => {
      govynEvents.on('event', (evt: GovynEvent) => {
        if (evt.type === 'policy_reloaded') resolve(evt);
      });
    });

    watcher.start();
    expect(watcher.isWatching()).toBe(true);

    // Modify the file to trigger reload
    fs.writeFileSync(tmpFile, VALID_POLICY_YAML_V2, 'utf8');

    const evt = await reloadPromise;
    watcher.stop();

    expect(evt.type).toBe('policy_reloaded');
    if (evt.type === 'policy_reloaded') {
      expect(evt.policyCount).toBe(2);
    }
    expect(engine.getPolicies()).toHaveLength(2);
    expect(engine.getPolicies()[0].name).toBe('test-block-updated');
  });

  it('keeps previous policies on invalid YAML change', async () => {
    const engine = new PolicyEngine();
    createTempPolicyFile(VALID_POLICY_YAML);
    engine.loadFromFile(tmpFile);
    expect(engine.getPolicies()).toHaveLength(1);
    const originalPolicies = engine.getPolicies();

    const watcher = new PolicyWatcher(engine, tmpFile, { debounceMs: 50 });

    const failPromise = new Promise<GovynEvent>((resolve) => {
      govynEvents.on('event', (evt: GovynEvent) => {
        if (evt.type === 'policy_reload_failed') resolve(evt);
      });
    });

    watcher.start();

    // Write invalid policy type
    fs.writeFileSync(tmpFile, INVALID_YAML, 'utf8');

    const evt = await failPromise;
    watcher.stop();

    expect(evt.type).toBe('policy_reload_failed');
    // Engine should still have the original valid policies
    expect(engine.getPolicies()).toHaveLength(1);
    expect(engine.getPolicies()[0].name).toBe(originalPolicies[0].name);
  });

  it('debounce coalesces rapid changes into a single reload', async () => {
    const engine = new PolicyEngine();
    createTempPolicyFile(VALID_POLICY_YAML);
    engine.loadFromFile(tmpFile);

    const watcher = new PolicyWatcher(engine, tmpFile, { debounceMs: 150 });

    let reloadCount = 0;
    govynEvents.on('event', (evt: GovynEvent) => {
      if (evt.type === 'policy_reloaded') reloadCount++;
    });

    watcher.start();

    // Trigger 3 rapid changes within the debounce window
    fs.writeFileSync(tmpFile, VALID_POLICY_YAML_V2, 'utf8');
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(tmpFile, VALID_POLICY_YAML, 'utf8');
    await new Promise((r) => setTimeout(r, 30));
    fs.writeFileSync(tmpFile, VALID_POLICY_YAML_V2, 'utf8');

    // Wait for debounce to settle (debounceMs + margin)
    await new Promise((r) => setTimeout(r, 400));
    watcher.stop();

    // Should have only reloaded once (or at most twice if OS fires extra events)
    // The key insight: the final state should have 2 policies (from V2)
    expect(engine.getPolicies()).toHaveLength(2);
    // With debouncing, we should see fewer reloads than the 3 writes
    expect(reloadCount).toBeLessThanOrEqual(2);
  });

  it('stop() cleans up watcher and prevents further reloads', async () => {
    const engine = new PolicyEngine();
    createTempPolicyFile(VALID_POLICY_YAML);
    engine.loadFromFile(tmpFile);

    const watcher = new PolicyWatcher(engine, tmpFile, { debounceMs: 50 });

    let reloadCount = 0;
    govynEvents.on('event', (evt: GovynEvent) => {
      if (evt.type === 'policy_reloaded' || evt.type === 'policy_reload_failed') reloadCount++;
    });

    watcher.start();
    expect(watcher.isWatching()).toBe(true);

    // Stop the watcher
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);

    // Modify the file after stop
    fs.writeFileSync(tmpFile, VALID_POLICY_YAML_V2, 'utf8');

    // Wait for any potential (erroneous) reload
    await new Promise((r) => setTimeout(r, 300));

    // No reloads should have occurred after stop
    expect(reloadCount).toBe(0);
    // Engine should still have original 1 policy
    expect(engine.getPolicies()).toHaveLength(1);

    // Calling stop again should be safe (idempotent)
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  it('start() on nonexistent file logs warning but does not crash', () => {
    const engine = new PolicyEngine();
    const nonexistentPath = path.join(tmpDir, 'does-not-exist.yaml');

    const watcher = new PolicyWatcher(engine, nonexistentPath, { debounceMs: 50 });

    // Should not throw
    expect(() => watcher.start()).not.toThrow();
    expect(watcher.isWatching()).toBe(false);

    // Cleanup (no-op since watcher never started)
    watcher.stop();
  });
});
