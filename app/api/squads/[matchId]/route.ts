import { NextResponse } from 'next/server';
import { readSquad } from '@/lib/fiksSync';

/** GET /api/squads/[matchId] — returns kamptropp for a specific match */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const squad = readSquad(matchId);

  if (!squad) {
    return NextResponse.json({ ready: false, home: [], away: [] });
  }

  return NextResponse.json(squad);
}
