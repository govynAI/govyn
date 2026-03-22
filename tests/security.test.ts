import { describe, expect, it, vi } from 'vitest';
import {
  authorizeManagementRequest,
  isAllowedOrigin,
  isLoopbackIp,
  isPrivateOrReservedIp,
  resolveAndCheckUrl,
  validateWebhookUrl,
} from '../src/security.js';
import type { SecurityConfig } from '../src/types.js';

// Mock node:dns/promises for DNS rebinding tests.
// vi.mock hoists to the top and replaces the module before security.ts imports it.
const mockResolve4 = vi.fn<(hostname: string) => Promise<string[]>>();
const mockResolve6 = vi.fn<(hostname: string) => Promise<string[]>>();

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    resolve4: (...args: Parameters<typeof actual.resolve4>) => mockResolve4(args[0] as string),
    resolve6: (...args: Parameters<typeof actual.resolve6>) => mockResolve6(args[0] as string),
  };
});

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

    it('rejects IPv6 loopback webhook URLs', () => {
      expect(validateWebhookUrl('http://[::1]:8080/hook')).toMatchObject({ ok: false });
    });

    it('rejects IPv6 link-local webhook URLs', () => {
      expect(validateWebhookUrl('http://[fe80::1]:8080/hook')).toMatchObject({ ok: false });
    });

    it('rejects IPv6 unique-local webhook URLs', () => {
      expect(validateWebhookUrl('http://[fd00::1]:8080/hook')).toMatchObject({ ok: false });
      expect(validateWebhookUrl('http://[fc00::1]:8080/hook')).toMatchObject({ ok: false });
    });

    it('rejects IPv4-mapped IPv6 private webhook URLs', () => {
      expect(validateWebhookUrl('http://[::ffff:10.0.0.1]:8080/hook')).toMatchObject({ ok: false });
      expect(validateWebhookUrl('http://[::ffff:192.168.1.1]:8080/hook')).toMatchObject({ ok: false });
      expect(validateWebhookUrl('http://[::ffff:127.0.0.1]:8080/hook')).toMatchObject({ ok: false });
    });

    it('rejects cloud metadata hostname', () => {
      expect(validateWebhookUrl('http://metadata.google.internal/computeMetadata/v1/')).toMatchObject({
        ok: false,
      });
    });
  });

  describe('isLoopbackIp', () => {
    it('detects IPv4 loopback', () => {
      expect(isLoopbackIp('127.0.0.1')).toBe(true);
      expect(isLoopbackIp('127.255.255.255')).toBe(true);
    });

    it('detects IPv6 loopback', () => {
      expect(isLoopbackIp('::1')).toBe(true);
    });

    it('detects IPv4-mapped IPv6 loopback', () => {
      expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    });

    it('rejects public IPs', () => {
      expect(isLoopbackIp('8.8.8.8')).toBe(false);
      expect(isLoopbackIp('2001:4860:4860::8888')).toBe(false);
    });
  });

  describe('isPrivateOrReservedIp', () => {
    it('blocks IPv4 private ranges', () => {
      expect(isPrivateOrReservedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('192.168.1.1')).toBe(true);
    });

    it('blocks IPv4 loopback', () => {
      expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('127.255.255.255')).toBe(true);
    });

    it('blocks IPv4 link-local', () => {
      expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    });

    it('blocks IPv4 carrier-grade NAT', () => {
      expect(isPrivateOrReservedIp('100.64.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('100.127.255.255')).toBe(true);
    });

    it('blocks unspecified addresses', () => {
      expect(isPrivateOrReservedIp('0.0.0.0')).toBe(true);
      expect(isPrivateOrReservedIp('::')).toBe(true);
    });

    it('blocks IPv6 loopback', () => {
      expect(isPrivateOrReservedIp('::1')).toBe(true);
    });

    it('blocks IPv6 link-local (fe80::/10)', () => {
      expect(isPrivateOrReservedIp('fe80::1')).toBe(true);
      expect(isPrivateOrReservedIp('fe80::abcd:1234')).toBe(true);
    });

    it('blocks IPv6 unique local / ULA (fc00::/7)', () => {
      expect(isPrivateOrReservedIp('fc00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fd00::1')).toBe(true);
      expect(isPrivateOrReservedIp('fdab:cdef:1234::1')).toBe(true);
    });

    it('blocks IPv4-mapped IPv6 private addresses', () => {
      expect(isPrivateOrReservedIp('::ffff:10.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:192.168.1.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:172.16.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrReservedIp('::ffff:169.254.169.254')).toBe(true);
    });

    it('blocks IPv6 documentation range (2001:db8::/32)', () => {
      expect(isPrivateOrReservedIp('2001:db8::1')).toBe(true);
      expect(isPrivateOrReservedIp('2001:db8:1234::abcd')).toBe(true);
    });

    it('blocks IPv4 documentation/TEST-NET ranges (RFC 5737)', () => {
      // 192.0.2.0/24 (TEST-NET-1), 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
      expect(isPrivateOrReservedIp('192.0.2.1')).toBe(true);
      expect(isPrivateOrReservedIp('198.51.100.1')).toBe(true);
      expect(isPrivateOrReservedIp('203.0.113.10')).toBe(true);
    });

    it('allows public IPv4 addresses', () => {
      expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false);
      expect(isPrivateOrReservedIp('1.1.1.1')).toBe(false);
    });

    it('allows public IPv6 addresses', () => {
      expect(isPrivateOrReservedIp('2001:4860:4860::8888')).toBe(false);
      expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    });

    it('allows IPv4-mapped public addresses', () => {
      expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
      expect(isPrivateOrReservedIp('::ffff:1.1.1.1')).toBe(false);
    });

    it('rejects unparseable addresses (fail closed)', () => {
      expect(isPrivateOrReservedIp('not-an-ip')).toBe(true);
      expect(isPrivateOrReservedIp('')).toBe(true);
    });
  });

  describe('resolveAndCheckUrl (DNS rebinding defense)', () => {
    it('blocks URLs with private IP literals', async () => {
      expect(await resolveAndCheckUrl('http://127.0.0.1/test')).toBe(true);
      expect(await resolveAndCheckUrl('http://[::1]/test')).toBe(true);
      expect(await resolveAndCheckUrl('http://10.0.0.1/test')).toBe(true);
      expect(await resolveAndCheckUrl('http://[::ffff:192.168.1.1]/test')).toBe(true);
    });

    it('blocks URLs with blocked hostnames', async () => {
      expect(await resolveAndCheckUrl('http://localhost/test')).toBe(true);
      expect(await resolveAndCheckUrl('http://metadata.google.internal/test')).toBe(true);
    });

    it('rejects non-http protocols', async () => {
      expect(await resolveAndCheckUrl('ftp://example.com/file')).toBe(true);
      expect(await resolveAndCheckUrl('file:///etc/passwd')).toBe(true);
    });

    it('rejects unparseable URLs', async () => {
      expect(await resolveAndCheckUrl('not a url')).toBe(true);
      expect(await resolveAndCheckUrl('')).toBe(true);
    });

    it('blocks when DNS resolves to a private IPv4 address', async () => {
      mockResolve4.mockResolvedValueOnce(['10.0.0.1']);
      mockResolve6.mockRejectedValueOnce(
        Object.assign(new Error('no AAAA'), { code: 'ENODATA' }),
      );

      expect(await resolveAndCheckUrl('https://evil.example.com/hook')).toBe(true);
    });

    it('blocks when DNS resolves to a private IPv6 address', async () => {
      mockResolve4.mockRejectedValueOnce(
        Object.assign(new Error('no A'), { code: 'ENODATA' }),
      );
      mockResolve6.mockResolvedValueOnce(['fd00::1']);

      expect(await resolveAndCheckUrl('https://evil.example.com/hook')).toBe(true);
    });

    it('blocks when ANY resolved IP is private (mixed results)', async () => {
      mockResolve4.mockResolvedValueOnce(['8.8.8.8', '10.0.0.1']);
      mockResolve6.mockRejectedValueOnce(
        Object.assign(new Error('no AAAA'), { code: 'ENODATA' }),
      );

      expect(await resolveAndCheckUrl('https://sneaky.example.com/hook')).toBe(true);
    });

    it('allows when all resolved IPs are public', async () => {
      mockResolve4.mockResolvedValueOnce(['8.8.8.8']);
      mockResolve6.mockResolvedValueOnce(['2001:4860:4860::8888']);

      expect(await resolveAndCheckUrl('https://safe.example.com/hook')).toBe(false);
    });

    it('fails closed when DNS resolution encounters real errors', async () => {
      mockResolve4.mockRejectedValueOnce(
        Object.assign(new Error('SERVFAIL'), { code: 'SERVFAIL' }),
      );
      mockResolve6.mockRejectedValueOnce(
        Object.assign(new Error('SERVFAIL'), { code: 'SERVFAIL' }),
      );

      expect(await resolveAndCheckUrl('https://broken-dns.example.com/hook')).toBe(true);
    });

    it('allows when both lookups return ENODATA (no records exist)', async () => {
      mockResolve4.mockRejectedValueOnce(
        Object.assign(new Error('no A'), { code: 'ENODATA' }),
      );
      mockResolve6.mockRejectedValueOnce(
        Object.assign(new Error('no AAAA'), { code: 'ENODATA' }),
      );

      // No records = will fail at fetch time anyway, so allow
      expect(await resolveAndCheckUrl('https://no-records.example.com/hook')).toBe(false);
    });

    it('allows when only one record type exists and is public', async () => {
      mockResolve4.mockResolvedValueOnce(['1.1.1.1']);
      mockResolve6.mockRejectedValueOnce(
        Object.assign(new Error('no AAAA'), { code: 'ENOTFOUND' }),
      );

      expect(await resolveAndCheckUrl('https://v4-only.example.com/hook')).toBe(false);
    });
  });
});
