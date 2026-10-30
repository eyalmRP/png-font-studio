// Pure RGBA image helpers. An image is { width, height, data: Uint8ClampedArray }.
// No DOM here: shared by the browser, the build scripts and the tests.

export function createImage(width, height, data) {
  return { width, height, data: data || new Uint8ClampedArray(width * height * 4) };
}

export function cloneImage(img) {
  return createImage(img.width, img.height, new Uint8ClampedArray(img.data));
}

export function cropImage(img, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const out = createImage(w, h);
  const { width: W, height: H, data } = img;
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy;
    if (sy < 0 || sy >= H) continue;
    for (let xx = 0; xx < w; xx++) {
      const sx = x + xx;
      if (sx < 0 || sx >= W) continue;
      const si = (sy * W + sx) * 4, di = (yy * w + xx) * 4;
      out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}

/** Bounding box of pixels with alpha > threshold, or null when empty. */
export function alphaBBox(img, threshold = 0) {
  const { width: W, height: H, data } = img;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function countOpaque(img, threshold = 0) {
  let n = 0;
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > threshold) n++;
  return n;
}

/** Trim transparent borders. Returns { image, x, y } where x,y is the offset of the trimmed image in the source. */
export function trimImage(img, threshold = 0, pad = 0) {
  const bb = alphaBBox(img, threshold);
  if (!bb) return { image: createImage(1, 1), x: 0, y: 0, empty: true };
  const x = bb.x - pad, y = bb.y - pad;
  return { image: cropImage(img, x, y, bb.w + pad * 2, bb.h + pad * 2), x, y, empty: false };
}

function isGrayish(r, g, b, tol) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx - mn <= tol && mx > 50 && mx < 205;
}

/**
 * Remove grid-line remnants in a band along the image border. Only grid-coloured (low-saturation grey)
 * pixels are removed, so glyph artwork that reaches into the band is never cut.
 */
export function clearBorderLines(img, { band = 10, grayTol = 26, alphaMin = 30 } = {}) {
  const { width: W, height: H, data } = img;
  const b = Math.min(band, Math.floor(Math.min(W, H) / 4));
  if (grayTol > 0) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= b && x < W - b && y >= b && y < H - b) continue;
        const i = (y * W + x) * 4;
        if (data[i + 3] > alphaMin && isGrayish(data[i], data[i + 1], data[i + 2], grayTol)) data[i + 3] = 0;
      }
    }
  }
  return img;
}

/**
 * Label 8-connected components of the mask (Uint8Array 0/1). Returns { labels: Int32Array, comps: [{area,x0,y0,x1,y1,touches}] }.
 */
export function labelComponents(mask, W, H) {
  const labels = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = comps.length;
    let sp = 0; stack[sp++] = start; labels[start] = id;
    const c = { area: 0, x0: W, y0: H, x1: 0, y1: 0, touches: false };
    while (sp) {
      const p = stack[--sp];
      const x = p % W, y = (p - x) / W;
      c.area++;
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) c.touches = true;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (mask[q] && labels[q] === -1) { labels[q] = id; stack[sp++] = q; }
        }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/**
 * Clean a glyph's alpha: hysteresis threshold (pixels above `low` survive only when connected to a pixel above `high`),
 * drop components smaller than minArea (or smaller than minRelative × largest), and optionally drop thin components
 * touching the border (grid-line remnants). Antialiased edges keep their original alpha.
 */
export function cleanupAlpha(img, opts = {}) {
  const { low = 24, high = 160, minArea = 24, minRelative = 0.004, dropBorderSlivers = true, sliver = 6 } = opts;
  const { width: W, height: H, data } = img;
  const out = cloneImage(img);
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) mask[p] = data[p * 4 + 3] > low ? 1 : 0;
  const { labels, comps } = labelComponents(mask, W, H);
  const strong = new Uint8Array(comps.length);
  for (let p = 0; p < W * H; p++) if (labels[p] >= 0 && data[p * 4 + 3] >= high) strong[labels[p]] = 1;
  let largest = 0;
  comps.forEach((c, i) => { if (strong[i] && c.area > largest) largest = c.area; });
  const keep = comps.map((c, i) => {
    if (!strong[i]) return false;
    if (c.area < minArea || c.area < largest * minRelative) return false;
    if (dropBorderSlivers && c.touches) {
      const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
      if ((w <= sliver && h > sliver * 3) || (h <= sliver && w > sliver * 3)) return false;
    }
    return true;
  });
  let removed = 0;
  for (let p = 0; p < W * H; p++) {
    const l = labels[p];
    if (l < 0 || !keep[l]) {
      if (out.data[p * 4 + 3]) removed++;
      out.data[p * 4] = 0; out.data[p * 4 + 1] = 0; out.data[p * 4 + 2] = 0; out.data[p * 4 + 3] = 0;
    }
  }
  return { image: out, removed, components: keep.filter(Boolean).length };
}

/** Is there meaningful content? */
export function isMostlyEmpty(img, minPixels = 30, threshold = 80) {
  return countOpaque(img, threshold) < minPixels;
}

// ---------- grid detection ----------

/**
 * A thin line pixel: more opaque than the pixels RIDGE px to either side across the line. Catches grid lines of
 * any colour, including the half-transparent tinted lines AI background removal leaves behind.
 * across = 'y' tests a horizontal line (compares above and below), 'x' a vertical one.
 */
const RIDGE = 3;
function isRidge(data, W, H, x, y, across) {
  const a = data[(y * W + x) * 4 + 3];
  if (a < 40) return false;
  if (across === 'y') {
    if (y < RIDGE || y + RIDGE >= H) return false;
    return a - data[((y - RIDGE) * W + x) * 4 + 3] >= 25 && a - data[((y + RIDGE) * W + x) * 4 + 3] >= 25;
  }
  if (x < RIDGE || x + RIDGE >= W) return false;
  return a - data[(y * W + x - RIDGE) * 4 + 3] >= 25 && a - data[(y * W + x + RIDGE) * 4 + 3] >= 25;
}

function lineScoreProfile(img, axis, grayTol) {
  const { width: W, height: H, data } = img;
  const n = axis === 'x' ? W : H, m = axis === 'x' ? H : W;
  const gray = new Float32Array(n), ridge = new Float32Array(n), content = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = data[i + 3];
      const k = axis === 'x' ? x : y;
      content[k] += a / 255;
      if (a > 60 && isGrayish(data[i], data[i + 1], data[i + 2], grayTol)) gray[k] += 1;
      else if (a < 230 && isRidge(data, W, H, x, y, axis === 'x' ? 'x' : 'y')) ridge[k] += 1;
    }
  }
  for (let k = 0; k < n; k++) gray[k] += ridge[k];
  for (let k = 0; k < n; k++) { gray[k] /= m; content[k] /= m; }
  // merge thick lines: a line 2-3px wide spreads its score across neighbours
  const merged = new Float32Array(n);
  for (let k = 0; k < n; k++) merged[k] = Math.max(gray[k], (gray[k - 1] || 0) + gray[k] + (gray[k + 1] || 0));
  return { gray: merged, content };
}

function pickEdges(profile, count, size, { minLine = 0.18 } = {}) {
  const { gray, content } = profile;
  const step = size / count;
  const edges = [];
  const sources = [];
  for (let i = 0; i <= count; i++) {
    const expect = i * step;
    const lo = Math.max(0, Math.round(expect - step * 0.3)), hi = Math.min(size - 1, Math.round(expect + step * 0.3));
    let best = -1, bestScore = 0;
    for (let k = lo; k <= hi; k++) if (gray[k] > bestScore) { bestScore = gray[k]; best = k; }
    if (best >= 0 && bestScore >= minLine) { edges.push(best); sources.push('line'); continue; }
    if (i === 0) { edges.push(0); sources.push('edge'); continue; }
    if (i === count) { edges.push(size); sources.push('edge'); continue; }
    // no visible line: use the emptiest column/row near the expected position (gap between glyphs)
    let gapBest = Math.round(expect), gapScore = Infinity;
    for (let k = lo; k <= hi; k++) {
      const s = content[k] + Math.abs(k - expect) / step * 0.02;
      if (s < gapScore) { gapScore = s; gapBest = k; }
    }
    edges.push(gapBest); sources.push('gap');
  }
  return { edges, sources };
}

/** Count evenly spaced grid lines to guess rows/cols (falls back to 6). */
export function guessGridCount(img, axis, { grayTol = 26, min = 1, max = 16 } = {}) {
  const size = axis === 'x' ? img.width : img.height;
  const prof = lineScoreProfile(img, axis, grayTol);
  let best = null;
  for (let n = min; n <= max; n++) {
    const { sources } = pickEdges(prof, n, size);
    const lines = sources.filter((s) => s === 'line').length;
    const inner = n - 1;
    const score = inner === 0 ? 0 : sources.slice(1, -1).filter((s) => s === 'line').length / inner;
    if (score >= 0.8 && inner > 0 && (!best || n > best.n)) best = { n, score, lines };
  }
  return best ? best.n : null;
}

/**
 * Detect a rows × cols grid. Returns { xs, ys, sources } where xs has cols+1 edges and ys rows+1 edges.
 * Visible grid lines win; otherwise the emptiest gap near the evenly spaced guess; otherwise even spacing.
 */
export function detectGrid(img, { rows, cols, grayTol = 26 } = {}) {
  if (!cols) cols = guessGridCount(img, 'x', { grayTol }) || 6;
  if (!rows) rows = guessGridCount(img, 'y', { grayTol }) || cols;
  const px = pickEdges(lineScoreProfile(img, 'x', grayTol), cols, img.width);
  const py = pickEdges(lineScoreProfile(img, 'y', grayTol), rows, img.height);
  return { rows, cols, xs: px.edges, ys: py.edges, sources: { x: px.sources, y: py.sources } };
}

export function uniformGrid(width, height, rows, cols) {
  const xs = [], ys = [];
  for (let i = 0; i <= cols; i++) xs.push(Math.round((i * width) / cols));
  for (let i = 0; i <= rows; i++) ys.push(Math.round((i * height) / rows));
  return { rows, cols, xs, ys };
}

/** Cut the grid into cell images (row-major). inset trims the grid line itself. */
export function sliceCells(img, grid, inset = 3) {
  const cells = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const x = grid.xs[c] + inset, y = grid.ys[r] + inset;
      const w = grid.xs[c + 1] - grid.xs[c] - inset * 2, h = grid.ys[r + 1] - grid.ys[r] - inset * 2;
      cells.push({ index: r * grid.cols + c, row: r, col: c, x, y, w, h, image: cropImage(img, x, y, w, h) });
    }
  }
  return cells;
}

/**
 * Full cell pipeline: border-line removal, alpha cleanup, trim. Returns
 * { image, offsetX, offsetY, empty } with the offset of the trimmed glyph inside the cell.
 */
export function processCell(cellImage, opts = {}) {
  const img = cloneImage(cellImage);
  if (opts.clearLines !== false) clearBorderLines(img, opts.lines || {});
  removeFaintNoise(img.data, img.width, img.height, opts.softEdge ?? 3, opts.cleanupOpts?.high ?? 160);
  if (opts.streaks !== false) removeThinStreaks(img.data, img.width, img.height, opts.cleanupOpts?.low ?? 24);
  const cleaned = opts.cleanup === false ? { image: img } : cleanupAlpha(img, opts.cleanupOpts || {});
  const empty = isMostlyEmpty(cleaned.image, opts.minPixels ?? 40);
  if (empty) return { image: null, offsetX: 0, offsetY: 0, empty: true };
  const t = trimImage(cleaned.image, 0, opts.pad ?? 1);
  return { image: t.image, offsetX: t.x, offsetY: t.y, empty: false };
}

/**
 * Remove faint noise: keep semi-transparent pixels only within `keepPx` of solid artwork (alpha ≥ solid),
 * which is where anti-aliased edges live. Works in place on RGBA data.
 */
export function removeFaintNoise(data, W, H, keepPx = 3, solid = 128) {
  const N = W * H;
  let near = new Uint8Array(N);
  for (let p = 0; p < N; p++) near[p] = data[p * 4 + 3] >= solid ? 1 : 0;
  for (let k = 0; k < keepPx; k++) {
    const next = new Uint8Array(near);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (near[p]) continue;
      if ((x > 0 && near[p - 1]) || (x < W - 1 && near[p + 1]) || (y > 0 && near[p - W]) || (y < H - 1 && near[p + W])) next[p] = 1;
    }
    near = next;
  }
  for (let p = 0; p < N; p++) if (!near[p] && data[p * 4 + 3]) { data[p * 4] = 0; data[p * 4 + 1] = 0; data[p * 4 + 2] = 0; data[p * 4 + 3] = 0; }
  return data;
}

/** Remove streaks and spurs thinner than 3 px (morphological opening of the visible mask). In place. */
export function removeThinStreaks(data, W, H, low = 24) {
  const N = W * H;
  const m = new Uint8Array(N);
  for (let p = 0; p < N; p++) m[p] = data[p * 4 + 3] > low ? 1 : 0;
  const pass = (src, keepIf) => {
    const out = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let all = 1, any = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        const v = X >= 0 && Y >= 0 && X < W && Y < H ? src[Y * W + X] : 0;
        all &= v; any |= v;
      }
      out[y * W + x] = keepIf === 'all' ? all : any;
    }
    return out;
  };
  const opened = pass(pass(m, 'all'), 'any');
  for (let p = 0; p < N; p++) if (m[p] && !opened[p]) { data[p * 4] = 0; data[p * 4 + 1] = 0; data[p * 4 + 2] = 0; data[p * 4 + 3] = 0; }
  return data;
}

/**
 * Shape-based extraction for a whole sheet: grid-line pixels are removed, connected shapes are found across
 * the sheet, and each shape belongs to the cell its centre falls in. Glyphs that cross a grid line keep all
 * of their artwork; parts of neighbours that reach into a cell are left out.
 * Returns cells [{ index, row, col, x, y, w, h, image, offsetX, offsetY, empty }] with offsets relative to the cell.
 */
export function extractGlyphs(img, grid, opts = {}) {
  const { low = 24, high = 160, minArea = 24, minRelative = 0.004, grayTol = 26, lineBand = 4, clearLines = true, softEdge = 3, streaks = true } = opts;
  const { width: W, height: H } = img;
  const N = W * H;
  const data = new Uint8ClampedArray(img.data);
  const colOf = new Int16Array(W).fill(-1), rowOf = new Int16Array(H).fill(-1);
  for (let x = 0; x < W; x++) for (let i = 0; i < grid.cols; i++) if (x >= grid.xs[i] && x < grid.xs[i + 1]) colOf[x] = i;
  for (let y = 0; y < H; y++) for (let i = 0; i < grid.rows; i++) if (y >= grid.ys[i] && y < grid.ys[i + 1]) rowOf[y] = i;
  const cellAt = (x, y) => (colOf[x] < 0 || rowOf[y] < 0 ? -1 : rowOf[y] * grid.cols + colOf[x]);
  // the grid-line zone: a band around every detected line (lineX/lineY = which line, or -1)
  const lineX = new Int32Array(W).fill(-1), lineY = new Int32Array(H).fill(-1);
  if (clearLines) {
    for (const gx of grid.xs) for (let x = Math.max(0, gx - lineBand); x <= Math.min(W - 1, gx + lineBand); x++) lineX[x] = gx;
    for (const gy of grid.ys) for (let y = Math.max(0, gy - lineBand); y <= Math.min(H - 1, gy + lineBand); y++) lineY[y] = gy;
  }
  const inZone = (p) => lineX[p % W] >= 0 || lineY[(p / W) | 0] >= 0;

  // 1. erase grid lines: grey pixels, thin see-through lines of any colour and the faint fringe inside the line zone
  if (clearLines) {
    const thin = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      if (!inZone(p)) continue;
      const x = p % W, y = (p / W) | 0;
      if (data[p * 4 + 3] < 230 && ((lineY[y] >= 0 && isRidge(img.data, W, H, x, y, 'y')) || (lineX[x] >= 0 && isRidge(img.data, W, H, x, y, 'x')))) thin[p] = 1;
    }
    for (let p = 0; p < N; p++) {
      if (!inZone(p)) continue;
      const i = p * 4;
      if (thin[p] || data[i + 3] <= 70 || isGrayish(data[i], data[i + 1], data[i + 2], grayTol)) data[i + 3] = 0;
    }
  }

  // faint noise far from any solid artwork (invisible specks and trails) would join shapes and stretch bounds
  removeFaintNoise(data, W, H, softEdge, high);
  if (streaks) removeThinStreaks(data, W, H, low);

  // 2. connected shapes over the whole sheet
  const mask = new Uint8Array(N);
  for (let p = 0; p < N; p++) mask[p] = data[p * 4 + 3] > low ? 1 : 0;
  const { labels, comps } = labelComponents(mask, W, H);
  let M = comps.length;
  const zoneCount = new Int32Array(M);
  for (let p = 0; p < N; p++) if (labels[p] >= 0 && inZone(p)) zoneCount[labels[p]]++;

  // 3. a shape lying mostly in the line zone is line debris
  const debris = new Uint8Array(M);
  for (let i = 0; i < M; i++) if (zoneCount[i] >= comps[i].area * 0.6) debris[i] = 1;

  // 4. a line drawn across a glyph cuts off a sliver: join slivers to the big shape directly across the line
  const parent = Int32Array.from({ length: M }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  if (clearLines) {
    const votes = new Map();
    const vote = (f, k) => {
      if (k < 0 || k === f || debris[k]) return;
      let m = votes.get(f); if (!m) { m = new Map(); votes.set(f, m); }
      m.set(k, (m.get(k) || 0) + 1);
    };
    for (let p = 0; p < N; p++) {
      const f = labels[p];
      if (f < 0 || debris[f]) continue;
      const x = p % W, y = (p / W) | 0;
      if (lineX[x] < 0 && x + 1 < W && lineX[x + 1] >= 0) { const gx = lineX[x + 1]; for (let d = gx + lineBand + 1; d <= Math.min(W - 1, gx + lineBand + 3); d++) vote(f, labels[y * W + d]); }
      if (lineX[x] < 0 && x - 1 >= 0 && lineX[x - 1] >= 0) { const gx = lineX[x - 1]; for (let d = gx - lineBand - 1; d >= Math.max(0, gx - lineBand - 3); d--) vote(f, labels[y * W + d]); }
      if (lineY[y] < 0 && y + 1 < H && lineY[y + 1] >= 0) { const gy = lineY[y + 1]; for (let d = gy + lineBand + 1; d <= Math.min(H - 1, gy + lineBand + 3); d++) vote(f, labels[d * W + x]); }
      if (lineY[y] < 0 && y - 1 >= 0 && lineY[y - 1] >= 0) { const gy = lineY[y - 1]; for (let d = gy - lineBand - 1; d >= Math.max(0, gy - lineBand - 3); d--) vote(f, labels[d * W + x]); }
    }
    for (const [f, m] of votes) {
      const [k, n] = [...m].sort((a, b) => b[1] - a[1])[0];
      // a sliver is much smaller than the glyph across the line and lines up with it along a good stretch
      if (comps[f].area * 4 < comps[k].area && n >= 6) parent[find(f)] = find(k);
    }
  }

  // 5. glyphs that touch a neighbour merge into one shape: split shapes with ≥ 20% of their pixels in two cells
  for (let p = 0; p < N; p++) if (labels[p] >= 0) labels[p] = find(labels[p]);
  const shares = new Map();
  for (let p = 0; p < N; p++) {
    const l = labels[p];
    if (l < 0 || debris[l]) continue;
    const k = cellAt(p % W, (p / W) | 0);
    let m = shares.get(l); if (!m) { m = new Map(); shares.set(l, m); }
    m.set(k, (m.get(k) || 0) + 1);
  }
  const split = new Set();
  for (const [l, m] of shares) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if ([...m].filter(([k, n]) => k >= 0 && n >= total * 0.2 && n >= 400).length >= 2) split.add(l);
  }
  if (split.size) {
    const parts = new Map();
    for (let p = 0; p < N; p++) {
      const l = labels[p];
      if (!split.has(l)) continue;
      const key = l + ':' + cellAt(p % W, (p / W) | 0);
      let ni = parts.get(key);
      if (ni === undefined) { ni = M++; parts.set(key, ni); }
      labels[p] = ni;
    }
  }

  // per-shape stats
  const area = new Int32Array(M), x0s = new Int32Array(M).fill(W), y0s = new Int32Array(M).fill(H), x1s = new Int32Array(M), y1s = new Int32Array(M);
  const sumX = new Float64Array(M), sumY = new Float64Array(M), solid = new Uint8Array(M), isDebris = new Uint8Array(M);
  for (let p = 0; p < N; p++) {
    const l = labels[p];
    if (l < 0) continue;
    const x = p % W, y = (p / W) | 0;
    area[l]++; sumX[l] += x; sumY[l] += y;
    if (x < x0s[l]) x0s[l] = x; if (x > x1s[l]) x1s[l] = x; if (y < y0s[l]) y0s[l] = y; if (y > y1s[l]) y1s[l] = y;
    if (data[p * 4 + 3] >= high) solid[l] = 1;
  }
  for (let i = 0; i < debris.length; i++) if (debris[i]) isDebris[i] = 1;

  // 6. assign shapes to cells by centre of mass
  const byCell = new Map();
  for (let i = 0; i < M; i++) {
    if (!area[i] || isDebris[i] || !solid[i] || area[i] < minArea) continue;
    const w = x1s[i] - x0s[i] + 1, h = y1s[i] - y0s[i] + 1;
    if ((w <= 6 && h > 30) || (h <= 6 && w > 30)) continue;
    const cell = cellAt(Math.round(sumX[i] / area[i]), Math.round(sumY[i] / area[i]));
    if (cell < 0) continue;
    if (!byCell.has(cell)) byCell.set(cell, []);
    byCell.get(cell).push(i);
  }

  // 7. build each glyph from its own shapes only
  const cells = [];
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
    const index = r * grid.cols + c;
    const cx = grid.xs[c], cy = grid.ys[r];
    const base = { index, row: r, col: c, x: cx, y: cy, w: grid.xs[c + 1] - cx, h: grid.ys[r + 1] - cy };
    let ids = byCell.get(index) || [];
    const largest = Math.max(0, ...ids.map((i) => area[i]));
    // tiny pieces and hairline dashes (leftovers of lines and halos) are not part of the glyph
    ids = ids.filter((i) => area[i] >= largest * minRelative && (area[i] >= largest * 0.05 || Math.min(x1s[i] - x0s[i], y1s[i] - y0s[i]) >= 4));
    if (!ids.length || largest < 40) { cells.push({ ...base, image: null, offsetX: 0, offsetY: 0, empty: true }); continue; }
    const keep = new Set(ids);
    let gx0 = W, gy0 = H, gx1 = 0, gy1 = 0;
    for (const i of ids) { gx0 = Math.min(gx0, x0s[i]); gy0 = Math.min(gy0, y0s[i]); gx1 = Math.max(gx1, x1s[i]); gy1 = Math.max(gy1, y1s[i]); }
    gx0 = Math.max(0, gx0 - 1); gy0 = Math.max(0, gy0 - 1); gx1 = Math.min(W - 1, gx1 + 1); gy1 = Math.min(H - 1, gy1 + 1);
    const gw = gx1 - gx0 + 1, gh = gy1 - gy0 + 1;
    const out = createImage(gw, gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const p = (gy0 + y) * W + (gx0 + x);
      if (!keep.has(labels[p])) continue;
      const si = p * 4, di = (y * gw + x) * 4;
      out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
    }
    cells.push({ ...base, image: out, offsetX: gx0 - cx, offsetY: gy0 - cy, empty: false, parts: opts.debug ? ids.map((i) => ({ area: area[i], x0: x0s[i], y0: y0s[i], x1: x1s[i], y1: y1s[i] })) : undefined });
  }
  return cells;
}

// ---------- pixel transforms ----------

export function flipImage(img, horizontal = true) {
  const { width: W, height: H, data } = img;
  const out = createImage(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = horizontal ? W - 1 - x : x, sy = horizontal ? y : H - 1 - y;
    const si = (sy * W + sx) * 4, di = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = data[si + k];
  }
  return out;
}

export function rotate90(img, clockwise = true) {
  const { width: W, height: H, data } = img;
  const out = createImage(H, W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = clockwise ? H - 1 - y : y, ny = clockwise ? x : W - 1 - x;
    const si = (y * W + x) * 4, di = (ny * H + nx) * 4;
    for (let k = 0; k < 4; k++) out.data[di + k] = data[si + k];
  }
  return out;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [Math.round(hue(p, q, h + 1 / 3) * 255), Math.round(hue(p, q, h) * 255), Math.round(hue(p, q, h - 1 / 3) * 255)];
}

/** Hue shift (degrees), saturation and lightness offsets (-1..1) applied in place to RGBA data. */
export function adjustHsl(data, hueDeg = 0, sat = 0, light = 0) {
  const dh = hueDeg / 360;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    let [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    h = (h + dh + 1) % 1;
    s = sat >= 0 ? s + (1 - s) * sat : s * (1 + sat);
    l = light >= 0 ? l + (1 - l) * light : l * (1 + light);
    const [r, g, b] = hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)));
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  return data;
}

/** Gradient map: luminance of each pixel picks a colour from stops [{pos 0..1, color [r,g,b]}]. */
export function gradientMap(data, stops, amount = 1) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let a = sorted[0], b = sorted[sorted.length - 1];
    for (let k = 0; k < sorted.length - 1; k++) if (t >= sorted[k].pos && t <= sorted[k + 1].pos) { a = sorted[k]; b = sorted[k + 1]; break; }
    const f = b.pos === a.pos ? 0 : Math.min(1, Math.max(0, (t - a.pos) / (b.pos - a.pos)));
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = a.color[c] + (b.color[c] - a.color[c]) * f;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const v = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (lut[v * 3 + c] - data[i + c]) * amount;
  }
  return data;
}

/** Downsample alpha to a size×size signature (aspect preserved, centred). */
export function alphaSignature(img, size = 24) {
  const { width: W, height: H, data } = img;
  const sig = new Float32Array(size * size);
  const scale = Math.max(W, H) / size;
  const ox = (size - W / scale) / 2, oy = (size - H / scale) / 2;
  const counts = new Float32Array(size * size);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(size - 1, Math.max(0, Math.floor(y / scale + oy)));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(size - 1, Math.max(0, Math.floor(x / scale + ox)));
      sig[sy * size + sx] += data[(y * W + x) * 4 + 3] / 255;
      counts[sy * size + sx]++;
    }
  }
  for (let k = 0; k < sig.length; k++) if (counts[k]) sig[k] /= counts[k];
  return { sig, aspect: W / H, size };
}

export function signatureDistance(a, b) {
  let d = 0;
  for (let k = 0; k < a.sig.length; k++) d += Math.abs(a.sig[k] - b.sig[k]);
  d /= a.sig.length;
  return d + Math.abs(Math.log(a.aspect / b.aspect)) * 0.25;
}

/**
 * Recolour one colour range only (e.g. the blue letter face) and leave everything else (a pink 3D base,
 * white highlights) untouched. Selected pixels take a colour from `stops` by their brightness, so shading is kept.
 * range: { hue (deg), width (deg, half-width), soft (deg falloff), minSat (0..1) }
 * stops: [{ pos 0..1 (perceived brightness), color [r,g,b] }]
 */
export function recolorRange(data, range, stops, amount = 1) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const lut = new Float32Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    let a = sorted[0], b = sorted[sorted.length - 1];
    if (t <= a.pos) b = a; else if (t >= b.pos) a = b;
    else for (let k = 0; k < sorted.length - 1; k++) if (t >= sorted[k].pos && t <= sorted[k + 1].pos) { a = sorted[k]; b = sorted[k + 1]; break; }
    const f = b.pos === a.pos ? 0 : (t - a.pos) / (b.pos - a.pos);
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = a.color[c] + (b.color[c] - a.color[c]) * f;
  }
  const { hue, width = 40, soft = 25, minSat = 0.15 } = range;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const [h] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    let d = Math.abs(h * 360 - hue); if (d > 180) d = 360 - d;
    let w = d <= width ? 1 : d >= width + soft ? 0 : 1 - (d - width) / soft;
    // colourfulness as chroma: HSL saturation is misleadingly high for near-white highlights
    const chroma = (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255;
    w *= Math.min(1, Math.max(0, (chroma - minSat) / 0.15));
    if (w <= 0) continue;
    w *= amount;
    // key on perceived brightness, not HSL lightness: saturated cyan and blue share 50% lightness
    const li = Math.round(Math.min(255, 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])) * 3;
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c] + (lut[li + c] - data[i + c]) * w;
  }
  return data;
}

/**
 * Flat background colour of a sheet (most common colour along the border), or null when the border is
 * transparent or not a single flat colour.
 */
export function detectBackground(img) {
  const { width: W, height: H, data } = img;
  const buckets = new Map();
  let total = 0, transparent = 0;
  const visit = (x, y) => {
    const i = (y * W + x) * 4;
    total++;
    if (data[i + 3] < 128) { transparent++; return; }
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  };
  for (let x = 0; x < W; x += 2) { visit(x, 0); visit(x, 1); visit(x, H - 1); visit(x, H - 2); }
  for (let y = 0; y < H; y += 2) { visit(0, y); visit(1, y); visit(W - 1, y); visit(W - 2, y); }
  if (transparent > total * 0.4) return null;
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  if (!best || best.n < total * 0.45) return null;
  const color = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  // a frame line drawn on the image edge is not a background: the colour must also fill a ring further in
  const d = Math.min(Math.floor(Math.min(W, H) / 8), Math.max(8, Math.round(Math.min(W, H) * 0.012)));
  let inner = 0, match = 0;
  const check = (x, y) => {
    const i = (y * W + x) * 4;
    inner++;
    if (data[i + 3] >= 128 && Math.abs(data[i] - color[0]) + Math.abs(data[i + 1] - color[1]) + Math.abs(data[i + 2] - color[2]) <= 60) match++;
  };
  for (let x = d; x < W - d; x += 2) { check(x, d); check(x, H - 1 - d); }
  for (let y = d; y < H - d; y += 2) { check(d, y); check(W - 1 - d, y); }
  return match >= inner * 0.45 ? color : null;
}

/**
 * Remove a flat background colour (chroma key). Pixels near the colour become transparent; edge pixels get
 * partial alpha and the background colour is un-mixed from them so no green or magenta fringe remains.
 */
export function removeBackgroundColor(img, color, { tolerance = 60, softness = 150 } = {}) {
  const out = cloneImage(img);
  const d = out.data;
  const [br, bg, bb] = color;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const dist = Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
    if (dist <= tolerance) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
    if (dist >= tolerance + softness) continue;
    const a = (dist - tolerance) / softness;
    // un-mix: observed = a·fg + (1 − a)·bg
    d[i] = Math.min(255, Math.max(0, (d[i] - (1 - a) * br) / a));
    d[i + 1] = Math.min(255, Math.max(0, (d[i + 1] - (1 - a) * bg) / a));
    d[i + 2] = Math.min(255, Math.max(0, (d[i + 2] - (1 - a) * bb) / a));
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  return out;
}
