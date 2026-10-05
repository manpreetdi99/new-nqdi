import { chromium } from '@playwright/test';

// Έλεγχος slicers στο Historic: σειρά Area → Category → Collection → Scope, κενό Scope by
// default (επιλέγεται τελευταίο) και Clear filters.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8080/');
  await page.getByRole('tab', { name: 'Historic' }).click();
  await page.getByRole('button', { name: 'Data Bandwidth', exact: true }).click();

  const bar = page.locator('div.flex.flex-wrap.items-end').first();
  await bar.waitFor({ timeout: 60000 });
  const names = ['Area', 'Category', 'Collection', 'Scope'];
  const slicer = (label) => bar.locator(':scope > div.relative').nth(names.indexOf(label)).locator('div[role=button]');
  const state = async () => (await bar.innerText()).replace(/\n+/g, ' | ');
  const settle = async () => {
    await page.waitForTimeout(800);
    await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  };

  console.log('initial:', await state(), '· pick-a-scope shown:', await page.getByText('Pick a Scope').isVisible());
  await page.screenshot({ path: 'scratch/historic-filter-initial.png', fullPage: true });

  await slicer('Area').click();
  await page.getByRole('button', { name: 'DOD', exact: true }).click();
  await slicer('Collection').click();
  await page.locator('input[placeholder="Search…"]').fill('RHODES ISLAND');
  await page.locator('div.absolute button').first().click();
  await page.waitForTimeout(500);
  console.log('after area+collection:', await state());

  await slicer('Scope').click();
  console.log('scope options:', (await page.locator('div.absolute button').allInnerTexts()).join(', '));
  await page.locator('div.absolute button', { hasText: '2023H1' }).click();
  await settle();
  console.log('after scope:', await state(), '· charts:', await page.getByText('SINR vs DL throughput').isVisible());
  await page.screenshot({ path: 'scratch/historic-filter-order.png', fullPage: true });

  const clear = bar.getByRole('button', { name: 'Clear filters' });
  await clear.click();
  await page.waitForTimeout(500);
  console.log('after clear:', await state(), '· disabled:', await clear.isDisabled());
  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
} finally {
  await browser.close();
}
