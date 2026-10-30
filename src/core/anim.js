// Per-unit (character / word / line / whole layer) animation presets built from keyframes.
// A preset maps progress t ∈ [0, 1] to a transform. "In" presets go from the hidden state (t = 0)
// to rest (t = 1); "out" presets go from rest (t = 0) to gone (t = 1). Loops are periodic.

export const REST = Object.freeze({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, opacity: 1, blur: 0, skew: 0, hue: 0, clip: 1, bright: 0 });
const PROPS = Object.keys(REST);

// ---------- easing ----------
const c1 = 1.70158, c3 = c1 + 1;
export const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inCubic: (t) => t ** 3,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outQuint: (t) => 1 - (1 - t) ** 5,
  inExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  inBack: (t) => c3 * t ** 3 - c1 * t * t,
  outBack: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  step: (t) => (t < 1 ? 0 : 1),
};

// deterministic per-unit random in [-1, 1]
export function rand(seed, i, salt = 0) {
  let x = Math.sin((i + 1) * 12.9898 + seed * 78.233 + salt * 37.719) * 43758.5453;
  x -= Math.floor(x);
  return x * 2 - 1;
}

// ---------- presets ----------
// keys: [{ t, ...props, ease }] — ease applies to the segment ending at that key.
// Values may be ['rand', min, max] (per unit) and distances are in em (font size).
const R = (min, max) => ['rand', min, max];

export const IN_PRESETS = {
  // cute
  popBounce: { cat: 'cute', unit: 'char', stagger: 0.04, duration: 0.6, keys: [{ t: 0, sx: 0, sy: 0, opacity: 0 }, { t: 0.55, sx: 1.25, sy: 1.25, opacity: 1, ease: 'outCubic' }, { t: 0.78, sx: 0.9, sy: 0.9, ease: 'inOutQuad' }, { t: 1, sx: 1, sy: 1, ease: 'outQuad' }] },
  jellyDrop: { cat: 'cute', unit: 'char', pivot: 'bottom', stagger: 0.05, duration: 0.8, keys: [{ t: 0, dy: -1.6, sx: 0.8, sy: 1.3, opacity: 0 }, { t: 0.45, dy: 0, sx: 0.8, sy: 1.3, opacity: 1, ease: 'inQuad' }, { t: 0.6, sx: 1.35, sy: 0.65, ease: 'outQuad' }, { t: 0.78, sx: 0.88, sy: 1.12, ease: 'inOutQuad' }, { t: 0.9, sx: 1.06, sy: 0.95, ease: 'inOutQuad' }, { t: 1, sx: 1, sy: 1, ease: 'outQuad' }] },
  bubbleRise: { cat: 'cute', unit: 'char', stagger: 0.06, duration: 0.9, keys: [{ t: 0, dy: 0.9, sx: 0.2, sy: 0.2, opacity: 0, dx: R(-0.15, 0.15) }, { t: 0.7, dy: -0.12, sx: 1.08, sy: 1.08, opacity: 1, dx: 0, ease: 'outCubic' }, { t: 1, dy: 0, sx: 1, sy: 1, ease: 'inOutQuad' }] },
  hopIn: { cat: 'cute', unit: 'char', pivot: 'bottom', stagger: 0.05, duration: 0.55, keys: [{ t: 0, dy: 0.6, opacity: 0, rot: -12 }, { t: 0.5, dy: -0.35, opacity: 1, rot: 6, ease: 'outQuad' }, { t: 1, dy: 0, rot: 0, ease: 'outBounce' }] },
  wiggleIn: { cat: 'cute', unit: 'char', stagger: 0.04, duration: 0.7, keys: [{ t: 0, sx: 0.3, sy: 0.3, rot: -30, opacity: 0 }, { t: 0.35, sx: 1.1, sy: 1.1, rot: 18, opacity: 1, ease: 'outQuad' }, { t: 0.6, rot: -10, ease: 'inOutQuad' }, { t: 0.8, rot: 5, sx: 1, sy: 1, ease: 'inOutQuad' }, { t: 1, rot: 0, ease: 'inOutQuad' }] },
  heartbeat: { cat: 'cute', unit: 'char', stagger: 0.03, duration: 0.7, keys: [{ t: 0, sx: 0, sy: 0, opacity: 0 }, { t: 0.3, sx: 1.2, sy: 1.2, opacity: 1, ease: 'outQuad' }, { t: 0.45, sx: 0.95, sy: 0.95 }, { t: 0.6, sx: 1.12, sy: 1.12 }, { t: 1, sx: 1, sy: 1, ease: 'outCubic' }] },
  // cartoony
  squashDrop: { cat: 'cartoon', unit: 'char', pivot: 'bottom', stagger: 0.07, duration: 0.75, keys: [{ t: 0, dy: -3, sy: 1.5, sx: 0.7, opacity: 1 }, { t: 0.5, dy: 0, sy: 1.5, sx: 0.7, ease: 'inQuad' }, { t: 0.62, sy: 0.55, sx: 1.4, ease: 'outQuad' }, { t: 0.8, sy: 1.15, sx: 0.9, dy: -0.15, ease: 'outQuad' }, { t: 1, sy: 1, sx: 1, dy: 0, ease: 'outBounce' }] },
  rubberBand: { cat: 'cartoon', unit: 'char', pivot: 'bottom', stagger: 0.03, duration: 0.9, keys: [{ t: 0, sx: 0, sy: 1, opacity: 0 }, { t: 0.3, sx: 1.4, sy: 0.7, opacity: 1, ease: 'outQuad' }, { t: 0.45, sx: 0.75, sy: 1.25 }, { t: 0.6, sx: 1.15, sy: 0.85 }, { t: 0.75, sx: 0.95, sy: 1.05 }, { t: 1, sx: 1, sy: 1, ease: 'outQuad' }] },
  spinPop: { cat: 'cartoon', unit: 'char', stagger: 0.05, duration: 0.7, keys: [{ t: 0, sx: 0, sy: 0, rot: -360, opacity: 0 }, { t: 0.75, sx: 1.2, sy: 1.2, rot: 10, opacity: 1, ease: 'outCubic' }, { t: 1, sx: 1, sy: 1, rot: 0, ease: 'outBack' }] },
  slamIn: { cat: 'cartoon', unit: 'char', stagger: 0.06, duration: 0.5, keys: [{ t: 0, sx: 4, sy: 4, opacity: 0, blur: 0.08 }, { t: 0.6, sx: 0.85, sy: 0.85, opacity: 1, blur: 0, ease: 'inQuad' }, { t: 1, sx: 1, sy: 1, ease: 'outBack' }] },
  boing: { cat: 'cartoon', unit: 'char', pivot: 'bottom', stagger: 0.04, duration: 1, keys: [{ t: 0, dy: 1.2, sy: 0.3, opacity: 0 }, { t: 0.3, dy: -0.6, sy: 1.4, sx: 0.8, opacity: 1, ease: 'outQuad' }, { t: 0.55, dy: 0, sy: 0.75, sx: 1.2, ease: 'inQuad' }, { t: 0.75, dy: -0.15, sy: 1.08, sx: 0.95, ease: 'outQuad' }, { t: 1, dy: 0, sy: 1, sx: 1, ease: 'outBounce' }] },
  tumbleIn: { cat: 'cartoon', unit: 'char', stagger: 0.05, duration: 0.8, keys: [{ t: 0, dx: R(-2, 2), dy: -2.5, rot: R(-200, 200), opacity: 0 }, { t: 0.7, dx: 0, dy: 0.05, rot: 8, opacity: 1, ease: 'inQuad' }, { t: 1, dy: 0, rot: 0, ease: 'outBounce' }] },
  // professional
  fadeUp: { cat: 'pro', unit: 'char', stagger: 0.025, duration: 0.6, keys: [{ t: 0, dy: 0.35, opacity: 0 }, { t: 1, dy: 0, opacity: 1, ease: 'outCubic' }] },
  slideIn: { cat: 'pro', unit: 'word', stagger: 0.08, duration: 0.7, keys: [{ t: 0, dx: -1.2, opacity: 0 }, { t: 1, dx: 0, opacity: 1, ease: 'outExpo' }] },
  blurIn: { cat: 'pro', unit: 'char', stagger: 0.03, duration: 0.8, keys: [{ t: 0, opacity: 0, blur: 0.12, sx: 1.15, sy: 1.15 }, { t: 1, opacity: 1, blur: 0, sx: 1, sy: 1, ease: 'outCubic' }] },
  trackingIn: { cat: 'pro', unit: 'char', stagger: 0, duration: 1, spread: 1.2, keys: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1, ease: 'outCubic' }] },
  wipeReveal: { cat: 'pro', unit: 'char', stagger: 0.03, duration: 0.45, keys: [{ t: 0, clip: 0 }, { t: 1, clip: 1, ease: 'outCubic' }] },
  maskRise: { cat: 'pro', unit: 'line', stagger: 0.12, duration: 0.8, keys: [{ t: 0, dy: 0.9, opacity: 0 }, { t: 1, dy: 0, opacity: 1, ease: 'outExpo' }] },
  typewriter: { cat: 'pro', unit: 'char', stagger: 0.06, duration: 0.01, keys: [{ t: 0, opacity: 0 }, { t: 1, opacity: 1, ease: 'step' }] },
  zoomOutIn: { cat: 'pro', unit: 'all', stagger: 0, duration: 0.9, keys: [{ t: 0, sx: 1.6, sy: 1.6, opacity: 0, blur: 0.05 }, { t: 1, sx: 1, sy: 1, opacity: 1, blur: 0, ease: 'outExpo' }] },
  flipIn: { cat: 'pro', unit: 'char', stagger: 0.04, duration: 0.6, keys: [{ t: 0, sy: 0, opacity: 0 }, { t: 1, sy: 1, opacity: 1, ease: 'outBack' }] },
  // fun
  scatterIn: { cat: 'fun', unit: 'char', stagger: 0.015, duration: 1, keys: [{ t: 0, dx: R(-4, 4), dy: R(-3, 3), rot: R(-180, 180), sx: 0.4, sy: 0.4, opacity: 0 }, { t: 1, dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, opacity: 1, ease: 'outExpo' }] },
  waveIn: { cat: 'fun', unit: 'char', stagger: 0.05, duration: 0.6, keys: [{ t: 0, dy: 1, opacity: 0 }, { t: 0.6, dy: -0.25, opacity: 1, ease: 'outQuad' }, { t: 1, dy: 0, ease: 'inOutQuad' }] },
  rainbowPop: { cat: 'fun', unit: 'char', stagger: 0.05, duration: 0.8, keys: [{ t: 0, sx: 0, sy: 0, hue: 180, opacity: 0 }, { t: 0.6, sx: 1.2, sy: 1.2, hue: 60, opacity: 1, ease: 'outCubic' }, { t: 1, sx: 1, sy: 1, hue: 0, ease: 'outQuad' }] },
  swingIn: { cat: 'fun', unit: 'char', stagger: 0.06, duration: 0.9, pivot: 'top', keys: [{ t: 0, rot: -90, opacity: 0 }, { t: 0.5, rot: 25, opacity: 1, ease: 'outQuad' }, { t: 0.75, rot: -10, ease: 'inOutQuad' }, { t: 1, rot: 0, ease: 'inOutQuad' }] },
};

export const OUT_PRESETS = {
  popOut: { cat: 'cute', unit: 'char', stagger: 0.03, duration: 0.45, keys: [{ t: 0 }, { t: 0.35, sx: 1.25, sy: 1.25, ease: 'outQuad' }, { t: 1, sx: 0, sy: 0, opacity: 0, ease: 'inBack' }] },
  floatAway: { cat: 'cute', unit: 'char', stagger: 0.05, duration: 0.9, keys: [{ t: 0 }, { t: 1, dy: -1.6, dx: R(-0.3, 0.3), sx: 0.5, sy: 0.5, opacity: 0, ease: 'inCubic' }] },
  shrinkWiggle: { cat: 'cute', unit: 'char', stagger: 0.03, duration: 0.6, keys: [{ t: 0 }, { t: 0.3, rot: 15, ease: 'inOutQuad' }, { t: 0.55, rot: -15, sx: 0.8, sy: 0.8 }, { t: 1, rot: 0, sx: 0, sy: 0, opacity: 0, ease: 'inQuad' }] },
  fallDown: { cat: 'cartoon', unit: 'char', stagger: 0.04, duration: 0.9, keys: [{ t: 0 }, { t: 0.2, dy: -0.25, rot: R(-10, 10), ease: 'outQuad' }, { t: 1, dy: 4, rot: R(-120, 120), opacity: 0, ease: 'inQuad' }] },
  squashOut: { cat: 'cartoon', unit: 'char', pivot: 'bottom', stagger: 0.04, duration: 0.6, keys: [{ t: 0 }, { t: 0.35, sx: 1.4, sy: 0.5, ease: 'outQuad' }, { t: 0.55, sx: 0.7, sy: 1.5, dy: -0.4, ease: 'outQuad' }, { t: 1, dy: -3, sx: 0.4, sy: 1.8, opacity: 0, ease: 'inQuad' }] },
  explode: { cat: 'cartoon', unit: 'char', stagger: 0, duration: 0.8, keys: [{ t: 0 }, { t: 1, dx: R(-5, 5), dy: R(-4, 4), rot: R(-360, 360), sx: 1.6, sy: 1.6, opacity: 0, ease: 'outCubic' }] },
  fadeDown: { cat: 'pro', unit: 'char', stagger: 0.02, duration: 0.5, keys: [{ t: 0 }, { t: 1, dy: 0.3, opacity: 0, ease: 'inCubic' }] },
  slideOut: { cat: 'pro', unit: 'word', stagger: 0.06, duration: 0.6, keys: [{ t: 0 }, { t: 1, dx: 1.2, opacity: 0, ease: 'inExpo' }] },
  blurOut: { cat: 'pro', unit: 'char', stagger: 0.02, duration: 0.6, keys: [{ t: 0 }, { t: 1, opacity: 0, blur: 0.12, sx: 0.9, sy: 0.9, ease: 'inCubic' }] },
  wipeHide: { cat: 'pro', unit: 'char', stagger: 0.02, duration: 0.4, keys: [{ t: 0 }, { t: 1, clip: 0, ease: 'inCubic' }] },
  zoomAway: { cat: 'pro', unit: 'all', stagger: 0, duration: 0.7, keys: [{ t: 0 }, { t: 1, sx: 0.6, sy: 0.6, opacity: 0, ease: 'inCubic' }] },
  typeBack: { cat: 'pro', unit: 'char', stagger: 0.04, duration: 0.01, order: 'backward', keys: [{ t: 0 }, { t: 1, opacity: 0, ease: 'step' }] },
  scatterOut: { cat: 'fun', unit: 'char', stagger: 0.01, duration: 0.9, keys: [{ t: 0 }, { t: 1, dx: R(-4, 4), dy: R(-3, 3), rot: R(-180, 180), sx: 0.3, sy: 0.3, opacity: 0, ease: 'inExpo' }] },
  spinOut: { cat: 'fun', unit: 'char', stagger: 0.04, duration: 0.6, keys: [{ t: 0 }, { t: 1, rot: 360, sx: 0, sy: 0, opacity: 0, ease: 'inBack' }] },
};

// loops: functions of (phase seconds, unit index, unit count, params) → partial transform
export const LOOP_PRESETS = {
  wave: { cat: 'fun', unit: 'char', fn: (t, i, n, p) => ({ dy: Math.sin(t * Math.PI * 2 / p.period - i * 0.5) * 0.12 * p.amount }) },
  float: { cat: 'cute', unit: 'all', fn: (t, i, n, p) => ({ dy: Math.sin(t * Math.PI * 2 / p.period) * 0.08 * p.amount }) },
  bob: { cat: 'cute', unit: 'char', fn: (t, i, n, p) => ({ dy: -Math.abs(Math.sin(t * Math.PI * 2 / p.period + i * 0.6)) * 0.15 * p.amount }) },
  jiggle: { cat: 'cartoon', unit: 'char', fn: (t, i, n, p) => ({ rot: Math.sin(t * Math.PI * 2 / p.period * 2 + i * 1.7) * 6 * p.amount }) },
  pulse: { cat: 'cute', unit: 'all', fn: (t, i, n, p) => { const s = 1 + Math.sin(t * Math.PI * 2 / p.period) * 0.05 * p.amount; return { sx: s, sy: s }; } },
  heartbeat: { cat: 'cute', unit: 'char', fn: (t, i, n, p) => { const ph = ((t / p.period) % 1 + 1) % 1; const b = ph < 0.15 ? Math.sin(ph / 0.15 * Math.PI) : ph > 0.25 && ph < 0.4 ? Math.sin((ph - 0.25) / 0.15 * Math.PI) * 0.6 : 0; const s = 1 + b * 0.1 * p.amount; return { sx: s, sy: s }; } },
  swing: { cat: 'fun', unit: 'all', fn: (t, i, n, p) => ({ rot: Math.sin(t * Math.PI * 2 / p.period) * 4 * p.amount }) },
  rubber: { cat: 'cartoon', unit: 'char', fn: (t, i, n, p) => { const s = Math.sin(t * Math.PI * 2 / p.period + i * 0.8) * 0.08 * p.amount; return { sx: 1 + s, sy: 1 - s }; } },
  rainbow: { cat: 'fun', unit: 'char', fn: (t, i, n, p) => ({ hue: ((t / p.period) * 360 + i * 25 * p.amount) % 360 }) },
  shimmer: { cat: 'pro', unit: 'char', fn: (t, i, n, p) => { const ph = ((t / p.period) % 1) * (n + 6) - 3; const d = Math.abs(i - ph); return { bright: Math.max(0, 1 - d / 2) * 0.35 * p.amount }; } },
  flicker: { cat: 'pro', unit: 'char', fn: (t, i, n, p) => { const f = Math.floor(t * 12 / p.period); return { opacity: rand(f, i) > 0.85 * (1 - p.amount * 0.2) ? 0.35 : 1 }; } },
  breathe: { cat: 'pro', unit: 'all', fn: (t, i, n, p) => ({ opacity: 0.8 + 0.2 * Math.cos(t * Math.PI * 2 / p.period) }) },
};

export const UNITS = ['char', 'word', 'line', 'all'];
export const ORDERS = ['forward', 'backward', 'center', 'edges', 'random'];

export const DEFAULT_ANIM = Object.freeze({
  in: { preset: 'none', duration: null, stagger: null, unit: null, order: 'forward', delay: 0 },
  out: { preset: 'none', duration: null, stagger: null, unit: null, order: 'forward' },
  loop: { preset: 'none', period: 1.6, amount: 1 },
  start: 0, // seconds
  end: 4, // seconds; the out animation finishes here
  seed: 1,
});

function resolveValue(v, seed, unitIndex, salt) {
  if (Array.isArray(v) && v[0] === 'rand') return v[1] + ((rand(seed, unitIndex, salt) + 1) / 2) * (v[2] - v[1]);
  return v;
}

/** Evaluate keyframes at progress t for one unit. Missing values inherit from REST / previous key. */
export function evalKeys(keys, t, seed, unitIndex) {
  // resolve each key's full state (carry forward)
  const states = [];
  let prev = { ...REST };
  keys.forEach((k, ki) => {
    const s = { ...prev };
    for (const p of PROPS) if (k[p] !== undefined) s[p] = resolveValue(k[p], seed, unitIndex, ki * 13 + PROPS.indexOf(p));
    states.push(s); prev = s;
  });
  if (t <= keys[0].t) return states[0];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1].t, b = keys[i].t;
      const local = b === a ? 1 : (t - a) / (b - a);
      const e = (EASE[keys[i].ease] || EASE.linear)(local);
      const out = {};
      for (const p of PROPS) out[p] = states[i - 1][p] + (states[i][p] - states[i - 1][p]) * e;
      return out;
    }
  }
  return states[states.length - 1];
}

/** Units: map each layout item to { unit index, unit count } for the chosen granularity. */
export function unitIndex(items, unit, layout) {
  const n = items.length;
  const idx = new Int32Array(n);
  if (unit === 'all') return { idx, count: 1 };
  if (unit === 'line') {
    const lineOf = new Map();
    layout.lines.forEach((ln, li) => ln.items.forEach((it) => lineOf.set(it, li)));
    items.forEach((it, i) => { idx[i] = lineOf.get(it) || 0; });
    return { idx, count: layout.lines.length };
  }
  // logical order
  const order = items.map((it, i) => i).sort((a, b) => items[a].index - items[b].index);
  let u = -1, prevSpace = true;
  for (const i of order) {
    const it = items[i];
    if (unit === 'word') {
      if (!it.isSpace && prevSpace) u++;
      prevSpace = it.isSpace;
      idx[i] = Math.max(0, u);
    } else {
      if (!it.isSpace) u++;
      idx[i] = Math.max(0, u);
    }
  }
  return { idx, count: Math.max(1, u + 1) };
}

function orderRank(i, count, order, seed) {
  switch (order) {
    case 'backward': return count - 1 - i;
    case 'center': return Math.abs(i - (count - 1) / 2) * 2;
    case 'edges': return ((count - 1) / 2 - Math.abs(i - (count - 1) / 2)) * 2;
    case 'random': {
      // stable permutation rank
      const keys = Array.from({ length: count }, (_, k) => [rand(seed, k, 99), k]).sort((a, b) => a[0] - b[0]);
      return keys.findIndex((k) => k[1] === i);
    }
    default: return i;
  }
}

/** Total length of an in/out phase in seconds. */
export function phaseLength(cfg, preset, count) {
  if (!preset) return 0;
  const dur = cfg.duration ?? preset.duration;
  const st = cfg.stagger ?? preset.stagger;
  const maxRank = cfg.order === 'center' || cfg.order === 'edges' ? count - 1 : count - 1;
  return dur + st * Math.max(0, maxRank);
}

/**
 * Per-item transforms at time `time` (seconds) for a layer.
 * Returns { transforms: Array<REST-like>, visible: boolean, needsBlur, needsHue }.
 */
export function evaluate(anim, items, layout, time) {
  const a = anim || DEFAULT_ANIM;
  const n = items.length;
  // per item: scalar effects plus a list of geometric ops, each relative to its animation unit
  const out = items.map(() => ({ opacity: 1, blur: 0, hue: 0, clip: 1, bright: 0, ops: [] }));
  const res = { transforms: out, visible: time >= a.start - 1e-6 && time <= a.end + 1e-6, active: false };
  const inP = IN_PRESETS[a.in.preset];
  const outP = OUT_PRESETS[a.out.preset];
  const loopP = LOOP_PRESETS[a.loop.preset];
  const apply = (target, tr, kind, u, pivot) => {
    target.opacity *= tr.opacity; target.blur += tr.blur; target.hue += tr.hue;
    target.clip = Math.min(target.clip, tr.clip); target.bright += tr.bright;
    if (tr.dx || tr.dy || tr.sx !== 1 || tr.sy !== 1 || tr.rot || tr.skew) {
      target.ops.push({ dx: tr.dx, dy: tr.dy, sx: tr.sx, sy: tr.sy, rot: tr.rot, skew: tr.skew, kind, u, pivot: pivot || 'center' });
    }
  };
  const phase = (preset, cfg, localT, dirOut) => {
    const unit = cfg.unit || preset.unit;
    const { idx, count } = unitIndex(items, unit, layout);
    const dur = cfg.duration ?? preset.duration;
    const st = cfg.stagger ?? preset.stagger;
    const order = cfg.order && cfg.order !== 'forward' ? cfg.order : preset.order || 'forward';
    const ranks = new Map();
    for (let i = 0; i < n; i++) {
      const u = idx[i];
      if (!ranks.has(u)) ranks.set(u, orderRank(u, count, order, a.seed));
      const start = ranks.get(u) * st;
      const t = dur <= 0.011 ? (localT >= start ? 1 : 0) : Math.min(1, Math.max(0, (localT - start) / dur));
      const tr = evalKeys(preset.keys, t, a.seed, u);
      if (preset.spread) {
        // tracking-style: spread characters away from the centre
        const k = dirOut ? t : 1 - t;
        tr.dx += (u - (count - 1) / 2) * preset.spread * 0.3 * EASE.outCubic(k) * (dirOut ? 1 : 1);
      }
      apply(out[i], tr, unit, u, preset.pivot);
    }
    res.active = true;
  };
  const t = time - a.start;
  if (inP) {
    const inLen = phaseLength(a.in, inP, unitIndex(items, a.in.unit || inP.unit, layout).count);
    const lt = t - (a.in.delay || 0);
    if (lt < inLen + 1e-6) phase(inP, a.in, Math.max(-1e-6, lt), false);
    if (lt < 0) for (const tr of out) tr.opacity = 0;
  }
  res.inEnd = inP ? a.start + (a.in.delay || 0) + phaseLength(a.in, inP, unitIndex(items, a.in.unit || inP.unit, layout).count) : a.start;
  if (outP) {
    const count = unitIndex(items, a.out.unit || outP.unit, layout).count;
    const outLen = phaseLength(a.out, outP, count);
    const outStart = a.end - a.start - outLen;
    if (t >= outStart) phase(outP, a.out, t - outStart, true);
  }
  if (loopP) {
    const { idx, count } = unitIndex(items, loopP.unit, layout);
    const p = { period: a.loop.period || 1.6, amount: a.loop.amount ?? 1 };
    for (let i = 0; i < n; i++) apply(out[i], { ...REST, ...loopP.fn(t, idx[i], count, p) }, loopP.unit, idx[i]);
    res.active = true;
  }
  return res;
}

export function presetList(kind) {
  const src = kind === 'in' ? IN_PRESETS : kind === 'out' ? OUT_PRESETS : LOOP_PRESETS;
  return Object.entries(src).map(([id, p]) => ({ id, cat: p.cat }));
}
