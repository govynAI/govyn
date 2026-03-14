import * as path from 'node:path';

export const DEFAULT_SQLITE_DATABASE_FILE = './govyn.db';

export type DatabaseKind = 'sqlite' | 'postgres';

export function getDatabaseKind(databaseUrl: string): DatabaseKind {
  const normalized = databaseUrl.trim().toLowerCase();
  if (normalized.startsWith('sqlite:')) {
    return 'sqlite';
  }
  if (normalized.startsWith('postgres://') || normalized.startsWith('postgresql://')) {
    return 'postgres';
  }
  throw new Error(
    `Unsupported database.url "${databaseUrl}". Use sqlite:./govyn.db or postgres://...`,
  );
}

export function defaultDatabaseUrl(configPath: string): string {
  return `sqlite:${resolveSqlitePath(DEFAULT_SQLITE_DATABASE_FILE, configPath)}`;
}

export function resolveDatabaseUrl(rawUrl: string, configPath: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('database.url must not be empty');
  }

  const kind = getDatabaseKind(trimmed);
  if (kind === 'postgres') {
    return trimmed;
  }

  const sqlitePath = trimmed.slice('sqlite:'.length);
  return `sqlite:${resolveSqlitePath(sqlitePath, configPath)}`;
}

export function sqlitePathFromUrl(databaseUrl: string): string {
  if (getDatabaseKind(databaseUrl) !== 'sqlite') {
    throw new Error(`Expected a sqlite database URL, got "${databaseUrl}"`);
  }

  return databaseUrl.slice('sqlite:'.length);
}

function resolveSqlitePath(candidate: string, configPath: string): string {
  const trimmed = candidate.trim();
  if (trimmed === ':memory:') {
    return trimmed;
  }

  if (!trimmed) {
    return resolveSqlitePath(DEFAULT_SQLITE_DATABASE_FILE, configPath);
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  return path.resolve(path.dirname(configPath), trimmed);
}
