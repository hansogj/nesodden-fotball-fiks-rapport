/**
 * Sync test: logs into fiks.fotball.no, scrapes real match data + kamptropp
 * for all three G16 teams, and writes the result to data/synced-data.json.
 *
 * Run via:  npm run sync
 *   or:     npx playwright test --project=sync
 *
 * FIKS match table layout (8-column rows):
 *   [0] matchId (link href = /FiksWeb/MatchReport/View/{internalId})
 *   [1] round   [2] homeTeam  [3] awayTeam
 *   [4] dateTime [5] venue    [6] score    [7] "Endre"
 *
 * Kamptropp page: /FiksWeb/MatchReport/View/{internalId}
 *   – Click "Hjemmelag" / "Bortelag" buttons to load squad
 *   – .player-category h6           → position header
 *   – .player-row-read-only          → one row per player
 *     p:first-child                  → jersey number
 *     p:last-child span:first-child  → name (+ FIKS code in parens)
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { G16_TEAMS } from '../lib/mockData';
import { writeSyncedData } from '../lib/fiksSync';
import type { Match, Player, Squad, Team } from '../lib/types';

const FIKS_BASE = 'https://fiks.fotball.no';

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDateTime(raw: string): { date: string; time: string } {
  const parts = raw.trim().split(' ');
  return { date: parts[0] ?? raw, time: parts[1] ?? '' };
}

const POSITION_MAP: Record<string, string> = {
  keeper:     'Keeper',
  goalkeeper: 'Keeper',
  forsvar:    'Forsvar',
  back:       'Forsvar',
  defender:   'Forsvar',
  midtbane:   'Midtbane',
  midfielder: 'Midtbane',
  angrep:     'Angrep',
  forward:    'Angrep',
  striker:    'Angrep',
  innbytter:  'Innbytter',
  substitute: 'Innbytter',
};

function normalisePosition(raw: string): string {
  const lower = raw.toLowerCase().trim();
  for (const [key, val] of Object.entries(POSITION_MAP)) {
    if (lower.includes(key)) return val;
  }
  return raw || 'Ukjent';
}

// ── Match scraping ────────────────────────────────────────────────────────────

async function scrapeMatches(page: Page, team: Team): Promise<Match[]> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Team/View/${team.fiksId}?accordionHistory=collapseTwo`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  console.log(`  [matches] Page: "${await page.title()}"`);

  const rows = page.locator('#collapseTwo table tbody tr');
  const count = await rows.count();
  console.log(`  [matches] Total rows: ${count}`);

  const matches: Match[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    if (await cells.count() !== 8) continue;

    const c = await Promise.all(Array.from({ length: 8 }, (_, j) => cells.nth(j).innerText()));
    const cleaned = c.map((t) => t.trim().replace(/\s+/g, ' '));

    // Extract internal match report ID from the link in cell[0]
    const href = await cells.nth(0).locator('a').getAttribute('href').catch(() => null);
    const matchReportId = href?.match(/MatchReport\/View\/(\d+)/)?.[1] ?? '';

    const matchId  = cleaned[0];
    const homeTeam = cleaned[2];
    const awayTeam = cleaned[3];
    const { date, time } = parseDateTime(cleaned[4]);
    const venue    = cleaned[5];
    const result   = /\d/.test(cleaned[6]) ? cleaned[6] : undefined;

    if (!homeTeam || !awayTeam || !date) continue;

    const isHome = homeTeam.toLowerCase().includes('nesodden');

    matches.push({
      matchId:       `fiks-${matchId}`,
      matchReportId,
      date,
      time,
      homeTeam,
      homeTeamId:    isHome ? team.fiksId : '',
      homeClubId:    isHome ? team.clubFiksId : '',
      homeLogoUrl:   isHome ? team.logoUrl : '',
      awayTeam,
      awayTeamId:    isHome ? '' : team.fiksId,
      awayClubId:    isHome ? '' : team.clubFiksId,
      awayLogoUrl:   isHome ? '' : team.logoUrl,
      venue,
      tournament:    '',
      isHome,
      result,
    });
  }

  return matches;
}

// ── Squad (kamptropp) scraping ────────────────────────────────────────────────

/** Extract all player rows from the currently visible squad panel in one JS call. */
async function extractSquadSide(page: Page): Promise<Player[]> {
  // Wait for player rows (or time out quickly for matches with no registered squad)
  await page.waitForSelector('.player-row-read-only', { timeout: 4000 }).catch(() => {});

  // Single evaluate call — avoids repeated Node↔browser roundtrips that can hang
  const raw = await page.evaluate(() => {
    const result: Array<{ name: string; jerseyNumber: number; position: string }> = [];
    let pos = 'Ukjent';
    document.querySelectorAll('.player-category, .player-row-read-only').forEach((el) => {
      if (el.classList.contains('player-category')) {
        pos = (el.querySelector('h6') as HTMLElement | null)?.innerText?.trim() ?? 'Ukjent';
      } else {
        const ps = el.querySelectorAll('p');
        // Skip top-level <p class="player-row-read-only"> error banners (no child <p>)
        if (ps.length < 2) return;

        // Jersey number: first <p> (empty when not yet assigned by team)
        const jersey = parseInt((ps[0] as HTMLElement | null)?.innerText?.trim() ?? '0') || 0;

        // Name: last <p> may contain multiple spans (warning icon, name, padding).
        // Find the span that has real text and no <i> icon inside.
        const lastP = ps[ps.length - 1] as HTMLElement;
        const nameSpan = Array.from(lastP.querySelectorAll('span')).find((s) => {
          const text = (s as HTMLElement).innerText?.trim() ?? '';
          return text.length > 2 && !(s as HTMLElement).querySelector('i');
        }) as HTMLElement | undefined;
        const name = (nameSpan?.innerText?.trim() ?? '').replace(/\s*\(.*?\)\s*$/, '').trim();

        // Accept players even without a jersey number (unregistered = number not yet assigned)
        if (name) result.push({ name, jerseyNumber: jersey, position: pos });
      }
    });
    return result;
  });

  // Only keep recognised football positions — filters out team officials
  // (Kontaktperson, Trener, Ass.trener, etc.) that FIKS admin view includes
  const footballPositions = new Set(['Keeper', 'Forsvar', 'Midtbane', 'Angrep', 'Innbytter']);
  return raw
    .map((p) => ({ ...p, position: normalisePosition(p.position) }))
    .filter((p) => footballPositions.has(p.position));
}

interface SquadWithClubs extends Squad {
  homeClubId: string;
  awayClubId: string;
}

async function scrapeSquad(page: Page, matchReportId: string): Promise<SquadWithClubs> {
  await page.goto(`${FIKS_BASE}/FiksWeb/MatchReport/View/${matchReportId}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Extract club IDs from the match report container for logo URLs
  const clubIds = await page.evaluate(() => {
    const el = document.querySelector('#matchreport-container');
    return {
      homeClubId: (el as HTMLElement | null)?.dataset?.homeClubId ?? '',
      awayClubId: (el as HTMLElement | null)?.dataset?.awayClubId ?? '',
    };
  });

  // Buttons only appear when the match has a registered squad
  const homeBtn = page.getByRole('button', { name: /hjemmelag/i }).first();
  if (await homeBtn.count() === 0) {
    return { ready: false, home: [], away: [], ...clubIds };
  }

  await homeBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const home = await extractSquadSide(page);

  const awayBtn = page.getByRole('button', { name: /bortelag/i }).first();
  await awayBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const away = await extractSquadSide(page);

  return { ready: home.length > 0 || away.length > 0, home, away, ...clubIds };
}

// ── Player roster scraping (Fotballtropp — fallback) ─────────────────────────

async function scrapePlayers(page: Page, team: Team): Promise<Player[]> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Team/View/${team.fiksId}?accordionHistory=collapseFive`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const rows  = page.locator('#TeamSquadTable_football tbody tr');
  const count = await rows.count();
  const players: Player[] = [];

  for (let i = 0; i < count; i++) {
    const cells     = rows.nth(i).locator('td');
    if (await cells.count() < 8) continue;
    const cleaned   = await Promise.all(Array.from({ length: 8 }, (_, j) => cells.nth(j).innerText()));
    const name      = cleaned[0].trim();
    const jerseyNum = parseInt(cleaned[5].trim()) || 0;
    const position  = normalisePosition(cleaned[7].trim());
    if (name && jerseyNum) players.push({ name, jerseyNumber: jerseyNum, position });
  }

  return players;
}

// ── Club-ID-only scrape (fast — no squad extraction) ─────────────────────────

async function scrapeClubIds(page: Page, matchReportId: string): Promise<{ homeClubId: string; awayClubId: string }> {
  await page.goto(`${FIKS_BASE}/FiksWeb/MatchReport/View/${matchReportId}`);
  await page.waitForSelector('#matchreport-container', { timeout: 10000 }).catch(() => {});
  return page.evaluate(() => {
    const el = document.querySelector('#matchreport-container') as HTMLElement | null;
    return {
      homeClubId: el?.dataset?.homeClubId ?? '',
      awayClubId: el?.dataset?.awayClubId ?? '',
    };
  });
}

// ── Main sync test ────────────────────────────────────────────────────────────

test('sync data from fiks.fotball.no', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000); // 3 minutes (logo pass adds ~45 s)
  await page.goto(`${FIKS_BASE}/FiksWeb/`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  console.log(`\n[sync] Authenticated. URL: ${page.url()}`);

  const matches: Record<string, Match[]>  = {};
  const players: Record<string, Player[]> = {};
  const squads:  Record<string, Squad>    = {};

  for (const team of G16_TEAMS) {
    console.log(`\n[sync] ── ${team.name} ──`);

    // 1. Matches
    matches[team.fiksId] = await scrapeMatches(page, team);
    console.log(`  → ${matches[team.fiksId].length} matches`);

    // 2. Kamptropp — only for played matches + matches within the next 7 days
    //    (squads are never registered more than a week in advance)
    const now     = Date.now();
    const week_ms = 7 * 24 * 60 * 60 * 1000;
    let squadCount = 0;

    for (const match of matches[team.fiksId]) {
      if (!match.matchReportId) continue;

      const [d, mo, y] = match.date.split('.').map(Number);
      const matchTime  = new Date(y, mo - 1, d).getTime();
      const isPlayed   = match.result != null;
      // Use midnight of the match day + 48 h so that matches played yesterday
      // evening (without a result registered yet) are still scraped for squads
      const isNearFuture = matchTime + 48 * 60 * 60 * 1000 > now && matchTime - now <= week_ms;

      if (!isPlayed && !isNearFuture) {
        squads[match.matchReportId] = { ready: false, home: [], away: [] };
        continue;
      }

      process.stdout.write(`  [squad] ${match.date} ${match.homeTeam} vs ${match.awayTeam} … `);
      const squad = await scrapeSquad(page, match.matchReportId);
      const { homeClubId, awayClubId, ...squadData } = squad;
      squads[match.matchReportId] = squadData;

      // Update logo URLs on the match using club IDs from the match report page
      if (homeClubId) match.homeLogoUrl = `https://images.fotball.no/clublogos/${homeClubId}.png`;
      if (awayClubId) match.awayLogoUrl = `https://images.fotball.no/clublogos/${awayClubId}.png`;

      if (squad.ready) {
        squadCount++;
        console.log(`✓ home:${squad.home.length} away:${squad.away.length}`);
      } else {
        console.log('ikke klar enda');
      }
    }
    console.log(`  → ${squadCount} kamptropper tilgjengelig`);

    // 3. General roster (Fotballtropp) — fallback for players endpoint
    players[team.fiksId] = await scrapePlayers(page, team);
    console.log(`  → ${players[team.fiksId].length} roster players`);
  }

  // ── Logo pass: fill in club IDs for teams not yet covered ───────────────────
  // Build a teamName → clubId map from matches already visited (have logo URLs)
  const clubIdByName: Record<string, string> = {};
  for (const teamMatches of Object.values(matches)) {
    for (const m of teamMatches) {
      const extractId = (url: string) => url.match(/clublogos\/(\d+)/)?.[1];
      if (m.homeLogoUrl) clubIdByName[m.homeTeam.toLowerCase()] = extractId(m.homeLogoUrl) ?? '';
      if (m.awayLogoUrl) clubIdByName[m.awayTeam.toLowerCase()] = extractId(m.awayLogoUrl) ?? '';
    }
  }

  // Find one representative match per team still missing a logo
  const missingRepresentative: Map<string, Match> = new Map();
  for (const teamMatches of Object.values(matches)) {
    for (const m of teamMatches) {
      if (!m.matchReportId) continue;
      for (const name of [m.homeTeam, m.awayTeam]) {
        const key = name.toLowerCase();
        if (!clubIdByName[key] && !missingRepresentative.has(key)) {
          missingRepresentative.set(key, m);
        }
      }
    }
  }

  if (missingRepresentative.size > 0) {
    console.log(`\n[sync] ── Logo pass: fetching club IDs for ${missingRepresentative.size} teams ──`);
    const visited = new Set<string>(); // matchReportId — skip already-visited pages
    for (const [, m] of missingRepresentative) {
      if (visited.has(m.matchReportId!)) continue;
      visited.add(m.matchReportId!);
      process.stdout.write(`  [logo] ${m.homeTeam} vs ${m.awayTeam} … `);
      const ids = await scrapeClubIds(page, m.matchReportId!);
      if (ids.homeClubId) clubIdByName[m.homeTeam.toLowerCase()] = ids.homeClubId;
      if (ids.awayClubId) clubIdByName[m.awayTeam.toLowerCase()] = ids.awayClubId;
      console.log(`home:${ids.homeClubId} away:${ids.awayClubId}`);
    }
  }

  // Apply clubIdByName to every match still missing a logo URL
  for (const teamMatches of Object.values(matches)) {
    for (const m of teamMatches) {
      if (!m.homeLogoUrl) {
        const id = clubIdByName[m.homeTeam.toLowerCase()];
        if (id) m.homeLogoUrl = `https://images.fotball.no/clublogos/${id}.png`;
      }
      if (!m.awayLogoUrl) {
        const id = clubIdByName[m.awayTeam.toLowerCase()];
        if (id) m.awayLogoUrl = `https://images.fotball.no/clublogos/${id}.png`;
      }
    }
  }

  writeSyncedData({ lastSynced: new Date().toISOString(), matches, players, squads });
  console.log('\n[sync] ✅ Data saved to data/synced-data.json');
});
