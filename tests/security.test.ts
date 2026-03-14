import { describe, expect, it } from 'vitest';
import {
  authorizeManagementRequest,
  isAllowedOrigin,
  validateWebhookUrl,
} from '../src/security.js';
import type { SecurityConfig } from '../src/types.js';

function makeRequest(options?: {
  remoteAddress?: string;
  headers?: Record<string, string>;
}) {
  return {
    headers: options?.headers ?? {},
    socket: {
      remoteAddress: options?.remoteAddress ?? '127.0.0.1',
    },
  } as const;
}

describe('security helpers', () => {
  describe('authorizeManagementRequest', () => {
    it('allows local requests when no admin key is configured', () => {
      const security: SecurityConfig = {
        adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
        allowedOrigins: [],
        allowLocalAdmin: true,
        requireAgentApiKey: false,
      };

      delete process.env.TEST_GOVYN_ADMIN_KEY;

      expect(authorizeManagementRequest(makeRequest(), security)).toBeNull();
    });

    it('rejects remote requests when no admin key is configured', () => {
      const security: SecurityConfig = {
        adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
        allowedOrigins: [],
        allowLocalAdmin: true,
        requireAgentApiKey: false,
      };

      delete process.env.TEST_GOVYN_ADMIN_KEY;

      expect(
        authorizeManagementRequest(
          makeRequest({ remoteAddress: '203.0.113.10' }),
          security,
        ),
      ).toMatchObject({ statusCode: 403, code: 'management_api_forbidden' });
    });

    it('requires a matching admin key when configured', () => {
      const security: SecurityConfig = {
        adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
        allowedOrigins: [],
        allowLocalAdmin: true,
        requireAgentApiKey: false,
      };

      process.env.TEST_GOVYN_ADMIN_KEY = 'super-secret-admin-key';

      expect(
        authorizeManagementRequest(
          makeRequest({ headers: { 'x-govyn-admin-key': 'super-secret-admin-key' } }),
          security,
        ),
      ).toBeNull();

      expect(authorizeManagementRequest(makeRequest(), security)).toMatchObject({
        statusCode: 401,
        code: 'admin_auth_required',
      });

      delete process.env.TEST_GOVYN_ADMIN_KEY;
    });

    it('rejects local browser requests from untrusted origins', () => {
      const security: SecurityConfig = {
        adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
        allowedOrigins: ['https://dashboard.example.com'],
        allowLocalAdmin: true,
        requireAgentApiKey: false,
      };

      delete process.env.TEST_GOVYN_ADMIN_KEY;

      expect(
        authorizeManagementRequest(
          makeRequest({ headers: { origin: 'https://evil.example' } }),
          security,
        ),
      ).toMatchObject({ statusCode: 403, code: 'origin_not_allowed' });
    });
  });

  describe('isAllowedOrigin', () => {
    it('allows localhost origins by default', () => {
      expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
      expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
    });

    it('allows configured remote origins and rejects everything else', () => {
      const security: SecurityConfig = {
        adminApiKeyEnv: 'TEST_GOVYN_ADMIN_KEY',
        allowedOrigins: ['https://dashboard.example.com'],
        allowLocalAdmin: true,
        requireAgentApiKey: false,
      };

      expect(isAllowedOrigin('https://dashboard.example.com', security)).toBe(true);
      expect(isAllowedOrigin('https://evil.example', security)).toBe(false);
    });
  });

  describe('validateWebhookUrl', () => {
    it('accepts public http(s) webhook URLs', () => {
      expect(validateWebhookUrl('https://hooks.example.com/test')).toMatchObject({
        ok: true,
      });
    });

    it('rejects private and loopback webhook URLs', () => {
      expect(validateWebhookUrl('http://127.0.0.1:8080/hook')).toMatchObject({
        ok: false,
      });
      expect(validateWebhookUrl('https://localhost/hook')).toMatchObject({
        ok: false,
      });
    });

    it('rejects credential-bearing webhook URLs', () => {
      expect(validateWebhookUrl('https://user:pass@hooks.example.com/test')).toMatchObject({
        ok: false,
      });
    });
  });
});
