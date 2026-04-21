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
 * FIKS renders the tab as a vertical timeline where home events appear on the left column
 * and away events on the right. Each event row contains:
 *   - An icon <i class="matchreport-icon-*"> identifying the event type
 *   - A player name in the same side column
 *   - A minute in a centre cell
 *
 * Typical layout (simplified):
 *   <div class="match-events">
 *     <div class="match-event-row">
 *       <div class="col-event-home"><span class="event-player">Last, First</span><i class="matchreport-icon-goal"/></div>
 *       <div class="col-event-time">23'</div>
 *       <div class="col-event-away"></div>
 *     </div>
 *   </div>
 *
 * We use a single page.evaluate() so we can inspect the live (post-click) DOM.
 */
async function extractMatchEvents(page: Page): Promise<MatchEvent[]> {
  // Brief wait for dynamic content to render after tab switch
  await page.waitForTimeout(600);

  return page.evaluate(() => {
    // ── Helpers ──────────────────────────────────────────────────────────────
    function iconType(iconClass: string): { type: 'goal' | 'card'; goalType?: string; cardType?: string } | null {
      const c = iconClass.toLowerCase();
      // Goals
      if (c.includes('own-goal') || c.includes('owngoal') || c.includes('selvmål') || c.includes('selfgoal'))
        return { type: 'goal', goalType: 'own' };
      if (c.includes('penalty') || c.includes('straffe-mål') || c.includes('straffemål'))
        return { type: 'goal', goalType: 'penalty' };
      if (c.includes('goal') || c.includes('mål'))
        return { type: 'goal', goalType: 'normal' };
      // Cards
      if (c.includes('second-yellow') || c.includes('yellow-red') || c.includes('andre-gult'))
        return { type: 'card', cardType: 'yellow-red' };
      if (c.includes('red-card') || c.includes('redcard') || c.includes('rødt') || c.includes('utvisning'))
        return { type: 'card', cardType: 'red' };
      if (c.includes('yellow') || c.includes('warning') || c.includes('gult') || c.includes('advarsel'))
        return { type: 'card', cardType: 'yellow' };
      return null;
    }

    function cleanName(raw: string): string {
      return raw.replace(/\s*\(.*?\)\s*$/, '').replace(/\s+/g, ' ').trim();
    }

    function parseMinute(text: string): number | undefined {
      const m = text.match(/(\d+)/);
      return m ? parseInt(m[1]) : undefined;
    }

    // ── Strategy A: FIKS standard event rows ─────────────────────────────────
    // Selectors ranked by specificity — stops at first match that yields results.
    const rowSelectors = [
      '.match-events .event-row',
      '.match-events .match-event-row',
      '.events-list .event-row',
      '.event-list .event-row',
      '.match-event-list > div',
      '[class*="events"] [class*="event-row"]',
      '[class*="event-list"] > div',
    ];

    let rows: Element[] = [];
    for (const sel of rowSelectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) { rows = found; break; }
    }

    const result: MatchEvent[] = [];

    if (rows.length > 0) {
      for (const row of rows) {
        const icons = row.querySelectorAll('i[class], [class*="icon"]');
        let event: { type: 'goal' | 'card'; goalType?: string; cardType?: string } | null = null;
        for (const icon of icons) {
          event = iconType(icon.className);
          if (event) break;
        }
        if (!event) continue;

        // Minute — look for a cell with digits + optional apostrophe
        const minuteEl = row.querySelector('[class*="minute"], [class*="time"], [class*="tid"]');
        const minute = minuteEl
          ? parseMinute((minuteEl as HTMLElement).innerText)
          : parseMinute((row as HTMLElement).innerText);

        // Home/away columns
        const homeCol = row.querySelector('[class*="home"], .col-event-home, .event-home');
        const awayCol = row.querySelector('[class*="away"], .col-event-away, .event-away');

        function nameFromCol(col: Element | null): string {
          if (!col) return '';
          // Find first span/p that is not an icon and has >2 chars
          const candidates = [...col.querySelectorAll('span, p, a, label')];
          for (const c of candidates) {
            if (c.querySelector('i, [class*="icon"]')) continue;
            const t = cleanName((c as HTMLElement).innerText);
            if (t.length > 2) return t;
          }
          // Fall back to col text itself
          return cleanName((col as HTMLElement).innerText.split('\n')[0]);
        }

        const homeName = nameFromCol(homeCol);
        const awayName = nameFromCol(awayCol);

        if (homeName) {
          result.push({
            playerName: homeName,
            minute,
            side: 'home',
            type: event.type,
            goalType: event.goalType as GoalType | undefined,
            cardType: event.cardType as CardType | undefined,
          });
        }
        if (awayName) {
          result.push({
            playerName: awayName,
            minute,
            side: 'away',
            type: event.type,
            goalType: event.goalType as GoalType | undefined,
            cardType: event.cardType as CardType | undefined,
          });
        }
      }

      return result;
    }

    // ── Strategy B: scan for any icon in event panel, infer side from position ─
    // Fallback when class names don't match Strategy A patterns.
    const panel = document.querySelector(
      '[class*="hendelser"], [class*="events-panel"], .tab-pane.active, .content-area > div:nth-child(2)'
    );
    if (!panel) return [];

    const allIcons = panel.querySelectorAll('i[class]');
    for (const icon of allIcons) {
      const evt = iconType(icon.className);
      if (!evt) continue;

      // Walk up to find the row-level container
      let row: Element | null = icon.parentElement;
      while (row && row !== panel && !row.className.includes('row') && !row.className.includes('event')) {
        row = row.parentElement;
      }
      if (!row || row === panel) continue;

      const rowText = (row as HTMLElement).innerText;
      const minute = parseMinute(rowText);

      // Heuristic: find sibling text nodes / spans for player name
      const parent = icon.parentElement as HTMLElement | null;
      const textNode = parent?.innerText?.replace(/\d+['`']/g, '').trim().split('\n')[0] ?? '';
      const playerName = cleanName(textNode);
      if (!playerName || playerName.length < 3) continue;

      // Side heuristic: if the icon's parent is in the left half of the row, it's home
      const iconRect = icon.getBoundingClientRect();
      const rowRect = (row as HTMLElement).getBoundingClientRect();
      const side: 'home' | 'away' = iconRect.left < rowRect.left + rowRect.width / 2 ? 'home' : 'away';

      result.push({
        playerName,
        minute,
        side,
        type: evt.type,
        goalType: evt.goalType as GoalType | undefined,
        cardType: evt.cardType as CardType | undefined,
      });
    }

    return result;
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

  // Scrape events from the Hendelser tab (only for played matches that have squads)
  let events: MatchEvent[] = [];
  const hendelsesLink = page.locator('nav.tab-options a.option2, nav.tab-options a:nth-child(2)').first();
  if (await hendelsesLink.count() > 0) {
    await hendelsesLink.click();
    events = await extractMatchEvents(page);
    if (events.length > 0) {
      console.log(`    [events] ${events.length} events: ${events.filter(e=>e.type==='goal').length} goals, ${events.filter(e=>e.type==='card').length} cards`);
    }
  }

  return { ready: home.length > 0 || away.length > 0, home, away, events, ...clubIds };
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

  // Load existing synced data for incremental squad skipping
  const existing = readSyncedData();

  await page.goto(`${FIKS_BASE}/FiksWeb/`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  console.log(`\n[sync] Authenticated. URL: ${page.url()}`);

  // Start from existing data so a partial sync (e.g. only G19) doesn't wipe other age groups
  const matches:  Record<string, Match[]>  = { ...(existing?.matches  ?? {}) };
  const players:  Record<string, Player[]> = { ...(existing?.players  ?? {}) };
  const squads:   Record<string, Squad>    = { ...(existing?.squads   ?? {}) };

  const opponentMatches: Record<string, Match[]>    = { ...(existing?.opponentMatches ?? {}) };
  const opponentTeams:   Record<string, OpponentTeam> = { ...(existing?.opponentTeams   ?? {}) };

  // ── 1. Nesodden teams ────────────────────────────────────────────────────────
  for (const team of teamsToSync) {
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

  // ── 4. Discover all Nesodden teams by age group ─────────────────────────────
  console.log('\n[sync] ── Discovering Nesodden teams by age group ──');
  const rawTeamsByAgeGroup = await scrapeClubTeamsByAgeGroup(page, NESODDEN_CLUB_ID);
  const clubTeams: Record<string, typeof G16_TEAMS> = {};
  for (const [ageGroup, teamList] of Object.entries(rawTeamsByAgeGroup)) {
    clubTeams[ageGroup] = teamList.map(({ fiksId, name }) => {
      // Enrich known G16 entries with their hardcoded division/name
      const known = G16_TEAMS.find((t) => t.fiksId === fiksId);
      return {
        fiksId,
        name:       known?.name ?? name,
        division:   known?.division ?? '',
        clubFiksId: NESODDEN_CLUB_ID,
        logoUrl:    `https://images.fotball.no/clublogos/${NESODDEN_CLUB_ID}.png`,
      };
    });
  }
  console.log(`  → found age groups: ${Object.keys(clubTeams).sort().join(', ')}`);

  writeSyncedData({
    lastSynced: new Date().toISOString(),
    matches,
    players,
    squads,
    opponentMatches,
    opponentTeams,
    clubTeams,
  });
  console.log('\n[sync] ✅ Data saved to data/synced-data.json');
});
