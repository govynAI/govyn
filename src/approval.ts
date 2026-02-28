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
  constructor(private sql: postgres.Sql) {}

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
    requestPayload?: unknown;
    timeoutSeconds: number;
  }): Promise<{ id: string; pollingUrl: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + params.timeoutSeconds * 1000);
    const [row] = await this.sql`
      INSERT INTO approval_requests (
        agent_id, provider, model, target_path, policy_name, policy_rule,
        estimated_cost, request_summary, request_payload,
        timeout_seconds, expires_at
      ) VALUES (
        ${params.agentId}, ${params.provider}, ${params.model ?? null},
        ${params.targetPath}, ${params.policyName}, ${params.policyRule ?? null},
        ${params.estimatedCost ?? null}, ${params.requestSummary},
        ${params.requestPayload ? JSON.stringify(params.requestPayload) : null},
        ${params.timeoutSeconds}, ${expiresAt}
      ) RETURNING id, expires_at
    `;
    return {
      id: row.id,
      pollingUrl: `/api/approvals/${row.id}`,
      expiresAt: row.expires_at.toISOString(),
    };
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
    const [row] = await this.sql`
      SELECT id, status, approval_token, decided_at, expires_at
      FROM approval_requests
      WHERE id = ${id}
    `;
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      approvalToken: row.status === 'approved' ? row.approval_token : undefined,
      decidedAt: row.decided_at?.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  /**
   * Validate an approval token for re-send flow.
   * Atomically finds the token and marks it as used in one query.
   * Returns the original request context if valid, null if invalid/expired/used.
   */
  async validateAndConsumeToken(token: string): Promise<{
    agentId: string;
    policyName: string;
    targetPath: string;
  } | null> {
    const [row] = await this.sql`
      UPDATE approval_requests
      SET token_used = true
      WHERE approval_token = ${token}
        AND status = 'approved'
        AND token_used = false
      RETURNING agent_id, policy_name, target_path
    `;
    if (!row) return null;
    return {
      agentId: row.agent_id,
      policyName: row.policy_name,
      targetPath: row.target_path,
    };
  }

  /**
   * Approve a request. Generates a single-use UUID approval token.
   * Returns true if the request was pending and is now approved.
   */
  async approveRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const approvalToken = crypto.randomUUID();
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'approved',
          decided_by = ${decidedBy},
          decision_notes = ${notes ?? null},
          decided_at = NOW(),
          approval_token = ${approvalToken}
      WHERE id = ${id} AND status = 'pending'
    `;
    return result.count > 0;
  }

  /**
   * Deny a request. No token is generated.
   * Returns true if the request was pending and is now denied.
   */
  async denyRequest(id: string, decidedBy: string, notes?: string): Promise<boolean> {
    const result = await this.sql`
      UPDATE approval_requests
      SET status = 'denied',
          decided_by = ${decidedBy},
          decision_notes = ${notes ?? null},
          decided_at = NOW()
      WHERE id = ${id} AND status = 'pending'
    `;
    return result.count > 0;
  }
}
