import axios from 'axios';
import { load } from 'cheerio';
import type { Match, Player, Team } from './types';
import { NESODDEN_CLUB_ID } from './mockData';

const BASE = 'https://www.fotball.no/fotballdata';

const httpClient = axios.create({
  timeout: 12000,
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

// The fotball.no players page is JavaScript-rendered; scraping is not possible.
// The API route falls back to mock data automatically.
export async function scrapeTeamPlayers(_fiksId: string): Promise<Player[]> {
  return [];
}
