// Run the importer's extraction on prompt sheets and write a contact image per sheet plus numbers to compare
// takes of the same sheet. Usage: node scripts/sheet-report.mjs <out-dir> <layout-id>=<sheet.png> ...
import { readPNG, writePNG } from './lib/png-node.mjs';
import { createImage, detectGrid, extractGlyphs, detectBackground, removeBackgroundColor, alphaBBox } from '../src/core/image.js';
import { PROMPT_LAYOUTS } from '../src/core/charsets.js';

const out = process.argv[2];
for (const arg of process.argv.slice(3)) {
  const [id, file] = arg.split('=');
  const layout = PROMPT_LAYOUTS.find((l) => l.id === id);
  let img = readPNG(file);
  const bg = detectBackground(img);
  if (bg) img = removeBackgroundColor(img, bg);
  const grid = detectGrid(img, { rows: layout.rows, cols: layout.cols });
  const cells = extractGlyphs(img, grid, {});
  const chars = layout.chars;
  // per cell: solid pixels, faint pixels kept (halo), parts, bbox size
  const rows = [];
  let faintTotal = 0, solidTotal = 0;
  for (const c of cells) {
    let solid = 0, faint = 0;
    if (c.image) for (let i = 3; i < c.image.data.length; i += 4) { const a = c.image.data[i]; if (a >= 160) solid++; else if (a >= 24) faint++; }
    faintTotal += faint; solidTotal += solid;
    rows.push({ ch: chars[c.index], w: c.image?.width || 0, h: c.image?.height || 0, parts: c.parts || 1, faint: solid ? faint / solid : 0, empty: c.empty });
  }
  // contact image
  const CW = 220, CH = 240, C = layout.cols, R = layout.rows;
  const sheet = createImage(C * CW, R * CH);
  for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) {
    const i = (y * sheet.width + x) * 4, k = ((x >> 3) + (y >> 3)) & 1 ? 70 : 58;
    sheet.data[i] = k; sheet.data[i + 1] = k; sheet.data[i + 2] = k + 6; sheet.data[i + 3] = 255;
  }
  for (const c of cells) {
    if (!c.image) continue;
    const s = Math.min(1, (CW - 16) / c.image.width, (CH - 16) / c.image.height);
    const ox = (c.index % C) * CW + (CW - c.image.width * s) / 2, oy = Math.floor(c.index / C) * CH + (CH - c.image.height * s) / 2;
    for (let y = 0; y < c.image.height * s; y++) for (let x = 0; x < c.image.width * s; x++) {
      const sx = Math.min(c.image.width - 1, Math.floor(x / s)), sy = Math.min(c.image.height - 1, Math.floor(y / s));
      const si = (sy * c.image.width + sx) * 4, a = c.image.data[si + 3] / 255;
      const di = ((Math.round(oy + y)) * sheet.width + Math.round(ox + x)) * 4;
      for (let k = 0; k < 3; k++) sheet.data[di + k] = c.image.data[si + k] * a + sheet.data[di + k] * (1 - a);
    }
  }
  const name = file.split('/').pop().replace('.png', '');
  writePNG(`${out}/${name}-cells.png`, sheet);
  const hs = rows.filter((r) => /[A-Z]/.test(r.ch)).map((r) => r.h);
  console.log(`\n${name} (${id}) bg=${bg ? bg.join(',') : 'none'} grid x=${grid.xs.join(',')} y=${grid.ys.join(',')}`);
  console.log(`  halo kept / solid: ${(faintTotal / solidTotal).toFixed(3)}   empty: ${rows.filter((r) => r.empty).map((r) => r.ch).join(' ') || '-'}   multi-part: ${rows.filter((r) => r.parts > 1).map((r) => r.ch + '×' + r.parts).join(' ') || '-'}`);
  console.log('  ' + rows.map((r) => `${r.ch}:${r.w}x${r.h}${r.faint > 0.15 ? '!' : ''}`).join(' '));
}
