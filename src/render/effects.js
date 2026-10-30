// Layer effects on a premultiplied canvas: Photoshop-style layer styles plus Office-style extras.
import { EFFECTS, effectMargin } from '../core/effects-def.js';
import { distanceOutside, distanceInside, boxBlur, bevelShade, smoothstep } from '../core/fx.js';
import { adjustHsl } from '../core/image.js';
import { makeCanvas, canvasFilterSupported } from './glyphs.js';
import { hexToRgb } from '../ui/controls.js';

const ctx2d = (c) => c.getContext('2d', { willReadFrequently: true });
const rad = (d) => (d * Math.PI) / 180;
const blendOp = (b) => (!b || b === 'normal' ? 'source-over' : b);

function copyCanvas(src, W = src.width, H = src.height, x = 0, y = 0) {
  const c = makeCanvas(W, H);
  c.getContext('2d').drawImage(src, x, y);
  return c;
}

/** Gaussian-like blur of a canvas (radius = Photoshop "size" in px). */
export function blurCanvas(c, size) {
  if (size < 0.5) return c;
  const sigma = size / 2.4;
  if (canvasFilterSupported()) {
    const out = makeCanvas(c.width, c.height);
    const x = out.getContext('2d');
    x.filter = `blur(${sigma.toFixed(2)}px)`;
    x.drawImage(c, 0, 0);
    return out;
  }
  const ctx = ctx2d(c);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const W = c.width, H = c.height, n = W * H;
  const r = Math.max(1, Math.round(sigma * 1.2));
  for (let ch = 0; ch < 4; ch++) {
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = d.data[i * 4 + ch];
    boxBlur(f, W, H, r, 3);
    for (let i = 0; i < n; i++) d.data[i * 4 + ch] = f[i];
  }
  const out = makeCanvas(W, H);
  out.getContext('2d').putImageData(d, 0, 0);
  return out;
}

function alphaToCanvas(alpha, W, H, rgb, opacity = 1) {
  const c = makeCanvas(W, H);
  const d = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const a = alpha[i];
    if (a <= 0) continue;
    d.data[i * 4] = rgb[0]; d.data[i * 4 + 1] = rgb[1]; d.data[i * 4 + 2] = rgb[2];
    d.data[i * 4 + 3] = Math.min(255, a * opacity * 255);
  }
  c.getContext('2d').putImageData(d, 0, 0);
  return c;
}

function inkBox(alpha, W, H) {
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 0.05) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return { x: 0, y: 0, w: W, h: H };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Fill style for a gradient across box at angle (deg, Adobe convention: 90 = bottom→top). */
function gradientStyle(ctx, stops, angle, box, kind = 'linear', scale = 100) {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let g;
  if (kind === 'radial') {
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, (Math.hypot(box.w, box.h) / 2) * (scale / 100));
  } else {
    const a = rad(angle);
    const dx = Math.cos(a), dy = -Math.sin(a);
    const half = ((Math.abs(dx) * box.w + Math.abs(dy) * box.h) / 2) * (scale / 100);
    g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  }
  for (const s of [...stops].sort((p, q) => p.pos - q.pos)) g.addColorStop(Math.min(1, Math.max(0, s.pos)), s.color);
  return g;
}

/** Paint a coverage map with a colour or gradient fill. */
function coverageCanvas(cov, W, H, e, box, fillKey = 'color') {
  if (e.fill === 'gradient') {
    const c = makeCanvas(W, H);
    const x = c.getContext('2d');
    x.fillStyle = gradientStyle(x, e.gradient, e.gradAngle ?? 90, box);
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(alphaToCanvas(cov, W, H, [0, 0, 0]), 0, 0);
    return c;
  }
  return alphaToCanvas(cov, W, H, hexToRgb(e[fillKey]));
}

/**
 * Apply effects. src: canvas; scale: px per artboard px. Returns { canvas, ox, oy } — src's origin inside canvas.
 */
export function applyEffects(src, effects, scale) {
  const list = (effects || []).filter((e) => e.enabled && EFFECTS[e.type]);
  if (!list.length) return { canvas: src, ox: 0, oy: 0 };
  const m = Math.ceil(Math.max(0, ...list.map(effectMargin)) * scale) + 2;
  const W = src.width + m * 2, H = src.height + m * 2;
  const base = copyCanvas(src, W, H, m, m);
  const bctx = ctx2d(base);
  const mask = copyCanvas(base); // original shape, used to keep alpha after content effects
  let alpha = null, dOut = null, dIn = null, box = null;
  const getAlpha = () => {
    if (!alpha) {
      const d = bctx.getImageData(0, 0, W, H).data;
      alpha = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) alpha[i] = d[i * 4 + 3] / 255;
    }
    return alpha;
  };
  const getOut = () => (dOut ||= distanceOutside(getAlpha(), W, H));
  const getIn = () => (dIn ||= distanceInside(getAlpha(), W, H));
  const getBox = () => (box ||= inkBox(getAlpha(), W, H));
  getAlpha();

  const place = (e) => EFFECTS[e.type].placement(e);
  const content = list.filter((e) => place(e) === 'content');
  const behind = list.filter((e) => place(e) === 'behind');
  const top = list.filter((e) => place(e) === 'top');
  const final = list.filter((e) => place(e) === 'final');

  // ---- content effects (bottom of the list first, so the top entry wins) ----
  for (const e of [...content].reverse()) {
    const layer = contentLayer(e, { W, H, base, getAlpha, getIn, getBox, scale });
    if (!layer) continue;
    bctx.save();
    bctx.globalAlpha = (e.opacity ?? 100) / 100;
    bctx.globalCompositeOperation = e.type === 'stroke' ? 'source-atop' : blendOp(e.blend);
    bctx.drawImage(layer, 0, 0);
    bctx.restore();
    bctx.save();
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(mask, 0, 0);
    bctx.restore();
  }

  // ---- behind effects ----
  const out = makeCanvas(W, H);
  const octx = out.getContext('2d');
  for (const e of [...behind].reverse()) {
    const r = behindLayer(e, { W, H, base, mask, getAlpha, getOut, getBox, scale });
    if (!r) continue;
    octx.save();
    octx.globalAlpha = Math.min(1, (e.opacity ?? 100) / 100);
    octx.globalCompositeOperation = blendOp(e.blend);
    octx.drawImage(r.canvas, r.dx || 0, r.dy || 0);
    octx.restore();
  }
  octx.drawImage(base, 0, 0);

  // ---- top effects (centre stroke) ----
  for (const e of [...top].reverse()) {
    const dO = getOut(), dI = getIn();
    const cov = new Float32Array(W * H);
    const half = (e.size * scale) / 2;
    for (let i = 0; i < W * H; i++) {
      const sd = dO[i] > 0 ? dO[i] : -dI[i];
      cov[i] = Math.min(1, Math.max(0, half + 0.5 - Math.abs(sd)));
    }
    let c = coverageCanvas(cov, W, H, e, getBox());
    if (e.soft) c = blurCanvas(c, e.soft * scale);
    octx.save();
    octx.globalAlpha = e.opacity / 100;
    octx.drawImage(c, 0, 0);
    octx.restore();
  }

  // ---- final filters ----
  let result = out, ox = m, oy = m;
  for (const e of final) {
    if (e.type === 'blur') result = blurCanvas(result, e.radius * scale);
    if (e.type === 'reflection') {
      const r = reflect(result, e, scale);
      result = r;
    }
  }
  return { canvas: result, ox, oy };
}

function contentLayer(e, { W, H, base, getAlpha, getIn, getBox, scale }) {
  const a = getAlpha();
  switch (e.type) {
    case 'adjust': {
      const c = copyCanvas(base);
      const x = ctx2d(c);
      const d = x.getImageData(0, 0, W, H);
      adjustHsl(d.data, e.hue, e.saturation / 100, e.lightness / 100);
      if (e.brightness || e.contrast) {
        const b = e.brightness * 1.28, k = (259 * (e.contrast + 255)) / (255 * (259 - e.contrast));
        for (let i = 0; i < d.data.length; i += 4) for (let ch = 0; ch < 3; ch++) d.data[i + ch] = k * (d.data[i + ch] - 128) + 128 + b;
      }
      x.putImageData(d, 0, 0);
      // adjust replaces the pixels: draw over with 'copy' semantics by returning a full layer
      return c;
    }
    case 'colorOverlay': {
      const c = makeCanvas(W, H);
      const x = c.getContext('2d');
      x.fillStyle = e.color; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(base, 0, 0);
      return c;
    }
    case 'gradientOverlay': {
      const c = makeCanvas(W, H);
      const x = c.getContext('2d');
      x.fillStyle = gradientStyle(x, e.gradient, e.angle, getBox(), e.kind, e.scale);
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(base, 0, 0);
      return c;
    }
    case 'innerShadow': {
      const ang = rad(e.angle), dist = e.distance * scale;
      const dx = -Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      let c = makeCanvas(W, H);
      const x = c.getContext('2d');
      x.fillStyle = e.color; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-out'; x.drawImage(base, dx, dy);
      c = blurCanvas(c, e.size * scale * (1 - e.choke / 100));
      const x2 = c.getContext('2d');
      x2.globalCompositeOperation = 'destination-in'; x2.drawImage(base, 0, 0);
      return c;
    }
    case 'innerGlow': {
      const dI = getIn();
      const size = Math.max(0.5, e.size * scale);
      const choke = e.choke / 100;
      const cov = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) {
        if (a[i] <= 0) continue;
        const t = dI[i] / size;
        const v = e.source === 'center' ? smoothstep(0, 1, t) : 1 - smoothstep(choke, 1, t);
        cov[i] = v * a[i];
      }
      return alphaToCanvas(cov, W, H, hexToRgb(e.color));
    }
    case 'bevel': {
      const dI = getIn();
      const size = Math.max(1, e.size * scale);
      const hgt = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) hgt[i] = a[i] > 0 ? smoothstep(0, 1, dI[i] / size) : 0;
      if (e.soften) boxBlur(hgt, W, H, Math.max(1, (e.soften * scale) / 1.7));
      const { light, dark } = bevelShade(hgt, W, H, e.angle, e.altitude, (e.depth / 100) * size * 0.6);
      const d = new ImageData(W, H);
      const hl = hexToRgb(e.highlight), sh = hexToRgb(e.shadow);
      const ho = e.highlightOpacity / 100, so = e.shadowOpacity / 100;
      // composite highlight (screen-like) and shadow (multiply-like) as a single normal layer
      for (let i = 0; i < W * H; i++) {
        if (a[i] <= 0) continue;
        const l = light[i] * ho, k = dark[i] * so;
        const al = Math.min(1, l + k);
        if (al <= 0) continue;
        const wl = l / (l + k || 1);
        d.data[i * 4] = hl[0] * wl + sh[0] * (1 - wl);
        d.data[i * 4 + 1] = hl[1] * wl + sh[1] * (1 - wl);
        d.data[i * 4 + 2] = hl[2] * wl + sh[2] * (1 - wl);
        d.data[i * 4 + 3] = al * a[i] * 255;
      }
      const c = makeCanvas(W, H);
      c.getContext('2d').putImageData(d, 0, 0);
      return c;
    }
    case 'stroke': { // inside stroke
      const dI = getIn();
      const size = e.size * scale;
      const cov = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) if (a[i] > 0) cov[i] = Math.min(1, Math.max(0, size + 0.5 - dI[i])) * a[i];
      let c = coverageCanvas(cov, W, H, e, getBox());
      if (e.soft) c = blurCanvas(c, e.soft * scale);
      return c;
    }
    default: return null;
  }
}

function dilated(getAlpha, getOut, W, H, r) {
  const a = getAlpha();
  if (r <= 0.01) return a;
  const dO = getOut();
  const cov = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) cov[i] = Math.max(a[i], Math.min(1, Math.max(0, r + 0.5 - dO[i])));
  return cov;
}

/** Repeated offset copies using doubling (log steps): union of src shifted by k·(ux, uy), k = 0..n. */
function smear(src, W, H, ux, uy, length, behindOrder = true) {
  let steps = Math.max(1, Math.ceil(Math.log2(Math.max(2, length))));
  const unit = length / 2 ** steps;
  let cur = copyCanvas(src, W, H);
  let k = 1;
  for (let s = 0; s < steps; s++) {
    const next = makeCanvas(W, H);
    const x = next.getContext('2d');
    if (behindOrder) { x.drawImage(cur, ux * unit * k, uy * unit * k); x.drawImage(cur, 0, 0); }
    else { x.drawImage(cur, 0, 0); x.drawImage(cur, ux * unit * k, uy * unit * k); }
    cur = next; k *= 2;
  }
  return cur;
}

function behindLayer(e, { W, H, base, mask, getAlpha, getOut, getBox, scale }) {
  switch (e.type) {
    case 'stroke': {
      const cov = dilated(getAlpha, getOut, W, H, e.size * scale);
      let c = coverageCanvas(cov, W, H, e, getBox());
      if (e.soft) c = blurCanvas(c, e.soft * scale);
      return { canvas: c };
    }
    case 'dropShadow':
    case 'outerGlow': {
      const size = e.size * scale;
      const spread = (e.spread / 100) * size;
      const cov = dilated(getAlpha, getOut, W, H, spread);
      let c = alphaToCanvas(cov, W, H, hexToRgb(e.color));
      c = blurCanvas(c, Math.max(0, size - spread));
      if (e.type === 'outerGlow') {
        // glows read stronger when the blurred falloff is lifted slightly
        const x = c.getContext('2d');
        x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.35; x.drawImage(c, 0, 0);
        return { canvas: c };
      }
      const ang = rad(e.angle), dist = e.distance * scale;
      return { canvas: c, dx: -Math.cos(ang) * dist, dy: Math.sin(ang) * dist };
    }
    case 'extrude': {
      const ang = rad(e.angle), len = e.depth * scale;
      const ux = Math.cos(ang), uy = -Math.sin(ang);
      let src;
      if (e.mode === 'color') {
        src = makeCanvas(W, H);
        const x = src.getContext('2d');
        x.fillStyle = e.color; x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0);
      } else {
        src = makeCanvas(W, H);
        const x = src.getContext('2d');
        x.drawImage(base, 0, 0);
        x.globalCompositeOperation = 'source-atop';
        x.fillStyle = `rgba(0,0,0,${e.darken / 100})`; x.fillRect(0, 0, W, H);
      }
      const sm = smear(src, W, H, ux, uy, len);
      return { canvas: sm };
    }
    case 'longShadow': {
      const ang = rad(e.angle), len = e.length * scale;
      const ux = Math.cos(ang), uy = -Math.sin(ang);
      const sil = makeCanvas(W, H);
      const x = sil.getContext('2d');
      x.fillStyle = e.color; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0);
      const sm = smear(sil, W, H, ux, uy, len, false);
      if (e.fade) {
        const b = getBox();
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const reach = Math.abs(ux) * b.w / 2 + Math.abs(uy) * b.h / 2;
        const sx = cx - ux * reach, sy = cy - uy * reach;
        const g = sm.getContext('2d');
        const grad = g.createLinearGradient(sx, sy, sx + ux * (reach * 2 + len), sy + uy * (reach * 2 + len));
        grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'destination-in'; g.fillStyle = grad; g.fillRect(0, 0, W, H);
      }
      return { canvas: sm };
    }
    default: return null;
  }
}

function reflect(src, e, scale) {
  const W = src.width, H = src.height;
  // find the bottom of the ink to mirror around
  const d = ctx2d(src).getImageData(0, 0, W, H).data;
  let bottom = H - 1;
  outer: for (let y = H - 1; y >= 0; y--) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 10) { bottom = y; break outer; }
  let top = 0;
  outer2: for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 10) { top = y; break outer2; }
  const inkH = bottom - top + 1;
  const gap = e.gap * scale;
  const reflH = inkH * (e.size / 100);
  const outH = Math.max(H, Math.ceil(bottom + gap + reflH + 2));
  let refl = makeCanvas(W, Math.ceil(reflH) + 2);
  const r = refl.getContext('2d');
  r.save(); r.translate(0, inkH); r.scale(1, -1); r.drawImage(src, 0, top, W, inkH, 0, 0, W, inkH); r.restore();
  const grad = r.createLinearGradient(0, 0, 0, reflH);
  grad.addColorStop(0, `rgba(0,0,0,${e.opacity / 100})`); grad.addColorStop(1, 'rgba(0,0,0,0)');
  r.globalCompositeOperation = 'destination-in'; r.fillStyle = grad; r.fillRect(0, 0, W, reflH + 2);
  if (e.blur) refl = blurCanvas(refl, e.blur * scale);
  const out = makeCanvas(W, outH);
  const o = out.getContext('2d');
  o.drawImage(refl, 0, bottom + 1 + gap);
  o.drawImage(src, 0, 0);
  return out;
}
