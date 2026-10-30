// Draw laid-out text: per-character style transforms, animation ops (around unit pivots) and path placement.
import { glyphCanvas, canvasFilterSupported } from './glyphs.js';
import { unitIndex } from '../core/anim.js';
import { isPathWarp, pathPlacer } from '../core/warp.js';
import { hexToRgb } from '../ui/controls.js';

export function glyphRect(it) {
  if (it.glyph) {
    const g = it.glyph;
    const x = it.x + g.lsb * it.kx, y = it.baseline - g.baseline * g.scale * it.kv;
    return { x, y, w: g.image.width * g.scale * it.kx, h: g.image.height * g.scale * it.kv };
  }
  return { x: it.x, y: it.baseline - it.ascent, w: it.adv, h: it.ascent + it.descent };
}

const unitCache = new WeakMap();
function unitBoxes(layout, kind) {
  let per = unitCache.get(layout);
  if (!per) { per = {}; unitCache.set(layout, per); }
  if (per[kind]) return per[kind];
  const { idx } = unitIndex(layout.items, kind, layout);
  const boxes = new Map();
  layout.items.forEach((it, i) => {
    if (it.isSpace) return;
    const r = glyphRect(it);
    const b = boxes.get(idx[i]) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, base: -Infinity };
    b.x0 = Math.min(b.x0, r.x); b.y0 = Math.min(b.y0, r.y); b.x1 = Math.max(b.x1, r.x + r.w); b.y1 = Math.max(b.y1, r.y + r.h);
    b.base = Math.max(b.base, it.baseline);
    boxes.set(idx[i], b);
  });
  per[kind] = boxes;
  return boxes;
}

function pivotOf(box, pivot) {
  const cx = (box.x0 + box.x1) / 2;
  if (pivot === 'bottom') return [cx, box.base];
  if (pivot === 'top') return [cx, box.y0];
  return [cx, (box.y0 + box.y1) / 2];
}

const lineOfItem = new WeakMap();
function linesByItem(layout) {
  let m = lineOfItem.get(layout);
  if (m) return m;
  m = new Map();
  layout.lines.forEach((ln, li) => ln.items.forEach((it) => m.set(it, li)));
  lineOfItem.set(layout, m);
  return m;
}

/** Path placement matrix for a point at x along line li (local layout coords → placed coords). */
export function pathMatrix(layer, layout, li, x) {
  const ln = layout.lines[li] || layout.lines[0];
  const width = Math.max(...layout.lines.map((l) => l.width), 1);
  const size = ln?.items[0]?.size || 100;
  const place = pathPlacer(layer.warp, width, size);
  const first = layout.lines[0];
  // lines keep their alignment offsets along the path; later lines sit inside the first
  const along = x - Math.min(...layout.lines.map((l) => l.x0));
  const up = -(ln.baseline - first.baseline);
  const p = place(along, up);
  return new DOMMatrix().translate(p.x, p.y).rotate((p.rot * 180) / Math.PI).translate(-x, -ln.baseline);
}

/**
 * Prepare draw commands. anim: result of evaluate() or null. Returns { draws, bounds } in local layout coords
 * (after path placement and animation, before envelope warp).
 */
export function prepareText(layer, layout, anim, opts = {}) {
  const draws = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const path = isPathWarp(layer.warp);
  const lines = path ? linesByItem(layout) : null;
  layout.items.forEach((it, i) => {
    if (it.isSpace && !it.style.underline && !it.style.strike) return;
    const tr = anim ? anim.transforms[i] : null;
    const alpha = (it.style.opacity / 100) * (tr ? tr.opacity : 1);
    if (alpha <= 0.002) return;
    let M = new DOMMatrix();
    const r = glyphRect(it);
    if (path) M = pathMatrix(layer, layout, lines.get(it), it.x + it.adv / 2);
    if (tr && tr.ops.length) {
      for (const op of tr.ops) {
        let px, py;
        if (op.kind === 'char') { px = r.x + r.w / 2; py = op.pivot === 'bottom' ? it.baseline : op.pivot === 'top' ? r.y : r.y + r.h / 2; }
        else { const box = unitBoxes(layout, op.kind).get(op.u); [px, py] = box ? pivotOf(box, op.pivot) : [r.x + r.w / 2, r.y + r.h / 2]; }
        const em = it.size;
        M = M.translate(px + op.dx * em, py + op.dy * em).rotate(op.rot);
        if (op.skew) M = M.skewX(op.skew);
        M = M.scale(op.sx || 1e-4, op.sy || 1e-4).translate(-px, -py);
      }
    }
    const st = it.style;
    if (st.rotate || st.skew) {
      const cx = r.x + r.w / 2;
      M = M.translate(cx, it.baseline);
      if (st.rotate) M = M.rotate(-st.rotate);
      if (st.skew) M = M.skewX(-st.skew);
      M = M.translate(-cx, -it.baseline);
    }
    const canvas = it.glyph ? glyphCanvas(it.glyph, st, tr ? tr.hue : 0) : null;
    const d = { it, M, rect: r, canvas, alpha, blur: tr ? tr.blur * it.size : 0, clip: tr ? tr.clip : 1, bright: tr ? tr.bright : 0, missing: it.missing };
    draws.push(d);
    // bounds
    const pad = d.blur * 2;
    const lines2 = st.underline || st.strike ? it.size * 0.25 : 0;
    const pts = [[r.x - pad, r.y - pad], [r.x + r.w + pad, r.y - pad], [r.x - pad, r.y + r.h + pad + lines2], [r.x + r.w + pad, r.y + r.h + pad + lines2]];
    if (it.isSpace) { pts.length = 0; pts.push([it.x, it.baseline - it.size * 0.4], [it.x + it.adv, it.baseline + it.size * 0.25]); }
    for (const [px, py] of pts) {
      const p = M.transformPoint(new DOMPoint(px, py));
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
  });
  if (x0 === Infinity) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  void opts;
  return { draws, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Execute draws on ctx whose current transform maps local layout coords to pixels (base). */
export function drawPrepared(ctx, prep, base, opts = {}) {
  const filters = canvasFilterSupported();
  for (const d of prep.draws) {
    const { it, rect: r } = d;
    ctx.setTransform(base.multiply(d.M));
    ctx.globalAlpha = Math.min(1, d.alpha);
    const st = it.style;
    if (filters) {
      const f = [];
      if (d.blur > 0.05) f.push(`blur(${(d.blur * Math.hypot(base.a, base.b)).toFixed(2)}px)`);
      if (d.bright) f.push(`brightness(${(1 + d.bright).toFixed(3)})`);
      ctx.filter = f.length ? f.join(' ') : 'none';
    }
    if (d.clip < 0.999) {
      ctx.save();
      ctx.beginPath();
      const w = r.w * Math.max(0, d.clip);
      if (it.level & 1) ctx.rect(r.x + r.w - w, r.y - r.h, w, r.h * 3); else ctx.rect(r.x, r.y - r.h, w, r.h * 3);
      ctx.clip();
    }
    if (d.canvas) ctx.drawImage(d.canvas, r.x, r.y, r.w, r.h);
    else if (d.missing && opts.showMissing) {
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = opts.missingColor || '#ff5c8a';
      ctx.lineWidth = Math.max(1, it.size * 0.02);
      ctx.strokeRect(r.x + it.adv * 0.1, r.y + r.h * 0.1, it.adv * 0.8, r.h * 0.75);
      ctx.setLineDash([]);
    }
    if (st.underline || st.strike) {
      const [cr, cg, cb] = hexToRgb(st.lineColor);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      const th = it.size * 0.065;
      const font = it.font;
      const k = it.kv;
      const ext = it.adv + it.track + 0.5;
      if (st.underline) roundRect(ctx, it.x, it.baseline + it.size * 0.09, ext, th);
      if (st.strike) roundRect(ctx, it.x, it.baseline - (font ? font.metrics.xHeight * k * 0.5 : it.size * 0.3) - th / 2, ext, th);
    }
    if (d.clip < 0.999) ctx.restore();
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.fill();
}
