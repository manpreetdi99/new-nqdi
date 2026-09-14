import { chromium } from '@playwright/test';
const DB = process.env.REVIEW_DB || 'CRETE_26H2';
const COLLECTION = process.env.REVIEW_COLLECTION || 'CRE_CHANIA_MAJOR TOWNS_2026H2';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  await page.addInitScript(([db, collection]) => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-collections', JSON.stringify([collection]));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify([collection]));
  }, [DB, COLLECTION]);
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /All Sessions/i }).click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 90_000 });
  await page.getByRole('tab', { name: /^Map$/i }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'scratch/map-tab-single.png' });

  await page.getByRole('button', { name: /Split ανά τοποθεσία/ }).click();
  await page.waitForTimeout(3000);
  const grid = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) => /grid-cols-3/.test(d.className) && d.querySelector('.leaflet-container'));
    if (!el) return null;
    const style = getComputedStyle(el);
    const parent = el.parentElement;
    return {
      columns: style.gridTemplateColumns.split(' ').length,
      miniMaps: el.querySelectorAll('.leaflet-container').length,
      parentClass: parent.className,
      parentScrolls: parent.scrollHeight > parent.clientHeight + 1,
      gridHeight: Math.round(el.getBoundingClientRect().height),
    };
  });
  console.log(JSON.stringify(grid, null, 1));
  await page.screenshot({ path: 'scratch/map-tab-split.png', fullPage: true });
  if (!grid) throw new Error('split grid not found');
  if (grid.columns !== 3) throw new Error('expected 3 columns, got ' + grid.columns);
  if (grid.parentScrolls) throw new Error('split container still scrolls internally');
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('VERDICT passed');
} finally { await browser.close(); }
