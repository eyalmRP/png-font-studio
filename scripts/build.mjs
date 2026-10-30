// Build: bundle the app with esbuild and write
//   dist/artifact/index.html (+ fonts/*.json, *.webp, psd.*.js) — the claude.ai artifact (page content only; fonts
//                                                and the on-demand Photoshop script beside it)
//   dist/png-font-studio.html                 — a standalone single file with the fonts embedded
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import crypto from 'node:crypto';
import { ensureAtlas } from './font-atlas.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

async function build() {
  fs.rmSync(path.join(dist, 'artifact/fonts'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dist, 'artifact/fonts'), { recursive: true });
  // each built-in font ships as a lossless WebP atlas of its glyphs plus a JSON with the font and the glyph rects
  // (the page host serves images and JSON, not zips)
  const fontBytes = {}, embed = {};
  for (const k of ['bubble-blue']) {
    const a = ensureAtlas(k);
    const { font, atlas } = JSON.parse(fs.readFileSync(a.json, 'utf8'));
    const webp = fs.readFileSync(a.webp);
    // the file names carry a content hash, so a browser never mixes in a cached older copy; the size drives the
    // download progress
    const v = crypto.createHash('sha256').update(webp).update(fs.readFileSync(a.json)).digest('hex').slice(0, 10);
    fs.writeFileSync(path.join(dist, 'artifact/fonts', `${k}.${v}.json`), JSON.stringify({ font, atlas }));
    fs.writeFileSync(path.join(dist, 'artifact/fonts', `${k}.${v}.webp`), webp);
    fontBytes[k] = { bytes: webp.length, v };
    embed[k] = { meta: { font, atlas }, webp: webp.toString('base64') };
  }
  // the Photoshop reader/writer (ag-psd) is its own script, loaded only when a font goes to or from Photoshop
  const psdRes = await esbuild.build({
    entryPoints: [path.join(root, 'src/psd/entry.js')],
    bundle: true, format: 'iife', minify: true, write: false, target: ['chrome110', 'safari16', 'firefox115'],
    legalComments: 'none', logLevel: 'warning',
  });
  const psdJs = psdRes.outputFiles[0].text;
  for (const f of fs.readdirSync(path.join(dist, 'artifact')).filter((n) => /^psd\..*\.js$/.test(n))) fs.rmSync(path.join(dist, 'artifact', f));
  const psdFile = `psd.${crypto.createHash('sha256').update(psdJs).digest('hex').slice(0, 10)}.js`;
  fs.writeFileSync(path.join(dist, 'artifact', psdFile), psdJs);
  const res = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true, format: 'iife', minify: true, write: false, target: ['chrome110', 'safari16', 'firefox115'],
    legalComments: 'none', logLevel: 'warning', define: { __PFS_FONT_FILES__: JSON.stringify(fontBytes), __PFS_PSD_FILE__: JSON.stringify(psdFile) },
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8');
  const head = `<title>PNG Font Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>${css}</style>`;
  const bodyStart = '<div id="app"></div>';
  fs.writeFileSync(path.join(dist, 'artifact/index.html'), `${head}\n${bodyStart}\n<script>${js}</script>\n`);
  const standalone = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${head}
</head><body>
${bodyStart}
<script>window.__PFS_FONTS__=${JSON.stringify(embed)};</script>
<script>${js}</script>
<script>${psdJs.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>
`;
  fs.writeFileSync(path.join(dist, 'png-font-studio.html'), standalone);
  const kb = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
  console.log(`built: artifact ${kb(path.join(dist, 'artifact/index.html'))}, standalone ${kb(path.join(dist, 'png-font-studio.html'))}`);
}

await build();
if (watch) {
  fs.watch(path.join(root, 'src'), { recursive: true }, async () => { try { await build(); } catch (e) { console.error(e.message); } });
}
