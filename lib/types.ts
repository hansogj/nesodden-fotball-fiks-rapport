export interface Team {
  fiksId: string;
  name: string;
  division: string;
  clubFiksId: string;
  logoUrl: string;
  tournamentFiksId?: string;
}

export interface Match {
  matchId: string;
  date: string;       // dd.mm.yyyy
  time: string;
  homeTeam: string;
  homeTeamId: string;
  homeClubId: string;
  homeLogoUrl: string;
  awayTeam: string;
  awayTeamId: string;
  awayClubId: string;
  awayLogoUrl: string;
  venue: string;
  tournament: string;
  isHome: boolean;
  result?: string;
  matchReportId?: string; // FIKS internal ID for MatchReport/View page
}

export type GoalType = 'normal' | 'own' | 'penalty';
export type CardType = 'yellow' | 'red' | 'yellow-red';

export interface MatchEvent {
  /** Player name as it appears in the FIKS Hendelser tab */
  playerName: string;
  minute?: number;
  side: 'home' | 'away';
  type: 'goal' | 'card';
  goalType?: GoalType;
  cardType?: CardType;
}

export interface Squad {
  ready: boolean;
  home: Player[];
  away: Player[];
  events?: MatchEvent[];
}

export interface Player {
  name: string;
  position: string;
  jerseyNumber: number;
}

export interface OpponentTeam {
  fiksId: string;
  name: string;
  clubId: string;
  division: string;
}

export interface StandingsEntry {
  position: number;
  teamName: string;
  teamFiksId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

export interface PlayerGoalStats {
  playerName: string;
  teamName: string;
  goals: number;
}

export interface PlayerCardStats {
  playerName: string;
  yellow: number;
  red: number;
  yellowRed: number;
}

export interface TeamStatsResponse {
  standings: StandingsEntry[];
  seriesTopScorers: PlayerGoalStats[];
  teamTopScorers: PlayerGoalStats[];
  teamCards: PlayerCardStats[];
  tournament: string;
}

export interface ClubAppearance {
  matchReportId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  /** fiksId of the team (Nesodden G16 or opponent sibling) that played in this match */
  teamFiksId: string;
  teamName: string;
  division: string;
  /** Whether the sibling team is at a higher division level than the current match team */
  isHigher: boolean;
  /** Which side the queried club played on */
  clubSide: 'home' | 'away';
  squad: Squad;
}
