// Boot: load fonts (library or built-ins), restore or create the title, mount the app.
import './ui/he.js';
import { applyLang, t } from './ui/i18n.js';
import { h, storeGet, storeSet } from './ui/dom.js';
import { faceVariant } from './core/recolor.js';
import { state, addFont, createProject, projectFromJSON, newTextLayer, newEffect, emit, markLayer } from './app/store.js';
import { mountApp, render, applyTheme } from './ui/app.js';
import { fontFromZipBytes } from './storage/files.js';
import { loadFontRecords, saveFontRecord, loadProjectRecord } from './storage/library.js';
import { startAutosave } from './ui/projectio.js';
import { on } from './app/store.js';

// Bump BUILTIN_VERSION when the built-in fonts change: a library from an older version gets them replaced.
const BUILTIN_VERSION = 6;
const BUILTIN = [
  // the font package travels as base64 inside JSON: the claude.ai page host serves .json but not .zip
  { id: 'builtin-bubble-blue', file: 'fonts/bubble-blue.json', key: 'bubble-blue', order: 0 },
  // colour variants are made from Bubble Blue when the app loads (one font file to download)
  { id: 'builtin-bubble-orange', from: 'builtin-bubble-blue', face: 'Orange', name: 'Bubble Orange', order: 1 },
  { id: 'builtin-bubble-pearl', from: 'builtin-bubble-blue', face: 'Pearl', name: 'Bubble Pearl', order: 2 },
];

function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// the build writes each font file's size here, for download progress when the server sends no length
const FONT_BYTES = typeof __PFS_FONT_BYTES__ !== 'undefined' ? __PFS_FONT_BYTES__ : {};

/** The font package bytes; onProgress(0..1) follows the download. */
async function builtinBytes(b, onProgress) {
  const embedded = window.__PFS_FONTS__ && window.__PFS_FONTS__[b.key];
  if (embedded) return fromBase64(embedded);
  const res = await fetch(b.file);
  if (!res.ok) throw new Error(`Could not load ${b.file}`);
  // a compressed response's Content-Length counts compressed bytes, so prefer the size the build recorded
  const total = FONT_BYTES[b.key] || Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return fromBase64((await res.json()).zip);
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return fromBase64(JSON.parse(new TextDecoder().decode(all)).zip);
}

const pause = () => new Promise((r) => setTimeout(r, 16)); // lets the loading screen repaint

/**
 * Load the built-in fonts. progress(fraction, label) reports the download, the glyph decoding and the colour
 * variants. Saving them to the browser library happens afterwards (`saved` resolves when it is done), so the app
 * can open first.
 */
export async function loadBuiltins({ save = true, progress = () => {} } = {}) {
  const fonts = [];
  const byId = new Map();
  const embedded = !!window.__PFS_FONTS__;
  // rough share of the wait for each step
  const plan = embedded ? { download: 0.1, decode: 0.4, variant: 0.25 } : { download: 0.62, decode: 0.14, variant: 0.12 };
  let at = 0;
  for (const b of BUILTIN) {
    try {
      let f;
      if (b.from) {
        const src = byId.get(b.from);
        if (!src) continue;
        progress(at, t('Making {name}…', { name: b.name }));
        await pause();
        f = faceVariant(src, b.face, b.name);
        f.family = src.family;
        at += plan.variant;
      } else {
        const label = t('Downloading fonts…');
        progress(at, label);
        const bytes = await builtinBytes(b, (x) => progress(at + x * plan.download, label));
        at += plan.download;
        f = await fontFromZipBytes(bytes, '', (x) => progress(at + x * plan.decode, t('Preparing letters…')));
        at += plan.decode;
      }
      f.id = b.id; f.builtin = true; f.order = b.order;
      byId.set(f.id, f);
      fonts.push(f);
    } catch (e) { console.warn(e); }
  }
  progress(1, t('Opening…'));
  const saved = save ? (async () => { for (const f of fonts) await saveFontRecord(f); })() : Promise.resolve();
  return { fonts, saved };
}

/** Full-page loading screen with a progress bar; set(fraction, label) never moves backwards. */
function loadingScreen(root) {
  const bar = h('div');
  const pct = h('span.boot-pct', '0%');
  const step = h('span.boot-step', t('Loading…'));
  const el = h('div.boot', h('div.boot-card', h('div.boot-title', 'PNG Font Studio'), h('div.progress.boot-bar', bar), h('div.boot-row', step, pct)));
  root.appendChild(el);
  let shown = 0;
  return {
    set(f, label) {
      shown = Math.max(shown, Math.min(1, f));
      bar.style.width = (shown * 100).toFixed(1) + '%';
      pct.textContent = Math.round(shown * 100) + '%';
      if (label) step.textContent = label;
    },
    remove() { el.remove(); },
  };
}

function demoProject() {
  const p = createProject();
  p.name = 'Hello title';
  state.project = p;
  const blue = state.fontOrder.find((id) => id.includes('blue')) || state.fontOrder[0];
  const orange = state.fontOrder.find((id) => id.includes('orange')) || blue;
  const a = newTextLayer('Hello!', blue, 960, 330, { size: 300, effects: [newEffect('stroke', { size: 16, color: '#ffffff' }), newEffect('dropShadow', { distance: 18, size: 16, opacity: 45, color: '#2a0b4a' })] });
  a.anim.in.preset = 'jellyDrop';
  a.anim.loop.preset = 'bob';
  a.anim.loop.amount = 0.6;
  a.anim.out.preset = 'popOut';
  const b = newTextLayer('PNG Font Studio', orange, 960, 690, { size: 170, effects: [newEffect('stroke', { size: 10, color: '#ffffff' }), newEffect('dropShadow', { distance: 12, size: 10, opacity: 40, color: '#2a0b4a' })] });
  b.warp = { ...b.warp, style: 'arc', bend: 0.18 };
  b.anim.in.delay = 0.4;
  p.hold = 1.4;
  b.anim.in.preset = 'popBounce';
  b.anim.out.preset = 'fallDown';
  p.layers.push(a, b);
  return p;
}

async function boot() {
  applyLang();
  applyTheme();
  // the loading screen already takes the accent of the mode last used (the title view keeps it in step after)
  document.documentElement.dataset.mode = storeGet('animatedDefault', true) === false ? 'still' : 'animated';
  // the UI font loads without holding up the first paint (a <link> in the head would block it)
  document.head.appendChild(h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap' }));
  const root = document.getElementById('app');
  const screen = loadingScreen(root);
  const fresh = storeGet('builtinVersion', 1) < BUILTIN_VERSION;
  // reading the library is the whole wait on a return visit, but only a small part when the built-ins are new
  let fonts = await loadFontRecords((x) => screen.set(x * (fresh ? 0.05 : 0.95), t('Opening your fonts…')));
  let saved = Promise.resolve();
  if (!fonts.length || fresh) {
    // first visit, or newer built-in fonts: they replace the stored ones; the user's own fonts stay
    const b = await loadBuiltins({ progress: (x, label) => screen.set(0.05 + x * 0.93, label) });
    const ids = new Set(b.fonts.map((f) => f.id));
    fonts = [...b.fonts, ...fonts.filter((f) => !ids.has(f.id))];
    saved = b.saved.then(() => storeSet('builtinVersion', BUILTIN_VERSION));
  }
  screen.set(1);
  for (const f of fonts) addFont(f, { select: false });
  state.currentFontId = state.fontOrder[0] || null;
  const rec = await loadProjectRecord();
  if (rec && rec.json) {
    try { state.project = projectFromJSON(rec.json); } catch (e) { console.warn(e); }
  }
  if (!state.project) state.project = demoProject();
  state.time = Math.min(1.8, state.project.duration / 2);
  screen.remove();
  root.textContent = '';
  mountApp(root);
  saved.catch((e) => console.warn(e));
  startAutosave();
  on('remount', () => render());
  // fonts can finish decoding after layers were laid out
  for (const l of state.project.layers) markLayer(l, 'layout');
  emit('project', { what: 'layout' });
}

boot();

// test hook (used by the headless smoke test)
import { exportAs } from './ui/export.js';
window.__pfs = { state, exportAs };
