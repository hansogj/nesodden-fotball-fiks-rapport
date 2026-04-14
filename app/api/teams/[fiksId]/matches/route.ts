import { NextResponse } from 'next/server';
import { G16_TEAMS, getMockMatches } from '@/lib/mockData';
import { scrapeTeamMatches } from '@/lib/scraper';
import { readSyncedData } from '@/lib/fiksSync';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;
  const team = G16_TEAMS.find((t) => t.fiksId === fiksId);
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 1. Use synced FIKS data if available
  const synced = readSyncedData();
  if (synced?.matches[fiksId]?.length) {
    return NextResponse.json({ matches: synced.matches[fiksId], source: 'fiks' });
  }

  // 2. Try live scrape from fotball.no
  const scraped = await scrapeTeamMatches(team);
  if (scraped.length > 0) {
    return NextResponse.json({ matches: scraped, source: 'scraper' });
  }

  // 3. Fall back to mock data
  return NextResponse.json({ matches: getMockMatches(fiksId), source: 'mock' });
}
