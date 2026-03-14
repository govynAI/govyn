import { execFileSync } from 'node:child_process';

const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) {
  throw new Error('npm_execpath is not set; run this script via npm.');
}

const output = execFileSync(process.execPath, [npmExecPath, 'pack', '--dry-run', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

const [packInfo] = JSON.parse(output);
const packedFiles = new Set(packInfo.files.map((entry) => entry.path));

for (const forbiddenPath of ['govyn.config.yaml', 'govyn.auth.json', 'govyn.db', 'govyn.db-shm', 'govyn.db-wal']) {
  if (packedFiles.has(forbiddenPath)) {
    throw new Error(`Package surface must not include ${forbiddenPath}.`);
  }
}

for (const requiredPath of ['package.json', 'README.md', 'configs/openai-only.yaml']) {
  if (!packedFiles.has(requiredPath)) {
    throw new Error(`Package surface is missing required file: ${requiredPath}`);
  }
}

if (![...packedFiles].some((filePath) => filePath.startsWith('dist/'))) {
  throw new Error('Package surface must include built dist assets. Run npm run build before package:check.');
}

const allowedDistFile = /^dist\/.+(?:\.js|\.d\.ts|\.js\.map)$/;

for (const filePath of packedFiles) {
  if (filePath.startsWith('dist/') && !allowedDistFile.test(filePath)) {
    throw new Error(`Package surface must not include non-runtime dist asset: ${filePath}`);
  }
}

console.log('Package surface check passed.');
