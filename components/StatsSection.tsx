'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import type {
  StandingsEntry,
  PlayerGoalStats,
  PlayerCardStats,
  TeamStatsResponse,
} from '@/lib/types';

// ── Shared fetch context ────────────────────────────────────────────────────

const StatsContext = createContext<{ stats: TeamStatsResponse | null; loading: boolean }>({
  stats: null,
  loading: true,
});

export function StatsProvider({
  fiksId,
  children,
}: {
  fiksId: string;
  children: React.ReactNode;
}) {
  const [stats, setStats] = useState<TeamStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fiksId) return;
    setLoading(true);
    setStats(null);
    fetch(`/api/teams/${fiksId}/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [fiksId]);

  return (
    <StatsContext.Provider value={{ stats, loading }}>
      {children}
    </StatsContext.Provider>
  );
}

// ── Left sidebar: Standings ─────────────────────────────────────────────────

export function StandingsSidebar({ fiksId }: { fiksId: string }) {
  const { stats, loading } = useContext(StatsContext);

  if (loading) {
    return <div className="h-64 rounded-xl bg-dark-card border border-dark-border animate-pulse" />;
  }
  if (!stats) return null;

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-dark-border">
        <h3 className="text-xs font-bold text-white">Tabell</h3>
        {stats.tournament && (
          <p className="text-[10px] text-dark-muted mt-0.5 truncate">{stats.tournament}</p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-dark-surface text-dark-muted">
              <th className="px-1.5 py-1.5 text-left w-5">#</th>
              <th className="px-1.5 py-1.5 text-left">Lag</th>
              <th className="px-1 py-1.5 text-center w-5">K</th>
              <th className="px-1 py-1.5 text-center w-5">S</th>
              <th className="px-1 py-1.5 text-center w-5">U</th>
              <th className="px-1 py-1.5 text-center w-5">T</th>
              <th className="px-1 py-1.5 text-center w-8">+/-</th>
              <th className="px-1.5 py-1.5 text-center w-5 font-bold">P</th>
            </tr>
          </thead>
          <tbody>
            {stats.standings.map((row) => {
              const isCurrent = row.teamFiksId === fiksId;
              return (
                <tr
                  key={row.teamFiksId || row.teamName}
                  className={`border-t border-dark-border/50 ${
                    isCurrent
                      ? 'bg-nesodden-red/15 text-white font-semibold'
                      : 'text-gray-300'
                  }`}
                >
                  <td className="px-1.5 py-1 text-dark-muted">{row.position}</td>
                  <td className="px-1.5 py-1 truncate max-w-[120px]">{row.teamName}</td>
                  <td className="px-1 py-1 text-center">{row.played}</td>
                  <td className="px-1 py-1 text-center">{row.won}</td>
                  <td className="px-1 py-1 text-center">{row.drawn}</td>
                  <td className="px-1 py-1 text-center">{row.lost}</td>
                  <td className="px-1 py-1 text-center text-dark-muted">
                    {row.goalsFor}-{row.goalsAgainst}
                  </td>
                  <td className="px-1.5 py-1 text-center font-bold">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Right sidebar: Scorers + Cards ──────────────────────────────────────────

function TopScorersTable({
  title,
  scorers,
  showTeam,
}: {
  title: string;
  scorers: PlayerGoalStats[];
  showTeam: boolean;
}) {
  if (scorers.length === 0) return null;
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-dark-border">
        <h3 className="text-xs font-bold text-white">{title}</h3>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-dark-surface text-dark-muted">
            <th className="px-1.5 py-1.5 text-left w-5">#</th>
            <th className="px-1.5 py-1.5 text-left">Spiller</th>
            {showTeam && <th className="px-1.5 py-1.5 text-left">Lag</th>}
            <th className="px-1.5 py-1.5 text-center w-8">Mål</th>
          </tr>
        </thead>
        <tbody>
          {scorers.map((s, i) => (
            <tr key={s.playerName} className="border-t border-dark-border/50 text-gray-300">
              <td className="px-1.5 py-1 text-dark-muted">{i + 1}</td>
              <td className="px-1.5 py-1 truncate max-w-[100px]">{s.playerName}</td>
              {showTeam && (
                <td className="px-1.5 py-1 text-dark-muted truncate max-w-[80px]">
                  {s.teamName}
                </td>
              )}
              <td className="px-1.5 py-1 text-center font-bold">{s.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardStatsTable({ cards }: { cards: PlayerCardStats[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
      <div className="px-3 py-2.5 border-b border-dark-border">
        <h3 className="text-xs font-bold text-white">Kort</h3>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-dark-surface text-dark-muted">
            <th className="px-1.5 py-1.5 text-left">Spiller</th>
            <th className="px-1.5 py-1.5 text-center w-8" title="Gule kort">🟨</th>
            <th className="px-1.5 py-1.5 text-center w-8" title="Røde kort">🟥</th>
            <th className="px-1.5 py-1.5 text-center w-8" title="Gult/rødt kort">🟨🟥</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.playerName} className="border-t border-dark-border/50 text-gray-300">
              <td className="px-1.5 py-1 truncate max-w-[100px]">{c.playerName}</td>
              <td className="px-1.5 py-1 text-center">{c.yellow || '-'}</td>
              <td className="px-1.5 py-1 text-center">{c.red || '-'}</td>
              <td className="px-1.5 py-1 text-center">{c.yellowRed || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScorersCardsSidebar() {
  const { stats, loading } = useContext(StatsContext);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-48 rounded-xl bg-dark-card border border-dark-border animate-pulse" />
        <div className="h-40 rounded-xl bg-dark-card border border-dark-border animate-pulse" />
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="space-y-3">
      <TopScorersTable title="Toppscorer serie" scorers={stats.seriesTopScorers} showTeam />
      <TopScorersTable title="Toppscorer lag" scorers={stats.teamTopScorers} showTeam={false} />
      <CardStatsTable cards={stats.teamCards} />
    </div>
  );
}
