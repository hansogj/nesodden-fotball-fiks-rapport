/**
 * One-shot inspection script:
 * 1. Log in to fiks.fotball.no
 * 2. Navigate to the G16-1 team page and find the match vs Grüner on 11.04.2026
 * 3. Try various URL patterns for the MatchEvent page (match ID: 03116201005)
 * 4. Dump the HTML structure of the squad / kamptropp section
 *
 * Run with:
 *   npx playwright test tests/inspect-match-event.spec.ts --project=fiks-setup
 *   npx playwright test tests/inspect-match-event.spec.ts --headed
 */
import { test, expect } from '@playwright/test';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';

config({ path: '.env.test' });

const FIKS_BASE  = 'https://fiks.fotball.no';
const MATCH_ID   = '03116201005';
const G16_1_ID   = '134742';
const AUTH_FILE  = path.join(process.cwd(), '.auth', 'fiks.json');
const OUT_FILE   = path.join(process.cwd(), 'data', 'match-event-inspection.json');

test.use({ storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined } as any);

test('inspect match event page for G16-1 vs Grüner 11.04.2026', async ({ page }) => {
  // ── 0. Authenticate if not already ──────────────────────────────────────────
  const email    = process.env.FIKS_EMAIL;
  const password = process.env.FIKS_PASSWORD;

  await page.goto(`${FIKS_BASE}/`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  const currentUrl = page.url();
  console.log(`[0] After initial goto: ${currentUrl}`);

  if (currentUrl.toLowerCase().includes('login')) {
    console.log('[0] Not authenticated — logging in...');
    await page.locator('#UserName').fill(email!);
    await page.locator('#Password').fill(password!);
    await page.getByRole('button', { name: /logg inn/i }).click();
    await page.waitForURL((url) => !url.pathname.toLowerCase().includes('login'), { timeout: 15000 });
    console.log(`[0] After login: ${page.url()}`);
  } else {
    console.log('[0] Already authenticated via storageState');
  }

  // ── 1. Try candidate MatchEvent URL patterns ─────────────────────────────────
  const candidateUrls = [
    `${FIKS_BASE}/FiksWeb/MatchEvent/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/Match/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchEvent/Index/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/Fixtures/View/${MATCH_ID}`,
  ];

  const results: Record<string, any> = {};

  for (const url of candidateUrls) {
    console.log(`\n[1] Trying: ${url}`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
    const finalUrl  = page.url();
    const status    = response?.status() ?? 'no-response';
    const title     = await page.title().catch(() => '');
    const notFound  = title.toLowerCase().includes('not found') || title.includes('404') || finalUrl.includes('404');
    console.log(`   status=${status}  final=${finalUrl}  title="${title}"  notFound=${notFound}`);

    results[url] = { status, finalUrl, title, notFound };

    if (!notFound && status !== 404) {
      console.log('   >>> Looks promising! Inspecting page...');
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Capture full HTML for analysis
      const html = await page.content();
      const htmlFile = path.join(process.cwd(), 'data', `match-event-${url.split('/').pop()}.html`);
      fs.mkdirSync(path.dirname(htmlFile), { recursive: true });
      fs.writeFileSync(htmlFile, html);
      console.log(`   HTML saved to ${htmlFile} (${html.length} bytes)`);

      results[url].htmlFile    = htmlFile;
      results[url].htmlLength  = html.length;

      // Extract headings and table summaries
      const headings = await page.locator('h1, h2, h3, h4, .panel-title').allInnerTexts().catch(() => []);
      console.log('   Headings:', headings.slice(0, 15));

      // Look for squad-related sections
      const squadSelectors = [
        '#kamptropp', '.kamptropp',
        '[id*="kamptropp"]', '[class*="kamptropp"]',
        '[id*="squad"]', '[class*="squad"]',
        '[id*="Tropp"]', '[class*="Tropp"]',
        '#collapseSquad', '.match-squad',
        'table',
      ];

      const squadInfo: Record<string, any> = {};
      for (const sel of squadSelectors) {
        const els = page.locator(sel);
        const cnt = await els.count().catch(() => 0);
        if (cnt > 0) {
          const firstText = await els.first().innerText().catch(() => '');
          squadInfo[sel] = { count: cnt, preview: firstText.slice(0, 200) };
          console.log(`   [${sel}] count=${cnt}  preview="${firstText.slice(0, 100)}"`);
        }
      }

      results[url].headings  = headings;
      results[url].squadInfo = squadInfo;

      // Get all table column headers
      const tables = page.locator('table');
      const tableCount = await tables.count();
      console.log(`   Tables found: ${tableCount}`);
      for (let t = 0; t < Math.min(tableCount, 5); t++) {
        const headers = await tables.nth(t).locator('th').allInnerTexts().catch(() => []);
        const rowCount = await tables.nth(t).locator('tbody tr').count().catch(() => 0);
        console.log(`   Table ${t}: headers=[${headers.join(', ')}]  rows=${rowCount}`);

        if (rowCount > 0) {
          const firstRow = await tables.nth(t).locator('tbody tr').first().innerText().catch(() => '');
          console.log(`   Table ${t} first row: "${firstRow.slice(0, 150)}"`);
        }
      }

      break; // Stop at first working URL
    }
  }

  // ── 2. Also visit the G16-1 team page and find the match link ────────────────
  console.log(`\n[2] Visiting G16-1 team page to find match link...`);
  await page.goto(
    `${FIKS_BASE}/FiksWeb/Team/View/${G16_1_ID}?accordionHistory=collapseTwo`,
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  );
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Find the row with matchId 03116201005
  const matchRow = page.locator(`#collapseTwo table tbody tr`).filter({ hasText: MATCH_ID });
  const matchRowCount = await matchRow.count();
  console.log(`[2] Rows containing "${MATCH_ID}": ${matchRowCount}`);

  if (matchRowCount > 0) {
    const rowText = await matchRow.first().innerText();
    console.log(`[2] Match row text: "${rowText}"`);

    // Find all links in this row
    const links = matchRow.first().locator('a');
    const linkCount = await links.count();
    console.log(`[2] Links in row: ${linkCount}`);
    for (let l = 0; l < linkCount; l++) {
      const href = await links.nth(l).getAttribute('href').catch(() => '');
      const text = await links.nth(l).innerText().catch(() => '');
      console.log(`   Link ${l}: href="${href}"  text="${text}"`);
      if (href) results[`teamPage_link_${l}`] = { href, text };
    }
  }

  // Also search for any links containing the matchId anywhere on the page
  const allMatchLinks = page.locator(`a[href*="${MATCH_ID}"]`);
  const allMatchLinkCount = await allMatchLinks.count();
  console.log(`\n[2] All links containing "${MATCH_ID}": ${allMatchLinkCount}`);
  for (let l = 0; l < allMatchLinkCount; l++) {
    const href = await allMatchLinks.nth(l).getAttribute('href').catch(() => '');
    const text = await allMatchLinks.nth(l).innerText().catch(() => '');
    console.log(`   href="${href}"  text="${text}"`);
    results[`matchIdLink_${l}`] = { href, text };
  }

  // Save results
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\n[done] Results saved to ${OUT_FILE}`);
});
