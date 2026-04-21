/**
 * Multi-file data layer for the FIKS sync pipeline.
 *
 * Data is split across several files under data/:
 *   club.json                    — clubTeams (Nesodden teams grouped by age)
 *   squads.json                  — all squads keyed by matchReportId
 *   opponents.json               — opponent matches and team metadata
 *   teams/{ageGroup}/{fiksId}.json — per-team matches, players, lastSynced
 *
 * Playwright sync logic lives in tests/fiks-sync.spec.ts and runs as a child process.
 */
import fs from 'fs';
import path from 'path';
import type { Match, Player, Squad, OpponentTeam, Team } from './types';

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), 'data');
const CLUB_FILE = path.join(DATA_DIR, 'club.json');
const SQUADS_FILE = path.join(DATA_DIR, 'squads.json');
const OPPONENTS_FILE = path.join(DATA_DIR, 'opponents.json');
const TEAMS_DIR = path.join(DATA_DIR, 'teams');
const LEGACY_FILE = path.join(DATA_DIR, 'synced-data.json');

export function teamFilePath(ageGroup: string, fiksId: string): string {
  return path.join(TEAMS_DIR, ageGroup, `${fiksId}.json`);
}

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface TeamFileData {
  matches: Match[];
  players: Player[];
  lastSynced: string;
}

export interface ClubFileData {
  clubTeams: Record<string, Team[]>;
  lastSynced?: string;
}

export interface OpponentsFileData {
  matches: Record<string, Match[]>;
  teams: Record<string, OpponentTeam>;
}

// ── Generic mtime-cached reader ──────────────────────────────────────────────

const _cache = new Map<string, { data: unknown; mtime: number }>();

function readJsonCached<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const mtime = fs.statSync(filePath).mtimeMs;
    const cached = _cache.get(filePath);
    if (cached && mtime <= cached.mtime) return cached.data as T;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    _cache.set(filePath, { data, mtime });
    return data;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  _cache.set(filePath, { data, mtime: fs.statSync(filePath).mtimeMs });
}

// ── Team data (per-team file) ────────────────────────────────────────────────

export function readTeamData(ageGroup: string, fiksId: string): TeamFileData | null {
  return readJsonCached<TeamFileData>(teamFilePath(ageGroup, fiksId));
}

export function writeTeamData(ageGroup: string, fiksId: string, data: TeamFileData): void {
  writeJson(teamFilePath(ageGroup, fiksId), data);
}

// ── Squads (shared file) ─────────────────────────────────────────────────────

export function readSquads(): Record<string, Squad> {
  return readJsonCached<Record<string, Squad>>(SQUADS_FILE) ?? {};
}

export function readSquad(matchReportId: string): Squad | null {
  const all = readSquads();
  return all[matchReportId] ?? null;
}

export function writeSquads(data: Record<string, Squad>): void {
  writeJson(SQUADS_FILE, data);
}

// ── Club data ────────────────────────────────────────────────────────────────

export function readClubData(): ClubFileData | null {
  return readJsonCached<ClubFileData>(CLUB_FILE);
}

export function writeClubData(data: ClubFileData): void {
  writeJson(CLUB_FILE, data);
}

// ── Opponents ────────────────────────────────────────────────────────────────

export function readOpponents(): OpponentsFileData | null {
  return readJsonCached<OpponentsFileData>(OPPONENTS_FILE);
}

export function writeOpponents(data: OpponentsFileData): void {
  writeJson(OPPONENTS_FILE, data);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the age group directory for a given team fiksId.
 * Checks club.json first, then falls back to scanning the teams/ directory.
 */
export function findAgeGroup(fiksId: string): string | null {
  const club = readClubData();
  if (club?.clubTeams) {
    for (const [ageGroup, teams] of Object.entries(club.clubTeams)) {
      if (teams.some(t => t.fiksId === fiksId)) return ageGroup;
    }
  }
  // Fallback: scan directory
  try {
    if (!fs.existsSync(TEAMS_DIR)) return null;
    for (const ag of fs.readdirSync(TEAMS_DIR)) {
      const agDir = path.join(TEAMS_DIR, ag);
      if (!fs.statSync(agDir).isDirectory()) continue;
      if (fs.existsSync(path.join(agDir, `${fiksId}.json`))) return ag;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Read matches from ALL team files. Used by cross-team player sharing.
 * Uses club.json to discover files, falls back to directory scan.
 */
export function readAllTeamMatches(): Record<string, Match[]> {
  const result: Record<string, Match[]> = {};
  const club = readClubData();

  if (club?.clubTeams) {
    for (const [ageGroup, teams] of Object.entries(club.clubTeams)) {
      for (const team of teams) {
        const data = readTeamData(ageGroup, team.fiksId);
        if (data?.matches?.length) {
          result[team.fiksId] = data.matches;
        }
      }
    }
    return result;
  }

  // Fallback: scan directory
  try {
    if (!fs.existsSync(TEAMS_DIR)) return result;
    for (const ag of fs.readdirSync(TEAMS_DIR)) {
      const agDir = path.join(TEAMS_DIR, ag);
      if (!fs.statSync(agDir).isDirectory()) continue;
      for (const file of fs.readdirSync(agDir)) {
        if (!file.endsWith('.json')) continue;
        const fiksId = file.replace('.json', '');
        const data = readTeamData(ag, fiksId);
        if (data?.matches?.length) {
          result[fiksId] = data.matches;
        }
      }
    }
  } catch { /* ignore */ }
  return result;
}

/**
 * Read match/player counts across all team files. Used by the sync status endpoint.
 */
export function readAllTeamCounts(): {
  matchCounts: Record<string, number>;
  playerCounts: Record<string, number>;
} {
  const matchCounts: Record<string, number> = {};
  const playerCounts: Record<string, number> = {};
  const club = readClubData();

  const entries: Array<[string, string]> = [];
  if (club?.clubTeams) {
    for (const [ageGroup, teams] of Object.entries(club.clubTeams)) {
      for (const team of teams) {
        entries.push([ageGroup, team.fiksId]);
      }
    }
  } else {
    try {
      if (fs.existsSync(TEAMS_DIR)) {
        for (const ag of fs.readdirSync(TEAMS_DIR)) {
          const agDir = path.join(TEAMS_DIR, ag);
          if (!fs.statSync(agDir).isDirectory()) continue;
          for (const file of fs.readdirSync(agDir)) {
            if (!file.endsWith('.json')) continue;
            entries.push([ag, file.replace('.json', '')]);
          }
        }
      }
    } catch { /* ignore */ }
  }

  for (const [ag, fiksId] of entries) {
    const data = readTeamData(ag, fiksId);
    if (data) {
      matchCounts[fiksId] = data.matches.length;
      playerCounts[fiksId] = data.players.length;
    }
  }

  return { matchCounts, playerCounts };
}

// ── Legacy migration ─────────────────────────────────────────────────────────

interface LegacySyncedData {
  lastSynced: string;
  matches: Record<string, Match[]>;
  players: Record<string, Player[]>;
  squads: Record<string, Squad>;
  opponentMatches?: Record<string, Match[]>;
  opponentTeams?: Record<string, OpponentTeam>;
  clubTeams?: Record<string, Team[]>;
}

let _migrated = false;

/**
 * One-time migration: if legacy synced-data.json exists and club.json does not,
 * split the old file into the new multi-file layout and delete it.
 */
export function migrateFromLegacy(): void {
  if (_migrated) return;
  _migrated = true;

  if (!fs.existsSync(LEGACY_FILE) || fs.existsSync(CLUB_FILE)) return;

  let legacy: LegacySyncedData;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf-8'));
  } catch {
    return;
  }

  console.log('[migrate] Splitting synced-data.json into per-team files…');

  // Write club.json
  if (legacy.clubTeams) {
    writeClubData({ clubTeams: legacy.clubTeams, lastSynced: legacy.lastSynced });
  }

  // Write squads.json
  if (legacy.squads && Object.keys(legacy.squads).length > 0) {
    writeSquads(legacy.squads);
  }

  // Write opponents.json
  if (legacy.opponentMatches || legacy.opponentTeams) {
    writeOpponents({
      matches: legacy.opponentMatches ?? {},
      teams: legacy.opponentTeams ?? {},
    });
  }

  // Write per-team files
  const ageGroupForTeam: Record<string, string> = {};
  if (legacy.clubTeams) {
    for (const [ageGroup, teams] of Object.entries(legacy.clubTeams)) {
      for (const team of teams) {
        ageGroupForTeam[team.fiksId] = ageGroup;
      }
    }
  }

  const allFiksIds = new Set([
    ...Object.keys(legacy.matches ?? {}),
    ...Object.keys(legacy.players ?? {}),
  ]);

  for (const fiksId of allFiksIds) {
    const ageGroup = ageGroupForTeam[fiksId] ?? 'unknown';
    writeTeamData(ageGroup, fiksId, {
      matches: legacy.matches[fiksId] ?? [],
      players: legacy.players[fiksId] ?? [],
      lastSynced: legacy.lastSynced,
    });
  }

  // Remove legacy file
  fs.unlinkSync(LEGACY_FILE);
  console.log('[migrate] Done. Legacy synced-data.json removed.');
}

// Run migration on first import
migrateFromLegacy();
