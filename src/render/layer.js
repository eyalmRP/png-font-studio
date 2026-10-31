// Layer compositor: layout → glyphs (+ animation, path) → envelope warp → effects, with caching,
// plus the coordinate mappings the editor needs for caret, selection and hit testing on warped text.
import { layoutDoc, inkBounds } from '../core/layout.js';
import { evaluate } from '../core/anim.js';
import { isEnvelopeWarp, isPathWarp, warpLocal, localMesh, inverseMap } from '../core/warp.js';
import { prepareText, drawPrepared, pathMatrix } from './text.js';
import { warpCanvas } from './warp.js';
import { applyEffects } from './effects.js';
import { makeCanvas } from './glyphs.js';
import { getFont } from '../app/store.js';

const caches = new WeakMap();
const cacheOf = (layer) => { let c = caches.get(layer); if (!c) { c = {}; caches.set(layer, c); } return c; };

export function getLayout(layer) {
  const c = cacheOf(layer);
  const key = `${layer.layoutRev}:${layer.box.mode}:${layer.box.width}:${layer.warp.style}`;
  if (c.layoutKey !== key) {
    c.layout = layoutDoc(layer.doc, { getFont, mode: layer.box.mode, width: layer.box.width, defaultDir: 'ltr' });
    c.frame = inkBounds(c.layout);
    c.layoutKey = key;
    c.mesh = null;
  }
  return c.layout;
}

/** Static ink frame of the text (warp reference). */
export function getFrame(layer) { getLayout(layer); return cacheOf(layer).frame; }

export const hasAnim = (layer) => {
  const a = layer.anim;
  return !!a && (a.in.preset !== 'none' || a.out.preset !== 'none' || a.loop.preset !== 'none');
};

export function layerMatrix(layer) {
  return new DOMMatrix().translate(layer.x, layer.y).rotate(layer.rotation).scale(layer.scaleX / 100, layer.scaleY / 100);
}

/** Is the layer shown at time t (its start/end window)? */
export function layerVisibleAt(layer, t) {
  if (!layer.visible) return false;
  return t >= (layer.anim?.start ?? 0) - 1e-6 && t <= (layer.anim?.end ?? Infinity) + 1e-6;
}

/**
 * Render a layer at `scale` pixels per layer unit. Returns { canvas, rect } (rect in layer-local units) or null.
 */
export function renderLayer(layer, time, scale, opts = {}) {
  const c = cacheOf(layer);
  const layout = getLayout(layer);
  let anim = null;
  if (hasAnim(layer) && !opts.noAnim) {
    anim = evaluate(layer.anim, layout.items, layout, time);
    if (!anim.visible) return null;
  }
  const animKey = anim && anim.active ? time.toFixed(4) : 'static';
  const key = `${layer.rev}:${layer.layoutRev}:${scale.toFixed(4)}:${animKey}:${opts.showMissing ? 1 : 0}:${opts.noAnim ? 1 : 0}`;
  if (c.renderKey === key && c.result) return c.result;
  const prep = prepareText(layer, layout, anim);
  const pad = 2 / scale;
  let rect = { x: prep.bounds.x - pad, y: prep.bounds.y - pad, w: prep.bounds.w + pad * 2, h: prep.bounds.h + pad * 2 };
  // keep huge zooms bounded
  let s = scale;
  const maxPx = 36e6;
  if (rect.w * rect.h * s * s > maxPx) s = Math.sqrt(maxPx / (rect.w * rect.h));
  let canvas = makeCanvas(rect.w * s, rect.h * s);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  drawPrepared(ctx, prep, new DOMMatrix().scale(s).translate(-rect.x, -rect.y), { showMissing: opts.showMissing });
  const hasFx = layer.effects && layer.effects.some((e) => e.enabled);
  // see-through letters (character opacity, or a fade in the animation): effects measure the letters at full opacity
  let shape = null;
  if (hasFx && prep.draws.some((d) => d.alpha < 0.999)) {
    shape = makeCanvas(rect.w * s, rect.h * s);
    const sctx = shape.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    drawPrepared(sctx, prep, new DOMMatrix().scale(s).translate(-rect.x, -rect.y), { showMissing: opts.showMissing, fullAlpha: true });
  }
  if (isEnvelopeWarp(layer.warp)) {
    const w = warpCanvas(canvas, rect, c.frame, layer.warp, s);
    if (shape) shape = warpCanvas(shape, rect, c.frame, layer.warp, s).canvas;
    canvas = w.canvas; rect = w.rect;
  }
  const contentRect = rect;
  let passes = null, main = null;
  if (hasFx) {
    const fx = applyEffects(canvas, layer.effects, s, shape);
    rect = { x: rect.x - fx.ox / s, y: rect.y - fx.oy / s, w: fx.canvas.width / s, h: fx.canvas.height / s };
    canvas = fx.canvas;
    if (fx.passes) { passes = fx.passes; main = fx.main; }
  }
  c.renderKey = key;
  // canvas is the whole layer; passes + main (when set) let effect blend modes reach the layers underneath
  c.result = { canvas, rect, contentRect, layout, anim, passes, main };
  return c.result;
}

/** Draw all visible layers. base: DOMMatrix mapping artboard px → canvas px. */
export function drawLayers(ctx, project, time, base, opts = {}) {
  const pxPerUnit = Math.hypot(base.a, base.b);
  // a still title is drawn at rest, without its animation
  if (project.animated === false && opts.noAnim === undefined) opts = { ...opts, noAnim: true };
  for (const layer of project.layers) {
    if (!layerVisibleAt(layer, time)) continue;
    if (opts.only && !opts.only.includes(layer.id)) continue;
    const M = layerMatrix(layer);
    const s = Math.max(0.05, pxPerUnit * Math.max(layer.scaleX, layer.scaleY) / 100) * (opts.quality || 1);
    const r = renderLayer(layer, time, s, opts);
    if (!r) continue;
    ctx.save();
    ctx.setTransform(base.multiply(M));
    ctx.imageSmoothingQuality = 'high';
    if (r.passes) {
      // effects behind the text blend with what is already drawn (a screen glow brightens the background)
      const k = r.rect.w / r.canvas.width;
      for (const p of r.passes) {
        ctx.globalAlpha = (layer.opacity / 100) * p.alpha;
        ctx.globalCompositeOperation = p.blend;
        ctx.drawImage(p.canvas, r.rect.x + p.dx * k, r.rect.y + p.dy * k, p.canvas.width * k, p.canvas.height * k);
      }
    }
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = !layer.blend || layer.blend === 'normal' ? 'source-over' : layer.blend;
    ctx.drawImage(r.main || r.canvas, r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    ctx.restore();
  }
}

/** Render the artboard to a new canvas (export). */
export function renderFrame(project, time, scale = 1, { background = false, crop = null, fill = null } = {}) {
  const ab = project.artboard;
  const area = crop || { x: 0, y: 0, w: ab.w, h: ab.h };
  const W = Math.max(1, Math.round(area.w * scale)), H = Math.max(1, Math.round(area.h * scale));
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // fill: a colour under everything, even on a transparent artboard (formats that cannot store transparency)
  const under = fill || (background && ab.bg === 'color' ? ab.bgColor : null);
  if (under) { ctx.fillStyle = under; ctx.fillRect(0, 0, W, H); }
  drawLayers(ctx, project, time, new DOMMatrix().scale(scale).translate(-area.x, -area.y), { quality: 1 });
  return canvas;
}

/** Bounding box (artboard px) of everything drawn at time t, from rendered layer rects. */
export function contentBounds(project, time) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const layer of project.layers) {
    if (!layerVisibleAt(layer, time)) continue;
    const r = renderLayer(layer, time, 1, { noAnim: project.animated === false });
    if (!r) continue;
    const M = layerMatrix(layer);
    for (const [px, py] of [[r.rect.x, r.rect.y], [r.rect.x + r.rect.w, r.rect.y], [r.rect.x, r.rect.y + r.rect.h], [r.rect.x + r.rect.w, r.rect.y + r.rect.h]]) {
      const p = M.transformPoint(new DOMPoint(px, py));
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- editor mappings ----------

/** Forward-map a local layout point through path placement / envelope warp (no animation). */
export function warpPoint(layer, x, y, lineIndex) {
  const layout = getLayout(layer);
  if (isPathWarp(layer.warp)) {
    const li = lineIndex ?? nearestLine(layout, y);
    const p = pathMatrix(layer, layout, li, x).transformPoint(new DOMPoint(x, y));
    return [p.x, p.y];
  }
  if (isEnvelopeWarp(layer.warp)) return warpLocal(getFrame(layer), layer.warp, x, y);
  return [x, y];
}

function nearestLine(layout, y) {
  let best = 0, bd = Infinity;
  layout.lines.forEach((ln, i) => { const d = y < ln.top ? ln.top - y : y > ln.bottom ? y - ln.bottom : 0; if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Inverse of warpPoint: warped local point → layout coordinates. */
export function unwarpPoint(layer, x, y) {
  const layout = getLayout(layer);
  if (isEnvelopeWarp(layer.warp)) {
    const c = cacheOf(layer);
    const frame = getFrame(layer);
    const key = `${c.layoutKey}:${JSON.stringify(layer.warp)}`;
    if (!c.mesh || c.meshKey !== key) {
      const m = Math.max(frame.w, frame.h) * 0.6;
      c.mesh = localMesh(frame, layer.warp, { x: frame.x - m, y: frame.y - m, w: frame.w + m * 2, h: frame.h + m * 2 }, 64, 32);
      c.meshKey = key;
    }
    return inverseMap(c.mesh, x, y);
  }
  if (isPathWarp(layer.warp)) {
    // try every item's placement and keep the one whose inverse lands inside (or nearest to) its box
    let best = [x, y], bd = Infinity;
    layout.lines.forEach((ln, li) => {
      const xs = ln.items.length ? ln.items.map((it) => it.x + it.adv / 2) : [ln.x0];
      for (const ix of xs) {
        const inv = pathMatrix(layer, layout, li, ix).inverse().transformPoint(new DOMPoint(x, y));
        const dx = Math.abs(inv.x - ix), dy = inv.y < ln.top ? ln.top - inv.y : inv.y > ln.bottom ? inv.y - ln.bottom : 0;
        const d = dx + dy * 2;
        if (d < bd) { bd = d; best = [inv.x, inv.y]; }
      }
    });
    return best;
  }
  return [x, y];
}
