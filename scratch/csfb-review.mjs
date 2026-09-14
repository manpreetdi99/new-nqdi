import { chromium } from '@playwright/test';

const DB = process.env.REVIEW_DB || 'CRETE_26H2';
const COLLECTION = process.env.REVIEW_COLLECTION || 'CRE_CHANIA_MAJOR TOWNS_2026H2';
const SESSION = process.env.REVIEW_SESSION || '120259084300';
const OUT = process.env.OUT || 'scratch/csfb-detail.png';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

  await page.addInitScript(([db, collection]) => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-collections', JSON.stringify([collection]));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify([collection]));
    // Το CSFB panel είναι collapsed by default — το ανοίγουμε για το screenshot
    localStorage.setItem('call-detail-csfb-open', JSON.stringify(true));
  }, [DB, COLLECTION]);

  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /All Sessions/i }).click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);

  const row = page.locator(`tr[id^="call-row-${SESSION}-"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.getByRole('heading', { name: /Σήμα κλήσης/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);

  const panel = page.getByRole('heading', { name: /CSFB Transition/ });
  const found = await panel.count();
  console.log('csfb panel present:', found > 0);
  if (found === 0) throw new Error('CSFB panel not rendered for session ' + SESSION);

  const state = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('CSFB Transition'));
    const card = heading?.closest('div.rounded-lg');
    const text = card?.innerText ?? '';
    const tiles = [...card.querySelectorAll('div')].filter((d) => /uppercase/.test(d.className) && d.nextElementSibling);
    return {
      badge: heading?.innerText.replace(/\s+/g, ' ').trim(),
      lines: text.split('\n').filter(Boolean).slice(0, 40),
      lineSeries: card.querySelectorAll('.recharts-line').length,
      stepRows: card.querySelectorAll('tbody tr').length,
    };
  });
  console.log(JSON.stringify(state, null, 1));

  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT });
  if (state.lineSeries < 2) throw new Error('CSFB chart missing a leg: ' + state.lineSeries);
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('VERDICT passed');
} finally {
  await browser.close();
}
