import { NextResponse } from 'next/server';
import { G16_TEAMS } from '@/lib/mockData';
import { scrapeTeamMatches } from '@/lib/scraper';
import { readSyncedData } from '@/lib/fiksSync';
import type { Team } from '@/lib/types';

function findTeam(fiksId: string, synced: ReturnType<typeof readSyncedData>): Team | undefined {
  const g16 = G16_TEAMS.find((t) => t.fiksId === fiksId);
  if (g16) return g16;
  if (synced?.clubTeams) {
    for (const teams of Object.values(synced.clubTeams)) {
      const found = teams.find((t) => t.fiksId === fiksId);
      if (found) return found;
    }
  }
  return undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fiksId: string }> }
) {
  const { fiksId } = await params;
  const synced = readSyncedData();

  // 1. Use synced FIKS data if available
  if (synced?.matches[fiksId]?.length) {
    return NextResponse.json({ matches: synced.matches[fiksId], source: 'fiks' });
  }

  const team = findTeam(fiksId, synced);
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 2. Try live scrape from fotball.no
  const scraped = await scrapeTeamMatches(team);
  if (scraped.length > 0) {
    return NextResponse.json({ matches: scraped, source: 'scraper' });
  }

  return NextResponse.json({ matches: [], source: 'none' });
}
