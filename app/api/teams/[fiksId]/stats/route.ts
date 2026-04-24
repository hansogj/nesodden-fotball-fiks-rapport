import { NextResponse } from 'next/server';
import { computeTeamStats } from '@/lib/stats';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;
  const stats = await computeTeamStats(fiksId);

  if (!stats) {
    return NextResponse.json({ error: 'No stats available' }, { status: 404 });
  }

  return NextResponse.json(stats);
}
