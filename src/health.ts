/**
 * Health check endpoint for the Govyn proxy server.
 *
 * Returns HTTP 200 with JSON containing status, version, and uptime_seconds.
 * Version is read from package.json once at module load time.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Timestamp when this module was first loaded (server start time). */
const SERVER_START_TIME = Date.now();

/**
 * Read package version once at startup.
 * Resolves package.json relative to this file's location.
 */
function readPackageVersion(): string {
  try {
    // Resolve from the project root (one directory up from src/)
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Package version read once at module load. */
const PACKAGE_VERSION = readPackageVersion();

/**
 * Handle GET /health requests.
 *
 * Returns HTTP 200 with JSON body:
 *   { "status": "ok", "version": "x.y.z", "uptime_seconds": N }
 */
export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);

  const body = JSON.stringify({
    status: 'ok',
    version: PACKAGE_VERSION,
    uptime_seconds: uptimeSeconds,
  });

  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}
