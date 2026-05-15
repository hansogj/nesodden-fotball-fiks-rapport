/**
 * Cross-team player detection tests.
 *
 * Verifies that CrossTeamPlayers correctly identifies players in the current
 * match's kamptropp who also appeared in a sibling team's matches.
 *
 * All API responses are mocked via page.route() — no FIKS credentials needed.
 *
 * Division hierarchy (lower number = higher level):
 *   G16-1: 'G16 2. divisjon'        → rank 2 (highest)
 *   G16-2: 'G16 3. divisjon avd 03' → rank 3
 *   G16-3: 'G16 4. divisjon avd 02' → rank 4 (lowest)
 */
import { test, expect, type Page } from '@playwright/test';

const APP = 'http://localhost:3210';

// FIKS IDs matching G16_TEAMS in lib/mockData.ts
const G16_1 = '134742';
const G16_2 = '154500';
const G16_3 = '6895';

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

// ── ClubAppearance helpers ───────────────────────────────────────────────────

/**
 * Build a ClubAppearance for a Nesodden sibling team's match.
 * The API returns these from /api/clubs/82/squads — already filtered to sibling teams only.
 */
function nesoddenAppearance(opts: {
  teamFiksId: string;
  teamName: string;
  division: string;
  isHigher: boolean;
  matchReportId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  clubSide: 'home' | 'away';
  squadPlayers: Array<{ name: string; jerseyNumber: number; position: string }>;
}) {
  return {
    matchReportId: opts.matchReportId,
    date: opts.date,
    homeTeam: opts.homeTeam,
    awayTeam: opts.awayTeam,
    teamFiksId: opts.teamFiksId,
    teamName: opts.teamName,
    division: opts.division,
    isHigher: opts.isHigher,
    clubSide: opts.clubSide,
    squad: {
      ready: true,
      home: opts.clubSide === 'home' ? opts.squadPlayers : [],
      away: opts.clubSide === 'away' ? opts.squadPlayers : [],
    },
  };
}

/** Default: G16-1 sibling appearance with SHARED_IN_OTHER player (higher level than G16-2) */
const DEFAULT_G161_APPEARANCE = nesoddenAppearance({
  teamFiksId: G16_1,
  teamName: 'Nesodden G16-1',
  division: 'G16 2. divisjon',
  isHigher: true,
  matchReportId: SQUAD_OTHER,
  date: '11.04.2026',
  homeTeam: 'Nesodden',
  awayTeam: 'Grüner',
  clubSide: 'home',
  squadPlayers: [SHARED_IN_OTHER],
});

/** G16-3 sibling appearance with SHARED_IN_OTHER player (lower level than G16-1) */
const G163_APPEARANCE_FROM_G161 = nesoddenAppearance({
  teamFiksId: G16_3,
  teamName: 'Nesodden G16-3',
  division: 'G16 4. divisjon avd 02',
  isHigher: false,
  matchReportId: SQUAD_OTHER,
  date: '11.04.2026',
  homeTeam: 'Nesodden 3',
  awayTeam: 'Haugerud 2',
  clubSide: 'home',
  squadPlayers: [SHARED_IN_OTHER],
});

// ── Route helpers ─────────────────────────────────────────────────────────────

interface RouteOpts {
  g161Matches?: unknown[];
  g162Matches?: unknown[];
  g163Matches?: unknown[];
  currentSquad?: unknown;
  nesoddenClubSquads?: unknown[];
}

async function mockRoutes(page: Page, opts: RouteOpts = {}) {
  const {
    g161Matches = [G161_PLAYED],
    g162Matches = [G162_UPCOMING],
    g163Matches = [],
    currentSquad = { ready: true, home: [SHARED, UNIQUE], away: [OPPONENT] },
    nesoddenClubSquads = [DEFAULT_G161_APPEARANCE],
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
  // Opponent side registered first (lower Playwright LIFO priority)
  await page.route('**/api/clubs/*/squads*', (r) =>
    r.fulfill({ json: [] })
  );
  // Nesodden club squads registered last (higher Playwright LIFO priority — overrides the wildcard above)
  await page.route('**/api/clubs/82/squads*', (r) =>
    r.fulfill({ json: nesoddenClubSquads })
  );
  // Silence sync status check (not relevant to cross-team tests)
  await page.route('**/api/sync', (r) =>
    r.fulfill({ json: { synced: false } })
  );
}

// ── Navigation helpers ────────────────────────────────────────────────────────

/** Navigate directly to G16-2 tab, open the mock match card, wait for squad to appear */
async function openG162Card(page: Page) {
  await page.goto(`${APP}/?ageGroup=G16&team=${G16_2}`);
  await expect(page.getByText('CrossTestMotstander')).toBeVisible({ timeout: 8000 });
  await page.locator('button').filter({ hasText: 'CrossTestMotstander' }).first().click();
  // Squad loaded when a known player name is visible
  await expect(page.getByText('Unik, Spiller')).toBeVisible({ timeout: 8000 });
}

/** Navigate directly to G16-1 tab, open the mock match card, wait for squad */
async function openG161Card(page: Page) {
  await page.goto(`${APP}/?ageGroup=G16&team=${G16_1}`);
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
    const section = page.getByText('Spillerdeling');
    await expect(section.first()).toBeVisible({ timeout: 10000 });

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
      g163Matches: [G163_PLAYED],
      currentSquad: { ready: true, home: [SHARED, UNIQUE], away: [OPPONENT] },
      nesoddenClubSquads: [G163_APPEARANCE_FROM_G161],
    });

    await openG161Card(page);

    const section = page.getByText('Spillerdeling');
    await expect(section.first()).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();

    // G16-3 is rank 3, G16-1 is rank 2 → G16-3 is LOWER level from G16-1's view
    await expect(page.getByText('lavere nivå')).toBeVisible();
  });

  test('skjuler seksjonen når ingen spillere er delt mellom lagene', async ({ page }) => {
    await mockRoutes(page, {
      // Sibling team has completely different players
      nesoddenClubSquads: [nesoddenAppearance({
        teamFiksId: G16_1,
        teamName: 'Nesodden G16-1',
        division: 'G16 2. divisjon',
        isHigher: true,
        matchReportId: SQUAD_OTHER,
        date: '11.04.2026',
        homeTeam: 'Nesodden',
        awayTeam: 'Grüner',
        clubSide: 'home',
        squadPlayers: [{ name: 'Annen, Spiller', jerseyNumber: 1, position: 'Keeper' }],
      })],
    });
    await openG162Card(page);

    // Give CrossTeamPlayers time to complete its checks
    await page.waitForTimeout(2000);
    // "Ingen spillerdeling funnet" is shown but the section should not show shared players
    await expect(page.getByText('#7 Felles, Spiller')).not.toBeVisible();
  });

  test('skjuler seksjonen når søsterlagene ikke har spilt noen kamper enda', async ({ page }) => {
    await mockRoutes(page, {
      g161Matches: [{ ...G161_UPCOMING, matchReportId: undefined }],
      g163Matches: [],
      // No sibling appearances
      nesoddenClubSquads: [],
    });
    await openG162Card(page);

    await page.waitForTimeout(2000);
    await expect(page.getByText('#7 Felles, Spiller')).not.toBeVisible();
  });

  test('skjuler seksjonen når søsterlagets siste kamptropp ikke er registrert (ready: false)', async ({ page }) => {
    await mockRoutes(page, {
      nesoddenClubSquads: [{
        ...DEFAULT_G161_APPEARANCE,
        squad: { ready: false, home: [], away: [] },
      }],
    });
    await openG162Card(page);

    await page.waitForTimeout(2000);
    await expect(page.getByText('#7 Felles, Spiller')).not.toBeVisible();
  });

  test('viser ikke seksjonen når nåværende kamptroppkort ikke har registrert tropp', async ({ page }) => {
    await mockRoutes(page, {
      // Current match's squad is not ready
      currentSquad: { ready: false, home: [], away: [] },
    });
    await page.goto(`${APP}/?ageGroup=G16&team=${G16_2}`);
    await expect(page.getByText('CrossTestMotstander')).toBeVisible({ timeout: 8000 });
    await page.locator('button').filter({ hasText: 'CrossTestMotstander' }).first().click();

    // Squad not ready → shows placeholder message, not player list
    await expect(page.getByText('Kamptropp ikke klar enda')).toBeVisible({ timeout: 8000 });
    // CrossTeamPlayers must never appear in this state
    await expect(page.getByText('#7 Felles, Spiller')).not.toBeVisible();
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
      nesoddenClubSquads: [DEFAULT_G161_APPEARANCE],
    });

    await openG162Card(page);

    const section = page.getByText('Spillerdeling');
    await expect(section.first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();
  });

  test('viser kun spillere fra siste kamp per søsterlag, ikke fra eldre kamper', async ({ page }) => {
    // A player who appeared in an older sibling match but NOT the latest
    // should NOT be listed — only the most recent prior match matters.
    const OLD_PLAYER = { name: 'Gammel, Spiller', jerseyNumber: 3, position: 'Forsvar' };

    await mockRoutes(page, {
      // OLD_PLAYER is in the current squad but NOT in the latest G16-1 match
      currentSquad: { ready: true, home: [SHARED, UNIQUE, OLD_PLAYER], away: [OPPONENT] },
      // API returns only the latest G16-1 match (which has SHARED_IN_OTHER, not OLD_PLAYER)
      nesoddenClubSquads: [DEFAULT_G161_APPEARANCE],
    });
    await openG162Card(page);

    const section = page.getByText('Spillerdeling');
    await expect(section.first()).toBeVisible({ timeout: 10000 });

    // SHARED player from the latest G16-1 match IS shown
    await expect(page.getByText('#7 Felles, Spiller')).toBeVisible();

    // OLD_PLAYER appears in the player list (current squad), but must NOT appear
    // in the spillerdeling section (which uses the "#jersey name" format)
    await expect(page.getByText('#3 Gammel, Spiller')).not.toBeVisible();
  });

});
