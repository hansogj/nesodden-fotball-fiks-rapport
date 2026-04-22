'use client';
import { useState, useCallback, memo } from 'react';
import type { Match, Player, Team, MatchEvent } from '@/lib/types';
import { TeamEmblem } from './TeamEmblem';
import { PlayerList } from './PlayerList';
import { CrossTeamPlayers } from './CrossTeamPlayers';

const NESODDEN_CLUB_ID = '82';

function isPastMatch(date: string, time: string): boolean {
  try {
    const [d, m, y] = date.split('.').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const matchEnd = new Date(y, m - 1, d, hh + 2, mm);
    return matchEnd < new Date();
  } catch {
    return false;
  }
}

interface Props { match: Match; nesoddenTeamId: string; allTeams: Team[] }

export const MatchCard = memo(function MatchCard({ match, nesoddenTeamId, allTeams }: Props) {
  const [open, setOpen] = useState(false);
  const [nesoddenPlayers, setNesoddenPlayers] = useState<Player[] | null>(null);
  const [opponentPlayers, setOpponentPlayers] = useState<Player[] | null>(null);
  const [squadReady, setSquadReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [matchEvents, setMatchEvents] = useState<MatchEvent[]>([]);

  const isHomeNesodden = match.homeClubId === NESODDEN_CLUB_ID;
  const opponentTeamId = isHomeNesodden ? match.awayTeamId : match.homeTeamId;
  const opponentName   = isHomeNesodden ? match.awayTeam   : match.homeTeam;
  const nesoddenName   = isHomeNesodden ? match.homeTeam   : match.awayTeam;
  const past = isPastMatch(match.date, match.time);

  const toggle = useCallback(async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (nesoddenPlayers !== null) return;
    setLoading(true);
    try {
      if (match.matchReportId) {
        // Fetch match-specific kamptropp from FIKS sync data
        const squad = await fetch(`/api/squads/${match.matchReportId}`).then((r) => r.json());
        setSquadReady(squad.ready ?? false);
        setMatchEvents(squad.events ?? []);
        if (squad.ready) {
          const homeIsNesodden = match.homeClubId === NESODDEN_CLUB_ID;
          setNesoddenPlayers(homeIsNesodden ? squad.home : squad.away);
          setOpponentPlayers(homeIsNesodden ? squad.away : squad.home);
        } else {
          setNesoddenPlayers([]);
          setOpponentPlayers([]);
        }
      } else {
        // Fallback: general team roster
        const [nesRes, oppRes] = await Promise.all([
          fetch(`/api/teams/${nesoddenTeamId}/players`).then((r) => r.json()),
          opponentTeamId
            ? fetch(`/api/teams/${opponentTeamId}/players`).then((r) => r.json())
            : Promise.resolve({ players: [] }),
        ]);
        setSquadReady(true);
        setNesoddenPlayers(nesRes.players ?? []);
        setOpponentPlayers(oppRes.players ?? []);
      }
    } catch {
      setSquadReady(false);
      setNesoddenPlayers([]);
      setOpponentPlayers([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nesoddenPlayers, match.matchReportId, nesoddenTeamId, opponentTeamId]);

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${past ? 'border-dark-border bg-dark-surface' : 'border-dark-border bg-dark-card hover:border-nesodden-red/40'}`}>
      <button onClick={toggle} className="w-full text-left p-4 group">
        {/* Meta row */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs text-dark-muted flex-wrap">
            <span className="text-gray-400 font-medium">{match.date}</span>
            {match.time && <><span>·</span><span>{match.time}</span></>}
            <span>·</span>
            {match.isHome
              ? <span className="text-green-400 font-medium">Hjemmekamp</span>
              : <span className="text-blue-400 font-medium">Bortekamp</span>}
            {match.matchReportId && (
              <>
                <span>·</span>
                <a
                  href={`https://fiks.fotball.no/FiksWeb/MatchReport/View/${match.matchReportId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-dark-muted hover:text-white transition-colors flex items-center gap-1"
                >
                  FIKS
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </>
            )}
          </div>
          <span className="text-dark-muted text-xs group-hover:text-white transition-colors">
            {open ? '▲' : '▼'}
          </span>
        </div>

        {/* Teams */}
        <div className="flex items-center gap-3 sm:gap-6">
          {/* Home */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
            <TeamEmblem logoUrl={match.homeLogoUrl} teamName={match.homeTeam} size="lg" />
            <div className="min-w-0">
              <p className={`font-semibold text-sm truncate ${match.homeClubId === NESODDEN_CLUB_ID ? 'text-white' : 'text-gray-300'}`}>{match.homeTeam}</p>
              <p className="text-xs text-dark-muted">Hjemmelag</p>
            </div>
          </div>

          {/* VS / Score */}
          <div className="shrink-0 text-center min-w-[3rem]">
            {match.result ? (
              <span className="text-lg font-bold text-white tabular-nums">{match.result}</span>
            ) : (
              <span className="text-base font-bold text-dark-muted">vs</span>
            )}
          </div>

          {/* Away */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 justify-end text-right">
            <div className="min-w-0">
              <p className={`font-semibold text-sm truncate ${match.awayClubId === NESODDEN_CLUB_ID ? 'text-white' : 'text-gray-300'}`}>{match.awayTeam}</p>
              <p className="text-xs text-dark-muted">Bortelag</p>
            </div>
            <TeamEmblem logoUrl={match.awayLogoUrl} teamName={match.awayTeam} size="lg" />
          </div>
        </div>

        {/* Venue */}
        {match.venue && (
          <p className="mt-3 text-xs text-dark-muted flex items-center gap-1">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {match.venue}
          </p>
        )}
      </button>

      {/* Kamptropp */}
      {open && (
        <div className="border-t border-dark-border animate-fade-in">
          {loading ? (
            <div className="p-6 text-center text-dark-muted text-sm animate-pulse">Laster kamptropp…</div>
          ) : squadReady === false ? (
            <div className="p-6 text-center text-dark-muted">
              <svg className="w-8 h-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-sm font-medium">Kamptropp ikke klar enda</p>
              <p className="text-xs mt-1 opacity-60">Troppen publiseres typisk dagen før kamp</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-dark-border">
                <div className="p-4">
                  <PlayerList
                    players={isHomeNesodden ? (nesoddenPlayers ?? []) : (opponentPlayers ?? [])}
                    teamName={isHomeNesodden ? nesoddenName : opponentName}
                    isNesodden={isHomeNesodden}
                    events={matchEvents}
                    side="home"
                  />
                </div>
                <div className="p-4">
                  <PlayerList
                    players={isHomeNesodden ? (opponentPlayers ?? []) : (nesoddenPlayers ?? [])}
                    teamName={isHomeNesodden ? opponentName : nesoddenName}
                    isNesodden={!isHomeNesodden}
                    events={matchEvents}
                    side="away"
                  />
                </div>
              </div>
              {((nesoddenPlayers?.length ?? 0) > 0 || (opponentPlayers?.length ?? 0) > 0) && (
                <CrossTeamPlayers
                  nesoddenPlayers={nesoddenPlayers ?? []}
                  currentTeamFiksId={nesoddenTeamId}
                  allTeams={allTeams}
                  opponentPlayers={opponentPlayers ?? []}
                  opponentClubId={isHomeNesodden ? match.awayClubId : match.homeClubId}
                  currentMatchReportId={match.matchReportId}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});
