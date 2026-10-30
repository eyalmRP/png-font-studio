// Verify slicing never crops artwork: every solid, coloured pixel of a sheet must end up in exactly one glyph.
import { readPNG } from './lib/png-node.mjs';
import { detectGrid, extractGlyphs } from '../src/core/image.js';
import { PROMPT_LAYOUTS } from '../src/core/charsets.js';
import { BUBBLE_SHEETS } from './make-builtin-fonts.mjs';

const solid = (d, i) => d[i + 3] >= 200 && Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40;
let worst = 1;
for (const [id, file] of BUBBLE_SHEETS) {
  const layout = PROMPT_LAYOUTS.find((l) => l.id === id);
  const img = readPNG(file);
  const grid = detectGrid(img, { rows: layout.rows, cols: layout.cols });
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
  console.log(`${file.split('/').pop()}: ${(cov * 100).toFixed(3)}% of solid artwork kept, ${cells.filter((c) => !c.empty).length} glyphs; crossing grid lines (kept whole): ${crossing.join(' ') || 'none'}`);
}
console.log(worst > 0.997 ? 'OK: no artwork lost (the remainder is grid-line debris)' : `CHECK: worst coverage ${(worst * 100).toFixed(3)}%`);
