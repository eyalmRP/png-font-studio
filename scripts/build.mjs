// Build: bundle the app with esbuild and write
//   dist/artifact/index.html (+ fonts/*.zip)  — the claude.ai artifact (page content only; fonts beside it)
//   dist/png-font-studio.html                 — a standalone single file with the fonts embedded
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

async function build() {
  const res = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true, format: 'iife', minify: true, write: false, target: ['chrome110', 'safari16', 'firefox115'],
    legalComments: 'none', logLevel: 'warning',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8');
  const head = `<title>PNG Font Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap">
<style>${css}</style>`;
  const bodyStart = '<div id="app"></div>';
  fs.mkdirSync(path.join(dist, 'artifact/fonts'), { recursive: true });
  for (const f of ['bubble-blue.zip', 'bubble-orange.zip']) fs.copyFileSync(path.join(root, 'assets/fonts', f), path.join(dist, 'artifact/fonts', f));
  fs.writeFileSync(path.join(dist, 'artifact/index.html'), `${head}\n${bodyStart}\n<script>${js}</script>\n`);
  const embed = {};
  for (const k of ['bubble-blue', 'bubble-orange']) embed[k] = fs.readFileSync(path.join(root, 'assets/fonts', k + '.zip')).toString('base64');
  const standalone = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${head}
</head><body>
${bodyStart}
<script>window.__PFS_FONTS__=${JSON.stringify(embed)};</script>
<script>${js}</script>
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
