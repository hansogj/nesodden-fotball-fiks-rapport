import { NextResponse } from 'next/server';
import { G16_TEAMS } from '@/lib/mockData';
import { scrapeTeamMatches } from '@/lib/scraper';
import { findAgeGroup, readTeamData, readClubData } from '@/lib/fiksSync';
import type { Team } from '@/lib/types';

function findTeam(fiksId: string): Team | undefined {
  const g16 = G16_TEAMS.find((t) => t.fiksId === fiksId);
  if (g16) return g16;
  const club = readClubData();
  if (club?.clubTeams) {
    for (const teams of Object.values(club.clubTeams)) {
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

  // 1. Use synced FIKS data if available
  const ageGroup = findAgeGroup(fiksId);
  if (ageGroup) {
    const data = readTeamData(ageGroup, fiksId);
    if (data?.matches?.length) {
      return NextResponse.json({ matches: data.matches, source: 'fiks' });
    }
  }

  const team = findTeam(fiksId);
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 2. Try live scrape from fotball.no
  const scraped = await scrapeTeamMatches(team);
  if (scraped.length > 0) {
    return NextResponse.json({ matches: scraped, source: 'scraper' });
  }

  return NextResponse.json({ matches: [], source: 'none' });
}
