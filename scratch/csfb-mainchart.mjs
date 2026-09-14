import { chromium } from '@playwright/test';
const SESSION = process.env.REVIEW_SESSION || '120259084300';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    localStorage.setItem('perf-insights-selected-db', JSON.stringify('CRETE_26H2'));
    localStorage.setItem('perf-insights-summary-db', JSON.stringify('CRETE_26H2'));
    localStorage.setItem('perf-insights-collections', JSON.stringify(['CRE_CHANIA_MAJOR TOWNS_2026H2']));
    localStorage.setItem('perf-insights-summary-collections', JSON.stringify(['CRE_CHANIA_MAJOR TOWNS_2026H2']));
    localStorage.setItem('call-detail-csfb-open', JSON.stringify(false));
  });
  await page.goto('http://127.0.0.1:5175/');
  await page.getByRole('tab', { name: /All Sessions/i }).click();
  await page.locator('table tbody tr').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  const row = page.locator(`tr[id^="call-row-${SESSION}-"]`).first();
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.getByRole('heading', { name: /Σήμα κλήσης/ }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.textContent.includes('Σήμα κλήσης'));
    const card = heading.closest('div.rounded-lg');
    const labels = [...card.querySelectorAll('label')].map((l) => l.innerText.trim());
    const overview = [...document.querySelectorAll('h3')].map(h=>h.textContent.trim());
    return {
      title: heading.textContent.trim(),
      seriesCheckboxes: labels,
      lineSeries: card.querySelectorAll('.recharts-line').length,
      allEventLabels: [...card.querySelectorAll('button')].filter(b => b.style.left).map(b=>b.textContent.trim()),
      overviewLabels: [...card.querySelectorAll('.select-none [title]')].map(d=>d.getAttribute('title')).filter(t=>/CSFB|GSM/.test(t)).slice(0,4),
      panels: overview.filter(t=>/CSFB|SRVCC/.test(t)),
    };
  });
  console.log(JSON.stringify(state, null, 1));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scratch/csfb-mainchart.png' });
} finally { await browser.close(); }
