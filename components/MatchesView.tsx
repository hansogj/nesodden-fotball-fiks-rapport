'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Team, Match } from '@/lib/types';
import { TeamEmblem } from './TeamEmblem';
import { MatchCard } from './MatchCard';

const CLUB_ID = '82';

function ageGroupLabel(ag: string): string {
  const m = ag.match(/^([GJ])(\d{1,2})$/);
  if (!m) return ag;
  return m[1] === 'G' ? `Gutter ${parseInt(m[2])}` : `Jenter ${parseInt(m[2])}`;
}

function isPast(date: string, time: string) {
  try {
    const [d, m, y] = date.split('.').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const matchEnd = new Date(y, m - 1, d, hh + 2, mm);
    return matchEnd < new Date();
  } catch { return false; }
}

export function MatchesView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeAgeGroup = searchParams.get('ageGroup') ?? 'G16';
  const paramTeam = searchParams.get('team') ?? '';

  // ── Teams for this age group ─────────────────────────────────────────────────
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [activeId, setActiveId] = useState(paramTeam);

  useEffect(() => {
    setLoadingTeams(true);
    fetch(`/api/clubs/${CLUB_ID}/teams`)
      .then((r) => r.json())
      .then((data) => {
        const group: Team[] = (data.teams ?? {})[activeAgeGroup] ?? [];
        setTeams(group);
        const preferred = group.find((t) => t.fiksId === paramTeam)?.fiksId ?? group[0]?.fiksId ?? '';
        setActiveId(preferred);
      })
      .catch(() => {})
      .finally(() => setLoadingTeams(false));
  }, [activeAgeGroup]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTeam(fiksId: string) {
    setActiveId(fiksId);
    router.replace(`?ageGroup=${activeAgeGroup}&team=${fiksId}`, { scroll: false });
  }

  // ── Matches / sync state ─────────────────────────────────────────────────────
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sync')
      .then((r) => r.json())
      .then((d) => { if (d.lastSynced) setLastSynced(d.lastSynced); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    setMatches([]);
    fetch(`/api/teams/${activeId}/matches`)
      .then((r) => r.json())
      .then((data) => setMatches(data.matches ?? []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false));
  }, [activeId, refreshKey]);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teams }),
      });
      const data = await res.json();
      if (data.success) {
        setLastSynced(data.lastSynced);
        setRefreshKey((k) => k + 1);
      } else {
        setSyncError(data.error ?? 'Synkronisering feilet');
      }
    } catch {
      setSyncError('Nettverksfeil — kunne ikke nå serveren');
    } finally {
      setSyncing(false);
    }
  }

  const activeTeam = teams.find((t) => t.fiksId === activeId);

  const { past, upcoming } = useMemo(() => {
    function matchTimestamp(m: Match): number {
      try {
        const [d, mo, y] = m.date.split('.').map(Number);
        return new Date(y, mo - 1, d).getTime();
      } catch { return 0; }
    }
    const sorted = [...matches].sort((a, b) => matchTimestamp(a) - matchTimestamp(b));
    return {
      past:     sorted.filter((m) =>  isPast(m.date, m.time)),
      upcoming: sorted.filter((m) => !isPast(m.date, m.time)),
    };
  }, [matches]);

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={() => router.push('/', { scroll: false })} className="shrink-0">
            <TeamEmblem logoUrl="https://images.fotball.no/clublogos/82.png" teamName="Nesodden IF" size="lg" />
          </button>
          <div>
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-xs text-dark-muted mb-0.5">
              <button
                onClick={() => router.push('/', { scroll: false })}
                className="hover:text-white transition-colors"
              >
                Nesodden IF
              </button>
              <svg className="w-3 h-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-white font-medium">{ageGroupLabel(activeAgeGroup)}</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Nesodden IF — {ageGroupLabel(activeAgeGroup)}
            </h1>
          </div>
          <div className="ml-auto flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSync}
                disabled={syncing}
                title={lastSynced ? `Sist synkronisert: ${new Date(lastSynced).toLocaleString('nb-NO')}` : 'Synkroniser data fra FIKS (~1 min)'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all disabled:cursor-not-allowed ${
                  syncing
                    ? 'bg-nesodden-red/20 border-nesodden-red text-nesodden-red animate-pulse'
                    : syncError
                    ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:border-red-400'
                    : 'bg-dark-card border-dark-border text-gray-400 hover:border-nesodden-red/40 hover:text-white'
                }`}
              >
                {syncing ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                  </svg>
                ) : syncError ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {syncing ? 'Synkroniserer…' : 'Synkroniser'}
              </button>
              <span className="px-2 py-1 rounded text-xs font-medium bg-nesodden-red/20 text-nesodden-red border border-nesodden-red/30">2026</span>
            </div>
            {syncError && (
              <p className="text-[11px] text-red-400 max-w-[240px] text-right leading-tight">{syncError}</p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Team selector */}
        {loadingTeams ? (
          <div className="flex gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 w-40 rounded-lg bg-dark-card border border-dark-border animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {teams.map((team) => {
              const active = team.fiksId === activeId;
              return (
                <button
                  key={team.fiksId}
                  onClick={() => selectTeam(team.fiksId)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    active
                      ? 'bg-nesodden-red border-nesodden-red text-white shadow-lg shadow-nesodden-red/20'
                      : 'bg-dark-card border-dark-border text-gray-400 hover:border-nesodden-red/40 hover:text-white'
                  }`}
                >
                  <TeamEmblem logoUrl={team.logoUrl} teamName={team.name} size="sm" />
                  <span>{team.name}</span>
                  {team.division && (
                    <span className={`text-xs hidden sm:inline ${active ? 'text-red-200' : 'text-dark-muted'}`}>{team.division}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Active team heading */}
        {activeTeam && (
          <div>
            <h2 className="text-lg font-bold">{activeTeam.name}</h2>
            {activeTeam.division && <p className="text-sm text-dark-muted">{activeTeam.division}</p>}
          </div>
        )}

        {/* Match list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl border border-dark-border bg-dark-card p-4 animate-pulse">
                <div className="flex items-center justify-between mb-4">
                  <div className="h-3 w-32 bg-dark-border rounded" />
                  <div className="h-3 w-12 bg-dark-border rounded" />
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-16 h-16 rounded-full bg-dark-border" />
                    <div className="h-4 w-28 bg-dark-border rounded" />
                  </div>
                  <div className="h-5 w-6 bg-dark-border rounded" />
                  <div className="flex items-center gap-3 flex-1 justify-end">
                    <div className="h-4 w-28 bg-dark-border rounded" />
                    <div className="w-16 h-16 rounded-full bg-dark-border" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16 text-dark-muted">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p>Ingen kamper funnet</p>
          </div>
        ) : (
          <div className="space-y-3 animate-slide-up">
            {past.map((m) => (
              <MatchCard key={m.matchId} match={m} nesoddenTeamId={activeId} allTeams={teams} />
            ))}

            {past.length > 0 && upcoming.length > 0 && (
              <div className="flex items-center gap-3 py-2">
                <div className="flex-1 h-px bg-dark-border" />
                <span className="text-xs font-semibold uppercase tracking-widest text-nesodden-red flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-nesodden-red inline-block animate-pulse" />
                  Kommende ({upcoming.length})
                </span>
                <div className="flex-1 h-px bg-dark-border" />
              </div>
            )}

            {upcoming.map((m) => (
              <div key={m.matchId} className="opacity-60 hover:opacity-100 transition-opacity">
                <MatchCard match={m} nesoddenTeamId={activeId} allTeams={teams} />
              </div>
            ))}

            <p className="text-center text-xs text-dark-muted pt-4">
              {matches.length} kamper totalt · {past.length} spilt · {upcoming.length} gjenstår
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
