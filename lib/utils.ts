import type { Match, Squad, PlayerGoalStats, PlayerCardStats } from './types';

/** Parse dd.mm.yyyy to epoch ms */
export function dateMs(date: string): number {
  const [d, m, y] = date.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Lower division number = higher level. Returns 99 if unparseable. */
export function divisionRank(division: string): number {
  const m = division.match(/(\d+)\.\s*div(?:isjon|\.)/i);
  return m ? parseInt(m[1]) : 99;
}

/** Extract age group code from label, e.g. "G16 2. divisjon" → "G16" */
export function extractAgeGroup(label: string): string | null {
  const m = label.match(/\b([GJ])(\d{2})\b/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2]}`;
}

/** Sort age groups: G before J, then by numeric age, filtering out age < minAge */
export function sortAgeGroups(ags: string[], minAge = 12): string[] {
  return [...ags]
    .filter((ag) => parseInt(ag.slice(1)) >= minAge)
    .sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      return parseInt(a.slice(1)) - parseInt(b.slice(1));
    });
}

/** Find the most frequent tournament in a list of matches */
export function primaryTournament(matches: Match[]): string {
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

/** Determine which side a team played in a match */
export function findTeamSide(m: Match, fiksId: string): 'home' | 'away' | null {
  if (m.homeTeamId === fiksId) return 'home';
  if (m.awayTeamId === fiksId) return 'away';
  if (m.isHome) return 'home';
  return 'away';
}

/** Compute top goal scorers from match + squad data */
export function computeTopScorers(
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

/** Compute card stats for a team from match + squad data */
export function computeCards(
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
