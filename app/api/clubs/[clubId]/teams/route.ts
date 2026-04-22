import { NextResponse } from 'next/server';
import { readClubData, writeClubData } from '@/lib/fiksSync';
import { G16_TEAMS, NESODDEN_CLUB_ID } from '@/lib/mockData';
import { scrapeClubTeams } from '@/lib/scraper';
import type { Team } from '@/lib/types';

function sortAgeGroups(ags: string[]): string[] {
  return [...ags].sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]); // G before J
    return parseInt(a.slice(1)) - parseInt(b.slice(1));  // numeric within gender
  });
}

/**
 * Enrich scraped teams with division data from hardcoded sources.
 * Names always come from the live scrape (FIKS is authoritative for names).
 */
function enrich(teams: Record<string, Team[]>, clubId: string): Record<string, Team[]> {
  if (clubId !== NESODDEN_CLUB_ID || !teams.G16) return teams;
  return {
    ...teams,
    G16: teams.G16.map((t) => {
      const known = G16_TEAMS.find((g) => g.fiksId === t.fiksId);
      return known ? { ...t, division: known.division || t.division } : t;
    }),
  };
}

/**
 * GET /api/clubs/[clubId]/teams
 *
 * Returns all known teams for a club, grouped by age group.
 *
 * Priority:
 *  1. club.json  clubTeams  (populated by npm run sync)
 *  2. Live scrape from fotball.no  (written back to club.json as cache)
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
    const ageGroups = sortAgeGroups(Object.keys(club.clubTeams));
    return NextResponse.json({ ageGroups, teams: club.clubTeams, source: 'synced' });
  }

  // 2. Live scrape from fotball.no
  const scraped = await scrapeClubTeams(clubId);
  if (Object.keys(scraped).length > 0) {
    const enriched = enrich(scraped, clubId);

    // Cache to club.json so the next load is instant
    try {
      writeClubData({ clubTeams: enriched, lastSynced: new Date().toISOString() });
    } catch {
      // non-fatal — just don't cache
    }

    const ageGroups = sortAgeGroups(Object.keys(enriched));
    return NextResponse.json({ ageGroups, teams: enriched, source: 'scraped' });
  }

  // 3. Hardcoded G16 fallback for Nesodden
  if (clubId === NESODDEN_CLUB_ID) {
    return NextResponse.json({ ageGroups: ['G16'], teams: { G16: G16_TEAMS }, source: 'fallback' });
  }

  return NextResponse.json({ ageGroups: [], teams: {}, source: 'empty' });
}
