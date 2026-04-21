'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { Team } from '@/lib/types';
import { TeamEmblem } from './TeamEmblem';

const CLUB_ID = '82';

function ageGroupLabel(ag: string): string {
  const m = ag.match(/^([GJ])(\d{1,2})$/);
  if (!m) return ag;
  return m[1] === 'G' ? `Gutter ${parseInt(m[2])}` : `Jenter ${parseInt(m[2])}`;
}

function sortAgeGroups(ags: string[]): string[] {
  return [...ags].sort((a, b) => {
    if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
    return parseInt(a.slice(1)) - parseInt(b.slice(1));
  });
}

interface AgeGroupCardProps {
  ageGroup: string;
  teams: Team[];
  onClick: () => void;
}

function AgeGroupCard({ ageGroup, teams, onClick }: AgeGroupCardProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-dark-border bg-dark-card hover:border-nesodden-red/60 hover:bg-dark-surface transition-all duration-200 p-5 flex flex-col gap-3 shadow-sm hover:shadow-nesodden-red/10 hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-white group-hover:text-nesodden-red transition-colors">
          {ageGroupLabel(ageGroup)}
        </h3>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-dark-surface border border-dark-border text-dark-muted group-hover:border-nesodden-red/30 transition-colors">
          {teams.length} {teams.length === 1 ? 'lag' : 'lag'}
        </span>
      </div>

      {teams.length > 0 && (
        <ul className="space-y-1.5">
          {teams.map((t) => (
            <li key={t.fiksId} className="flex items-center gap-2 text-sm text-dark-muted group-hover:text-gray-300 transition-colors">
              <span className="w-1.5 h-1.5 rounded-full bg-dark-border group-hover:bg-nesodden-red/50 transition-colors shrink-0" />
              <span>{t.name}</span>
              {t.division && (
                <span className="text-xs text-dark-muted/60 truncate hidden sm:inline">{t.division}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1 text-xs text-nesodden-red/60 group-hover:text-nesodden-red transition-colors mt-auto pt-1">
        <span>Se kamper</span>
        <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
}

function AgeGroupCardSkeleton() {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 animate-pulse flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="h-5 w-28 bg-dark-border rounded" />
        <div className="h-4 w-12 bg-dark-border rounded-full" />
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-dark-border shrink-0" />
            <div className="h-3 bg-dark-border rounded" style={{ width: `${55 + i * 15}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ClubOverview() {
  const router = useRouter();
  const [ageGroups, setAgeGroups] = useState<string[]>([]);
  const [teamsByAgeGroup, setTeamsByAgeGroup] = useState<Record<string, Team[]>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/clubs/${CLUB_ID}/teams`)
      .then((r) => r.json())
      .then((data) => {
        setAgeGroups(sortAgeGroups(data.ageGroups ?? []));
        setTeamsByAgeGroup(data.teams ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/sync')
      .then((r) => r.json())
      .then((d) => { if (d.lastSynced) setLastSynced(d.lastSynced); })
      .catch(() => {});
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLastSynced(data.lastSynced);
        // Reload age groups — sync may have discovered new ones
        fetch(`/api/clubs/${CLUB_ID}/teams`)
          .then((r) => r.json())
          .then((d) => {
            setAgeGroups(sortAgeGroups(d.ageGroups ?? []));
            setTeamsByAgeGroup(d.teams ?? {});
          })
          .catch(() => {});
      } else {
        setSyncError(data.error ?? 'Synkronisering feilet');
      }
    } catch {
      setSyncError('Nettverksfeil — kunne ikke nå serveren');
    } finally {
      setSyncing(false);
    }
  }

  function selectAgeGroup(ag: string) {
    const firstTeam = (teamsByAgeGroup[ag] ?? [])[0]?.fiksId;
    const url = `?ageGroup=${ag}${firstTeam ? `&team=${firstTeam}` : ''}`;
    router.push(url, { scroll: false });
  }

  // Split into boys (G) and girls (J)
  const boysGroups  = ageGroups.filter((ag) => ag.startsWith('G'));
  const girlsGroups = ageGroups.filter((ag) => ag.startsWith('J'));

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <header className="border-b border-dark-border bg-dark-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-4">
          <TeamEmblem logoUrl="https://images.fotball.no/clublogos/82.png" teamName="Nesodden IF" size="lg" />
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Nesodden IF</h1>
            <p className="text-xs text-dark-muted">Sesong 2026 · Kampoversikt</p>
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

      <main className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-1">Velg aldersklasse</h2>
          <p className="text-sm text-dark-muted">
            {lastSynced
              ? `Data hentet ${new Date(lastSynced).toLocaleString('nb-NO', { dateStyle: 'medium', timeStyle: 'short' })}`
              : 'Synkroniser for å hente oppdaterte lag fra FIKS'}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <AgeGroupCardSkeleton key={i} />)}
          </div>
        ) : ageGroups.length === 0 ? (
          <div className="text-center py-20 text-dark-muted">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <p className="font-medium">Ingen lag funnet</p>
            <p className="text-xs mt-1">Trykk Synkroniser for å hente lag fra FIKS</p>
          </div>
        ) : (
          <div className="space-y-8">
            {boysGroups.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-dark-muted mb-3">Gutter</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {boysGroups.map((ag) => (
                    <AgeGroupCard
                      key={ag}
                      ageGroup={ag}
                      teams={teamsByAgeGroup[ag] ?? []}
                      onClick={() => selectAgeGroup(ag)}
                    />
                  ))}
                </div>
              </section>
            )}

            {girlsGroups.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-dark-muted mb-3">Jenter</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {girlsGroups.map((ag) => (
                    <AgeGroupCard
                      key={ag}
                      ageGroup={ag}
                      teams={teamsByAgeGroup[ag] ?? []}
                      onClick={() => selectAgeGroup(ag)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
