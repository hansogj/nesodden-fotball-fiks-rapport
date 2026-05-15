import type { Page } from '@playwright/test';

const FIKS_BASE = 'https://fiks.fotball.no';

export const TEAMS = [
  { name: 'G16-1', fiksId: '134742' },
  { name: 'G16-2', fiksId: '154500' },
  { name: 'G16-3', fiksId: '6895'   },
] as const;

export function fiksTeamUrl(teamId: string) {
  return `${FIKS_BASE}/FiksWeb/Team/View/${teamId}?accordionHistory=collapseTwo`;
}

interface FiksMatch {
  date: string;       // raw text from FIKS
  homeTeam: string;
  awayTeam: string;
  result?: string;
  venue?: string;
}

/**
 * Extracts upcoming (and recent) matches from a FIKS team page.
 * Assumes the page is already authenticated and loaded.
 */
export async function extractFiksMatches(page: Page): Promise<FiksMatch[]> {
  // Wait for the accordion / match table to be visible
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const matches: FiksMatch[] = [];

  // FIKS renders matches in table rows inside a collapseTwo accordion panel.
  // Selector candidates (FIKS uses Bootstrap accordion + standard table markup):
  const rows = page.locator(
    '#collapseTwo table tbody tr, ' +
    '[id*="collapseTwo"] table tbody tr, ' +
    '.panel-body table tbody tr'
  );

  const count = await rows.count();

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    const cellCount = await cells.count();
    if (cellCount < 3) continue;

    const texts = await Promise.all(
      Array.from({ length: cellCount }, (_, j) => cells.nth(j).innerText())
    );

    const cleaned = texts.map((t) => t.trim().replace(/\s+/g, ' '));

    // Heuristic: look for a cell that looks like a date (dd.mm.yyyy or dd/mm)
    const dateIdx = cleaned.findIndex((t) => /\d{1,2}[./]\d{1,2}/.test(t));
    if (dateIdx === -1) continue;

    // Home / away are typically 2 cells after date (with possible time cell in between)
    // Common layouts: [date] [time?] [home] [result] [away]  or  [date] [home] [-] [away]
    // We detect by looking for a cell that contains " - " or a score pattern
    const scoreIdx = cleaned.findIndex((t, i) => i > dateIdx && /^\d+\s*[-–]\s*\d+$|^-$/.test(t));

    let homeTeam = '';
    let awayTeam = '';
    let result: string | undefined;

    if (scoreIdx !== -1) {
      // home is the cell just before score, away is just after
      homeTeam = cleaned[scoreIdx - 1] ?? '';
      awayTeam = cleaned[scoreIdx + 1] ?? '';
      result = cleaned[scoreIdx] !== '-' ? cleaned[scoreIdx] : undefined;
    } else {
      // fallback: take first two non-empty non-date cells
      const candidates = cleaned.filter((t, i) => i > dateIdx && t.length > 1 && !/^\d{2}:\d{2}$/.test(t));
      homeTeam = candidates[0] ?? '';
      awayTeam = candidates[1] ?? '';
    }

    if (!homeTeam || !awayTeam) continue;

    matches.push({ date: cleaned[dateIdx], homeTeam, awayTeam, result });
  }

  return matches;
}

/**
 * Normalises a team name for loose comparison
 * (removes "G16", extra spaces, "2", "3" suffixes, lowercase).
 */
export function normaliseTeamName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bnesodden\s*\d*\b/g, 'nesodden')
    .replace(/\bg16[-\s]?\d\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
