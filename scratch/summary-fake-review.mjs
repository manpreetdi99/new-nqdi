import { chromium } from '@playwright/test';
const DB = process.env.REVIEW_DB || 'CRETE_26H2';
const COLLECTION = process.env.REVIEW_COLLECTION || 'CRE_CHANIA_MAJOR TOWNS_2026H2';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  await page.addInitScript(([db, collection]) => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-collections', JSON.stringify([collection]));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify([collection]));
    localStorage.setItem('perf-insights-active-tab', JSON.stringify('Summary'));
  }, [DB, COLLECTION]);
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /Summary/i }).click();
  await page.waitForTimeout(12000);
  // Το "Fake Event(s)" είναι κρυμμένο στο Compact — το Full δείχνει όλες τις γραμμές.
  await page.getByRole('button', { name: /^Full$/ }).click();
  await page.waitForTimeout(2000);

  const rows = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('td,th')].map((c) => c.innerText.trim());
      if (cells[0] && /Fake Event/i.test(cells[0])) out.push(cells);
    }
    return out;
  });
  console.log('Fake Event(s) rows:', JSON.stringify(rows, null, 1));
  await page.screenshot({ path: 'scratch/summary-fake.png', fullPage: true });
  if (rows.length === 0) throw new Error('Fake Event(s) row not rendered');
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('VERDICT passed');
} finally { await browser.close(); }
