import { chromium } from '@playwright/test';

// Οπτικός έλεγχος των σελίδων Historic 06–36 (Data / Coverage & 5G / Comparison) πάνω στο dev
// server (npm run dev, :8080) + backend (:8000). Scope από argv (default 2025H2).
const scope = process.argv[2] || '2025H2';
const only = process.argv[3];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8080/');
  await page.getByRole('tab', { name: 'Historic' }).click();

  const waitLoaded = async () => {
    await page.waitForTimeout(600);
    await page.waitForFunction(() => !document.body.innerText.includes('Loading'), null, { timeout: 180000 });
    await page.waitForTimeout(2000);
  };

  // Scope μία φορά (μοιράζεται σε όλες τις σελίδες).
  await page.getByRole('button', { name: 'Browsing', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByText('Select scope', { exact: true }).last().click();
  await page.getByRole('button', { name: scope, exact: true }).click();

  const pages = [
    ['Browsing', 'browsing'],
    ['DNS', 'dns'],
    ['HTTP', 'http'],
    ['Ping & Ookla', 'ping'],
    ['Interactivity', 'interactivity'],
    ['Capacity', 'capacity'],
    ['Video', 'video'],
    ['Data Map', 'datamap'],
    ['Data Bandwidth', 'bandwidth'],
    ['NR Data Map', 'nrmap'],
    ['NR Data Tech', 'nrtech'],
    ['NR Scanner Map', 'scannermap'],
    ['Scanner 4G/5G', 'scanner'],
    ['Voice trend', 'cmp-voice'],
    ['Data trend', 'cmp-data'],
    ['Grades trend', 'cmp-grades'],
  ].filter(([, n]) => !only || only.split(',').includes(n));
  for (const [label, name] of pages) {
    const t = Date.now();
    await page.getByRole('button', { name: label, exact: true }).click();
    await waitLoaded();
    await page.screenshot({ path: `scratch/historic-${name}.png`, fullPage: true });
    console.log(name, 'ok', `${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
  console.log('errors:', JSON.stringify(errors.slice(0, 15)));
} finally {
  await browser.close();
}
