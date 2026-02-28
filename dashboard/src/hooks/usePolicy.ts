import { useState, useEffect, useCallback, useRef } from "react";
import { parseDocument } from "yaml";
import { apiFetch } from "@/lib/api-client";
import { useProxyConnection } from "@/hooks/useProxyConnection";
import type { PolicyDetail, PolicyValidationError, PolicyType } from "@/types/api";

const VALID_POLICY_TYPES: ReadonlySet<string> = new Set<PolicyType>([
  "block",
  "rate_limit",
  "budget_limit",
  "content_filter",
  "time_window",
  "model_route",
  "require_approval",
]);

/**
 * Client-side YAML validator for policy documents.
 *
 * Performs lightweight structural validation:
 * 1. YAML syntax check via yaml package's Document parser
 * 2. version: 1 required
 * 3. policies array with exactly 1 entry
 * 4. Each policy must have name, type (valid), and scope defaults to global
 */
function validatePolicyYaml(yamlStr: string): PolicyValidationError[] {
  const errors: PolicyValidationError[] = [];

  // Parse the YAML document using the ESM import at module level
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(yamlStr);
  } catch (err) {
    errors.push({
      message: `YAML syntax error: ${err instanceof Error ? err.message : String(err)}`,
      line: 1,
    });
    return errors;
  }

  // Check for YAML parse errors
  if (doc.errors && doc.errors.length > 0) {
    for (const yamlErr of doc.errors) {
      const line =
        yamlErr.pos && yamlErr.pos.length > 0
          ? countLines(yamlStr, yamlErr.pos[0])
          : undefined;
      errors.push({
        message: `YAML syntax error: ${yamlErr.message}`,
        line,
      });
    }
    return errors;
  }

  const parsed = doc.toJSON() as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") {
    errors.push({ message: "Policy file must be a YAML mapping", line: 1 });
    return errors;
  }

  // Check version field
  if (parsed.version === undefined || parsed.version === null) {
    errors.push({
      message: 'Missing required field: version. Policy files must include "version: 1".',
      line: 1,
    });
    return errors;
  }
  if (parsed.version !== 1) {
    errors.push({
      message: `Unsupported version: ${String(parsed.version)}. Only version 1 is supported.`,
      line: findKeyLine(yamlStr, "version"),
    });
    return errors;
  }

  // Check policies array
  if (!Array.isArray(parsed.policies)) {
    errors.push({
      message: 'Missing or invalid "policies" field. Must be an array.',
      line: findKeyLine(yamlStr, "policies"),
    });
    return errors;
  }

  if (parsed.policies.length === 0) {
    errors.push({
      message: "The policies array is empty. Add at least one policy.",
      line: findKeyLine(yamlStr, "policies"),
    });
    return errors;
  }

  if (parsed.policies.length > 1) {
    errors.push({
      message: "Expected exactly one policy in this document.",
      line: findKeyLine(yamlStr, "policies"),
    });
    return errors;
  }

  const policy = parsed.policies[0] as Record<string, unknown>;

  // Check required fields on the policy
  if (!policy.name || typeof policy.name !== "string") {
    errors.push({
      message: 'Policy is missing required "name" field.',
      line: findKeyLine(yamlStr, "name"),
    });
  }

  if (!policy.type || typeof policy.type !== "string") {
    errors.push({
      message: 'Policy is missing required "type" field.',
      line: findKeyLine(yamlStr, "type"),
    });
  } else if (!VALID_POLICY_TYPES.has(policy.type)) {
    errors.push({
      message: `Invalid policy type: "${policy.type}". Must be one of: ${[...VALID_POLICY_TYPES].join(", ")}.`,
      line: findKeyLine(yamlStr, "type"),
    });
  }

  return errors;
}

/** Count 1-indexed line number at a character offset */
function countLines(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

/** Find the line number of a key in a YAML string (simple heuristic) */
function findKeyLine(source: string, key: string): number | undefined {
  const lines = source.split("\n");
  const pattern = new RegExp(`^\\s*${key}\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i]!)) return i + 1;
  }
  return undefined;
}

interface UsePolicyResult {
  policy: PolicyDetail | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  validationErrors: PolicyValidationError[];
  refetch: () => void;
  save: (yaml: string) => Promise<boolean>;
  deletePolicy: () => Promise<boolean>;
  toggleEnabled: (enabled: boolean) => Promise<boolean>;
  validateYaml: (yaml: string) => void;
}

/**
 * Hook for single-policy operations: view, save, delete, toggle, validate.
 *
 * Fetches policy detail from GET /api/policies/:name.
 * Provides debounced client-side YAML validation (500ms).
 * Save triggers server-side validation and returns errors on failure.
 */
export function usePolicy(name: string | undefined): UsePolicyResult {
  const { isConnected } = useProxyConnection();
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<PolicyValidationError[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPolicy = useCallback(async () => {
    if (!isConnected || !name) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiFetch(
        `/api/policies/${encodeURIComponent(name)}`,
      );

      if (response.status === 404) {
        setError("Policy not found");
        setPolicy(null);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch policy: ${response.status}`);
      }

      const json = (await response.json()) as PolicyDetail;
      setPolicy(json);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error fetching policy";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [isConnected, name]);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const save = useCallback(
    async (yaml: string): Promise<boolean> => {
      if (!name) return false;

      setSaving(true);
      try {
        const response = await apiFetch(
          `/api/policies/${encodeURIComponent(name)}`,
          {
            method: "PUT",
            body: JSON.stringify({ yaml }),
          },
        );

        if (response.status === 400) {
          const data = (await response.json()) as {
            errors?: PolicyValidationError[];
          };
          if (data.errors) {
            setValidationErrors(data.errors);
          }
          return false;
        }

        if (!response.ok) {
          throw new Error(`Failed to save policy: ${response.status}`);
        }

        setValidationErrors([]);
        await fetchPolicy();
        return true;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error saving policy";
        setError(message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [name, fetchPolicy],
  );

  const deletePolicy = useCallback(async (): Promise<boolean> => {
    if (!name) return false;

    try {
      const response = await apiFetch(
        `/api/policies/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error(`Failed to delete policy: ${response.status}`);
      }

      return true;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error deleting policy";
      setError(message);
      return false;
    }
  }, [name]);

  const toggleEnabled = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      if (!name) return false;

      // Optimistic update
      setPolicy((prev) => (prev ? { ...prev, enabled } : prev));

      try {
        const response = await apiFetch(
          `/api/policies/${encodeURIComponent(name)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ enabled }),
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to toggle policy: ${response.status}`);
        }

        return true;
      } catch {
        // Revert on error
        setPolicy((prev) => (prev ? { ...prev, enabled: !enabled } : prev));
        return false;
      }
    },
    [name],
  );

  const validateYaml = useCallback((yaml: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const errors = validatePolicyYaml(yaml);
      setValidationErrors(errors);
    }, 500);
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return {
    policy,
    loading,
    error,
    saving,
    validationErrors,
    refetch: fetchPolicy,
    save,
    deletePolicy,
    toggleEnabled,
    validateYaml,
  };
}
