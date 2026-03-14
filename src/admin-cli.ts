import { LocalAuthManager, DEFAULT_AUTH_FILE } from './auth.js';
import { createPrompt } from './prompt.js';

export async function runAdminSetup(authFile = DEFAULT_AUTH_FILE): Promise<void> {
  const authManager = new LocalAuthManager(authFile);
  const { ask, askHidden, close } = createPrompt();

  try {
    const username = (await ask("Admin username (default: 'admin'): ")) || 'admin';
    const password = await askHidden('Admin password: ');
    const confirmation = await askHidden('Confirm password: ');

    if (password !== confirmation) {
      throw new Error('Passwords did not match');
    }

    const normalizedUsername = authManager.setupAdmin(username, password);
    console.log(`[govyn] Local admin "${normalizedUsername}" created at ${authManager.authFile}`);
  } finally {
    close();
  }
}

export async function runAdminResetPassword(authFile = DEFAULT_AUTH_FILE): Promise<void> {
  const authManager = new LocalAuthManager(authFile);
  const { askHidden, close } = createPrompt();

  try {
    const password = await askHidden('New admin password: ');
    const confirmation = await askHidden('Confirm new password: ');

    if (password !== confirmation) {
      throw new Error('Passwords did not match');
    }

    const username = authManager.resetPassword(password);
    console.log(`[govyn] Password reset for "${username}" using ${authManager.authFile}`);
  } finally {
    close();
  }
}
