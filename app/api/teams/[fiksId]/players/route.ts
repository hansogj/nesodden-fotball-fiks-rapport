import { NextResponse } from 'next/server';
import { readSyncedData } from '@/lib/fiksSync';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;

  const synced = readSyncedData();
  if (synced?.players[fiksId]?.length) {
    return NextResponse.json({ players: synced.players[fiksId], source: 'fiks' });
  }

  return NextResponse.json({ players: [], source: 'none' });
}
