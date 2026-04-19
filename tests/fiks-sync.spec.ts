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
 *
 * Opponent sync pass (after Nesodden sync):
 *   – Discovers all opponent clubs from Nesodden match logo URLs
 *   – For each club: visits /FiksWeb/Club/View/{clubId} to find G16 teams
 *   – Scrapes those teams' full match schedules
 *   – Scrapes squads for played matches within the last 60 days
 *     (incremental: skips matchReportIds already in squads map with ready=true)
 *   – Stores results in opponentMatches / opponentTeams in synced-data.json
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { G16_TEAMS } from '../lib/mockData';
import { writeSyncedData, readSyncedData } from '../lib/fiksSync';
import type { Match, Player, Squad, Team, OpponentTeam } from '../lib/types';

const FIKS_BASE = 'https://fiks.fotball.no';
const NESODDEN_CLUB_ID = '82';
const OPPONENT_SQUAD_LOOKBACK_DAYS = 60;

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

function extractClubIdFromLogoUrl(url: string): string {
  return url.match(/clublogos\/(\d+)/)?.[1] ?? '';
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

// ── Opponent team match scraping ──────────────────────────────────────────────

/**
 * Scrape matches for an opponent team. Returns matches and the division string
 * found on the page (empty string if not found).
 */
async function scrapeOpponentTeamMatches(
  page: Page,
  teamFiksId: string,
): Promise<{ matches: Match[]; division: string }> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Team/View/${teamFiksId}?accordionHistory=collapseTwo`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  // Try to extract division/series name from the accordion heading or page title
  const division = await page.evaluate(() => {
    const candidates = [
      '#headingTwo a',
      '#headingTwo .panel-title',
      '#headingTwo h3',
      '#headingTwo h4',
      '#headingTwo button',
      '.breadcrumb li:nth-last-child(2) a',
    ];
    for (const sel of candidates) {
      const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
      if (text.length > 3 && /divisjon|serie|krets/i.test(text)) return text;
    }
    // Fall back to anything in headingTwo
    for (const sel of candidates) {
      const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
      if (text.length > 3) return text;
    }
    return '';
  });

  const rows = page.locator('#collapseTwo table tbody tr');
  const count = await rows.count();

  const matches: Match[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    if (await cells.count() !== 8) continue;

    const c = await Promise.all(Array.from({ length: 8 }, (_, j) => cells.nth(j).innerText()));
    const cleaned = c.map((t) => t.trim().replace(/\s+/g, ' '));

    const href = await cells.nth(0).locator('a').getAttribute('href').catch(() => null);
    const matchReportId = href?.match(/MatchReport\/View\/(\d+)/)?.[1] ?? '';

    const homeTeam = cleaned[2];
    const awayTeam = cleaned[3];
    const { date, time } = parseDateTime(cleaned[4]);
    const venue    = cleaned[5];
    const result   = /\d/.test(cleaned[6]) ? cleaned[6] : undefined;

    if (!homeTeam || !awayTeam || !date) continue;

    matches.push({
      matchId:       `fiks-${cleaned[0]}`,
      matchReportId,
      date,
      time,
      homeTeam,
      homeTeamId:    '', // filled after logo pass
      homeClubId:    '',
      homeLogoUrl:   '',
      awayTeam,
      awayTeamId:    '', // filled after logo pass
      awayClubId:    '',
      awayLogoUrl:   '',
      venue,
      tournament:    '',
      isHome:        false, // filled after logo pass
      result,
    });
  }

  return { matches, division };
}

// ── Club page scraping ─────────────────────────────────────────────────────────

/**
 * Scrape a FIKS club page to find all G16 team links.
 * Returns array of { fiksId, name } for each G16 team found.
 */
async function scrapeClubG16Teams(
  page: Page,
  clubId: string,
): Promise<Array<{ fiksId: string; name: string }>> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Club/View/${clubId}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const teams: Array<{ fiksId: string; name: string }> = [];
    document.querySelectorAll('a[href*="/FiksWeb/Team/View/"]').forEach((el) => {
      const href = (el as HTMLAnchorElement).href;
      const name = (el as HTMLElement).innerText.trim();
      const id   = href.match(/Team\/View\/(\d+)/)?.[1];
      // Match G16 / Gutter 16 / G 16 / G-16 / Gutter-16 etc.
      if (id && /g[\s\-]?16|gutter[\s\-]?16/i.test(name)) {
        teams.push({ fiksId: id, name });
      }
    });
    // Deduplicate by fiksId
    return [...new Map(teams.map((t) => [t.fiksId, t])).values()];
  });
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

// ── Logo / club-ID pass ───────────────────────────────────────────────────────

/**
 * Given a clubIdByName map (team name → club ID), apply club IDs and logo URLs
 * to all matches in the provided match arrays that are still missing them.
 * Also applies homeTeamId / awayTeamId for the known team (if provided).
 */
function applyClubIds(
  matchArrays: Match[][],
  clubIdByName: Record<string, string>,
  knownTeamFiksId?: string,
  knownClubId?: string,
): void {
  for (const matches of matchArrays) {
    for (const m of matches) {
      const homeKey = m.homeTeam.toLowerCase();
      const awayKey = m.awayTeam.toLowerCase();

      if (!m.homeClubId && clubIdByName[homeKey]) {
        m.homeClubId = clubIdByName[homeKey];
      }
      if (!m.awayClubId && clubIdByName[awayKey]) {
        m.awayClubId = clubIdByName[awayKey];
      }
      if (!m.homeLogoUrl && m.homeClubId) {
        m.homeLogoUrl = `https://images.fotball.no/clublogos/${m.homeClubId}.png`;
      }
      if (!m.awayLogoUrl && m.awayClubId) {
        m.awayLogoUrl = `https://images.fotball.no/clublogos/${m.awayClubId}.png`;
      }

      // Set teamId for the known team and isHome flag
      if (knownTeamFiksId && knownClubId) {
        if (m.homeClubId === knownClubId && !m.homeTeamId) {
          m.homeTeamId = knownTeamFiksId;
          m.isHome = true;
        } else if (m.awayClubId === knownClubId && !m.awayTeamId) {
          m.awayTeamId = knownTeamFiksId;
          m.isHome = false;
        }
      }
    }
  }
}

// ── Main sync test ────────────────────────────────────────────────────────────

test('sync data from fiks.fotball.no', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000); // 10 minutes (opponent pass adds significant time on first run)

  // Load existing synced data for incremental squad skipping
  const existing = readSyncedData();

  await page.goto(`${FIKS_BASE}/FiksWeb/`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  console.log(`\n[sync] Authenticated. URL: ${page.url()}`);

  const matches:  Record<string, Match[]>  = {};
  const players:  Record<string, Player[]> = {};
  const squads:   Record<string, Squad>    = { ...(existing?.squads ?? {}) };

  const opponentMatches: Record<string, Match[]>    = { ...(existing?.opponentMatches ?? {}) };
  const opponentTeams:   Record<string, OpponentTeam> = { ...(existing?.opponentTeams ?? {}) };

  // ── 1. Nesodden teams ────────────────────────────────────────────────────────
  for (const team of G16_TEAMS) {
    console.log(`\n[sync] ── ${team.name} ──`);

    matches[team.fiksId] = await scrapeMatches(page, team);
    console.log(`  → ${matches[team.fiksId].length} matches`);

    const now     = Date.now();
    const week_ms = 7 * 24 * 60 * 60 * 1000;
    let squadCount = 0;

    for (const match of matches[team.fiksId]) {
      if (!match.matchReportId) continue;

      const [d, mo, y] = match.date.split('.').map(Number);
      const matchTime  = new Date(y, mo - 1, d).getTime();
      const isPlayed   = match.result != null;
      const isNearFuture = matchTime + 48 * 60 * 60 * 1000 > now && matchTime - now <= week_ms;

      if (!isPlayed && !isNearFuture) {
        if (!squads[match.matchReportId]) {
          squads[match.matchReportId] = { ready: false, home: [], away: [] };
        }
        continue;
      }

      // Incremental: skip squads already scraped and ready
      if (squads[match.matchReportId]?.ready) {
        squadCount++;
        continue;
      }

      process.stdout.write(`  [squad] ${match.date} ${match.homeTeam} vs ${match.awayTeam} … `);
      const squad = await scrapeSquad(page, match.matchReportId);
      const { homeClubId, awayClubId, ...squadData } = squad;
      squads[match.matchReportId] = squadData;

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

    players[team.fiksId] = await scrapePlayers(page, team);
    console.log(`  → ${players[team.fiksId].length} roster players`);
  }

  // ── 2. Logo pass for Nesodden matches ────────────────────────────────────────
  // Build teamName → clubId map from logo URLs already known
  const clubIdByName: Record<string, string> = {};
  for (const teamMatches of Object.values(matches)) {
    for (const m of teamMatches) {
      if (m.homeClubId) clubIdByName[m.homeTeam.toLowerCase()] = m.homeClubId;
      if (m.awayClubId) clubIdByName[m.awayTeam.toLowerCase()] = m.awayClubId;
      const homeId = extractClubIdFromLogoUrl(m.homeLogoUrl);
      const awayId = extractClubIdFromLogoUrl(m.awayLogoUrl);
      if (homeId) clubIdByName[m.homeTeam.toLowerCase()] = homeId;
      if (awayId) clubIdByName[m.awayTeam.toLowerCase()] = awayId;
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
    const visited = new Set<string>();
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

  // Apply clubIdByName to every Nesodden match — updates logo URLs AND club IDs
  applyClubIds(Object.values(matches), clubIdByName);

  // ── 3. Opponent sync pass ────────────────────────────────────────────────────
  // Collect all unique opponent club IDs from Nesodden matches
  const opponentClubIds = new Set<string>();
  for (const teamMatches of Object.values(matches)) {
    for (const m of teamMatches) {
      if (m.homeClubId && m.homeClubId !== NESODDEN_CLUB_ID) opponentClubIds.add(m.homeClubId);
      if (m.awayClubId && m.awayClubId !== NESODDEN_CLUB_ID) opponentClubIds.add(m.awayClubId);
    }
  }

  console.log(`\n[sync] ── Opponent pass: ${opponentClubIds.size} opponent clubs ──`);

  const now60 = Date.now();
  const lookback_ms = OPPONENT_SQUAD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  for (const clubId of opponentClubIds) {
    console.log(`\n[sync]   Club ${clubId}:`);

    // Discover G16 teams for this club
    const g16Teams = await scrapeClubG16Teams(page, clubId);
    if (g16Teams.length === 0) {
      console.log(`    → no G16 teams found on club page`);
      continue;
    }
    console.log(`    → found ${g16Teams.length} G16 team(s): ${g16Teams.map(t => t.name).join(', ')}`);

    for (const { fiksId: teamFiksId, name: teamDisplayName } of g16Teams) {
      // Skip Nesodden's own teams
      if (G16_TEAMS.some((t) => t.fiksId === teamFiksId)) continue;

      process.stdout.write(`    [opp-team] ${teamDisplayName} (${teamFiksId}) … `);

      // Scrape the team's matches and discover division
      const { matches: teamMatches, division } = await scrapeOpponentTeamMatches(page, teamFiksId);
      console.log(`${teamMatches.length} matches, division: "${division}"`);

      // Store/update opponent team metadata
      opponentTeams[teamFiksId] = {
        fiksId: teamFiksId,
        name: teamDisplayName,
        clubId,
        division,
      };

      // Build local clubIdByName from any already-known data for this club's matches
      const localClubIdByName: Record<string, string> = { ...clubIdByName };

      // Collect match report IDs still needing club ID resolution
      const needClubIdResolution: Map<string, Match> = new Map();
      for (const m of teamMatches) {
        if (!m.matchReportId) continue;
        for (const name of [m.homeTeam, m.awayTeam]) {
          const key = name.toLowerCase();
          if (!localClubIdByName[key] && !needClubIdResolution.has(key)) {
            needClubIdResolution.set(key, m);
          }
        }
      }

      // Resolve missing club IDs via match report pages
      // (only for played matches with squads we'll scrape anyway, or at most a few extra)
      const resolutionVisited = new Set<string>();
      for (const [, m] of needClubIdResolution) {
        if (!m.matchReportId || resolutionVisited.has(m.matchReportId)) continue;
        // Only resolve if we actually plan to scrape this match's squad (within lookback)
        const [d, mo, y] = m.date.split('.').map(Number);
        const matchTime = new Date(y, mo - 1, d).getTime();
        const isPlayed = m.result != null;
        const inLookback = isPlayed && now60 - matchTime <= lookback_ms;
        if (!inLookback) continue;
        if (squads[m.matchReportId]?.ready) continue; // already scraped → skip resolution

        resolutionVisited.add(m.matchReportId);
        // Club IDs will be resolved during the squad scrape below
      }

      // Scrape squads for recently played matches (incremental: skip already-ready squads)
      let squadCount = 0;
      for (const match of teamMatches) {
        if (!match.matchReportId || !match.result) continue;

        const [d, mo, y] = match.date.split('.').map(Number);
        const matchTime = new Date(y, mo - 1, d).getTime();
        if (now60 - matchTime > lookback_ms) continue; // outside lookback window

        // Incremental guard
        if (squads[match.matchReportId]?.ready) {
          squadCount++;
          // Still need to fill logo/club IDs for this match
          localClubIdByName[match.homeTeam.toLowerCase()] ||= extractClubIdFromLogoUrl(match.homeLogoUrl);
          localClubIdByName[match.awayTeam.toLowerCase()] ||= extractClubIdFromLogoUrl(match.awayLogoUrl);
          continue;
        }

        process.stdout.write(`      [squad] ${match.date} ${match.homeTeam} vs ${match.awayTeam} … `);
        const squad = await scrapeSquad(page, match.matchReportId);
        const { homeClubId: hId, awayClubId: aId, ...squadData } = squad;
        squads[match.matchReportId] = squadData;

        if (hId) {
          match.homeLogoUrl = `https://images.fotball.no/clublogos/${hId}.png`;
          localClubIdByName[match.homeTeam.toLowerCase()] = hId;
        }
        if (aId) {
          match.awayLogoUrl = `https://images.fotball.no/clublogos/${aId}.png`;
          localClubIdByName[match.awayTeam.toLowerCase()] = aId;
        }

        if (squad.ready) {
          squadCount++;
          console.log(`✓ home:${squad.home.length} away:${squad.away.length}`);
        } else {
          console.log('ikke klar enda');
        }
      }

      // Apply club IDs + set teamFiksId / isHome on all matches for this team
      applyClubIds([teamMatches], localClubIdByName, teamFiksId, clubId);

      // Merge into global clubIdByName for future teams
      Object.assign(clubIdByName, localClubIdByName);

      opponentMatches[teamFiksId] = teamMatches;
      console.log(`      → ${squadCount} squads scraped/cached`);
    }
  }

  writeSyncedData({
    lastSynced: new Date().toISOString(),
    matches,
    players,
    squads,
    opponentMatches,
    opponentTeams,
  });
  console.log('\n[sync] ✅ Data saved to data/synced-data.json');
});
