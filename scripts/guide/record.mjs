// Record the guide videos into guide/media/: node scripts/guide/record.mjs [scene ...] (default: all)
// Needs a fresh build (npm run build), Playwright with Chromium, ffmpeg, and the narration voice (see tts.py):
//   PFS_GUIDE_PYTHON=<python with kokoro-onnx> KOKORO_MODEL=<.onnx> KOKORO_VOICES=<.bin> node scripts/guide/record.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { Recorder, Voice, VIEW } from './recorder.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '../..');
const site = path.join(root, 'dist/site');
const SCENES = ['ui', 'fonts', 'still', 'animated', 'export'];

// the built site, served under /png-font-studio/ as GitHub Pages serves it
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.mp4': 'video/mp4' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/png-font-studio/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(site, p);
  if (!file.startsWith(site) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/png-font-studio/`;

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : SCENES;
const voice = new Voice({ python: process.env.PFS_GUIDE_PYTHON || 'python3', cacheDir: path.join(root, 'dist/guide-work/voice') });
const browser = await chromium.launch();
try {
  for (const name of wanted) {
    const scene = (await import(path.join(here, 'scenes', `${name}.mjs`))).default;
    const context = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`[${name}] page error:`, e.message));
    await page.clock.install();
    // a first visit without the welcome guide, in English, dark, animated
    await page.addInitScript((prefs) => { for (const [k, v] of Object.entries(prefs)) localStorage.setItem('pfs:' + k, JSON.stringify(v)); }, { tourDone: true, ...(scene.prefs || {}) });
    await page.goto(url);
    await page.waitForSelector('.layer-item', { state: 'attached', timeout: 60000 });
    await page.waitForTimeout(1500); // fonts, first paint
    await page.addScriptTag({ path: path.join(here, 'director.js') });
    const cdp = await context.newCDPSession(page);
    // CSS transitions run on real time, which passes ~4x faster than video time while frames are captured
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
    await page.mouse.move(VIEW.w * 0.62, VIEW.h * 0.55);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
    const rec = new Recorder(page, cdp, voice, { name, title: scene.title, outDir: path.join(root, 'guide/media'), workDir: path.join(root, 'dist/guide-work') });
    rec.mouse = { x: VIEW.w * 0.62, y: VIEW.h * 0.55 };
    const t0 = Date.now();
    await scene(rec, page);
    const out = await rec.finish({ poster: scene.poster });
    console.log(`${name}: ${out.dur.toFixed(1)} s video, ${(out.size / 1e6).toFixed(1)} MB, recorded in ${Math.round((Date.now() - t0) / 1000)} s`);
    await context.close();
  }
} finally {
  voice.close();
  await browser.close();
  server.close();
}
