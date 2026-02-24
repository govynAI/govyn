/**
 * Tests for the token extraction module (src/tokens.ts).
 *
 * Uses realistic response body formats from OpenAI and Anthropic documentation.
 */

import { describe, it, expect } from 'vitest';
import { extractTokenUsage, extractTokenUsageFromSSE } from '../src/tokens.js';

// ---------------------------------------------------------------------------
// Realistic sample response bodies
// ---------------------------------------------------------------------------

const OPENAI_RESPONSE = JSON.stringify({
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1677858242,
  model: 'gpt-4o',
  usage: {
    prompt_tokens: 13,
    completion_tokens: 7,
    total_tokens: 20,
  },
  choices: [
    {
      message: { role: 'assistant', content: 'Hello! How can I help you?' },
      finish_reason: 'stop',
      index: 0,
    },
  ],
});

const OPENAI_RESPONSE_NO_USAGE = JSON.stringify({
  id: 'chatcmpl-abc123',
  object: 'chat.completion',
  created: 1677858242,
  model: 'gpt-4o',
  choices: [
    {
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop',
      index: 0,
    },
  ],
});

const ANTHROPIC_RESPONSE = JSON.stringify({
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello!' }],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 25,
    output_tokens: 30,
  },
});

const ANTHROPIC_RESPONSE_NO_USAGE = JSON.stringify({
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello!' }],
  model: 'claude-sonnet-4-20250514',
  stop_reason: 'end_turn',
});

const OPENAI_COMPATIBLE_RESPONSE = JSON.stringify({
  id: 'cmpl-xyz789',
  object: 'chat.completion',
  model: 'my-custom-model',
  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
  },
  choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop', index: 0 }],
});

// ---------------------------------------------------------------------------
// Non-streaming tests
// ---------------------------------------------------------------------------

describe('extractTokenUsage', () => {
  it('extracts tokens from OpenAI non-streaming response body', () => {
    const result = extractTokenUsage(OPENAI_RESPONSE, 'openai');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(13);
    expect(result!.outputTokens).toBe(7);
    expect(result!.totalTokens).toBe(20);
    expect(result!.model).toBe('gpt-4o');
    expect(result!.provider).toBe('openai');
  });

  it('returns null for OpenAI response with missing usage field', () => {
    const result = extractTokenUsage(OPENAI_RESPONSE_NO_USAGE, 'openai');
    expect(result).toBeNull();
  });

  it('extracts tokens from Anthropic non-streaming response body', () => {
    const result = extractTokenUsage(ANTHROPIC_RESPONSE, 'anthropic');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(25);
    expect(result!.outputTokens).toBe(30);
    expect(result!.totalTokens).toBe(55);
    expect(result!.model).toBe('claude-sonnet-4-20250514');
    expect(result!.provider).toBe('anthropic');
  });

  it('returns null for Anthropic response with missing usage field', () => {
    const result = extractTokenUsage(ANTHROPIC_RESPONSE_NO_USAGE, 'anthropic');
    expect(result).toBeNull();
  });

  it('extracts tokens from custom provider with OpenAI-compatible response', () => {
    const result = extractTokenUsage(OPENAI_COMPATIBLE_RESPONSE, 'custom');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(100);
    expect(result!.outputTokens).toBe(50);
    expect(result!.totalTokens).toBe(150);
    expect(result!.model).toBe('my-custom-model');
    expect(result!.provider).toBe('custom');
  });

  it('returns null for custom provider with no usage field', () => {
    const noUsage = JSON.stringify({
      id: 'resp_001',
      model: 'my-model',
      choices: [{ message: { content: 'Hi' } }],
    });
    const result = extractTokenUsage(noUsage, 'custom');
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON input without throwing', () => {
    expect(() => {
      const result = extractTokenUsage('{ invalid json }', 'openai');
      expect(result).toBeNull();
    }).not.toThrow();
  });

  it('returns null on empty string without throwing', () => {
    expect(() => {
      const result = extractTokenUsage('', 'anthropic');
      expect(result).toBeNull();
    }).not.toThrow();
  });

  it('computes totalTokens from sum when total_tokens not present in OpenAI response', () => {
    const body = JSON.stringify({
      model: 'gpt-4o',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    const result = extractTokenUsage(body, 'openai');

    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// SSE streaming tests
// ---------------------------------------------------------------------------

describe('extractTokenUsageFromSSE', () => {
  it('extracts tokens from OpenAI SSE chunks with usage in final chunk', () => {
    // OpenAI sends a usage-only final chunk when stream_options.include_usage = true
    const chunks = [
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n',
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"delta":{},"finish_reason":"stop","index":0}],"usage":null}\n\n',
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[],"usage":{"prompt_tokens":13,"completion_tokens":7,"total_tokens":20}}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'openai');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(13);
    expect(result!.outputTokens).toBe(7);
    expect(result!.totalTokens).toBe(20);
    expect(result!.model).toBe('gpt-4o');
    expect(result!.provider).toBe('openai');
  });

  it('extracts tokens from Anthropic SSE with message_start and message_delta events', () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","content":[],"model":"claude-sonnet-4-20250514","stop_reason":null,"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello!"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":30}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'anthropic');

    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(25);
    expect(result!.outputTokens).toBe(30);
    expect(result!.totalTokens).toBe(55);
    expect(result!.model).toBe('claude-sonnet-4-20250514');
    expect(result!.provider).toBe('anthropic');
  });

  it('returns null for SSE chunks with no usage data', () => {
    const chunks = [
      'data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'openai');
    expect(result).toBeNull();
  });

  it('returns null for empty SSE chunks array', () => {
    const result = extractTokenUsageFromSSE([], 'openai');
    expect(result).toBeNull();
  });

  it('returns null for Anthropic SSE with no message_start or message_delta events', () => {
    const chunks = [
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    ];

    const result = extractTokenUsageFromSSE(chunks, 'anthropic');
    expect(result).toBeNull();
  });

  it('returns null for Anthropic SSE missing message_delta (no output tokens)', () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","model":"claude-sonnet-4-20250514","usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
      // No message_delta event — output_tokens not finalized
    ];

    // With only message_start (input_tokens) but no message_delta (output_tokens), should be null
    // because we need both for a complete result
    const result = extractTokenUsageFromSSE(chunks, 'anthropic');
    // The message_start provides input_tokens=25, but no message_delta means outputTokens is null
    expect(result).toBeNull();
  });
});
