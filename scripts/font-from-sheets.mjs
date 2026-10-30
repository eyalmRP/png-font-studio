// Build a font from prompt sheets the same way the importer does (reference-H scaling, even sizes, auto placement).
// Usage: node scripts/font-from-sheets.mjs "<Font name>" <out.zip> <layout-id>=<sheet.png> ...
import fs from 'node:fs';
import { readPNG, encodePNG } from './lib/png-node.mjs';
import { detectGrid, extractGlyphs, detectBackground, removeBackgroundColor } from '../src/core/image.js';
import { PROMPT_LAYOUTS, LAYOUTS } from '../src/core/charsets.js';
import { createFont, setGlyph, autoMetrics, normalizeSizes, sheetGlyphs, fontToJSON } from '../src/core/font.js';
import { zipSync } from '../src/core/zip.js';

export function buildFromSheets(name, specs) {
  const sheets = specs.map(([id, file]) => {
    const layout = [...PROMPT_LAYOUTS, ...LAYOUTS].find((l) => l.id === id);
    if (!layout) throw new Error('unknown layout ' + id);
    let img = readPNG(file);
    const bg = detectBackground(img);
    if (bg) img = removeBackgroundColor(img, bg);
    const grid = detectGrid(img, { rows: layout.rows, cols: layout.cols });
    const cells = extractGlyphs(img, grid);
    const chars = layout.chars.map((ch, i) => (cells[i].empty ? null : ch));
    return { chars, cells, ref: layout.ref !== undefined && chars[layout.ref] === 'H' ? layout.ref : -1 };
  });
  const font = createFont(name);
  font.family = name;
  for (const g of sheetGlyphs(sheets)) setGlyph(font, g.char, g.image, { scale: g.scale, baseScale: g.scale });
  normalizeSizes(font);
  autoMetrics(font);
  return font;
}

export function fontZip(font) {
  const json = fontToJSON(font);
  const entries = [{ name: 'font.json', data: JSON.stringify(json, null, 1) }];
  for (const gj of json.glyphs) if (gj.file) entries.push({ name: gj.file, data: new Uint8Array(encodePNG(font.glyphs.get(gj.char).image)) });
  return zipSync(entries);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [name, out, ...args] = process.argv.slice(2);
  const font = buildFromSheets(name, args.map((a) => a.split('=')));
  fs.writeFileSync(out, fontZip(font));
  console.log(`wrote ${out}: ${font.glyphs.size} glyphs`, font.metrics);
}
