/**
 * Cross-team player detection tests.
 *
 * Verifies that CrossTeamPlayers correctly identifies players in the current
 * match's kamptropp who also appeared in a sister team's most recent match.
 *
 * All API responses are mocked via page.route() — no FIKS credentials needed.
 *
 * Division hierarchy (lower number = higher level):
 *   G16-1: 'G16 2. divisjon'        → rank 2 (highest)
 *   G16-3: 'G16 3. divisjon avd 03' → rank 3
 *   G16-2: 'G16 4. divisjon avd 02' → rank 4 (lowest)
 */
import { test, expect, type Page } from '@playwright/test';

const APP = 'http://localhost:3210';

// FIKS IDs matching G16_TEAMS in lib/mockData.ts
const G16_1 = '134742';
const G16_2 = '6895';
const G16_3 = '154500';

// Unique squad IDs that won't clash with real FIKS data
const SQUAD_CURRENT = 'crosstest-squad-current';
const SQUAD_OTHER   = 'crosstest-squad-other';

// ── Mock players ─────────────────────────────────────────────────────────────

/** Appears in both the current and sister squad (same name, jersey may differ) */
const SHARED          = { name: 'Felles, Spiller',  jerseyNumber: 7,  position: 'Midtbane' };
const SHARED_IN_OTHER = { name: 'Felles, Spiller',  jerseyNumber: 19, position: 'Midtbane' };
const UNIQUE          = { name: 'Unik, Spiller',     jerseyNumber: 10, position: 'Angrep'   };
const OPPONENT        = { name: 'Motst, Ander',      jerseyNumber: 9,  position: 'Angrep'   };

// ── Mock match objects ────────────────────────────────────────────────────────

/**
 * Upcoming G16-2 match (Nesodden as home) — the "current" match card being viewed.
 * Uses a unique opponent name so we can find the card by text.
 */
const G162_UPCOMING: Record<string, unknown> = {
  matchId: 'crosstest-g162-1',
  date: '25.04.2026', time: '12:00',
  homeTeam: 'Nesodden 2', homeTeamId: G16_2, homeClubId: '82',
  homeLogoUrl: 'https://images.fotball.no/clublogos/82.png',
  awayTeam: 'CrossTestMotstander', awayTeamId: '99999', awayClubId: '9999',
  awayLogoUrl: 'https://images.fotball.no/clublogos/9999.png',
  venue: 'Nesodden Idrettspark', tournament: 'G16 Kretsserie 2026',
  isHome: true, matchReportId: SQUAD_CURRENT,
};

/** G16-1's last played match (Nesodden as home) — used by CrossTeamPlayers check */
const G161_PLAYED: Record<string, unknown> = {
  matchId: 'crosstest-g161-1',
  date: '11.04.2026', time: '13:00',
  homeTeam: 'Nesodden', homeTeamId: G16_1, homeClubId: '82',
  homeLogoUrl: 'https://images.fotball.no/clublogos/82.png',
  awayTeam: 'Grüner', awayTeamId: '75136', awayClubId: '177',
  awayLogoUrl: 'https://images.fotball.no/clublogos/177.png',
  venue: 'Nesodden Idrettspark', tournament: 'G16 Kretsserie 2026',
  isHome: true, result: '3 - 3', matchReportId: SQUAD_OTHER,
};

/** G16-3's last played match (Nesodden as home) */
const G163_PLAYED: Record<string, unknown> = {
  matchId: 'crosstest-g163-1',
  date: '11.04.2026', time: '11:00',
  homeTeam: 'Nesodden 3', homeTeamId: G16_3, homeClubId: '82',
  homeLogoUrl: 'https://images.fotball.no/clublogos/82.png',
  awayTeam: 'Haugerud 2', awayTeamId: '11111', awayClubId: '179',
  awayLogoUrl: 'https://images.fotball.no/clublogos/179.png',
  venue: 'Nesodden Idrettspark', tournament: 'G16 Kretsserie 2026',
  isHome: true, result: '1 - 0', matchReportId: SQUAD_OTHER,
};

/** Upcoming G16-1 match — the "current" match when testing from G16-1's perspective */
const G161_UPCOMING: Record<string, unknown> = {
  matchId: 'crosstest-g161-upcoming',
  date: '26.04.2026', time: '12:00',
  homeTeam: 'Nesodden', homeTeamId: G16_1, homeClubId: '82',
  homeLogoUrl: 'https://images.fotball.no/clublogos/82.png',
  awayTeam: 'CrossTestHøyereMotstander', awayTeamId: '88888', awayClubId: '8888',
  awayLogoUrl: 'https://images.fotball.no/clublogos/8888.png',
  venue: 'Nesodden Idrettspark', tournament: 'G16 Kretsserie 2026',
  isHome: true, matchReportId: SQUAD_CURRENT,
};

// ── Route helpers ─────────────────────────────────────────────────────────────

interface RouteOpts {
  g161Matches?: unknown[];
  g162Matches?: unknown[];
  g163Matches?: unknown[];
  currentSquad?: unknown;
  otherSquad?: unknown;
}

async function mockRoutes(page: Page, opts: RouteOpts = {}) {
  const {
    g161Matches = [G161_PLAYED],
    g162Matches = [G162_UPCOMING],
    g163Matches = [],
    currentSquad = { ready: true, home: [SHARED, UNIQUE], away: [OPPONENT] },
    otherSquad   = { ready: true, home: [SHARED_IN_OTHER], away: [] },
  } = opts;

  await page.route(`**/api/teams/${G16_1}/matches`, (r) =>
    r.fulfill({ json: { matches: g161Matches, source: 'test' } })
  );
  await page.route(`**/api/teams/${G16_2}/matches`, (r) =>
    r.fulfill({ json: { matches: g162Matches, source: 'test' } })
  );
  await page.route(`**/api/teams/${G16_3}/matches`, (r) =>
    r.fulfill({ json: { matches: g163Matches, source: 'test' } })
  );
  await page.route(`**/api/squads/${SQUAD_CURRENT}`, (r) =>
    r.fulfill({ json: currentSquad })
  );
  await page.route(`**/api/squads/${SQUAD_OTHER}`, (r) =>
    r.fulfill({ json: otherSquad })
  );
  // Silence sync status check (not relevant to cross-team tests)
  await page.route('**/api/sync', (r) =>
    r.fulfill({ json: { synced: false } })
  );
}

// ── Navigation helpers ────────────────────────────────────────────────────────

/** Navigate to G16-2 tab, open the mock match card, wait for squad to appear */
async function openG162Card(page: Page) {
  await page.goto(APP);
  await page.getByRole('button', { name: /Nesodden G16-2/i }).first().click();
  await expect(page.getByText('CrossTestMotstander')).toBeVisible({ timeout: 8000 });
  await page.locator('button').filter({ hasText: 'CrossTestMotstander' }).first().click();
  // Squad loaded when a known player name is visible
  await expect(page.getByText('Unik, Spiller')).toBeVisible({ timeout: 8000 });
}

/** Stay on G16-1 tab (default), open the mock match card, wait for squad */
async function openG161Card(page: Page) {
  await page.goto(APP);
  await expect(page.getByText('CrossTestHøyereMotstander')).toBeVisible({ timeout: 8000 });
  await page.locator('button').filter({ hasText: 'CrossTestHøyereMotstander' }).first().click();
  await expect(page.getByText('Unik, Spiller')).toBeVisible({ timeout: 8000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('CrossTeamPlayers — spillerdeling mellom lag', () => {

  test('viser spiller som spilte for G16-1 (høyere nivå) sist runde — sett fra G16-2', async ({ page }) => {
    await mockRoutes(page);
    await openG162Card(page);

    // Wait for cross-team check to complete
    const section = page.getByText('Spillerdeling mellom lag');
    await expect(section).toBeVisible({ timeout: 10000 });

    // Correct player is listed
    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();

    // Labelled as higher level
    await expect(page.getByText('høyere nivå')).toBeVisible();

    // Date of the sister team's match is shown
    await expect(page.getByText('11.04.2026')).toBeVisible();
  });

  test('viser spiller som spilte for G16-3 (lavere nivå) sist runde — sett fra G16-1', async ({ page }) => {
    await mockRoutes(page, {
      // G16-1 is the active team: upcoming match is the one being viewed
      g161Matches: [G161_UPCOMING],
      // G16-3 has one played match; its Nesodden players include SHARED
      g163Matches: [G163_PLAYED],
      // Current squad: G16-1's upcoming match squad (Nesodden home → squad.home)
      currentSquad: { ready: true, home: [SHARED, UNIQUE], away: [OPPONENT] },
      // Other squad: G16-3's last played match (Nesodden home → squad.home)
      otherSquad:   { ready: true, home: [SHARED_IN_OTHER], away: [] },
    });

    await openG161Card(page);

    const section = page.getByText('Spillerdeling mellom lag');
    await expect(section).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();

    // G16-3 is rank 3, G16-1 is rank 2 → G16-3 is LOWER level from G16-1's view
    await expect(page.getByText('lavere nivå')).toBeVisible();
  });

  test('skjuler seksjonen når ingen spillere er delt mellom lagene', async ({ page }) => {
    await mockRoutes(page, {
      // G16-1's squad has completely different players from G16-2's current squad
      otherSquad: {
        ready: true,
        home: [{ name: 'Annen, Spiller', jerseyNumber: 1, position: 'Keeper' }],
        away: [],
      },
    });
    await openG162Card(page);

    // Give CrossTeamPlayers time to complete its checks
    await page.waitForTimeout(2000);
    await expect(page.getByText('Spillerdeling mellom lag')).not.toBeVisible();
  });

  test('skjuler seksjonen når søsterlagene ikke har spilt noen kamper enda', async ({ page }) => {
    await mockRoutes(page, {
      // Neither G16-1 nor G16-3 have any played matches (no result field)
      g161Matches: [{ ...G161_UPCOMING, matchReportId: undefined }],
      g163Matches: [],
    });
    await openG162Card(page);

    await page.waitForTimeout(2000);
    await expect(page.getByText('Spillerdeling mellom lag')).not.toBeVisible();
  });

  test('skjuler seksjonen når søsterlagets siste kamptropp ikke er registrert (ready: false)', async ({ page }) => {
    await mockRoutes(page, {
      // G16-1 has a played match but squad is not ready yet
      otherSquad: { ready: false, home: [], away: [] },
    });
    await openG162Card(page);

    await page.waitForTimeout(2000);
    await expect(page.getByText('Spillerdeling mellom lag')).not.toBeVisible();
  });

  test('viser ikke seksjonen når nåværende kamptroppkort ikke har registrert tropp', async ({ page }) => {
    await mockRoutes(page, {
      // Current match's squad is not ready
      currentSquad: { ready: false, home: [], away: [] },
    });
    await page.goto(APP);
    await page.getByRole('button', { name: /Nesodden G16-2/i }).first().click();
    await expect(page.getByText('CrossTestMotstander')).toBeVisible({ timeout: 8000 });
    await page.locator('button').filter({ hasText: 'CrossTestMotstander' }).first().click();

    // Squad not ready → shows placeholder message, not player list
    await expect(page.getByText('Kamptropp ikke klar enda')).toBeVisible({ timeout: 8000 });
    // CrossTeamPlayers must never appear in this state
    await expect(page.getByText('Spillerdeling mellom lag')).not.toBeVisible();
  });

  test('håndterer Nesodden som bortelag korrekt — finner spillere i squad.away', async ({ page }) => {
    // G16-2 plays away (Nesodden is away team)
    const awayMatch = {
      ...G162_UPCOMING,
      homeTeam: 'CrossTestMotstander', homeTeamId: '99999', homeClubId: '9999',
      awayTeam: 'Nesodden 2',          awayTeamId: G16_2,   awayClubId: '82',
      isHome: false,
    };
    await mockRoutes(page, {
      g162Matches: [awayMatch],
      // Since Nesodden is away → squad.away contains Nesodden players
      currentSquad: { ready: true, home: [OPPONENT], away: [SHARED, UNIQUE] },
      // G16-1's last match: Nesodden home → squad.home
      otherSquad:   { ready: true, home: [SHARED_IN_OTHER], away: [] },
    });

    await page.goto(APP);
    await page.getByRole('button', { name: /Nesodden G16-2/i }).first().click();
    await expect(page.getByText('CrossTestMotstander')).toBeVisible({ timeout: 8000 });
    await page.locator('button').filter({ hasText: 'CrossTestMotstander' }).first().click();
    await expect(page.getByText('Unik, Spiller')).toBeVisible({ timeout: 8000 });

    const section = page.getByText('Spillerdeling mellom lag');
    await expect(section).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();
  });

});
