import { NextResponse } from 'next/server';
import { findAgeGroup, readTeamData } from '@/lib/fiksSync';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;

  const ageGroup = findAgeGroup(fiksId);
  if (ageGroup) {
    const data = readTeamData(ageGroup, fiksId);
    if (data?.matches?.length) {
      return NextResponse.json({ matches: data.matches, source: 'synced' });
    }
  }

  return NextResponse.json({ matches: [], source: 'none' });
}
