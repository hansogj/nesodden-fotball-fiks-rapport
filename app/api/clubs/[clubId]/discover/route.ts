import { NextResponse } from 'next/server';
import { readOpponents, writeOpponents, readSquads, writeSquads } from '@/lib/fiksSync';
import { scrapeClubAgeGroupTeams, scrapeTeamMatchList, scrapeMatchSquad, scrapeMatchEvents } from '@/lib/scraper';
import type { Match, OpponentTeam } from '@/lib/types';

/**
 * POST /api/clubs/[clubId]/discover?ageGroup=G16
 *
 * On-demand discovery of sibling teams for a club in a given age group.
 * Scrapes the fotball.no club page, finds teams not yet in opponents.json,
 * scrapes their recent match squads, and persists the data.
 *
 * Returns { newTeams: number, newSquads: number }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ clubId: string }> }
) {
  const { clubId } = await params;
  const { searchParams } = new URL(req.url);
  const ageGroup = searchParams.get('ageGroup');

  if (!ageGroup) {
    return NextResponse.json({ error: 'ageGroup required' }, { status: 400 });
  }

  const opponents = readOpponents();
  const opponentMatches = { ...(opponents?.matches ?? {}) };
  const opponentTeams = { ...(opponents?.teams ?? {}) };
  const squads = readSquads();
  const knownTeamIds = new Set(Object.keys(opponentTeams));

  // Discover all teams in this age group from the club page
  const clubTeamsByAg = await scrapeClubAgeGroupTeams(clubId, [ageGroup]);
  const clubTeamList = clubTeamsByAg[ageGroup.toUpperCase()] ?? [];

  const newTeams = clubTeamList.filter(t => !knownTeamIds.has(t.fiksId));

  if (newTeams.length === 0) {
    return NextResponse.json({ newTeams: 0, newSquads: 0 });
  }

  // Derive base club name for club ID resolution in match data
  const clubNameMap: Record<string, string> = {};
  for (const t of clubTeamList) {
    const baseName = t.name.replace(/\s+[GJ]\d+(-\d+)?$/i, '').trim().toLowerCase();
    if (baseName) clubNameMap[baseName] = clubId;
    clubNameMap[t.name.toLowerCase()] = clubId;
  }

  let totalNewSquads = 0;

  for (const team of newTeams) {
    const publicMatches = await scrapeTeamMatchList(team.fiksId);
    if (publicMatches.length === 0) continue;

    const teamMatches: Match[] = publicMatches.map(pm => ({
      matchId: `fiks-${pm.matchReportId}`,
      matchReportId: pm.matchReportId,
      date: pm.date,
      time: pm.time,
      homeTeam: pm.homeTeam,
      homeTeamId: '',
      homeClubId: '',
      homeLogoUrl: '',
      awayTeam: pm.awayTeam,
      awayTeamId: '',
      awayClubId: '',
      awayLogoUrl: '',
      venue: '',
      tournament: '',
      isHome: false,
      result: pm.result,
    }));

    // Scrape squads for the 5 most recent played matches
    const playedMatches = teamMatches
      .filter(m => m.matchReportId && m.result)
      .sort((a, b) => {
        const [dA, mA, yA] = a.date.split('.').map(Number);
        const [dB, mB, yB] = b.date.split('.').map(Number);
        return new Date(yB, mB - 1, dB).getTime() - new Date(yA, mA - 1, dA).getTime();
      })
      .slice(0, 5);

    for (const match of playedMatches) {
      if (squads[match.matchReportId!]) continue; // already cached

      const squad = await scrapeMatchSquad(match.matchReportId!);
      if (squad.ready) {
        squad.events = await scrapeMatchEvents(match.matchReportId!);
        squads[match.matchReportId!] = squad;
        totalNewSquads++;
      }
    }

    // Apply club IDs based on known name mappings
    for (const m of teamMatches) {
      const homeKey = m.homeTeam.toLowerCase();
      const awayKey = m.awayTeam.toLowerCase();
      if (!m.homeClubId && clubNameMap[homeKey]) m.homeClubId = clubNameMap[homeKey];
      if (!m.awayClubId && clubNameMap[awayKey]) m.awayClubId = clubNameMap[awayKey];
      if (!m.homeLogoUrl && m.homeClubId) m.homeLogoUrl = `https://images.fotball.no/clublogos/${m.homeClubId}.png`;
      if (!m.awayLogoUrl && m.awayClubId) m.awayLogoUrl = `https://images.fotball.no/clublogos/${m.awayClubId}.png`;
    }

    opponentTeams[team.fiksId] = {
      fiksId: team.fiksId,
      name: team.name,
      clubId,
      division: '',
      ageGroup,
    } satisfies OpponentTeam;

    opponentMatches[team.fiksId] = teamMatches;
  }

  // Persist
  writeSquads(squads);
  writeOpponents({ matches: opponentMatches, teams: opponentTeams });

  return NextResponse.json({ newTeams: newTeams.length, newSquads: totalNewSquads });
}
