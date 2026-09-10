import { chromium } from '@playwright/test';

const DB = process.env.REVIEW_DB || 'CRETE_26H2';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

  const COLLECTION = process.env.REVIEW_COLLECTION || 'CRE_CHANIA_MAJOR TOWNS_2026H2';
  await page.addInitScript(([db, collection]) => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify(db));
    localStorage.setItem('perf-insights-collections', JSON.stringify([collection]));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify([collection]));
  }, [DB, COLLECTION]);

  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /All Sessions/i }).click();
  // Η λίστα κλήσεων φορτώνει από το backend — περιμένουμε την πρώτη γραμμή.
  await page.locator('table tbody tr').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);

  // Οι γραμμές του desktop πίνακα κλήσεων έχουν id "call-row-<SessionId>-<idx>".
  const rows = page.locator('tr[id^="call-row-"]');
  const count = await rows.count();
  console.log('call rows:', count);
  const wanted = process.env.REVIEW_SESSION
    ? page.locator(`tr[id^="call-row-${process.env.REVIEW_SESSION}-"]`).first()
    : rows.nth(3);
  await wanted.scrollIntoViewIfNeeded();
  await wanted.click();
  await page.waitForTimeout(1500);

  // Το detail ανοίγει στο υπο-tab "detail"
  const chart = page.getByRole('heading', { name: /Σήμα κλήσης/ });
  await chart.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Σήμα κλήσης'));
    const card = heading?.closest('div.rounded-lg');
    const sticky = card?.parentElement;
    const svg = card?.querySelector('.recharts-surface');
    const lines = card ? card.querySelectorAll('.recharts-line').length : 0;
    const events = card ? [...card.querySelectorAll('button')].filter((b) => b.style.left).length : 0;
    const overviewSegments = card ? card.querySelectorAll('.select-none [style*="background-color"]').length : 0;
    return {
      title: heading?.textContent.trim(),
      subtitle: heading?.parentElement?.querySelector('p')?.textContent.trim(),
      stickyClass: sticky?.className,
      svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
      lineSeries: lines,
      eventLabels: events,
      overviewSegments,
      oldChartsGone: !document.body.textContent.includes('LTE (RSRP / RSRQ)'),
    };
  });
  console.log(JSON.stringify(state, null, 2));

  await page.screenshot({ path: 'scratch/call-detail-top.png' });

  // Sticky: μετά από scroll το διάγραμμα μένει ορατό κάτω από το header.
  await page.evaluate(() => window.scrollTo(0, 1600));
  await page.waitForTimeout(600);
  const stickyBox = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Σήμα κλήσης'));
    const card = heading.closest('div.rounded-lg').getBoundingClientRect();
    const header = document.querySelector('header').getBoundingClientRect();
    return {
      cardTop: Math.round(card.top),
      headerBottom: Math.round(header.bottom),
      // Ο τίτλος του διαγράμματος δεν πρέπει να κρύβεται πίσω από το header
      titleClear: Math.round(heading.getBoundingClientRect().top) >= Math.round(header.bottom) - 1,
      visible: card.top >= 0 && card.top < 250,
    };
  });
  console.log('sticky after scroll:', JSON.stringify(stickyBox));
  if (!stickyBox.titleClear) throw new Error('Chart header hidden behind the app header: ' + JSON.stringify(stickyBox));
  await page.screenshot({ path: 'scratch/call-detail-scrolled.png' });

  if (!stickyBox.visible) throw new Error('Chart did not stay visible while scrolling');
  if (state.lineSeries < 1) throw new Error('No line series rendered');
  if (!state.oldChartsGone) throw new Error('Old chart heading still on the page');
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  console.log('VERDICT passed');
} finally {
  await browser.close();
}
