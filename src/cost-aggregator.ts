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

import type {
  CostRecord,
  CostSummary,
  CostTimeSeriesBucket,
  CostTimeSeriesPoint,
  CostTimeSeriesResult,
  TimePeriod,
} from './types.js';

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

function startOfHourUTC(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
  );
}

function startOfDayForTimestampUTC(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfMonthForTimestampUTC(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function getPeriodCutoff(period: TimePeriod, now = Date.now()): number {
  switch (period) {
    case 'hour':
      return now - 60 * 60 * 1000;
    case 'day':
      return startOfDayUTC();
    case 'week':
      return now - 7 * 24 * 60 * 60 * 1000;
    case 'month':
      return startOfMonthUTC();
    case 'all':
    default:
      return 0;
  }
}

function bucketForPeriod(period: TimePeriod): CostTimeSeriesBucket {
  switch (period) {
    case 'hour':
    case 'day':
      return 'hour';
    case 'week':
    case 'month':
      return 'day';
    case 'all':
    default:
      return 'month';
  }
}

function getBucketStart(timestamp: number, bucket: CostTimeSeriesBucket): number {
  switch (bucket) {
    case 'hour':
      return startOfHourUTC(timestamp);
    case 'day':
      return startOfDayForTimestampUTC(timestamp);
    case 'month':
    default:
      return startOfMonthForTimestampUTC(timestamp);
  }
}

function addBucket(timestamp: number, bucket: CostTimeSeriesBucket): number {
  const date = new Date(timestamp);
  switch (bucket) {
    case 'hour':
      return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours() + 1,
      );
    case 'day':
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    case 'month':
    default:
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }
}

const hourLabelFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const monthLabelFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatBucketLabel(timestamp: number, bucket: CostTimeSeriesBucket): string {
  const date = new Date(timestamp);
  switch (bucket) {
    case 'hour':
      return hourLabelFormatter.format(date);
    case 'day':
      return dayLabelFormatter.format(date);
    case 'month':
    default:
      return monthLabelFormatter.format(date);
  }
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

  private getFilteredRecords(options?: { agentId?: string; period?: TimePeriod }): CostRecord[] {
    const agentFilter = options?.agentId;
    const period = options?.period ?? 'all';
    const cutoff = getPeriodCutoff(period);

    let filtered = this.records;
    if (agentFilter) {
      filtered = filtered.filter((record) => record.agentId === agentFilter);
    }
    if (cutoff > 0) {
      filtered = filtered.filter((record) => record.timestamp >= cutoff);
    }

    return filtered;
  }

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
    const filtered = this.getFilteredRecords(options);

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
    const filtered = this.getFilteredRecords({ period: options?.period });

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

  getTimeSeries(options?: { agentId?: string; period?: TimePeriod }): CostTimeSeriesResult {
    const period = options?.period ?? 'all';
    const filtered = this.getFilteredRecords(options);
    const bucket = bucketForPeriod(period);

    if (filtered.length === 0) {
      return { bucket, points: [] };
    }

    const cutoff = getPeriodCutoff(period);
    const sorted = filtered.slice().sort((a, b) => a.timestamp - b.timestamp);
    const seriesStart = getBucketStart(cutoff > 0 ? cutoff : sorted[0].timestamp, bucket);
    const seriesEnd = getBucketStart(Date.now(), bucket);
    const totalsByBucket = new Map<number, CostTimeSeriesPoint>();

    for (const record of sorted) {
      const bucketStart = getBucketStart(record.timestamp, bucket);
      const existing = totalsByBucket.get(bucketStart);
      if (existing) {
        existing.total += record.totalCost;
        existing.agents[record.agentId] = (existing.agents[record.agentId] ?? 0) + record.totalCost;
      } else {
        totalsByBucket.set(bucketStart, {
          timestamp: new Date(bucketStart).toISOString(),
          label: formatBucketLabel(bucketStart, bucket),
          total: record.totalCost,
          agents: {
            [record.agentId]: record.totalCost,
          },
        });
      }
    }

    const points: CostTimeSeriesPoint[] = [];
    for (let bucketStart = seriesStart; bucketStart <= seriesEnd; bucketStart = addBucket(bucketStart, bucket)) {
      const existing = totalsByBucket.get(bucketStart);
      points.push(existing ?? {
        timestamp: new Date(bucketStart).toISOString(),
        label: formatBucketLabel(bucketStart, bucket),
        total: 0,
        agents: {},
      });
    }

    return { bucket, points };
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
