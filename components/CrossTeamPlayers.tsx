'use client';
import { useState, useEffect } from 'react';
import type { Player, Team, ClubAppearance } from '@/lib/types';
import { NESODDEN_CLUB_ID } from '@/lib/mockData';

function divisionRank(division: string): number {
  const m = division.match(/(\d+)\.\s*divisjon/i);
  return m ? parseInt(m[1]) : 99;
}

function dateMs(date: string): number {
  const [d, mo, y] = date.split('.').map(Number);
  return new Date(y, mo - 1, d).getTime();
}

interface MatchRef {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeClubId: string;
  matchReportId?: string;
  result?: string;
}

interface NesoddenHit {
  team: Team;
  matchDate: string;
  matchLabel: string;
  sharedPlayers: Player[];
  isHigher: boolean;
}

interface OpponentHit {
  nesoddenTeamName: string;
  matchDate: string;
  matchLabel: string;
  sharedPlayers: Player[];
  isHigher: boolean;
}

interface Props {
  nesoddenPlayers: Player[];
  currentTeamFiksId: string;
  allTeams: Team[];
  opponentPlayers?: Player[];
  opponentClubId?: string;
  currentMatchReportId?: string;
}

export function CrossTeamPlayers({
  nesoddenPlayers,
  currentTeamFiksId,
  allTeams,
  opponentPlayers,
  opponentClubId,
  currentMatchReportId,
}: Props) {
  const [nesoddenHits, setNesoddenHits] = useState<NesoddenHit[]>([]);
  const [opponentHits, setOpponentHits] = useState<OpponentHit[]>([]);
  const [checked, setChecked] = useState(false);

  const currentTeam = allTeams.find((t) => t.fiksId === currentTeamFiksId);
  const currentDivRank = divisionRank(currentTeam?.division ?? '');
  const otherTeams = allTeams.filter((t) => t.fiksId !== currentTeamFiksId);

  // Stable keys so effects only re-fire when the actual players change
  const playerKey = nesoddenPlayers.map((p) => p.name).join('|');
  const opponentKey = (opponentPlayers ?? []).map((p) => p.name).join('|');

  useEffect(() => {
    const hasNesodden = nesoddenPlayers.length > 0;
    const hasOpponent = (opponentPlayers?.length ?? 0) > 0 && !!opponentClubId && !!currentMatchReportId;

    if (!hasNesodden && !hasOpponent) {
      setChecked(true);
      return;
    }

    setChecked(false);
    setNesoddenHits([]);
    setOpponentHits([]);

    const tasks: Promise<void>[] = [];

    // ── Nesodden side: check other Nesodden teams' last played matches ──────────
    if (hasNesodden) {
      tasks.push(
        Promise.all(
          otherTeams.map(async (team): Promise<NesoddenHit | null> => {
            const isHigher = divisionRank(team.division) < currentDivRank;
            try {
              const { matches } = (await fetch(`/api/teams/${team.fiksId}/matches`).then((r) =>
                r.json()
              )) as { matches: MatchRef[] };

              const played = matches
                .filter((m) => m.result && m.matchReportId)
                .sort((a, b) => dateMs(b.date) - dateMs(a.date));

              const recent = played.slice(0, 3);
              const squads = await Promise.all(
                recent.map((m) =>
                  fetch(`/api/squads/${m.matchReportId}`).then((r) => r.json() as Promise<{ ready: boolean; home: Player[]; away: Player[] }>)
                )
              );

              for (let i = 0; i < recent.length; i++) {
                const m = recent[i];
                const squad = squads[i];
                if (!squad.ready) continue;

                const nesoddenIsHome = m.homeClubId === NESODDEN_CLUB_ID;
                const nesoddenFromOther = nesoddenIsHome ? squad.home : squad.away;

                const shared = nesoddenPlayers.filter((p) =>
                  nesoddenFromOther.some(
                    (op) => op.name.toLowerCase().trim() === p.name.toLowerCase().trim()
                  )
                );

                return {
                  team,
                  matchDate: m.date,
                  matchLabel: `${m.homeTeam} vs ${m.awayTeam}`,
                  sharedPlayers: shared,
                  isHigher,
                };
              }
              return null;
            } catch {
              return null;
            }
          })
        ).then((results) => {
          setNesoddenHits(
            results.filter((r): r is NesoddenHit => r !== null && r.sharedPlayers.length > 0)
          );
        })
      );
    }

    // ── Opponent side: check if opponent players appeared vs other Nesodden teams ─
    if (hasOpponent) {
      tasks.push(
        fetch(`/api/clubs/${opponentClubId}/squads?exclude=${currentMatchReportId}`)
          .then((r) => r.json())
          .then((appearances: ClubAppearance[]) => {
            // Group by nesoddenTeamFiksId — take the most recent ready appearance per team
            const byNesoddenTeam = new Map<string, ClubAppearance>();
            for (const appearance of appearances) {
              if (!appearance.squad.ready) continue;
              if (!byNesoddenTeam.has(appearance.nesoddenTeamFiksId)) {
                byNesoddenTeam.set(appearance.nesoddenTeamFiksId, appearance);
              }
            }

            const hits: OpponentHit[] = [];
            for (const [nesoddenTeamFiksId, appearance] of byNesoddenTeam) {
              const nesoddenTeamInMatch = allTeams.find((t) => t.fiksId === nesoddenTeamFiksId);
              if (!nesoddenTeamInMatch) continue;

              const otherRank = divisionRank(nesoddenTeamInMatch.division);
              const isHigher = otherRank < currentDivRank;

              const oppSide =
                appearance.clubSide === 'home' ? appearance.squad.home : appearance.squad.away;

              const shared = opponentPlayers!.filter((p) =>
                oppSide.some(
                  (op) => op.name.toLowerCase().trim() === p.name.toLowerCase().trim()
                )
              );

              if (shared.length > 0) {
                hits.push({
                  nesoddenTeamName: nesoddenTeamInMatch.name,
                  matchDate: appearance.date,
                  matchLabel: `${appearance.homeTeam} vs ${appearance.awayTeam}`,
                  sharedPlayers: shared,
                  isHigher,
                });
              }
            }
            setOpponentHits(hits);
          })
          .catch(() => {})
      );
    }

    Promise.all(tasks).then(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerKey, opponentKey, opponentClubId, currentTeamFiksId]);

  if (!checked) {
    return (
      <div className="border-t border-dark-border px-4 py-3 text-xs text-dark-muted animate-pulse">
        Sjekker spillerdeling mellom lag…
      </div>
    );
  }

  if (nesoddenHits.length === 0 && opponentHits.length === 0) return null;

  return (
    <div className="border-t border-dark-border p-4 space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-amber-400 flex items-center gap-2">
        <svg
          className="w-3.5 h-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        Spillerdeling mellom lag
      </h4>

      {/* Nesodden players who also played for another Nesodden team */}
      {nesoddenHits.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-dark-muted uppercase tracking-wider font-medium">
            Nesodden-spillere fra forrige runde
          </p>
          {nesoddenHits.map(({ team, matchDate, matchLabel, sharedPlayers, isHigher }) => (
            <div key={team.fiksId}>
              <p className="text-xs text-dark-muted mb-2">
                Spilte sist runde for{' '}
                <span className="font-medium text-white">{team.name}</span>{' '}
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    isHigher
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}
                >
                  {isHigher ? '▲ høyere nivå' : '▼ lavere nivå'}
                </span>{' '}
                <span title={matchLabel}>· {matchDate}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sharedPlayers.map((p) => (
                  <span
                    key={p.name}
                    className="text-xs bg-amber-400/10 border border-amber-400/30 text-amber-300 rounded px-2 py-0.5 font-medium"
                  >
                    #{p.jerseyNumber} {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Opponent players who also played vs another Nesodden team */}
      {opponentHits.length > 0 && (
        <div className="space-y-3">
          <p className="text-[11px] text-dark-muted uppercase tracking-wider font-medium">
            Motstanderspillere fra forrige runde
          </p>
          {opponentHits.map(({ nesoddenTeamName, matchDate, matchLabel, sharedPlayers, isHigher }) => (
            <div key={nesoddenTeamName}>
              <p className="text-xs text-dark-muted mb-2">
                Spilte sist runde mot{' '}
                <span className="font-medium text-white">{nesoddenTeamName}</span>{' '}
                <span
                  className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    isHigher
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}
                >
                  {isHigher ? '▲ høyere nivå' : '▼ lavere nivå'}
                </span>{' '}
                <span title={matchLabel}>· {matchDate}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sharedPlayers.map((p) => (
                  <span
                    key={p.name}
                    className="text-xs bg-amber-400/10 border border-amber-400/30 text-amber-300 rounded px-2 py-0.5 font-medium"
                  >
                    #{p.jerseyNumber} {p.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
