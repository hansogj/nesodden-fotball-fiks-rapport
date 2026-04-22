import { findAgeGroup, readTeamData, readSquads, readOpponents } from './fiksSync';
import type {
  Match,
  Squad,
  StandingsEntry,
  PlayerGoalStats,
  PlayerCardStats,
  TeamStatsResponse,
} from './types';

function parseResult(result: string): [number, number] | null {
  const m = result.match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]), parseInt(m[2])];
}

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
  // Fallback: use isHome (reliable for Nesodden's own matches)
  if (m.isHome) return 'home';
  return 'away';
}

function teamKey(fiksId: string, name: string): string {
  return fiksId || `name:${name}`;
}

function computeStandings(matches: Match[]): StandingsEntry[] {
  const teams = new Map<string, StandingsEntry>();

  function getOrCreate(fiksId: string, name: string): StandingsEntry {
    const key = teamKey(fiksId, name);
    let entry = teams.get(key);
    if (!entry) {
      entry = {
        position: 0, teamName: name, teamFiksId: fiksId,
        played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0,
      };
      teams.set(key, entry);
    }
    return entry;
  }

  const seen = new Set<string>();

  for (const m of matches) {
    if (!m.result || seen.has(m.matchId)) continue;
    seen.add(m.matchId);

    const parsed = parseResult(m.result);
    if (!parsed) continue;
    const [homeGoals, awayGoals] = parsed;

    const home = getOrCreate(m.homeTeamId, m.homeTeam);
    const away = getOrCreate(m.awayTeamId, m.awayTeam);

    home.played++;
    away.played++;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;

    if (homeGoals > awayGoals) {
      home.won++; home.points += 3;
      away.lost++;
    } else if (homeGoals < awayGoals) {
      away.won++; away.points += 3;
      home.lost++;
    } else {
      home.drawn++; home.points += 1;
      away.drawn++; away.points += 1;
    }
  }

  const sorted = [...teams.values()]
    .map((e) => ({ ...e, goalDiff: e.goalsFor - e.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);

  sorted.forEach((e, i) => { e.position = i + 1; });
  return sorted;
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

      // Filter to specific team if requested
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

export function computeTeamStats(fiksId: string): TeamStatsResponse | null {
  const ageGroup = findAgeGroup(fiksId);
  if (!ageGroup) return null;

  const teamData = readTeamData(ageGroup, fiksId);
  if (!teamData?.matches?.length) return null;

  const tournament = primaryTournament(teamData.matches);

  // If tournament field is populated, filter by it; otherwise use all matches
  const teamMatches = tournament
    ? teamData.matches.filter((m) => m.tournament === tournament)
    : teamData.matches;

  // Gather all matches in the same tournament (including opponent-vs-opponent)
  const allMatchesMap = new Map<string, Match>();
  for (const m of teamMatches) allMatchesMap.set(m.matchId, m);

  const opponents = readOpponents();
  if (opponents?.matches) {
    for (const oppMatches of Object.values(opponents.matches)) {
      for (const m of oppMatches) {
        if (!allMatchesMap.has(m.matchId) && (!tournament || m.tournament === tournament)) {
          allMatchesMap.set(m.matchId, m);
        }
      }
    }
  }

  const allTournamentMatches = [...allMatchesMap.values()];
  const squads = readSquads();

  return {
    standings: computeStandings(allTournamentMatches),
    seriesTopScorers: computeTopScorers(allTournamentMatches, squads, null, 10),
    teamTopScorers: computeTopScorers(teamMatches, squads, fiksId, 10),
    teamCards: computeCards(teamMatches, squads, fiksId),
    tournament: tournament || teamData.matches[0]?.tournament || '',
  };
}
