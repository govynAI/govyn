/**
 * YAML policy parser with strict validation and line-number error reporting.
 *
 * Uses the yaml library's Document API to extract source map positions
 * for error messages with line numbers.
 */

import * as fs from 'node:fs';
import { parseDocument, isMap, isSeq, isScalar, type Document, type YAMLMap, type YAMLSeq, type Scalar, type Pair, type Node } from 'yaml';
import type {
  Policy,
  PolicyType,
  PolicyScope,
  PolicyParseError,
  PolicyParseResult,
} from './policy-types.js';

/** All valid policy types */
const VALID_POLICY_TYPES: ReadonlySet<string> = new Set<PolicyType>([
  'block', 'rate_limit', 'budget_limit', 'content_filter', 'time_window', 'model_route',
]);

/**
 * Convert a character offset in a source string to a 1-indexed line number.
 */
function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
}

/**
 * Convert a character offset in a source string to a 1-indexed column number.
 */
function offsetToColumn(source: string, offset: number): number {
  let col = 1;
  for (let i = offset - 1; i >= 0; i--) {
    if (source[i] === '\n') break;
    col++;
  }
  return col;
}

/**
 * Get the line number for a YAML node from its range property.
 */
function getNodeLine(source: string, node: Node | Pair | null | undefined): number | undefined {
  if (!node) return undefined;
  const range = (node as { range?: [number, number, number] }).range;
  if (range && range[0] !== undefined) {
    return offsetToLine(source, range[0]);
  }
  return undefined;
}

/**
 * Get the column number for a YAML node from its range property.
 */
function getNodeColumn(source: string, node: Node | Pair | null | undefined): number | undefined {
  if (!node) return undefined;
  const range = (node as { range?: [number, number, number] }).range;
  if (range && range[0] !== undefined) {
    return offsetToColumn(source, range[0]);
  }
  return undefined;
}

/**
 * Parse a scope string into a PolicyScope object.
 *
 * Valid formats:
 *   "global" -> { level: 'global' }
 *   "agent:<name>" -> { level: 'agent', value: '<name>' }
 *   "target:<provider>" -> { level: 'target', value: '<provider>' }
 */
function parseScope(scopeStr: string): PolicyScope | null {
  if (scopeStr === 'global') {
    return { level: 'global' };
  }
  if (scopeStr.startsWith('agent:')) {
    const value = scopeStr.slice(6);
    if (!value) return null;
    return { level: 'agent', value };
  }
  if (scopeStr.startsWith('target:')) {
    const value = scopeStr.slice(7);
    if (!value) return null;
    return { level: 'target', value };
  }
  return null;
}

/**
 * Extract a scalar value from a YAML map by key.
 */
function getMapValue(map: YAMLMap, key: string): unknown {
  const pair = map.items.find(
    (item) => isScalar(item.key) && (item.key as Scalar).value === key,
  );
  if (!pair) return undefined;
  if (isScalar(pair.value)) return (pair.value as Scalar).value;
  if (isMap(pair.value) || isSeq(pair.value)) return (pair.value as Node).toJSON();
  return undefined;
}

/**
 * Get the YAML node for a specific key in a map (for line number extraction).
 */
function getMapNode(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find(
    (item) => isScalar(item.key) && (item.key as Scalar).value === key,
  );
}

/**
 * Parse a YAML string containing policy definitions and validate strictly.
 *
 * @param yamlString - Raw YAML content to parse
 * @returns PolicyParseResult with parsed policies, errors, and warnings
 */
export function parsePolicies(yamlString: string): PolicyParseResult {
  const errors: PolicyParseError[] = [];
  const warnings: PolicyParseError[] = [];
  const policies: Policy[] = [];

  // Step 1: Parse the YAML document
  let doc: Document;
  try {
    doc = parseDocument(yamlString, { keepSourceTokens: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      policies: [],
      errors: [{ message: `YAML syntax error: ${message}` }],
      warnings: [],
    };
  }

  // Check for YAML parse errors from the document
  if (doc.errors && doc.errors.length > 0) {
    for (const yamlErr of doc.errors) {
      const errObj: PolicyParseError = {
        message: `YAML syntax error: ${yamlErr.message}`,
      };
      if (yamlErr.pos && yamlErr.pos.length > 0) {
        errObj.line = offsetToLine(yamlString, yamlErr.pos[0]);
        errObj.column = offsetToColumn(yamlString, yamlErr.pos[0]);
      }
      errors.push(errObj);
    }
    return { success: false, policies: [], errors, warnings };
  }

  const contents = doc.contents;
  if (!isMap(contents)) {
    errors.push({ message: 'Policy file must be a YAML mapping at the top level' });
    return { success: false, policies: [], errors, warnings };
  }

  const root = contents as YAMLMap;

  // Step 2: Validate version field
  const versionNode = getMapNode(root, 'version');
  const versionValue = getMapValue(root, 'version');

  if (versionValue === undefined || versionValue === null) {
    errors.push({
      message: 'Missing required field: version. Policy files must include "version: 1".',
      line: 1,
    });
    return { success: false, policies: [], errors, warnings };
  }

  if (typeof versionValue !== 'number' || versionValue !== 1) {
    const line = versionNode ? getNodeLine(yamlString, versionNode) : undefined;
    errors.push({
      message: `Unsupported version: ${versionValue}. Only version 1 is supported.`,
      line,
    });
    return { success: false, policies: [], errors, warnings };
  }

  // Step 3: Validate policies array
  const policiesNode = getMapNode(root, 'policies');
  const policiesValue = policiesNode?.value;

  if (policiesValue === undefined || policiesValue === null || (isScalar(policiesValue) && (policiesValue as Scalar).value === null)) {
    const line = policiesNode ? getNodeLine(yamlString, policiesNode) : undefined;
    errors.push({
      message: 'Missing required field: policies. Policy files must include a "policies" array.',
      line,
    });
    return { success: false, policies: [], errors, warnings };
  }

  if (!isSeq(policiesValue)) {
    const line = policiesNode ? getNodeLine(yamlString, policiesNode) : undefined;
    errors.push({
      message: 'Field "policies" must be an array.',
      line,
    });
    return { success: false, policies: [], errors, warnings };
  }

  const policiesSeq = policiesValue as YAMLSeq;

  // Check for empty array
  if (policiesSeq.items.length === 0) {
    warnings.push({
      message: 'Policy file contains an empty policies array. No policies will be loaded.',
    });
    return { success: true, policies: [], errors: [], warnings };
  }

  // Step 4: Validate each policy entry
  const seenNames = new Set<string>();

  for (let i = 0; i < policiesSeq.items.length; i++) {
    const item = policiesSeq.items[i];

    if (!isMap(item)) {
      const line = getNodeLine(yamlString, item as Node);
      errors.push({
        message: `Policy entry ${i + 1} must be a YAML mapping.`,
        line,
      });
      continue;
    }

    const policyMap = item as YAMLMap;
    const policyLine = getNodeLine(yamlString, policyMap);

    // Validate name
    const nameValue = getMapValue(policyMap, 'name');
    if (nameValue === undefined || nameValue === null || typeof nameValue !== 'string' || nameValue.trim() === '') {
      errors.push({
        message: `Policy entry ${i + 1}: missing or empty "name" field. Every policy must have a unique name.`,
        line: policyLine,
      });
      continue;
    }

    const name = nameValue as string;

    // Check for duplicate names
    if (seenNames.has(name)) {
      const nameNode = getMapNode(policyMap, 'name');
      errors.push({
        message: `Duplicate policy name: "${name}". Each policy must have a unique name.`,
        line: nameNode ? getNodeLine(yamlString, nameNode) : policyLine,
        policyName: name,
      });
      continue;
    }
    seenNames.add(name);

    // Validate type
    const typeValue = getMapValue(policyMap, 'type');
    if (typeValue === undefined || typeValue === null || typeof typeValue !== 'string') {
      errors.push({
        message: `Policy "${name}": missing or invalid "type" field. Must be one of: ${[...VALID_POLICY_TYPES].join(', ')}.`,
        line: policyLine,
        policyName: name,
      });
      continue;
    }

    if (!VALID_POLICY_TYPES.has(typeValue)) {
      const typeNode = getMapNode(policyMap, 'type');
      errors.push({
        message: `Policy "${name}": invalid type "${typeValue}". Must be one of: ${[...VALID_POLICY_TYPES].join(', ')}.`,
        line: typeNode ? getNodeLine(yamlString, typeNode) : policyLine,
        policyName: name,
      });
      continue;
    }

    const policyType = typeValue as PolicyType;

    // Validate scope (defaults to global if missing)
    const scopeValue = getMapValue(policyMap, 'scope');
    let scope: PolicyScope;

    if (scopeValue === undefined || scopeValue === null) {
      scope = { level: 'global' };
    } else if (typeof scopeValue === 'string') {
      const parsed = parseScope(scopeValue);
      if (!parsed) {
        const scopeNode = getMapNode(policyMap, 'scope');
        errors.push({
          message: `Policy "${name}": invalid scope "${scopeValue}". Must be "global", "agent:<name>", or "target:<provider>".`,
          line: scopeNode ? getNodeLine(yamlString, scopeNode) : policyLine,
          policyName: name,
        });
        continue;
      }
      scope = parsed;
    } else {
      const scopeNode = getMapNode(policyMap, 'scope');
      errors.push({
        message: `Policy "${name}": invalid scope format. Must be a string: "global", "agent:<name>", or "target:<provider>".`,
        line: scopeNode ? getNodeLine(yamlString, scopeNode) : policyLine,
        policyName: name,
      });
      continue;
    }

    // Parse enabled (defaults to true)
    const enabledValue = getMapValue(policyMap, 'enabled');
    const enabled = enabledValue === false ? false : true;

    // Parse optional description
    const description = getMapValue(policyMap, 'description') as string | undefined;

    // Build base policy fields
    const base = {
      name,
      type: policyType,
      scope,
      enabled,
      ...(description !== undefined ? { description } : {}),
    };

    // Build type-specific policy by adding extra fields
    let policy: Policy;
    switch (policyType) {
      case 'block': {
        const match = getMapValue(policyMap, 'match') as Record<string, unknown> | undefined;
        const message = getMapValue(policyMap, 'message') as string | undefined;
        policy = {
          ...base,
          type: 'block',
          ...(match !== undefined ? { match } : {}),
          ...(message !== undefined ? { message } : {}),
        };
        break;
      }
      case 'rate_limit': {
        const limit = getMapValue(policyMap, 'limit') as number | undefined;
        const window_seconds = getMapValue(policyMap, 'window_seconds') as number | undefined;
        let rateLimitValid = true;
        if (limit === undefined || limit === null || typeof limit !== 'number') {
          const fieldNode = getMapNode(policyMap, 'limit');
          errors.push({
            message: `Policy "${name}": missing required field "limit" for type rate_limit. Must be a positive number.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          rateLimitValid = false;
        }
        if (window_seconds === undefined || window_seconds === null || typeof window_seconds !== 'number') {
          const fieldNode = getMapNode(policyMap, 'window_seconds');
          errors.push({
            message: `Policy "${name}": missing required field "window_seconds" for type rate_limit. Must be a positive number.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          rateLimitValid = false;
        }
        if (!rateLimitValid) continue;
        policy = {
          ...base,
          type: 'rate_limit',
          limit: limit!,
          window_seconds: window_seconds!,
        };
        break;
      }
      case 'budget_limit': {
        const limit = getMapValue(policyMap, 'limit') as number | undefined;
        const period = getMapValue(policyMap, 'period') as string | undefined;
        const validPeriods = ['daily', 'weekly', 'monthly'];
        let budgetLimitValid = true;
        if (limit === undefined || limit === null || typeof limit !== 'number') {
          const fieldNode = getMapNode(policyMap, 'limit');
          errors.push({
            message: `Policy "${name}": missing required field "limit" for type budget_limit. Must be a positive number.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          budgetLimitValid = false;
        }
        if (period === undefined || period === null || typeof period !== 'string' || !validPeriods.includes(period)) {
          const fieldNode = getMapNode(policyMap, 'period');
          errors.push({
            message: `Policy "${name}": missing or invalid "period" for type budget_limit. Must be one of: daily, weekly, monthly.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          budgetLimitValid = false;
        }
        if (!budgetLimitValid) continue;
        policy = {
          ...base,
          type: 'budget_limit',
          limit: limit!,
          period: period as 'daily' | 'weekly' | 'monthly',
        };
        break;
      }
      case 'content_filter': {
        const patterns = getMapValue(policyMap, 'patterns') as string[] | undefined;
        if (patterns === undefined || patterns === null || !Array.isArray(patterns)) {
          const fieldNode = getMapNode(policyMap, 'patterns');
          errors.push({
            message: `Policy "${name}": missing required field "patterns" for type content_filter. Must be an array of pattern names or regex strings.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          continue;
        }
        const reveal_pattern = getMapValue(policyMap, 'reveal_pattern') as boolean | undefined;
        policy = {
          ...base,
          type: 'content_filter',
          patterns,
          ...(reveal_pattern !== undefined ? { reveal_pattern } : {}),
        };
        break;
      }
      case 'time_window': {
        const start = getMapValue(policyMap, 'start') as string | undefined;
        const end = getMapValue(policyMap, 'end') as string | undefined;
        const timezone = getMapValue(policyMap, 'timezone') as string | undefined;
        const mode = getMapValue(policyMap, 'mode') as string | undefined;
        const days = getMapValue(policyMap, 'days') as string[] | undefined;
        let timeWindowValid = true;
        if (start === undefined || start === null || typeof start !== 'string') {
          const fieldNode = getMapNode(policyMap, 'start');
          errors.push({
            message: `Policy "${name}": missing required field "start" for type time_window. Must be a time string in HH:MM format.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          timeWindowValid = false;
        }
        if (end === undefined || end === null || typeof end !== 'string') {
          const fieldNode = getMapNode(policyMap, 'end');
          errors.push({
            message: `Policy "${name}": missing required field "end" for type time_window. Must be a time string in HH:MM format.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          timeWindowValid = false;
        }
        if (timezone === undefined || timezone === null || typeof timezone !== 'string') {
          const fieldNode = getMapNode(policyMap, 'timezone');
          errors.push({
            message: `Policy "${name}": missing required field "timezone" for type time_window. Must be an IANA timezone string.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          timeWindowValid = false;
        }
        if (mode === undefined || mode === null || typeof mode !== 'string' || (mode !== 'allow' && mode !== 'deny')) {
          const fieldNode = getMapNode(policyMap, 'mode');
          errors.push({
            message: `Policy "${name}": missing or invalid "mode" for type time_window. Must be "allow" or "deny".`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          timeWindowValid = false;
        }
        if (days === undefined || days === null || !Array.isArray(days)) {
          const fieldNode = getMapNode(policyMap, 'days');
          errors.push({
            message: `Policy "${name}": missing required field "days" for type time_window. Must be an array of day names.`,
            line: fieldNode ? getNodeLine(yamlString, fieldNode) : policyLine,
            policyName: name,
          });
          timeWindowValid = false;
        }
        if (!timeWindowValid) continue;
        policy = {
          ...base,
          type: 'time_window',
          start: start!,
          end: end!,
          timezone: timezone!,
          mode: mode as 'allow' | 'deny',
          days: days!,
        };
        break;
      }
      case 'model_route': {
        const rawRules = getMapValue(policyMap, 'rules') as unknown[] | undefined;
        const model_aliases = getMapValue(policyMap, 'model_aliases') as Record<string, string> | undefined;
        const max_downgrade_level = getMapValue(policyMap, 'max_downgrade_level') as string | undefined;
        const routing_opt_out_agents = getMapValue(policyMap, 'routing_opt_out_agents') as string[] | undefined;

        // Parse rules array with proper typing
        let rules: Array<{ when?: Record<string, unknown>; route_to: string; default?: 'passthrough' }> = [];
        if (Array.isArray(rawRules)) {
          for (const rawRule of rawRules) {
            if (rawRule && typeof rawRule === 'object') {
              const rule = rawRule as Record<string, unknown>;
              if (rule.default === 'passthrough') {
                rules.push({ route_to: '', default: 'passthrough' as const });
              } else {
                const when = rule.when as Record<string, unknown> | undefined;
                const route_to = (rule.route_to as string) ?? '';
                rules.push({
                  ...(when !== undefined ? { when } : {}),
                  route_to,
                });
              }
            }
          }
        }

        policy = {
          ...base,
          type: 'model_route',
          rules,
          ...(model_aliases !== undefined ? { model_aliases } : {}),
          ...(max_downgrade_level !== undefined ? { max_downgrade_level } : {}),
          ...(routing_opt_out_agents !== undefined ? { routing_opt_out_agents } : {}),
        };
        break;
      }
      default:
        // This should never happen due to the VALID_POLICY_TYPES check above
        continue;
    }

    policies.push(policy);
  }

  if (errors.length > 0) {
    return { success: false, policies: [], errors, warnings };
  }

  return { success: true, policies, errors: [], warnings };
}

/**
 * Parse policies from a YAML file on disk.
 *
 * @param filePath - Path to the YAML policy file
 * @returns PolicyParseResult with parsed policies, errors, and warnings
 */
export function parsePoliciesFromFile(filePath: string): PolicyParseResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      policies: [],
      errors: [{ message: `Failed to read policy file at ${filePath}: ${message}` }],
      warnings: [],
    };
  }
  return parsePolicies(content);
}
