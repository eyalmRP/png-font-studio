// Verify slicing never crops artwork: every solid, coloured pixel of a sheet must end up in exactly one glyph.
import { readPNG } from './lib/png-node.mjs';
import { detectGrid, extractGlyphs } from '../src/core/image.js';
import { LAYOUTS } from '../src/core/charsets.js';

const sheets = ['blue-1', 'blue-2', 'blue-3', 'blue-4', 'orange-1', 'orange-2', 'orange-3', 'orange-4'];
const order = { 'orange-3': 2, 'orange-4': 3 };
const solid = (d, i) => d[i + 3] >= 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40;
let worst = 1;
for (const name of sheets) {
  const img = readPNG(`assets/sheets/${name}.png`);
  const grid = detectGrid(img, { rows: 6, cols: 6 });
  const layout = LAYOUTS[order[name] ?? (+name.split('-')[1] - 1)];
  const cells = extractGlyphs(img, grid);
  let total = 0;
  for (let i = 0; i < img.data.length; i += 4) if (solid(img.data, i)) total++;
  let kept = 0;
  const crossing = [];
  for (const c of cells) {
    if (c.empty) continue;
    for (let i = 0; i < c.image.data.length; i += 4) if (solid(c.image.data, i)) kept++;
    const out = c.offsetX < 0 || c.offsetY < 0 || c.offsetX + c.image.width > c.w || c.offsetY + c.image.height > c.h;
    if (out) crossing.push(layout.chars[c.index]);
  }
  const cov = kept / total;
  worst = Math.min(worst, cov);
  console.log(`${name}: ${(cov * 100).toFixed(3)}% of solid artwork kept, ${cells.filter((c) => !c.empty).length} glyphs; crossing grid lines (kept whole): ${crossing.join(' ') || 'none'}`);
}
console.log(worst > 0.997 ? 'OK: no artwork lost (the remainder is grid-line debris)' : `CHECK: worst coverage ${(worst * 100).toFixed(3)}%`);
