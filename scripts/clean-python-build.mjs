import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const pythonSdkDir = path.resolve(process.cwd(), 'python-sdk');
const targets = [
  path.join(pythonSdkDir, 'build'),
  path.join(pythonSdkDir, 'dist'),
  path.join(pythonSdkDir, 'govynai.egg-info'),
];

for (const target of targets) {
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}
