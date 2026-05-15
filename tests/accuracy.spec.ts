/**
 * Data-accuracy tests: compare our app's match data against fiks.fotball.no.
 *
 * Requires FIKS credentials set before running the setup step:
 *   export FIKS_EMAIL=your@email.no
 *   export FIKS_PASSWORD=yourpassword
 *
 * Run with:
 *   npx playwright test --project=fiks-setup --project=data-accuracy
 */
import { test, expect } from '@playwright/test';
import { TEAMS, fiksTeamUrl, extractFiksMatches, normaliseTeamName } from './helpers/fiks';

const APP_BASE = 'http://localhost:3210';

// Skip entire suite if no FIKS credentials were provided
test.beforeAll(async () => {
  if (!process.env.FIKS_EMAIL || !process.env.FIKS_PASSWORD) {
    test.skip();
  }
});

for (const team of TEAMS) {
  test.describe(`${team.name} (fiksId: ${team.fiksId})`, () => {
    test(`match list from app matches fiks.fotball.no`, async ({ page, request }) => {
      // 1. Fetch expected matches from FIKS
      await page.goto(fiksTeamUrl(team.fiksId));
      await page.waitForLoadState('networkidle', { timeout: 20000 });

      const fiksMatches = await extractFiksMatches(page);

      // Log what we found for debugging
      console.log(`\nFIKS matches for ${team.name}:`);
      fiksMatches.slice(0, 5).forEach((m) =>
        console.log(`  ${m.date}  ${m.homeTeam} — ${m.awayTeam}`)
      );

      expect(fiksMatches.length, `Expected matches on FIKS page for ${team.name}`).toBeGreaterThan(0);

      // 2. Fetch matches from our API
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      expect(resp.ok()).toBeTruthy();
      const { matches: appMatches } = await resp.json() as {
        matches: Array<{ date: string; homeTeam: string; awayTeam: string; result?: string }>
      };

      // 3. For each FIKS match, verify our app has a corresponding match
      const missingInApp: string[] = [];

      for (const fiksMatch of fiksMatches) {
        const normHome = normaliseTeamName(fiksMatch.homeTeam);
        const normAway = normaliseTeamName(fiksMatch.awayTeam);

        const found = appMatches.some((m) => {
          const appHome = normaliseTeamName(m.homeTeam);
          const appAway = normaliseTeamName(m.awayTeam);
          // Match on team names (date formats may differ between sources)
          return appHome === normHome && appAway === normAway;
        });

        if (!found) {
          missingInApp.push(`${fiksMatch.date}: ${fiksMatch.homeTeam} vs ${fiksMatch.awayTeam}`);
        }
      }

      if (missingInApp.length > 0) {
        console.warn(`\n⚠️  Matches on FIKS but missing in app (${team.name}):`);
        missingInApp.forEach((m) => console.warn('  ', m));
      }

      // Allow up to 2 missing (FIKS may include cup/extra matches we don't have)
      expect(
        missingInApp.length,
        `Too many FIKS matches missing in app:\n${missingInApp.join('\n')}`
      ).toBeLessThanOrEqual(2);
    });

    test(`Nesodden appears on both sides of the fixture list`, async ({ request }) => {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as {
        matches: Array<{ homeTeam: string; awayTeam: string; isHome: boolean }>
      };

      const homeMatches = matches.filter((m) => m.isHome);
      const awayMatches = matches.filter((m) => !m.isHome);

      expect(homeMatches.length, 'Should have at least one home match').toBeGreaterThan(0);
      expect(awayMatches.length, 'Should have at least one away match').toBeGreaterThan(0);
    });

    test(`all matches have valid dates in 2026`, async ({ request }) => {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as { matches: Array<{ date: string }> };

      for (const m of matches) {
        // Date should be dd.mm.yyyy format
        expect(m.date, `Invalid date format: ${m.date}`).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
        const [, , year] = m.date.split('.').map(Number);
        expect(year, `Match year should be 2026, got ${year}`).toBe(2026);
      }
    });

    test(`all matches reference Nesodden as home or away team`, async ({ request }) => {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as {
        matches: Array<{ homeTeam: string; awayTeam: string }>
      };

      for (const m of matches) {
        const involvesNesodden =
          normaliseTeamName(m.homeTeam).includes('nesodden') ||
          normaliseTeamName(m.awayTeam).includes('nesodden');

        expect(
          involvesNesodden,
          `Match does not involve Nesodden: ${m.homeTeam} vs ${m.awayTeam}`
        ).toBe(true);
      }
    });

    test(`logo URLs are reachable for all match teams`, async ({ page, request }) => {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as {
        matches: Array<{ homeLogoUrl: string; awayLogoUrl: string; homeTeam: string; awayTeam: string }>
      };

      // Check first 4 matches to avoid hammering the CDN
      for (const m of matches.slice(0, 4)) {
        for (const [url, label] of [[m.homeLogoUrl, m.homeTeam], [m.awayLogoUrl, m.awayTeam]] as const) {
          if (!url) continue;
          const logoResp = await request.get(url);
          expect(
            logoResp.status(),
            `Logo for "${label}" returned ${logoResp.status()}: ${url}`
          ).toBeLessThan(400);
        }
      }
    });
  });
}

test.describe('Cross-team checks', () => {
  test('no duplicate matchIds across teams', async ({ request }) => {
    const allIds: string[] = [];

    for (const team of TEAMS) {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as { matches: Array<{ matchId: string }> };
      allIds.push(...matches.map((m) => m.matchId));
    }

    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  test('each team has a distinct set of opponents', async ({ request }) => {
    const teamOpponents: Record<string, Set<string>> = {};

    for (const team of TEAMS) {
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/matches`);
      const { matches } = await resp.json() as {
        matches: Array<{ homeTeam: string; awayTeam: string; isHome: boolean }>
      };

      teamOpponents[team.fiksId] = new Set(
        matches.map((m) => normaliseTeamName(m.isHome ? m.awayTeam : m.homeTeam))
      );
    }

    // G16-1 and G16-3 should not share all opponents (they're in different divisions)
    const g1 = teamOpponents['134742'];
    const g3 = teamOpponents['6895'];
    const shared = [...g1].filter((o) => g3.has(o)).length;
    const maxExpectedShared = Math.min(g1.size, g3.size) / 2;

    expect(
      shared,
      `G16-1 and G16-3 share too many opponents (${shared}), suggesting wrong team IDs`
    ).toBeLessThan(maxExpectedShared);
  });
});
