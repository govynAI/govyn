#!/usr/bin/env node

/**
 * CLI entry point for the Govyn proxy server.
 *
 * Supports subcommands:
 *   govyn                       - Start the proxy server (default)
 *   govyn start                 - Start the proxy server
 *   govyn init                  - Interactive setup wizard
 *   govyn admin setup           - Create the local OSS dashboard admin account
 *   govyn admin reset-password  - Reset the local OSS dashboard admin password
 *   govyn policy validate <file> - Validate a policy YAML file
 *   govyn --help                - Show usage information
 *   govyn --version             - Show version number
 */

import { loadConfig } from './config.js';
import { startProxyRuntime } from './runtime.js';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);

/**
 * Read version from package.json.
 */
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Walk up from dist/ to project root
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * Print usage information.
 */
function printHelp(): void {
  console.log(`Usage: govyn [command]

Commands:
  start              Start the proxy server (default)
  init               Interactive setup wizard
  admin setup        Create the local dashboard admin account
  admin reset-password
                     Reset the local dashboard admin password
  policy validate    Validate a policy YAML file

Options:
  --config <path>  Path to config file (default: govyn.config.yaml)
  --auth-file <path>
                  Path to auth file (default: ./govyn.auth.json or security.auth_file)
  --help           Show this help message
  --version        Show version number`);
}

function resolveAuthFilePath(): string | undefined {
  const authFileIdx = args.indexOf('--auth-file');
  if (authFileIdx !== -1) {
    return args[authFileIdx + 1];
  }

  const configIdx = args.indexOf('--config');
  const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined;
  if (!configPath || !fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    return loadConfig(configPath).security?.authFile;
  } catch {
    return undefined;
  }
}

/**
 * Handle `govyn policy validate <file>` — offline policy file validation.
 */
async function handlePolicyValidate(): Promise<void> {
  const filePath = args[2];

  if (!filePath) {
    console.log('Usage: govyn policy validate <file>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  // Dynamic import to keep CLI startup fast when not validating
  const { parsePoliciesFromFile } = await import('./policy-parser.js');
  const result = parsePoliciesFromFile(filePath);

  if (result.success) {
    console.log(`Valid: ${result.policies.length} policies found in ${filePath}`);
    for (const policy of result.policies) {
      console.log(`  - ${policy.name} (${policy.type}, scope: ${policy.scope.level})`);
    }
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        const loc = warning.line ? ` (line ${warning.line})` : '';
        console.log(`Warning: ${warning.message}${loc}`);
      }
    }
    process.exit(0);
  } else {
    console.error(`Invalid: ${result.errors.length} error(s) in ${filePath}`);
    for (const error of result.errors) {
      let loc = '';
      if (error.line) loc += ` (line ${error.line})`;
      if (error.column) loc += ` (column ${error.column})`;
      console.error(`  Error: ${error.message}${loc}`);
    }
    process.exit(1);
  }
}

/**
 * Start the proxy server.
 */
async function startProxy(): Promise<void> {
  const configIdx = args.indexOf('--config');
  const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined;
  await startProxyRuntime(configPath);
}

// --- Main dispatch ---

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(getVersion());
  process.exit(0);
}

const firstArg = args[0];
const command = firstArg && firstArg.startsWith('-') ? undefined : firstArg;

if (command === 'init') {
  // Dynamic import to avoid loading readline unless needed
  import('./init-wizard.js').then(({ runInitWizard }) => {
    runInitWizard().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[govyn] Init wizard failed: ${message}`);
      process.exit(1);
    });
  });
} else if (command === 'policy') {
  const subcommand = args[1];
  if (subcommand === 'validate') {
    handlePolicyValidate().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[govyn] Policy validation failed: ${message}`);
      process.exit(1);
    });
  } else {
    console.error(`Unknown policy subcommand: ${subcommand ?? '(none)'}`);
    console.log('Available: govyn policy validate <file>');
    process.exit(1);
  }
} else if (command === 'admin') {
  const subcommand = args[1];
  const authFile = resolveAuthFilePath();
  if (subcommand === 'setup') {
    import('./admin-cli.js').then(({ runAdminSetup }) => {
      runAdminSetup(authFile).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[govyn] Admin setup failed: ${message}`);
        process.exit(1);
      });
    });
  } else if (subcommand === 'reset-password') {
    import('./admin-cli.js').then(({ runAdminResetPassword }) => {
      runAdminResetPassword(authFile).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[govyn] Password reset failed: ${message}`);
        process.exit(1);
      });
    });
  } else {
    console.error(`Unknown admin subcommand: ${subcommand ?? '(none)'}`);
    console.log('Available: govyn admin setup | govyn admin reset-password');
    process.exit(1);
  }
} else if (command === 'start' || command === undefined) {
  startProxy().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[govyn] Failed to start: ${message}`);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
