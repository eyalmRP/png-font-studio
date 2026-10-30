// Headless export test: run each exporter and report sizes / errors.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8765/index.html');
  await page.waitForTimeout(2500);
  const res = await page.evaluate(async () => {
    const out = {};
    const { exportAs, state } = window.__pfs;
    state.project.duration = 1; // keep it quick
    for (const format of ['png', 'pngseq', 'webm', 'mp4', 'gif', 'apng', 'webp', 'mov']) {
      const t0 = performance.now();
      try {
        const r = await exportAs({ format, scale: 0.5, trim: format !== 'png', background: false, onlySelected: false, loop: true });
        const head = new Uint8Array(await r.blob.slice(0, 16).arrayBuffer());
        if (format === 'webm') {
          // decode a frame back and check the alpha survives (transparent corner, opaque middle)
          const url = URL.createObjectURL(r.blob);
          const v = document.createElement('video'); v.src = url; v.muted = true;
          await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('webm did not load')); });
          v.currentTime = 0.6; await new Promise((res) => { v.onseeked = res; });
          const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
          const x = c.getContext('2d'); x.drawImage(v, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
          let transparent = 0, opaque = 0;
          for (let i = 3; i < d.length; i += 4) { if (d[i] < 10) transparent++; else if (d[i] > 245) opaque++; }
          out.webmAlpha = `decoded ${c.width}x${c.height}: ${(transparent / (d.length / 4) * 100).toFixed(1)}% transparent, ${(opaque / (d.length / 4) * 100).toFixed(1)}% opaque`;
        }
        out[format] = `${r.name} ${(r.blob.size / 1024).toFixed(0)} KB in ${Math.round(performance.now() - t0)} ms, head ${[...head.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
      } catch (e) { out[format] = 'ERROR ' + e.message; }
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log(errors.join('\n') || 'no page errors');
  await browser.close();
})();
