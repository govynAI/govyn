/**
 * PostgreSQL connection pool and migration runner for the Govyn proxy.
 *
 * Uses the `postgres` library (porsager/postgres) — zero-dependency, ESM-native,
 * tagged template SQL. Connection is optional: if no DATABASE_URL is configured,
 * the proxy runs without persistence (same as v1.1).
 */

import postgres from 'postgres';
import { MIGRATIONS } from './db-schema.js';

/** The active connection pool, or null if not initialized */
let pool: postgres.Sql | null = null;

/**
 * Create a PostgreSQL connection pool.
 *
 * @param databaseUrl - PostgreSQL connection string (postgres://...)
 * @returns The postgres.Sql tagged template instance
 */
export function createPool(databaseUrl: string): postgres.Sql {
  const sql = postgres(databaseUrl, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  pool = sql;
  return sql;
}

/**
 * Run all pending migrations in order.
 * Creates the govyn_migrations table if it doesn't exist.
 * Each migration runs in its own transaction.
 *
 * @param sql - The postgres connection to use
 */
export async function runMigrations(sql: postgres.Sql): Promise<void> {
  // Ensure the migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS govyn_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Get already-applied migration versions
  const applied = await sql`SELECT version FROM govyn_migrations ORDER BY version`;
  const appliedVersions = new Set(applied.map((row) => row.version as number));

  // Apply missing migrations in order
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    await sql.begin(async (tx) => {
      // Execute the migration SQL
      await tx.unsafe(migration.sql);

      // Record that this migration was applied
      // Note: TransactionSql's Omit<Sql,...> strips call signatures, so we use unsafe()
      await tx.unsafe(
        'INSERT INTO govyn_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [migration.version, migration.name],
      );
    });

    console.log(`[govyn] Applied migration v${migration.version}: ${migration.name}`);
  }
}

/**
 * Get the current connection pool instance.
 *
 * @returns The active postgres.Sql instance, or null if not initialized
 */
export function getPool(): postgres.Sql | null {
  return pool;
}

/**
 * Gracefully close the connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
