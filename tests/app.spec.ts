/**
 * UI tests for the Nesodden G16 Next.js app (localhost:3000).
 * These tests do NOT require FIKS credentials.
 */
import { test, expect } from '@playwright/test';

const TEAMS = [
  { label: 'Nesodden G16-1', fiksId: '134742' },
  { label: 'Nesodden G16-2', fiksId: '154500' },
  { label: 'Nesodden G16-3', fiksId: '6895'   },
];

test.describe('App layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('renders page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Nesodden IF/i);
  });

  test('shows Nesodden club logo in header', async ({ page }) => {
    const logo = page.locator('header img[alt*="Nesodden"]').first();
    await expect(logo).toBeVisible();
    // Logo should load from fotball.no CDN
    const src = await logo.getAttribute('src');
    expect(src).toContain('images.fotball.no/clublogos/82.png');
  });

  test('shows season year 2026 in header', async ({ page }) => {
    await expect(page.locator('header')).toContainText('2026');
  });
});

test.describe('Team tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?ageGroup=G16');
    await page.waitForLoadState('networkidle');
  });

  test('shows all three G16 team buttons', async ({ page }) => {
    for (const team of TEAMS) {
      await expect(page.getByRole('button', { name: new RegExp(team.label, 'i') })).toBeVisible();
    }
  });

  test('G16-1 is selected by default', async ({ page }) => {
    const btn = page.getByRole('button', { name: /G16-1/i }).first();
    // Active tab has red background (bg-nesodden-red class)
    await expect(btn).toHaveClass(/bg-nesodden-red/);
  });

  for (const team of TEAMS) {
    test(`clicking ${team.label} tab loads its matches`, async ({ page }) => {
      await page.getByRole('button', { name: new RegExp(team.label, 'i') }).first().click();
      // Wait for at least one match card to appear (data loaded)
      await expect(page.locator('.rounded-xl button').first()).toBeVisible({ timeout: 20000 });
    });
  }
});

test.describe('Match cards', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?ageGroup=G16');
    // Wait for G16-1 matches to load
    await page.waitForFunction(() => !document.querySelector('.rounded-xl.animate-pulse'), { timeout: 15000 });
  });

  test('shows at least one upcoming match card', async ({ page }) => {
    // Upcoming cards use bg-dark-card; past cards use bg-dark-surface
    const cards = page.locator('.bg-dark-card button');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('each match card shows home and away team names', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await expect(firstCard.getByText('Hjemmelag')).toBeVisible();
    await expect(firstCard.getByText('Bortelag')).toBeVisible();
  });

  test('each match card shows a date', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    // Date format: dd.mm.yyyy
    await expect(firstCard.getByText(/\d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  });

  test('each match card shows a time', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await expect(firstCard.getByText(/\d{2}:\d{2}/)).toBeVisible();
  });

  test('each match card shows home/away indicator', async ({ page }) => {
    // At least one "Hjemmekamp" or "Bortekamp" label anywhere in the match list
    const homeOrAway = page.getByText(/Hjemmekamp|Bortekamp/);
    await expect(homeOrAway.first()).toBeVisible();
  });

  test('match card shows venue', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    // Venue icon + text (svg + location text)
    const venueText = firstCard.locator('p').filter({ hasText: /\w{3,}/ }).last();
    await expect(venueText).toBeVisible();
  });

  test('match card shows team emblems (img or fallback initials)', async ({ page }) => {
    // Wait for the match data to render — "Kommende kamper" is already visible from beforeEach.
    // Match card emblems are client-rendered; wait until > 4 show up
    // (header=1, team tabs=3 are in SSR; match cards add ≥2 more)
    await expect(page.locator('[data-testid="team-emblem"]')).toHaveCount(
      await page.locator('[data-testid="team-emblem"]').count() + 2,
      { timeout: 5000 }
    ).catch(() => {}); // count may already be high enough

    const total = await page.locator('[data-testid="team-emblem"]').count();
    // At minimum: header (1) + team tabs (3) + 1st match card home+away (2) = 6
    expect(total, `Expected ≥6 team emblems on page, got ${total}`).toBeGreaterThanOrEqual(6);
  });
});

test.describe('Match card expand / player list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?ageGroup=G16');
    // Wait for match list to be populated
    await expect(page.getByText(/Kommende \(/i)).toBeVisible({ timeout: 20000 });
  });

  test('clicking a match card expands to show player sections', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await firstCard.click();

    // Wait for player content — either the loading text or actual player content
    const playerContent = page.locator('.border-t.border-dark-border');
    await expect(playerContent).toBeVisible({ timeout: 10000 });

    // Wait for loading spinner to resolve (if any)
    await expect(page.getByText(/Laster spillere/i)).not.toBeVisible({ timeout: 15000 });

    // Should show two player columns
    const playerColumns = playerContent.locator('.grid > div');
    await expect(playerColumns.first()).toBeVisible();
    expect(await playerColumns.count()).toBe(2);
  });

  test('player list shows position badges', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await firstCard.click();
    await expect(page.locator('.border-t.border-dark-border')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Laster spillere/i)).not.toBeVisible({ timeout: 15000 });

    // Position badges
    const badge = page.getByText(/^(Keeper|Forsvar|Midtbane|Angrep)$/).first();
    await expect(badge).toBeVisible();
  });

  test('player list shows jersey numbers', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await firstCard.click();
    await expect(page.locator('.border-t.border-dark-border')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Laster spillere/i)).not.toBeVisible({ timeout: 15000 });

    const jerseyNum = page.locator('.font-mono').first();
    await expect(jerseyNum).toBeVisible();
  });

  test('clicking an expanded card again collapses it', async ({ page }) => {
    const firstCard = page.locator('.rounded-xl button').first();

    await firstCard.click();
    const expanded = page.locator('.border-t.border-dark-border');
    await expect(expanded).toBeVisible({ timeout: 10000 });

    // Collapse
    await firstCard.click();
    await expect(expanded).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('API endpoints', () => {
  for (const team of TEAMS) {
    test(`GET /api/teams/${team.fiksId}/matches returns valid data`, async ({ request }) => {
      const resp = await request.get(`/api/teams/${team.fiksId}/matches`);
      expect(resp.ok()).toBeTruthy();

      const body = await resp.json() as { matches: unknown[] };
      expect(body).toHaveProperty('matches');
      expect(Array.isArray(body.matches)).toBe(true);
      expect(body.matches.length).toBeGreaterThan(0);

      // Spot-check first match structure
      const first = body.matches[0] as Record<string, unknown>;
      expect(first).toHaveProperty('matchId');
      expect(first).toHaveProperty('date');
      expect(first).toHaveProperty('homeTeam');
      expect(first).toHaveProperty('awayTeam');
      expect(first).toHaveProperty('homeLogoUrl');
      expect(first).toHaveProperty('awayLogoUrl');
      expect(first).toHaveProperty('venue');
    });

    test(`GET /api/teams/${team.fiksId}/players returns valid data`, async ({ request }) => {
      const resp = await request.get(`/api/teams/${team.fiksId}/players`);
      expect(resp.ok()).toBeTruthy();

      const body = await resp.json() as { players: unknown[] };
      expect(body).toHaveProperty('players');
      expect(Array.isArray(body.players)).toBe(true);

      if (body.players.length > 0) {
        const first = body.players[0] as Record<string, unknown>;
        expect(first).toHaveProperty('name');
        expect(first).toHaveProperty('position');
        expect(first).toHaveProperty('jerseyNumber');
      }
    });
  }

});
