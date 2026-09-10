import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message); });
  await page.goto('http://127.0.0.1:5175/scratch/signal-chart-review.html');
  await page.locator('.recharts-surface').first().waitFor();
  await page.waitForTimeout(400);

  // 1. Το Session Overview πρέπει να πέφτει ακριβώς πάνω από το plot area του chart.
  const align = await page.evaluate(() => {
    const axisLine = document.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
    const track = document.querySelector('[data-testid="sticky-wrapper"] .select-none > div');
    const a = axisLine.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    return { axisLeft: a.left, axisRight: a.right, trackLeft: t.left, trackRight: t.right };
  });
  results.overviewAlignment = {
    leftDelta: +(align.trackLeft - align.axisLeft).toFixed(1),
    rightDelta: +(align.trackRight - align.axisRight).toFixed(1),
  };
  if (Math.abs(results.overviewAlignment.leftDelta) > 3 || Math.abs(results.overviewAlignment.rightDelta) > 3) {
    throw new Error('Session Overview not aligned with plot area: ' + JSON.stringify(results.overviewAlignment));
  }

  // 2. Ένα event στο 0% και ένα στο 100% πρέπει να πέφτουν στα άκρα του ίδιου plot area.
  // Μετράμε την ΚΑΘΕΤΗ ΓΡΑΜΜΗ του event (χωρίς transform), όχι την ταμπέλα: οι ακραίες
  // ταμπέλες μετατοπίζονται με translateX ώστε να μη βγαίνουν έξω από το πλαίσιο.
  const eventEdges = await page.evaluate(() => {
    // Μόνο μέσα στο overlay των events — αλλιώς πιάνουμε και τα ticks/όρια του overview.
    const overlay = [...document.querySelectorAll('div.absolute.pointer-events-none')].find((d) => d.querySelector('button'));
    const ticks = [...overlay.querySelectorAll('span.absolute.w-px')].filter((s) => s.style.left);
    const axis = document.querySelector('.recharts-xAxis .recharts-cartesian-axis-line').getBoundingClientRect();
    const span = axis.right - axis.left;
    const pct = (el) => ((el.getBoundingClientRect().left - axis.left) / span) * 100;
    return { firstPct: pct(ticks[0]), lastPct: pct(ticks[ticks.length - 1]), count: ticks.length };
  });
  // SIP INVITE στα +12s από 179s → ~6.7%, EPS bearer release στα +170s → ~95%
  results.eventPositions = { first: +eventEdges.firstPct.toFixed(1), last: +eventEdges.lastPct.toFixed(1), count: eventEdges.count };
  if (eventEdges.count !== 6 || Math.abs(eventEdges.firstPct - 6.7) > 1 || Math.abs(eventEdges.lastPct - 94.97) > 1) {
    throw new Error('Event labels not placed by time: ' + JSON.stringify(results.eventPositions));
  }

  // 3. Hover σε γραμμή πίνακα → κάθετη γραμμή στο διάγραμμα στη σωστή θέση.
  const beforeHover = await page.locator('.recharts-reference-line line').count();
  const row = page.locator('tr[data-row-time]').nth(30); // +90s
  await row.hover();
  await page.waitForTimeout(150);
  const cursor = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.recharts-reference-line line')];
    const cyan = lines.find((l) => (l.getAttribute('stroke') || '').includes('180'));
    if (!cyan) return null;
    const axis = document.querySelector('.recharts-xAxis .recharts-cartesian-axis-line').getBoundingClientRect();
    const r = cyan.getBoundingClientRect();
    return ((r.left + r.width / 2 - axis.left) / (axis.right - axis.left)) * 100;
  });
  if (cursor == null) throw new Error('Row hover did not draw the shared cursor (had ' + beforeHover + ' reference lines)');
  results.cursorPercentForRowAt90s = +cursor.toFixed(1);
  if (Math.abs(cursor - (90 / 179) * 100) > 2) throw new Error('Cursor at wrong time: ' + results.cursorPercentForRowAt90s);

  // 4. Hover πάνω στο διάγραμμα → φωτίζεται η αντίστοιχη γραμμή του πίνακα.
  await page.mouse.move(align.axisLeft + (align.axisRight - align.axisLeft) * 0.25, 300);
  await page.waitForTimeout(200);
  const litRows = await page.locator('tr.bg-cyan-500\\/10').count();
  results.rowsLitByChartHover = litRows;
  if (litRows < 1) throw new Error('Chart hover did not light any table row');

  // 5. Sticky: μετά από scroll το διάγραμμα μένει στην κορυφή.
  const topBefore = await page.locator('[data-testid="sticky-wrapper"]').boundingBox();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(250);
  const topAfter = await page.locator('[data-testid="sticky-wrapper"]').boundingBox();
  results.stickyTop = { before: Math.round(topBefore.y), after: Math.round(topAfter.y) };
  if (Math.abs(topAfter.y - 57) > 2) throw new Error('Chart did not stick to the top: ' + JSON.stringify(results.stickyTop));

  await page.screenshot({ path: 'scratch/signal-chart-desktop.png' });

  // 6. Ξεκαρφίτσωμα → το διάγραμμα ξανακυλάει μαζί με τη σελίδα.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: /Καρφιτσωμένο/ }).click();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(250);
  const unpinned = await page.locator('[data-testid="sticky-wrapper"]').boundingBox();
  results.unpinnedTopAfterScroll = unpinned ? Math.round(unpinned.y) : null;
  if (unpinned && unpinned.y > 0) throw new Error('Unpinned chart still stuck: ' + results.unpinnedTopAfterScroll);

  // 7. Stenh othonh - se KATHARO fortoma sta 390px (to resize mias anoixths desktop selidas
  //    afhnei to recharts me palia geometry gia ligo; den einai to senario tou xrhsth).
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', (e) => errors.push('mobile: ' + e.message));
  await phone.goto('http://127.0.0.1:5175/scratch/signal-chart-review.html');
  await phone.locator('.recharts-surface').first().waitFor();
  await phone.waitForTimeout(600);
  await phone.screenshot({ path: 'scratch/signal-chart-mobile.png' });
  const overflow = await phone.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    vw: document.documentElement.clientWidth,
  }));
  results.mobile = overflow;
  if (overflow.scrollWidth > overflow.vw + 1) {
    throw new Error('Mobile page overflows horizontally: ' + JSON.stringify(overflow));
  }

  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ...results, errors, verdict: 'passed' }, null, 2));
} finally {
  await browser.close();
}
