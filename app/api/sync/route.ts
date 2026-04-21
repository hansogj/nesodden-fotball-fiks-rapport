import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parse as parseEnv } from 'dotenv';
import { readSyncedData } from '@/lib/fiksSync';

const AUTH_FILE = join(process.cwd(), '.auth', 'fiks.json');

/**
 * Read FIKS credentials from process.env first, then fall back to .env.test.
 * Next.js loads .env.local; Playwright tests use .env.test — the fallback
 * ensures the sync button works without duplicating credentials.
 */
function getCredentials(): { email: string; password: string; env: NodeJS.ProcessEnv } | null {
  let email    = process.env.FIKS_EMAIL    ?? '';
  let password = process.env.FIKS_PASSWORD ?? '';

  if (!email || !password) {
    try {
      const parsed = parseEnv(readFileSync(join(process.cwd(), '.env.test'), 'utf-8'));
      email    = email    || parsed.FIKS_EMAIL    || '';
      password = password || parsed.FIKS_PASSWORD || '';
    } catch { /* .env.test may not exist */ }
  }

  if (!email || !password) return null;
  // Build env for subprocess so credentials are always present regardless of source
  return { email, password, env: { ...process.env, FIKS_EMAIL: email, FIKS_PASSWORD: password } };
}

/**
 * If .auth/fiks.json is less than 4 hours old we can reuse the session and
 * skip the re-authentication step (saves ~15 s per sync).
 */
function authIsRecent(): boolean {
  try {
    return existsSync(AUTH_FILE) &&
      Date.now() - statSync(AUTH_FILE).mtimeMs < 4 * 60 * 60 * 1000;
  } catch { return false; }
}

/** POST /api/sync — trigger a sync from fiks.fotball.no
 *
 * Body (optional JSON): { teams: Team[] }
 *   When provided, only those teams are synced (partial sync).
 *   Existing data for other teams is preserved.
 *   When omitted, syncs the default G16 teams.
 */
export async function POST(req: Request) {
  const creds = getCredentials();
  if (!creds) {
    return NextResponse.json(
      { success: false, error: 'FIKS_EMAIL og FIKS_PASSWORD må settes i .env.local eller .env.test' },
      { status: 400 }
    );
  }

  // Parse optional teams from body
  let syncTeamsEnv: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body?.teams?.length) {
      syncTeamsEnv = JSON.stringify(body.teams);
    }
  } catch { /* no body */ }

  // Use sync-fresh (no re-auth) when session is still valid, otherwise full sync
  const project = authIsRecent() ? 'sync-fresh' : 'sync';

  const exitCode = await new Promise<number>((resolve) => {
    const proc = spawn(
      'npx',
      ['playwright', 'test', `--project=${project}`, '--reporter=list'],
      {
        cwd: process.cwd(),
        env: {
          ...creds.env,
          ...(syncTeamsEnv ? { SYNC_TEAMS: syncTeamsEnv } : {}),
        },
        stdio: 'inherit',
      }
    );
    proc.on('close', resolve);
    proc.on('error', () => resolve(1));
  });

  const data = readSyncedData();

  if (exitCode !== 0 || !data) {
    return NextResponse.json(
      { success: false, error: 'Playwright sync failed — check server terminal for details' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    lastSynced: data.lastSynced,
    matchCounts: Object.fromEntries(
      Object.entries(data.matches).map(([id, m]) => [id, m.length])
    ),
    playerCounts: Object.fromEntries(
      Object.entries(data.players).map(([id, p]) => [id, p.length])
    ),
  });
}

/** GET /api/sync — return current sync status without triggering a new sync */
export async function GET() {
  const data = readSyncedData();
  if (!data) {
    return NextResponse.json({ synced: false, lastSynced: null });
  }
  return NextResponse.json({
    synced: true,
    lastSynced: data.lastSynced,
    matchCounts: Object.fromEntries(
      Object.entries(data.matches).map(([id, m]) => [id, m.length])
    ),
    playerCounts: Object.fromEntries(
      Object.entries(data.players).map(([id, p]) => [id, p.length])
    ),
  });
}
