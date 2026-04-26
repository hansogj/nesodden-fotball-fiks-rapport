/**
 * Sync test: logs into fiks.fotball.no, scrapes real match data + kamptropp
 * for all three G16 teams, and writes per-team files under data/teams/{ageGroup}/.
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
 * Tournament teams pass (after Nesodden sync + standings):
 *   – Uses standings data to discover ALL teams in each tournament
 *   – Scrapes each non-Nesodden team's full match schedule
 *   – Scrapes squads + events for ALL played matches (no lookback limit)
 *     (incremental: skips matchReportIds already in squads map with ready=true + events)
 *   – Stores results in data/opponents.json (matches + team metadata with tournamentFiksId)
 *
 * Sibling team discovery (for spillerdeling):
 *   – For each club with a team in a tournament, visits the club page
 *   – Finds sibling teams in the same age group (potentially in different tournaments)
 *   – Scrapes their matches + squads within the last 60 days
 *   – Enables /api/clubs/{clubId}/squads to detect cross-team player sharing
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { G16_TEAMS } from '../lib/mockData';
import {
  readTeamData, writeTeamData,
  readSquads, writeSquads,
  readClubData, writeClubData,
  readOpponents, writeOpponents,
  readStandings, writeStandings,
} from '../lib/fiksSync';
import { scrapeTournamentStandings, scrapeClubTeams, scrapeTeamMatchList } from '../lib/scraper';
import type { Match, Player, Squad, Team, OpponentTeam, MatchEvent, GoalType, CardType } from '../lib/types';

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

async function scrapeMatches(page: Page, team: Team): Promise<{ matches: Match[]; division: string }> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Team/View/${team.fiksId}?accordionHistory=collapseTwo`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  console.log(`  [matches] Page: "${await page.title()}"`);

  // Single page.evaluate() to extract division + all match rows at once
  // (per-element locator calls in loops cause multi-minute hangs on FIKS)
  const { division, rows } = await page.evaluate(() => {
    // Division
    const divCandidates = [
      '#headingTwo a', '#headingTwo .panel-title',
      '#headingTwo h3', '#headingTwo h4', '#headingTwo button',
      '.breadcrumb li:nth-last-child(2) a',
    ];
    let division = '';
    for (const sel of divCandidates) {
      const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
      if (text.length > 3 && /divisjon|serie|krets/i.test(text)) { division = text; break; }
    }
    if (!division) {
      for (const sel of divCandidates) {
        const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
        if (text.length > 3) { division = text; break; }
      }
    }

    // Match rows — also extract team page links from home/away columns for opponent ID discovery
    const rows: Array<{ cells: string[]; href: string; homeTeamHref: string; awayTeamHref: string }> = [];
    document.querySelectorAll('#collapseTwo table tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 8) return;
      const cells = Array.from(tds, (td) => (td.innerText ?? td.textContent ?? '').trim().replace(/\s+/g, ' '));
      const link = tds[0]?.querySelector('a');
      const href = link?.getAttribute('href') ?? '';
      const homeTeamHref = tds[2]?.querySelector('a[href*="/FiksWeb/Team/View/"]')?.getAttribute('href') ?? '';
      const awayTeamHref = tds[3]?.querySelector('a[href*="/FiksWeb/Team/View/"]')?.getAttribute('href') ?? '';
      rows.push({ cells, href, homeTeamHref, awayTeamHref });
    });

    return { division, rows };
  });

  console.log(`  [matches] Total rows: ${rows.length}`);

  const matches: Match[] = [];

  for (const { cells: cleaned, href, homeTeamHref, awayTeamHref } of rows) {
    const matchReportId = href.match(/MatchReport\/View\/(\d+)/)?.[1] ?? '';

    const matchId  = cleaned[0];
    const homeTeam = cleaned[2];
    const awayTeam = cleaned[3];
    const { date, time } = parseDateTime(cleaned[4]);
    const venue    = cleaned[5];
    const result   = /\d/.test(cleaned[6]) ? cleaned[6] : undefined;

    if (!homeTeam || !awayTeam || !date) continue;

    const isHome = homeTeam.toLowerCase().includes('nesodden');

    // Extract FIKS team IDs from the team-page links in the match table columns
    const homeTeamFiksId = homeTeamHref.match(/Team\/View\/(\d+)/)?.[1] ?? '';
    const awayTeamFiksId = awayTeamHref.match(/Team\/View\/(\d+)/)?.[1] ?? '';

    matches.push({
      matchId:       `fiks-${matchId}`,
      matchReportId,
      date,
      time,
      homeTeam,
      homeTeamId:    homeTeamFiksId || (isHome ? team.fiksId : ''),
      homeClubId:    isHome ? team.clubFiksId : '',
      homeLogoUrl:   isHome ? team.logoUrl : '',
      awayTeam,
      awayTeamId:    awayTeamFiksId || (isHome ? '' : team.fiksId),
      awayClubId:    isHome ? '' : team.clubFiksId,
      awayLogoUrl:   isHome ? '' : team.logoUrl,
      venue,
      tournament:    '',
      isHome,
      result,
    });
  }

  return { matches, division };
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

  // Single page.evaluate() — same pattern as scrapeMatches
  const { division, rows } = await page.evaluate(() => {
    const divCandidates = [
      '#headingTwo a', '#headingTwo .panel-title',
      '#headingTwo h3', '#headingTwo h4', '#headingTwo button',
      '.breadcrumb li:nth-last-child(2) a',
    ];
    let division = '';
    for (const sel of divCandidates) {
      const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
      if (text.length > 3 && /divisjon|serie|krets/i.test(text)) { division = text; break; }
    }
    if (!division) {
      for (const sel of divCandidates) {
        const text = (document.querySelector(sel) as HTMLElement | null)?.innerText?.trim() ?? '';
        if (text.length > 3) { division = text; break; }
      }
    }

    const rows: Array<{ cells: string[]; href: string; homeTeamHref: string; awayTeamHref: string }> = [];
    document.querySelectorAll('#collapseTwo table tbody tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 8) return;
      const cells = Array.from(tds, (td) => (td.innerText ?? td.textContent ?? '').trim().replace(/\s+/g, ' '));
      const link = tds[0]?.querySelector('a');
      const href = link?.getAttribute('href') ?? '';
      const homeTeamHref = tds[2]?.querySelector('a[href*="/FiksWeb/Team/View/"]')?.getAttribute('href') ?? '';
      const awayTeamHref = tds[3]?.querySelector('a[href*="/FiksWeb/Team/View/"]')?.getAttribute('href') ?? '';
      rows.push({ cells, href, homeTeamHref, awayTeamHref });
    });

    return { division, rows };
  });

  const matches: Match[] = [];

  for (const { cells: cleaned, href, homeTeamHref, awayTeamHref } of rows) {
    const matchReportId = href.match(/MatchReport\/View\/(\d+)/)?.[1] ?? '';

    const homeTeam = cleaned[2];
    const awayTeam = cleaned[3];
    const { date, time } = parseDateTime(cleaned[4]);
    const venue    = cleaned[5];
    const result   = /\d/.test(cleaned[6]) ? cleaned[6] : undefined;

    if (!homeTeam || !awayTeam || !date) continue;

    const homeTeamFiksId = homeTeamHref.match(/Team\/View\/(\d+)/)?.[1] ?? '';
    const awayTeamFiksId = awayTeamHref.match(/Team\/View\/(\d+)/)?.[1] ?? '';

    matches.push({
      matchId:       `fiks-${cleaned[0]}`,
      matchReportId,
      date,
      time,
      homeTeam,
      homeTeamId:    homeTeamFiksId,
      homeClubId:    '',
      homeLogoUrl:   '',
      awayTeam,
      awayTeamId:    awayTeamFiksId,
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

/**
 * Scrape all youth teams for a Nesodden club page and group them by age group.
 * Returns e.g. { 'G16': [{fiksId, name}, …], 'J15': […], … }
 */
async function scrapeClubTeamsByAgeGroup(
  page: Page,
  clubId: string,
): Promise<Record<string, Array<{ fiksId: string; name: string }>>> {
  await page.goto(`${FIKS_BASE}/FiksWeb/Club/View/${clubId}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const result: Record<string, Array<{ fiksId: string; name: string }>> = {};
    document.querySelectorAll('a[href*="/FiksWeb/Team/View/"]').forEach((el) => {
      const href = (el as HTMLAnchorElement).href;
      const name = (el as HTMLElement).innerText.trim();
      const id   = href.match(/Team\/View\/(\d+)/)?.[1];
      if (!id || !name) return;

      // Boys: G/Gutter + 1-or-2-digit age
      const boysMatch  = name.match(/\b(?:G|Gutter)\s*-?\s*(\d{1,2})\b/i);
      // Girls: J/Jenter + 1-or-2-digit age
      const girlsMatch = name.match(/\b(?:J|Jenter)\s*-?\s*(\d{1,2})\b/i);

      let ageGroup: string | null = null;
      if      (boysMatch)  ageGroup = `G${boysMatch[1]}`;
      else if (girlsMatch) ageGroup = `J${girlsMatch[1]}`;
      if (!ageGroup) return;

      if (!result[ageGroup]) result[ageGroup] = [];
      result[ageGroup].push({ fiksId: id, name });
    });

    // Deduplicate by fiksId within each age group
    for (const ag of Object.keys(result)) {
      result[ag] = [...new Map(result[ag].map((t: { fiksId: string; name: string }) => [t.fiksId, t])).values()];
    }
    return result;
  });
}

// ── Match event scraping (Hendelser tab) ─────────────────────────────────────

/**
 * Extracts goals and cards from the Hendelser (events) tab of a FIKS MatchReport page.
 *
 * FIKS DOM structure (each event is a div.match-event):
 *   <div class="match-events events-panel-content">
 *     <div class="match-event">
 *       <div class="icon-and-minute">
 *         <i class="icon icon--events icon-ball--events"></i>
 *         <span>50'</span>
 *       </div>
 *       <div class="event-description">
 *         <div class="event-text-and-team-name">
 *           <strong class="event-text">Spillemål (2 - 3)</strong>
 *           <span class="team-name">Nesodden 3</span>
 *         </div>
 *         <div class="event-players">
 *           <span class="player-number">9. </span>
 *           <span class="player-name">Noah Viraj Haugen</span>
 *         </div>
 *       </div>
 *     </div>
 *   </div>
 *
 * Event type is determined from `.event-text` content and icon class:
 *   - "Spillemål" / icon-ball → normal goal
 *   - "Straffemål" → penalty goal
 *   - "Selvmål" → own goal
 *   - icon-card-yellow → yellow card
 *   - icon-card-red → red card
 *
 * Side (home/away) is determined by matching `.team-name` against the home team
 * name extracted from the squad tab buttons.
 */
async function extractMatchEvents(page: Page, homeTeamName: string): Promise<MatchEvent[]> {
  // Brief wait for dynamic content to render after tab switch
  await page.waitForTimeout(600);

  return page.evaluate((homeName: string) => {
    const result: Array<{
      playerName: string; minute?: number; side: 'home' | 'away';
      type: 'goal' | 'card'; goalType?: string; cardType?: string;
    }> = [];

    const rows = document.querySelectorAll('.match-event');
    if (rows.length === 0) return result;

    for (const row of rows) {
      // Player name
      const playerNameEl = row.querySelector('.player-name');
      if (!playerNameEl) continue;
      const playerName = (playerNameEl as HTMLElement).innerText.trim();
      if (!playerName) continue;

      // Minute from .icon-and-minute span
      const minuteEl = row.querySelector('.icon-and-minute span');
      const minuteText = minuteEl ? (minuteEl as HTMLElement).innerText : '';
      const minuteMatch = minuteText.match(/(\d+)/);
      const minute = minuteMatch ? parseInt(minuteMatch[1]) : undefined;

      // Event type from .event-text content
      const eventTextEl = row.querySelector('.event-text');
      const eventText = (eventTextEl ? (eventTextEl as HTMLElement).innerText : '').toLowerCase();

      // Icon class as fallback
      const iconEl = row.querySelector('.icon-and-minute i');
      const iconClass = iconEl?.className?.toLowerCase() ?? '';

      let type: 'goal' | 'card';
      let goalType: string | undefined;
      let cardType: string | undefined;

      if (eventText.includes('selvmål') || eventText.includes('own goal')) {
        type = 'goal'; goalType = 'own';
      } else if (eventText.includes('straffe') || eventText.includes('penalty')) {
        type = 'goal'; goalType = 'penalty';
      } else if (eventText.includes('mål') || iconClass.includes('ball')) {
        type = 'goal'; goalType = 'normal';
      } else if (eventText.includes('rødt') || eventText.includes('utvis') || iconClass.includes('card-red')) {
        type = 'card'; cardType = 'red';
      } else if (eventText.includes('andre gul') || eventText.includes('2. gul')) {
        type = 'card'; cardType = 'yellow-red';
      } else if (eventText.includes('gult') || eventText.includes('advarsel') || iconClass.includes('card')) {
        type = 'card'; cardType = 'yellow';
      } else {
        continue;
      }

      // Determine side by matching team name against known home team
      const teamNameEl = row.querySelector('.team-name');
      const teamName = teamNameEl ? (teamNameEl as HTMLElement).innerText.trim() : '';
      const home = homeName.toLowerCase();
      const team = teamName.toLowerCase();
      const side: 'home' | 'away' = (team === home || home.includes(team) || team.includes(home))
        ? 'home' : 'away';

      result.push({ playerName, minute, side, type, goalType, cardType });
    }

    return result;
  }, homeTeamName) as Promise<MatchEvent[]>;
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

async function scrapeSquad(page: Page, matchReportId: string, homeTeamName: string): Promise<SquadWithClubs> {
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
  let home: Player[] = [];
  let away: Player[] = [];
  const homeBtn = page.getByRole('button', { name: /hjemmelag/i }).first();
  if (await homeBtn.count() > 0) {
    await homeBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    home = await extractSquadSide(page);

    const awayBtn = page.getByRole('button', { name: /bortelag/i }).first();
    await awayBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    away = await extractSquadSide(page);
  }

  // Scrape events from the Hendelser tab (goals, cards) — works even without squads
  let events: MatchEvent[] = [];
  const hendelsesLink = page.locator('nav.tab-options a.option2, nav.tab-options a:nth-child(2)').first();
  if (await hendelsesLink.count() > 0) {
    await hendelsesLink.click();
    events = await extractMatchEvents(page, homeTeamName);
    if (events.length > 0) {
      console.log(`    [events] ${events.length} events: ${events.filter(e=>e.type==='goal').length} goals, ${events.filter(e=>e.type==='card').length} cards`);
    }
  }

  return { ready: home.length > 0 || away.length > 0, home, away, events, ...clubIds };
}

/** Lightweight backfill: visit a match report page and scrape only events (no squad re-extraction). */
async function scrapeEventsOnly(page: Page, matchReportId: string, homeTeamName: string): Promise<MatchEvent[]> {
  await page.goto(`${FIKS_BASE}/FiksWeb/MatchReport/View/${matchReportId}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const hendelsesLink = page.locator('nav.tab-options a.option2, nav.tab-options a:nth-child(2)').first();
  if (await hendelsesLink.count() === 0) return [];

  await hendelsesLink.click();
  return extractMatchEvents(page, homeTeamName);
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

  // Determine which teams to sync:
  //   SYNC_TEAMS env var (JSON array of Team) → partial sync from the UI
  //   fallback → G16_TEAMS (full default sync)
  let teamsToSync: Team[] = G16_TEAMS;
  if (process.env.SYNC_TEAMS) {
    try {
      teamsToSync = JSON.parse(process.env.SYNC_TEAMS) as Team[];
      console.log(`\n[sync] Partial sync requested for: ${teamsToSync.map(t => t.name).join(', ')}`);
    } catch {
      console.warn('[sync] Could not parse SYNC_TEAMS — falling back to G16_TEAMS');
    }
  }

  // Load existing shared data for incremental skipping
  const squads: Record<string, Squad> = { ...readSquads() };
  const existingOpponents = readOpponents();
  const opponentMatches: Record<string, Match[]>    = { ...(existingOpponents?.matches ?? {}) };
  const opponentTeams:   Record<string, OpponentTeam> = { ...(existingOpponents?.teams   ?? {}) };

  await page.goto(`${FIKS_BASE}/FiksWeb/`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  console.log(`\n[sync] Authenticated. URL: ${page.url()}`);

  // ── 0. Discover all Nesodden teams by age group (needed for file layout) ────
  // Seed from existing club.json so that a failed discovery doesn't wipe known teams
  const existingClub = readClubData();
  const clubTeams: Record<string, typeof G16_TEAMS> = { ...(existingClub?.clubTeams ?? {}) };

  console.log('\n[sync] ── Discovering Nesodden teams by age group ──');
  const rawTeamsByAgeGroup = await scrapeClubTeamsByAgeGroup(page, NESODDEN_CLUB_ID);
  for (const [ageGroup, teamList] of Object.entries(rawTeamsByAgeGroup)) {
    clubTeams[ageGroup] = teamList.map(({ fiksId, name }) => {
      const known = G16_TEAMS.find((t) => t.fiksId === fiksId);
      // Preserve existing fields (division, tournamentFiksId) if not discovered
      const existing = (existingClub?.clubTeams?.[ageGroup] ?? []).find(t => t.fiksId === fiksId);
      return {
        fiksId,
        name,
        division:   known?.division ?? existing?.division ?? '',
        clubFiksId: NESODDEN_CLUB_ID,
        logoUrl:    `https://images.fotball.no/clublogos/${NESODDEN_CLUB_ID}.png`,
        ...(existing?.tournamentFiksId ? { tournamentFiksId: existing.tournamentFiksId } : {}),
      };
    });
  }
  console.log(`  → found age groups: ${Object.keys(clubTeams).sort().join(', ')}`);

  // Fallback: if Playwright discovery found nothing new, try Cheerio via fotball.no
  if (Object.keys(rawTeamsByAgeGroup).length === 0) {
    console.log('  → Playwright discovery empty, trying fotball.no…');
    const cheerioTeams = await scrapeClubTeams(NESODDEN_CLUB_ID);
    for (const [ag, teams] of Object.entries(cheerioTeams)) {
      if (!clubTeams[ag]) clubTeams[ag] = [];
      for (const t of teams) {
        if (!clubTeams[ag].some(e => e.fiksId === t.fiksId)) {
          clubTeams[ag].push(t);
        }
      }
    }
    console.log(`  → after fallback: ${Object.keys(clubTeams).sort().join(', ')}`);
  }

  // Update teamsToSync with live names from FIKS (handles team renames)
  const allDiscoveredTeams = Object.values(clubTeams).flat();
  teamsToSync = teamsToSync.map((t) => {
    const live = allDiscoveredTeams.find((d) => d.fiksId === t.fiksId);
    return live ?? t;
  });

  // Build fiksId → ageGroup lookup
  const ageGroupOf: Record<string, string> = {};
  for (const [ag, teams] of Object.entries(clubTeams)) {
    for (const t of teams) ageGroupOf[t.fiksId] = ag;
  }
  // Fallback for SYNC_TEAMS teams not yet in clubTeams (e.g. first sync)
  for (const t of G16_TEAMS) ageGroupOf[t.fiksId] ??= 'G16';

  // Collect all Nesodden team matches for logo pass (includes non-synced teams from disk)
  const allNesoddenMatches: Record<string, Match[]> = {};

  // ── 1. Nesodden teams ────────────────────────────────────────────────────────
  for (const team of teamsToSync) {
    const ag = ageGroupOf[team.fiksId] ?? 'unknown';
    console.log(`\n[sync] ── ${team.name} (${ag}) ──`);

    const { matches: teamMatches, division: teamDivision } = await scrapeMatches(page, team);
    console.log(`  → ${teamMatches.length} matches, division: "${teamDivision}"`);

    // Update clubTeams with the live division from the team page
    const ag2 = ageGroupOf[team.fiksId];
    if (ag2 && clubTeams[ag2]) {
      const entry = clubTeams[ag2].find((t) => t.fiksId === team.fiksId);
      if (entry && teamDivision) entry.division = teamDivision;
    }

    const now     = Date.now();
    const week_ms = 7 * 24 * 60 * 60 * 1000;
    let squadCount = 0;

    for (const match of teamMatches) {
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

      // Incremental: skip squads already fully scraped (both sides present, with events)
      const existingSquad = squads[match.matchReportId];
      const isIncomplete = existingSquad?.ready && isPlayed
        && (existingSquad.home.length === 0 || existingSquad.away.length === 0);
      if (existingSquad?.ready && !isIncomplete) {
        // Backfill events for squads scraped before event extraction was added
        if (!('events' in existingSquad) && isPlayed) {
          process.stdout.write(`  [events backfill] ${match.date} ${match.homeTeam} vs ${match.awayTeam} … `);
          const events = await scrapeEventsOnly(page, match.matchReportId, match.homeTeam);
          existingSquad.events = events;
          console.log(events.length > 0
            ? `${events.length} events: ${events.filter(e=>e.type==='goal').length} goals, ${events.filter(e=>e.type==='card').length} cards`
            : 'no events');
        }
        squadCount++;
        continue;
      }
      if (isIncomplete) {
        process.stdout.write(`  [squad rescrape] ${match.date} ${match.homeTeam} vs ${match.awayTeam} (missing ${existingSquad.home.length === 0 ? 'home' : 'away'}) … `);
      } else {
        process.stdout.write(`  [squad] ${match.date} ${match.homeTeam} vs ${match.awayTeam} … `);
      }
      const squad = await scrapeSquad(page, match.matchReportId, match.homeTeam);
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

    const teamPlayers = await scrapePlayers(page, team);
    console.log(`  → ${teamPlayers.length} roster players`);

    // Write per-team file immediately (partial progress saved)
    writeTeamData(ag, team.fiksId, {
      matches: teamMatches,
      players: teamPlayers,
      lastSynced: new Date().toISOString(),
    });
    console.log(`  → saved to data/teams/${ag}/${team.fiksId}.json`);

    allNesoddenMatches[team.fiksId] = teamMatches;
  }

  // Write club data after Nesodden team loop so it includes live divisions
  writeClubData({ clubTeams, lastSynced: new Date().toISOString() });

  // ── 1b. Scrape tournament standings for each team ────────────────────────────
  const standingsData = readStandings();
  const seenTournaments = new Set<string>();
  for (const teams of Object.values(clubTeams)) {
    for (const team of teams) {
      if (!team.tournamentFiksId || seenTournaments.has(team.tournamentFiksId)) continue;
      seenTournaments.add(team.tournamentFiksId);
      process.stdout.write(`  [standings] ${team.division || team.tournamentFiksId} … `);
      const result = await scrapeTournamentStandings(team.tournamentFiksId);
      if (result.standings.length > 0) {
        standingsData[team.tournamentFiksId] = {
          standings: result.standings,
          tournament: result.tournament,
          lastUpdated: new Date().toISOString(),
        };
        console.log(`${result.standings.length} teams`);
      } else {
        console.log('no data');
      }
    }
  }
  writeStandings(standingsData);
  console.log(`[sync] ✅ Standings saved (${seenTournaments.size} tournaments)`);

  // ── 2. Logo pass for Nesodden matches ────────────────────────────────────────
  // Include matches from non-synced teams (already on disk) for a complete club-ID map
  for (const [ag, teams] of Object.entries(clubTeams)) {
    for (const t of teams) {
      if (allNesoddenMatches[t.fiksId]) continue; // already loaded above
      const existing = readTeamData(ag, t.fiksId);
      if (existing?.matches?.length) {
        allNesoddenMatches[t.fiksId] = existing.matches;
      }
    }
  }

  const clubIdByName: Record<string, string> = {};
  for (const teamMatches of Object.values(allNesoddenMatches)) {
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
  for (const teamMatches of Object.values(allNesoddenMatches)) {
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
      try {
        const ids = await scrapeClubIds(page, m.matchReportId!);
        if (ids.homeClubId) clubIdByName[m.homeTeam.toLowerCase()] = ids.homeClubId;
        if (ids.awayClubId) clubIdByName[m.awayTeam.toLowerCase()] = ids.awayClubId;
        console.log(`home:${ids.homeClubId} away:${ids.awayClubId}`);
      } catch (e) {
        console.log(`skipped (${(e as Error).message?.split('\n')[0]})`);
      }
    }
  }

  // Apply clubIdByName to every Nesodden match — updates logo URLs AND club IDs
  applyClubIds(Object.values(allNesoddenMatches), clubIdByName);

  // Re-write team files with updated club IDs from logo pass
  for (const team of teamsToSync) {
    const ag = ageGroupOf[team.fiksId] ?? 'unknown';
    if (allNesoddenMatches[team.fiksId]) {
      const existing = readTeamData(ag, team.fiksId);
      if (existing) {
        writeTeamData(ag, team.fiksId, {
          ...existing,
          matches: allNesoddenMatches[team.fiksId],
        });
      }
    }
  }

  // ── 3. Opponent team pass ─────────────────────────────────────────────────────
  // Uses fotball.no standings to find all teams in each tournament, then
  // scrapeTeamMatchList() (Cheerio, public) to get each team's match list and
  // matchReportIds. Squad/event data is scraped from FIKS match report pages
  // (accessible to any authenticated user, unlike FIKS team pages which only
  // show full data to the owning club's admins).
  //
  // Scrapes ALL played matches with no lookback limit for complete tournament data.
  // Incremental guard: skips match reports already in squads map with ready=true + events.

  // Build set of all Nesodden teamFiksIds (to skip)
  const nesoddenTeamIds = new Set(Object.values(clubTeams).flat().map(t => t.fiksId));

  // Build tournamentFiksId → ageGroup map from Nesodden's club data
  const tournamentAgeGroup: Record<string, string> = {};
  for (const [ag, teams] of Object.entries(clubTeams)) {
    for (const t of teams) {
      if (t.tournamentFiksId) tournamentAgeGroup[t.tournamentFiksId] = ag;
    }
  }

  // Collect all non-Nesodden teams from standings (unique by teamFiksId)
  const tournamentTeams = new Map<string, { name: string; tournamentFiksId: string; ageGroup: string }>();
  for (const [tournamentFiksId, entry] of Object.entries(standingsData)) {
    if (!entry.standings?.length) continue;
    const ag = tournamentAgeGroup[tournamentFiksId] ?? '';
    for (const s of entry.standings) {
      if (!s.teamFiksId || nesoddenTeamIds.has(s.teamFiksId)) continue;
      if (!tournamentTeams.has(s.teamFiksId)) {
        tournamentTeams.set(s.teamFiksId, { name: s.teamName, tournamentFiksId, ageGroup: ag });
      }
    }
  }

  console.log(`\n[sync] ── Opponent pass: ${tournamentTeams.size} non-Nesodden teams from standings ──`);

  // Helper: scrape squad for a played match (incremental guard + events backfill)
  async function scrapeMatchSquad(
    matchReportId: string,
    homeTeam: string,
    awayTeam: string,
    date: string,
    label: string,
  ): Promise<{ homeClubId: string; awayClubId: string } | null> {
    const existingSquad = squads[matchReportId];
    const isIncomplete = existingSquad?.ready
      && (existingSquad.home.length === 0 || existingSquad.away.length === 0);

    if (existingSquad?.ready && !isIncomplete) {
      if (!('events' in existingSquad)) {
        process.stdout.write(`      [events backfill] ${date} ${homeTeam} vs ${awayTeam} … `);
        const events = await scrapeEventsOnly(page, matchReportId, homeTeam);
        existingSquad.events = events;
        console.log(events.length > 0
          ? `${events.length} events: ${events.filter(e=>e.type==='goal').length} goals, ${events.filter(e=>e.type==='card').length} cards`
          : 'no events');
      }
      return null; // already cached — no new club IDs to return
    }

    // Already visited (has events key, even empty) but not ready (no squad registered).
    // Past match data doesn't change on FIKS — skip re-scraping.
    if (existingSquad && 'events' in existingSquad) {
      return null;
    }

    if (isIncomplete) {
      process.stdout.write(`      [${label} rescrape] ${date} ${homeTeam} vs ${awayTeam} (missing ${existingSquad.home.length === 0 ? 'home' : 'away'}) … `);
    } else {
      process.stdout.write(`      [${label}] ${date} ${homeTeam} vs ${awayTeam} … `);
    }

    const squad = await scrapeSquad(page, matchReportId, homeTeam);
    const { homeClubId: hId, awayClubId: aId, ...squadData } = squad;
    squads[matchReportId] = squadData;

    if (squad.ready) {
      console.log(`✓ home:${squad.home.length} away:${squad.away.length}`);
    } else {
      console.log('ikke klar enda');
    }

    return { homeClubId: hId, awayClubId: aId };
  }

  for (const [teamFiksId, meta] of tournamentTeams) {
    process.stdout.write(`  [opp-team] ${meta.name} (${teamFiksId}) … `);

    // Get full match list from fotball.no (public, no auth needed)
    const publicMatches = await scrapeTeamMatchList(teamFiksId);
    console.log(`${publicMatches.length} matches`);

    if (publicMatches.length === 0) continue;

    // Build Match objects for opponents.json storage
    const teamMatches: Match[] = publicMatches.map(pm => ({
      matchId:      `fiks-${pm.matchReportId}`,
      matchReportId: pm.matchReportId,
      date:         pm.date,
      time:         pm.time,
      homeTeam:     pm.homeTeam,
      homeTeamId:   '',
      homeClubId:   '',
      homeLogoUrl:  '',
      awayTeam:     pm.awayTeam,
      awayTeamId:   '',
      awayClubId:   '',
      awayLogoUrl:  '',
      venue:        '',
      tournament:   '',
      isHome:       false,
      result:       pm.result,
    }));

    // Scrape squads + events for ALL played matches (no lookback limit)
    let squadCount = 0;
    let resolvedClubId = '';
    const localClubIdByName: Record<string, string> = { ...clubIdByName };

    for (const match of teamMatches) {
      if (!match.matchReportId || !match.result) continue;

      const clubIds = await scrapeMatchSquad(
        match.matchReportId, match.homeTeam, match.awayTeam, match.date, 'squad',
      );
      if (clubIds === null) {
        // Already cached — try to recover club IDs from existing logo data
        localClubIdByName[match.homeTeam.toLowerCase()] ||= extractClubIdFromLogoUrl(match.homeLogoUrl);
        localClubIdByName[match.awayTeam.toLowerCase()] ||= extractClubIdFromLogoUrl(match.awayLogoUrl);
        squadCount++;
        continue;
      }
      if (clubIds.homeClubId) {
        match.homeLogoUrl = `https://images.fotball.no/clublogos/${clubIds.homeClubId}.png`;
        localClubIdByName[match.homeTeam.toLowerCase()] = clubIds.homeClubId;
      }
      if (clubIds.awayClubId) {
        match.awayLogoUrl = `https://images.fotball.no/clublogos/${clubIds.awayClubId}.png`;
        localClubIdByName[match.awayTeam.toLowerCase()] = clubIds.awayClubId;
      }
      if (squads[match.matchReportId]?.ready) squadCount++;

      // Resolve this team's clubId from match data
      if (!resolvedClubId) {
        const teamNameLower = meta.name.toLowerCase();
        resolvedClubId = localClubIdByName[teamNameLower]
          || (match.homeTeam.toLowerCase().includes(meta.name.toLowerCase().split(' ')[0]?.toLowerCase() ?? '') ? clubIds.homeClubId : '')
          || (match.awayTeam.toLowerCase().includes(meta.name.toLowerCase().split(' ')[0]?.toLowerCase() ?? '') ? clubIds.awayClubId : '');
      }
    }

    applyClubIds([teamMatches], localClubIdByName, teamFiksId, resolvedClubId);
    Object.assign(clubIdByName, localClubIdByName);

    opponentTeams[teamFiksId] = {
      fiksId: teamFiksId,
      name: meta.name,
      clubId: resolvedClubId,
      division: '',
      ageGroup: meta.ageGroup,
      tournamentFiksId: meta.tournamentFiksId,
    };

    opponentMatches[teamFiksId] = teamMatches;
    console.log(`    → ${squadCount} squads scraped/cached`);
  }

  // ── 4. Write shared data ────────────────────────────────────────────────────
  writeSquads(squads);
  console.log(`\n[sync] ✅ Squads saved to data/squads.json (${Object.keys(squads).length} entries)`);

  writeOpponents({ matches: opponentMatches, teams: opponentTeams });
  console.log(`[sync] ✅ Opponents saved to data/opponents.json (${Object.keys(opponentMatches).length} teams)`);

  console.log('[sync] ✅ Sync complete');
});
