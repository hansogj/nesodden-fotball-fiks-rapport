import { NextResponse } from 'next/server';
import { readAllTeamMatches, readSquads, readOpponents, readClubData } from '@/lib/fiksSync';
import { NESODDEN_CLUB_ID } from '@/lib/mockData';
import type { ClubAppearance } from '@/lib/types';

function dateMs(date: string): number {
  const [d, m, y] = date.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function divisionRank(division: string): number {
  const m = division.match(/(\d+)\.\s*div(?:isjon|\.)/i);
  return m ? parseInt(m[1]) : 99;
}

/**
 * GET /api/clubs/[clubId]/squads?exclude=<matchReportId>
 *
 * Returns all matches in synced data where the given club appeared,
 * sorted by date descending. Excludes the match identified by `exclude`.
 *
 * Searches both Nesodden matches and opponent team matches,
 * so results capture sibling-team player sharing regardless of
 * whether those matches involved Nesodden.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const { searchParams } = new URL(req.url);
  const exclude = searchParams.get('exclude') ?? '';

  const allMatches = readAllTeamMatches();
  const squads = readSquads();
  const opponents = readOpponents();
  const opponentMatches = opponents?.matches ?? {};
  const opponentTeams = opponents?.teams ?? {};

  if (Object.keys(allMatches).length === 0 && Object.keys(opponentMatches).length === 0) {
    return NextResponse.json([]);
  }

  // ── Build age-group map for Nesodden teams ─────────────────────────────────
  const clubData = readClubData();
  const nesoddenAgeGroupMap: Record<string, string> = {};
  if (clubData?.clubTeams) {
    for (const [ag, teams] of Object.entries(clubData.clubTeams)) {
      for (const t of teams) nesoddenAgeGroupMap[t.fiksId] = ag;
    }
  }

  // ── Identify the team that played in the excluded match ────────────────────
  // This team's other appearances are filtered out so only sibling teams remain.
  let excludeTeamFiksId = '';
  let excludeAgeGroup = '';
  let currentTeamDivision = '';
  let excludeMatchDate = '';

  if (exclude) {
    if (clubId === NESODDEN_CLUB_ID) {
      // For Nesodden queries, find the Nesodden team that played in the excluded match
      for (const [nesoddenFiksId, teamMatchList] of Object.entries(allMatches)) {
        const match = teamMatchList.find(m => m.matchReportId === exclude);
        if (match) {
          excludeTeamFiksId = nesoddenFiksId;
          excludeAgeGroup = nesoddenAgeGroupMap[nesoddenFiksId] ?? '';
          excludeMatchDate = match.date;
          const clubTeam = clubData?.clubTeams?.[excludeAgeGroup]?.find(t => t.fiksId === nesoddenFiksId);
          currentTeamDivision = clubTeam?.division ?? '';
          break;
        }
      }
    } else {
      // For opponent queries, find the opponent team from the queried club
      for (const [teamFiksId, teamMatchList] of Object.entries(opponentMatches)) {
        const opponentTeam = opponentTeams[teamFiksId];
        if (!opponentTeam || opponentTeam.clubId !== clubId) continue;
        const match = teamMatchList.find(m => m.matchReportId === exclude);
        if (match) {
          excludeTeamFiksId = teamFiksId;
          excludeAgeGroup = opponentTeam.ageGroup ?? '';
          currentTeamDivision = opponentTeam.division ?? '';
          excludeMatchDate = match.date;
          break;
        }
      }
    }
  }

  const currentRank = divisionRank(currentTeamDivision);
  const appearances: ClubAppearance[] = [];

  // ── Search Nesodden matches (only for Nesodden club queries) ──────────────
  for (const [nesoddenTeamFiksId, teamMatchList] of Object.entries(allMatches)) {
    if (clubId !== NESODDEN_CLUB_ID) break;
    // Skip same team and wrong age group
    if (nesoddenTeamFiksId === excludeTeamFiksId) continue;
    if (excludeAgeGroup && nesoddenAgeGroupMap[nesoddenTeamFiksId] !== excludeAgeGroup) continue;

    const clubTeam = clubData?.clubTeams?.[nesoddenAgeGroupMap[nesoddenTeamFiksId] ?? '']?.find(
      t => t.fiksId === nesoddenTeamFiksId
    );

    for (const match of teamMatchList) {
      if (!match.matchReportId || match.matchReportId === exclude) continue;

      const clubSide: 'home' | 'away' | null =
        match.homeClubId === clubId ? 'home' :
        match.awayClubId === clubId ? 'away' :
        null;

      if (!clubSide) continue;

      const squad = squads[match.matchReportId];
      if (!squad) continue;

      const teamName = clubTeam?.name ?? `Nesodden ${nesoddenTeamFiksId}`;
      const division = clubTeam?.division ?? '';
      const siblingRank = divisionRank(division);

      appearances.push({
        matchReportId: match.matchReportId,
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        teamFiksId: nesoddenTeamFiksId,
        teamName,
        division,
        isHigher: currentRank !== 99 ? siblingRank < currentRank : false,
        clubSide,
        squad,
      });
    }
  }

  // ── Search opponent team matches ───────────────────────────────────────────
  for (const [teamFiksId, teamMatchList] of Object.entries(opponentMatches)) {
    const opponentTeam = opponentTeams[teamFiksId];
    if (!opponentTeam || opponentTeam.clubId !== clubId) continue;
    // Skip same team and wrong age group
    if (teamFiksId === excludeTeamFiksId) continue;
    if (excludeAgeGroup && opponentTeam.ageGroup !== excludeAgeGroup) continue;

    for (const match of teamMatchList) {
      if (!match.matchReportId || match.matchReportId === exclude) continue;

      const clubSide: 'home' | 'away' | null =
        match.homeClubId === clubId ? 'home' :
        match.awayClubId === clubId ? 'away' :
        null;

      if (!clubSide) continue;

      const squad = squads[match.matchReportId];
      if (!squad) continue;

      const siblingRank = divisionRank(opponentTeam.division);

      appearances.push({
        matchReportId: match.matchReportId,
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        teamFiksId,
        teamName: opponentTeam.name,
        division: opponentTeam.division,
        isHigher: currentRank !== 99 ? siblingRank < currentRank : false,
        clubSide,
        squad,
      });
    }
  }

  // Only matches on or before the current match date (prior games)
  const cutoff = excludeMatchDate ? dateMs(excludeMatchDate) : Infinity;
  const prior = appearances.filter(a => dateMs(a.date) <= cutoff);

  // Most recent first; keep only the latest match with a ready squad per sibling team
  prior.sort((a, b) => dateMs(b.date) - dateMs(a.date));
  const perTeam = new Map<string, ClubAppearance>();
  for (const a of prior) {
    if (!perTeam.has(a.teamFiksId) && a.squad.ready) {
      perTeam.set(a.teamFiksId, a);
    }
  }

  return NextResponse.json(Array.from(perTeam.values()));
}
