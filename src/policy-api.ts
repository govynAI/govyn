/**
 * Policy REST API handler for the Govyn proxy.
 *
 * Provides CRUD operations for managing policies via HTTP:
 *   GET    /api/policies           - List all policies
 *   GET    /api/policies/:name     - Get single policy detail
 *   PATCH  /api/policies/:name     - Toggle enabled/disabled
 *   PUT    /api/policies/:name     - Update policy YAML
 *   POST   /api/policies           - Create new policy
 *   DELETE /api/policies/:name     - Remove a policy
 *
 * All mutations persist changes to the YAML file on disk and reload
 * the policy engine for immediate consistency.
 */

import * as http from 'node:http';
import * as fs from 'node:fs';
import { parseDocument, stringify } from 'yaml';
import type { YAMLMap, YAMLSeq, Scalar } from 'yaml';
import { isMap, isSeq, isScalar } from 'yaml';
import { parsePolicies } from './policy-parser.js';
import type { PolicyEngine } from './policy-engine.js';
import type { Policy } from './policy-types.js';

/**
 * Serialize a single policy into a complete policy document YAML string.
 * Wraps the policy in version: 1, policies: [...] structure.
 */
function policyToYaml(policy: Policy): string {
  const doc = { version: 1, policies: [policyToPlainObject(policy)] };
  return stringify(doc, { indent: 2 });
}

/**
 * Convert a Policy to a plain object suitable for YAML serialization.
 * Converts the scope object back to the string format used in YAML files.
 */
function policyToPlainObject(policy: Policy): Record<string, unknown> {
  const obj: Record<string, unknown> = { ...policy };
  // Convert scope to string format
  const scope = policy.scope;
  if (scope.level === 'global') {
    obj.scope = 'global';
  } else {
    obj.scope = `${scope.level}:${scope.value}`;
  }
  return obj;
}

/**
 * Build a summary object from a policy.
 */
function toSummary(policy: Policy): {
  name: string;
  type: string;
  scope: { level: string; value?: string };
  enabled: boolean;
  description?: string;
} {
  return {
    name: policy.name,
    type: policy.type,
    scope: policy.scope,
    enabled: policy.enabled,
    ...(policy.description !== undefined ? { description: policy.description } : {}),
  };
}

/**
 * Send a JSON response.
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

/**
 * Read the request body as a string.
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Find the index of a policy entry by name in a parsed YAML document's policies sequence.
 */
function findPolicyIndex(policiesSeq: YAMLSeq, name: string): number {
  for (let i = 0; i < policiesSeq.items.length; i++) {
    const item = policiesSeq.items[i];
    if (isMap(item)) {
      const map = item as YAMLMap;
      const nameNode = map.items.find(
        (pair) => isScalar(pair.key) && (pair.key as Scalar).value === 'name',
      );
      if (nameNode && isScalar(nameNode.value) && (nameNode.value as Scalar).value === name) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Get the policies sequence from a parsed YAML document.
 * Returns null if the document structure is invalid.
 */
function getPoliciesSeq(doc: ReturnType<typeof parseDocument>): YAMLSeq | null {
  const contents = doc.contents;
  if (!isMap(contents)) return null;
  const root = contents as YAMLMap;
  const policiesPair = root.items.find(
    (pair) => isScalar(pair.key) && (pair.key as Scalar).value === 'policies',
  );
  if (!policiesPair || !isSeq(policiesPair.value)) return null;
  return policiesPair.value as YAMLSeq;
}

/**
 * Handle all policy API requests.
 *
 * @param req - Incoming HTTP request
 * @param res - Server response
 * @param policyEngine - Policy engine instance for reading current policies
 * @param configPoliciesFile - Path to the YAML policies file on disk
 */
export async function handlePolicyApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  policyEngine: PolicyEngine,
  configPoliciesFile: string,
): Promise<void> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';

  // Parse route: /api/policies or /api/policies/:name
  const basePath = '/api/policies';
  const pathAfterBase = url.slice(basePath.length);
  const policyName = pathAfterBase.startsWith('/')
    ? decodeURIComponent(pathAfterBase.slice(1).split('?')[0])
    : '';

  try {
    // GET /api/policies - List all policies
    if (method === 'GET' && !policyName) {
      const policies = policyEngine.getPolicies();
      const summaries = policies.map(toSummary);
      sendJson(res, 200, { policies: summaries });
      return;
    }

    // GET /api/policies/:name - Get single policy detail
    if (method === 'GET' && policyName) {
      const policies = policyEngine.getPolicies();
      const policy = policies.find((p) => p.name === policyName);
      if (!policy) {
        sendJson(res, 404, { error: { message: `Policy not found: ${policyName}`, code: 'not_found' } });
        return;
      }

      // Build the yaml field wrapping the single policy in a document structure
      const yamlStr = policyToYaml(policy);

      sendJson(res, 200, {
        ...policy,
        scope: policy.scope,
        yaml: yamlStr,
      });
      return;
    }

    // PATCH /api/policies/:name - Toggle enabled/disabled
    if (method === 'PATCH' && policyName) {
      const bodyStr = await readBody(req);
      let body: { enabled?: boolean };
      try {
        body = JSON.parse(bodyStr);
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON body', code: 'invalid_request' } });
        return;
      }

      if (typeof body.enabled !== 'boolean') {
        sendJson(res, 400, { error: { message: 'Body must include "enabled" as a boolean', code: 'invalid_request' } });
        return;
      }

      if (!configPoliciesFile) {
        sendJson(res, 500, { error: { message: 'No policies file configured', code: 'no_config' } });
        return;
      }

      // Read and parse the YAML file using Document API to preserve formatting
      const fileContent = fs.readFileSync(configPoliciesFile, 'utf8');
      const doc = parseDocument(fileContent);
      const policiesSeq = getPoliciesSeq(doc);

      if (!policiesSeq) {
        sendJson(res, 500, { error: { message: 'Invalid policy file structure', code: 'internal_error' } });
        return;
      }

      const idx = findPolicyIndex(policiesSeq, policyName);
      if (idx === -1) {
        sendJson(res, 404, { error: { message: `Policy not found: ${policyName}`, code: 'not_found' } });
        return;
      }

      // Update the enabled field in the YAML document
      const policyMap = policiesSeq.items[idx] as YAMLMap;
      const enabledPair = policyMap.items.find(
        (pair) => isScalar(pair.key) && (pair.key as Scalar).value === 'enabled',
      );
      if (enabledPair) {
        enabledPair.value = doc.createNode(body.enabled);
      } else {
        policyMap.add(doc.createPair('enabled', body.enabled));
      }

      // Write back to disk and reload
      fs.writeFileSync(configPoliciesFile, doc.toString(), 'utf8');
      policyEngine.loadFromFile(configPoliciesFile);

      // Return the updated policy summary
      const updatedPolicy = policyEngine.getPolicies().find((p) => p.name === policyName);
      if (updatedPolicy) {
        sendJson(res, 200, toSummary(updatedPolicy));
      } else {
        sendJson(res, 200, { name: policyName, enabled: body.enabled });
      }
      return;
    }

    // PUT /api/policies/:name - Update policy YAML
    if (method === 'PUT' && policyName) {
      const bodyStr = await readBody(req);
      let body: { yaml?: string };
      try {
        body = JSON.parse(bodyStr);
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON body', code: 'invalid_request' } });
        return;
      }

      if (typeof body.yaml !== 'string') {
        sendJson(res, 400, { error: { message: 'Body must include "yaml" as a string', code: 'invalid_request' } });
        return;
      }

      // Validate the submitted YAML
      const parseResult = parsePolicies(body.yaml);
      if (!parseResult.success) {
        sendJson(res, 400, { errors: parseResult.errors });
        return;
      }

      if (parseResult.policies.length !== 1) {
        sendJson(res, 400, { error: { message: 'Submitted YAML must contain exactly one policy', code: 'invalid_request' } });
        return;
      }

      if (!configPoliciesFile) {
        sendJson(res, 500, { error: { message: 'No policies file configured', code: 'no_config' } });
        return;
      }

      // Read the full policy file from disk
      const fileContent = fs.readFileSync(configPoliciesFile, 'utf8');
      const doc = parseDocument(fileContent);
      const policiesSeq = getPoliciesSeq(doc);

      if (!policiesSeq) {
        sendJson(res, 500, { error: { message: 'Invalid policy file structure', code: 'internal_error' } });
        return;
      }

      const idx = findPolicyIndex(policiesSeq, policyName);
      if (idx === -1) {
        sendJson(res, 404, { error: { message: `Policy not found: ${policyName}`, code: 'not_found' } });
        return;
      }

      // Parse the new policy YAML to get the raw node
      const newPolicyDoc = parseDocument(body.yaml);
      const newPoliciesSeq = getPoliciesSeq(newPolicyDoc);
      if (!newPoliciesSeq || newPoliciesSeq.items.length === 0) {
        sendJson(res, 400, { error: { message: 'Could not parse policy from submitted YAML', code: 'invalid_request' } });
        return;
      }

      // Replace the policy entry
      policiesSeq.items[idx] = newPoliciesSeq.items[0];

      // Write back and reload
      fs.writeFileSync(configPoliciesFile, doc.toString(), 'utf8');
      policyEngine.loadFromFile(configPoliciesFile);

      const updatedPolicy = policyEngine.getPolicies().find((p) => p.name === parseResult.policies[0].name);
      if (updatedPolicy) {
        sendJson(res, 200, toSummary(updatedPolicy));
      } else {
        sendJson(res, 200, toSummary(parseResult.policies[0]));
      }
      return;
    }

    // POST /api/policies - Create new policy
    if (method === 'POST' && !policyName) {
      const bodyStr = await readBody(req);
      let body: { yaml?: string };
      try {
        body = JSON.parse(bodyStr);
      } catch {
        sendJson(res, 400, { error: { message: 'Invalid JSON body', code: 'invalid_request' } });
        return;
      }

      if (typeof body.yaml !== 'string') {
        sendJson(res, 400, { error: { message: 'Body must include "yaml" as a string', code: 'invalid_request' } });
        return;
      }

      // Validate the submitted YAML
      const parseResult = parsePolicies(body.yaml);
      if (!parseResult.success) {
        sendJson(res, 400, { errors: parseResult.errors });
        return;
      }

      if (parseResult.policies.length !== 1) {
        sendJson(res, 400, { error: { message: 'Submitted YAML must contain exactly one policy', code: 'invalid_request' } });
        return;
      }

      const newPolicy = parseResult.policies[0];

      // Check for name conflict
      const existing = policyEngine.getPolicies().find((p) => p.name === newPolicy.name);
      if (existing) {
        sendJson(res, 400, { error: { message: `Policy with name "${newPolicy.name}" already exists`, code: 'name_conflict' } });
        return;
      }

      if (!configPoliciesFile) {
        sendJson(res, 500, { error: { message: 'No policies file configured', code: 'no_config' } });
        return;
      }

      // Read the full policy file from disk
      let fileContent: string;
      try {
        fileContent = fs.readFileSync(configPoliciesFile, 'utf8');
      } catch {
        // File doesn't exist yet - create initial structure
        fileContent = 'version: 1\npolicies: []\n';
      }

      const doc = parseDocument(fileContent);
      const policiesSeq = getPoliciesSeq(doc);

      if (!policiesSeq) {
        sendJson(res, 500, { error: { message: 'Invalid policy file structure', code: 'internal_error' } });
        return;
      }

      // Parse the new policy YAML to get the raw node
      const newPolicyDoc = parseDocument(body.yaml);
      const newPoliciesSeq = getPoliciesSeq(newPolicyDoc);
      if (!newPoliciesSeq || newPoliciesSeq.items.length === 0) {
        sendJson(res, 400, { error: { message: 'Could not parse policy from submitted YAML', code: 'invalid_request' } });
        return;
      }

      // Append the new policy entry
      policiesSeq.add(newPoliciesSeq.items[0]);

      // Write back and reload
      fs.writeFileSync(configPoliciesFile, doc.toString(), 'utf8');
      policyEngine.loadFromFile(configPoliciesFile);

      const createdPolicy = policyEngine.getPolicies().find((p) => p.name === newPolicy.name);
      if (createdPolicy) {
        sendJson(res, 201, toSummary(createdPolicy));
      } else {
        sendJson(res, 201, toSummary(newPolicy));
      }
      return;
    }

    // DELETE /api/policies/:name - Remove a policy
    if (method === 'DELETE' && policyName) {
      if (!configPoliciesFile) {
        sendJson(res, 500, { error: { message: 'No policies file configured', code: 'no_config' } });
        return;
      }

      const fileContent = fs.readFileSync(configPoliciesFile, 'utf8');
      const doc = parseDocument(fileContent);
      const policiesSeq = getPoliciesSeq(doc);

      if (!policiesSeq) {
        sendJson(res, 500, { error: { message: 'Invalid policy file structure', code: 'internal_error' } });
        return;
      }

      const idx = findPolicyIndex(policiesSeq, policyName);
      if (idx === -1) {
        sendJson(res, 404, { error: { message: `Policy not found: ${policyName}`, code: 'not_found' } });
        return;
      }

      // Remove the policy entry
      policiesSeq.items.splice(idx, 1);

      // Write back and reload
      fs.writeFileSync(configPoliciesFile, doc.toString(), 'utf8');
      policyEngine.loadFromFile(configPoliciesFile);

      sendJson(res, 200, { success: true });
      return;
    }

    // Method not allowed
    sendJson(res, 405, { error: { message: `Method ${method} not allowed`, code: 'method_not_allowed' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[policy-api] Error:', message);
    sendJson(res, 500, { error: { message: `Internal error: ${message}`, code: 'internal_error' } });
  }
}
