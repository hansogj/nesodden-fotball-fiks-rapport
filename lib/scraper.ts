import axios from 'axios';
import { load } from 'cheerio';
import { extractAgeGroup } from './utils';
import type { MatchEvent, Player, Squad, StandingsEntry, Team } from './types';

export interface PublicMatchInfo {
  matchReportId: string;
  date: string;       // dd.mm.yyyy
  time: string;
  homeTeam: string;
  awayTeam: string;
  result?: string;    // e.g. "4-3", undefined if not played
}

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

// ── Club team discovery ───────────────────────────────────────────────────────

/**
 * Scrape all teams for a club from fotball.no, grouped by age group.
 * Uses Cheerio (no browser needed) — suitable for sync and one-time bootstrap.
 */
export async function scrapeClubTeams(
  clubId: string,
  clubName = 'Nesodden',
  districtId = '4',
): Promise<Record<string, Team[]>> {
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

  const hasLeague = new Set(tournaments.filter((t) => !t.isCup).map((t) => t.ageGroup));
  const filtered = tournaments.filter((t) => !t.isCup || !hasLeague.has(t.ageGroup));

  if (filtered.length === 0) return {};

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

            const baseName = text.replace(/\s+\d+$/, '').trim();

            result[ageGroup].push({
              fiksId:    teamFiksId,
              name:      baseName,
              division:  division.trim(),
              clubFiksId: clubId,
              logoUrl:   `https://images.fotball.no/clublogos/${clubId}.png`,
              tournamentFiksId: fiksId,
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

// ── Tournament standings scraping ────────────────────────────────────────────

/**
 * Scrape the full standings table from a fotball.no tournament page.
 * Columns: #, Lag, S (played), V (won), U (drawn), T (lost), MF "7-4 (3)", P (points)
 */
export async function scrapeTournamentStandings(tournamentFiksId: string): Promise<{ standings: StandingsEntry[]; tournament: string }> {
  try {
    const res = await httpClient.get(`${BASE}/turnering/tabell/?fiksId=${tournamentFiksId}`, { timeout: 6000 });
    const $ = load(res.data as string);

    const tournament = $('h1').first().text().trim();
    const standings: StandingsEntry[] = [];

    // Find the standings table by looking for the header row with "Lag", "S", "V", "U", "T", "MF", "P"
    let standingsTable: ReturnType<typeof $> | null = null;
    $('table').each((_, table) => {
      const headers = $(table).find('thead th').toArray().map((th) => $(th).text().trim());
      if (headers.includes('Lag') && headers.includes('MF') && headers.includes('P')) {
        standingsTable = $(table);
        return false; // break
      }
    });

    if (!standingsTable) return { standings, tournament };

    (standingsTable as ReturnType<typeof $>).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 8) return;

      const cellTexts = cells.toArray().map((c) => $(c).text().trim());

      const teamLink = $(row).find('a[href*="fiksId="]').first();
      const teamFiksId = teamLink.attr('href')?.match(/fiksId=(\d+)/)?.[1] ?? '';
      const teamName = teamLink.text().trim() || cellTexts[1] || '';
      if (!teamName) return;

      const position = parseInt(cellTexts[0]) || standings.length + 1;
      const played = parseInt(cellTexts[2]) || 0;
      const won = parseInt(cellTexts[3]) || 0;
      const drawn = parseInt(cellTexts[4]) || 0;
      const lost = parseInt(cellTexts[5]) || 0;

      // MF column: "7-4 (3)" format — goals for-against (difference)
      let goalsFor = 0, goalsAgainst = 0;
      const mfMatch = cellTexts[6]?.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (mfMatch) {
        goalsFor = parseInt(mfMatch[1]);
        goalsAgainst = parseInt(mfMatch[2]);
      }

      const points = parseInt(cellTexts[7]) || 0;

      standings.push({
        position, teamName, teamFiksId,
        played, won, drawn, lost,
        goalsFor, goalsAgainst, goalDiff: goalsFor - goalsAgainst, points,
      });
    });

    return { standings, tournament };
  } catch {
    return { standings: [], tournament: '' };
  }
}

// ── Team match list (public fotball.no) ───────────────────────────────────────

/**
 * Scrape a team's full match list from the public fotball.no team page.
 * Returns matches with matchReportId values that are identical to FIKS
 * matchReportIds — usable directly with scrapeSquad().
 *
 * This is the correct way to get all matches for a team we don't admin in FIKS,
 * since FIKS team pages only show full match tables to the owning club's admins.
 */
export async function scrapeTeamMatchList(teamFiksId: string): Promise<PublicMatchInfo[]> {
  try {
    const res = await httpClient.get(
      `${BASE}/lag/hjem/?fiksId=${teamFiksId}`,
      { timeout: 8000 },
    );
    const $ = load(res.data as string);
    const matches: PublicMatchInfo[] = [];
    const seen = new Set<string>();

    // Row structure (from fotball.no table):
    //   td[0] <a kamp>dd.mm.yyyy</a>   date (as a match link)
    //   td[1]  day-of-week text
    //   td[2]  HH:MM                   time
    //   td[3] <a lag>HomeTeam</a>       home team
    //   td[4] <a kamp>N - N</a>         score (or nothing for upcoming)
    //   td[5] <a lag>AwayTeam</a>       away team
    //   td[6] venue, td[7] tournament, …
    $('tr').each((_, row) => {
      const matchLinks = $(row).find('a[href*="/fotballdata/kamp/"]');
      if (matchLinks.length === 0) return;

      // Get matchReportId from any match link
      const matchHref = matchLinks.first().attr('href') ?? '';
      const matchReportId = matchHref.match(/fiksId=(\d+)/)?.[1] ?? '';
      if (!matchReportId || seen.has(matchReportId)) return;
      seen.add(matchReportId);

      // Date: match link whose text is a date
      let date = '';
      matchLinks.each((_, el) => {
        const text = $(el).text().trim();
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) date = text;
      });

      // Time: td whose text is exactly HH:MM
      let time = '';
      $(row).find('td').each((_, td) => {
        const text = $(td).text().trim();
        if (/^\d{2}:\d{2}$/.test(text) && !time) time = text;
      });

      // Teams: links to /fotballdata/lag/hjem/
      const teamLinks = $(row).find('a[href*="/fotballdata/lag/hjem/"]');
      const homeTeam = teamLinks.eq(0).text().trim();
      const awayTeam = teamLinks.eq(1).text().trim();

      // Score: match link whose text is "N - N" (played) — undefined if upcoming
      let result: string | undefined;
      matchLinks.each((_, el) => {
        const text = $(el).text().trim();
        if (/^\d+\s*-\s*\d+$/.test(text)) {
          result = text.replace(/\s+/g, '');
        }
      });

      if (matchReportId) {
        matches.push({ matchReportId, date, time, homeTeam, awayTeam, result });
      }
    });

    return matches;
  } catch {
    return [];
  }
}

// ── Match events from fotball.no (public, Cheerio) ──────────────────────────

/**
 * Scrape goal/card events from a fotball.no match page.
 * Public, no auth needed, fast Cheerio parse (~200ms per match).
 *
 * HTML structure:
 *   div.timelineEventLine.homeTeam / .awayTeam
 *     div.timelineMinute  → "23'"
 *     a.eventHeading      → player name
 *     div (after heading)  → "Spillemål" | "Straffemål" | "Selvmål" | "Advarsel"
 */
export async function scrapeMatchEvents(matchReportId: string): Promise<MatchEvent[]> {
  try {
    const res = await httpClient.get(
      `${BASE}/kamp/?fiksId=${matchReportId}`,
      { timeout: 6000 },
    );
    const $ = load(res.data as string);
    const events: MatchEvent[] = [];

    $('.timelineEventLine').each((_, el) => {
      const $el = $(el);
      const classes = $el.attr('class') ?? '';
      const side: 'home' | 'away' = classes.includes('homeTeam') ? 'home' : 'away';

      const minuteText = $el.find('.timelineMinute').text().trim();
      const minuteMatch = minuteText.match(/(\d+)/);
      const minute = minuteMatch ? parseInt(minuteMatch[1]) : undefined;

      const playerName = $el.find('.eventHeading').first().text().trim();
      if (!playerName) return;

      // Event type text is in a div following the .eventHeading link
      const eventContent = $el.find('.timelineEventContent');
      const eventTypeText = eventContent.find('div').last().text().trim().toLowerCase();

      let type: 'goal' | 'card';
      let goalType: MatchEvent['goalType'];
      let cardType: MatchEvent['cardType'];

      if (eventTypeText.includes('selvmål')) {
        type = 'goal'; goalType = 'own';
      } else if (eventTypeText.includes('straffe')) {
        type = 'goal'; goalType = 'penalty';
      } else if (eventTypeText.includes('mål') || eventTypeText.includes('spille')) {
        type = 'goal'; goalType = 'normal';
      } else if (eventTypeText.includes('rødt') || eventTypeText.includes('utvis')) {
        type = 'card'; cardType = 'red';
      } else if (eventTypeText.includes('andre gul') || eventTypeText.includes('2. gul')) {
        type = 'card'; cardType = 'yellow-red';
      } else if (eventTypeText.includes('advarsel') || eventTypeText.includes('gult')) {
        type = 'card'; cardType = 'yellow';
      } else {
        return; // unknown event type — skip
      }

      events.push({ playerName, minute, side, type, goalType, cardType });
    });

    return events;
  } catch {
    return [];
  }
}

// ── Match squad from fotball.no (public, Cheerio) ────────────────────────────

/**
 * Scrape squad/lineup from a fotball.no match page.
 * Public, no auth needed, fast Cheerio parse.
 *
 * HTML structure:
 *   li.homeTeamWrapper / li.awayTeamWrapper
 *     h4 "Startoppstilling:" / "Innbyttere:"
 *     div.matchPlayerListItem
 *       div.playerNumber → jersey number
 *       a.playerName     → player name
 *
 * No position info is available on fotball.no — all players get position 'Ukjent'.
 */
export async function scrapeMatchSquad(matchReportId: string): Promise<Squad> {
  try {
    const res = await httpClient.get(
      `${BASE}/kamp/?fiksId=${matchReportId}`,
      { timeout: 6000 },
    );
    const $ = load(res.data as string);

    function extractPlayers(wrapper: string): Player[] {
      const players: Player[] = [];
      $(wrapper).find('.matchPlayerListItem').each((_, el) => {
        const numberText = $(el).find('.playerNumber').text().trim();
        const name = $(el).find('.playerName').text().trim();
        if (!name) return;
        players.push({
          name,
          jerseyNumber: parseInt(numberText) || 0,
          position: 'Ukjent',
        });
      });
      return players;
    }

    const home = extractPlayers('.homeTeamWrapper');
    const away = extractPlayers('.awayTeamWrapper');

    return {
      ready: home.length > 0 || away.length > 0,
      home,
      away,
    };
  } catch {
    return { ready: false, home: [], away: [] };
  }
}
