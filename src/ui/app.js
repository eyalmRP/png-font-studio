// App shell: top bar, mode switching, resizable panels, theme/language, global shortcuts.
import { h, clear, icon, storeGet, storeSet } from './dom.js';
import { t, setLang, getLang } from './i18n.js';
import { tabs, iconButton, splitter, toast, menu } from './controls.js';
import { showShortcuts } from './shortcuts.js';
import { startTour } from './tour.js';
import { phoneSheet } from './phonesheet.js';
import { state, on, setUI, undo, redo, canUndo, canRedo, emit } from '../app/store.js';
import { mountTitles } from './titles/titles.js';
import { mountFonts } from './fonts/fonts.js';
import { drawSample } from './sample.js';

let root, current = null, sheet = null;

export function applyTheme() {
  const th = state.ui.theme;
  if (th === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
}

export function mountApp(el) {
  root = el;
  applyTheme();
  render();
  on('history', updateHistory);
  on('fonts', () => drawBrand());
  on('undo-request', (isRedo) => (isRedo ? doRedo() : doUndo()));
  window.addEventListener('keydown', onKey);
}

let undoBtn, redoBtn, brandCanvas;

function updateHistory() {
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();
}

function drawBrand() {
  if (brandCanvas) drawSample(brandCanvas, 'PNG Font Studio', { height: 28, maxWidth: 220 });
}

export function render() {
  if (current) { current.destroy(); current = null; }
  if (sheet) { sheet.destroy(); sheet = null; }
  clear(root);
  brandCanvas = h('canvas', { 'aria-hidden': 'true' });
  const brand = h('div.brand', { role: 'img', 'aria-label': 'PNG Font Studio' }, brandCanvas);
  const modeTabs = tabs({
    class: 'mode-tabs', value: state.ui.mode,
    tabs: [{ id: 'titles', icon: 'type', label: t('Titles') }, { id: 'fonts', icon: 'shapes', label: t('Fonts') }],
    onChange: (m) => { setUI({ mode: m }); render(); },
  });
  undoBtn = iconButton('undo', t('Undo') + ' (Ctrl+Z)', () => doUndo());
  redoBtn = iconButton('redo', t('Redo') + ' (Ctrl+Shift+Z)', () => doRedo());
  const themeBtn = iconButton(isDark() ? 'sun' : 'moon', t('Light / dark'), () => {
    setUI({ theme: isDark() ? 'light' : 'dark' }); applyTheme();
    themeBtn.replaceChildren(icon(isDark() ? 'sun' : 'moon', 16));
    emit('theme');
  });
  const langPills = h('div.pills.lang-pills', { role: 'group', 'aria-label': t('Language') },
    ['en', 'he'].map((l) => h('button.pill', { type: 'button', class: getLang() === l ? 'on' : '', on: { click: () => { setLang(l); render(); } } }, l === 'en' ? 'EN' : 'עב')));
  const helpBtn = iconButton('help', t('Help'), (e) => menu(e.currentTarget, [
    { label: t('Getting started'), icon: 'sparkles', onClick: () => startTour() },
    { label: t('Keyboard shortcuts'), icon: 'keyboard', hint: '?', onClick: () => showShortcuts() },
    // the language pills give way on phones, so the switch is here too
    { label: getLang() === 'he' ? 'English' : 'עברית', icon: 'languages', onClick: () => { setLang(getLang() === 'he' ? 'en' : 'he'); render(); } },
  ]));
  const exportSlot = h('div.group.export-slot');
  const bar = h('header.topbar', brand, modeTabs, h('div.spacer'), h('div.group', undoBtn, redoBtn), exportSlot, h('div.group', helpBtn, themeBtn), langPills);

  const left = h('aside.panel.panel-left');
  const right = h('aside.panel.panel-right');
  const center = h('main.center');
  const ws = h('div.workspace', left, null, center, null, right);
  const sizes = storeGet('panels', { left: 260, right: 330, bottom: 200 });
  const applySizes = () => {
    ws.style.setProperty('--left', sizes.left + 'px');
    ws.style.setProperty('--right', sizes.right + 'px');
    center.style.setProperty('--bottom', sizes.bottom + 'px');
  };
  const saveSizes = () => { storeSet('panels', sizes); emit('resize'); };
  const sLeft = splitter({ orient: 'v', get: () => sizes.left, set: (v) => { sizes.left = v; applySizes(); emit('resize'); }, min: 180, max: 520, done: saveSizes });
  const sRight = splitter({ orient: 'v', invert: true, get: () => sizes.right, set: (v) => { sizes.right = v; applySizes(); emit('resize'); }, min: 260, max: 620, done: saveSizes });
  sLeft.classList.add('split-left'); sRight.classList.add('split-right');
  // on phones both panels live in a bottom sheet with tabs; elsewhere the sheet's box is invisible to the layout
  const fonts = state.ui.mode === 'fonts';
  sheet = phoneSheet(state.ui.mode, [
    { id: 'left', icon: fonts ? 'shapes' : 'layers', label: fonts ? t('Fonts') : t('Layers'), el: left },
    { id: 'right', icon: 'sliders', label: t('Edit'), el: right },
  ]);
  ws.replaceChildren(center, sLeft, sRight, sheet.el);
  applySizes();
  root.append(bar, ws);
  const ctx = { left, right, center, exportSlot, sizes, applySizes, saveSizes };
  document.documentElement.dataset.workspace = state.ui.mode;
  current = state.ui.mode === 'fonts' ? mountFonts(ctx) : mountTitles(ctx);
  updateHistory();
  requestAnimationFrame(drawBrand);
}

function isDark() {
  const th = state.ui.theme;
  if (th === 'dark') return true;
  if (th === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function doUndo() { const l = undo(); if (l) toast(t('Undid: {what}', { what: t(l) }), 'info', 1600); }
function doRedo() { const l = redo(); if (l) toast(t('Redid: {what}', { what: t(l) }), 'info', 1600); }

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) && !e.target.classList.contains('ime');
  const mod = e.ctrlKey || e.metaKey;
  if (state.edit && e.target.classList.contains('ime')) return; // the canvas editor handles its own keys
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (e.key === '?' && !mod) { e.preventDefault(); showShortcuts(); return; }
  emit('key', e);
}

