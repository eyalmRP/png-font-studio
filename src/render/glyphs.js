// Glyph images as canvases, with cached colour variants (tints, hue shifts).
import { adjustHsl, rgbToHsl, hslToRgb } from '../core/image.js';
import { hexToRgb } from '../ui/controls.js';

const base = new WeakMap(); // image object → canvas
const variants = new Map(); // key → canvas (LRU)
const MAX_VARIANTS = 1200;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function imageToCanvas(img) {
  let c = base.get(img);
  if (c) return c;
  c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  base.set(img, c);
  return c;
}

export function canvasToImage(canvas) {
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  return { width: d.width, height: d.height, data: d.data };
}

export function tintKey(style, hueAnim = 0) {
  const h = Math.round(hueAnim / 6) * 6 % 360;
  if (style.tintMode === 'none' && !h) return '';
  if (style.tintMode === 'hsl' || style.tintMode === 'none') return `h${(style.tintMode === 'hsl' ? style.hue : 0) + h}|${style.tintMode === 'hsl' ? style.sat : 0}|${style.tintMode === 'hsl' ? style.light : 0}`;
  return `c${style.tintColor}|${style.tintAmount}|${h}`;
}

function colorize(data, hex, amount) {
  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts] = rgbToHsl(tr, tg, tb);
  const a = amount / 100;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    const [r, g, b] = hslToRgb(th, ts, Math.min(1, l * 0.9 + 0.08));
    data[i] += (r - data[i]) * a; data[i + 1] += (g - data[i + 1]) * a; data[i + 2] += (b - data[i + 2]) * a;
  }
}

/** Canvas for a glyph with the character style's tint and an animated hue offset applied. */
export function glyphCanvas(glyph, style, hueAnim = 0) {
  const img = glyph.image;
  const key = tintKey(style, hueAnim);
  if (!key) return imageToCanvas(img);
  const k = `${glyph.id}:${glyph.rev}:${key}`;
  let c = variants.get(k);
  if (c) { variants.delete(k); variants.set(k, c); return c; }
  const data = new Uint8ClampedArray(img.data);
  const h = Math.round(hueAnim / 6) * 6 % 360;
  if (style.tintMode === 'colorize') {
    colorize(data, style.tintColor, style.tintAmount);
    if (h) adjustHsl(data, h, 0, 0);
  } else {
    const on = style.tintMode === 'hsl';
    adjustHsl(data, (on ? style.hue : 0) + h, on ? style.sat / 100 : 0, on ? style.light / 100 : 0);
  }
  c = makeCanvas(img.width, img.height);
  c.getContext('2d').putImageData(new ImageData(data, img.width, img.height), 0, 0);
  variants.set(k, c);
  if (variants.size > MAX_VARIANTS) variants.delete(variants.keys().next().value);
  return c;
}

let filterOK = null;
export function canvasFilterSupported() {
  if (filterOK === null) {
    try {
      const ctx = makeCanvas(2, 2).getContext('2d');
      ctx.filter = 'blur(2px)';
      filterOK = ctx.filter === 'blur(2px)';
    } catch { filterOK = false; }
  }
  return filterOK;
}
