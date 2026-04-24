/**
 * Standings accuracy: for every team in the app that has a tournament with
 * standings on fotball.no, verify the app's cached standings match.
 *
 * Run via:  npx playwright test --project=standings-accuracy
 *
 * Requires: app server on port 3210 (no FIKS credentials needed)
 */
import { test, expect } from '@playwright/test';
import { scrapeTournamentStandings } from '../lib/scraper';

const APP_BASE = 'http://localhost:3210';

interface AppTeam {
  fiksId: string;
  name: string;
  tournamentFiksId?: string;
}

interface StandingsEntry {
  position: number;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

test.describe('Standings accuracy', () => {
  let teamsWithTournament: AppTeam[] = [];

  test.beforeAll(async ({ request }) => {
    const resp = await request.get(`${APP_BASE}/api/clubs/82/teams`);
    const data = await resp.json() as { teams: Record<string, AppTeam[]> };
    const allTeams = Object.values(data.teams).flat().filter((t) => !!t.tournamentFiksId);

    // Only test teams that have synced match data
    for (const t of allTeams) {
      const r = await request.get(`${APP_BASE}/api/teams/${t.fiksId}/matches`);
      const body = await r.json() as { matches: unknown[] };
      if (body.matches?.length > 0) teamsWithTournament.push(t);
    }
  });

  test('at least one team has a tournamentFiksId', () => {
    expect(teamsWithTournament.length).toBeGreaterThan(0);
  });

  test('app standings match fotball.no for all teams', async ({ request }) => {
    test.setTimeout(60_000);

    // Deduplicate tournaments — multiple teams can share the same tournament
    const tournamentMap = new Map<string, AppTeam>(); // tournamentFiksId → first team
    for (const t of teamsWithTournament) {
      const tid = t.tournamentFiksId!;
      if (!tournamentMap.has(tid)) tournamentMap.set(tid, t);
    }

    // Scrape all tournament standings from fotball.no in parallel
    const liveResults = new Map<string, Awaited<ReturnType<typeof scrapeTournamentStandings>>>();
    await Promise.all(
      [...tournamentMap.keys()].map(async (tid) => {
        const result = await scrapeTournamentStandings(tid);
        liveResults.set(tid, result);
      }),
    );

    const mismatches: string[] = [];
    const skipped: string[] = [];

    for (const [tournamentFiksId, team] of tournamentMap) {
      const live = liveResults.get(tournamentFiksId)!;

      if (live.standings.length === 0) {
        skipped.push(`${team.name} (${tournamentFiksId}): no standings on fotball.no`);
        continue;
      }

      // Get app standings
      const resp = await request.get(`${APP_BASE}/api/teams/${team.fiksId}/stats`);

      if (!resp.ok()) {
        mismatches.push(`${team.name}: /api/teams/${team.fiksId}/stats returned ${resp.status()}`);
        continue;
      }

      const appStats = await resp.json() as { standings: StandingsEntry[]; tournament: string };

      if (appStats.standings.length === 0) {
        mismatches.push(`${team.name}: app has no standings but fotball.no has ${live.standings.length} teams`);
        continue;
      }

      // Compare team count
      if (appStats.standings.length !== live.standings.length) {
        mismatches.push(
          `${team.name} (${live.tournament}): team count differs — app: ${appStats.standings.length}, fotball.no: ${live.standings.length}`,
        );
        continue;
      }

      // Compare each row: position, team name, points, played, won, drawn, lost
      const rowDiffs: string[] = [];
      for (let i = 0; i < live.standings.length; i++) {
        const liveRow = live.standings[i];
        const appRow = appStats.standings[i];

        const diffs: string[] = [];
        if (appRow.position !== liveRow.position) diffs.push(`pos ${appRow.position}≠${liveRow.position}`);
        if (appRow.teamName !== liveRow.teamName) diffs.push(`name "${appRow.teamName}"≠"${liveRow.teamName}"`);
        if (appRow.points !== liveRow.points) diffs.push(`pts ${appRow.points}≠${liveRow.points}`);
        if (appRow.played !== liveRow.played) diffs.push(`P ${appRow.played}≠${liveRow.played}`);
        if (appRow.won !== liveRow.won) diffs.push(`W ${appRow.won}≠${liveRow.won}`);
        if (appRow.drawn !== liveRow.drawn) diffs.push(`D ${appRow.drawn}≠${liveRow.drawn}`);
        if (appRow.lost !== liveRow.lost) diffs.push(`L ${appRow.lost}≠${liveRow.lost}`);

        if (diffs.length > 0) rowDiffs.push(`row ${i + 1}: ${diffs.join(', ')}`);
      }

      if (rowDiffs.length > 0) {
        mismatches.push(`${team.name} (${live.tournament}):\n    ${rowDiffs.join('\n    ')}`);
      } else {
        console.log(`  ✓ ${team.name}: ${live.standings.length} teams match (${live.tournament})`);
      }
    }

    if (skipped.length > 0) {
      console.log(`  Skipped (no standings on fotball.no):`);
      skipped.forEach((s) => console.log(`    ${s}`));
    }

    expect(
      mismatches,
      `Standings mismatches:\n${mismatches.join('\n')}`,
    ).toHaveLength(0);
  });
});
