/**
 * Approval queue manager for the Govyn proxy.
 *
 * When a require_approval policy flags a request, the proxy creates an
 * approval request in the database. Agents poll for the decision status.
 * Once approved, the agent re-sends with a single-use approval token.
 *
 * Phase 14 (Approval Queue UI) will build a dashboard on top of these APIs.
 * Until then, approvals can be resolved via direct DB updates or API calls.
 */

import * as crypto from 'node:crypto';
import type postgres from 'postgres';
import type { ApprovalStore } from './persistence-types.js';
import { adaptApprovalStore } from './persistence.js';

export function hashApprovalRequest(body: string | Buffer | undefined): string {
  const data = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body ?? '', 'utf8');

  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a truncated summary of a request body for approval metadata.
 * Extracts the first user message content or body content, truncated to maxLength chars.
 */
export function generateRequestSummary(body: string | undefined, maxLength = 500): string {
  if (!body) return '(empty request)';

  try {
    const parsed = JSON.parse(body);

    // Try to extract user message content (OpenAI/Anthropic format)
    if (Array.isArray(parsed.messages)) {
      for (let i = parsed.messages.length - 1; i >= 0; i--) {
        const msg = parsed.messages[i];
        if (msg?.role === 'user' && typeof msg.content === 'string') {
          const content = msg.content;
          if (content.length <= maxLength) return content;
          return content.slice(0, maxLength) + '...';
        }
      }
    }

    // Fall back to stringified body
    const str = JSON.stringify(parsed);
    if (str.length <= maxLength) return str;
    return str.slice(0, maxLength) + '...';
  } catch {
    // Non-JSON body — truncate raw text
    if (body.length <= maxLength) return body;
    return body.slice(0, maxLength) + '...';
  }
}

export class ApprovalManager {
  private readonly store: ApprovalStore;

  constructor(storeOrSql: ApprovalStore | postgres.Sql) {
    this.store = adaptApprovalStore(storeOrSql);
  }

  /**
   * Create a new approval request in the database.
   * Returns the approval request ID, polling URL, and expiration time.
   */
  async createApprovalRequest(params: {
    agentId: string;
    provider: string;
    model?: string;
    targetPath: string;
    policyName: string;
    policyRule?: string;
    estimatedCost?: number;
    requestSummary: string;
    requestHash: string;
    requestPayload?: unknown;
    timeoutSeconds: number;
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }> {
    return this.store.createApprovalRequest(params);
  }

  /**
   * Get approval status for polling.
   * Returns status and approval token (if approved), or null if not found.
   */
  async getApprovalStatus(id: string): Promise<{
    id: string;
    status: 'pending' | 'approved' | 'denied' | 'denied_timeout';
    approvalToken?: string;
    decidedAt?: string;
    expiresAt: string;
  } | null> {
    return this.store.getApprovalStatus(id);
  }

  /**
   * Validate an approval token for re-send flow.
   * Atomically finds the token and marks it as used in one query.
   * Returns the original request context if valid, null if invalid/expired/used.
   */
  async validateAndConsumeToken(
    token: string,
    expected: { agentId: string; targetPath: string; requestHash: string },
  ): Promise<{ policyName: string } | null> {
    return this.store.validateAndConsumeToken(token, expected);
  }

  /**
   * Approve a request. Generates a single-use UUID approval token.
   * Returns true if the request was pending and is now approved.
   */
  async approveRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    return this.store.approveRequest(id, decidedBy, notes);
  }

  /**
   * Deny a request. No token is generated.
   * Returns true if the request was pending and is now denied.
   */
  async denyRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    return this.store.denyRequest(id, decidedBy, notes);
  }

  async listApprovals(
    statusFilters: string[],
    limit: number,
    offset: number,
    agentId: string | null,
  ) {
    return this.store.listApprovals(statusFilters, limit, offset, agentId);
  }

  async expireTimedOutApprovals(now?: Date): Promise<number> {
    return this.store.expireTimedOutApprovals(now);
  }
}
