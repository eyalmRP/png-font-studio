// Face recolouring for whole fonts: presets, the font's main face colour, and colour variants.
import { recolorRange, rgbToHsl } from './image.js';
import { cloneFont, touch } from './font.js';

const stops = (...pairs) => pairs.map(([pos, color]) => ({ pos, color }));
/** Face colour presets: colours by brightness (dark → light) so the face keeps its shading. */
export const FACE_PRESETS = [
  { name: 'Orange', stops: stops([0.2, '#f2440f'], [0.35, '#ff6a12'], [0.5, '#ff9a1a'], [0.65, '#ffc21f'], [0.8, '#ffe437'], [0.95, '#fff6b8']) },
  { name: 'Pearl', stops: stops([0.2, '#7a6fe0'], [0.35, '#aaa3ef'], [0.5, '#d6d3f8'], [0.65, '#eeedfc'], [0.8, '#fbfbff'], [1, '#ffffff']) },
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

/** A copy of the font with its face recoloured to a preset (keeps the 3D base, outline and shine). */
export function faceVariant(font, presetName, name, face = { hue: dominantHue(font), width: 38, soft: 30 }) {
  const preset = FACE_PRESETS.find((p) => p.name === presetName);
  if (!preset) throw new Error('unknown preset ' + presetName);
  const out = cloneFont(font, name);
  const st = preset.stops.map((s) => ({ pos: s.pos, color: hexRgb(s.color) }));
  for (const g of out.glyphs.values()) if (g.image) recolorRange(g.image.data, face, st);
  touch(out);
  return out;
}
