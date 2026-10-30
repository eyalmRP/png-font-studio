// Review render: every glyph between reference letters (H … n) on guide lines, using glyph scale and baseline.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodePNG, writePNG } from './lib/png-node.mjs';
import { unzip, textOf } from '../src/core/zip.js';
import { fontFromJSON, glyphAdvance, opticalKern } from '../src/core/font.js';
import { createImage } from '../src/core/image.js';

const [file, out, colsArg, onlyArg] = process.argv.slice(2);
const files = await unzip(new Uint8Array(fs.readFileSync(file)), (b) => zlib.inflateRawSync(b));
const json = JSON.parse(textOf(files.get('font.json')));
const images = new Map();
for (const [n, b] of files) if (n.endsWith('.png')) images.set(n, decodePNG(b));
const font = fontFromJSON(json, images);
const m = font.metrics;
const K = 0.5; // render scale

function sample(img, fx, fy) { // bilinear, premultiplied-ish
  const x = Math.max(0, Math.min(img.width - 1.001, fx)), y = Math.max(0, Math.min(img.height - 1.001, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const out = [0, 0, 0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const i = ((y0 + dy) * img.width + x0 + dx) * 4, a = img.data[i + 3] / 255;
    out[0] += img.data[i] * a * w; out[1] += img.data[i + 1] * a * w; out[2] += img.data[i + 2] * a * w; out[3] += a * w;
  }
  return out;
}
function drawGlyph(dst, g, x, base) {
  const s = g.scale * K, w = Math.round(g.image.width * s), h = Math.round(g.image.height * s);
  const top = base - g.baseline * g.scale * K;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const X = Math.round(x + xx), Y = Math.round(top + yy);
    if (X < 0 || Y < 0 || X >= dst.width || Y >= dst.height) continue;
    const [r, gg, b, a] = sample(g.image, xx / s, yy / s);
    if (a <= 0) continue;
    const i = (Y * dst.width + X) * 4;
    dst.data[i] = r + dst.data[i] * (1 - a); dst.data[i + 1] = gg + dst.data[i + 1] * (1 - a); dst.data[i + 2] = b + dst.data[i + 2] * (1 - a);
  }
}
function hline(img, y, color, x0, x1) {
  y = Math.round(y);
  for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) { const i = (y * img.width + x) * 4; img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; }
}
let chars = [...font.glyphs.keys()];
if (onlyArg) chars = [...onlyArg];
const cols = +colsArg || 8;
const cellW = Math.round((m.capHeight * 3.6) * K), lineH = Math.round((m.ascender + m.descender) * K * 1.6);
const rows = Math.ceil(chars.length / cols);
const img = createImage(cols * cellW, rows * lineH + 20);
for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 46; img.data[i + 1] = 44; img.data[i + 2] = 56; img.data[i + 3] = 255; }
chars.forEach((ch, n) => {
  const r = Math.floor(n / cols), c = n % cols;
  const base = r * lineH + 20 + m.ascender * K * 1.25;
  const x0 = c * cellW + 10, x1 = (c + 1) * cellW - 10;
  hline(img, base, [255, 90, 90], x0, x1);
  hline(img, base - m.xHeight * K, [90, 140, 255], x0, x1);
  hline(img, base - m.capHeight * K, [90, 210, 120], x0, x1);
  hline(img, base + m.descender * K, [230, 170, 60], x0, x1);
  let x = x0 + 4, prev = null;
  for (const cc of ['H', ch, 'n']) {
    const g = font.glyphs.get(cc);
    if (prev) x += opticalKern(font, prev, g) * K;
    drawGlyph(img, g, x + g.lsb * K, base);
    x += glyphAdvance(font, g) * K + 2;
    prev = g;
  }
});
writePNG(out, img);
console.log('wrote', out, img.width, img.height);
