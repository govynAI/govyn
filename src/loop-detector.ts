/**
 * Loop detection for the Govyn proxy server.
 *
 * Detects agents making repeated identical requests (same endpoint + same body hash)
 * within a configurable time window. When the threshold is exceeded, the agent is
 * flagged as looping and can be blocked via BudgetEnforcer.blockAgent().
 *
 * Sliding window implementation: per-agent, per-request-key array of timestamps.
 * On each recordRequest, prune timestamps outside the window, then check count >= threshold.
 */

import * as crypto from 'node:crypto';
import type { AgentConfig, LoopDetectionConfig } from './types.js';

/** Internal tracking entry for a specific agent+endpoint+bodyHash combination */
interface RequestWindow {
  /** Combined key: endpoint + ":" + bodyHash */
  key: string;
  /** Array of Unix timestamps (ms) within the current window */
  timestamps: number[];
}

/**
 * LoopDetector tracks repeated identical requests per agent.
 *
 * Each "identical request" is identified by the combination of:
 * - The upstream endpoint path
 * - A hash of the request body (first 16 hex chars of SHA-256)
 *
 * When the same agent hits the same endpoint+bodyHash N times within M seconds,
 * isLooping() returns true. Thresholds are configurable per agent.
 */
export class LoopDetector {
  private defaultConfig: LoopDetectionConfig;
  private agentConfigs: Map<string, AgentConfig>;

  /** Map of agentId -> array of request windows (one per unique endpoint+bodyHash) */
  private windows: Map<string, RequestWindow[]>;

  constructor(defaultConfig: LoopDetectionConfig, agentConfigs: Map<string, AgentConfig>) {
    this.defaultConfig = defaultConfig;
    this.agentConfigs = agentConfigs;
    this.windows = new Map();
  }

  /**
   * Compute a compact hash of the request body for identity comparison.
   *
   * Uses SHA-256 truncated to 16 hex chars (64-bit) — sufficient for loop detection
   * (collision probability negligible for this use case).
   *
   * @param body - The raw request body buffer
   * @returns 16-character hex string
   */
  getRequestHash(body: Buffer): string {
    return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  }

  /**
   * Record a request from an agent to a specific endpoint with the given body hash.
   * Prunes timestamps outside the current window for this agent+key combination.
   *
   * @param agentId - The agent making the request
   * @param endpoint - The upstream endpoint path
   * @param bodyHash - Hash of the request body (from getRequestHash)
   */
  recordRequest(agentId: string, endpoint: string, bodyHash: string): void {
    const config = this.getAgentConfig(agentId);
    const windowMs = config.windowSeconds * 1000;
    const now = Date.now();
    const key = `${endpoint}:${bodyHash}`;

    // Get or create windows array for this agent
    if (!this.windows.has(agentId)) {
      this.windows.set(agentId, []);
    }
    const agentWindows = this.windows.get(agentId)!;

    // Find existing window for this key or create a new one
    let window = agentWindows.find((w) => w.key === key);
    if (!window) {
      window = { key, timestamps: [] };
      agentWindows.push(window);
    }

    // Add current timestamp
    window.timestamps.push(now);

    // Prune timestamps outside the window
    const cutoff = now - windowMs;
    window.timestamps = window.timestamps.filter((ts) => ts > cutoff);
  }

  /**
   * Check if the given agent is currently looping based on the threshold.
   * Must be called AFTER recordRequest for the same request.
   *
   * @param agentId - The agent to check
   * @param endpoint - The upstream endpoint path
   * @param bodyHash - Hash of the request body (from getRequestHash)
   * @returns true if the agent has exceeded the loop detection threshold
   */
  isLooping(agentId: string, endpoint: string, bodyHash: string): boolean {
    const config = this.getAgentConfig(agentId);
    const key = `${endpoint}:${bodyHash}`;

    const agentWindows = this.windows.get(agentId);
    if (!agentWindows) return false;

    const window = agentWindows.find((w) => w.key === key);
    if (!window) return false;

    return window.timestamps.length >= config.threshold;
  }

  /**
   * Get the loop detection config for a specific agent.
   * Returns the agent's per-agent config if available, otherwise the default.
   *
   * @param agentId - The agent to look up
   * @returns LoopDetectionConfig to use for this agent
   */
  getAgentConfig(agentId: string): LoopDetectionConfig {
    const agentConfig = this.agentConfigs.get(agentId);
    if (agentConfig?.loopDetection) {
      return agentConfig.loopDetection;
    }
    return this.defaultConfig;
  }

  /**
   * Clear loop detection state for one or all agents.
   *
   * @param agentId - If provided, clears only this agent's data. Otherwise clears all.
   */
  clear(agentId?: string): void {
    if (agentId !== undefined) {
      this.windows.delete(agentId);
    } else {
      this.windows.clear();
    }
  }
}
