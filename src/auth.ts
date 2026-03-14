import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_AUTH_FILE = './govyn.auth.json';
export const DEFAULT_SESSION_TTL_HOURS = 24;
export const SESSION_COOKIE_NAME = 'govyn_session';

const AUTH_FILE_VERSION = 1;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 12;

interface StoredPasswordHash {
  algorithm: 'scrypt';
  salt: string;
  hash: string;
  keylen: number;
  n: number;
  r: number;
  p: number;
}

interface StoredSession {
  id_hash: string;
  csrf_token: string;
  created_at: string;
  expires_at: string;
}

interface StoredAuthState {
  version: number;
  username: string;
  password: StoredPasswordHash;
  sessions: StoredSession[];
  created_at: string;
  updated_at: string;
}

export interface AuthStatus {
  configured: boolean;
  username: string | null;
}

export interface AuthSession {
  username: string;
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}

export interface AuthSessionTokens {
  username: string;
  sessionId: string;
  csrfToken: string;
  expiresAt: string;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, { count: number; firstFailureAt: number; blockedUntil: number | null }>();

  constructor(
    private readonly maxAttempts = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly blockMs = 15 * 60 * 1000,
  ) {}

  getRetryAfterSeconds(key: string): number | null {
    const entry = this.attempts.get(key);
    if (!entry || !entry.blockedUntil) return null;

    const remainingMs = entry.blockedUntil - Date.now();
    if (remainingMs <= 0) {
      this.attempts.delete(key);
      return null;
    }

    return Math.ceil(remainingMs / 1000);
  }

  recordFailure(key: string): number | null {
    const now = Date.now();
    const existing = this.attempts.get(key);

    if (!existing || now - existing.firstFailureAt > this.windowMs) {
      this.attempts.set(key, {
        count: 1,
        firstFailureAt: now,
        blockedUntil: null,
      });
      return null;
    }

    existing.count += 1;
    if (existing.count >= this.maxAttempts) {
      existing.blockedUntil = now + this.blockMs;
      return Math.ceil(this.blockMs / 1000);
    }

    this.attempts.set(key, existing);
    return null;
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function validateUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 32) {
    return 'Username must be between 3 and 32 characters';
  }

  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
    return 'Username may contain lowercase letters, numbers, dots, underscores, and hyphens';
  }

  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
  }

  if (password.length > 256) {
    return 'Password must be 256 characters or fewer';
  }

  return null;
}

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashPassword(password: string, saltHex?: string): StoredPasswordHash {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return {
    algorithm: 'scrypt',
    salt: salt.toString('hex'),
    hash: derived.toString('hex'),
    keylen: SCRYPT_KEYLEN,
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  };
}

function verifyPassword(password: string, stored: StoredPasswordHash): boolean {
  const derived = crypto.scryptSync(password, Buffer.from(stored.salt, 'hex'), stored.keylen, {
    N: stored.n,
    r: stored.r,
    p: stored.p,
    maxmem: 64 * 1024 * 1024,
  });

  const expected = Buffer.from(stored.hash, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function atomicWriteJson(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

export class LocalAuthManager {
  readonly authFile: string;
  private readonly sessionTtlMs: number;

  constructor(authFile: string, sessionTtlHours = DEFAULT_SESSION_TTL_HOURS) {
    this.authFile = path.resolve(authFile);
    this.sessionTtlMs = sessionTtlHours * 60 * 60 * 1000;
  }

  isConfigured(): boolean {
    return fs.existsSync(this.authFile);
  }

  getStatus(): AuthStatus {
    if (!this.isConfigured()) {
      return { configured: false, username: null };
    }

    const state = this.readState();
    const changed = this.cleanupExpiredSessions(state);
    if (changed) {
      this.saveState(state);
    }

    return {
      configured: true,
      username: state.username,
    };
  }

  setupAdmin(username: string, password: string): string {
    if (this.isConfigured()) {
      throw new Error(`Auth file already exists at ${this.authFile}`);
    }

    const usernameError = validateUsername(username);
    if (usernameError) {
      throw new Error(usernameError);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const now = new Date().toISOString();
    const state: StoredAuthState = {
      version: AUTH_FILE_VERSION,
      username: normalizeUsername(username),
      password: hashPassword(password),
      sessions: [],
      created_at: now,
      updated_at: now,
    };

    this.saveState(state);
    return state.username;
  }

  resetPassword(password: string, username?: string): string {
    const state = this.readState();

    if (username && normalizeUsername(username) !== state.username) {
      throw new Error(`Auth file at ${this.authFile} is configured for username "${state.username}"`);
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    state.password = hashPassword(password);
    state.sessions = [];
    state.updated_at = new Date().toISOString();
    this.saveState(state);
    return state.username;
  }

  login(username: string, password: string): AuthSessionTokens | null {
    const state = this.readState();
    const changed = this.cleanupExpiredSessions(state);

    if (
      normalizeUsername(username) !== state.username ||
      !verifyPassword(password, state.password)
    ) {
      if (changed) {
        this.saveState(state);
      }
      return null;
    }

    const sessionId = crypto.randomBytes(32).toString('base64url');
    const csrfToken = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlMs).toISOString();

    state.sessions.push({
      id_hash: hashToken(sessionId),
      csrf_token: csrfToken,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    });
    state.updated_at = new Date().toISOString();
    this.saveState(state);

    return {
      username: state.username,
      sessionId,
      csrfToken,
      expiresAt,
    };
  }

  getSession(sessionId: string): AuthSession | null {
    if (!sessionId || !this.isConfigured()) return null;

    const state = this.readState();
    const changed = this.cleanupExpiredSessions(state);
    const session = state.sessions.find((entry) => entry.id_hash === hashToken(sessionId));

    if (changed) {
      this.saveState(state);
    }

    if (!session) {
      return null;
    }

    return {
      username: state.username,
      sessionId,
      csrfToken: session.csrf_token,
      expiresAt: session.expires_at,
    };
  }

  validateCsrfToken(sessionId: string, csrfToken: string): boolean {
    if (!sessionId || !csrfToken || !this.isConfigured()) return false;

    const state = this.readState();
    const changed = this.cleanupExpiredSessions(state);
    const session = state.sessions.find((entry) => entry.id_hash === hashToken(sessionId));

    if (changed) {
      this.saveState(state);
    }

    if (!session) {
      return false;
    }

    const provided = Buffer.from(csrfToken, 'utf8');
    const expected = Buffer.from(session.csrf_token, 'utf8');
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  }

  logout(sessionId: string): void {
    if (!sessionId || !this.isConfigured()) return;

    const state = this.readState();
    const originalLength = state.sessions.length;
    state.sessions = state.sessions.filter((entry) => entry.id_hash !== hashToken(sessionId));

    if (state.sessions.length !== originalLength) {
      state.updated_at = new Date().toISOString();
      this.saveState(state);
    }
  }

  changePassword(sessionId: string, currentPassword: string, newPassword: string): string {
    if (!sessionId) {
      throw new Error('A valid session is required');
    }

    const state = this.readState();
    const changed = this.cleanupExpiredSessions(state);
    const session = state.sessions.find((entry) => entry.id_hash === hashToken(sessionId));
    if (!session) {
      if (changed) {
        this.saveState(state);
      }
      throw new Error('A valid session is required');
    }

    if (!verifyPassword(currentPassword, state.password)) {
      if (changed) {
        this.saveState(state);
      }
      throw new Error('Current password is incorrect');
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      throw new Error(passwordError);
    }

    state.password = hashPassword(newPassword);
    state.sessions = [];
    state.updated_at = new Date().toISOString();
    this.saveState(state);
    return state.username;
  }

  private readState(): StoredAuthState {
    let raw: string;
    try {
      raw = fs.readFileSync(this.authFile, 'utf8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read auth file at ${this.authFile}: ${message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse auth file at ${this.authFile}: ${message}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Invalid auth file at ${this.authFile}: expected a JSON object`);
    }

    const state = parsed as Partial<StoredAuthState>;
    if (
      state.version !== AUTH_FILE_VERSION ||
      typeof state.username !== 'string' ||
      typeof state.password?.hash !== 'string' ||
      !Array.isArray(state.sessions)
    ) {
      throw new Error(`Invalid auth file at ${this.authFile}: missing required fields`);
    }

    return {
      version: state.version,
      username: state.username,
      password: state.password as StoredPasswordHash,
      sessions: state.sessions as StoredSession[],
      created_at: typeof state.created_at === 'string' ? state.created_at : new Date().toISOString(),
      updated_at: typeof state.updated_at === 'string' ? state.updated_at : new Date().toISOString(),
    };
  }

  private saveState(state: StoredAuthState): void {
    atomicWriteJson(this.authFile, `${JSON.stringify(state, null, 2)}\n`);
  }

  private cleanupExpiredSessions(state: StoredAuthState): boolean {
    const now = Date.now();
    const nextSessions = state.sessions.filter((entry) => {
      const expiresAt = Date.parse(entry.expires_at);
      return Number.isFinite(expiresAt) && expiresAt > now;
    });

    if (nextSessions.length === state.sessions.length) {
      return false;
    }

    state.sessions = nextSessions;
    state.updated_at = new Date().toISOString();
    return true;
  }
}
