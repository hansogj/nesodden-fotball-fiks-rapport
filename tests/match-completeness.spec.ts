/**
 * Match completeness: for every team in the app, verify that the app's match list
 * contains all matches listed on the FIKS team page.
 *
 * Run via:  npx playwright test --project=match-completeness
 *
 * Requires: FIKS auth (.auth/fiks.json) + app server on port 3210
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const FIKS_BASE = 'https://fiks.fotball.no';
const APP_BASE = 'http://localhost:3210';

interface FiksMatch {
  homeTeam: string;
  awayTeam: string;
  date: string;
  result?: string;
}

/**
 * Extract matches from the FIKS 8-column match table.
 * Columns: [0] matchId, [1] round, [2] home, [3] away, [4] dateTime, [5] venue, [6] score, [7] "Endre"
 */
async function extractFiksMatches(page: Page, fiksId: string): Promise<FiksMatch[]> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Team/View/${fiksId}?accordionHistory=collapseTwo`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const rows = page.locator('#collapseTwo table tbody tr');
  const count = await rows.count();
  const matches: FiksMatch[] = [];

  for (let i = 0; i < count; i++) {
    const cells = rows.nth(i).locator('td');
    if (await cells.count() !== 8) continue;

    const texts = await Promise.all(
      Array.from({ length: 8 }, (_, j) => cells.nth(j).innerText()),
    );
    const c = texts.map((t) => t.trim().replace(/\s+/g, ' '));

    const homeTeam = c[2];
    const awayTeam = c[3];
    const date = c[4].split(' ')[0]; // "dd.mm.yyyy HH:MM" → "dd.mm.yyyy"
    const result = /\d/.test(c[6]) ? c[6] : undefined;

    if (!homeTeam || !awayTeam || !date) continue;
    matches.push({ homeTeam, awayTeam, date, result });
  }

  return matches;
}

/** Normalise team name for comparison — strips numbering suffixes and whitespace */
function norm(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

interface AppTeam {
  fiksId: string;
  name: string;
  division: string;
}

test.describe('Match completeness', () => {
  let teams: AppTeam[] = [];

  test.beforeAll(async ({ request }) => {
    const resp = await request.get(`${APP_BASE}/api/clubs/82/teams`);
    const data = await resp.json() as { teams: Record<string, AppTeam[]> };
    teams = Object.values(data.teams).flat();
    // Only test teams that have synced data
    const withData: AppTeam[] = [];
    for (const t of teams) {
      const r = await request.get(`${APP_BASE}/api/teams/${t.fiksId}/matches`);
      const body = await r.json() as { matches: unknown[] };
      if (body.matches?.length > 0) withData.push(t);
    }
    teams = withData;
  });

  test('at least one team has synced data', () => {
    expect(teams.length, 'No teams with synced match data found').toBeGreaterThan(0);
  });

  test('all teams with synced data have complete match lists', async ({ page, request }) => {
    test.setTimeout(120_000);

    const failures: string[] = [];

    for (const team of teams) {
      // 1. Get matches from FIKS
      let fiksMatches: FiksMatch[];
      try {
        fiksMatches = await extractFiksMatches(page, team.fiksId);
      } catch (e) {
        console.log(`  ⚠ ${team.name}: FIKS page failed (${(e as Error).message.split('\n')[0]}), skipping`);
        continue;
      }

      if (fiksMatches.length === 0) {
        console.log(`  ⚠ ${team.name}: no matches on FIKS page, skipping`);
        continue;
      }

      // 2. Get matches from app
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches: appMatches } = await resp.json() as {
        matches: Array<{ date: string; homeTeam: string; awayTeam: string; result?: string }>;
      };

      // 3. Compare: every FIKS match should exist in the app
      const missing: string[] = [];
      for (const fm of fiksMatches) {
        const found = appMatches.some(
          (am) => norm(am.homeTeam) === norm(fm.homeTeam) && norm(am.awayTeam) === norm(fm.awayTeam),
        );
        if (!found) {
          missing.push(`${fm.date}: ${fm.homeTeam} vs ${fm.awayTeam}`);
        }
      }

      if (missing.length > 0) {
        failures.push(`${team.name} (${team.fiksId}): missing ${missing.length}/${fiksMatches.length}\n    ${missing.join('\n    ')}`);
      }

      const status = missing.length === 0
        ? `✓ ${fiksMatches.length}/${fiksMatches.length}`
        : `✗ missing ${missing.length}/${fiksMatches.length}`;
      console.log(`  ${team.name}: ${status}`);
    }

    expect(failures, `Match completeness failures:\n${failures.join('\n')}`).toHaveLength(0);
  });
});
