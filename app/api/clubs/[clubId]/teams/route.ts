import { NextResponse } from 'next/server';
import { readClubData, writeClubData } from '@/lib/fiksSync';
import { G16_TEAMS, NESODDEN_CLUB_ID } from '@/lib/mockData';
import { scrapeClubTeams } from '@/lib/scraper';

const MIN_AGE = 12;

function sortAgeGroups(ags: string[]): string[] {
  return [...ags]
    .filter((ag) => parseInt(ag.slice(1)) >= MIN_AGE)
    .sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]); // G before J
      return parseInt(a.slice(1)) - parseInt(b.slice(1));  // numeric within gender
    });
}

function filterTeams(teams: Record<string, import('@/lib/types').Team[]>): Record<string, import('@/lib/types').Team[]> {
  return Object.fromEntries(
    Object.entries(teams).filter(([ag]) => parseInt(ag.slice(1)) >= MIN_AGE)
  );
}

/**
 * GET /api/clubs/[clubId]/teams
 *
 * Returns all known teams for a club, grouped by age group.
 *
 * Priority:
 *  1. club.json  clubTeams  (populated by npm run sync)
 *  2. One-time Cheerio scrape from fotball.no (cached to club.json)
 *  3. Hardcoded G16 fallback for Nesodden
 *
 * Response: { ageGroups: string[], teams: Record<string, Team[]>, source: string }
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const club = readClubData();

  // 1. Synced data (from npm run sync) — richest data, use directly
  if (club?.clubTeams && Object.keys(club.clubTeams).length > 0) {
    const teams = filterTeams(club.clubTeams);
    const ageGroups = sortAgeGroups(Object.keys(teams));
    return NextResponse.json({ ageGroups, teams, source: 'synced' });
  }

  // 2. One-time bootstrap: discover teams from fotball.no, cache to club.json
  const scraped = await scrapeClubTeams(clubId);
  if (Object.keys(scraped).length > 0) {
    try {
      writeClubData({ clubTeams: scraped, lastSynced: new Date().toISOString() });
    } catch { /* non-fatal */ }
    const teams = filterTeams(scraped);
    const ageGroups = sortAgeGroups(Object.keys(teams));
    return NextResponse.json({ ageGroups, teams, source: 'scraped' });
  }

  // 3. Hardcoded G16 fallback for Nesodden
  if (clubId === NESODDEN_CLUB_ID) {
    return NextResponse.json({ ageGroups: ['G16'], teams: { G16: G16_TEAMS }, source: 'fallback' });
  }

  return NextResponse.json({ ageGroups: [], teams: {}, source: 'empty' });
}
