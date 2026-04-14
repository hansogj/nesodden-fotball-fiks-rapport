/**
 * Playwright setup: log in to fiks.fotball.no and save auth state.
 * Reads credentials from environment variables:
 *   FIKS_EMAIL    — FIKS account email
 *   FIKS_PASSWORD — FIKS account password
 *
 * Run once before accuracy tests; result cached in .auth/fiks.json.
 */
import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const AUTH_FILE = path.join(process.cwd(), '.auth', 'fiks.json');

setup('authenticate to fiks.fotball.no', async ({ page }) => {
  const email    = process.env.FIKS_EMAIL;
  const password = process.env.FIKS_PASSWORD;

  if (!email || !password) {
    console.warn(
      '\n⚠️  FIKS_EMAIL / FIKS_PASSWORD not set — skipping FIKS login.\n' +
      '   Data-accuracy tests will be skipped.\n' +
      '   Set them in .env.test or export before running.\n'
    );
    // Write empty storage state so the accuracy tests can at least start
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  // FIKS redirects / to /FiksWeb/Login automatically
  await page.goto('https://fiks.fotball.no/');
  await page.waitForLoadState('networkidle');

  // Form fields: UserName (text) + Password
  await page.locator('#UserName').fill(email);
  await page.locator('#Password').fill(password);
  await page.getByRole('button', { name: /logg inn/i }).click();

  // Wait for redirect away from login page
  await page.waitForURL((url) => !url.pathname.toLowerCase().includes('login'), { timeout: 15000 });
  await expect(page).not.toHaveURL(/[Ll]ogin/);

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
  console.log('✅ FIKS authentication saved to', AUTH_FILE);
});
