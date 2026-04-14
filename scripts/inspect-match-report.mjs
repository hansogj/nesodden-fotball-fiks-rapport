/**
 * Inspects the MatchReport page for G16-1 vs Grüner (11.04.2026)
 * URL: https://fiks.fotball.no/FiksWeb/MatchReport/View/8977342
 *
 * Usage: node scripts/inspect-match-report.mjs
 */
import { chromium } from 'playwright';
import { config }   from 'dotenv';
import fs           from 'fs';
import path         from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

config({ path: path.join(ROOT, '.env.test') });

const FIKS_BASE   = 'https://fiks.fotball.no';
const REPORT_URL  = `${FIKS_BASE}/FiksWeb/MatchReport/View/8977342`;
const AUTH_FILE   = path.join(ROOT, '.auth', 'fiks.json');
const DATA_DIR    = path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

async function run() {
  const email    = process.env.FIKS_EMAIL;
  const password = process.env.FIKS_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext({
    storageState: fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined,
  });
  const page = await ctx.newPage();

  // Auth check
  await page.goto(`${FIKS_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

  if (page.url().toLowerCase().includes('login')) {
    console.log('[auth] Logging in...');
    await page.locator('#UserName').fill(email);
    await page.locator('#Password').fill(password);
    await page.getByRole('button', { name: /logg inn/i }).click();
    await page.waitForURL((url) => !url.pathname.toLowerCase().includes('login'), { timeout: 20000 });
    await ctx.storageState({ path: AUTH_FILE });
    console.log('[auth] Done.');
  } else {
    console.log(`[auth] Authenticated. URL: ${page.url()}`);
  }

  // ── Visit MatchReport page ────────────────────────────────────────────────────
  console.log(`\n[1] Navigating to: ${REPORT_URL}`);
  const response = await page.goto(REPORT_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const finalUrl = page.url();
  const status   = response?.status() ?? 0;
  const title    = await page.title();
  console.log(`   status=${status}  title="${title}"  finalUrl="${finalUrl}"`);

  // Save full HTML
  const html = await page.content();
  const htmlFile = path.join(DATA_DIR, 'match-report-8977342.html');
  fs.writeFileSync(htmlFile, html);
  console.log(`   HTML saved: ${htmlFile} (${html.length} chars)`);

  // ── Structure analysis ────────────────────────────────────────────────────────
  console.log('\n== Page structure ==');

  // All headings
  const headings = await page.locator('h1, h2, h3, h4, .panel-title').allInnerTexts().catch(() => []);
  console.log('\nHeadings:');
  headings.forEach(h => console.log(`  "${h.trim()}"`));

  // Panel / accordion sections
  console.log('\nPanels/sections:');
  const panels = page.locator('.panel, .card, [class*="panel"], .accordion-group');
  const panelCount = await panels.count();
  console.log(`  Panel elements: ${panelCount}`);
  for (let i = 0; i < Math.min(panelCount, 10); i++) {
    const id  = await panels.nth(i).getAttribute('id').catch(() => '');
    const cls = await panels.nth(i).getAttribute('class').catch(() => '');
    const txt = (await panels.nth(i).innerText().catch(() => '')).slice(0, 100).replace(/\s+/g, ' ');
    console.log(`  [${i}] id="${id}" class="${cls}" preview="${txt}"`);
  }

  // All tables
  console.log('\nTables:');
  const tables = page.locator('table');
  const tableCount = await tables.count();
  console.log(`  Total tables: ${tableCount}`);
  for (let t = 0; t < tableCount; t++) {
    const id   = await tables.nth(t).getAttribute('id').catch(() => '');
    const cls  = await tables.nth(t).getAttribute('class').catch(() => '');
    const headers = await tables.nth(t).locator('th').allInnerTexts().catch(() => []);
    const rows    = await tables.nth(t).locator('tbody tr').count().catch(() => 0);
    console.log(`  Table ${t}: id="${id}" class="${cls}" headers=[${headers.join('|')}] rows=${rows}`);

    // Print up to 5 data rows
    for (let r = 0; r < Math.min(rows, 5); r++) {
      const rowText = await tables.nth(t).locator('tbody tr').nth(r).innerText().catch(() => '');
      console.log(`    row${r}: "${rowText.replace(/\s+/g, ' ').trim().slice(0, 200)}"`);
    }

    // Print outer HTML of first row for selector context
    if (rows > 0) {
      const firstRowHtml = await tables.nth(t).locator('tbody tr').first().evaluate(el => el.outerHTML).catch(() => '');
      console.log(`    first row HTML:\n${firstRowHtml.slice(0, 500)}`);
    }
  }

  // Look for player/squad containers using broad selectors
  console.log('\nSquad-related elements:');
  const broadSelectors = [
    '[id*="amptropp"]', '[class*="amptropp"]',
    '[id*="squad"]',    '[class*="squad"]',
    '[id*="Player"]',   '[class*="player"]',
    '[id*="home"]',     '[id*="away"]',
    '[id*="Home"]',     '[id*="Away"]',
    '[id*="tropp"]',    '[class*="tropp"]',
    '[id*="lag"]',      '[class*="lag"]',
  ];
  for (const sel of broadSelectors) {
    const els = page.locator(sel);
    const cnt = await els.count().catch(() => 0);
    if (cnt > 0) {
      for (let e = 0; e < Math.min(cnt, 3); e++) {
        const id  = await els.nth(e).getAttribute('id').catch(() => '');
        const cls = await els.nth(e).getAttribute('class').catch(() => '');
        const txt = (await els.nth(e).innerText().catch(() => '')).slice(0, 200).replace(/\s+/g, ' ');
        console.log(`  ${sel}[${e}]: id="${id}" class="${cls}" preview="${txt}"`);
      }
    }
  }

  // ── Extract team names ────────────────────────────────────────────────────────
  console.log('\nTeam names on page:');
  const teamNameCandidates = [
    '.team-name', '.home-team', '.away-team',
    '[class*="team-name"]', '[class*="teamName"]',
    'h2', '.match-header', '[class*="match"]',
  ];
  for (const sel of teamNameCandidates) {
    const els = page.locator(sel);
    const cnt = await els.count().catch(() => 0);
    if (cnt > 0 && cnt < 20) {
      const texts = await els.allInnerTexts().catch(() => []);
      const relevant = texts.filter(t => t.trim().length > 0 && t.trim().length < 80);
      if (relevant.length > 0) {
        console.log(`  ${sel}: [${relevant.map(t => `"${t.trim()}"`).join(', ')}]`);
      }
    }
  }

  // ── Look for any expandable sections (collapsed by default) ──────────────────
  console.log('\nCollapsible/accordion sections:');
  const collapsibles = page.locator('[data-toggle="collapse"], [data-bs-toggle="collapse"], .accordion-toggle, .panel-heading a');
  const collCount = await collapsibles.count();
  console.log(`  Found ${collCount} toggle elements`);
  for (let c = 0; c < Math.min(collCount, 10); c++) {
    const txt  = await collapsibles.nth(c).innerText().catch(() => '');
    const href = await collapsibles.nth(c).getAttribute('href').catch(() => '');
    const target = await collapsibles.nth(c).getAttribute('data-target').catch(() => '')
                || await collapsibles.nth(c).getAttribute('data-bs-target').catch(() => '');
    console.log(`  [${c}] text="${txt.trim()}" href="${href}" target="${target}"`);
  }

  await browser.close();
  console.log('\n[done] Inspection complete.');
  console.log(`\nKey URL confirmed: ${REPORT_URL}`);
}

run().catch(e => { console.error(e); process.exit(1); });
