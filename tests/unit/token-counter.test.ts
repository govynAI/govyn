/**
 * Unit tests for extractTokenUsage() and extractTokenUsageFromSSE() from src/tokens.ts.
 *
 * Verifies OpenAI and Anthropic token extraction for both buffered and streaming
 * responses, plus edge cases (malformed JSON, missing fields, empty body).
 */

import { describe, it, expect } from 'vitest';
import { extractTokenUsage, extractTokenUsageFromSSE } from '../../src/tokens.js';

// -----------------------------------------------------------------------
// Test suite: extractTokenUsage (buffered responses)
// -----------------------------------------------------------------------

describe('extractTokenUsage()', () => {
  // Test 1: Valid OpenAI JSON response
  it('extracts input/output/total tokens from valid OpenAI response', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      usage: {
        prompt_tokens: 150,
        completion_tokens: 75,
        total_tokens: 225,
      },
    });

    const result = extractTokenUsage(body, 'openai');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(150);
    expect(result!.outputTokens).toBe(75);
    expect(result!.totalTokens).toBe(225);
    expect(result!.model).toBe('gpt-4o');
    expect(result!.provider).toBe('openai');
  });

  // Test 2: Valid Anthropic JSON response
  it('extracts input/output tokens from valid Anthropic response', () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 200,
        output_tokens: 100,
      },
    });

    const result = extractTokenUsage(body, 'anthropic');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(200);
    expect(result!.outputTokens).toBe(100);
    expect(result!.totalTokens).toBe(300); // input + output
    expect(result!.model).toBe('claude-sonnet-4-20250514');
    expect(result!.provider).toBe('anthropic');
  });

  // Test 3: Malformed JSON returns null (not throws)
  it('returns null for malformed JSON', () => {
    const result = extractTokenUsage('this is not json {{{', 'openai');
    expect(result).toBeNull();
  });

  // Test 4: Missing usage field returns null
  it('returns null when usage field is missing', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      choices: [{ message: { content: 'hello' } }],
    });

    const result = extractTokenUsage(body, 'openai');
    expect(result).toBeNull();
  });

  // Test 5: Empty response body returns null
  it('returns null for empty response body', () => {
    const result = extractTokenUsage('', 'openai');
    expect(result).toBeNull();
  });

  // Test 6: OpenAI usage without total_tokens computes it
  it('computes totalTokens when total_tokens is missing in OpenAI response', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    });

    const result = extractTokenUsage(body, 'openai');

    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(150); // computed from input + output
  });

  // Test 7: Null parsed body returns null
  it('returns null for JSON null', () => {
    const result = extractTokenUsage('null', 'openai');
    expect(result).toBeNull();
  });

  // Test 8: JSON array (not object) returns null
  it('returns null for JSON array', () => {
    const result = extractTokenUsage('[1, 2, 3]', 'openai');
    expect(result).toBeNull();
  });

  // Test 9: usage is a string instead of object
  it('returns null when usage is not an object', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      usage: 'invalid',
    });

    const result = extractTokenUsage(body, 'openai');
    expect(result).toBeNull();
  });

  // Test 10: Missing model field defaults to empty string
  it('defaults model to empty string when missing', () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      },
    });

    const result = extractTokenUsage(body, 'openai');

    expect(result).not.toBeNull();
    expect(result!.model).toBe('');
  });

  // Test 11: Custom provider uses OpenAI parsing
  it('custom provider uses OpenAI-compatible parsing', () => {
    const body = JSON.stringify({
      model: 'custom-model',
      usage: {
        prompt_tokens: 50,
        completion_tokens: 25,
        total_tokens: 75,
      },
    });

    const result = extractTokenUsage(body, 'custom');

    expect(result).not.toBeNull();
    expect(result!.provider).toBe('custom');
    expect(result!.inputTokens).toBe(50);
  });

  // Test 12: Anthropic with missing input_tokens returns null
  it('returns null for Anthropic response with missing input_tokens', () => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      usage: {
        output_tokens: 100,
      },
    });

    const result = extractTokenUsage(body, 'anthropic');
    expect(result).toBeNull();
  });
});

// -----------------------------------------------------------------------
// Test suite: extractTokenUsageFromSSE (streaming responses)
// -----------------------------------------------------------------------

describe('extractTokenUsageFromSSE()', () => {
  // Test 1: OpenAI SSE with usage in final chunk
  it('extracts tokens from OpenAI SSE final chunk with usage', () => {
    const chunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[],"model":"gpt-4o","usage":{"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}}\n\ndata: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'openai');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(50);
    expect(result!.totalTokens).toBe(150);
    expect(result!.model).toBe('gpt-4o');
    expect(result!.provider).toBe('openai');
  });

  // Test 2: Anthropic SSE with message_start and message_delta events
  it('extracts tokens from Anthropic SSE message_start + message_delta events', () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":200}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":80}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'anthropic');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(200);
    expect(result!.outputTokens).toBe(80);
    expect(result!.totalTokens).toBe(280);
    expect(result!.model).toBe('claude-sonnet-4-20250514');
    expect(result!.provider).toBe('anthropic');
  });

  // Test 3: OpenAI SSE without usage returns null
  it('returns null for OpenAI SSE without usage field', () => {
    const chunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'openai');
    expect(result).toBeNull();
  });

  // Test 4: Anthropic SSE with only message_start (no message_delta) returns null
  it('returns null for Anthropic SSE missing message_delta', () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-20250514","usage":{"input_tokens":200}}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'anthropic');
    expect(result).toBeNull();
  });

  // Test 5: Empty chunks array returns null
  it('returns null for empty chunks array', () => {
    expect(extractTokenUsageFromSSE([], 'openai')).toBeNull();
    expect(extractTokenUsageFromSSE([], 'anthropic')).toBeNull();
  });

  // Test 6: Custom provider uses OpenAI SSE parsing
  it('custom provider uses OpenAI SSE parsing', () => {
    const chunks = [
      'data: {"model":"custom-model","usage":{"prompt_tokens":30,"completion_tokens":15,"total_tokens":45}}\n\ndata: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'custom');

    expect(result).not.toBeNull();
    expect(result!.provider).toBe('custom');
    expect(result!.inputTokens).toBe(30);
  });

  // Test 7: Malformed data lines are skipped
  it('skips malformed data lines and still extracts from valid ones', () => {
    const chunks = [
      'data: not-valid-json\n\n',
      'data: {"model":"gpt-4o","usage":{"prompt_tokens":50,"completion_tokens":25,"total_tokens":75}}\n\ndata: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'openai');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(50);
  });
});
