import { describe, it, expect } from 'vitest';
import {
  dateMs,
  divisionRank,
  extractAgeGroup,
  sortAgeGroups,
  primaryTournament,
  findTeamSide,
  computeTopScorers,
  computeCards,
} from '../../lib/utils';
import type { Match, Squad } from '../../lib/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    matchId: 'test-1',
    date: '01.01.2026',
    time: '12:00',
    homeTeam: 'Home FC',
    homeTeamId: 'home-id',
    homeClubId: '1',
    homeLogoUrl: '',
    awayTeam: 'Away FC',
    awayTeamId: 'away-id',
    awayClubId: '2',
    awayLogoUrl: '',
    venue: 'Stadium',
    tournament: 'G16 2. divisjon',
    isHome: true,
    ...overrides,
  };
}

// ── dateMs ────────────────────────────────────────────────────────────────────

describe('dateMs', () => {
  it('parses dd.mm.yyyy to epoch ms', () => {
    const ms = dateMs('15.06.2026');
    const d = new Date(ms);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  it('handles single-digit day/month', () => {
    const ms = dateMs('01.01.2026');
    const d = new Date(ms);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('orders dates correctly', () => {
    expect(dateMs('20.04.2026')).toBeLessThan(dateMs('21.04.2026'));
    expect(dateMs('01.05.2026')).toBeGreaterThan(dateMs('30.04.2026'));
  });
});

// ── divisionRank ─────────────────────────────────────────────────────────────

describe('divisionRank', () => {
  it('extracts rank from "G16 2. divisjon"', () => {
    expect(divisionRank('G16 2. divisjon')).toBe(2);
  });

  it('extracts rank from "G16 3. divisjon avd. 03"', () => {
    expect(divisionRank('G16 3. divisjon avd. 03')).toBe(3);
  });

  it('extracts rank from abbreviated "G16 4. div. avd. 02"', () => {
    expect(divisionRank('G16 4. div. avd. 02')).toBe(4);
  });

  it('extracts rank from "G16 2. div.  - 2026 - Oslo"', () => {
    expect(divisionRank('G16 2. div.  - 2026 - Oslo')).toBe(2);
  });

  it('returns 99 for unparseable division', () => {
    expect(divisionRank('Påmeldte lag - Nesodden IF')).toBe(99);
    expect(divisionRank('')).toBe(99);
  });

  it('lower rank number means higher level', () => {
    expect(divisionRank('G16 2. divisjon')).toBeLessThan(divisionRank('G16 3. divisjon avd 03'));
    expect(divisionRank('G16 3. divisjon avd 03')).toBeLessThan(divisionRank('G16 4. divisjon avd 02'));
  });
});

// ── extractAgeGroup ──────────────────────────────────────────────────────────

describe('extractAgeGroup', () => {
  it('extracts G16 from division string', () => {
    expect(extractAgeGroup('G16 2. divisjon')).toBe('G16');
  });

  it('extracts J15 from label', () => {
    expect(extractAgeGroup('J15 Kretsserie')).toBe('J15');
  });

  it('normalizes to uppercase', () => {
    expect(extractAgeGroup('g16 4. div')).toBe('G16');
  });

  it('returns null for non-matching input', () => {
    expect(extractAgeGroup('Senior divisjon')).toBeNull();
    expect(extractAgeGroup('')).toBeNull();
  });
});

// ── sortAgeGroups ────────────────────────────────────────────────────────────

describe('sortAgeGroups', () => {
  it('sorts G before J, then by age', () => {
    const result = sortAgeGroups(['J15', 'G16', 'G14', 'J13', 'G13']);
    expect(result).toEqual(['G13', 'G14', 'G16', 'J13', 'J15']);
  });

  it('filters out age groups below minAge', () => {
    const result = sortAgeGroups(['G16', 'G11', 'G10', 'J15']);
    expect(result).toEqual(['G16', 'J15']);
  });

  it('respects custom minAge', () => {
    const result = sortAgeGroups(['G16', 'G11', 'G10'], 10);
    expect(result).toEqual(['G10', 'G11', 'G16']);
  });

  it('returns empty for all-under-age input', () => {
    expect(sortAgeGroups(['G08', 'G09'])).toEqual([]);
  });
});

// ── primaryTournament ────────────────────────────────────────────────────────

describe('primaryTournament', () => {
  it('returns the most frequent tournament', () => {
    const matches = [
      makeMatch({ tournament: 'Serie A' }),
      makeMatch({ tournament: 'Serie A' }),
      makeMatch({ tournament: 'Cup' }),
    ];
    expect(primaryTournament(matches)).toBe('Serie A');
  });

  it('returns empty string for no tournaments', () => {
    expect(primaryTournament([makeMatch({ tournament: '' })])).toBe('');
    expect(primaryTournament([])).toBe('');
  });
});

// ── findTeamSide ─────────────────────────────────────────────────────────────

describe('findTeamSide', () => {
  it('returns home when homeTeamId matches', () => {
    expect(findTeamSide(makeMatch({ homeTeamId: '42' }), '42')).toBe('home');
  });

  it('returns away when awayTeamId matches', () => {
    expect(findTeamSide(makeMatch({ awayTeamId: '42' }), '42')).toBe('away');
  });

  it('falls back to isHome when no ID match', () => {
    expect(findTeamSide(makeMatch({ isHome: true }), 'unknown')).toBe('home');
    expect(findTeamSide(makeMatch({ isHome: false }), 'unknown')).toBe('away');
  });
});

// ── computeTopScorers ────────────────────────────────────────────────────────

describe('computeTopScorers', () => {
  const match = makeMatch({
    matchReportId: 'r1',
    result: '3-1',
    homeTeamId: 'team-a',
    homeTeam: 'Team A',
    awayTeam: 'Team B',
  });

  const squads: Record<string, Squad> = {
    r1: {
      ready: true,
      home: [],
      away: [],
      events: [
        { playerName: 'Scorer 1', side: 'home', type: 'goal', goalType: 'normal' },
        { playerName: 'Scorer 1', side: 'home', type: 'goal', goalType: 'normal' },
        { playerName: 'Scorer 2', side: 'home', type: 'goal', goalType: 'normal' },
        { playerName: 'Own Goal', side: 'away', type: 'goal', goalType: 'own' },
        { playerName: 'Away Scorer', side: 'away', type: 'goal', goalType: 'normal' },
      ],
    },
  };

  it('counts goals and sorts by most goals', () => {
    const result = computeTopScorers([match], squads, null, 10);
    expect(result[0]).toEqual({ playerName: 'Scorer 1', teamName: 'Team A', goals: 2 });
    expect(result[1].goals).toBe(1);
  });

  it('excludes own goals', () => {
    const result = computeTopScorers([match], squads, null, 10);
    const names = result.map(r => r.playerName);
    expect(names).not.toContain('Own Goal');
  });

  it('filters by team when forTeamFiksId is set', () => {
    const result = computeTopScorers([match], squads, 'team-a', 10);
    expect(result.every(r => r.teamName === 'Team A')).toBe(true);
  });

  it('respects limit', () => {
    const result = computeTopScorers([match], squads, null, 1);
    expect(result).toHaveLength(1);
  });

  it('deduplicates by matchReportId', () => {
    const result = computeTopScorers([match, match], squads, null, 10);
    expect(result[0].goals).toBe(2); // not 4
  });
});

// ── computeCards ─────────────────────────────────────────────────────────────

describe('computeCards', () => {
  const match = makeMatch({
    matchReportId: 'r1',
    result: '1-0',
    homeTeamId: 'team-a',
  });

  const squads: Record<string, Squad> = {
    r1: {
      ready: true,
      home: [],
      away: [],
      events: [
        { playerName: 'Player X', side: 'home', type: 'card', cardType: 'yellow' },
        { playerName: 'Player X', side: 'home', type: 'card', cardType: 'yellow' },
        { playerName: 'Player Y', side: 'home', type: 'card', cardType: 'red' },
        { playerName: 'Opponent', side: 'away', type: 'card', cardType: 'yellow' },
      ],
    },
  };

  it('counts cards per player for the specified team', () => {
    const result = computeCards([match], squads, 'team-a');
    expect(result).toHaveLength(2);
    const x = result.find(r => r.playerName === 'Player X');
    expect(x).toEqual({ playerName: 'Player X', yellow: 2, red: 0, yellowRed: 0 });
  });

  it('excludes opponent cards', () => {
    const result = computeCards([match], squads, 'team-a');
    const names = result.map(r => r.playerName);
    expect(names).not.toContain('Opponent');
  });

  it('sorts by severity (red > yellow-red > yellow)', () => {
    const result = computeCards([match], squads, 'team-a');
    // Player Y (1 red = weight 3) should be before Player X (2 yellow = weight 2)
    expect(result[0].playerName).toBe('Player Y');
    expect(result[1].playerName).toBe('Player X');
  });
});
