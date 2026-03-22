/**
 * Extract concatenated message content strings from a request body.
 *
 * Handles OpenAI messages[].content (string or content_parts[].text)
 * and Anthropic messages[].content (string or content[].text).
 *
 * Returns only message text -- model names, tokens, and other request
 * metadata are excluded to prevent content filter evasion via metadata
 * injection (e.g., putting PII in a model name field would not trigger
 * a content filter that scans the full serialized body).
 *
 * @param requestBody - Parsed JSON request body
 * @returns Concatenated message text, or empty string if no messages found
 */
export function extractMessageContent(
  requestBody: Record<string, unknown>,
): string {
  const messages = requestBody['messages'];
  if (!Array.isArray(messages)) return '';

  const parts: string[] = [];
  for (const msg of messages) {
    if (typeof msg !== 'object' || msg === null) continue;
    const m = msg as Record<string, unknown>;
    const content = m['content'];
    if (typeof content === 'string') {
      parts.push(content);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === 'object' && part !== null) {
          const p = part as Record<string, unknown>;
          if (typeof p['text'] === 'string') {
            parts.push(p['text']);
          }
        }
      }
    }
  }
  return parts.join('\n');
}
