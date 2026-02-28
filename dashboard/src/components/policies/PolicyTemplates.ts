import type { PolicyType } from "@/types/api";

/**
 * Starter YAML templates for each policy type.
 *
 * Each template is a valid, complete policy document with version: 1
 * and a policies array containing one policy with all required fields
 * and example values. Used by the NewPolicyPage type picker.
 */
export const POLICY_TEMPLATES: Record<PolicyType, string> = {
  block: `version: 1
policies:
  - name: my-block-policy
    type: block
    scope: global
    enabled: true
    description: "Block matching requests"
    match:
      provider: openai
    message: "Request blocked by policy"
`,
  rate_limit: `version: 1
policies:
  - name: my-rate-limit
    type: rate_limit
    scope: global
    enabled: true
    description: "Limit request rate"
    limit: 100
    window_seconds: 60
`,
  budget_limit: `version: 1
policies:
  - name: my-budget-limit
    type: budget_limit
    scope: global
    enabled: true
    description: "Enforce spending limit"
    limit: 10.00
    period: daily
`,
  content_filter: `version: 1
policies:
  - name: my-content-filter
    type: content_filter
    scope: global
    enabled: true
    description: "Block PII in requests"
    patterns:
      - ssn
      - credit_card
      - email
`,
  time_window: `version: 1
policies:
  - name: my-time-window
    type: time_window
    scope: global
    enabled: true
    description: "Allow access during business hours"
    start: "09:00"
    end: "17:00"
    timezone: America/New_York
    mode: allow
    days:
      - weekdays
`,
  model_route: `version: 1
policies:
  - name: my-model-route
    type: model_route
    scope: global
    enabled: true
    description: "Route to cheaper models for simple requests"
    rules:
      - when:
          input_tokens_estimate: "<500"
        route_to: cheap
      - default: passthrough
    model_aliases:
      cheap: claude-haiku-4-5-20251001
      standard: claude-sonnet-4-5-20250929
`,
  require_approval: `version: 1
policies:
  - name: my-approval-policy
    type: require_approval
    scope: global
    enabled: true
    description: "Require human approval for matching requests"
    match:
      provider: anthropic
    timeout_seconds: 1800
    message: "This request requires human approval"
`,
};

/** Short descriptions for each policy type, used in the type picker */
export const POLICY_TYPE_DESCRIPTIONS: Record<PolicyType, string> = {
  block: "Deny requests matching specific criteria",
  rate_limit: "Throttle request rate per time window",
  budget_limit: "Enforce spending limits per period",
  content_filter: "Scan and block PII or sensitive patterns",
  time_window: "Schedule-based access control",
  model_route: "Smart model routing based on request criteria",
  require_approval: "Require human approval before forwarding",
};
