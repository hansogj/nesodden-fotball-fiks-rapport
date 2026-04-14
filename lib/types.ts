export interface Team {
  fiksId: string;
  name: string;
  division: string;
  clubFiksId: string;
  logoUrl: string;
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

export interface Squad {
  ready: boolean;
  home: Player[];
  away: Player[];
}

export interface Player {
  name: string;
  position: string;
  jerseyNumber: number;
}

export interface ClubAppearance {
  matchReportId: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  /** fiksId of the Nesodden G16 team that played in this match */
  nesoddenTeamFiksId: string;
  /** Which side the queried club played on */
  clubSide: 'home' | 'away';
  squad: Squad;
}
