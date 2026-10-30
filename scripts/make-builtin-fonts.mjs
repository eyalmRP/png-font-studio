// Slice the bundled bubble sheets into the two built-in fonts using the same core the app uses.
import fs from 'node:fs';
import path from 'node:path';
import { readPNG, encodePNG, decodePNG } from './lib/png-node.mjs';
import { detectGrid, sliceCells, processCell } from '../src/core/image.js';
import { LAYOUTS } from '../src/core/charsets.js';
import { createFont, setGlyph, autoMetrics, fontToJSON, rankLayouts, normalizeSizes } from '../src/core/font.js';
import { zipSync } from '../src/core/zip.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'assets/fonts');
fs.mkdirSync(outDir, { recursive: true });

function sliceSheet(file) {
  const img = readPNG(file);
  const grid = detectGrid(img, { rows: 6, cols: 6 });
  const cells = sliceCells(img, grid, 3).map((c) => ({ ...c, ...processCell(c.image) }));
  return { img, grid, cells };
}

function buildFont(name, variant, sheets, refFont) {
  const font = createFont(name);
  font.family = 'Bubble';
  font.variant = variant;
  for (const file of sheets) {
    const { grid, cells } = sliceSheet(file);
    let layout;
    if (refFont) {
      const ranked = rankLayouts(cells.map((c) => c.image), refFont, LAYOUTS);
      layout = ranked[0].layout;
      console.log(`  ${path.basename(file)} → ${layout.id} (score ${ranked[0].score.toFixed(3)}, next ${ranked[1]?.score.toFixed(3)})`);
    } else {
      layout = LAYOUTS[sheets.indexOf(file)];
      console.log(`  ${path.basename(file)} → ${layout.id} grid x:${grid.sources.x.join(',')}`);
    }
    cells.forEach((c, i) => {
      const ch = layout.chars[i];
      if (!ch || c.empty) return;
      setGlyph(font, ch, c.image);
    });
  }
  const changes = normalizeSizes(font);
  console.log('  evened sizes:', changes.map((c) => `${c.char}×${c.to.toFixed(2)}`).join(' '));
  autoMetrics(font);
  return font;
}

function saveFont(font, file) {
  const json = fontToJSON(font);
  const entries = [{ name: 'font.json', data: JSON.stringify(json, null, 1) }];
  for (const gj of json.glyphs) {
    if (!gj.file) continue;
    entries.push({ name: gj.file, data: new Uint8Array(encodePNG(font.glyphs.get(gj.char).image)) });
  }
  const zip = zipSync(entries);
  fs.writeFileSync(file, zip);
  console.log(`  wrote ${path.relative(root, file)} (${(zip.length / 1024).toFixed(0)} KB, ${json.glyphs.length} glyphs)`);
}

const S = (n) => path.join(root, 'assets/sheets', n);
console.log('Bubble Blue');
const blue = buildFont('Bubble Blue', 'Blue', [S('blue-1.png'), S('blue-2.png'), S('blue-3.png'), S('blue-4.png')]);
saveFont(blue, path.join(outDir, 'bubble-blue.zip'));
console.log('Bubble Orange (layouts recognised by shape matching against Bubble Blue)');
const orange = buildFont('Bubble Orange', 'Orange', [S('orange-1.png'), S('orange-2.png'), S('orange-3.png'), S('orange-4.png')], blue);
saveFont(orange, path.join(outDir, 'bubble-orange.zip'));
console.log('metrics', blue.metrics, orange.metrics);
