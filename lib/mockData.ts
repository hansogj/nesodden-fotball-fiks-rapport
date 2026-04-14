import type { Match, Player, Team } from './types';

export const NESODDEN_CLUB_ID = '82';

export const G16_TEAMS: Team[] = [
  {
    fiksId: '134742',
    name: 'Nesodden G16-1',
    division: 'G16 2. divisjon',
    clubFiksId: '82',
    logoUrl: 'https://images.fotball.no/clublogos/82.png',
  },
  {
    fiksId: '6895',
    name: 'Nesodden G16-2',
    division: 'G16 4. divisjon avd. 02',
    clubFiksId: '82',
    logoUrl: 'https://images.fotball.no/clublogos/82.png',
  },
  {
    fiksId: '154500',
    name: 'Nesodden G16-3',
    division: 'G16 3. divisjon avd. 03',
    clubFiksId: '82',
    logoUrl: 'https://images.fotball.no/clublogos/82.png',
  },
];

interface Opponent {
  name: string;
  fiksId: string;
  clubFiksId: string;
}

const opponents2div: Opponent[] = [
  { name: 'Heming 2',         fiksId: '199159', clubFiksId: '98'  },
  { name: 'Grüner',           fiksId: '75136',  clubFiksId: '120' },
  { name: 'Hasle-Løren 2',    fiksId: '123719', clubFiksId: '134' },
  { name: 'Haugerud',         fiksId: '164511', clubFiksId: '145' },
  { name: 'KFUM',             fiksId: '72403',  clubFiksId: '156' },
  { name: 'Korsvoll',         fiksId: '204276', clubFiksId: '167' },
  { name: 'RASK/Lambertseter',fiksId: '187985', clubFiksId: '178' },
  { name: 'Ready',            fiksId: '162664', clubFiksId: '189' },
  { name: 'Vålerenga 2',      fiksId: '177358', clubFiksId: '200' },
  { name: 'Haslum',           fiksId: '6763',   clubFiksId: '211' },
];

const opponents3div: Opponent[] = [
  { name: 'Sofiemyr IL',      fiksId: '34501', clubFiksId: '187' },
  { name: 'Nordby IL',        fiksId: '34502', clubFiksId: '241' },
  { name: 'Siggerud/Grønli',  fiksId: '34503', clubFiksId: '255' },
  { name: 'Tomter IF',        fiksId: '34504', clubFiksId: '273' },
  { name: 'Enebakk IL',       fiksId: '34505', clubFiksId: '281' },
  { name: 'Hobøl IL',         fiksId: '34506', clubFiksId: '299' },
  { name: 'Follo FK',         fiksId: '34507', clubFiksId: '203' },
  { name: 'Ski IL',           fiksId: '34508', clubFiksId: '198' },
];

const opponents4div: Opponent[] = [
  { name: 'Ås IF',            fiksId: '45601', clubFiksId: '156' },
  { name: 'Vestby IL',        fiksId: '45602', clubFiksId: '323' },
  { name: 'Langhus IL',       fiksId: '45603', clubFiksId: '334' },
  { name: 'Spydeberg IL',     fiksId: '45604', clubFiksId: '341' },
  { name: 'Askim IF',         fiksId: '45605', clubFiksId: '367' },
  { name: 'Drøbak/Frogn IL',  fiksId: '45606', clubFiksId: '224' },
];

function generateMatches(team: Team, opponents: Opponent[], startDate: string): Match[] {
  const times = ['11:00', '13:00', '15:00'];
  const base = new Date(startDate);

  return opponents.map((opp, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i * 14);
    const date = d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const time = times[i % times.length];
    const isHome = i % 2 === 0;

    return {
      matchId: `${team.fiksId}-${i + 1}`,
      date,
      time,
      homeTeam:    isHome ? team.name : opp.name,
      homeTeamId:  isHome ? team.fiksId : opp.fiksId,
      homeClubId:  isHome ? team.clubFiksId : opp.clubFiksId,
      homeLogoUrl: `https://images.fotball.no/clublogos/${isHome ? team.clubFiksId : opp.clubFiksId}.png`,
      awayTeam:    isHome ? opp.name : team.name,
      awayTeamId:  isHome ? opp.fiksId : team.fiksId,
      awayClubId:  isHome ? opp.clubFiksId : team.clubFiksId,
      awayLogoUrl: `https://images.fotball.no/clublogos/${isHome ? opp.clubFiksId : team.clubFiksId}.png`,
      venue:       isHome ? 'Nesodden Idrettspark' : `${opp.name.split(' ')[0]} stadion`,
      tournament:  'G16 Kretsserie 2026',
      isHome,
    };
  });
}

export const MOCK_MATCHES: Record<string, Match[]> = {
  '134742': generateMatches(G16_TEAMS[0], opponents2div, '2026-04-19'),
  '6895':   generateMatches(G16_TEAMS[1], opponents4div, '2026-04-25'),
  '154500': generateMatches(G16_TEAMS[2], opponents3div, '2026-04-18'),
};

// Keys match the actual team fiksIds from fotball.no
const nesoddenPlayers: Record<string, Player[]> = {
  '134742': [
    { name: 'Mathias Berg',        position: 'Keeper',   jerseyNumber: 1  },
    { name: 'Sander Holm',         position: 'Keeper',   jerseyNumber: 16 },
    { name: 'Tobias Dahl',         position: 'Forsvar',  jerseyNumber: 2  },
    { name: 'Emil Strand',         position: 'Forsvar',  jerseyNumber: 3  },
    { name: 'Jonas Moen',          position: 'Forsvar',  jerseyNumber: 4  },
    { name: 'Henrik Bakke',        position: 'Forsvar',  jerseyNumber: 5  },
    { name: 'Sebastian Sørensen',  position: 'Forsvar',  jerseyNumber: 14 },
    { name: 'Lars Andersen',       position: 'Midtbane', jerseyNumber: 6  },
    { name: 'Oliver Nilsen',       position: 'Midtbane', jerseyNumber: 7  },
    { name: 'Magnus Eriksen',      position: 'Midtbane', jerseyNumber: 8  },
    { name: 'Noah Larsen',         position: 'Midtbane', jerseyNumber: 10 },
    { name: 'Elias Christensen',   position: 'Midtbane', jerseyNumber: 11 },
    { name: 'William Hansen',      position: 'Midtbane', jerseyNumber: 15 },
    { name: 'Adrian Pettersen',    position: 'Angrep',   jerseyNumber: 9  },
    { name: 'Marcus Haugen',       position: 'Angrep',   jerseyNumber: 12 },
    { name: 'Kristoffer Lie',      position: 'Angrep',   jerseyNumber: 13 },
  ],
  '6895': [
    { name: 'Filip Johansen',   position: 'Keeper',   jerseyNumber: 1  },
    { name: 'Aksel Moen',       position: 'Forsvar',  jerseyNumber: 2  },
    { name: 'Casper Lund',      position: 'Forsvar',  jerseyNumber: 3  },
    { name: 'Daniel Svensson',  position: 'Forsvar',  jerseyNumber: 4  },
    { name: 'Benjamin Thorsen', position: 'Forsvar',  jerseyNumber: 5  },
    { name: 'Simon Olsen',      position: 'Forsvar',  jerseyNumber: 12 },
    { name: 'Victor Aasen',     position: 'Midtbane', jerseyNumber: 6  },
    { name: 'Markus Solberg',   position: 'Midtbane', jerseyNumber: 7  },
    { name: 'Julian Hagen',     position: 'Midtbane', jerseyNumber: 8  },
    { name: 'Patrick Lindberg', position: 'Midtbane', jerseyNumber: 10 },
    { name: 'Lukas Iversen',    position: 'Midtbane', jerseyNumber: 13 },
    { name: 'Aleksander Vold',  position: 'Angrep',   jerseyNumber: 9  },
    { name: 'Thomas Knutsen',   position: 'Angrep',   jerseyNumber: 11 },
    { name: 'Martin Bakken',    position: 'Angrep',   jerseyNumber: 14 },
  ],
  '154500': [
    { name: 'Håkon Gundersen',  position: 'Keeper',   jerseyNumber: 1  },
    { name: 'Stian Nygård',     position: 'Forsvar',  jerseyNumber: 2  },
    { name: 'Morten Rød',       position: 'Forsvar',  jerseyNumber: 3  },
    { name: 'Nicolai Holt',     position: 'Forsvar',  jerseyNumber: 4  },
    { name: 'Eivind Bjerke',    position: 'Forsvar',  jerseyNumber: 5  },
    { name: 'Simen Wold',       position: 'Midtbane', jerseyNumber: 6  },
    { name: 'Andreas Fjeld',    position: 'Midtbane', jerseyNumber: 7  },
    { name: 'Jon Espen Haug',   position: 'Midtbane', jerseyNumber: 8  },
    { name: 'Eirik Solheim',    position: 'Midtbane', jerseyNumber: 10 },
    { name: 'Torbjørn Strand',  position: 'Midtbane', jerseyNumber: 12 },
    { name: 'Kristian Bøe',     position: 'Angrep',   jerseyNumber: 9  },
    { name: 'Sigurd Lie',       position: 'Angrep',   jerseyNumber: 11 },
    { name: 'Fredrik Næss',     position: 'Angrep',   jerseyNumber: 13 },
  ],
};

export function getMockMatches(fiksId: string): Match[] {
  return MOCK_MATCHES[fiksId] ?? [];
}

export function getMockPlayers(fiksId: string): Player[] {
  if (nesoddenPlayers[fiksId]) return nesoddenPlayers[fiksId];

  // Generate deterministic opponent players
  const firstNames = ['Erik', 'Lars', 'Mads', 'Mikkel', 'Tom', 'Ola', 'Per', 'Geir', 'Tor', 'Arne', 'Stig', 'Rune', 'Dag', 'Kim'];
  const lastNames  = ['Hansen', 'Nilsen', 'Andersen', 'Berg', 'Dahl', 'Holm', 'Strand', 'Moen', 'Lund', 'Vold', 'Ruud', 'Foss'];
  const positions  = ['Keeper', 'Forsvar', 'Forsvar', 'Forsvar', 'Forsvar', 'Midtbane', 'Midtbane', 'Midtbane', 'Midtbane', 'Angrep', 'Angrep'];
  const seed = parseInt(fiksId) % 100;

  return positions.map((pos, i) => ({
    name: `${firstNames[(seed + i) % firstNames.length]} ${lastNames[(seed + i * 3) % lastNames.length]}`,
    position: pos,
    jerseyNumber: i === 0 ? 1 : i + 1,
  }));
}
