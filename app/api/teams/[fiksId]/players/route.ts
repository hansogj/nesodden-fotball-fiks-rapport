import { NextResponse } from 'next/server';
import { getMockPlayers } from '@/lib/mockData';
import { readSyncedData } from '@/lib/fiksSync';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;

  // 1. Use synced FIKS data if available
  const synced = readSyncedData();
  if (synced?.players[fiksId]?.length) {
    return NextResponse.json({ players: synced.players[fiksId], source: 'fiks' });
  }

  // 2. Fall back to mock data
  return NextResponse.json({ players: getMockPlayers(fiksId), source: 'mock' });
}
