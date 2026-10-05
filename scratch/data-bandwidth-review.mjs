import { chromium } from '@playwright/test';

// Οπτικός έλεγχος: Historic → Data Bandwidth (BI_Capacity) και τα templates
// "Capacity — SINR vs DL/UL throughput (scatter)" του Queries tab πάνω στη DOD_26H2.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8080/');

  await page.getByRole('tab', { name: 'Historic' }).click();
  await page.getByRole('button', { name: 'Data Bandwidth', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'scratch/historic-bandwidth.png', fullPage: true });
  console.log('historic ok');

  await page.getByRole('tab', { name: 'Queries' }).click();
  await page.locator('select', { has: page.locator('option', { hasText: 'Select database' }) }).first().selectOption('DOD_26H2');
  await page.waitForTimeout(1000);
  for (const dir of ['DL', 'UL']) {
    await page.getByRole('button', { name: /Templates/ }).click();
    await page.getByText(`Capacity — SINR vs ${dir} throughput (scatter)`, { exact: true }).click();
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await page.getByText('SINR_dB').first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `scratch/queries-sinr-${dir.toLowerCase()}.png`, fullPage: true });
    console.log(dir, 'ok');
  }
  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
} finally {
  await browser.close();
}
