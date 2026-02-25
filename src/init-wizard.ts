/**
 * Interactive setup wizard for Govyn.
 *
 * Uses Node.js built-in readline module (zero new dependencies).
 * Walks the user through provider selection, API key configuration,
 * budget limits, and agent naming. Outputs a govyn.config.yaml file.
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import { stringify as yamlStringify } from 'yaml';

/**
 * Create a readline interface and a helper to ask questions.
 */
function createPrompt(): { ask: (question: string) => Promise<string>; close: () => void } {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      rl.question(question, (answer: string) => {
        resolve(answer.trim());
      });
    });
  }

  function close(): void {
    rl.close();
  }

  return { ask, close };
}

interface ProviderEntry {
  name: string;
  base_url: string;
  api_key_env: string | null;
}

/**
 * Run the interactive init wizard.
 * Produces a govyn.config.yaml in the current working directory.
 */
export async function runInitWizard(): Promise<void> {
  const { ask, close } = createPrompt();

  console.log('\nGovyn Setup Wizard');
  console.log('==================\n');

  // 1. Provider selection
  const providerInput = await ask('Which LLM providers do you want to use? (comma-separated: openai, anthropic, custom): ');
  const selectedProviders = providerInput
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);

  if (selectedProviders.length === 0) {
    console.log('No providers selected. Defaulting to openai.');
    selectedProviders.push('openai');
  }

  const providers: ProviderEntry[] = [];
  const envReminders: string[] = [];

  // 2. Configure each provider
  for (const provider of selectedProviders) {
    if (provider === 'openai') {
      const key = await ask('Enter your OpenAI API key (or press Enter to use OPENAI_API_KEY env var): ');
      if (key && !key.startsWith('sk-')) {
        console.log('Warning: OpenAI API keys typically start with "sk-". Proceeding anyway.');
      }
      providers.push({
        name: 'openai',
        base_url: 'https://api.openai.com',
        api_key_env: 'OPENAI_API_KEY',
      });
      if (key) {
        envReminders.push(`export OPENAI_API_KEY=${key}`);
      }
    } else if (provider === 'anthropic') {
      const key = await ask('Enter your Anthropic API key (or press Enter to use ANTHROPIC_API_KEY env var): ');
      if (key && !key.startsWith('sk-ant-')) {
        console.log('Warning: Anthropic API keys typically start with "sk-ant-". Proceeding anyway.');
      }
      providers.push({
        name: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key_env: 'ANTHROPIC_API_KEY',
      });
      if (key) {
        envReminders.push(`export ANTHROPIC_API_KEY=${key}`);
      }
    } else if (provider === 'custom') {
      const name = await ask('Enter the custom endpoint name: ');
      const baseUrl = await ask('Enter the base URL: ');
      const apiKeyEnvInput = await ask('Enter the API key env var name (or press Enter for none): ');
      providers.push({
        name: name || 'custom',
        base_url: baseUrl || 'http://localhost:8080',
        api_key_env: apiKeyEnvInput || null,
      });
    } else {
      console.log(`Unknown provider "${provider}", skipping.`);
    }
  }

  // 3. Budget limit
  const budgetInput = await ask('Do you want to set a daily budget limit? (Enter amount in USD, or press Enter to skip): ');
  const dailyBudget = budgetInput ? parseFloat(budgetInput) : null;

  // 4. Agent name
  const agentName = (await ask("Enter a name for your first agent (default: 'default-agent'): ")) || 'default-agent';

  close();

  // Build the config object
  const configObj: Record<string, unknown> = {
    version: 1,
    proxy: {
      port: 4000,
      host: '0.0.0.0',
    },
    providers: {} as Record<string, unknown>,
  };

  // Populate providers
  const providersSection = configObj['providers'] as Record<string, unknown>;
  const customProviders: Record<string, unknown> = {};

  for (const p of providers) {
    if (p.name === 'openai' || p.name === 'anthropic') {
      const entry: Record<string, string> = { base_url: p.base_url };
      if (p.api_key_env) {
        entry['api_key_env'] = p.api_key_env;
      }
      providersSection[p.name] = entry;
    } else {
      const entry: Record<string, string> = { base_url: p.base_url };
      if (p.api_key_env) {
        entry['api_key_env'] = p.api_key_env;
      }
      customProviders[p.name] = entry;
    }
  }

  if (Object.keys(customProviders).length > 0) {
    providersSection['custom'] = customProviders;
  }

  // Populate agents
  configObj['agents'] = {
    [agentName]: {
      api_keys: [],
    },
  };

  // Populate budgets if set
  if (dailyBudget !== null && !isNaN(dailyBudget) && dailyBudget > 0) {
    configObj['budgets'] = {
      [agentName]: {
        daily_limit: dailyBudget,
        limit_type: 'hard',
        soft_warning_percent: 80,
      },
    };
  }

  // Logging defaults
  configObj['logging'] = {
    enabled: true,
    directory: './logs',
    default_mode: 'metadata',
    stdout: true,
    file: true,
  };

  // Serialize to YAML
  const yamlContent = yamlStringify(configObj);

  // Write the config file
  const outputPath = './govyn.config.yaml';
  fs.writeFileSync(outputPath, yamlContent, 'utf8');

  console.log(`\nConfig written to ${outputPath}`);

  // Print environment variable reminders
  if (envReminders.length > 0) {
    console.log('\nSet your API key(s) as environment variables:');
    for (const reminder of envReminders) {
      console.log(`  ${reminder}`);
    }
  }

  console.log('\nStart the proxy with: npx govyn');
  console.log('Verify it works:      curl http://localhost:4000/health');
}
