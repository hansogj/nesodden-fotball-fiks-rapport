// Dump raw HTML for all player rows after clicking Hjemmelag
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: '.auth/fiks.json' });
  const page = await context.newPage();

  await page.goto('https://fiks.fotball.no/FiksWeb/MatchReport/View/9011369');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const homeBtn = page.getByRole('button', { name: /hjemmelag/i }).first();
  await homeBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForSelector('.player-row-read-only', { timeout: 6000 }).catch(() => {});

  const html = await page.evaluate(() => {
    // Dump ALL .player-category and .player-row-read-only elements
    return Array.from(document.querySelectorAll('.player-category, .player-row-read-only'))
      .map(el => ({
        tag: el.tagName,
        classes: el.className,
        html: el.outerHTML.slice(0, 600),
      }));
  });

  html.forEach((el, i) => {
    console.log(`\n--- Element ${i} [${el.tag}] class="${el.classes}" ---`);
    console.log(el.html);
  });

  await browser.close();
})();
