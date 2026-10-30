// Fonts mode: font library (left), glyph sheet (centre), glyph and font inspector (right).
import { h, clear, icon, pickFiles, storeGet, storeSet, rafThrottle } from '../dom.js';
import { t } from '../i18n.js';
import {
  section, iconButton, button, numberField, pills, toggle, select, toast, confirmDialog, promptDialog, menu, colorField, gradientField, hexToRgb,
} from '../controls.js';
import { state, on, emit, addFont, removeFont, currentFont, fontChanged, checkpoint, setUI } from '../../app/store.js';
import {
  createFont, setGlyph, remapGlyph, duplicateGlyph, autoMetrics, normalizeSizes, sortedChars, cloneFont, glyphAdvance, opticalKern, touch, glyphRound,
} from '../../core/font.js';
import { charLabel, CHARSET_GROUPS } from '../../core/charsets.js';
import { flipImage, rotate90, trimImage, cleanupAlpha, adjustHsl, gradientMap, cloneImage, recolorRange } from '../../core/image.js';
import { createDoc } from '../../core/textdoc.js';
import { layoutDoc, inkBounds } from '../../core/layout.js';
import { prepareText, drawPrepared } from '../../render/text.js';
import { DEFAULT_WARP } from '../../core/warp.js';
import { drawGlyphOnGuides, css } from './glyphview.js';
import { openImporter, charFromFilename } from './importer.js';
import { decodeImage, fontToZip, fontFromZipBytes, saveFile, safeName } from '../../storage/files.js';
import { FACE_PRESETS, dominantHue, paletteFromStops, resolvePalette, remapPalette } from '../../core/recolor.js';
import { saveFontRecord, deleteFontRecord } from '../../storage/library.js';
import { drawSample } from '../sample.js';
import { exportFontPSD, updateFromPSD } from './psd.js';

const GROUP_FILTERS = ['all', 'upper', 'lower', 'digits', 'punct', 'symbols', 'hebrew', 'other', 'missing'];
const GROUP_LABEL = { all: 'All', upper: 'Uppercase', lower: 'Lowercase', digits: 'Digits', punct: 'Punctuation', symbols: 'Symbols', hebrew: 'Hebrew', other: 'Other', missing: 'Missing' };

export function mountFonts({ left, right, center, exportSlot }) {
  const offs = [];
  let filter = storeGet('glyphFilter', 'all');
  let search = '';

  // ================= left: library =================
  const list = h('div.font-list', { role: 'listbox', 'aria-label': t('Fonts') });
  const libSec = section({ id: 'fonts-lib', title: t('Fonts'), iconName: 'shapes', actions: [
    iconButton('plus', t('New empty font'), () => newFont()),
    iconButton('more', t('More'), (e) => fontMenu(e.currentTarget)),
  ] }, list,
  h('div.row-ctl', button({ label: t('Import sheets'), icon: 'imagePlus', kind: 'primary', onClick: () => openImporter() }), button({ label: t('Open font'), icon: 'open', onClick: () => openFontFile() })));
  const recolorSec = buildRecolor();
  left.append(h('div.panel-scroll', libSec, recolorSec));

  function renderList() {
    clear(list);
    for (const id of state.fontOrder) {
      const f = state.fonts.get(id);
      const c = h('canvas', { 'aria-hidden': 'true' });
      const n = [...f.glyphs.values()].filter((g) => g.image).length;
      list.appendChild(h('button.font-item', { type: 'button', role: 'option', 'aria-selected': id === state.currentFontId, class: id === state.currentFontId ? 'on' : '', on: { click: () => { state.currentFontId = id; state.selectedGlyph = null; state.selectedGlyphs.clear(); emit('fonts'); } } },
        c, h('div.meta', h('span.name', f.name), h('span', t('{n} glyphs', { n })))));
      requestAnimationFrame(() => drawSample(c, 'Abc 123', { fontId: id, height: 30, maxWidth: 220 }));
    }
  }

  async function newFont() {
    const name = await promptDialog(t('New font'), t('Font name'), t('My font'));
    if (!name) return;
    const f = createFont(name);
    addFont(f);
    saveFontRecord(f);
    toast(t('Created {name}. Import a sheet or drop glyph images onto the empty slots.', { name }), 'ok', 4500);
  }

  function fontMenu(anchor) {
    const f = currentFont();
    menu(anchor, [
      { label: t('Rename font'), icon: 'type', disabled: !f, onClick: async () => { const n = await promptDialog(t('Rename font'), t('Font name'), f.name); if (n) { checkpoint('font:' + f.id, 'Rename font'); f.name = n; fontChanged(f); emit('fonts'); } } },
      { label: t('Duplicate font'), icon: 'copy', disabled: !f, onClick: () => { const c = cloneFont(f); addFont(c); saveFontRecord(c); } },
      { label: t('Save font file'), icon: 'save', disabled: !f, onClick: () => saveFontFile(f) },
      { label: t('Open font file'), icon: 'open', onClick: () => openFontFile() },
      '-',
      { label: t('Delete font'), icon: 'trash', danger: true, disabled: !f, onClick: () => deleteFont(f) },
    ]);
  }

  async function deleteFont(f) {
    if (!(await confirmDialog(t('Delete font'), t('Delete “{name}” from this browser? Titles that use it will show empty boxes. Save a font file first if you may need it again.', { name: f.name }), t('Delete'), true))) return;
    removeFont(f.id);
    deleteFontRecord(f.id);
  }

  async function saveFontFile(f) {
    try {
      const zip = await fontToZip(f);
      const r = await saveFile(`${safeName(f.name, 'font')}.font.zip`, new Blob([zip], { type: 'application/zip' }));
      if (r === 'saved') toast(t('Font saved'), 'ok');
    } catch (e) { toast(e.message, 'error', 5000); }
  }

  // Photoshop round trip: one glyph-size PSD with a layer per character
  async function exportPSD(f) {
    try {
      toast(t('Preparing the Photoshop file…'), 'info', 2500);
      if ((await exportFontPSD(f)) === 'saved') toast(t('Saved {name}', { name: `${safeName(f.name, 'font')} for Photoshop.zip` }), 'ok');
    } catch (e) { toast(e.message, 'error', 6000); }
  }
  async function importPSD(f) {
    const [file] = await pickFiles({ accept: '.psd,.zip,image/vnd.adobe.photoshop,application/zip', multiple: false });
    if (!file) return;
    try {
      await updateFromPSD(f, file, {
        beforeUpdate: () => checkpoint('font:' + f.id, 'Update from Photoshop'),
        onApply: (target, asNew) => {
          if (asNew) { addFont(target); saveFontRecord(target); toast(t('Created {name}', { name: target.name }), 'ok'); }
          else { fontChanged(target); emit('fonts'); toast(t('Updated {name}', { name: target.name }), 'ok'); }
          afterFontEdit(target);
        },
      });
    } catch (e) { toast(e.message, 'error', 6000); }
  }

  async function openFontFile() {
    const files = await pickFiles({ accept: '.zip,application/zip', multiple: true });
    for (const file of files) {
      try {
        const f = await fontFromZipBytes(new Uint8Array(await file.arrayBuffer()));
        if (state.fonts.has(f.id)) f.id = f.id + '_' + Date.now().toString(36);
        addFont(f);
        saveFontRecord(f);
        toast(t('Opened {name}', { name: f.name }), 'ok');
      } catch (e) { toast(e.message, 'error', 5000); }
    }
  }

  // ---------- recolour ----------
  function buildRecolor() {
    // face mode recolours only the letter face (one colour range) and keeps a 3D base, outline and highlights
    let mode = 'face', hue = 160, sat = 0, light = 0;
    const MAP_STOPS = [{ pos: 0, color: '#3a0a5c' }, { pos: 0.55, color: '#ff4fa3' }, { pos: 1, color: '#fff3b0' }];
    let stops = MAP_STOPS.map((x) => ({ ...x }));
    let face = { hue: 205, width: 38, soft: 30 };
    let faceStops = FACE_PRESETS[0].stops.map((x) => ({ ...x }));
    let presetName = FACE_PRESETS[0].name;
    // a preset recolours the whole design band by band; editing the gradient switches to the face only
    let palette = FACE_PRESETS[0].palette || paletteFromStops(FACE_PRESETS[0].stops);
    let resolved = null; // palette measured against the current font and face hue
    const anchorsFor = (f) => {
      const key = `${f.id}:${f.rev}:${face.hue}`;
      if (!resolved || resolved.key !== key || resolved.palette !== palette) resolved = { key, palette, anchors: resolvePalette(f, palette, face.hue) };
      return resolved.anchors;
    };
    const preview = h('canvas');
    const hueF = numberField({ label: t('Hue'), min: -180, max: 180, unit: '°', slider: true, value: hue, onInput: (v) => { hue = v; drawPrev(); }, onChange: () => {} });
    const satF = numberField({ label: t('Saturation'), def: 0, min: -100, max: 100, unit: '%', slider: true, value: sat, onInput: (v) => { sat = v; drawPrev(); }, onChange: () => {} });
    const lightF = numberField({ label: t('Lightness'), def: 0, min: -100, max: 100, unit: '%', slider: true, value: light, onInput: (v) => { light = v; drawPrev(); }, onChange: () => {} });
    const grad = gradientField({ stops, onInput: (v) => { stops = v; drawPrev(); }, onChange: (v) => { stops = v; drawPrev(); } });
    // face mode controls
    const faceGrad = gradientField({ stops: faceStops, onInput: (v) => { faceStops = v; presetName = t('Custom'); palette = null; syncFace(); drawPrev(); }, onChange: (v) => { faceStops = v; drawPrev(); } });
    const presetGrid = h('div.preset-grid', FACE_PRESETS.map((pr) => h('button.preset', {
      type: 'button', title: t(pr.name),
      on: { click: (e) => { faceStops = pr.stops.map((x) => ({ ...x })); presetName = t(pr.name); palette = pr.palette || paletteFromStops(pr.stops); faceGrad.setValue(faceStops); for (const b of presetGrid.children) b.classList.toggle('on', b === e.currentTarget); syncFace(); drawPrev(); } },
    }, h('span', { style: { display: 'block', height: '14px', borderRadius: '4px', background: `linear-gradient(90deg, ${pr.stops.map((x) => x.color).join(', ')})` } }), t(pr.name))));
    presetGrid.firstChild.classList.add('on');
    const faceHue = numberField({ label: t('Face colour'), iconName: 'pipette', min: 0, max: 360, unit: '°', slider: true, value: face.hue, title: t('The colour of the letter face to replace'), onInput: (v) => { face.hue = v; swatch(); drawPrev(); }, onChange: () => {} });
    const faceWidth = numberField({ label: t('Range'), def: 38, min: 5, max: 90, unit: '°', slider: true, value: face.width, title: t('How far from that colour still counts as the face'), onInput: (v) => { face.width = v; drawPrev(); }, onChange: () => {} });
    const faceSoft = numberField({ label: t('Softness'), def: 30, min: 0, max: 90, unit: '°', slider: true, value: face.soft, onInput: (v) => { face.soft = v; drawPrev(); }, onChange: () => {} });
    const hueSw = h('span', { style: { width: '22px', height: '22px', borderRadius: '50%', border: '1px solid var(--line-strong)', flex: 'none' } });
    const swatch = () => { hueSw.style.background = `hsl(${face.hue}, 90%, 50%)`; };
    const detectBtn = button({ label: t('Find face colour'), icon: 'wand', onClick: () => { const f = currentFont(); if (f) { face.hue = dominantHue(f); faceHue.setValue(face.hue); swatch(); drawPrev(); } } });
    const faceBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      presetGrid, faceGrad, h('div.row', hueSw, h('div', { style: { flex: 1 } }, faceHue)), faceWidth, faceSoft, detectBtn);
    // range and softness pick the face for a custom gradient; a preset covers the whole design
    const syncFace = () => { for (const x of [faceWidth, faceSoft]) x.style.display = palette ? 'none' : ''; };
    const modeP = pills({ class: 'stretch', value: mode, options: [{ value: 'face', label: t('Face colour') }, { value: 'hsl', label: t('Shift hue') }, { value: 'map', label: t('Gradient map') }], onChange: (v) => { mode = v; sync(); drawPrev(); } });
    const sync = () => {
      for (const x of [hueF, satF, lightF]) x.style.display = mode === 'hsl' ? '' : 'none';
      grad.style.display = mode === 'map' ? '' : 'none';
      faceBox.style.display = mode === 'face' ? '' : 'none';
    };
    const recolor = (img) => {
      const out = cloneImage(img);
      if (mode === 'face' && palette) remapPalette(out.data, face.hue, anchorsFor(currentFont()));
      else if (mode === 'face') recolorRange(out.data, face, faceStops.map((x) => ({ pos: x.pos, color: hexToRgb(x.color) })));
      else if (mode === 'hsl') adjustHsl(out.data, hue, sat / 100, light / 100);
      else gradientMap(out.data, stops.map((x) => ({ pos: x.pos, color: hexToRgb(x.color) })), 1);
      return out;
    };
    const drawPrev = rafThrottle(() => {
      const f = currentFont();
      if (!f) return;
      const tmp = createFont('preview');
      tmp.metrics = { ...f.metrics }; tmp.spacing = { ...f.spacing };
      for (const ch of 'Abc') { const g = f.glyphs.get(ch); if (g && g.image) tmp.glyphs.set(ch, { ...g, id: 'p' + ch, image: recolor(g.image) }); }
      state.fonts.set(tmp.id, tmp);
      drawSample(preview, 'Abc', { fontId: tmp.id, height: 40, maxWidth: 200 });
      state.fonts.delete(tmp.id);
    });
    const make = async (asNew) => {
      const f = currentFont();
      if (!f) return;
      let target = f;
      if (asNew) {
        const suffix = mode === 'face' ? presetName : mode === 'hsl' ? t('Hue') + ' ' + hue : t('Gradient');
        const name = await promptDialog(t('New colour variant'), t('Font name'), `${f.family || f.name} ${suffix}`);
        if (!name) return;
        target = cloneFont(f, name);
        target.family = f.family || f.name;
      } else checkpoint('font:' + f.id, 'Recolour font');
      if (mode === 'face' && palette) anchorsFor(f); // measure on the source font before the copy changes
      for (const g of target.glyphs.values()) if (g.image) { g.image = recolor(g.image); g.rev++; }
      touch(target);
      if (asNew) { addFont(target); saveFontRecord(target); toast(t('Created {name}', { name: target.name }), 'ok'); }
      else { fontChanged(target); emit('fonts'); }
    };
    // back to how the panel opens: Face colour with the first preset, measured on the current font
    const resetRecolor = () => {
      mode = 'face'; hue = 160; sat = 0; light = 0;
      stops = MAP_STOPS.map((x) => ({ ...x }));
      const pr = FACE_PRESETS[0];
      faceStops = pr.stops.map((x) => ({ ...x })); presetName = t(pr.name); palette = pr.palette || paletteFromStops(pr.stops);
      const f = currentFont();
      face = { hue: f ? dominantHue(f) : 205, width: 38, soft: 30 };
      modeP.setValue(mode); hueF.setValue(hue); satF.setValue(sat); lightF.setValue(light); grad.setValue(stops); faceGrad.setValue(faceStops);
      faceHue.setValue(face.hue); faceWidth.setValue(face.width); faceSoft.setValue(face.soft);
      for (const b of presetGrid.children) b.classList.toggle('on', b === presetGrid.firstChild);
      sync(); swatch(); syncFace(); drawPrev();
    };
    sync(); swatch(); syncFace();
    offs.push(on('fonts', () => { const f = currentFont(); if (f && f.id !== lastFontId) { lastFontId = f.id; face.hue = dominantHue(f); faceHue.setValue(face.hue); swatch(); } drawPrev(); }));
    let lastFontId = null;
    setTimeout(() => { const f = currentFont(); if (f) { lastFontId = f.id; face.hue = dominantHue(f); faceHue.setValue(face.hue); swatch(); } drawPrev(); }, 50);
    return section({ id: 'fonts-recolor', title: t('Colour variants'), iconName: 'palette', open: false, onReset: resetRecolor },
      h('p.hint', t('Make a new colour version of the whole font from its artwork, no new sheets needed. A preset recolours the face, rim and 3D depth together; editing the gradient changes only the letter face.')),
      modeP, faceBox, hueF, satF, lightF, grad, preview,
      h('div.row-ctl', button({ label: t('Create variant'), icon: 'plus', kind: 'primary', onClick: () => make(true) }), button({ label: t('Apply to this font'), icon: 'brush', onClick: () => make(false) })));
  }

  // ================= centre: glyph sheet =================
  const searchInput = h('input.text-input.search', { type: 'search', placeholder: t('Find a character'), 'aria-label': t('Find a character'), on: { input: (e) => { search = e.target.value; renderSheet(); }, keydown: (e) => e.stopPropagation() } });
  const filterSel = select({ value: filter, options: GROUP_FILTERS.map((g) => ({ value: g, label: t(GROUP_LABEL[g]) })), onChange: (v) => { filter = v; storeSet('glyphFilter', v); renderSheet(); } });
  const zoomF = numberField({ iconName: 'zoomIn', title: t('Cell size'), min: 56, max: 260, step: 4, unit: 'px', value: state.ui.glyphZoom, onInput: (v) => { state.ui.glyphZoom = v; sheet.style.setProperty('--cell', v + 'px'); renderSheetDebounced(); }, onChange: (v) => setUI({ glyphZoom: v }) });
  zoomF.style.width = '120px';
  const guidesBtn = button({ label: t('Guides'), icon: 'ruler', onClick: (e) => guidesMenu(e.currentTarget) });
  const addBtn = button({ label: t('Add glyphs'), icon: 'imagePlus', onClick: () => addGlyphImages() });
  const testInput = h('input.text-input', { type: 'text', value: storeGet('testText', 'Hello Bubble 123!'), 'aria-label': t('Test text'), placeholder: t('Type to test the font'), on: { input: (e) => { storeSet('testText', e.target.value); drawTest(); }, keydown: (e) => e.stopPropagation() } });
  const testCanvas = h('canvas', { style: { display: 'block', maxWidth: '100%' } });
  const testStrip = h('div', { style: { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '10px', marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } }, testInput, h('div', { style: { overflowX: 'auto' } }, testCanvas));
  const sheetBar = h('div.sheet-bar', searchInput, filterSel, zoomF, guidesBtn, addBtn);
  const sheet = h('div.sheet', { role: 'grid', 'aria-label': t('Glyph sheet') });
  sheet.style.setProperty('--cell', state.ui.glyphZoom + 'px');
  const wrap = h('div.sheet-wrap', testStrip, sheet);
  const stagePane = h('div.stage', { style: { position: 'relative' } }, wrap, sheetBar);
  center.classList.add('no-bottom');
  center.append(stagePane);

  function guidesMenu(anchor) {
    const g = state.ui.guides;
    const items = [['baseline', 'Baseline', '--guide-base'], ['cap', 'Cap height', '--guide-cap'], ['xheight', 'x-height', '--guide-x'], ['ascender', 'Ascender', '--guide-asc'], ['descender', 'Descender', '--guide-desc'], ['advance', 'Advance width', '--muted'], ['bounds', 'Image bounds', '--cyan']];
    menu(anchor, items.map(([k, label]) => ({ label: (g[k] ? '✓ ' : ' ') + t(label), onClick: () => { setUI({ guides: { ...g, [k]: !g[k] } }); renderSheet(); renderInspector(); drawTest(); } })));
  }

  function groupOf(ch) {
    for (const grp of CHARSET_GROUPS) if (grp.chars.includes(ch)) return grp.id;
    return 'other';
  }

  const GROUP_RANK = { upper: 0, lower: 1, digits: 2, punct: 3, symbols: 4, hebrew: 5, other: 6 };
  function visibleChars(font) {
    let chars = sortedChars(font).sort((a, b) => (GROUP_RANK[groupOf(a)] - GROUP_RANK[groupOf(b)]) || a.codePointAt(0) - b.codePointAt(0));
    if (filter === 'missing') {
      const have = new Set(chars.filter((c) => font.glyphs.get(c).image));
      chars = CHARSET_GROUPS.filter((g) => g.id !== 'hebrew' || [...have].some((c) => g.chars.includes(c))).flatMap((g) => g.chars).filter((c) => !have.has(c));
    } else if (filter !== 'all') {
      const grp = CHARSET_GROUPS.find((g) => g.id === filter);
      if (grp) chars = [...grp.chars];
      else chars = chars.filter((c) => groupOf(c) === 'other');
    }
    if (search) chars = chars.filter((c) => c.includes(search) || charLabel(c).toLowerCase().includes(search.toLowerCase()));
    return chars;
  }

  const renderSheetDebounced = rafThrottle(() => renderSheet());
  function renderSheet() {
    clear(sheet);
    const font = currentFont();
    if (!font) { sheet.appendChild(h('div.empty', { style: { gridColumn: '1 / -1' } }, t('No font selected. Import a sheet to create one.'))); return; }
    const chars = visibleChars(font);
    if (!chars.length) sheet.appendChild(h('div.empty', { style: { gridColumn: '1 / -1' } }, filter === 'missing' ? t('Nothing missing in the standard sets.') : t('No glyphs here yet.')));
    const size = state.ui.glyphZoom;
    const cells = [];
    for (const ch of chars) {
      const g = font.glyphs.get(ch);
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const has = g && g.image;
      const cell = h('div.cell', {
        role: 'gridcell', tabIndex: 0, title: `${ch} · ${charLabel(ch)}`, 'aria-label': `${ch} ${charLabel(ch)}${has ? '' : ' ' + t('empty')}`,
        class: (ch === state.selectedGlyph ? 'on ' : '') + (state.selectedGlyphs.has(ch) && ch !== state.selectedGlyph ? 'multi ' : '') + (has ? '' : 'empty-slot'),
        draggable: !!has,
        on: {
          click: (e) => selectGlyph(ch, e),
          keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectGlyph(ch, e); } },
          dragstart: (e) => { e.dataTransfer.setData('text/x-glyph', ch); e.dataTransfer.effectAllowed = 'move'; },
          dragover: (e) => { e.preventDefault(); cell.classList.add('drop-target'); },
          dragleave: () => cell.classList.remove('drop-target'),
          drop: (e) => onCellDrop(e, ch, cell),
        },
      }, canvas, h('div.cell-label', h('b', ch === ' ' ? '␠' : ch), h('span', charLabel(ch).replace('U+', ''))));
      cells.push([canvas, g, ch]);
      sheet.appendChild(cell);
    }
    // draw progressively to keep the UI responsive
    let i = 0;
    const step = () => {
      const end = Math.min(cells.length, i + 24);
      for (; i < end; i++) {
        const [canvas, g, ch] = cells[i];
        drawGlyphOnGuides(canvas, font, g, state.ui.guides, { w: size, h: size, pad: 6, empty: g && g.image ? null : ch });
      }
      if (i < cells.length) requestAnimationFrame(step);
    };
    step();
  }

  async function onCellDrop(e, ch, cell) {
    e.preventDefault();
    cell.classList.remove('drop-target');
    const font = currentFont();
    const from = e.dataTransfer.getData('text/x-glyph');
    if (from && from !== ch) {
      checkpoint('font:' + font.id, 'Move glyph');
      remapGlyph(font, from, ch, { swap: true });
      state.selectedGlyph = ch;
      afterFontEdit(font);
      toast(t('Moved {a} to {b}', { a: from, b: ch }), 'ok', 1800);
      return;
    }
    const files = [...(e.dataTransfer.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) await replaceGlyphFromFile(font, ch, files[0]);
  }

  async function replaceGlyphFromFile(font, ch, file) {
    try {
      const img = await decodeImage(file);
      const cleaned = cleanupAlpha(img, { low: 8, high: 120, minArea: 8 }).image;
      const tr = trimImage(cleaned, 0, 1);
      if (tr.empty) throw new Error(t('That image is fully transparent'));
      checkpoint('font:' + font.id, 'Replace glyph');
      const prev = font.glyphs.get(ch);
      const g = setGlyph(font, ch, tr.image, prev ? { lsb: prev.lsb, rsb: prev.rsb } : {});
      // match the size of neighbours: scale so the height matches the cap height for capitals, x-height for lowercase
      const ref = /[a-z]/.test(ch) ? font.metrics.xHeight : font.metrics.capHeight;
      if (font.glyphs.size > 4 && tr.image.height > ref * 1.6) g.scale = +(ref / tr.image.height).toFixed(4);
      autoMetrics(font);
      state.selectedGlyph = ch;
      afterFontEdit(font);
    } catch (err) { toast(err.message, 'error', 4000); }
  }

  async function addGlyphImages() {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    if (!files.length) return;
    const font = currentFont();
    if (files.length > 1 || !state.selectedGlyph) { openImporter(files); return; }
    const guess = charFromFilename(files[0].name);
    const ch = guess || state.selectedGlyph;
    await replaceGlyphFromFile(font, ch, files[0]);
  }

  function selectGlyph(ch, e) {
    if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      if (state.selectedGlyphs.has(ch)) state.selectedGlyphs.delete(ch); else state.selectedGlyphs.add(ch);
    } else { state.selectedGlyphs.clear(); }
    state.selectedGlyphs.add(ch);
    state.selectedGlyph = ch;
    renderSheet(); renderInspector();
  }

  const drawTest = rafThrottle(() => {
    const font = currentFont();
    if (!font) return;
    const text = testInput.value || ' ';
    const doc = createDoc(text, { font: font.id, size: 100 }, { align: 'left', direction: 'auto' });
    const layout = layoutDoc(doc, { getFont: () => font, mode: 'point' });
    const prep = prepareText({ warp: DEFAULT_WARP }, layout, null);
    const b = inkBounds(layout);
    const box = { x: Math.min(b.x, prep.bounds.x) - 10, y: Math.min(b.y, prep.bounds.y) - 6, w: Math.max(b.w, prep.bounds.w) + 20, h: Math.max(b.h, prep.bounds.h) + 12 };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const hCss = 72;
    const s = (hCss * dpr) / box.h;
    testCanvas.width = Math.max(1, Math.ceil(box.w * s)); testCanvas.height = Math.ceil(box.h * s);
    testCanvas.style.width = testCanvas.width / dpr + 'px'; testCanvas.style.height = hCss + 'px';
    const ctx = testCanvas.getContext('2d');
    const M = new DOMMatrix().scale(s).translate(-box.x, -box.y);
    ctx.setTransform(M);
    const g = state.ui.guides;
    for (const ln of layout.lines) {
      const k = ln.items[0]?.kv || 100 / ((font.metrics.ascender + font.metrics.descender) || 1);
      const lineAt = (y, c) => { ctx.strokeStyle = css(c); ctx.lineWidth = 1 / s; ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke(); };
      ctx.globalAlpha = 0.6;
      if (g.baseline) lineAt(ln.baseline, '--guide-base');
      if (g.xheight) lineAt(ln.baseline - font.metrics.xHeight * k, '--guide-x');
      if (g.cap) lineAt(ln.baseline - font.metrics.capHeight * k, '--guide-cap');
      if (g.descender) lineAt(ln.baseline + font.metrics.descender * k, '--guide-desc');
      ctx.globalAlpha = 1;
    }
    drawPrepared(ctx, prep, M, { showMissing: true, missingColor: css('--accent') });
  });

  // ================= right: inspector =================
  const insp = h('div.panel-scroll');
  right.appendChild(insp);
  let previewInfo = null;

  function renderInspector() {
    clear(insp);
    const font = currentFont();
    if (!font) { insp.appendChild(h('div.empty', t('Import a glyph sheet to create your first font.'))); return; }
    const ch = state.selectedGlyph;
    const g = ch ? font.glyphs.get(ch) : null;
    if (ch) insp.appendChild(glyphSection(font, ch, g));
    insp.appendChild(metricsSection(font));
    if (g && g.image) insp.appendChild(kerningSection(font, g));
  }

  function glyphSection(font, ch, g) {
    const canvas = h('canvas', { 'aria-label': t('Glyph preview. Drag the glyph to move it; drag the right edge line to change spacing.') });
    const pv = h('div.glyph-preview', canvas);
    const redraw = () => {
      const r = pv.getBoundingClientRect();
      previewInfo = drawGlyphOnGuides(canvas, font, font.glyphs.get(ch), { ...state.ui.guides, advance: true }, { w: Math.max(200, r.width || 280), h: 260, pad: 18, empty: ch });
    };
    requestAnimationFrame(redraw);
    // drag to move glyph (baseline / lsb) and the advance line (rsb)
    canvas.addEventListener('pointerdown', (e) => {
      const gg = font.glyphs.get(ch);
      if (!gg || !gg.image || !previewInfo) return;
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const advX = previewInfo.originX + glyphAdvance(font, gg) * previewInfo.scale;
      const mode = Math.abs(x - advX) < 8 ? 'rsb' : 'move';
      const start = { x: e.clientX, y: e.clientY, lsb: gg.lsb, rsb: gg.rsb, baseline: gg.baseline };
      checkpoint('font:' + font.id, mode === 'rsb' ? 'Spacing' : 'Move glyph');
      const mv = (ev) => {
        const dx = (ev.clientX - start.x) / previewInfo.scale, dy = (ev.clientY - start.y) / previewInfo.scale;
        if (mode === 'rsb') gg.rsb = Math.round(start.rsb + dx);
        else {
          gg.lsb = Math.round(start.lsb + (ev.shiftKey ? 0 : dx));
          gg.baseline = start.baseline - (ev.altKey ? 0 : dy) / gg.scale;
          gg.autoBaseline = false;
        }
        gg.rev++; touch(font);
        redraw(); syncFields();
      };
      const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); afterFontEdit(font, true); };
      canvas.addEventListener('pointermove', mv);
      canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('pointermove', (e) => {
      const gg = font.glyphs.get(ch);
      if (!gg || !previewInfo || e.buttons) return;
      const r = canvas.getBoundingClientRect();
      const advX = previewInfo.originX + glyphAdvance(font, gg) * previewInfo.scale;
      canvas.style.cursor = Math.abs(e.clientX - r.left - advX) < 8 ? 'ew-resize' : 'grab';
    });

    const head = h('div.glyph-big', h('b', ch === ' ' ? '␠' : ch), h('span', charLabel(ch)));
    if (!g || !g.image) {
      return section({ id: 'glyph', title: t('Glyph'), iconName: 'shapes' }, head, pv,
        h('p.hint', t('This slot is empty. Drop a PNG onto it in the sheet, paste an image, or choose one.')),
        button({ label: t('Choose image'), icon: 'imagePlus', kind: 'primary', onClick: async () => { const [f] = await pickFiles({ multiple: false }); if (f) replaceGlyphFromFile(font, ch, f); } }));
    }
    const edit = (label, fn, key) => { checkpoint('font:' + font.id, label, key); fn(g); g.rev++; touch(font); afterFontEdit(font, true); redraw(); };
    const charInput = h('input.text-input', { type: 'text', value: ch, maxLength: 8, 'aria-label': t('Character'), on: { keydown: (e) => e.stopPropagation(), change: (e) => {
      const to = e.target.value;
      if (!to || to === ch) return;
      const swap = font.glyphs.has(to);
      checkpoint('font:' + font.id, 'Remap glyph');
      remapGlyph(font, ch, to, { swap: true });
      state.selectedGlyph = to;
      afterFontEdit(font);
      toast(swap ? t('Swapped {a} and {b}', { a: ch, b: to }) : t('Moved {a} to {b}', { a: ch, b: to }), 'ok', 2000);
    } } });
    const fields = {
      baseline: numberField({ label: t('Baseline'), iconName: 'baseline', step: 1, unit: 'px', title: t('Distance from the top of the image down to the baseline'), onInput: (v) => edit('Baseline', (x) => { x.baseline = v / x.scale; x.autoBaseline = false; }, 'gb'), onChange: () => {} }),
      lsb: numberField({ label: t('Left'), iconName: 'moveH', def: 0, step: 1, unit: 'px', title: t('Left side bearing'), onInput: (v) => edit('Spacing', (x) => { x.lsb = v; }, 'gl'), onChange: () => {} }),
      rsb: numberField({ label: t('Right'), iconName: 'moveH', def: 0, step: 1, unit: 'px', title: t('Right side bearing'), onInput: (v) => edit('Spacing', (x) => { x.rsb = v; }, 'gr'), onChange: () => {} }),
      scale: numberField({ label: t('Scale'), iconName: 'zoomIn', def: Math.round((g.baseScale || 1) * 1000) / 10, min: 5, max: 1000, step: 1, unit: '%', onInput: (v) => edit('Scale', (x) => { const top = x.baseline * x.scale; x.scale = v / 100; x.autoScale = false; x.baseline = top / x.scale; }, 'gs'), onChange: () => {} }),
    };
    const autoT = toggle({ label: t('Place automatically'), iconName: 'wand', value: g.autoBaseline, onChange: (v) => { edit('Auto place', (x) => { x.autoBaseline = v; }); if (v) { autoMetrics(font); afterFontEdit(font); } } });
    const detected = { both: 'round top and bottom', top: 'round top', bottom: 'round bottom' }[glyphRound({ ...g, round: null })] || 'flat';
    const roundSel = select({ label: t('Overshoot'), iconName: 'dot', value: g.round || 'auto', options: [{ value: 'auto', label: `${t('Automatic')} (${t(detected)})` }, { value: 'none', label: t('Flat (none)') }, { value: 'both', label: t('Round top and bottom') }, { value: 'top', label: t('Round top') }, { value: 'bottom', label: t('Round bottom') }], onChange: (v) => { edit('Overshoot', (x) => { x.round = v === 'auto' ? null : v; }); autoMetrics(font); afterFontEdit(font); } });
    function syncFields() {
      const gg = font.glyphs.get(ch);
      if (!gg) return;
      fields.baseline.setValue(Math.round(gg.baseline * gg.scale)); fields.lsb.setValue(gg.lsb); fields.rsb.setValue(gg.rsb); fields.scale.setValue(Math.round(gg.scale * 1000) / 10);
      autoT.setValue(gg.autoBaseline);
    }
    syncFields();
    const imgOp = (label, fn) => () => { checkpoint('font:' + font.id, label); g.image = fn(g.image); g.rev++; if (g.autoBaseline) autoMetrics(font); touch(font); afterFontEdit(font); };
    const tools = h('div.tool-grid',
      button({ label: t('Replace image'), icon: 'replace', onClick: async () => { const [f] = await pickFiles({ multiple: false }); if (f) replaceGlyphFromFile(font, ch, f); } }),
      button({ label: t('Duplicate to…'), icon: 'copy', onClick: async () => { const to = await promptDialog(t('Duplicate glyph'), t('Copy “{c}” to character', { c: ch }), ''); if (!to) return; checkpoint('font:' + font.id, 'Duplicate glyph'); duplicateGlyph(font, ch, to); state.selectedGlyph = to; afterFontEdit(font); } }),
      button({ label: t('Flip ↔'), icon: 'flipH', onClick: imgOp('Flip', (im) => flipImage(im, true)) }),
      button({ label: t('Flip ↕'), icon: 'flipV', onClick: imgOp('Flip', (im) => flipImage(im, false)) }),
      button({ label: t('Rotate 90°'), icon: 'rotateCw', onClick: imgOp('Rotate', (im) => rotate90(im, true)) }),
      button({ label: t('Trim edges'), icon: 'crop', onClick: imgOp('Trim', (im) => trimImage(im, 8, 1).image) }),
      button({ label: t('Clean specks'), icon: 'eraser', onClick: imgOp('Clean up', (im) => cleanupAlpha(im, { low: 28, high: 160, minArea: 30 }).image) }),
      button({ label: t('Clear image'), icon: 'squareDashed', onClick: () => { checkpoint('font:' + font.id, 'Clear glyph'); g.image = null; g.rev++; touch(font); afterFontEdit(font); } }),
      button({ label: t('Delete glyph'), icon: 'trash', kind: 'danger', onClick: () => deleteGlyphs([ch]) }),
    );
    // reset: placed automatically again, no extra spacing, its imported size unless the font evened it out
    const resetGlyph = () => {
      edit('Reset glyph', (x) => { x.autoBaseline = true; x.round = null; x.lsb = 0; x.rsb = 0; if (!x.autoScale) x.scale = x.baseScale || 1; });
      autoMetrics(font); afterFontEdit(font); renderInspector();
    };
    return section({ id: 'glyph', title: t('Glyph'), iconName: 'shapes', onReset: resetGlyph, resetLabel: t('Reset placement, spacing and size') }, head, pv,
      h('label.field', h('span', t('Character (type another to remap or swap)')), charInput),
      h('div.grid2', fields.baseline, fields.scale, fields.lsb, fields.rsb), autoT, roundSel,
      h('p.hint', t('Drag the glyph to move it, the dotted right line to change its spacing. Shift locks vertical, Alt locks horizontal.')),
      tools);
  }

  function metricsSection(font) {
    const setM = (label, fn, key) => { checkpoint('font:' + font.id, label, key); fn(font); afterFontEdit(font, true); };
    const mf = (key, label, icn) => {
      const f = numberField({ label, iconName: icn, min: 0, max: 5000, unit: 'u', value: Math.round(font.metrics[key]), onInput: (v) => setM('Metrics', (fo) => { fo.metrics[key] = v; fo.metrics.auto = false; touch(fo); }, 'm' + key), onChange: () => {} });
      return f;
    };
    const os = numberField({ label: t('Overshoot'), iconName: 'dot', min: 0, max: 100, step: 0.5, unit: 'u', value: font.metrics.overshoot ?? 0, title: t('How far round letters go past the guide lines'), onInput: (v) => setM('Overshoot', (fo) => { fo.metrics.overshoot = v; fo.metrics.overshootAuto = false; autoMetrics(fo); }, 'mos'), onChange: () => {} });
    const space = numberField({ label: t('Space width'), iconName: 'arrowsH', min: 0, max: 2000, unit: 'u', value: Math.round(font.spacing.space), onInput: (v) => setM('Space', (fo) => { fo.spacing.space = v; fo.spacing.autoSpace = false; touch(fo); }, 'msp'), onChange: () => {} });
    const name = h('input.text-input', { type: 'text', value: font.name, 'aria-label': t('Font name'), on: { keydown: (e) => e.stopPropagation(), change: (e) => setM('Rename font', (fo) => { fo.name = e.target.value || fo.name; emit('fonts'); }) } });
    const glyphCount = [...font.glyphs.values()].filter((g) => g.image).length;
    const remeasure = () => setM('Auto metrics', (fo) => { fo.metrics.auto = true; fo.metrics.overshootAuto = true; fo.spacing.autoSpace = true; autoMetrics(fo, { force: true }); });
    return section({ id: 'font-metrics', title: t('Font'), iconName: 'settings', onReset: remeasure, resetLabel: t('Reset to the measured values') },
      h('label.field', h('span', t('Name')), name),
      h('p.hint', t('{n} glyphs · units are source pixels', { n: glyphCount })),
      h('div.grid2', mf('capHeight', t('Cap height'), 'caseUpper'), mf('xHeight', t('x-height'), 'caseLower'), mf('ascender', t('Ascender'), 'spaceBefore'), mf('descender', t('Descender'), 'spaceAfter')),
      h('div.grid2', os, space),
      h('div.tool-grid',
        button({ label: t('Auto-place all'), icon: 'wand', onClick: remeasure }),
        button({ label: t('Even out sizes'), icon: 'arrowsV', onClick: () => setM('Even out sizes', (fo) => { const ch = normalizeSizes(fo); autoMetrics(fo); toast(ch.length ? t('Resized {n} glyphs: {list}', { n: ch.length, list: ch.map((c) => c.char).join(' ') }) : t('Sizes are already even'), 'ok', 4000); }) }),
        button({ label: t('Save font file'), icon: 'save', onClick: () => saveFontFile(font) }),
        button({ label: t('Edit in Photoshop'), icon: 'layers', title: t('A PSD the size of one glyph, with every character on its own layer over the guides'), onClick: () => exportPSD(font) }),
        button({ label: t('Update from Photoshop'), icon: 'upload', title: t('Read an edited PSD back into this font, or into a new one'), onClick: () => importPSD(font) }),
      ),
      h('p.hint', t('Even out sizes fixes sheets where each cell was scaled to fill its box, keeping the optical overshoot of round letters.')));
  }

  function kerningSection(font, g) {
    const rows = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const pairs = Object.entries(font.kerning).filter(([k]) => [...k][0] === g.char || [...k][1] === g.char);
    for (const [pair, val] of pairs) {
      const f = numberField({ label: pair, min: -2000, max: 2000, unit: 'u', value: val, onInput: (v) => { checkpoint('font:' + font.id, 'Kerning', 'k' + pair); font.kerning[pair] = v; afterFontEdit(font, true); }, onChange: () => {} });
      rows.appendChild(h('div.row', h('div', { style: { flex: 1 } }, f), iconButton('trash', t('Remove pair'), () => { checkpoint('font:' + font.id, 'Kerning'); delete font.kerning[pair]; afterFontEdit(font); })));
    }
    const other = h('input.text-input', { type: 'text', maxLength: 2, placeholder: 'V', style: { width: '56px' }, 'aria-label': t('Other character'), on: { keydown: (e) => e.stopPropagation() } });
    const add = (left) => {
      const o = other.value;
      if (!o) return;
      const pair = left ? g.char + o : o + g.char;
      const og = font.glyphs.get(o);
      const opt = og ? (left ? opticalKern(font, g, og) : opticalKern(font, og, g)) : 0;
      checkpoint('font:' + font.id, 'Kerning');
      font.kerning[pair] = opt;
      afterFontEdit(font);
    };
    return section({ id: 'glyph-kern', title: t('Kerning pairs (Metrics mode)'), iconName: 'arrowsH', open: false },
      rows.childNodes.length ? rows : h('p.hint', t('No pairs yet. Optical kerning works without pairs; add pairs to fine-tune Metrics kerning.')),
      h('div.row', other, button({ label: g.char + ' + ?', onClick: () => add(true) }), button({ label: '? + ' + g.char, onClick: () => add(false) })),
      h('p.hint', t('New pairs start from the optical value.')));
  }

  async function deleteGlyphs(chars) {
    const font = currentFont();
    if (!font || !chars.length) return;
    if (chars.length > 1 && !(await confirmDialog(t('Delete glyphs'), t('Delete {n} glyphs from {font}?', { n: chars.length, font: font.name }), t('Delete'), true))) return;
    checkpoint('font:' + font.id, 'Delete glyph');
    for (const c of chars) font.glyphs.delete(c);
    state.selectedGlyph = null; state.selectedGlyphs.clear();
    afterFontEdit(font);
  }

  function afterFontEdit(font, light = false) {
    fontChanged(font);
    if (!light) { renderSheet(); renderInspector(); renderList(); }
    else { renderSheetDebounced(); }
    drawTest();
  }

  // paste an image onto the selected glyph
  const onPaste = async (e) => {
    if (state.ui.mode !== 'fonts') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const font = currentFont();
    if (!font || !state.selectedGlyph) { toast(t('Select a glyph slot first, then paste.'), 'info'); return; }
    await replaceGlyphFromFile(font, state.selectedGlyph, item.getAsFile());
  };
  window.addEventListener('paste', onPaste);

  offs.push(
    on('fonts', () => { renderList(); renderSheet(); renderInspector(); drawTest(); }),
    on('theme', () => { renderSheet(); renderInspector(); drawTest(); }),
    on('history', () => { renderSheet(); renderInspector(); drawTest(); }),
    on('key', (e) => {
      if (state.ui.mode !== 'fonts') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedGlyphs.size) { e.preventDefault(); deleteGlyphs([...state.selectedGlyphs]); }
    }),
  );
  exportSlot.replaceChildren(button({ label: t('Use in a title'), icon: 'type', kind: 'primary', onClick: () => { setUI({ mode: 'titles' }); emit('remount'); } }));
  renderList(); renderSheet(); renderInspector(); drawTest();
  return { destroy() { offs.forEach((f) => f()); window.removeEventListener('paste', onPaste); center.classList.remove('no-bottom'); exportSlot.replaceChildren(); } };
}

export { icon, colorField };
