import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
