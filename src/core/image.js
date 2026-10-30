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
 * Remove grid-line remnants in a band along the image border: rows/columns in the band
 * that are mostly covered, and low-saturation grey pixels (grid colour) inside the band.
 */
export function clearBorderLines(img, { band = 10, coverage = 0.4, grayTol = 26, alphaMin = 30 } = {}) {
  const { width: W, height: H, data } = img;
  const clearPx = (x, y) => { data[(y * W + x) * 4 + 3] = 0; };
  const rowCov = (y) => { let n = 0; for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > alphaMin) n++; return n / W; };
  const colCov = (x) => { let n = 0; for (let y = 0; y < H; y++) if (data[(y * W + x) * 4 + 3] > alphaMin) n++; return n / H; };
  const b = Math.min(band, Math.floor(Math.min(W, H) / 4));
  for (let i = 0; i < b; i++) {
    for (const y of [i, H - 1 - i]) if (rowCov(y) > coverage) for (let x = 0; x < W; x++) clearPx(x, y);
    for (const x of [i, W - 1 - i]) if (colCov(x) > coverage) for (let y = 0; y < H; y++) clearPx(x, y);
  }
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

function lineScoreProfile(img, axis, grayTol) {
  const { width: W, height: H, data } = img;
  const n = axis === 'x' ? W : H, m = axis === 'x' ? H : W;
  const gray = new Float32Array(n), content = new Float32Array(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, a = data[i + 3];
      const k = axis === 'x' ? x : y;
      content[k] += a / 255;
      if (a > 60 && isGrayish(data[i], data[i + 1], data[i + 2], grayTol)) gray[k] += 1;
    }
  }
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
  const cleaned = opts.cleanup === false ? { image: img } : cleanupAlpha(img, opts.cleanupOpts || {});
  const empty = isMostlyEmpty(cleaned.image, opts.minPixels ?? 40);
  if (empty) return { image: null, offsetX: 0, offsetY: 0, empty: true };
  const t = trimImage(cleaned.image, 0, opts.pad ?? 1);
  return { image: t.image, offsetX: t.x, offsetY: t.y, empty: false };
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
