/**
 * Tests for message content extraction (message-content.ts).
 *
 * Verifies that extractMessageContent correctly extracts text from:
 * - OpenAI chat format (messages[].content as string)
 * - OpenAI vision/multipart format (messages[].content as array of parts)
 * - Anthropic format (messages[].content as string or array)
 * - Mixed content types
 * - Edge cases (no messages, empty messages, non-text parts)
 *
 * Also verifies that non-message metadata (model, max_tokens, etc.)
 * is NOT included in the extracted text.
 */

import { describe, it, expect } from 'vitest';
import { extractMessageContent } from '../src/message-content.js';

describe('extractMessageContent', () => {
  describe('OpenAI chat format', () => {
    it('extracts string content from messages', () => {
      const body = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello, how are you?' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('You are a helpful assistant.');
      expect(result).toContain('Hello, how are you?');
    });

    it('does not include model name in extracted content', () => {
      const body = {
        model: 'gpt-4-turbo',
        messages: [
          { role: 'user', content: 'Tell me a joke.' },
        ],
        max_tokens: 100,
      };
      const result = extractMessageContent(body);
      expect(result).not.toContain('gpt-4-turbo');
      expect(result).not.toContain('100');
      expect(result).toBe('Tell me a joke.');
    });
  });

  describe('OpenAI vision/multipart format', () => {
    it('extracts text parts from content arrays', () => {
      const body = {
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
            ],
          },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('What is in this image?');
      expect(result).not.toContain('https://example.com/image.png');
    });

    it('extracts multiple text parts', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'First part.' },
              { type: 'text', text: 'Second part.' },
            ],
          },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('First part.');
      expect(result).toContain('Second part.');
    });
  });

  describe('Anthropic format', () => {
    it('extracts string content from Anthropic messages', () => {
      const body = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          { role: 'user', content: 'Explain quantum computing.' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('Explain quantum computing.');
      expect(result).not.toContain('claude');
    });

    it('extracts text blocks from Anthropic content arrays', () => {
      const body = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this document.' },
              { type: 'document', source: { type: 'base64', data: 'abc123' } },
            ],
          },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('Describe this document.');
      expect(result).not.toContain('abc123');
    });
  });

  describe('mixed and multi-turn conversations', () => {
    it('extracts content from all messages in a conversation', () => {
      const body = {
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'What is 2+2?' },
          { role: 'assistant', content: '4' },
          { role: 'user', content: 'And 3+3?' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('Be concise.');
      expect(result).toContain('What is 2+2?');
      expect(result).toContain('4');
      expect(result).toContain('And 3+3?');
    });

    it('handles mix of string and array content in different messages', () => {
      const body = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Look at this.' },
              { type: 'image_url', image_url: { url: 'https://img.example.com/1.png' } },
            ],
          },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toContain('You are helpful.');
      expect(result).toContain('Look at this.');
    });
  });

  describe('edge cases', () => {
    it('returns empty string when no messages field', () => {
      const body = { model: 'gpt-4', prompt: 'Hello' };
      expect(extractMessageContent(body)).toBe('');
    });

    it('returns empty string when messages is not an array', () => {
      const body = { messages: 'not an array' };
      expect(extractMessageContent(body)).toBe('');
    });

    it('returns empty string for empty messages array', () => {
      const body = { messages: [] };
      expect(extractMessageContent(body)).toBe('');
    });

    it('skips null entries in messages array', () => {
      const body = {
        messages: [
          null,
          { role: 'user', content: 'Valid message.' },
          null,
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('Valid message.');
    });

    it('skips non-object entries in messages array', () => {
      const body = {
        messages: [
          'not an object',
          42,
          { role: 'user', content: 'Valid.' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('Valid.');
    });

    it('skips messages with no content field', () => {
      const body = {
        messages: [
          { role: 'user' },
          { role: 'user', content: 'Has content.' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('Has content.');
    });

    it('skips non-text parts in content arrays', () => {
      const body = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'https://img.example.com/1.png' } },
              42,
              null,
            ],
          },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('');
    });

    it('joins parts with newlines', () => {
      const body = {
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Second message' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('First message\nSecond message');
    });
  });

  describe('content filter evasion prevention', () => {
    it('does not extract model field that happens to contain PII-like data', () => {
      const body = {
        model: '123-45-6789',  // SSN-like string in model field
        messages: [
          { role: 'user', content: 'Innocent request.' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).not.toContain('123-45-6789');
      expect(result).toBe('Innocent request.');
    });

    it('does not extract temperature or other numeric metadata', () => {
      const body = {
        model: 'gpt-4',
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 1000,
        messages: [
          { role: 'user', content: 'Query.' },
        ],
      };
      const result = extractMessageContent(body);
      expect(result).toBe('Query.');
    });
  });
});
