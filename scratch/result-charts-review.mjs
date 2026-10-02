import { chromium } from '@playwright/test';

// Οπτικός έλεγχος του ResultCharts με δεδομένα σε σχήμα alev queries.
// Τρέχει πάνω σε `npx vite --port 5175` (βλ. scratch/result-charts-review.html).
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5175/scratch/result-charts-review.html');
  await page.locator('.recharts-surface').first().waitFor();
  await page.waitForTimeout(2000);

  const shot = async (id, name) => {
    await page.locator(`#${id}`).screenshot({ path: `scratch/result-charts-${name}.png` });
  };
  const chips = async (id) => page.locator(`#${id} button.rounded-full`).allInnerTexts();

  for (const id of ['voice', 'browsing', 'radio', 'legacy', 'gsm', 'mos']) {
    console.log(id, 'suggestions:', JSON.stringify(await chips(id)));
    console.log(id, 'explain:', await page.locator(`#${id} p:has(svg.lucide-info)`).innerText().catch(() => '—'));
    await shot(id, `${id}-default`);
  }

  const pickSuggestion = async (id, suggestion, name, settle = 1800) => {
    await page.locator(`#${id} [data-suggestion="${suggestion}"]`).click();
    await page.waitForTimeout(settle);
    await shot(id, name);
  };

  // Voice: DCR/AFR + ρυθμίσεις ανοιχτές
  await page.locator('#voice [data-suggestion="voice-dcr-afr"]').click();
  await page.locator('#voice button', { hasText: 'Ρυθμίσεις' }).click();
  await page.waitForTimeout(1800);
  await shot('voice', 'voice-dcr-settings');
  await page.locator('#voice button', { hasText: 'Ρυθμίσεις' }).click();
  await pickSuggestion('voice', 'status-mix', 'voice-status-mix');
  await pickSuggestion('voice', 'dist-CallSetupTimeVoLTE ', 'voice-setup-cdf');

  await pickSuggestion('radio', 'dist-MOS', 'radio-cdf');
  await pickSuggestion('radio', 'time-FullDate', 'radio-time', 2500);
  await page.locator('#radio button', { hasText: 'πίνακα τιμών' }).click();
  await page.waitForTimeout(300);
  await shot('radio', 'radio-time-table');

  await pickSuggestion('browsing', 'alev-status', 'browsing-status');
  await pickSuggestion('legacy', 'weighted-bad_call_pct', 'legacy-bad-pct');

  // Mobile width
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(600);
  await shot('voice', 'voice-mobile');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log('mobile horizontal overflow px:', overflow);

  console.log('errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
}
