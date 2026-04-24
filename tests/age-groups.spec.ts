/**
 * Verifies that every age group (≥12) with an active tournament on fotball.no
 * has a corresponding card on the app's home page.
 *
 * Uses fotball.no tournament listings as the source of truth — teams that have
 * withdrawn from their tournament won't appear there, even if FIKS still lists them.
 *
 * Run via:  npx playwright test --project=age-groups
 *
 * Requires: dev/production server on port 3210
 */
import { test, expect } from '@playwright/test';
import { scrapeClubTeams } from '../lib/scraper';

const MIN_AGE = 12;

function ageGroupLabel(ag: string): string {
  const m = ag.match(/^([GJ])(\d{1,2})$/);
  if (!m) return ag;
  return m[1] === 'G' ? `Gutter ${parseInt(m[2])}` : `Jenter ${parseInt(m[2])}`;
}

test('every active age group (≥12) has a card on the home page', async ({ page }) => {
  test.setTimeout(30_000);

  // 1. Get age groups with active tournaments from fotball.no (Cheerio, no browser needed)
  const teamsByAgeGroup = await scrapeClubTeams('82');
  const activeAgeGroups = Object.keys(teamsByAgeGroup)
    .filter((ag) => {
      const age = parseInt(ag.slice(1));
      return age >= MIN_AGE;
    })
    .sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      return parseInt(a.slice(1)) - parseInt(b.slice(1));
    });

  expect(activeAgeGroups.length, 'Expected fotball.no to list at least one age group ≥12').toBeGreaterThan(0);
  console.log(`Active age groups (≥${MIN_AGE}): ${activeAgeGroups.join(', ')}`);

  // 2. Load the app home page
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('.animate-pulse'),
    { timeout: 15000 },
  );

  // 3. Verify each active age group has a visible card
  const missing: string[] = [];
  for (const ag of activeAgeGroups) {
    const label = ageGroupLabel(ag);
    const card = page.locator('button h3', { hasText: label });
    const isVisible = await card.isVisible().catch(() => false);
    if (!isVisible) {
      missing.push(`${ag} (${label})`);
    }
  }

  expect(missing, `Missing age group cards on home page: ${missing.join(', ')}`).toHaveLength(0);
});
