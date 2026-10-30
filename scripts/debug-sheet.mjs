// Render debug previews of a built font: every glyph on its baseline with guides, plus a sample line.
import fs from 'node:fs';
import { decodePNG, writePNG } from './lib/png-node.mjs';
import { unzip, textOf } from '../src/core/zip.js';
import { fontFromJSON, glyphAdvance, opticalKern } from '../src/core/font.js';
import { createImage } from '../src/core/image.js';
import zlib from 'node:zlib';

const file = process.argv[2], out = process.argv[3], sample = process.argv[4] || 'Hello World! Bubble 123';
const files = await unzip(new Uint8Array(fs.readFileSync(file)), (b) => zlib.inflateRawSync(b));
const json = JSON.parse(textOf(files.get('font.json')));
const images = new Map();
for (const [n, b] of files) if (n.endsWith('.png')) images.set(n, decodePNG(b));
const font = fontFromJSON(json, images);
const m = font.metrics;

function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const X = Math.round(dx + x), Y = Math.round(dy + y);
    if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const si = (y * src.width + x) * 4, di = (Y * dst.width + X) * 4, a = src.data[si + 3] / 255;
    for (let k = 0; k < 3; k++) dst.data[di + k] = src.data[si + k] * a + dst.data[di + k] * (1 - a);
  }
}
function hline(img, y, color, x0 = 0, x1 = img.width) {
  y = Math.round(y); if (y < 0 || y >= img.height) return;
  for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) { const i = (y * img.width + x) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; }
}
const glyphs = [...font.glyphs.values()];
const cols = 16, cellW = 230, lineH = m.ascender + m.descender + 90, rows = Math.ceil(glyphs.length / cols);
const sampleH = lineH + 40;
const W = cols * cellW, H = rows * lineH + sampleH * 2;
const img = createImage(W, H);
for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 52; img.data[i + 1] = 50; img.data[i + 2] = 62; img.data[i + 3] = 255; }
glyphs.forEach((g, i) => {
  const r = Math.floor(i / cols), c = i % cols;
  const base = r * lineH + 40 + m.ascender;
  if (c === 0) {
    hline(img, base, [255, 80, 80]); hline(img, base - m.capHeight, [90, 200, 120]);
    hline(img, base - m.xHeight, [90, 140, 255]); hline(img, base + m.descender, [200, 160, 60]);
  }
  blit(img, g.image, c * cellW + 20 + g.lsb, base - g.baseline);
});
for (const [k, text] of [[0, sample], [1, 'AVATAR Typography gjpqy (x+y)=z?']]) {
  let x = 30; const base = rows * lineH + k * sampleH + 30 + m.ascender;
  hline(img, base, [255, 80, 80]);
  let prev = null;
  for (const ch of text) {
    const g = font.glyphs.get(ch);
    if (prev && g) x += opticalKern(font, prev, g);
    if (g && g.image) blit(img, g.image, x + g.lsb, base - g.baseline);
    x += glyphAdvance(font, g) - 6;
    prev = g;
  }
}
writePNG(out, img);
console.log('wrote', out, W, H);
