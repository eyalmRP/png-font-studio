// The glyph frame for editing a font in Photoshop: one canvas the size of a glyph box, every glyph placed on it the
// same way (its advance box centred, its baseline on the frame's baseline), at the finest resolution any glyph has,
// so no glyph is scaled down. Export and re-import share this geometry; the PSD stores the numbers (frameName) so a
// later change to the font cannot shift the mapping.
import { glyphWidth, glyphTop, glyphBottom } from './font.js';

/** Frame for a font: { p (px per font unit), w, h, baseline (px row), lines: { ascender, capHeight, xHeight, baseline, descender } (px rows) }. */
export function glyphFrame(font) {
  const glyphs = [...font.glyphs.values()].filter((g) => g.image);
  const m = font.metrics;
  // the finest pixel among the glyphs, so nothing is scaled down (within reason: at most 4 px per unit)
  const unit = Math.min(...glyphs.map((g) => g.scale * Math.min(1, g.sx || 1)), 1);
  const p = Math.min(4, 1 / unit);
  const top = Math.max(m.ascender, m.capHeight, ...glyphs.map(glyphTop));
  const bottom = Math.max(m.descender, ...glyphs.map(glyphBottom));
  const adv = Math.max(m.capHeight, ...glyphs.map((g) => g.lsb + glyphWidth(g) + g.rsb));
  // room to draw bigger than the current glyphs
  const pad = (m.ascender + m.descender) * 0.3;
  const w = Math.ceil((adv + pad * 2) * p), h = Math.ceil((top + bottom + pad * 2) * p);
  const baseline = Math.round((pad + top) * p);
  const row = (units) => Math.round(baseline - units * p);
  return { p, w, h, baseline, lines: { ascender: row(m.ascender), capHeight: row(m.capHeight), xHeight: row(m.xHeight), baseline, descender: row(-m.descender) } };
}

/** Where a glyph's image sits in the frame (integer px) and its drawn size; drawn 1:1 when scale × p is 1. */
export function placeGlyph(frame, g) {
  const sx = g.sx || 1;
  const w = Math.max(1, Math.round(g.image.width * g.scale * sx * frame.p)), h = Math.max(1, Math.round(g.image.height * g.scale * frame.p));
  const adv = (g.lsb + glyphWidth(g) + g.rsb) * frame.p;
  const x = Math.round((frame.w - adv) / 2 + g.lsb * frame.p);
  const y = frame.baseline - Math.round(g.baseline * g.scale * frame.p);
  return { x, y, w, h, exact: w === g.image.width && h === g.image.height };
}

/** Bounding box of pixels with any alpha: { l, t, r, b } (inclusive) or null when empty. */
export function alphaBox(img) {
  const { width: W, height: H, data } = img;
  let l = W, t = H, r = -1, b = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!data[(y * W + x) * 4 + 3]) continue;
    if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
  }
  return r < 0 ? null : { l, t, r, b };
}

/** Side bearings measured to the glyph's visible pixels (font units): what stays put when the artwork changes. */
export function inkBearings(g) {
  const box = g.image && alphaBox(g.image);
  const k = g.scale * (g.sx || 1);
  if (!box) return { left: g.lsb, right: g.rsb };
  return { left: g.lsb + box.l * k, right: g.rsb + (g.image.width - 1 - box.r) * k };
}

const FRAME_TAG = 'PNG Font Studio frame';
/** The frame numbers as a layer name (Photoshop keeps layer names exactly). */
export function frameName(frame) {
  // p in full: a rounded value can tip a glyph's drawn size by a pixel, and then nothing matches on the way back
  return `${FRAME_TAG} · p=${frame.p} · baseline=${frame.baseline} · w=${frame.w} · h=${frame.h}`;
}
export function parseFrameName(name) {
  if (!name || !name.startsWith(FRAME_TAG)) return null;
  const num = (k) => { const m = name.match(new RegExp(`${k}=([0-9.]+)`)); return m ? +m[1] : NaN; };
  const f = { p: num('p'), baseline: num('baseline'), w: num('w'), h: num('h') };
  return Object.values(f).every(Number.isFinite) ? f : null;
}

/** The character a layer stands for: a single character, or a U+XXXX label; null otherwise. */
export function layerChar(name) {
  const s = String(name || '').trim();
  if ([...s].length === 1) return s;
  const m = s.match(/^U\+([0-9A-Fa-f]{4,6})$/);
  return m ? String.fromCodePoint(parseInt(m[1], 16)) : null;
}
