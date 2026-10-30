// Headless importer test: import two of the bubble sheets through the UI and screenshot each step.
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'debug';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  await page.click('.mode-tabs .tab[aria-label="Fonts"]');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Import sheets")');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('button:has-text("Choose files")')]);
  await chooser.setFiles(['assets/sheets/bubble-2-lowercase.png', 'assets/sheets/bubble-1-capitals.png']);
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/i1-importer.png` });
  await page.click('.imp-file:nth-child(2)');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/i2-importer-sheet2.png` });
  await page.click('.modal-foot button:has-text("Import")');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/i3-imported.png` });
  console.log(errors.join('\n') || 'no page errors');
  await browser.close();
})();
