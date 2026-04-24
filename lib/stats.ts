import { findAgeGroup, readTeamData, readSquads, readClubData, readStandings } from './fiksSync';
import type {
  Match,
  Squad,
  StandingsEntry,
  PlayerGoalStats,
  PlayerCardStats,
  TeamStatsResponse,
} from './types';

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

export function computeTeamStats(fiksId: string): TeamStatsResponse | null {
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

  // Read cached standings (populated by sync)
  let standings: StandingsEntry[] = [];
  let tournamentName = tournament || teamData.matches[0]?.tournament || '';

  const tournamentFiksId = resolveTournamentFiksId(fiksId);
  if (tournamentFiksId) {
    const cached = readStandings()[tournamentFiksId];
    if (cached?.standings?.length) {
      standings = cached.standings;
      if (cached.tournament) tournamentName = cached.tournament;
    }
  }

  return {
    standings,
    seriesTopScorers: computeTopScorers(teamMatches, squads, null, 10),
    teamTopScorers: computeTopScorers(teamMatches, squads, fiksId, 10),
    teamCards: computeCards(teamMatches, squads, fiksId),
    tournament: tournamentName,
  };
}
