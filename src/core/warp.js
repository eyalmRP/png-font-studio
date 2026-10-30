// Text warps. Envelope warps deform the rendered text through a mesh (Photoshop/Office style).
// Path layouts place characters along a curve without distorting them.
// Envelope coordinates: u ∈ [-1, 1] across the text, v ∈ [-a, a] down the text (a = height / width).

export const WARP_STYLES = [
  { id: 'none', group: 'none' },
  { id: 'arc', group: 'envelope' },
  { id: 'arcLower', group: 'envelope' },
  { id: 'arcUpper', group: 'envelope' },
  { id: 'arch', group: 'envelope' },
  { id: 'bulge', group: 'envelope' },
  { id: 'shellLower', group: 'envelope' },
  { id: 'shellUpper', group: 'envelope' },
  { id: 'flag', group: 'envelope' },
  { id: 'wave', group: 'envelope' },
  { id: 'fish', group: 'envelope' },
  { id: 'rise', group: 'envelope' },
  { id: 'fisheye', group: 'envelope' },
  { id: 'inflate', group: 'envelope' },
  { id: 'squeeze', group: 'envelope' },
  { id: 'twist', group: 'envelope' },
  { id: 'chevron', group: 'envelope' },
  { id: 'triangle', group: 'envelope' },
  { id: 'curve', group: 'envelope' },
  { id: 'doubleWave', group: 'envelope' },
  { id: 'slant', group: 'envelope' },
  { id: 'pathArc', group: 'path' },
  { id: 'pathCircle', group: 'path' },
  { id: 'pathWave', group: 'path' },
];

export const DEFAULT_WARP = Object.freeze({ style: 'none', bend: 0.5, hDistort: 0, vDistort: 0, vertical: false, pathSpacing: 0, pathStart: 0 });

export const isPathWarp = (w) => !!w && w.style.startsWith('path');
export const isEnvelopeWarp = (w) => !!w && w.style !== 'none' && !isPathWarp(w);

/** Map envelope point (u, v) → (x, y) in the same units. */
export function warpPoint(style, u, v, a, p) {
  let { bend: b = 0, hDistort: hd = 0, vDistort: vd = 0, vertical = false } = p;
  if (vertical) {
    // transpose, warp, transpose back (a becomes 1/a in the rotated frame, rescaled to keep units)
    const r = warpPoint(style, v / a, u / a, 1 / a, { ...p, vertical: false });
    return [r[1] * a, r[0] * a];
  }
  // perspective-like distortions
  v *= 1 + hd * u * 0.9;
  u *= 1 + vd * (a ? v / a : 0) * 0.9;
  const nv = a ? v / a : 0;
  const t = (nv + 1) / 2; // 0 top → 1 bottom
  const q = 1 - u * u;
  switch (style) {
    case 'arc': {
      if (Math.abs(b) < 1e-4) return [u, v];
      const R = 1 / (b * 1.6);
      const phi = u / R;
      const r = R - v;
      return [r * Math.sin(phi), R - r * Math.cos(phi)];
    }
    case 'arcLower': return [u, v + b * a * q * t * 1.2];
    case 'arcUpper': return [u, v - b * a * q * (1 - t) * 1.2];
    case 'arch': return [u, v - b * a * 1.2 * q];
    case 'bulge': return [u, v * (1 + b * q * 0.9)];
    case 'shellLower': return [u * (1 + 0.25 * b * t), v + b * a * q * t * 1.6];
    case 'shellUpper': return [u * (1 + 0.25 * b * (1 - t)), v - b * a * q * (1 - t) * 1.6];
    case 'flag': return [u, v + b * a * 0.9 * Math.sin(Math.PI * u)];
    case 'wave': return [u, v * (1 + 0.3 * b * Math.cos(Math.PI * u * 1.5)) + b * a * 0.6 * Math.sin(Math.PI * u * 1.5)];
    case 'fish': {
      const w = (u + 1) / 2;
      const prof = w < 0.8 ? Math.sin((Math.PI * w) / 0.8) : -((w - 0.8) / 0.2) * 0.6;
      return [u, v * (1 + b * prof * 0.8)];
    }
    case 'rise': return [u, v - b * a * u * 1.1];
    case 'fisheye': {
      const d2 = (u * u + nv * nv) / 2;
      const f = 1 + b * (1 - d2) * 0.8;
      return [u * f, v * f];
    }
    case 'inflate': return [u * (1 + b * 0.35 * (1 - nv * nv)), v * (1 + b * 0.9 * q)];
    case 'squeeze': return [u * (1 - b * 0.3 * (1 - nv * nv)), v * (1 + b * 0.6 * u * u)];
    case 'twist': {
      const d = Math.min(1, Math.sqrt((u * u + nv * nv) / 2));
      const ang = b * Math.PI * 0.6 * (1 - d);
      const c = Math.cos(ang), s = Math.sin(ang);
      return [u * c - v * s, u * s + v * c];
    }
    case 'chevron': return [u, v - b * a * 1.1 * (1 - Math.abs(u))];
    case 'triangle': return [u, v * (1 - b * 0.85 * Math.abs(u)) + a * 0.85 * b * Math.abs(u)];
    case 'curve': return [u, v + b * a * 1.1 * (u * u - 0.5)];
    case 'doubleWave': return [u, v + b * a * 0.6 * Math.sin(2 * Math.PI * u)];
    case 'slant': return [u - b * 0.6 * v, v];
    default: return [u, v];
  }
}

/**
 * Build a warped mesh for a w×h source. Returns { cols, rows, src: Float32Array (x,y per vertex, pixels),
 * dst: Float32Array (pixels, relative to the output origin), bounds: {x,y,w,h} } where bounds is the
 * warped extent in the source's pixel units (origin = source centre).
 */
export function buildMesh(w, h, warp, density = 1) {
  const a = h / w;
  const cols = Math.max(8, Math.min(160, Math.round(48 * density * Math.max(1, w / h / 2))));
  const rows = Math.max(4, Math.min(80, Math.round(cols * a * 1.5)));
  const src = new Float32Array((cols + 1) * (rows + 1) * 2);
  const dst = new Float32Array((cols + 1) * (rows + 1) * 2);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const half = w / 2;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const i = (r * (cols + 1) + c) * 2;
      const sx = (c / cols) * w, sy = (r / rows) * h;
      src[i] = sx; src[i + 1] = sy;
      const u = (c / cols) * 2 - 1, v = ((r / rows) * 2 - 1) * a;
      const [wx, wy] = warpPoint(warp.style, u, v, a, warp);
      const px = wx * half, py = wy * half;
      dst[i] = px; dst[i + 1] = py;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
  }
  return { cols, rows, src, dst, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Forward map a source pixel (relative to the source top-left) into warped coordinates (centre origin). */
export function forwardMap(w, h, warp, sx, sy) {
  const a = h / w, half = w / 2;
  const [x, y] = warpPoint(warp.style, (sx / w) * 2 - 1, ((sy / h) * 2 - 1) * a, a, warp);
  return [x * half, y * half];
}

/** Inverse map a warped point (centre origin) back to the source by searching the mesh triangles. */
export function inverseMap(mesh, px, py) {
  const { cols, rows, src, dst } = mesh;
  let best = null, bestD = Infinity;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i00 = (r * (cols + 1) + c) * 2, i10 = i00 + 2, i01 = i00 + (cols + 1) * 2, i11 = i01 + 2;
      for (const tri of [[i00, i10, i11], [i00, i11, i01]]) {
        const [A, B, C] = tri;
        const bc = barycentric(px, py, dst[A], dst[A + 1], dst[B], dst[B + 1], dst[C], dst[C + 1]);
        if (!bc) continue;
        const [l1, l2, l3] = bc;
        const inside = l1 >= -1e-4 && l2 >= -1e-4 && l3 >= -1e-4;
        const sx = l1 * src[A] + l2 * src[B] + l3 * src[C];
        const sy = l1 * src[A + 1] + l2 * src[B + 1] + l3 * src[C + 1];
        if (inside) return [sx, sy];
        const d = Math.min(0, l1) ** 2 + Math.min(0, l2) ** 2 + Math.min(0, l3) ** 2;
        if (d < bestD) { bestD = d; best = [sx, sy]; }
      }
    }
  }
  return best || [px, py];
}

function barycentric(px, py, ax, ay, bx, by, cx, cy) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-9) return null;
  const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  return [l1, l2, 1 - l1 - l2];
}

/**
 * Path layouts: returns a function (x, baselineOffset) → { x, y, rot } in local coordinates,
 * where x runs along the line and baselineOffset is the distance above the path (positive up).
 * width: line width; size: reference font size.
 */
export function pathPlacer(warp, width, size) {
  const b = warp.bend || 0.0001;
  switch (warp.style) {
    case 'pathCircle': {
      const circumference = Math.max(width * 1.05, size * 2);
      const R = circumference / (2 * Math.PI) / Math.max(0.15, Math.abs(b));
      const sign = b >= 0 ? 1 : -1;
      const start = ((warp.pathStart || 0) * Math.PI) / 180;
      return (x, up) => {
        const ang = start + (x - width / 2) / R; // centred at the top
        const r = R + sign * up;
        return { x: Math.sin(ang) * r * sign, y: -Math.cos(ang) * r * sign + R * sign, rot: ang * sign };
      };
    }
    case 'pathArc': {
      const R = width / (2 * Math.max(0.05, Math.abs(b)) * 1.2);
      const sign = b >= 0 ? 1 : -1;
      return (x, up) => {
        const ang = (x - width / 2) / R;
        const r = R + sign * up;
        return { x: width / 2 + Math.sin(ang) * r * sign, y: -Math.cos(ang) * r * sign + R * sign, rot: ang * sign };
      };
    }
    case 'pathWave': {
      const amp = size * 0.5 * b, k = (2 * Math.PI) / Math.max(size * 4, width / 1.5);
      return (x, up) => {
        const y = Math.sin(x * k) * amp;
        const slope = Math.cos(x * k) * amp * k;
        const rot = Math.atan(slope);
        return { x: x - Math.sin(rot) * up, y: y - Math.cos(rot) * up, rot };
      };
    }
    default: return (x, up) => ({ x, y: -up, rot: 0 });
  }
}

/** Warp a local point relative to the static text frame {x, y, w, h}. */
export function warpLocal(frame, warp, x, y) {
  const half = Math.max(1, frame.w / 2), cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const a = Math.max(0.02, frame.h / Math.max(1, frame.w));
  const [u, v] = warpPoint(warp.style, (x - cx) / half, (y - cy) / half, a, warp);
  return [cx + u * half, cy + v * half];
}

/** Mesh over a local rect for inverse lookups (hit testing on warped text). */
export function localMesh(frame, warp, rect, cols = 48, rows = 16) {
  const src = new Float32Array((cols + 1) * (rows + 1) * 2), dst = new Float32Array(src.length);
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const i = (r * (cols + 1) + c) * 2;
    const x = rect.x + (c / cols) * rect.w, y = rect.y + (r / rows) * rect.h;
    src[i] = x; src[i + 1] = y;
    const [wx, wy] = warpLocal(frame, warp, x, y);
    dst[i] = wx; dst[i + 1] = wy;
  }
  return { cols, rows, src, dst };
}
