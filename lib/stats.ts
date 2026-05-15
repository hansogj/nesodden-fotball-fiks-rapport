import { findAgeGroup, readTeamData, readSquads, readClubData, readStandings, writeStandings, readOpponents } from './fiksSync';
import { scrapeTournamentStandings, scrapeMatchEvents } from './scraper';
import type {
  Match,
  Squad,
  StandingsEntry,
  PlayerGoalStats,
  PlayerCardStats,
  TeamStatsResponse,
} from './types';

/** Standings are considered fresh for 5 minutes */
const STANDINGS_TTL_MS = 5 * 60 * 1000;

function primaryTournament(matches: Match[]): string {
  const counts = new Map<string, number>();
  for (const m of matches) {
    if (m.tournament) counts.set(m.tournament, (counts.get(m.tournament) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [t, c] of counts) {
    if (c > bestCount) { best = t; bestCount = c; }
  }
  return best;
}

function findTeamSide(m: Match, fiksId: string): 'home' | 'away' | null {
  if (m.homeTeamId === fiksId) return 'home';
  if (m.awayTeamId === fiksId) return 'away';
  if (m.isHome) return 'home';
  return 'away';
}

function computeTopScorers(
  matches: Match[],
  squads: Record<string, Squad>,
  forTeamFiksId: string | null,
  limit: number,
): PlayerGoalStats[] {
  const scorers = new Map<string, { goals: number; teamName: string }>();
  const seen = new Set<string>();

  for (const m of matches) {
    if (!m.result || !m.matchReportId || seen.has(m.matchReportId)) continue;
    seen.add(m.matchReportId);

    const squad = squads[m.matchReportId];
    if (!squad?.events) continue;

    for (const evt of squad.events) {
      if (evt.type !== 'goal' || evt.goalType === 'own') continue;

      if (forTeamFiksId) {
        const teamSide = findTeamSide(m, forTeamFiksId);
        if (!teamSide || evt.side !== teamSide) continue;
      }

      const teamName = evt.side === 'home' ? m.homeTeam : m.awayTeam;
      const existing = scorers.get(evt.playerName);
      if (existing) {
        existing.goals++;
      } else {
        scorers.set(evt.playerName, { goals: 1, teamName });
      }
    }
  }

  return [...scorers.entries()]
    .map(([playerName, { goals, teamName }]) => ({ playerName, teamName, goals }))
    .sort((a, b) => b.goals - a.goals || a.playerName.localeCompare(b.playerName))
    .slice(0, limit);
}

function computeCards(
  matches: Match[],
  squads: Record<string, Squad>,
  forTeamFiksId: string,
): PlayerCardStats[] {
  const cards = new Map<string, PlayerCardStats>();
  const seen = new Set<string>();

  for (const m of matches) {
    if (!m.result || !m.matchReportId || seen.has(m.matchReportId)) continue;
    seen.add(m.matchReportId);

    const squad = squads[m.matchReportId];
    if (!squad?.events) continue;

    const teamSide = findTeamSide(m, forTeamFiksId);
    if (!teamSide) continue;

    for (const evt of squad.events) {
      if (evt.type !== 'card' || evt.side !== teamSide) continue;

      let entry = cards.get(evt.playerName);
      if (!entry) {
        entry = { playerName: evt.playerName, yellow: 0, red: 0, yellowRed: 0 };
        cards.set(evt.playerName, entry);
      }

      if (evt.cardType === 'yellow') entry.yellow++;
      else if (evt.cardType === 'red') entry.red++;
      else if (evt.cardType === 'yellow-red') entry.yellowRed++;
    }
  }

  return [...cards.values()]
    .sort((a, b) => {
      const totalA = a.yellow + a.red * 3 + a.yellowRed * 2;
      const totalB = b.yellow + b.red * 3 + b.yellowRed * 2;
      return totalB - totalA || a.playerName.localeCompare(b.playerName);
    });
}

/**
 * Look up the tournament fiksId for a team from club.json (populated by sync).
 */
function resolveTournamentFiksId(fiksId: string): string | null {
  const club = readClubData();
  if (club?.clubTeams) {
    for (const teams of Object.values(club.clubTeams)) {
      const team = teams.find((t) => t.fiksId === fiksId);
      if (team?.tournamentFiksId) return team.tournamentFiksId;
    }
  }
  return null;
}

/**
 * Refresh standings from fotball.no if the cached entry is stale (older than TTL).
 * Runs inline — the Cheerio scrape is fast (~200ms), no auth needed.
 */
async function refreshStandingsIfStale(
  tournamentFiksId: string,
): Promise<{ standings: StandingsEntry[]; tournament: string }> {
  const allStandings = readStandings();
  const cached = allStandings[tournamentFiksId];

  const isStale = !cached
    || !cached.lastUpdated
    || Date.now() - new Date(cached.lastUpdated).getTime() > STANDINGS_TTL_MS;

  if (!isStale && cached?.standings?.length) {
    return { standings: cached.standings, tournament: cached.tournament };
  }

  // Scrape fresh standings
  const scraped = await scrapeTournamentStandings(tournamentFiksId);
  if (scraped.standings.length > 0) {
    allStandings[tournamentFiksId] = {
      standings: scraped.standings,
      tournament: scraped.tournament,
      lastUpdated: new Date().toISOString(),
    };
    try { writeStandings(allStandings); } catch { /* non-fatal */ }
    return scraped;
  }

  // Scrape returned nothing — keep stale data if we have it
  return cached ?? { standings: [], tournament: '' };
}

/**
 * Collect all tournament matches from Nesodden data + opponents in the same division.
 *
 * Uses standings team IDs to restrict opponent matches to teams in the same division.
 * This prevents goals from other divisions (e.g. G16-1's 2. div) leaking into
 * a different division's top scorer list (e.g. G16-3's 4. div).
 * computeTopScorers deduplicates by matchReportId so matches shared between
 * two opponents' lists are counted once.
 */
function collectTournamentMatches(
  standingsTeamIds: Set<string>,
  nesoddenMatches: Match[],
): Match[] {
  if (standingsTeamIds.size === 0) return nesoddenMatches;

  const opponents = readOpponents();
  if (!opponents?.matches) return nesoddenMatches;

  const all: Match[] = [...nesoddenMatches];

  for (const [teamFiksId, matches] of Object.entries(opponents.matches)) {
    if (!standingsTeamIds.has(teamFiksId)) continue;
    all.push(...matches);
  }

  return all;
}

/**
 * Find played matches with missing events and backfill from fotball.no.
 * Scrapes in batches of 6 (public Cheerio, ~200ms each).
 * Populates the squads map in-place so computeTopScorers/computeCards see the data.
 */
async function backfillMissingEvents(
  matches: Match[],
  squads: Record<string, Squad>,
): Promise<void> {
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const m of matches) {
    if (!m.result || !m.matchReportId || seen.has(m.matchReportId)) continue;
    seen.add(m.matchReportId);

    const squad = squads[m.matchReportId];
    if (squad?.events && squad.events.length > 0) continue;
    missing.push(m.matchReportId);
  }

  if (missing.length === 0) return;

  const BATCH = 6;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((id) => scrapeMatchEvents(id)));
    for (let j = 0; j < batch.length; j++) {
      const events = results[j];
      if (events.length === 0) continue;
      if (!squads[batch[j]]) {
        squads[batch[j]] = { ready: false, home: [], away: [], events };
      } else {
        squads[batch[j]].events = events;
      }
    }
  }
}

export async function computeTeamStats(fiksId: string): Promise<TeamStatsResponse | null> {
  const ageGroup = findAgeGroup(fiksId);
  if (!ageGroup) return null;

  const teamData = readTeamData(ageGroup, fiksId);
  if (!teamData?.matches?.length) return null;

  const tournament = primaryTournament(teamData.matches);

  // Filter to primary tournament for scorer/card stats
  const teamMatches = tournament
    ? teamData.matches.filter((m) => m.tournament === tournament)
    : teamData.matches;

  const squads = readSquads();

  // Read or refresh cached standings
  let standings: StandingsEntry[] = [];
  let tournamentName = tournament || teamData.matches[0]?.tournament || '';

  const tournamentFiksId = resolveTournamentFiksId(fiksId);
  if (tournamentFiksId) {
    const result = await refreshStandingsIfStale(tournamentFiksId);
    if (result.standings.length) {
      standings = result.standings;
      if (result.tournament) tournamentName = result.tournament;
    }
  }

  // Gather tournament matches for league-wide top scorers.
  // Only include opponent teams that appear in the standings (same division).
  const standingsTeamIds = new Set(standings.map((s) => s.teamFiksId));
  const allTournamentMatches = collectTournamentMatches(standingsTeamIds, teamMatches);

  // Backfill events from fotball.no for matches missing event data.
  // This covers opponent matches not yet synced via FIKS Playwright scrape.
  await backfillMissingEvents(allTournamentMatches, squads);

  return {
    standings,
    seriesTopScorers: computeTopScorers(allTournamentMatches, squads, null, 10),
    teamTopScorers: computeTopScorers(teamMatches, squads, fiksId, 10),
    teamCards: computeCards(teamMatches, squads, fiksId),
    tournament: tournamentName,
  };
}
