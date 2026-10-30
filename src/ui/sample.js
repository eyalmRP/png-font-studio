// Small text previews drawn with a PNG font (brand, font list, style chips).
import { createDoc } from '../core/textdoc.js';
import { layoutDoc, inkBounds } from '../core/layout.js';
import { prepareText, drawPrepared } from '../render/text.js';
import { applyEffects } from '../render/effects.js';
import { DEFAULT_WARP } from '../core/warp.js';
import { state, getFont } from '../app/store.js';

export function drawSample(canvas, text, { fontId, height = 32, maxWidth = 240, effects = null, align = 'left', fit = false } = {}) {
  const font = getFont(fontId || state.fontOrder[0]);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!font) { canvas.width = 1; canvas.height = 1; return; }
  const doc = createDoc(text, { font: font.id, size: 100 }, { align: 'left' });
  const layout = layoutDoc(doc, { getFont: () => font, mode: 'point' });
  const b = inkBounds(layout);
  const prep = prepareText({ warp: DEFAULT_WARP }, layout, null);
  const pb = prep.bounds;
  const box = { x: Math.min(b.x, pb.x), y: Math.min(b.y, pb.y), w: Math.max(b.w, pb.w), h: Math.max(b.h, pb.h) };
  let s = (height * dpr) / box.h;
  if (box.w * s > maxWidth * dpr) s = (maxWidth * dpr) / box.w;
  const tmp = document.createElement('canvas');
  tmp.width = Math.max(1, Math.ceil(box.w * s)); tmp.height = Math.max(1, Math.ceil(box.h * s));
  drawPrepared(tmp.getContext('2d'), prep, new DOMMatrix().scale(s).translate(-box.x, -box.y));
  let out = tmp, ox = 0, oy = 0;
  if (effects && effects.length) { const fx = applyEffects(tmp, effects, s); out = fx.canvas; ox = fx.ox; oy = fx.oy; }
  canvas.width = out.width; canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(out, 0, 0);
  if (!fit) {
    canvas.style.height = (out.height / dpr) + 'px';
    canvas.style.width = (out.width / dpr) + 'px';
  }
  void ox; void oy; void align;
}
