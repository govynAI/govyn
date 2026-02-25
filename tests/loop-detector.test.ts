/**
 * Unit tests for the LoopDetector class (src/loop-detector.ts).
 *
 * Verifies sliding window behavior, per-agent threshold/window overrides,
 * hash consistency, and state management.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LoopDetector } from '../src/loop-detector.js';
import type { AgentConfig, LoopDetectionConfig } from '../src/types.js';

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

const defaultConfig: LoopDetectionConfig = {
  threshold: 10,
  windowSeconds: 60,
  cooldownSeconds: 300,
};

function makeAgentConfigs(overrides: Record<string, Partial<AgentConfig>> = {}): Map<string, AgentConfig> {
  const agents = new Map<string, AgentConfig>();
  for (const [agentId, config] of Object.entries(overrides)) {
    agents.set(agentId, { name: agentId, ...config });
  }
  return agents;
}

// -----------------------------------------------------------------------
// Test suite: Core loop detection
// -----------------------------------------------------------------------

describe('LoopDetector: core loop detection', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector(defaultConfig, new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Test 1: First request does not trigger loop
  it('single request does not trigger loop detection', () => {
    const body = Buffer.from('{"model":"gpt-4o","messages":[]}');
    const hash = detector.getRequestHash(body);
    detector.recordRequest('agent1', '/v1/chat/completions', hash);
    expect(detector.isLooping('agent1', '/v1/chat/completions', hash)).toBe(false);
  });

  // Test 2: Different endpoints do not trigger loop
  it('same body on different endpoints does not trigger loop', () => {
    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);

    // Make 15 requests but spread across different endpoints
    for (let i = 0; i < 15; i++) {
      const endpoint = `/v1/endpoint/${i}`;
      detector.recordRequest('agent1', endpoint, hash);
    }

    // None of the individual endpoints hit the threshold
    for (let i = 0; i < 15; i++) {
      expect(detector.isLooping('agent1', `/v1/endpoint/${i}`, hash)).toBe(false);
    }
  });

  // Test 3: Different body hashes do not trigger loop
  it('same endpoint with different body hashes does not trigger loop', () => {
    for (let i = 0; i < 15; i++) {
      const body = Buffer.from(`{"model":"gpt-4o","messages":[{"content":"${i}"}]}`);
      const hash = detector.getRequestHash(body);
      detector.recordRequest('agent1', '/v1/chat/completions', hash);
      expect(detector.isLooping('agent1', '/v1/chat/completions', hash)).toBe(false);
    }
  });

  // Test 4: Loop detected after exactly threshold identical calls within window
  it('loop detected after exactly threshold (10) identical calls within window', () => {
    const body = Buffer.from('{"model":"gpt-4o","messages":[]}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Make exactly threshold calls
    for (let i = 0; i < 10; i++) {
      detector.recordRequest('agent1', endpoint, hash);
    }

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(true);
  });

  // Test 5: No loop at threshold - 1 calls
  it('no loop at threshold - 1 (9) identical calls', () => {
    const body = Buffer.from('{"model":"gpt-4o","messages":[]}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Make threshold - 1 calls
    for (let i = 0; i < 9; i++) {
      detector.recordRequest('agent1', endpoint, hash);
    }

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(false);
  });

  // Test 6: Timestamps outside window are pruned
  it('timestamps outside the window are pruned and do not count toward threshold', () => {
    vi.useFakeTimers();

    const body = Buffer.from('{"model":"gpt-4o","messages":[]}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Make 9 requests (under threshold)
    for (let i = 0; i < 9; i++) {
      detector.recordRequest('agent1', endpoint, hash);
    }

    // Advance time past the 60-second window
    vi.advanceTimersByTime(61_000);

    // Make 1 more request — old timestamps are pruned, count resets to 1
    detector.recordRequest('agent1', endpoint, hash);

    // Should NOT be looping (only 1 request in the new window)
    expect(detector.isLooping('agent1', endpoint, hash)).toBe(false);
  });

  // Test 7: Multiple agents tracked independently
  it('multiple agents tracked independently do not interfere', () => {
    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Agent1 makes 10 identical requests (reaches threshold)
    for (let i = 0; i < 10; i++) {
      detector.recordRequest('agent1', endpoint, hash);
    }

    // Agent2 makes 5 identical requests (under threshold)
    for (let i = 0; i < 5; i++) {
      detector.recordRequest('agent2', endpoint, hash);
    }

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(true);
    expect(detector.isLooping('agent2', endpoint, hash)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Test suite: Per-agent config overrides
// -----------------------------------------------------------------------

describe('LoopDetector: per-agent config overrides', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Test 8: Per-agent config overrides default threshold
  it('per-agent threshold override (15) takes precedence over default (10)', () => {
    const agentConfigs = makeAgentConfigs({
      'custom-agent': {
        loopDetection: { threshold: 15, windowSeconds: 60, cooldownSeconds: 300 },
      },
    });
    const detector = new LoopDetector(defaultConfig, agentConfigs);

    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Make 14 requests (above default 10 but below custom 15)
    for (let i = 0; i < 14; i++) {
      detector.recordRequest('custom-agent', endpoint, hash);
    }

    // Should NOT be looping (custom threshold is 15, not 10)
    expect(detector.isLooping('custom-agent', endpoint, hash)).toBe(false);

    // 15th request triggers it
    detector.recordRequest('custom-agent', endpoint, hash);
    expect(detector.isLooping('custom-agent', endpoint, hash)).toBe(true);
  });

  // Test 9: Per-agent window override limits the time window
  it('per-agent window_seconds override (30) prunes faster than default (60)', () => {
    vi.useFakeTimers();

    const agentConfigs = makeAgentConfigs({
      'short-window-agent': {
        loopDetection: { threshold: 5, windowSeconds: 30, cooldownSeconds: 300 },
      },
    });
    const detector = new LoopDetector(defaultConfig, agentConfigs);

    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Make 4 requests (under threshold of 5)
    for (let i = 0; i < 4; i++) {
      detector.recordRequest('short-window-agent', endpoint, hash);
    }

    // Advance 31 seconds (past the 30s window)
    vi.advanceTimersByTime(31_000);

    // Make 1 more request — old ones are pruned
    detector.recordRequest('short-window-agent', endpoint, hash);

    // Only 1 request in window — not looping
    expect(detector.isLooping('short-window-agent', endpoint, hash)).toBe(false);
  });

  // Test 10: Agents without per-agent config use default config
  it('agents without per-agent config use default threshold', () => {
    const agentConfigs = makeAgentConfigs({
      'other-agent': {
        loopDetection: { threshold: 100, windowSeconds: 60, cooldownSeconds: 300 },
      },
    });
    const detector = new LoopDetector(defaultConfig, agentConfigs);

    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // 'no-config-agent' has no per-agent config — uses default threshold of 10
    for (let i = 0; i < 10; i++) {
      detector.recordRequest('no-config-agent', endpoint, hash);
    }

    expect(detector.isLooping('no-config-agent', endpoint, hash)).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Test suite: getRequestHash
// -----------------------------------------------------------------------

describe('LoopDetector: getRequestHash', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector(defaultConfig, new Map());
  });

  // Test 11: Same body always produces same hash
  it('same body consistently produces the same hash', () => {
    const body = Buffer.from('{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}');
    const hash1 = detector.getRequestHash(body);
    const hash2 = detector.getRequestHash(body);
    expect(hash1).toBe(hash2);
  });

  // Test 12: Different bodies produce different hashes
  it('different bodies produce different hashes', () => {
    const body1 = Buffer.from('{"model":"gpt-4o","messages":[]}');
    const body2 = Buffer.from('{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}');
    const hash1 = detector.getRequestHash(body1);
    const hash2 = detector.getRequestHash(body2);
    expect(hash1).not.toBe(hash2);
  });

  // Test 13: Hash is 16 hex characters
  it('hash is exactly 16 hex characters', () => {
    const body = Buffer.from('test body');
    const hash = detector.getRequestHash(body);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  // Test 14: Empty body produces a consistent hash
  it('empty body produces a consistent hash', () => {
    const hash1 = detector.getRequestHash(Buffer.alloc(0));
    const hash2 = detector.getRequestHash(Buffer.alloc(0));
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{16}$/);
  });
});

// -----------------------------------------------------------------------
// Test suite: clear()
// -----------------------------------------------------------------------

describe('LoopDetector: clear()', () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector(defaultConfig, new Map());
  });

  // Test 15: clear(agentId) clears only that agent's data
  it('clear(agentId) clears only the specified agent data', () => {
    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    // Both agents reach the threshold
    for (let i = 0; i < 10; i++) {
      detector.recordRequest('agent1', endpoint, hash);
      detector.recordRequest('agent2', endpoint, hash);
    }

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(true);
    expect(detector.isLooping('agent2', endpoint, hash)).toBe(true);

    // Clear only agent1
    detector.clear('agent1');

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(false);
    expect(detector.isLooping('agent2', endpoint, hash)).toBe(true);
  });

  // Test 16: clear() with no args clears all data
  it('clear() with no args clears all agent data', () => {
    const body = Buffer.from('{"model":"gpt-4o"}');
    const hash = detector.getRequestHash(body);
    const endpoint = '/v1/chat/completions';

    for (let i = 0; i < 10; i++) {
      detector.recordRequest('agent1', endpoint, hash);
      detector.recordRequest('agent2', endpoint, hash);
    }

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(true);
    expect(detector.isLooping('agent2', endpoint, hash)).toBe(true);

    // Clear all
    detector.clear();

    expect(detector.isLooping('agent1', endpoint, hash)).toBe(false);
    expect(detector.isLooping('agent2', endpoint, hash)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Test suite: getAgentConfig
// -----------------------------------------------------------------------

describe('LoopDetector: getAgentConfig()', () => {
  // Test 17: Returns per-agent config when available
  it('returns per-agent config when agent has loopDetection override', () => {
    const customConfig: LoopDetectionConfig = {
      threshold: 5,
      windowSeconds: 30,
      cooldownSeconds: 600,
    };
    const agentConfigs = makeAgentConfigs({
      'custom-agent': { loopDetection: customConfig },
    });
    const detector = new LoopDetector(defaultConfig, agentConfigs);

    const config = detector.getAgentConfig('custom-agent');
    expect(config).toEqual(customConfig);
  });

  // Test 18: Returns default config for agents without override
  it('returns default config for agents without per-agent override', () => {
    const detector = new LoopDetector(defaultConfig, new Map());
    const config = detector.getAgentConfig('unknown-agent');
    expect(config).toEqual(defaultConfig);
  });
});
