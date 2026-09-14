import { chromium } from '@playwright/test';
const SESSION = process.env.REVIEW_SESSION || '81604378634';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  await page.addInitScript(() => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify('CRETE_26H2'));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify('CRETE_26H2'));
    localStorage.setItem('perf-insights-collections', JSON.stringify(['CRE_CHANIA_MAJOR TOWNS_2026H2']));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify(['CRE_CHANIA_MAJOR TOWNS_2026H2']));
    localStorage.setItem('call-detail-srvcc-open', JSON.stringify(true));
  });
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /All Sessions/i }).click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  const row = page.locator(`tr[id^="call-row-${SESSION}-"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.getByRole('heading', { name: /Σήμα κλήσης/ }).waitFor({ timeout: 60_000 });
  await page.getByRole('heading', { name: /SRVCC Transition/ }).waitFor({ timeout: 60_000 });
  // Το panel εμφανίζεται πριν φορτώσουν τα radio δείγματα — περιμένουμε τις καμπύλες.
  await page.waitForFunction(() => {
    const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.includes('SRVCC Transition'));
    return !!h && h.closest('div.rounded-lg').querySelectorAll('.recharts-line').length >= 2;
  }, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const state = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('SRVCC Transition'));
    const card = heading?.closest('div.rounded-lg');
    return {
      srvccPanel: !!heading,
      badge: heading?.innerText.replace(/\s+/g, ' ').trim(),
      lineSeries: card ? card.querySelectorAll('.recharts-line').length : 0,
      hasLegStats: !!card && /LTE σκέλος|σκέλος/.test(card.innerText),
      lteGsmToggle: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'GSM'),
    };
  });
  console.log(JSON.stringify(state, null, 1));
  await page.screenshot({ path: 'scratch/srvcc-regression.png' });
  if (!state.srvccPanel) throw new Error('SRVCC panel missing');
  if (state.lineSeries < 2) throw new Error('SRVCC chart lost a leg: ' + state.lineSeries);
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('VERDICT passed');
} finally { await browser.close(); }
