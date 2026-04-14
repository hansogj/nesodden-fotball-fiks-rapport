import { NextResponse } from 'next/server';
import { readSyncedData } from '@/lib/fiksSync';
import type { ClubAppearance } from '@/lib/types';

function dateMs(date: string): number {
  const [d, m, y] = date.split('.').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/**
 * GET /api/clubs/[clubId]/squads?exclude=<matchReportId>
 *
 * Returns all matches in synced-data.json where the given club appeared
 * (as home or away) against any Nesodden G16 team, sorted by date descending.
 * Excludes the match identified by `exclude` query param.
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

  for (const [nesoddenTeamFiksId, teamMatches] of Object.entries(synced.matches)) {
    for (const match of teamMatches) {
      if (!match.matchReportId || match.matchReportId === exclude) continue;

      const clubSide: 'home' | 'away' | null =
        match.homeClubId === clubId ? 'home' :
        match.awayClubId === clubId ? 'away' :
        null;

      if (!clubSide) continue;

      const squad = synced.squads[match.matchReportId];
      if (!squad) continue;

      appearances.push({
        matchReportId: match.matchReportId,
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        nesoddenTeamFiksId,
        clubSide,
        squad,
      });
    }
  }

  // Most recent first
  appearances.sort((a, b) => dateMs(b.date) - dateMs(a.date));

  return NextResponse.json(appearances);
}
