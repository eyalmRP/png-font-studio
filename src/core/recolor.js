// Face recolouring for whole fonts: presets, the font's main face colour, and colour variants.
import { rgbToHsl } from './image.js';
import { cloneFont, touch } from './font.js';

const stops = (...pairs) => pairs.map(([pos, color]) => ({ pos, color }));
/**
 * Colour presets. `stops` colour the letter face by brightness (dark → light). `palette` recolours the whole
 * design band by band: each entry takes the colours at hue offset `d` from the face colour (the face itself,
 * then the darker rim, the sides of the 3D depth and its base) to hue `hue`, colourfulness `c` and brightness
 * `y`; `keep` leaves that band as it is. Orange and Pearl are measured from the reference title designs.
 */
export const FACE_PRESETS = [
  {
    name: 'Orange', stops: stops([0.2, '#f2440f'], [0.35, '#ff6a12'], [0.5, '#ff9a1a'], [0.65, '#ffc21f'], [0.8, '#ffe437'], [0.95, '#fff6b8']),
    palette: [
      { d: -10, hue: 56, c: 0.5, y: 0.93 }, { d: 0, hue: 50, c: 0.86, y: 0.83 }, { d: 10, hue: 42, c: 0.92, y: 0.72 }, { d: 20, hue: 36, c: 0.93, y: 0.65 },
      { d: 30, hue: 30, c: 0.92, y: 0.58 }, { d: 40, hue: 24, c: 0.9, y: 0.52 }, { d: 50, hue: 16, c: 0.85, y: 0.42 }, { d: 70, hue: 6, c: 0.75, y: 0.33 },
      { d: 90, hue: 344, c: 0.74, y: 0.34 }, { d: 100, hue: 333, c: 0.8, y: 0.38 }, { d: 110, hue: 323, c: 0.8, y: 0.44 }, { d: 120, hue: 316, c: 0.7, y: 0.52 },
    ],
  },
  {
    name: 'Pearl', stops: stops([0.2, '#7a6fe0'], [0.35, '#aaa3ef'], [0.5, '#d6d3f8'], [0.65, '#eeedfc'], [0.8, '#fbfbff'], [1, '#ffffff']),
    palette: [
      { d: -10, hue: 210, c: 0.02, y: 0.97 }, { d: 0, hue: 215, c: 0.05, y: 0.93 }, { d: 10, hue: 220, c: 0.12, y: 0.88 }, { d: 20, hue: 226, c: 0.18, y: 0.82 },
      { d: 30, hue: 232, c: 0.24, y: 0.75 }, { d: 40, hue: 238, c: 0.32, y: 0.62 }, { d: 50, hue: 245, c: 0.55, y: 0.36 }, { d: 70, hue: 262, c: 0.6, y: 0.33 },
      { d: 90, hue: 290, c: 0.6, y: 0.37 }, { d: 100, hue: 312, c: 0.65, y: 0.4 }, { d: 110, hue: 328, c: 0.7, y: 0.43 }, { d: 120, hue: 335, c: 0.65, y: 0.5 },
    ],
  },
  { name: 'Gold', stops: stops([0.2, '#8a5300'], [0.4, '#c98a10'], [0.6, '#f0c040'], [0.8, '#fff0a0'], [0.95, '#fffbe6']) },
  { name: 'Red', stops: stops([0.15, '#8f0016'], [0.3, '#d1142b'], [0.5, '#ff4b4b'], [0.7, '#ff8f80'], [0.9, '#ffe0d8']) },
  { name: 'Green', stops: stops([0.2, '#0b6b2c'], [0.4, '#1fae4b'], [0.6, '#6fe36a'], [0.8, '#c9ff9e'], [0.95, '#f4ffe6']) },
  { name: 'Purple', stops: stops([0.15, '#3d1287'], [0.35, '#6a2fd8'], [0.55, '#9d6bff'], [0.75, '#cdb3ff'], [0.95, '#f3edff']) },
];

export const hexRgb = (hex) => { const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** The font's main face colour: the hue with the most strongly coloured pixels. */
export function dominantHue(font) {
  const bins = new Float64Array(36);
  for (const g of font.glyphs.values()) {
    if (!g.image) continue;
    const d = g.image.data;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 200) continue;
      const chroma = (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])) / 255;
      if (chroma < 0.35) continue;
      bins[Math.floor(rgbToHsl(d[i], d[i + 1], d[i + 2])[0] * 36) % 36] += chroma;
    }
  }
  let best = 0;
  for (let k = 1; k < 36; k++) if (bins[k] > bins[best]) best = k;
  // refine with the neighbouring bins
  const a = bins[(best + 35) % 36], b = bins[best], c = bins[(best + 1) % 36];
  const off = (c - a) / (2 * (a + b + c) || 1);
  return Math.round(((best + 0.5 + off) * 10 + 360) % 360);
}

const LUMA = [0.2126, 0.7152, 0.0722];
const lerpHue = (a, b, t) => (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
function hcy(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
  let h = 0;
  if (c > 0) h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
  return [(h * 60 + 360) % 360, c, LUMA[0] * r + LUMA[1] * g + LUMA[2] * b];
}
/** RGB (0..1) with the given hue, chroma and luma; chroma gives way when the colour would leave the gamut. */
function fromHcy(h, c, y) {
  const x = (n) => { const k = (n + h / 60) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
  const p = [x(5), x(3), x(1)]; // pure hue, max 1 min 0
  const lp = LUMA[0] * p[0] + LUMA[1] * p[1] + LUMA[2] * p[2];
  for (const v of p) {
    if (v > lp) c = Math.min(c, (1 - y) / (v - lp));
    else if (v < lp) c = Math.min(c, y / (lp - v));
  }
  c = Math.max(0, c);
  const m = y - lp * c;
  return p.map((v) => Math.min(1, Math.max(0, v * c + m)));
}

/** A face-only preset as a palette: its face colours by brightness, a darker rim, the 3D depth kept. */
export function paletteFromStops(st) {
  const sorted = [...st].sort((a, b) => a.pos - b.pos);
  const at = (t) => {
    let a = sorted[0], b = sorted[sorted.length - 1];
    if (t <= a.pos) b = a; else if (t >= b.pos) a = b;
    else for (let k = 0; k < sorted.length - 1; k++) if (t >= sorted[k].pos && t <= sorted[k + 1].pos) { a = sorted[k]; b = sorted[k + 1]; break; }
    const f = b.pos === a.pos ? 0 : (t - a.pos) / (b.pos - a.pos), A = hexRgb(a.color), B = hexRgb(b.color);
    return hcy(...A.map((v, i) => (v + (B[i] - v) * f) / 255));
  };
  const face = [[-10, 0.95], [0, 0.85], [10, 0.72], [20, 0.6], [30, 0.5], [40, 0.4]].map(([d, t]) => { const [hue, c, y] = at(t); return { d, hue, c, y }; });
  const [rh, rc] = at(0.15);
  return [...face, { d: 50, hue: rh, c: rc * 0.8, y: 0.2 }, { d: 70, keep: true }];
}

/**
 * Resolve a palette against a font: measure the font's own colourfulness and brightness in each band, so each
 * band shifts by what it takes to reach the target. Returns [{ d, hue, k, s }] (k scales chroma, s shifts luma).
 */
export function resolvePalette(font, palette, h0 = dominantHue(font)) {
  const sum = palette.map(() => ({ n: 0, c: 0, y: 0 }));
  for (const g of font.glyphs.values()) {
    if (!g.image) continue;
    const dt = g.image.data;
    for (let i = 0; i < dt.length; i += 8) {
      if (dt[i + 3] < 200) continue;
      const [h, c, y] = hcy(dt[i] / 255, dt[i + 1] / 255, dt[i + 2] / 255);
      if (c < 0.15) continue;
      const off = ((h - h0 + 540) % 360) - 180;
      palette.forEach((p, j) => { if (Math.abs(off - p.d) <= 5) { sum[j].n++; sum[j].c += c; sum[j].y += y; } });
    }
  }
  return palette.map((p, j) => {
    const st = sum[j];
    if (p.keep || !st.n) return { d: p.d, hue: (h0 + p.d + 360) % 360, k: 1, s: 0, keep: !!p.keep };
    return { d: p.d, hue: p.hue, k: p.c / (st.c / st.n), s: p.y - st.y / st.n };
  });
}

/** Recolour pixels band by band with a resolved palette (see resolvePalette). Greys and whites stay. */
export function remapPalette(data, h0, anchors) {
  const A = [...anchors].sort((a, b) => a.d - b.d);
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const [h, c, y] = hcy(r, g, b);
    const w = Math.min(1, Math.max(0, (c - 0.06) / 0.14)); // near-grey highlights change little
    if (w <= 0) continue;
    const off = ((h - h0 + 540) % 360) - 180;
    let lo = A[0], hi = A[A.length - 1], t = 0;
    if (off <= lo.d) hi = lo; else if (off >= hi.d) lo = hi;
    else for (let k = 0; k < A.length - 1; k++) if (off >= A[k].d && off <= A[k + 1].d) { lo = A[k]; hi = A[k + 1]; t = (off - lo.d) / (hi.d - lo.d); break; }
    // a kept band keeps the pixel's own hue
    const hueLo = lo.keep ? h : lo.hue, hueHi = hi.keep ? h : hi.hue;
    const nh = lerpHue(hueLo, hueHi, t), k = lo.k + (hi.k - lo.k) * t, s = lo.s + (hi.s - lo.s) * t;
    const out = fromHcy(nh, Math.min(1, c * k), Math.min(1, Math.max(0, y + s)));
    data[i] = Math.round((r + (out[0] - r) * w) * 255);
    data[i + 1] = Math.round((g + (out[1] - g) * w) * 255);
    data[i + 2] = Math.round((b + (out[2] - b) * w) * 255);
  }
  return data;
}

/** A copy of the font recoloured to a preset: the whole design follows the preset's palette. */
export function faceVariant(font, presetName, name) {
  const preset = FACE_PRESETS.find((p) => p.name === presetName);
  if (!preset) throw new Error('unknown preset ' + presetName);
  const h0 = dominantHue(font);
  const anchors = resolvePalette(font, preset.palette || paletteFromStops(preset.stops), h0);
  const out = cloneFont(font, name);
  for (const g of out.glyphs.values()) if (g.image) remapPalette(g.image.data, h0, anchors);
  touch(out);
  return out;
}
