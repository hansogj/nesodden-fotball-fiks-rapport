/**
 * Shared helpers for the FIKS sync pipeline.
 * Playwright logic lives in tests/fiks-sync.spec.ts and runs as a child process.
 */
import fs from 'fs';
import path from 'path';
import type { Match, Player, Squad } from './types';

export const DATA_FILE = path.join(process.cwd(), 'data', 'synced-data.json');

export interface SyncedData {
  lastSynced: string;
  matches: Record<string, Match[]>;
  players: Record<string, Player[]>;
  squads: Record<string, Squad>; // keyed by matchReportId
}

// In-memory cache keyed by file mtime — avoids re-parsing on every API request.
// Automatically invalidates when the file is updated by any process (sync subprocess, CLI).
let _cache: SyncedData | null = null;
let _cacheMtime = 0;

export function readSyncedData(): SyncedData | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const mtime = fs.statSync(DATA_FILE).mtimeMs;
    if (_cache !== null && mtime <= _cacheMtime) return _cache;
    _cache = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as SyncedData;
    _cacheMtime = mtime;
    return _cache;
  } catch {
    return null;
  }
}

export function writeSyncedData(data: SyncedData): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  _cache = data;
  _cacheMtime = fs.statSync(DATA_FILE).mtimeMs;
}
