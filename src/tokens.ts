/**
 * Token extraction module for the Govyn proxy server.
 *
 * Extracts token usage from OpenAI and Anthropic API response bodies
 * and SSE event streams. Returns null safely on missing or malformed data.
 */

import type { TokenUsage, ProviderType } from './types.js';

/**
 * Extract token usage from a non-streaming (buffered) response body.
 *
 * OpenAI response shape:
 * {
 *   model: "gpt-4o",
 *   usage: { prompt_tokens: N, completion_tokens: N, total_tokens: N }
 * }
 *
 * Anthropic response shape:
 * {
 *   model: "claude-sonnet-4-20250514",
 *   usage: { input_tokens: N, output_tokens: N }
 * }
 *
 * Custom providers: attempts OpenAI-compatible parsing first, returns null
 * if no usage field is found.
 *
 * @param responseBody - Raw JSON response body string
 * @param provider - The provider type to determine parsing strategy
 * @returns Extracted TokenUsage or null if data is missing/malformed
 */
export function extractTokenUsage(
  responseBody: string,
  provider: ProviderType
): TokenUsage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const body = parsed as Record<string, unknown>;
  const model = typeof body['model'] === 'string' ? body['model'] : '';

  if (provider === 'openai' || provider === 'custom') {
    return extractOpenAIUsage(body, model, provider);
  }

  if (provider === 'anthropic') {
    return extractAnthropicUsage(body, model);
  }

  return null;
}

/**
 * Extract token usage from accumulated SSE chunks.
 *
 * For OpenAI SSE:
 * - Looks for the final data chunk (before [DONE]) containing a `usage` field.
 * - Supports `stream_options: { include_usage: true }` pattern.
 *
 * For Anthropic SSE:
 * - Combines `message_start` event (input_tokens) and `message_delta` event (output_tokens).
 *
 * @param chunks - Array of raw SSE chunk strings
 * @param provider - The provider type
 * @returns Extracted TokenUsage or null if no usage data found
 */
export function extractTokenUsageFromSSE(
  chunks: string[],
  provider: ProviderType
): TokenUsage | null {
  if (provider === 'openai' || provider === 'custom') {
    return extractOpenAISSEUsage(chunks, provider);
  }

  if (provider === 'anthropic') {
    return extractAnthropicSSEUsage(chunks);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractOpenAIUsage(
  body: Record<string, unknown>,
  model: string,
  provider: ProviderType
): TokenUsage | null {
  const usage = body['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : null;
  const outputTokens = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : null;
  const totalTokens = typeof u['total_tokens'] === 'number' ? u['total_tokens'] : null;

  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens ?? inputTokens + outputTokens,
    model,
    provider,
  };
}

function extractAnthropicUsage(
  body: Record<string, unknown>,
  model: string
): TokenUsage | null {
  const usage = body['usage'];
  if (typeof usage !== 'object' || usage === null) {
    return null;
  }

  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u['input_tokens'] === 'number' ? u['input_tokens'] : null;
  const outputTokens = typeof u['output_tokens'] === 'number' ? u['output_tokens'] : null;

  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model,
    provider: 'anthropic',
  };
}

function extractOpenAISSEUsage(
  chunks: string[],
  provider: ProviderType
): TokenUsage | null {
  // Parse all SSE data lines and collect JSON objects
  const dataLines: string[] = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice('data: '.length).trim();
        if (data !== '[DONE]') {
          dataLines.push(data);
        }
      }
    }
  }

  // Check each data line (in reverse) for a usage field
  // OpenAI sends a final usage-only chunk when stream_options.include_usage = true
  for (let i = dataLines.length - 1; i >= 0; i--) {
    const line = dataLines[i];
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) continue;

    const obj = parsed as Record<string, unknown>;
    const usage = obj['usage'];
    if (typeof usage !== 'object' || usage === null) continue;

    const u = usage as Record<string, unknown>;
    const inputTokens = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : null;
    const outputTokens = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : null;

    if (inputTokens === null || outputTokens === null) continue;

    const totalTokens =
      typeof u['total_tokens'] === 'number' ? u['total_tokens'] : inputTokens + outputTokens;
    const model = typeof obj['model'] === 'string' ? obj['model'] : '';

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      model,
      provider,
    };
  }

  return null;
}

function extractAnthropicSSEUsage(chunks: string[]): TokenUsage | null {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let model = '';
  let lastEventType = '';

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('event: ')) {
        lastEventType = trimmed.slice('event: '.length).trim();
        continue;
      }

      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice('data: '.length).trim();
        if (!data || data === '[DONE]') continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        if (typeof parsed !== 'object' || parsed === null) continue;
        const obj = parsed as Record<string, unknown>;

        if (lastEventType === 'message_start') {
          // message_start contains the full message object with usage.input_tokens
          const message = obj['message'];
          const usageSource =
            typeof message === 'object' && message !== null
              ? (message as Record<string, unknown>)['usage']
              : obj['usage'];

          if (typeof usageSource === 'object' && usageSource !== null) {
            const u = usageSource as Record<string, unknown>;
            if (typeof u['input_tokens'] === 'number') {
              inputTokens = u['input_tokens'];
            }
          }

          // Extract model from message_start
          const messageObj =
            typeof message === 'object' && message !== null
              ? (message as Record<string, unknown>)
              : obj;
          if (typeof messageObj['model'] === 'string') {
            model = messageObj['model'];
          }
        } else if (lastEventType === 'message_delta') {
          // message_delta contains usage.output_tokens
          const usage = obj['usage'];
          if (typeof usage === 'object' && usage !== null) {
            const u = usage as Record<string, unknown>;
            if (typeof u['output_tokens'] === 'number') {
              outputTokens = u['output_tokens'];
            }
          }
        }
      }
    }
  }

  if (inputTokens === null || outputTokens === null) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    model,
    provider: 'anthropic',
  };
}
