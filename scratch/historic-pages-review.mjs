import { chromium } from '@playwright/test';

// Οπτικός έλεγχος των σελίδων Historic (Greece Map / Grades / Voice M→F / M→M / Radio & Codecs)
// πάνω στο dev server (npm run dev, :8080) + backend (:8000).
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8080/');
  await page.getByRole('tab', { name: 'Historic' }).click();

  const pages = [
    ['Greece Map', 'map'],
    ['Grades', 'grades'],
    ['Voice M→F', 'mtof'],
    ['Voice M→M', 'mtom'],
    ['Radio Tech & Codecs', 'radio'],
  ];
  for (const [label, name] of pages) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(500);
    await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `scratch/historic-${name}.png`, fullPage: true });
    console.log(name, 'ok');
  }

  // Grades: αλλαγή slider (Voice share) με πληκτρολόγιο και έλεγχος ότι αλλάζει το Total.
  await page.getByRole('button', { name: 'Grades', exact: true }).click();
  await page.waitForTimeout(1500);
  const before = await page.locator('.text-4xl').first().innerText();
  const slider = page.getByRole('slider').first();
  await slider.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const after = await page.locator('.text-4xl').first().innerText();
  console.log('grades total before/after voice+20:', before, after);

  // Παλαιότερο scope με CSFB κλήσεις (ThreeGMO) στη σελίδα M→F.
  await page.getByRole('button', { name: 'Voice M→F', exact: true }).click();
  await page.getByText('2026H2', { exact: true }).first().click();
  await page.getByRole('button', { name: '2021H1', exact: true }).click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'scratch/historic-mtof-2021H1.png', fullPage: true });

  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
} finally {
  await browser.close();
}
