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

export function readSyncedData(): SyncedData | null {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as SyncedData;
  } catch {
    return null;
  }
}

export function writeSyncedData(data: SyncedData): void {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
