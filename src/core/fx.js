// Pixel maths for effects: Euclidean distance transforms, blurs, shading. Pure (typed arrays in, typed arrays out).

const INF = 1e20;

function edt1d(f, n, d, v, z, arg = null) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    if (arg) arg[q] = v[k];
  }
}

/** Squared Euclidean distance to the nearest seed (seed[i] true). Felzenszwalb & Huttenlocher. */
export function edtSquared(seed, W, H) {
  const grid = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) grid[i] = seed[i] ? 0 : INF;
  const n = Math.max(W, H);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) grid[y * W + x] = d[x];
  }
  return grid;
}

/**
 * For every pixel, values[] at its nearest seed (the same Euclidean transform, keeping where each minimum came from).
 * Pixels with no seed anywhere get `empty`.
 */
export function nearestSeedValue(seed, values, W, H, empty = 1) {
  const grid = new Float32Array(W * H), row = new Int32Array(W * H);
  const n = Math.max(W, H);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1), arg = new Int32Array(n);
  // columns: distance to, and row of, the nearest seed in the same column
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = seed[y * W + x] ? 0 : INF;
    edt1d(f, H, d, v, z, arg);
    for (let y = 0; y < H; y++) { grid[y * W + x] = d[y]; row[y * W + x] = arg[y]; }
  }
  // rows: the column whose seed is nearest overall, and so the seed itself
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = grid[y * W + x];
    edt1d(f, W, d, v, z, arg);
    for (let x = 0; x < W; x++) {
      if (!(d[x] < INF / 2)) { out[y * W + x] = empty; continue; }
      const sx = arg[x], sy = row[y * W + sx];
      out[y * W + x] = values[sy * W + sx];
    }
  }
  return out;
}

/** Distance (px) from outside pixels to the shape (alpha ≥ 0.5); 0 inside. alpha: Float32Array 0..1 */
export function distanceOutside(alpha, W, H) {
  const seed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) seed[i] = alpha[i] >= 0.5 ? 1 : 0;
  const d2 = edtSquared(seed, W, H);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = seed[i] ? 0 : Math.sqrt(d2[i]) - 0.5 + (0.5 - alpha[i]);
  return out;
}

/** Distance (px) from inside pixels to the nearest outside pixel; 0 outside. */
export function distanceInside(alpha, W, H) {
  const seed = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) seed[i] = alpha[i] < 0.5 ? 1 : 0;
  const d2 = edtSquared(seed, W, H);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) out[i] = seed[i] ? 0 : Math.sqrt(d2[i]) - 0.5 + (alpha[i] - 0.5);
  return out;
}

/** In-place separable box blur, `passes` times (3 ≈ gaussian). */
export function boxBlur(src, W, H, radius, passes = 3) {
  const r = Math.max(0, Math.round(radius));
  if (!r) return src;
  const tmp = new Float32Array(W * H);
  let a = src, b = tmp;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = acc / (2 * r + 1);
        acc += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  return a;
}

/** Gaussian-ish blur radius split into 3 box passes. */
export const blurRadiusToBox = (sigmaPx) => Math.max(0, Math.round(sigmaPx / 1.7));

/** Bevel shading from a height field. Returns { light, dark } Float32 0..1. */
export function bevelShade(height, W, H, angleDeg, altitudeDeg, depth) {
  const light = new Float32Array(W * H), dark = new Float32Array(W * H);
  const az = (angleDeg * Math.PI) / 180, al = (altitudeDeg * Math.PI) / 180;
  const lx = Math.cos(az) * Math.cos(al), ly = -Math.sin(az) * Math.cos(al), lz = Math.sin(al);
  const flat = lz; // shading of a flat surface
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const dx = (height[i + 1] - height[i - 1]) * depth, dy = (height[i + W] - height[i - W]) * depth;
      const len = Math.hypot(dx, dy, 1);
      const nx = -dx / len, ny = -dy / len, nz = 1 / len;
      const s = nx * lx + ny * ly + nz * lz;
      const v = s - flat;
      if (v > 0) light[i] = Math.min(1, v / (1 - flat + 1e-3)); else dark[i] = Math.min(1, -v / (flat + 1e-3));
    }
  }
  return { light, dark };
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}
