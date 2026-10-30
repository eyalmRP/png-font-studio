// Boot: load fonts (library or built-ins), restore or create the title, mount the app.
import './ui/he.js';
import { applyLang, t } from './ui/i18n.js';
import { h } from './ui/dom.js';
import { state, addFont, createProject, projectFromJSON, newTextLayer, newEffect, emit, markLayer } from './app/store.js';
import { mountApp, render } from './ui/app.js';
import { fontFromZipBytes } from './storage/files.js';
import { loadFontRecords, saveFontRecord, loadProjectRecord } from './storage/library.js';
import { startAutosave } from './ui/projectio.js';
import { on } from './app/store.js';

const BUILTIN = [
  { id: 'builtin-bubble-blue', file: 'fonts/bubble-blue.zip', key: 'bubble-blue', order: 0 },
  { id: 'builtin-bubble-orange', file: 'fonts/bubble-orange.zip', key: 'bubble-orange', order: 1 },
];

async function builtinBytes(b) {
  const embedded = window.__PFS_FONTS__ && window.__PFS_FONTS__[b.key];
  if (embedded) {
    const bin = atob(embedded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const res = await fetch(b.file);
  if (!res.ok) throw new Error(`Could not load ${b.file}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadBuiltins({ save = true } = {}) {
  const fonts = [];
  for (const b of BUILTIN) {
    try {
      const f = await fontFromZipBytes(await builtinBytes(b));
      f.id = b.id; f.builtin = true; f.order = b.order;
      fonts.push(f);
      if (save) saveFontRecord(f);
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
  if (!fonts.length) fonts = await loadBuiltins();
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
