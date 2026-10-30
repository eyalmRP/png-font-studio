// Boot: load fonts (library or built-ins), restore or create the title, mount the app.
import './ui/he.js';
import { applyLang, t } from './ui/i18n.js';
import { h, storeGet, storeSet } from './ui/dom.js';
import { faceVariant } from './core/recolor.js';
import { state, addFont, createProject, projectFromJSON, newTextLayer, newEffect, emit, markLayer } from './app/store.js';
import { mountApp, render } from './ui/app.js';
import { fontFromZipBytes } from './storage/files.js';
import { loadFontRecords, saveFontRecord, loadProjectRecord } from './storage/library.js';
import { startAutosave } from './ui/projectio.js';
import { on } from './app/store.js';

// Bump BUILTIN_VERSION when the built-in fonts change: a library from an older version gets them replaced.
const BUILTIN_VERSION = 3;
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

async function builtinBytes(b) {
  const embedded = window.__PFS_FONTS__ && window.__PFS_FONTS__[b.key];
  if (embedded) return fromBase64(embedded);
  const res = await fetch(b.file);
  if (!res.ok) throw new Error(`Could not load ${b.file}`);
  return fromBase64((await res.json()).zip);
}

export async function loadBuiltins({ save = true } = {}) {
  const fonts = [];
  const byId = new Map();
  for (const b of BUILTIN) {
    try {
      let f;
      if (b.from) {
        const src = byId.get(b.from);
        if (!src) continue;
        f = faceVariant(src, b.face, b.name);
        f.family = src.family;
      } else f = await fontFromZipBytes(await builtinBytes(b));
      f.id = b.id; f.builtin = true; f.order = b.order;
      byId.set(f.id, f);
      fonts.push(f);
      if (save) await saveFontRecord(f);
    } catch (e) { console.warn(e); }
  }
  return fonts;
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
  const root = document.getElementById('app');
  root.appendChild(h('div.empty', { style: { margin: 'auto' } }, t('Loading fonts…')));
  let fonts = await loadFontRecords();
  if (!fonts.length) { fonts = await loadBuiltins(); storeSet('builtinVersion', BUILTIN_VERSION); }
  else if (storeGet('builtinVersion', 1) < BUILTIN_VERSION) {
    // newer built-in fonts replace the stored ones; the user's own fonts stay
    const fresh = await loadBuiltins();
    const ids = new Set(fresh.map((f) => f.id));
    fonts = [...fresh, ...fonts.filter((f) => !ids.has(f.id))];
    storeSet('builtinVersion', BUILTIN_VERSION);
  }
  for (const f of fonts) addFont(f, { select: false });
  state.currentFontId = state.fontOrder[0] || null;
  const rec = await loadProjectRecord();
  if (rec && rec.json) {
    try { state.project = projectFromJSON(rec.json); } catch (e) { console.warn(e); }
  }
  if (!state.project) state.project = demoProject();
  state.time = Math.min(1.8, state.project.duration / 2);
  root.textContent = '';
  mountApp(root);
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
