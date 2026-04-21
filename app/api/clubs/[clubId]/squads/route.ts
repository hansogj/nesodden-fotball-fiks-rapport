import { NextResponse } from 'next/server';
import { readAllTeamMatches, readSquads, readOpponents } from '@/lib/fiksSync';
import { G16_TEAMS } from '@/lib/mockData';
import type { ClubAppearance } from '@/lib/types';

function dateMs(date: string): number {
  const [d, m, y] = date.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function divisionRank(division: string): number {
  const m = division.match(/(\d+)\.\s*divisjon/i);
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

  const appearances: ClubAppearance[] = [];

  // ── Determine the current match's opponent team division (for isHigher) ──────
  let currentTeamDivision = '';
  if (exclude && Object.keys(opponentTeams).length > 0) {
    outer: for (const [teamFiksId, teamMatchList] of Object.entries(opponentMatches)) {
      for (const m of teamMatchList) {
        if (m.matchReportId === exclude) {
          currentTeamDivision = opponentTeams[teamFiksId]?.division ?? '';
          break outer;
        }
      }
    }
  }
  // Fallback: check Nesodden matches
  if (!currentTeamDivision && exclude) {
    for (const [nesoddenFiksId, teamMatchList] of Object.entries(allMatches)) {
      for (const m of teamMatchList) {
        if (m.matchReportId === exclude) {
          const nesoddenTeam = G16_TEAMS.find(t => t.fiksId === nesoddenFiksId);
          void nesoddenTeam;
          break;
        }
      }
    }
  }

  const currentRank = divisionRank(currentTeamDivision);

  // ── Search Nesodden matches ────────────────────────────────────────────────
  for (const [nesoddenTeamFiksId, teamMatchList] of Object.entries(allMatches)) {
    const nesoddenTeam = G16_TEAMS.find(t => t.fiksId === nesoddenTeamFiksId);

    for (const match of teamMatchList) {
      if (!match.matchReportId || match.matchReportId === exclude) continue;

      const clubSide: 'home' | 'away' | null =
        match.homeClubId === clubId ? 'home' :
        match.awayClubId === clubId ? 'away' :
        null;

      if (!clubSide) continue;

      const squad = squads[match.matchReportId];
      if (!squad) continue;

      const teamName = nesoddenTeam?.name ?? `Nesodden ${nesoddenTeamFiksId}`;
      const division = nesoddenTeam?.division ?? '';
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
  if (Object.keys(opponentMatches).length > 0) {
    for (const [teamFiksId, teamMatchList] of Object.entries(opponentMatches)) {
      const opponentTeam = opponentTeams[teamFiksId];
      if (!opponentTeam || opponentTeam.clubId !== clubId) continue;

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
  }

  // Most recent first; deduplicate by matchReportId
  const seen = new Set<string>();
  const deduped = appearances
    .sort((a, b) => dateMs(b.date) - dateMs(a.date))
    .filter(a => {
      const key = `${a.teamFiksId}:${a.matchReportId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return NextResponse.json(deduped);
}
