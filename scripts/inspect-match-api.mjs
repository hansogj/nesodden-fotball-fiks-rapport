/**
 * Inspects network requests made by the MatchReport page to find the API
 * endpoints that deliver kamptropp (squad) data.
 *
 * Usage: node scripts/inspect-match-api.mjs
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

  // Capture all network requests
  const captured = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('api') || url.includes('Api') || url.includes('troop') || url.includes('Troop') ||
        url.includes('squad') || url.includes('Squad') || url.includes('player') || url.includes('Player') ||
        url.includes('match') || url.includes('Match') || url.includes('tropp') || url.includes('Tropp') ||
        url.includes('8977342') || url.includes('134742') || url.includes('75136')) {
      captured.push({ type: 'request', method: req.method(), url, postData: req.postData() });
    }
  });

  page.on('response', async resp => {
    const url  = resp.url();
    const status = resp.status();
    if (url.includes('api') || url.includes('Api') || url.includes('troop') || url.includes('Troop') ||
        url.includes('squad') || url.includes('Squad') || url.includes('player') || url.includes('Player') ||
        url.includes('8977342') || url.includes('134742') || url.includes('75136')) {
      let body = '';
      try {
        body = await resp.text();
      } catch {}
      captured.push({ type: 'response', status, url, bodyPreview: body.slice(0, 500) });
    }
  });

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
  }

  // Visit match report page
  console.log(`\n[1] Navigating to: ${REPORT_URL}`);
  await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // Print data attributes from #matchreport-container
  const container = page.locator('#matchreport-container');
  if (await container.count() > 0) {
    console.log('\n[2] #matchreport-container data attributes:');
    const attrs = await container.evaluate(el => {
      const result = {};
      for (const attr of el.attributes) {
        result[attr.name] = attr.value;
      }
      return result;
    });
    console.log(JSON.stringify(attrs, null, 2));
  }

  // Click "Hjemmelag" button and capture new requests
  console.log('\n[3] Clicking "Hjemmelag" button...');
  const hjemmeBtn = page.getByRole('button', { name: /hjemmelag/i });
  if (await hjemmeBtn.count() > 0) {
    await hjemmeBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Capture post-click HTML
    const html = await page.content();
    const htmlFile = path.join(DATA_DIR, 'match-report-after-hjemmelag-click.html');
    fs.writeFileSync(htmlFile, html);
    console.log(`   HTML saved: ${htmlFile}`);

    // Look for player data in DOM
    console.log('\n   DOM after Hjemmelag click:');
    const allText = await page.locator('.match-report').innerText().catch(() => '');
    console.log(allText.slice(0, 2000).replace(/\s+/g, ' '));

    // Find player list elements
    const playerSelectors = [
      '.player-list', '.squad-list', '.troop-list',
      '[class*="player-row"]', '[class*="squad-row"]',
      '.match-player', '[class*="matchplayer"]',
      'li.player', '.people-list li',
      '[class*="people"]', '[class*="tropp"]',
      '.home-players', '.squad',
      '[class*="spiller"]',
    ];

    console.log('\n   Player elements:');
    for (const sel of playerSelectors) {
      const cnt = await page.locator(sel).count().catch(() => 0);
      if (cnt > 0) {
        const txt = await page.locator(sel).first().innerText().catch(() => '');
        console.log(`   ${sel}: count=${cnt}  preview="${txt.slice(0,150).replace(/\s+/g,' ')}"`);
      }
    }
  } else {
    console.log('   No Hjemmelag button found');
  }

  // Click "Bortelag" button
  console.log('\n[4] Clicking "Bortelag" button...');
  const borteBtn = page.getByRole('button', { name: /bortelag/i });
  if (await borteBtn.count() > 0) {
    await borteBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const html = await page.content();
    const htmlFile = path.join(DATA_DIR, 'match-report-after-bortelag-click.html');
    fs.writeFileSync(htmlFile, html);
    console.log(`   HTML saved: ${htmlFile}`);

    const allText = await page.locator('.match-report').innerText().catch(() => '');
    console.log('\n   DOM after Bortelag click:');
    console.log(allText.slice(0, 2000).replace(/\s+/g, ' '));
  }

  // Print all captured network requests/responses
  console.log('\n\n[5] Captured API calls:');
  const printed = new Set();
  for (const item of captured) {
    const key = `${item.type}:${item.url}`;
    if (printed.has(key)) continue;
    printed.add(key);

    if (item.type === 'request') {
      console.log(`\nREQ ${item.method} ${item.url}`);
      if (item.postData) console.log(`  Body: ${item.postData.slice(0, 200)}`);
    } else {
      console.log(`RESP ${item.status} ${item.url}`);
      if (item.bodyPreview) console.log(`  Preview: ${item.bodyPreview.slice(0, 300).replace(/\s+/g, ' ')}`);
    }
  }

  // Also probe known API patterns directly
  console.log('\n\n[6] Probing known FIKS API patterns...');
  const HOME_TEAM_ID = '134742';
  const AWAY_TEAM_ID = '75136';
  const MATCH_DB_ID  = '8977342';
  const MATCH_NUM    = '03116201005';

  const apiUrls = [
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetTroops/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetSquad/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetHomeTroop/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetAwayTroop/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetMatchReport/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchApi/GetTroops?matchId=${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchApi/GetSquad?matchId=${MATCH_DB_ID}&teamId=${HOME_TEAM_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchApi/GetSquad?matchId=${MATCH_DB_ID}&teamId=${AWAY_TEAM_ID}`,
    `${FIKS_BASE}/FiksWeb/api/MatchReportApi/GetMatchDetails/${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchReport/GetHomeTroop?matchId=${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchReport/GetAwayTroop?matchId=${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchReport/GetTroops?matchId=${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/MatchReport/GetTeamTroop?matchId=${MATCH_DB_ID}&teamId=${HOME_TEAM_ID}`,
    `${FIKS_BASE}/FiksWeb/api/TeamApi/GetSquad?teamId=${HOME_TEAM_ID}&matchId=${MATCH_DB_ID}`,
    `${FIKS_BASE}/FiksWeb/api/TeamApi/GetSquad/${HOME_TEAM_ID}/${MATCH_DB_ID}`,
  ];

  for (const apiUrl of apiUrls) {
    const resp = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const text = await r.text();
        return { status: r.status, body: text.slice(0, 400) };
      } catch (e) {
        return { status: -1, body: e.message };
      }
    }, apiUrl);

    const isJson = resp.body.trim().startsWith('[') || resp.body.trim().startsWith('{');
    const isHtml = resp.body.trim().startsWith('<');
    console.log(`  ${resp.status} ${apiUrl.replace(FIKS_BASE, '')}`);
    if (resp.status === 200 || isJson) {
      console.log(`    body: "${resp.body.slice(0, 300).replace(/\s+/g,' ')}"`);
    }
  }

  await browser.close();
  console.log('\n[done] Script complete.');
}

run().catch(e => { console.error(e); process.exit(1); });
