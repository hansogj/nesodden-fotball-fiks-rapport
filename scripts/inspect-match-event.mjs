/**
 * Standalone script (no Playwright test runner needed):
 * Logs in to fiks.fotball.no and inspects the match event page
 * for G16-1 (Nesodden) vs Grüner, 11.04.2026, match ID: 03116201005
 *
 * Usage:  node scripts/inspect-match-event.mjs
 */
import { chromium }   from 'playwright';
import { config }     from 'dotenv';
import fs             from 'fs';
import path           from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

config({ path: path.join(ROOT, '.env.test') });

const FIKS_BASE  = 'https://fiks.fotball.no';
const MATCH_ID   = '03116201005';
const G16_1_ID   = '134742';
const AUTH_FILE  = path.join(ROOT, '.auth', 'fiks.json');
const DATA_DIR   = path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

async function run() {
  const email    = process.env.FIKS_EMAIL;
  const password = process.env.FIKS_PASSWORD;

  if (!email || !password) {
    console.error('FIKS_EMAIL / FIKS_PASSWORD not set');
    process.exit(1);
  }

  console.log(`Email: ${email.slice(0,3)}***  (password ${password.length} chars)`);

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
  });
  const page = await ctx.newPage();

  // ── 0. Authenticate if needed ────────────────────────────────────────────────
  await page.goto(`${FIKS_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  if (page.url().toLowerCase().includes('login')) {
    console.log('\n[auth] Logging in...');
    await page.locator('#UserName').fill(email);
    await page.locator('#Password').fill(password);
    await page.getByRole('button', { name: /logg inn/i }).click();
    await page.waitForURL((url) => !url.pathname.toLowerCase().includes('login'), { timeout: 20000 });
    await ctx.storageState({ path: AUTH_FILE });
    console.log('[auth] Logged in. Saved storageState.');
  } else {
    console.log(`[auth] Already authenticated. URL: ${page.url()}`);
  }

  // ── 1. Try candidate MatchEvent URL patterns ─────────────────────────────────
  const candidateUrls = [
    `${FIKS_BASE}/FiksWeb/MatchEvent/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/Match/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchEvent/Index/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/Fixtures/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchSheet/View/${MATCH_ID}`,
    `${FIKS_BASE}/FiksWeb/Match/Report/${MATCH_ID}`,
  ];

  let workingUrl = null;

  for (const url of candidateUrls) {
    console.log(`\n[1] Trying: ${url}`);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    }).catch(e => { console.log(`   Error: ${e.message}`); return null; });

    const finalUrl = page.url();
    const status   = response?.status() ?? 0;
    const title    = await page.title().catch(() => '');
    const is404    = status === 404 || title.toLowerCase().includes('not found') || finalUrl.includes('404') || title.includes('404');

    console.log(`   status=${status}  title="${title}"  final="${finalUrl}"  404=${is404}`);

    if (!is404 && status < 400 && status > 0) {
      console.log('   >>> FOUND a working URL!');
      workingUrl = finalUrl;

      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Save full HTML
      const html = await page.content();
      const htmlFile = path.join(DATA_DIR, `match-event-${url.replace(/[^a-z0-9]/gi, '_').slice(-40)}.html`);
      fs.writeFileSync(htmlFile, html);
      console.log(`   Saved HTML: ${htmlFile} (${html.length} chars)`);

      // Print headings
      const headings = await page.locator('h1, h2, h3, h4, .panel-title').allInnerTexts().catch(() => []);
      console.log('\n   == Headings ==');
      headings.slice(0, 20).forEach(h => console.log(`   "${h.trim()}"`));

      // Analyse tables
      const tables = page.locator('table');
      const tableCount = await tables.count();
      console.log(`\n   == Tables (${tableCount}) ==`);
      for (let t = 0; t < Math.min(tableCount, 10); t++) {
        const headers  = await tables.nth(t).locator('th').allInnerTexts().catch(() => []);
        const rows     = await tables.nth(t).locator('tbody tr').count().catch(() => 0);
        const tableId  = await tables.nth(t).getAttribute('id').catch(() => '');
        const tableCls = await tables.nth(t).getAttribute('class').catch(() => '');
        console.log(`   Table ${t}: id="${tableId}" class="${tableCls}" headers=[${headers.join('|')}] rows=${rows}`);

        if (rows > 0 && rows < 50) {
          for (let r = 0; r < Math.min(rows, 3); r++) {
            const rowText = await tables.nth(t).locator('tbody tr').nth(r).innerText().catch(() => '');
            console.log(`     row${r}: "${rowText.replace(/\s+/g, ' ').slice(0, 150)}"`);
          }
        }
      }

      // Check for squad/tropp sections by keyword
      const squadSelectors = [
        '[id*="amptropp"]', '[class*="amptropp"]',
        '[id*="squad"]',    '[class*="squad"]',
        '[id*="Tropp"]',    '[class*="Tropp"]',
        '[id*="Player"]',   '[class*="player"]',
        '#homePlayers',     '#awayPlayers',
        '.home-players',    '.away-players',
        '[data-home]',      '[data-away]',
        '#home',            '#away',
      ];

      console.log('\n   == Squad-related selectors ==');
      for (const sel of squadSelectors) {
        const cnt = await page.locator(sel).count().catch(() => 0);
        if (cnt > 0) {
          const txt = await page.locator(sel).first().innerText().catch(() => '');
          console.log(`   ${sel}: count=${cnt}  preview="${txt.slice(0, 120).replace(/\s+/g, ' ')}"`);
        }
      }

      break;
    }
  }

  // ── 2. Visit team page and find match link ───────────────────────────────────
  console.log(`\n\n[2] Team page: searching for match link with ID ${MATCH_ID}...`);
  await page.goto(
    `${FIKS_BASE}/FiksWeb/Team/View/${G16_1_ID}?accordionHistory=collapseTwo`,
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  );
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // All links on the page containing the match ID
  const matchLinks = await page.locator(`a[href*="${MATCH_ID}"]`).all();
  console.log(`[2] Links containing "${MATCH_ID}": ${matchLinks.length}`);
  for (const link of matchLinks) {
    const href = await link.getAttribute('href').catch(() => '');
    const text = await link.innerText().catch(() => '');
    console.log(`   href="${href}"  text="${text.trim()}"`);
  }

  // Row containing the match ID
  const rows = page.locator('#collapseTwo table tbody tr');
  const rowCount = await rows.count();
  console.log(`\n[2] Total rows in #collapseTwo: ${rowCount}`);

  for (let i = 0; i < rowCount; i++) {
    const txt = await rows.nth(i).innerText().catch(() => '');
    if (txt.includes(MATCH_ID) || txt.includes('Grüner') || txt.includes('Gruner')) {
      console.log(`\n[2] Matching row ${i}: "${txt.replace(/\s+/g, ' ').slice(0, 300)}"`);
      // Get all links
      const rowLinks = await rows.nth(i).locator('a').all();
      for (const link of rowLinks) {
        const href = await link.getAttribute('href').catch(() => '');
        const text = await link.innerText().catch(() => '');
        console.log(`   Link href="${href}"  text="${text.trim()}"`);
      }
      // Get outer HTML of this row
      const rowHtml = await rows.nth(i).evaluate(el => el.outerHTML).catch(() => '');
      console.log(`   Row HTML:\n${rowHtml.slice(0, 800)}`);
    }
  }

  // ── 3. Save everything ───────────────────────────────────────────────────────
  const teamPageHtml = await page.content();
  const teamHtmlFile = path.join(DATA_DIR, 'team-page-g16-1.html');
  fs.writeFileSync(teamHtmlFile, teamPageHtml);
  console.log(`\n[3] Team page HTML saved: ${teamHtmlFile} (${teamPageHtml.length} chars)`);

  await browser.close();
  console.log('\n[done] Script complete.');
  if (workingUrl) {
    console.log(`\n>>> WORKING MATCH EVENT URL: ${workingUrl}`);
  } else {
    console.log('\n>>> No working MatchEvent URL found via candidate list.');
  }
}

run().catch(e => { console.error(e); process.exit(1); });
