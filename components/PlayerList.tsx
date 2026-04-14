import type { Player } from '@/lib/types';

interface Props {
  players: Player[];
  teamName: string;
  isNesodden?: boolean;
}

const positionOrder = ['Keeper', 'Forsvar', 'Midtbane', 'Angrep'];

const positionBadge: Record<string, string> = {
  Keeper:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Forsvar:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Midtbane: 'bg-green-500/20 text-green-400 border-green-500/30',
  Angrep:   'bg-red-500/20 text-red-400 border-red-500/30',
};

export function PlayerList({ players, teamName, isNesodden }: Props) {
  if (players.length === 0) {
    return <p className="text-center py-8 text-dark-muted text-sm">Spillerliste ikke tilgjengelig</p>;
  }

  const grouped = positionOrder.reduce<Record<string, Player[]>>((acc, pos) => {
    const group = players.filter((p) => p.position === pos);
    if (group.length) acc[pos] = group;
    return acc;
  }, {});

  // Players with unknown positions
  const unknown = players.filter((p) => !positionOrder.includes(p.position));
  if (unknown.length) grouped['Annet'] = unknown;

  return (
    <div className="space-y-4">
      <h3 className={`text-xs font-semibold uppercase tracking-wider ${isNesodden ? 'text-nesodden-red' : 'text-dark-muted'}`}>
        {teamName}
      </h3>
      {Object.entries(grouped).map(([pos, group]) => (
        <div key={pos}>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border mb-2 ${positionBadge[pos] ?? 'bg-dark-card text-dark-muted border-dark-border'}`}>
            {pos}
          </span>
          <div className="space-y-0.5">
            {group.map((p) => (
              <div key={`${p.jerseyNumber}-${p.name}`} className="flex items-center gap-3 py-1 px-2 rounded hover:bg-dark-border/30 transition-colors">
                <span className="w-7 text-right text-dark-muted text-xs font-mono">{p.jerseyNumber || '—'}</span>
                <span className="text-sm text-gray-200">{p.name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
