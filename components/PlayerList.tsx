import type { Player, MatchEvent, GoalType, CardType } from '@/lib/types';

interface Props {
  players: Player[];
  teamName: string;
  isNesodden?: boolean;
  events?: MatchEvent[];
  side?: 'home' | 'away';
}

const positionOrder = ['Keeper', 'Forsvar', 'Midtbane', 'Angrep'];

const positionBadge: Record<string, string> = {
  Keeper:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Forsvar:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  Midtbane: 'bg-green-500/20 text-green-400 border-green-500/30',
  Angrep:   'bg-red-500/20 text-red-400 border-red-500/30',
};

/** Normalise a player name to "firstname lastname" lowercase for matching.
 *  Handles both "Last, First" (FIKS squad format) and "First Last" (event format). */
function normaliseName(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s*\(.*?\)\s*$/, '');
  const comma = s.indexOf(',');
  if (comma > -1) {
    const last  = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    return `${first} ${last}`;
  }
  return s;
}

function playerMatchesEvent(playerName: string, eventName: string): boolean {
  const a = normaliseName(playerName);
  const b = normaliseName(eventName);
  return a === b || a.includes(b) || b.includes(a);
}

// ── Event icon components ──────────────────────────────────────────────────────

function YellowCard() {
  return (
    <span
      title="Gult kort"
      className="inline-block w-[9px] h-[13px] rounded-[2px] bg-yellow-400 border border-yellow-500/60 shadow-sm"
    />
  );
}

function RedCard() {
  return (
    <span
      title="Rødt kort"
      className="inline-block w-[9px] h-[13px] rounded-[2px] bg-red-500 border border-red-600/60 shadow-sm"
    />
  );
}

function YellowRedCard() {
  return (
    <span title="Gult+rødt kort" className="inline-flex">
      <span className="inline-block w-[9px] h-[13px] rounded-[2px] bg-yellow-400 border border-yellow-500/60 shadow-sm" />
      <span className="inline-block w-[9px] h-[13px] rounded-[2px] bg-red-500 border border-red-600/60 shadow-sm -ml-[5px]" />
    </span>
  );
}

function GoalIcon({ goalType }: { goalType?: GoalType }) {
  if (goalType === 'own') {
    return (
      <span
        title="Selvmål"
        className="inline-flex items-center justify-center text-[11px] leading-none bg-red-500/20 border border-red-500/40 rounded-full w-[14px] h-[14px]"
      >
        ⚽
      </span>
    );
  }
  if (goalType === 'penalty') {
    return (
      <span title="Straffemål" className="inline-flex items-center gap-[1px]">
        <span className="text-[11px] leading-none">⚽</span>
        {/* Whistle SVG */}
        <svg viewBox="0 0 16 16" className="w-[9px] h-[9px] text-yellow-300 fill-current shrink-0" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 8.5C2 6.015 4.015 4 6.5 4H10V3H6.5C3.462 3 1 5.462 1 8.5S3.462 14 6.5 14H10v-1H6.5C4.015 13 2 10.985 2 8.5z"/>
          <rect x="10" y="3" width="4" height="2" rx="0.5"/>
          <rect x="10" y="9" width="4" height="2" rx="0.5"/>
          <rect x="9" y="3" width="2" height="8"/>
        </svg>
      </span>
    );
  }
  return <span title="Mål" className="text-[11px] leading-none">⚽</span>;
}

function CardIcon({ cardType }: { cardType?: CardType }) {
  if (cardType === 'yellow-red') return <YellowRedCard />;
  if (cardType === 'red') return <RedCard />;
  return <YellowCard />;
}

/** Render all events for one player as an overlapping icon stack. */
function EventIcons({ playerEvents }: { playerEvents: MatchEvent[] }) {
  if (playerEvents.length === 0) return null;

  // Sort by minute ascending; within same minute put cards before goals
  const sorted = [...playerEvents].sort((a, b) => {
    const ma = a.minute ?? 999;
    const mb = b.minute ?? 999;
    if (ma !== mb) return ma - mb;
    if (a.type !== b.type) return a.type === 'card' ? -1 : 1;
    return 0;
  });

  return (
    <span className="inline-flex items-center ml-1.5">
      {sorted.map((ev, i) => (
        <span
          key={i}
          className="relative inline-flex items-center"
          style={{ marginLeft: i > 0 ? '-3px' : undefined, zIndex: sorted.length - i }}
        >
          {ev.type === 'goal' ? (
            <GoalIcon goalType={ev.goalType} />
          ) : (
            <CardIcon cardType={ev.cardType} />
          )}
        </span>
      ))}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PlayerList({ players, teamName, isNesodden, events = [], side }: Props) {
  if (players.length === 0) {
    return <p className="text-center py-8 text-dark-muted text-sm">Spillerliste ikke tilgjengelig</p>;
  }

  // Only use events that match this side
  const sideEvents = side ? events.filter((e) => e.side === side) : events;

  const grouped = positionOrder.reduce<Record<string, Player[]>>((acc, pos) => {
    const group = players.filter((p) => p.position === pos);
    if (group.length) acc[pos] = group;
    return acc;
  }, {});

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
            {group.map((p) => {
              const playerEvents = sideEvents.filter((e) => playerMatchesEvent(p.name, e.playerName));
              return (
                <div key={`${p.jerseyNumber}-${p.name}`} className="flex items-center gap-3 py-1 px-2 rounded hover:bg-dark-border/30 transition-colors">
                  <span className="w-7 text-right text-dark-muted text-xs font-mono shrink-0">{p.jerseyNumber || '—'}</span>
                  <span className="text-sm text-gray-200">{p.name}</span>
                  {playerEvents.length > 0 && <EventIcons playerEvents={playerEvents} />}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
