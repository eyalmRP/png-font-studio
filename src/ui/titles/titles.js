// Titles mode: layers + artboard (left), stage + animation player (centre), inspector (right).
import { h, clear, icon, storeSet } from '../dom.js';
import { t, ltr } from '../i18n.js';
import { section, iconButton, button, numberField, pills, colorField, select, menu } from '../controls.js';
import { state, on, emit, selectLayer, checkpoint, projectChanged, newTextLayer, selectedLayer, createProject } from '../../app/store.js';
import { createStage } from './stage.js';
import { createInspector } from './inspector.js';
import { createPlayer } from './player.js';
import { renderLayer } from '../../render/layer.js';
import { openExport } from '../export.js';
import { openProject, saveProject } from '../projectio.js';

const SIZES = [
  { id: '1920x1080', label: 'Full HD 16:9', w: 1920, h: 1080 },
  { id: '3840x2160', label: '4K 16:9', w: 3840, h: 2160 },
  { id: '1080x1080', label: 'Square 1:1', w: 1080, h: 1080 },
  { id: '1080x1350', label: 'Portrait 4:5', w: 1080, h: 1350 },
  { id: '1080x1920', label: 'Story 9:16', w: 1080, h: 1920 },
  { id: '1280x720', label: 'HD 16:9', w: 1280, h: 720 },
  { id: '2048x1024', label: 'Banner 2:1', w: 2048, h: 1024 },
];

export function mountTitles({ left, right, center, exportSlot, sizes, applySizes, saveSizes }) {
  const stage = createStage();
  const player = createPlayer();
  const inspector = createInspector();
  center.classList.add('with-player');
  center.append(stage.el, player.el);
  right.appendChild(inspector.el);

  // ---------- left: layers + artboard ----------
  const layerList = h('div.layer-list', { role: 'listbox', 'aria-label': t('Layers') });
  const addBtn = iconButton('plus', t('Add title'), () => addLayer());
  const dupBtn = iconButton('copy', t('Duplicate layer') + ' (Ctrl+D)', () => duplicate());
  const delBtn = iconButton('trash', t('Delete layer'), () => removeSelected());
  const layersSec = section({ id: 'layers', title: t('Layers'), iconName: 'layers', actions: [addBtn, dupBtn, delBtn] }, layerList);

  const ab = state.project.artboard;
  const sizeSel = select({
    label: t('Size'), iconName: 'crop', value: `${ab.w}x${ab.h}`,
    options: [...SIZES.map((s) => ({ value: s.id, label: `${t(s.label)} · ${ltr(`${s.w}×${s.h}`)}` })), { value: 'custom', label: t('Custom') }],
    onChange: (v) => { const s = SIZES.find((x) => x.id === v); if (s) setArtboard(s.w, s.h); },
  });
  const wF = numberField({ label: 'W', min: 16, max: 8192, unit: 'px', value: ab.w, onChange: (v) => setArtboard(v, state.project.artboard.h), onInput: () => {} });
  const hF = numberField({ label: 'H', min: 16, max: 8192, unit: 'px', value: ab.h, onChange: (v) => setArtboard(state.project.artboard.w, v), onInput: () => {} });
  const bgP = pills({ class: 'stretch', value: ab.bg, options: [{ value: 'transparent', label: t('Transparent') }, { value: 'color', label: t('Colour') }], onChange: (v) => { checkpoint('project', 'Background'); state.project.artboard.bg = v; projectChanged(); bgC.style.display = v === 'color' ? '' : 'none'; } });
  const bgC = colorField({ label: t('Background'), value: ab.bgColor, onInput: (v) => { state.project.artboard.bgColor = v; projectChanged(); }, onChange: () => {} });
  bgC.style.display = ab.bg === 'color' ? '' : 'none';
  const resetArtboard = () => {
    const d = createProject().artboard;
    if (state.project.artboard.w !== d.w || state.project.artboard.h !== d.h) setArtboard(d.w, d.h);
    checkpoint('project', 'Background');
    Object.assign(state.project.artboard, { bg: d.bg, bgColor: d.bgColor });
    bgP.setValue(d.bg); bgC.setValue(d.bgColor); bgC.style.display = 'none';
    projectChanged();
  };
  const abSec = section({ id: 'artboard', title: t('Artboard'), iconName: 'crop', onReset: resetArtboard }, sizeSel, h('div.grid2', wF, hF), bgP, bgC,
    h('p.hint', t('Transparent exports keep the alpha channel. The background colour is used only when you choose to include it.')));
  const fileSec = section({ id: 'title-file', title: t('Title file'), iconName: 'save' },
    h('div.row-ctl', button({ label: t('Save title'), icon: 'save', onClick: () => saveProject() }), button({ label: t('Open title'), icon: 'open', onClick: () => openProject() })),
    button({ label: t('New title'), icon: 'plus', kind: 'ghost', onClick: () => newTitle() }),
    h('p.hint', t('Your work is kept in this browser automatically. Save a title file to back it up or move it to another computer; it includes the fonts it uses.')));
  left.append(h('div.panel-scroll', layersSec, abSec, fileSec));

  function setArtboard(w, hh) {
    checkpoint('project', 'Artboard size');
    const a = state.project.artboard;
    const kx = w / a.w, ky = hh / a.h;
    for (const l of state.project.layers) { l.x *= kx; l.y *= ky; }
    a.w = Math.round(w); a.h = Math.round(hh);
    wF.setValue(a.w); hF.setValue(a.h); sizeSel.setValue(SIZES.some((s) => s.id === `${a.w}x${a.h}`) ? `${a.w}x${a.h}` : 'custom');
    projectChanged();
    stage.fit();
  }

  function renderLayers() {
    clear(layerList);
    const layers = [...state.project.layers].reverse();
    if (!layers.length) layerList.appendChild(h('p.hint', { style: { padding: '6px 4px' } }, t('No titles yet. Press T and click the artboard, or use +.')));
    for (const layer of layers) {
      const thumb = h('div.layer-thumb');
      const vis = iconButton(layer.visible ? 'eye' : 'eyeOff', t('Show / hide'), (e) => { e.stopPropagation(); checkpoint('project', 'Visibility'); layer.visible = !layer.visible; projectChanged('render', layer); });
      const lock = iconButton(layer.locked ? 'lock' : 'unlock', t('Lock'), (e) => { e.stopPropagation(); layer.locked = !layer.locked; projectChanged('render', layer); });
      const item = h('div.layer-item', {
        role: 'option', tabIndex: 0, 'aria-selected': layer.id === state.selectedLayerId, class: (layer.id === state.selectedLayerId ? 'on ' : '') + (layer.visible ? '' : 'hidden'),
        draggable: true,
        on: {
          click: () => selectLayer(layer.id),
          dblclick: () => { selectLayer(layer.id); emit('edit-layer', layer.id); },
          keydown: (e) => { if (e.key === 'Enter') selectLayer(layer.id); },
          dragstart: (e) => { e.dataTransfer.setData('text/x-layer', layer.id); },
          dragover: (e) => e.preventDefault(),
          drop: (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/x-layer'); reorder(id, layer.id); },
        },
      }, h('span', { style: { color: 'var(--muted)', display: 'flex' } }, icon('grip', 14)), thumb, h('span.layer-name', layer.name || t('Text')), vis, lock);
      layerList.appendChild(item);
      requestAnimationFrame(() => {
        const r = renderLayer(layer, state.time, 0.12, { noAnim: true });
        if (!r) return;
        const c = h('canvas');
        c.width = Math.max(1, r.canvas.width); c.height = Math.max(1, r.canvas.height);
        c.getContext('2d').drawImage(r.canvas, 0, 0);
        thumb.replaceChildren(c);
      });
    }
    dupBtn.disabled = delBtn.disabled = !selectedLayer();
  }

  function reorder(fromId, toId) {
    const L = state.project.layers;
    const a = L.findIndex((l) => l.id === fromId), b = L.findIndex((l) => l.id === toId);
    if (a < 0 || b < 0 || a === b) return;
    checkpoint('project', 'Reorder layers');
    const [x] = L.splice(a, 1);
    L.splice(b, 0, x);
    projectChanged();
    renderLayers();
  }

  function addLayer(text = 'Title') {
    checkpoint('project', 'Add title');
    const a = state.project.artboard;
    const prev = selectedLayer();
    const layer = newTextLayer(text, state.fontOrder[0], a.w / 2, a.h / 2 - a.h / 10, { size: Math.round(a.h / 6) });
    if (prev) { layer.effects = JSON.parse(JSON.stringify(prev.effects)); }
    state.project.layers.push(layer);
    projectChanged();
    selectLayer(layer.id);
    emit('edit-layer', layer.id);
  }
  function duplicate() {
    const l = selectedLayer();
    if (!l) return;
    checkpoint('project', 'Duplicate layer');
    const json = JSON.parse(JSON.stringify({ ...l, doc: null }));
    const copy = { ...json, id: 'layer_' + Math.random().toString(36).slice(2), doc: { chars: [...l.doc.chars], styles: [...l.doc.styles], paras: l.doc.paras.map((p) => ({ ...p })), typing: l.doc.typing }, x: l.x + 30, y: l.y + 30, name: l.name + ' ' + t('copy'), rev: 0, layoutRev: 0 };
    const i = state.project.layers.indexOf(l);
    state.project.layers.splice(i + 1, 0, copy);
    projectChanged();
    selectLayer(copy.id);
  }
  function removeSelected() {
    const l = selectedLayer();
    if (!l) return;
    checkpoint('project', 'Delete layer');
    state.edit = null;
    state.project.layers = state.project.layers.filter((x) => x !== l);
    selectLayer(null);
    projectChanged();
  }
  function newTitle() {
    checkpoint('project', 'New title');
    state.edit = null;
    state.project.layers = [];
    state.selectedLayerId = null;
    projectChanged();
    emit('selection');
  }

  // ---------- still / animated ----------
  // Still: design and export PNG titles, with no player or animation settings. Animated: entrance, hold and
  // exit animation and video export. Each title keeps its own choice; new titles start with the last one used.
  const modePills = pills({
    class: 'mode-switch', value: state.project.animated === false ? 'still' : 'anim',
    options: [
      { value: 'still', icon: 'fileImage', label: t('Still'), title: t('Still: design titles and export PNG images') },
      { value: 'anim', icon: 'filmStrip', label: t('Animated'), title: t('Animated: add entrance, hold and exit animation, and export video') },
    ],
    onChange: (v) => {
      checkpoint('project', 'Animation mode');
      state.project.animated = v === 'anim';
      storeSet('animatedDefault', state.project.animated);
      applyMode();
      emit('project', { what: 'mode' });
    },
  });
  function applyMode() {
    const anim = state.project.animated !== false;
    // the interface accent follows the mode: pink for video, blue for still images
    document.documentElement.dataset.mode = anim ? 'animated' : 'still';
    modePills.setValue(anim ? 'anim' : 'still');
    if (!anim) player.stop();
    player.el.hidden = !anim;
    center.classList.toggle('with-player', anim);
    stage.request();
  }

  // ---------- export button ----------
  const exportBtn = button({ label: t('Export'), icon: 'download', kind: 'primary', onClick: () => openExport() });
  exportSlot.replaceChildren(modePills, exportBtn);
  applyMode();

  const offs = [
    // an opened title file brings its own Still / Animated choice
    on('project', (d) => { if (!d || d.what !== 'transform') renderLayers(); if ((state.project.animated !== false) !== !player.el.hidden) applyMode(); }),
    on('selection', renderLayers),
    on('edit-layer', (id) => { import('../../app/textedit.js').then((m) => { m.enterEdit(id); stage.focusIme(); }); }),
    on('key', (e) => {
      if (state.ui.mode !== 'titles') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayer() && !state.edit) { e.preventDefault(); removeSelected(); }
    }),
  ];
  renderLayers();
  void menu;
  return {
    destroy() { stage.destroy(); player.destroy(); inspector.destroy(); offs.forEach((f) => f()); exportSlot.replaceChildren(); center.classList.remove('with-player'); },
  };
}
