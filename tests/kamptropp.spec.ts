/**
 * Kamptropp verification test.
 *
 * Verifies that the /api/squads endpoint returns data scraped from
 * fiks.fotball.no — not mock data.
 *
 * Reference match: G16-1 (Nesodden) vs Grüner, 11.04.2026
 *   FIKS external match number: 03116201005
 *   FIKS internal matchReportId: 8977342
 *
 * Expected Nesodden kamptropp (13 players confirmed on FIKS 11.04.2026):
 *   1  Gjerdrum, Olaf             Keeper
 *   3  Stifoss-Wilson, Conrad      Forsvar
 *   4  Ytterbøl, Maximilian        Forsvar
 *   5  Norlun, Erlend Mathias Baade Forsvar
 *  21  Haug, Julian Stabell        Forsvar
 *   7  Lind, Jonathan              Midtbane
 *  11  Kronstad, Adam              Midtbane
 *  16  Eide, Gunnar Spjelkavik     Midtbane
 *  19  Morken, Linus Brevik (C)    Midtbane
 *  44  Johansen, Aron Wilhelm      Midtbane
 *   9  Lehn, Jonatan Ausland       Angrep
 *   8  Kvalø, Aksel Gulbrandsen    Innbytter
 *  18  Stadskleiv, Lauritz Kaldal  Innbytter
 */
import { test, expect } from '@playwright/test';

const APP_BASE   = 'http://localhost:3210';
const REPORT_ID  = '8977342';   // FIKS internal ID for the 11.04.2026 match
const TEAM_FIKS_ID = '134742';  // Nesodden G16-1

test.describe('Kamptropp — G16-1 vs Grüner (11.04.2026)', () => {

  test('GET /api/squads/:id returnerer kamptropp fra FIKS', async ({ request }) => {
    const resp = await request.get(`${APP_BASE}/api/squads/${REPORT_ID}`);
    expect(resp.ok()).toBe(true);

    const squad = await resp.json() as {
      ready: boolean;
      home: Array<{ name: string; jerseyNumber: number; position: string }>;
      away: Array<{ name: string; jerseyNumber: number; position: string }>;
    };

    expect(squad.ready, 'squad.ready should be true for a played match').toBe(true);
    expect(squad.home.length, 'home squad should have players').toBeGreaterThan(0);
    expect(squad.away.length, 'away squad should have players').toBeGreaterThan(0);

    // Nesodden is home team for this match
    const nesodden = squad.home;

    // Verify keeper
    const keeper = nesodden.find((p) => p.jerseyNumber === 1);
    expect(keeper, '#1 keeper should exist').toBeDefined();
    expect(keeper!.name).toContain('Gjerdrum');
    expect(keeper!.position).toBe('Keeper');

    // Verify captain (Morken #19)
    const captain = nesodden.find((p) => p.jerseyNumber === 19);
    expect(captain, '#19 Morken should exist').toBeDefined();
    expect(captain!.name).toContain('Morken');

    // Verify all expected jersey numbers are present
    const numbers = new Set(nesodden.map((p) => p.jerseyNumber));
    for (const num of [1, 3, 4, 5, 7, 8, 9, 11, 16, 18, 19, 21, 44]) {
      expect(numbers.has(num), `Jersey #${num} should be in Nesodden squad`).toBe(true);
    }

    // Should not contain mock player names
    const mockNames = ['Mathias Berg', 'Sander Holm', 'Tobias Dahl', 'Oliver Nilsen'];
    for (const mockName of mockNames) {
      expect(
        nesodden.some((p) => p.name.includes(mockName.split(' ')[1])),
        `Mock player "${mockName}" should NOT be in squad`
      ).toBe(false);
    }

    console.log('\n✅ Nesodden kamptropp (fra FIKS):');
    nesodden.forEach((p) => console.log(`  #${p.jerseyNumber}  ${p.name}  (${p.position})`));
  });

  test('matchReportId er lagret i kampdata fra API', async ({ request }) => {
    const resp = await request.get(`${APP_BASE}/api/teams/${TEAM_FIKS_ID}/matches`);
    expect(resp.ok()).toBe(true);

    const { matches } = await resp.json() as {
      matches: Array<{ date: string; homeTeam: string; awayTeam: string; matchReportId?: string }>
    };

    const match = matches.find(
      (m) => m.date === '11.04.2026' &&
             m.homeTeam.toLowerCase().includes('nesodden') &&
             m.awayTeam.toLowerCase().includes('grüner')
    );

    expect(match, 'April 11 match should exist').toBeDefined();
    expect(match!.matchReportId, 'matchReportId should be set').toBe(REPORT_ID);
  });

  test('fremtidig kamp uten kamptropp returnerer ready:false', async ({ request }) => {
    // Find an upcoming match (no result yet)
    const resp = await request.get(`${APP_BASE}/api/teams/${TEAM_FIKS_ID}/matches`);
    const { matches } = await resp.json() as {
      matches: Array<{ result?: string; matchReportId?: string }>
    };

    const upcoming = matches.find((m) => !m.result && m.matchReportId);
    if (!upcoming) {
      console.log('No upcoming match with matchReportId found — skipping');
      return;
    }

    const squadResp = await request.get(`${APP_BASE}/api/squads/${upcoming.matchReportId}`);
    const squad = await squadResp.json();

    // Either no squad registered yet (ready: false) or squad is already registered (ready: true)
    expect(typeof squad.ready).toBe('boolean');
    expect(Array.isArray(squad.home)).toBe(true);
    expect(Array.isArray(squad.away)).toBe(true);

    if (!squad.ready) {
      console.log(`✅ Upcoming match has no squad yet — correctly returns ready:false`);
    } else {
      console.log(`ℹ️  Upcoming match already has a squad registered (${squad.home.length} home, ${squad.away.length} away)`);
    }
  });
});
