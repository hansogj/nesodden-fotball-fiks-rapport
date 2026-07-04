'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Player, ClubAppearance } from '@/lib/types';
import { NESODDEN_CLUB_ID } from '@/lib/mockData';

interface SharingHit {
  siblingTeamName: string;
  latestDate: string;
  latestMatchLabel: string;
  sharedPlayers: Player[];
  isHigher: boolean;
}

/** Normalize player name to lowercase "first last" regardless of source format.
 *  FIKS uses "Last, First" while fotball.no uses "First Last". */
function normalizeName(name: string): string {
  const trimmed = name.toLowerCase().trim();
  const comma = trimmed.indexOf(', ');
  if (comma > 0) {
    return trimmed.slice(comma + 2) + ' ' + trimmed.slice(0, comma);
  }
  return trimmed;
}

interface Props {
  nesoddenPlayers: Player[];
  opponentPlayers?: Player[];
  opponentClubId?: string;
  currentMatchReportId?: string;
  isHomeNesodden: boolean;
  ageGroup?: string;
}

/**
 * Calls the unified /api/clubs/{clubId}/squads endpoint and finds players
 * from `players` who also appeared in any sibling team's squad.
 * The API already filters out same-team and wrong-age-group appearances.
 */
async function checkSharing(
  players: Player[],
  clubId: string,
  matchReportId: string,
): Promise<SharingHit[]> {
  const res = await fetch(`/api/clubs/${clubId}/squads?exclude=${matchReportId}`);
  const appearances: ClubAppearance[] = await res.json();

  // API returns at most one match per sibling team (the most recent prior match)
  const hits: SharingHit[] = [];
  for (const appearance of appearances) {
    if (!appearance.squad.ready) continue;

    const side = appearance.clubSide === 'home' ? appearance.squad.home : appearance.squad.away;
    const siblingPlayerNames = new Set(side.map((p: Player) => normalizeName(p.name)));

    const shared = players.filter((p) =>
      siblingPlayerNames.has(normalizeName(p.name))
    );

    if (shared.length > 0) {
      hits.push({
        siblingTeamName: appearance.teamName,
        latestDate: appearance.date,
        latestMatchLabel: `${appearance.homeTeam} vs ${appearance.awayTeam}`,
        sharedPlayers: shared,
        isHigher: appearance.isHigher,
      });
    }
  }
  return hits;
}

export function CrossTeamPlayers({
  nesoddenPlayers,
  opponentPlayers,
  opponentClubId,
  currentMatchReportId,
  isHomeNesodden,
  ageGroup,
}: Props) {
  const [nesoddenHits, setNesoddenHits] = useState<SharingHit[]>([]);
  const [opponentHits, setOpponentHits] = useState<SharingHit[]>([]);
  const [checked, setChecked] = useState(false);
  const [discoverVersion, setDiscoverVersion] = useState(0);

  const playerKey = nesoddenPlayers.map((p) => p.name).join('|');
  const opponentKey = (opponentPlayers ?? []).map((p) => p.name).join('|');

  const runCheck = useCallback(() => {
    const hasNesodden = nesoddenPlayers.length > 0 && !!currentMatchReportId;
    const hasOpponent = (opponentPlayers?.length ?? 0) > 0 && !!opponentClubId && !!currentMatchReportId;

    if (!hasNesodden && !hasOpponent) {
      setChecked(true);
      return;
    }

    setChecked(false);
    setNesoddenHits([]);
    setOpponentHits([]);

    const tasks: Promise<void>[] = [];

    if (hasNesodden) {
      tasks.push(
        checkSharing(nesoddenPlayers, NESODDEN_CLUB_ID, currentMatchReportId!)
          .then((hits) => setNesoddenHits(hits))
          .catch(() => {})
      );
    }

    if (hasOpponent) {
      tasks.push(
        checkSharing(opponentPlayers!, opponentClubId!, currentMatchReportId!)
          .then((hits) => setOpponentHits(hits))
          .catch(() => {})
      );
    }

    Promise.all(tasks).then(() => setChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerKey, opponentKey, opponentClubId, currentMatchReportId, discoverVersion]);

  useEffect(() => { runCheck(); }, [runCheck]);

  const nesoddenContent = nesoddenPlayers.length > 0 && currentMatchReportId && (
    <HitsSection
      hits={nesoddenHits}
      checked={checked}
      clubId={NESODDEN_CLUB_ID}
      ageGroup={ageGroup}
      onDiscover={() => setDiscoverVersion((v) => v + 1)}
    />
  );

  const opponentContent = (opponentPlayers?.length ?? 0) > 0 && opponentClubId && (
    <HitsSection
      hits={opponentHits}
      checked={checked}
      clubId={opponentClubId}
      ageGroup={ageGroup}
      onDiscover={() => setDiscoverVersion((v) => v + 1)}
    />
  );

  if (!nesoddenContent && !opponentContent) return null;

  return (
    <div className="border-t border-dark-border grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-dark-border">
      <div className="p-4">{isHomeNesodden ? nesoddenContent : opponentContent}</div>
      <div className="p-4">{isHomeNesodden ? opponentContent : nesoddenContent}</div>
    </div>
  );
}

function HitsSection({
  hits,
  checked,
  clubId,
  ageGroup,
  onDiscover,
}: {
  hits: SharingHit[];
  checked: boolean;
  clubId: string;
  ageGroup?: string;
  onDiscover: () => void;
}) {
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState(false);

  const canDiscover = checked && hits.length === 0 && !!clubId && !!ageGroup && !discovered;

  async function handleDiscover() {
    setDiscovering(true);
    try {
      const res = await fetch(`/api/clubs/${clubId}/discover?ageGroup=${ageGroup}`, { method: 'POST' });
      const result = await res.json();
      setDiscovered(true);
      if (result.newTeams > 0 || result.newSquads > 0) {
        onDiscover(); // re-trigger sharing check with new data
      }
    } catch {
      // ignore
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-widest text-amber-400 flex items-center gap-2">
        <WarningIcon />
        Spillerdeling
      </h4>
      {!checked ? (
        <p className="text-xs text-dark-muted animate-pulse">Sjekker…</p>
      ) : hits.length > 0 ? (
        hits.map(({ siblingTeamName, latestDate, latestMatchLabel, sharedPlayers, isHigher }) => (
          <div key={siblingTeamName}>
            <p className="text-xs text-dark-muted mb-2">
              Spilte også for{' '}
              <span className="font-medium text-white">{siblingTeamName}</span>{' '}
              <span
                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  isHigher
                    ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                    : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}
              >
                {isHigher ? '▲ høyere nivå' : '▼ lavere nivå'}
              </span>{' '}
              <span title={latestMatchLabel}>
                · sist {latestDate}
              </span>
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
        ))
      ) : discovering ? (
        <p className="text-xs text-dark-muted animate-pulse">Søker etter spillerdeling på fotball.no…</p>
      ) : canDiscover ? (
        <div>
          <p className="text-xs text-dark-muted mb-2">Ingen spillerdeling funnet i synkroniserte data.</p>
          <button
            onClick={handleDiscover}
            className="text-xs px-3 py-1.5 rounded border border-amber-400/30 text-amber-300 hover:bg-amber-400/10 transition-colors"
          >
            Sjekk spillerdeling
          </button>
        </div>
      ) : (
        <p className="text-xs text-dark-muted">Ingen spillerdeling funnet</p>
      )}
    </div>
  );
}

function WarningIcon() {
  return (
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
  );
}
