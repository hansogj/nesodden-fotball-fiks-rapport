import { NextResponse } from 'next/server';
import { readSyncedData } from '@/lib/fiksSync';
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
 * Returns all matches in synced-data where the given club appeared,
 * sorted by date descending. Excludes the match identified by `exclude`.
 *
 * Searches both Nesodden matches (matches) and opponent team matches
 * (opponentMatches), so results capture sibling-team player sharing
 * regardless of whether those matches involved Nesodden.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const { searchParams } = new URL(req.url);
  const exclude = searchParams.get('exclude') ?? '';

  const synced = readSyncedData();
  if (!synced) return NextResponse.json([]);

  const appearances: ClubAppearance[] = [];

  // ── Determine the current match's opponent team division (for isHigher) ──────
  // Find which opponent team played in the excluded match so we can compare levels.
  let currentTeamDivision = '';
  if (exclude && synced.opponentTeams && synced.opponentMatches) {
    outer: for (const [teamFiksId, teamMatches] of Object.entries(synced.opponentMatches)) {
      for (const m of teamMatches) {
        if (m.matchReportId === exclude) {
          currentTeamDivision = synced.opponentTeams[teamFiksId]?.division ?? '';
          break outer;
        }
      }
    }
  }
  // Fallback: check Nesodden matches (shouldn't be needed, but safe)
  if (!currentTeamDivision && exclude) {
    for (const [nesoddenFiksId, teamMatches] of Object.entries(synced.matches)) {
      for (const m of teamMatches) {
        if (m.matchReportId === exclude) {
          const nesoddenTeam = G16_TEAMS.find(t => t.fiksId === nesoddenFiksId);
          // current team here is the Nesodden team — not what we want for opponent comparison
          // Leave empty; isHigher will be relative to nothing meaningful
          void nesoddenTeam;
          break;
        }
      }
    }
  }

  const currentRank = divisionRank(currentTeamDivision);

  // ── Search Nesodden matches ────────────────────────────────────────────────
  for (const [nesoddenTeamFiksId, teamMatches] of Object.entries(synced.matches)) {
    const nesoddenTeam = G16_TEAMS.find(t => t.fiksId === nesoddenTeamFiksId);

    for (const match of teamMatches) {
      if (!match.matchReportId || match.matchReportId === exclude) continue;

      const clubSide: 'home' | 'away' | null =
        match.homeClubId === clubId ? 'home' :
        match.awayClubId === clubId ? 'away' :
        null;

      if (!clubSide) continue;

      const squad = synced.squads[match.matchReportId];
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
  if (synced.opponentMatches && synced.opponentTeams) {
    for (const [teamFiksId, teamMatches] of Object.entries(synced.opponentMatches)) {
      const opponentTeam = synced.opponentTeams[teamFiksId];
      if (!opponentTeam || opponentTeam.clubId !== clubId) continue;

      for (const match of teamMatches) {
        if (!match.matchReportId || match.matchReportId === exclude) continue;

        // Check this team is home or away using homeClubId/awayClubId
        const clubSide: 'home' | 'away' | null =
          match.homeClubId === clubId ? 'home' :
          match.awayClubId === clubId ? 'away' :
          null;

        if (!clubSide) continue;

        const squad = synced.squads[match.matchReportId];
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

  // Most recent first; deduplicate by matchReportId (same match could appear in multiple
  // opponent team entries if two sibling teams played each other — unlikely but safe)
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
