// Corrections to glyphs that came out of the prompt sheets slightly off, applied when the built-in font is made.
import { cutColumns } from '../src/core/image.js';
import { setGlyph, glyphInk } from '../src/core/font.js';

const SOLID = 128;
const solid = (im, x, y) => im.data[(y * im.width + x) * 4 + 3] >= SOLID;

/** Shorten the foot of L so it is no longer than the bottom bar of E would suggest (target: F's width). */
export function shortenL(font) {
  const L = font.glyphs.get('L'), F = font.glyphs.get('F');
  if (!L || !F) return;
  const im = L.image, k = glyphInk(L);
  const inkW = (g) => { const m = g.image; let a = m.width, b = 0; for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (solid(m, x, y)) { a = Math.min(a, x); b = Math.max(b, x); } return [a, b]; };
  const [x0, x1] = inkW(L), [f0, f1] = inkW(F);
  const cut = Math.round((x1 - x0) - (f1 - f0) * F.scale / L.scale);
  if (cut <= 2) return;
  // foot-only columns: their ink starts low in the glyph. Find the stem first (its columns start at the top):
  // the 3D base can stick out left of the stem, and those columns also start low
  const topOf = (x) => { for (let y = 0; y < im.height; y++) if (solid(im, x, y)) return y; return im.height; };
  let fa = x0; while (fa < x1 && topOf(fa) > k.t + k.h * 0.2) fa++;
  while (fa < x1 && topOf(fa) < k.t + k.h * 0.55) fa++;
  const foot = x1 - fa;
  // cut from the middle of the bar: away from the joint with the stem and from the rounded end
  const start = fa + Math.round(foot * 0.25);
  if (start + cut > x1 - foot * 0.3) return;
  setGlyph(font, 'L', cutColumns(im, start, cut), { scale: L.scale, baseScale: L.baseScale, lsb: L.lsb, rsb: L.rsb });
}

const firstRun = (im, y) => {
  let x = 0;
  while (x < im.width && !solid(im, x, y)) x++;
  if (x >= im.width) return null;
  const x0 = x;
  while (x < im.width && solid(im, x, y)) x++;
  return [x0, x - 1];
};

/**
 * Make l from the left stem of h: the same weight, corners and 3D base as the other lowercase stems. The rows
 * where the arch joins the stem are left out and replaced by a straight section blended between the clean
 * stem above and below them, so l is exactly as tall as h.
 */
export function lFromH(font) {
  const hg = font.glyphs.get('h'), ig = font.glyphs.get('i');
  if (!hg || !hg.image) return;
  const im = hg.image, k = glyphInk(hg), W = im.width;
  // the stem's right edge where it stands free, near the top of the ascender
  const yRef = k.t + Math.round(k.h * 0.12);
  const ref = firstRun(im, yRef);
  if (!ref) return;
  const stemRight = ref[1];
  const free = (y) => { const r = firstRun(im, y); return r && r[1] <= stemRight + 2; };
  let j0 = yRef; while (j0 < k.b && free(j0)) j0++;          // the arch starts joining here
  let j1 = j0; while (j1 < k.b && !free(j1)) j1++;          // and the stem is free again from here
  if (j0 >= k.b || j1 >= k.b - 10) return;
  const a = j0 - 3, b = j1 + 3;                              // clean rows just outside the joint
  const cw = Math.min(W, stemRight + 5);                     // keep the soft edge on the right
  const out = { width: cw, height: im.height, data: new Uint8ClampedArray(cw * im.height * 4) };
  const put = (dy, row) => out.data.set(row, dy * cw * 4);
  const rowOf = (y) => { const r = new Uint8ClampedArray(cw * 4); for (let x = 0; x < cw; x++) r.set(im.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 4), x * 4); return r; };
  for (let y = 0; y <= a; y++) put(y, rowOf(y));
  for (let y = b; y < im.height; y++) put(y, rowOf(y));
  const A = rowOf(a), B = rowOf(b);
  for (let y = a + 1; y < b; y++) {
    const t = (y - a) / (b - a), r = new Uint8ClampedArray(cw * 4);
    for (let i = 0; i < r.length; i += 4) {
      const wa = A[i + 3] * (1 - t), wb = B[i + 3] * t, al = wa + wb;
      for (let c = 0; c < 3; c++) r[i + c] = al ? (A[i + c] * wa + B[i + c] * wb) / al : 0;
      r[i + 3] = al;
    }
    put(y, r);
  }
  const sp = ig || hg;
  setGlyph(font, 'l', out, { scale: hg.scale, baseScale: hg.baseScale, lsb: sp.lsb, rsb: sp.rsb });
}
