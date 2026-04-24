import axios from 'axios';
import { load } from 'cheerio';
import type { StandingsEntry, Team } from './types';

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

function extractAgeGroup(label: string): string | null {
  const m = label.match(/\b([GJ])(\d{2})\b/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

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
