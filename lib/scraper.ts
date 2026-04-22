import axios from 'axios';
import { load } from 'cheerio';
import type { Match, Team } from './types';
import { NESODDEN_CLUB_ID } from './mockData';

const BASE = 'https://www.fotball.no/fotballdata';
const FOTBALL_NO = 'https://www.fotball.no';
// Season ID on fotball.no — update each year (110 = 2026)
const CURRENT_SEASON = '110';

const httpClient = axios.create({
  timeout: 4000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8',
  },
});

// fotball.no match table columns (from inspecting live page):
// [date] [weekday] [time] [home] [score/vs] [away] [venue?]
const DATE_RE    = /^\d{2}\.\d{2}\.\d{4}$/;
const TIME_RE    = /^\d{2}:\d{2}$/;
const WEEKDAYS   = ['mandag','tirsdag','onsdag','torsdag','fredag','lørdag','søndag'];

function logoUrl(clubFiksId: string | undefined): string {
  return clubFiksId
    ? `https://images.fotball.no/clublogos/${clubFiksId}.png`
    : '';
}

function fiksIdFromHref(href: string | undefined): string | undefined {
  return href?.match(/fiksId=(\d+)/i)?.[1];
}

export async function scrapeTeamMatches(
  team: Team,
  nesoddenClubId = NESODDEN_CLUB_ID
): Promise<Match[]> {
  let html: string;
  try {
    // `/lag/kamper/` redirects to the same page as `/lag/hjem/` — either works
    const res = await httpClient.get(`${BASE}/lag/hjem/?fiksId=${team.fiksId}`);
    html = res.data as string;
  } catch {
    return [];
  }

  const $ = load(html);
  const matches: Match[] = [];

  // Find every table row that contains a valid date cell
  $('table tr').each((rowIdx, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const cellTexts = cells.toArray().map((c) => $(c).text().trim());
    const cellHrefs = cells.toArray().map((c) => $(c).find('a').first().attr('href'));

    // Detect column layout: find the date column index
    let dateIdx = -1;
    for (let i = 0; i < cellTexts.length; i++) {
      if (DATE_RE.test(cellTexts[i])) { dateIdx = i; break; }
    }
    if (dateIdx === -1) return;

    // Skip weekday column (may or may not be present after date)
    let cursor = dateIdx + 1;
    if (WEEKDAYS.includes(cellTexts[cursor]?.toLowerCase())) cursor++;

    // Time
    const time = TIME_RE.test(cellTexts[cursor]) ? cellTexts[cursor++] : '';

    // Home team
    const homeTeam = cellTexts[cursor];
    const homeTeamId = fiksIdFromHref(cellHrefs[cursor]);
    cursor++;

    // Score / vs separator — skip
    cursor++;

    // Away team
    const awayTeam = cellTexts[cursor];
    const awayTeamId = fiksIdFromHref(cellHrefs[cursor]);
    cursor++;

    // Venue (optional next cell)
    const venue = cursor < cellTexts.length ? cellTexts[cursor] : '';

    if (!homeTeam || !awayTeam) return;

    // Determine result if present (score cell usually "2-1" format)
    const scoreCell = cellTexts[dateIdx + (WEEKDAYS.includes(cellTexts[dateIdx + 1]?.toLowerCase()) ? 3 : 2)];
    const result = /^\d+\s*[-–]\s*\d+$/.test(scoreCell) ? scoreCell : undefined;

    // Which side is Nesodden?
    const homeClubId = homeTeamId === team.fiksId ? nesoddenClubId : homeTeamId ?? '';
    const awayClubId = awayTeamId === team.fiksId ? nesoddenClubId : awayTeamId ?? '';
    const isHome = homeTeamId === team.fiksId || homeTeam.toLowerCase().includes('nesodden');

    matches.push({
      matchId: `${team.fiksId}-r${rowIdx}`,
      date: cellTexts[dateIdx],
      time,
      homeTeam,
      homeTeamId: homeTeamId ?? '',
      homeClubId,
      homeLogoUrl: logoUrl(homeClubId),
      awayTeam,
      awayTeamId: awayTeamId ?? '',
      awayClubId,
      awayLogoUrl: logoUrl(awayClubId),
      venue,
      tournament: $('h1').first().text().trim(),
      isHome,
      result,
    });
  });

  return matches;
}

// ── Club team discovery ───────────────────────────────────────────────────────

function extractAgeGroup(label: string): string | null {
  // Match e.g. "G16", "J17", "G08" from labels like "G16 2. div." / "G08 år avd. 27"
  const m = label.match(/\b([GJ])(\d{2})\b/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

/**
 * Scrape all teams for a club from fotball.no, grouped by age group.
 *
 * Steps:
 *  1. Fetch the turneringer page for the club (server-rendered HTML)
 *  2. Extract tournament links per unique (ageGroup, tournamentFiksId) — skip cups
 *  3. Fetch each tournament page in parallel batches
 *  4. Find the club's team link in each tournament, extract team fiksId
 *
 * Returns e.g. { G16: [Team, Team, Team], G15: [Team], J17: [Team] }
 *
 * @param clubId       FIKS club ID (e.g. '82' for Nesodden IF)
 * @param clubName     Display name used on fotball.no (e.g. 'Nesodden')
 * @param districtId   fotball.no district filter (e.g. '4' for Oslo-krets)
 */
export async function scrapeClubTeams(
  clubId: string,
  clubName = 'Nesodden',
  districtId = '4',
): Promise<Record<string, Team[]>> {
  // 1. Fetch the turneringer overview page
  let overviewHtml: string;
  try {
    const res = await httpClient.get(
      `${FOTBALL_NO}/turneringer/?s=${CURRENT_SEASON}&club=${encodeURIComponent(clubName)}&d=${districtId}&c=${clubId}`,
      { timeout: 8000 },
    );
    overviewHtml = res.data as string;
  } catch {
    return {};
  }

  const $ = load(overviewHtml);

  // 2. Collect tournament entries: skip cups, collect unique (ageGroup+fiksId) pairs
  type TEntry = { fiksId: string; ageGroup: string; division: string; isCup: boolean };
  const tournaments: TEntry[] = [];

  $('a.a_linkButton[href*="/fotballdata/turnering/hjem/"]').each((_, el) => {
    const href  = $(el).attr('href') ?? '';
    const label = ($(el).attr('aria-label') ?? $(el).text()).trim();
    const fiksId   = href.match(/fiksId=(\d+)/)?.[1];
    const ageGroup = extractAgeGroup(label);
    if (!fiksId || !ageGroup) return;
    const isCup = /cup/i.test(label);
    tournaments.push({ fiksId, ageGroup, division: label, isCup });
  });

  // Remove cup tournaments for age groups that also have league tournaments
  const hasLeague = new Set(tournaments.filter((t) => !t.isCup).map((t) => t.ageGroup));
  const filtered = tournaments.filter((t) => !t.isCup || !hasLeague.has(t.ageGroup));

  if (filtered.length === 0) return {};

  // 3+4. Fetch tournament pages in parallel batches, find the club's team
  const result: Record<string, Team[]> = {};
  const BATCH = 6;

  for (let i = 0; i < filtered.length; i += BATCH) {
    await Promise.all(
      filtered.slice(i, i + BATCH).map(async ({ fiksId, ageGroup, division }) => {
        try {
          const res = await httpClient.get(
            `${BASE}/turnering/hjem/?fiksId=${fiksId}`,
            { timeout: 6000 },
          );
          const $t = load(res.data as string);

          $t('a[href*="/fotballdata/lag/hjem/"]').each((_, el) => {
            const href      = $t(el).attr('href') ?? '';
            const text      = $t(el).text().trim();
            const teamFiksId = href.match(/fiksId=(\d+)/)?.[1];
            if (!teamFiksId) return;
            if (!text.toLowerCase().includes(clubName.toLowerCase())) return;

            if (!result[ageGroup]) result[ageGroup] = [];
            if (result[ageGroup].some((t) => t.fiksId === teamFiksId)) return;

            // Normalise: "Nesodden 2" / "Nesodden 3" → "Nesodden"
            const baseName = text.replace(/\s+\d+$/, '').trim();

            result[ageGroup].push({
              fiksId:    teamFiksId,
              name:      baseName,             // numbered below
              division:  division.trim(),
              clubFiksId: clubId,
              logoUrl:   `https://images.fotball.no/clublogos/${clubId}.png`,
            });
          });
        } catch {
          // skip timed-out / failed tournament pages
        }
      }),
    );
  }

  // Sort each age group by division name, then number teams -1, -2, -3 …
  for (const ag of Object.keys(result)) {
    result[ag].sort((a, b) => a.division.localeCompare(b.division));
    if (result[ag].length > 1) {
      result[ag] = result[ag].map((t, i) => ({ ...t, name: `${t.name} ${ag}-${i + 1}` }));
    } else {
      result[ag][0] = { ...result[ag][0], name: `${result[ag][0].name} ${ag}` };
    }
  }

  return result;
}
