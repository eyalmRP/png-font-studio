// Font model. Units are "font units" = glyph image pixels × glyph.scale; y grows downward in images,
// metrics are distances from the baseline (ascender/capHeight/xHeight up, descender down, all positive).
import { charCategory, CAP_REF, X_REF, ASC_REF, DESC_REF, SIZE_GROUPS, roundSides } from './charsets.js';
import { alphaSignature, signatureDistance } from './image.js';

let uid = 0;
export const newId = (p = 'id') => `${p}_${Date.now().toString(36)}${(uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function createFont(name = 'Untitled font') {
  return {
    id: newId('font'),
    name,
    family: name,
    variant: '',
    created: Date.now(),
    updated: Date.now(),
    metrics: { ascender: 160, capHeight: 160, xHeight: 115, descender: 45, lineGap: 0, overshoot: 2.4, overshootAuto: true, auto: true },
    spacing: { space: 45, tracking: 0, autoSpace: true },
    kerning: {},
    glyphs: new Map(),
    rev: 0,
  };
}

export function createGlyph(char, image, extra = {}) {
  return {
    id: newId('g'),
    char,
    image, // { width, height, data } or null for an empty slot
    lsb: 0,
    rsb: 0,
    baseline: image ? image.height : 0, // pixels from image top down to the baseline
    scale: 1,
    autoBaseline: true,
    rev: 0,
    ...extra,
  };
}

/** Drawn width in font units (image width × scale × horizontal stretch). */
export function glyphWidth(g) { return g.image ? g.image.width * g.scale * (g.sx || 1) : 0; }

export function glyphSize(g) {
  if (!g.image) return { w: 0, h: 0 };
  return { w: glyphWidth(g), h: g.image.height * g.scale };
}

/** Advance width in font units. */
export function glyphAdvance(font, g) {
  if (!g || !g.image) return font.spacing.space;
  return g.lsb + glyphWidth(g) + g.rsb;
}

/** Top of the glyph above the baseline (font units). */
export function glyphTop(g) { return g.baseline * g.scale; }
/** Bottom of the glyph below the baseline (font units; positive = below). */
export function glyphBottom(g) { return (g.image ? g.image.height - g.baseline : 0) * g.scale; }

export function touch(font, g) {
  if (g) g.rev++;
  font.rev++;
  font.updated = Date.now();
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Measure cap height and x-height from flat reference glyphs, and the overshoot of round capitals. */
export function measureFont(font) {
  const h = (ch) => { const g = font.glyphs.get(ch); return g && g.image ? g.image.height * g.scale : null; };
  const pick = (refs) => refs.map(h).filter((v) => v);
  let capHeight = median(pick(CAP_REF));
  let xHeight = median(pick(X_REF));
  const xs = [...'acemnorsuvwxz'].map((c) => font.glyphs.get(c)).filter((g) => g && g.image);
  if (xs.length >= 5) {
    // optical x-height: round letters count without their overshoot
    const capGuess = median(pick(CAP_REF)) || 1;
    const osGuess = capGuess * 0.015;
    xHeight = median(xs.map((g) => { const sd = roundSides(g.char, g.round); return g.image.height * g.scale - (sd === 'both' ? 2 : sd ? 1 : 0) * osGuess; }));
  }
  const all = [...font.glyphs.values()].filter((g) => g.image && charCategory(g.char) === 'base').map((g) => g.image.height * g.scale);
  if (!capHeight) capHeight = median(all) || 160;
  if (!xHeight) xHeight = Math.round(capHeight * 0.72);
  // overshoot per side, measured on round capitals against the flat cap height
  const rounds = pick([...'OCGQS']).map((v) => (v - capHeight) / 2).filter((v) => v > 0);
  let overshoot = median(rounds);
  if (overshoot === null) overshoot = capHeight * 0.015;
  overshoot = Math.min(capHeight * 0.035, Math.max(capHeight * 0.008, overshoot));
  return { capHeight: Math.round(capHeight), xHeight: Math.round(xHeight), overshoot: +overshoot.toFixed(2) };
}

/** Overshoot (per side, font units) for a group whose flat height is flatH. */
function groupOvershoot(font, flatH) {
  const os = font.metrics.overshoot ?? font.metrics.capHeight * 0.015;
  return os * (flatH / Math.max(1, font.metrics.capHeight));
}

/**
 * Even out glyph sizes inside each size group. The target is the median height of the group's flat glyphs;
 * round glyphs target that height plus their optical overshoot. Glyphs further than `tolerance` from their
 * target get a scale that brings them to it. Only glyph.scale changes; pixels stay untouched.
 * Returns the list of changes [{ char, from, to }].
 */
export function normalizeSizes(font, { tolerance = 0.035, groups = SIZE_GROUPS, reset = true } = {}) {
  const changes = [];
  if (font.metrics.overshootAuto !== false) {
    // measure on unscaled glyphs so earlier normalisation does not hide the natural overshoot
    if (reset) for (const g of font.glyphs.values()) if (g.autoScale) g.scale = 1;
    font.metrics.overshoot = measureFont(font).overshoot;
  }
  for (const grp of groups) {
    const gs = grp.chars.map((c) => font.glyphs.get(c)).filter((g) => g && g.image);
    if (gs.length < 3) continue;
    if (reset) for (const g of gs) if (g.autoScale) g.scale = 1;
    // optical height: a round glyph's height without its overshoot; the group target is their median
    const osCap = font.metrics.overshoot ?? font.metrics.capHeight * 0.015;
    const extra = (g, flatGuess) => {
      if (grp.id === 'descender') return 0;
      const side = roundSides(g.char, g.round);
      const o = osCap * (flatGuess / Math.max(1, font.metrics.capHeight || flatGuess));
      return side === 'both' ? 2 * o : side ? o : 0;
    };
    const rough = median(gs.map((g) => g.image.height * g.scale));
    const flatH = median(gs.map((g) => g.image.height * g.scale - extra(g, rough)));
    const os = groupOvershoot(font, flatH);
    for (const g of gs) {
      const side = roundSides(g.char, g.round);
      // descenders keep their own length; only round tops count for them
      const target = grp.id === 'descender' ? flatH : flatH + (side === 'both' ? 2 * os : side ? os : 0);
      void side;
      const hgt = g.image.height * g.scale;
      if (Math.abs(hgt / target - 1) > tolerance) {
        const from = g.scale;
        g.scale = +(target / g.image.height).toFixed(4);
        g.autoScale = true;
        g.rev++;
        changes.push({ char: g.char, from, to: g.scale });
      }
    }
  }
  touch(font);
  return changes;
}

/** Place every auto-baseline glyph according to its category and roundness, then derive font metrics. */
export function autoMetrics(font, { force = false } = {}) {
  const { capHeight, xHeight, overshoot } = measureFont(font);
  if (font.metrics.overshootAuto !== false) font.metrics.overshoot = overshoot;
  const os = font.metrics.overshoot ?? overshoot;
  const G = (ch) => font.glyphs.get(ch);
  const H = (ch) => { const g = G(ch); return g && g.image ? g.image.height * g.scale : null; };
  const mathAxis = xHeight * 0.5;
  const digitFlat = median([...'1247'].map(H).filter((v) => v)) || capHeight;
  const flatFor = (ch) => {
    if (/[A-Z]/.test(ch)) return capHeight;
    if (/[0-9]/.test(ch)) return digitFlat;
    if (/[a-z]/.test(ch)) return 'bdfhklt'.includes(ch) ? null : xHeight;
    return capHeight;
  };
  for (const g of font.glyphs.values()) {
    if (!g.image || (!g.autoBaseline && !force)) continue;
    const h = g.image.height * g.scale;
    const side = roundSides(g.char, g.round);
    const flatH = flatFor(g.char);
    const osG = flatH ? os * (flatH / capHeight) : os;
    // how far a round glyph dips below the baseline
    let below = 0;
    if (side && flatH) {
      const excess = Math.max(0, h - flatH);
      if (side === 'both') below = Math.min(excess / 2, osG * 2);
      else if (side === 'bottom') below = Math.min(excess, osG * 2);
    } else if (side === 'bottom' || side === 'both') below = Math.min(osG, h * 0.05);
    let top; // font units above the baseline of the image top
    switch (charCategory(g.char)) {
      case 'desc': top = xHeight + (side === 'top' || side === 'both' ? os * (xHeight / capHeight) : 0); break;
      case 'j': top = H('i') || xHeight * 1.3; break;
      case 'comma': top = H('.') || xHeight * 0.3; break;
      case 'semi': top = H(':') || xHeight; break;
      case 'cap': top = capHeight; break;
      case 'math': top = mathAxis + h / 2; break;
      case 'center': top = capHeight / 2 + h / 2; break;
      case 'under': top = -capHeight * 0.015; break;
      case 'base-desc': top = Math.min(h, capHeight); break;
      default: top = h - below;
    }
    g.baseline = top / g.scale;
    if (force) g.autoBaseline = true;
  }
  if (font.metrics.auto || force) {
    const asc = ASC_REF.map((c) => G(c)).filter((g) => g && g.image).map(glyphTop);
    const desc = DESC_REF.map((c) => G(c)).filter((g) => g && g.image).map(glyphBottom);
    font.metrics.capHeight = capHeight;
    font.metrics.xHeight = xHeight;
    font.metrics.ascender = Math.round(Math.max(capHeight, median(asc) || capHeight));
    font.metrics.descender = Math.round(median(desc) || capHeight * 0.25);
    font.metrics.auto = true;
  }
  if (font.spacing.autoSpace || force) font.spacing.space = Math.round(capHeight * 0.3);
  touch(font);
  return font;
}

export function unitsPerEm(font) {
  const m = font.metrics;
  return Math.max(1, m.ascender + m.descender);
}

// ---------- optical kerning ----------

const BANDS = 48;
const profileCache = new WeakMap();

/** Horizontal ink profiles across BANDS bands spanning descender..ascender (font units). */
export function glyphProfile(font, g) {
  const key = `${g.rev}:${font.metrics.ascender}:${font.metrics.descender}:${g.lsb}:${g.rsb}:${g.scale}:${g.sx || 1}:${g.baseline}`;
  const hit = profileCache.get(g);
  if (hit && hit.key === key) return hit;
  const left = new Float32Array(BANDS).fill(Infinity), right = new Float32Array(BANDS).fill(Infinity);
  const img = g.image;
  if (img) {
    const top = font.metrics.ascender * 1.15, bottom = -font.metrics.descender * 1.15, span = top - bottom;
    const { width: W, height: Hh, data } = img;
    const adv = glyphAdvance(font, g);
    for (let y = 0; y < Hh; y++) {
      const yUnits = (g.baseline - y - 0.5) * g.scale; // above baseline
      const b = Math.floor(((top - yUnits) / span) * BANDS);
      if (b < 0 || b >= BANDS) continue;
      let x0 = -1, x1 = -1;
      for (let x = 0; x < W; x++) if (data[(y * W + x) * 4 + 3] > 96) { x0 = x; break; }
      if (x0 < 0) continue;
      for (let x = W - 1; x >= 0; x--) if (data[(y * W + x) * 4 + 3] > 96) { x1 = x; break; }
      const hs = g.scale * (g.sx || 1);
      const l = g.lsb + x0 * hs, r = adv - (g.lsb + (x1 + 1) * hs);
      if (l < left[b]) left[b] = l;
      if (r < right[b]) right[b] = r;
    }
  }
  const prof = { key, left, right };
  profileCache.set(g, prof);
  return prof;
}

function pairGap(font, a, b) {
  const pa = glyphProfile(font, a), pb = glyphProfile(font, b);
  let gap = Infinity;
  for (let i = 0; i < BANDS; i++) {
    if (pa.right[i] === Infinity) continue;
    for (let d = -2; d <= 2; d++) {
      const j = i + d;
      if (j < 0 || j >= BANDS || pb.left[j] === Infinity) continue;
      const v = pa.right[i] + pb.left[j] + Math.abs(d) * (unitsPerEm(font) / BANDS) * 0.9;
      if (v < gap) gap = v;
    }
  }
  return gap;
}

const opticalCache = new Map();
/** Optical kerning in font units for the pair (a, b), relative to the H–H reference gap. */
export function opticalKern(font, a, b) {
  if (!a || !b || !a.image || !b.image) return 0;
  const key = `${font.id}:${font.rev}:${a.id}:${a.rev}:${b.id}:${b.rev}`;
  if (opticalCache.has(key)) return opticalCache.get(key);
  if (opticalCache.size > 20000) opticalCache.clear();
  const ref = font.glyphs.get('H') || font.glyphs.get('n') || a;
  const target = Math.max(0, pairGap(font, ref, ref));
  const gap = pairGap(font, a, b);
  let k = gap === Infinity ? 0 : target - gap;
  const minW = Math.min(glyphWidth(a), glyphWidth(b));
  k = Math.max(-minW * 0.45, Math.min(font.metrics.capHeight * 0.15, k));
  k = Math.round(k * 0.85);
  opticalCache.set(key, k);
  return k;
}

export function metricKern(font, a, b) {
  return font.kerning[a + b] || 0;
}

// ---------- shape matching (no AI: alpha silhouettes compared pixel by pixel) ----------

const sigCache = new WeakMap();
export function glyphSignature(g) {
  const hit = sigCache.get(g);
  if (hit && hit.rev === g.rev) return hit.sig;
  const sig = alphaSignature(g.image);
  sigCache.set(g, { rev: g.rev, sig });
  return sig;
}

/** Best k reference characters for an image. */
export function suggestChars(image, refFont, k = 3) {
  const s = alphaSignature(image);
  const scored = [];
  for (const g of refFont.glyphs.values()) {
    if (!g.image) continue;
    scored.push({ char: g.char, d: signatureDistance(s, glyphSignature(g)) });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, k);
}

/** Rank layout presets for a list of processed cell images (null = empty) against a reference font. */
export function rankLayouts(cellImages, refFont, layouts) {
  const sigs = cellImages.map((img) => (img ? alphaSignature(img) : null));
  const res = [];
  for (const L of layouts) {
    let total = 0, n = 0;
    L.chars.forEach((ch, i) => {
      const g = refFont.glyphs.get(ch);
      if (!sigs[i] || !g || !g.image) return;
      total += signatureDistance(sigs[i], glyphSignature(g)); n++;
    });
    if (n) res.push({ layout: L, score: total / n, compared: n });
  }
  return res.sort((a, b) => a.score - b.score);
}

// ---------- editing helpers ----------

export function setGlyph(font, char, image, extra = {}) {
  const prev = font.glyphs.get(char);
  const g = createGlyph(char, image, extra);
  if (prev) { g.id = prev.id; g.rev = prev.rev + 1; }
  font.glyphs.set(char, g);
  touch(font, g);
  return g;
}

export function remapGlyph(font, from, to, { swap = true } = {}) {
  const g = font.glyphs.get(from);
  if (!g || from === to) return false;
  const other = font.glyphs.get(to);
  font.glyphs.delete(from);
  g.char = to; touch(font, g);
  font.glyphs.set(to, g);
  if (other) {
    if (swap) { other.char = from; touch(font, other); font.glyphs.set(from, other); }
  }
  return true;
}

export function duplicateGlyph(font, from, to) {
  const g = font.glyphs.get(from);
  if (!g) return null;
  const img = g.image ? { width: g.image.width, height: g.image.height, data: new Uint8ClampedArray(g.image.data) } : null;
  const copy = { ...g, id: newId('g'), char: to, image: img, rev: 0 };
  font.glyphs.set(to, copy);
  touch(font, copy);
  return copy;
}

export function sortedChars(font) {
  return [...font.glyphs.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
}

export function cloneFont(font, name) {
  const f = { ...font, id: newId('font'), name: name || `${font.name} copy`, metrics: { ...font.metrics }, spacing: { ...font.spacing }, kerning: { ...font.kerning }, glyphs: new Map(), created: Date.now(), updated: Date.now(), rev: 0 };
  for (const [ch, g] of font.glyphs) {
    f.glyphs.set(ch, { ...g, id: newId('g'), image: g.image ? { width: g.image.width, height: g.image.height, data: new Uint8ClampedArray(g.image.data) } : null, rev: 0 });
  }
  return f;
}

/** Serialisable description (images are referenced by file name; the caller stores the PNG bytes). */
export function fontToJSON(font) {
  const glyphs = [];
  for (const g of font.glyphs.values()) {
    glyphs.push({
      char: g.char,
      file: g.image ? `glyphs/${[...g.char].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('_')}.png` : null,
      w: g.image ? g.image.width : 0,
      h: g.image ? g.image.height : 0,
      lsb: g.lsb, rsb: g.rsb, baseline: +g.baseline.toFixed(3), scale: g.scale, sx: g.sx || 1, autoSx: !!g.autoSx, autoBaseline: g.autoBaseline, autoScale: !!g.autoScale, round: g.round ?? null,
    });
  }
  return {
    format: 'png-font-studio/font', version: 1,
    id: font.id, name: font.name, family: font.family, variant: font.variant,
    created: font.created, updated: font.updated,
    metrics: { ...font.metrics }, spacing: { ...font.spacing }, kerning: { ...font.kerning },
    glyphs,
  };
}

/** Rebuild a font from JSON plus a map of file name → decoded image. */
export function fontFromJSON(json, images) {
  const font = createFont(json.name);
  Object.assign(font, {
    id: json.id || font.id, family: json.family || json.name, variant: json.variant || '',
    created: json.created || Date.now(), updated: json.updated || Date.now(),
    metrics: { ...font.metrics, ...json.metrics }, spacing: { ...font.spacing, ...json.spacing }, kerning: { ...(json.kerning || {}) },
  });
  for (const gj of json.glyphs || []) {
    const image = gj.file ? images.get(gj.file) || null : null;
    const g = createGlyph(gj.char, image, { lsb: gj.lsb || 0, rsb: gj.rsb || 0, baseline: gj.baseline ?? (image ? image.height : 0), scale: gj.scale || 1, autoBaseline: gj.autoBaseline !== false, autoScale: !!gj.autoScale, round: gj.round ?? null, sx: gj.sx || 1, autoSx: !!gj.autoSx });
    font.glyphs.set(gj.char, g);
  }
  return font;
}
