import { NextResponse } from 'next/server';
import { readSyncedData } from '@/lib/fiksSync';

/** GET /api/squads/[matchId] — returns kamptropp for a specific match */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  const { matchId } = await params;
  const synced = readSyncedData();
  const squad = synced?.squads?.[matchId];

  if (!squad) {
    return NextResponse.json({ ready: false, home: [], away: [] });
  }

  return NextResponse.json(squad);
}
