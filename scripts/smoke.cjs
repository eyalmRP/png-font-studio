// Headless smoke test: load the app, click through the main views, report console errors, save screenshots.
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'debug';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join('\n')));
  // the first-run guide would sit over the controls this test clicks
  await page.addInitScript(() => localStorage.setItem('pfs:tourDone', 'true'));
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/s1-titles.png` });
  // select the first layer from the layer list
  await page.click('.layer-item:nth-child(2)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s2-selected.png` });
  for (const tab of ['Effects', 'Warp', 'Animate', 'Paragraph', 'Layer']) {
    await page.click(`.icon-tabs .tab[aria-label="${tab}"]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/s3-${tab}.png` });
  }
  await page.click('.icon-tabs .tab[aria-label="Character"]');
  // double click the selected title on the canvas to edit
  const box = await page.locator('canvas.view').boundingBox();
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.47);
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.keyboard.type(' Hi');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s4-editing.png` });
  // select a word and recolour it
  await page.keyboard.down('Shift');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.up('Shift');
  await page.click('.pill:has-text("Shift hue")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/s4b-recolour.png` });
  await page.keyboard.press('Escape');
  // Hebrew UI + typing Hebrew text
  await page.click('.topbar .pill:has-text("עב")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/s7-hebrew.png` });
  await page.click('.topbar .pill:has-text("EN")');
  await page.waitForTimeout(500);
  // light theme
  await page.click('.topbar .icon-btn[aria-label="Light / dark"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s8-light.png` });
  await page.click('.topbar .icon-btn[aria-label="Light / dark"]');
  await page.click('.mode-tabs .tab[aria-label="Fonts"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/s5-fonts.png` });
  await page.click('.cell:nth-child(18)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/s6-glyph.png` });
  console.log(errors.join('\n') || 'no console errors');
  await browser.close();
})();
