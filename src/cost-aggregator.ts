/**
 * In-memory cost aggregator for the Govyn proxy server.
 *
 * Stores all cost records in memory (Phase 2 — no persistence).
 * Supports filtering by agent and time period, and returns per-agent
 * and per-model cost summaries.
 *
 * Phase 3 will add budget enforcement (daily/monthly reset logic).
 * Phase 4 will add persistence.
 */

import type { CostRecord, CostSummary, TimePeriod } from './types.js';

/**
 * Get the Unix timestamp (ms) for the start of the current calendar day (midnight UTC).
 */
function startOfDayUTC(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Get the Unix timestamp (ms) for the start of the current calendar month (1st UTC midnight).
 */
function startOfMonthUTC(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/**
 * In-memory cost aggregator.
 *
 * All records are kept in a flat array. Filtering is done at query time.
 * For Phase 2 MVP, there is no eviction or max-records limit — records accumulate
 * in memory until the process restarts or clear() is called.
 */
export class CostAggregator {
  private records: CostRecord[] = [];

  /**
   * Append a new cost record.
   * Called after every proxied request.
   *
   * @param record - The cost record to store
   */
  recordCost(record: CostRecord): void {
    this.records.push(record);
  }

  /**
   * Get cost summaries, optionally filtered by agent and/or time period.
   *
   * @param options.agentId - If provided, only include records for this agent
   * @param options.period - Time period to filter by (default: 'all')
   * @returns Array of CostSummary objects, one per agent
   */
  getSummary(options?: { agentId?: string; period?: TimePeriod }): CostSummary[] {
    const agentFilter = options?.agentId;
    const period = options?.period ?? 'all';

    // Compute period cutoff
    const now = Date.now();
    let cutoff: number;
    switch (period) {
      case 'hour':
        cutoff = now - 60 * 60 * 1000;
        break;
      case 'day':
        cutoff = startOfDayUTC();
        break;
      case 'week':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        cutoff = startOfMonthUTC();
        break;
      case 'all':
      default:
        cutoff = 0;
        break;
    }

    // Filter records
    let filtered = this.records;
    if (agentFilter) {
      filtered = filtered.filter((r) => r.agentId === agentFilter);
    }
    if (cutoff > 0) {
      filtered = filtered.filter((r) => r.timestamp >= cutoff);
    }

    // Group by agentId
    const byAgent = new Map<string, CostRecord[]>();
    for (const record of filtered) {
      const group = byAgent.get(record.agentId);
      if (group) {
        group.push(record);
      } else {
        byAgent.set(record.agentId, [record]);
      }
    }

    // Build CostSummary for each agent
    const summaries: CostSummary[] = [];
    for (const [agentId, agentRecords] of byAgent) {
      const models: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};

      let totalCost = 0;
      let inputCost = 0;
      let outputCost = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for (const rec of agentRecords) {
        totalCost += rec.totalCost;
        inputCost += rec.inputCost;
        outputCost += rec.outputCost;
        totalInputTokens += rec.inputTokens;
        totalOutputTokens += rec.outputTokens;

        const modelKey = rec.model || 'unknown';
        const existing = models[modelKey];
        if (existing) {
          existing.cost += rec.totalCost;
          existing.requests += 1;
          existing.inputTokens += rec.inputTokens;
          existing.outputTokens += rec.outputTokens;
        } else {
          models[modelKey] = {
            cost: rec.totalCost,
            requests: 1,
            inputTokens: rec.inputTokens,
            outputTokens: rec.outputTokens,
          };
        }
      }

      summaries.push({
        agentId,
        totalCost,
        inputCost,
        outputCost,
        totalInputTokens,
        totalOutputTokens,
        requestCount: agentRecords.length,
        models,
      });
    }

    return summaries;
  }

  /**
   * Get a per-model cost summary across all agents.
   *
   * @param options.period - Optional time period filter
   * @returns Map of model name to aggregated cost and token data
   */
  getModelSummary(options?: {
    period?: TimePeriod;
  }): Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> {
    const period = options?.period ?? 'all';

    const now = Date.now();
    let cutoff: number;
    switch (period) {
      case 'hour':
        cutoff = now - 60 * 60 * 1000;
        break;
      case 'day':
        cutoff = startOfDayUTC();
        break;
      case 'week':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
        cutoff = startOfMonthUTC();
        break;
      case 'all':
      default:
        cutoff = 0;
        break;
    }

    const filtered = cutoff > 0 ? this.records.filter((r) => r.timestamp >= cutoff) : this.records;

    const result: Record<string, { cost: number; requests: number; inputTokens: number; outputTokens: number }> = {};

    for (const rec of filtered) {
      const modelKey = rec.model || 'unknown';
      const existing = result[modelKey];
      if (existing) {
        existing.cost += rec.totalCost;
        existing.requests += 1;
        existing.inputTokens += rec.inputTokens;
        existing.outputTokens += rec.outputTokens;
      } else {
        result[modelKey] = {
          cost: rec.totalCost,
          requests: 1,
          inputTokens: rec.inputTokens,
          outputTokens: rec.outputTokens,
        };
      }
    }

    return result;
  }

  /**
   * Get the list of unique model names where at least one record was unpriced.
   *
   * @returns Array of model names with priced === false
   */
  getUnpricedModels(): string[] {
    const seen = new Set<string>();
    for (const rec of this.records) {
      if (!rec.priced) {
        seen.add(rec.model || 'unknown');
      }
    }
    return Array.from(seen);
  }

  /**
   * Clear all records.
   * Useful for testing and future budget reset functionality.
   */
  clear(): void {
    this.records = [];
  }
}
