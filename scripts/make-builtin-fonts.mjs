// Build the built-in Bubble Blue font from the prompt sheets with the same core the app's importer uses.
// Bubble Orange and Bubble Pearl are made from it in the app (src/main.js), so only one font file ships.
import fs from 'node:fs';
import path from 'node:path';
import { buildFromSheets, fontZip } from './font-from-sheets.mjs';
import { shortenL, lFromH } from './glyph-fixups.mjs';
import { normalizeSizes, autoMetrics } from '../src/core/font.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const S = (n) => path.join(root, 'assets/sheets', n);
export const BUBBLE_SHEETS = [
  ['prompt-1', S('bubble-1-capitals.png')],
  ['prompt-2', S('bubble-2-lowercase.png')],
  ['prompt-3', S('bubble-3-digits-punctuation.png')],
  ['prompt-4', S('bubble-4-brackets-signs.png')],
  ['prompt-5', S('bubble-5-currency-maths.png')],
  // redraws: the first maths sheet came out thin, and the lowercase take drew l with a foot (it read as L)
  ['prompt-7', S('bubble-7-fixes.png')],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const font = buildFromSheets('Bubble Blue', BUBBLE_SHEETS);
  // the L's foot reached as far right as E's bottom bar, and the redrawn l was a pill unlike the other stems
  shortenL(font);
  lFromH(font);
  normalizeSizes(font);
  autoMetrics(font);
  font.family = 'Bubble';
  font.variant = 'Blue';
  const out = path.join(root, 'assets/fonts/bubble-blue.zip');
  fs.writeFileSync(out, fontZip(font));
  fs.rmSync(path.join(root, 'assets/fonts/bubble-orange.zip'), { force: true });
  console.log(`wrote ${path.relative(root, out)}: ${font.glyphs.size} glyphs`, font.metrics);
}
