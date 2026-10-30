// Import wizard: glyph sheets (full or partial) and single glyph images → a new font or an update to one.
import { h, clear, icon, pickFiles, storeGet, storeSet, rafThrottle } from '../dom.js';
import { t } from '../i18n.js';
import { modal, button, numberField, pills, toggle, select, toast, section } from '../controls.js';
import { state, addFont, emit, checkpoint, fontChanged } from '../../app/store.js';
import { detectGrid, uniformGrid, extractGlyphs, guessGridCount, cleanupAlpha, trimImage, detectBackground, removeBackgroundColor } from '../../core/image.js';
import { LAYOUTS, PROMPT_LAYOUTS, parseMapping, mappingToString } from '../../core/charsets.js';

const ALL_LAYOUTS = [...PROMPT_LAYOUTS, ...LAYOUTS];
import { createFont, setGlyph, autoMetrics, normalizeSizes, rankLayouts, suggestChars, sheetGlyphs } from '../../core/font.js';
import { decodeImage } from '../../storage/files.js';
import { saveFontRecord } from '../../storage/library.js';
import { imageToCanvas } from '../../render/glyphs.js';

const NAMED = { space: ' ', period: '.', comma: ',', colon: ':', semicolon: ';', exclam: '!', question: '?', quotesingle: "'", quotedbl: '"', hyphen: '-', underscore: '_', slash: '/', backslash: '\\', ampersand: '&', at: '@', dollar: '$', percent: '%', asterisk: '*', plus: '+', equal: '=', numbersign: '#', parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', braceleft: '{', braceright: '}', less: '<', greater: '>', bar: '|', tilde: '~', grave: '`', asciicircum: '^', euro: '€', sterling: '£', yen: '¥', sheqel: '₪' };

/** Guess the character from a file name: "A.png", "a_lower.png", "uni05D0.png", "U+0041.png", "exclam.png". */
export function charFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  let m = base.match(/^(?:uni|u\+|U\+|U)([0-9a-fA-F]{4,6})$/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = base.match(/(?:^|[_\-\s])(?:uni|u\+|U\+)([0-9a-fA-F]{4,6})(?:$|[_\-\s])/);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  const lower = base.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  m = base.match(/^(.)[_\-\s]?(lower|lc|small|upper|uc|cap|capital)$/i);
  if (m) return /^(lower|lc|small)$/i.test(m[2]) ? m[1].toLowerCase() : m[1].toUpperCase();
  const cps = [...base];
  if (cps.length === 1) return cps[0];
  return '';
}

const SIMPLE_SETS = [
  { id: 'AZ', name: 'A–Z', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
  { id: 'az', name: 'a–z', chars: [...'abcdefghijklmnopqrstuvwxyz'] },
  { id: '09', name: '0–9', chars: [...'0123456789'] },
  { id: 'AZaz09', name: 'A–Z a–z 0–9', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'] },
  { id: 'heb', name: 'א–ת', chars: [...'אבגדהוזחטיכךלמםנןסעפףצץקרשת'] },
];

export async function openImporter(initialFiles) {
  const items = []; // { file, img, kind, grid, cells, chars, single:{image,char}, recog }
  let active = 0;
  const IMPORT_DEFAULTS = { inset: 3, low: 24, high: 160, minArea: 24, clearLines: true, streaks: true, keyBackground: true, baselineMode: 'auto', baselinePos: 0.82, evenSizes: true, replace: true };
  const opts = storeGet('importOpts', { ...IMPORT_DEFAULTS });
  // a section reset puts its options back and processes the sheets again
  const resetOpts = (keys) => async () => {
    for (const k of keys) opts[k] = IMPORT_DEFAULTS[k];
    storeSet('importOpts', opts);
    for (const x of items) { if (x.bg) x.img = opts.keyBackground ? removeBackgroundColor(x.orig, x.bg) : x.orig; if (x.kind === 'sheet') await processSheet(x, false); }
    renderAll();
  };
  let target = 'new';
  let targetFontId = state.currentFontId;
  let newName = t('My font');

  const drop = h('div.dropzone', icon('imagePlus', 30), h('b', t('Drop glyph sheets or single glyph PNGs here')),
    h('span', t('Sheets are split by their grid. Single images use their file name as the character (A.png, uni05D0.png, exclam.png).')),
    button({ label: t('Choose files'), icon: 'open', kind: 'primary', onClick: async () => addFiles(await pickFiles({ accept: 'image/*', multiple: true })) }));
  const filesRow = h('div.imp-files');
  const stageCanvas = h('canvas');
  const stage = h('div.imp-stage', stageCanvas);
  const cellsEl = h('div.imp-cells');
  const side = h('div.imp-side');
  const main = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 } }, filesRow, stage, cellsEl);
  const layoutEl = h('div.importer', main, side);
  const status = h('p.hint');
  const importBtn = button({ label: t('Import'), icon: 'check', kind: 'primary', onClick: () => doImport() });
  const m = modal({
    title: t('Import glyphs'), iconName: 'imagePlus',
    body: [drop, layoutEl, status],
    actions: [button({ label: t('Cancel'), onClick: () => m.close() }), importBtn],
  });
  layoutEl.hidden = true; importBtn.disabled = true;
  for (const tgt of [drop, m.el]) {
    tgt.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    tgt.addEventListener('dragleave', () => drop.classList.remove('over'));
    tgt.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); });
  }

  async function addFiles(files) {
    if (!files || !files.length) return;
    status.textContent = t('Reading {n} files…', { n: files.length });
    for (const file of files) {
      try {
        const orig = await decodeImage(file);
        // a flat green/magenta background (used when transparency fails) is keyed out automatically
        const bg = detectBackground(orig);
        const img = bg && opts.keyBackground !== false ? removeBackgroundColor(orig, bg) : orig;
        const big = img.width >= 400 && img.height >= 400;
        const gx = guessGridCount(img, 'x'), gy = guessGridCount(img, 'y');
        const isSheet = big && ((gx && gx > 1) || (gy && gy > 1) || (img.width >= 800 && img.height >= 800));
        if (isSheet) {
          const { rows, cols } = sheetShape(img, gx, gy);
          const it = { file, img, orig, bg, kind: 'sheet', rows, cols };
          items.push(it);
          await processSheet(it, true);
        } else {
          const cleaned = cleanupAlpha(img, { low: 8, high: 120, minArea: 8 }).image;
          const tr = trimImage(cleaned, 0, 1);
          items.push({ file, img, orig, bg, kind: 'single', single: { image: tr.empty ? null : tr.image, char: charFromFilename(file.name) } });
        }
      } catch (e) { toast(`${file.name}: ${e.message}`, 'error', 5000); }
    }
    if (newName === t('My font') && items[0]) {
      // name the new font after the first file ("orange-sheet-1.png" → "Orange")
      const stem = items[0].file.name.replace(/\.[^.]+$/, '').replace(/[-_ ]*(sheet)?[-_ ]*\d*$/i, '').replace(/[-_]+/g, ' ').trim();
      if (stem) newName = stem.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    status.textContent = '';
    drop.hidden = items.length > 0;
    layoutEl.hidden = items.length === 0;
    importBtn.disabled = items.length === 0;
    if (items.length) active = Math.min(active, items.length - 1);
    renderAll();
  }

  /**
   * Rows and columns of a sheet. Lines in one direction are sometimes too faint to count (AI background removal
   * fades them); when the counted grid matches no known layout, the other direction completes it from a known
   * layout, provided the rows or columns it adds fall on empty gaps.
   */
  function sheetShape(img, gx, gy) {
    const shapes = [...new Set(ALL_LAYOUTS.map((L) => L.rows + 'x' + L.cols))].map((x) => x.split('x').map(Number));
    const known = (r, c) => shapes.some(([R, C]) => R === r && C === c);
    if (gx > 1 && gy > 1 && known(gy, gx)) return { rows: gy, cols: gx };
    const gapsEmpty = (rows, cols) => {
      const g = detectGrid(img, { rows, cols });
      const empty = (axis, k) => {
        const n = axis === 'x' ? img.height : img.width;
        let a = 0;
        for (let j = 0; j < n; j++) a += img.data[((axis === 'x' ? j * img.width + k : k * img.width + j) * 4) + 3];
        return a / n / 255 < 0.03;
      };
      return g.sources.x.every((src, i) => src !== 'gap' || empty('x', g.xs[i])) && g.sources.y.every((src, i) => src !== 'gap' || empty('y', g.ys[i]));
    };
    const byCols = shapes.filter(([, C]) => C === gx), byRows = shapes.filter(([R]) => R === gy);
    if (gx > 1 && byCols.length === 1 && gapsEmpty(byCols[0][0], gx)) return { rows: byCols[0][0], cols: gx };
    if (gy > 1 && byRows.length === 1 && gapsEmpty(gy, byRows[0][1])) return { rows: gy, cols: byRows[0][1] };
    const cols = gx > 1 ? gx : 6;
    return { rows: gy > 1 ? gy : cols, cols };
  }

  function refFont() {
    const ids = [state.currentFontId, ...state.fontOrder];
    for (const id of ids) { const f = state.fonts.get(id); if (f && [...f.glyphs.values()].filter((g) => g.image).length >= 20) return f; }
    return null;
  }

  /** Index of this sheet's size-reference H (a cell only used to match sizes between sheets), or -1. */
  function refIndexOf(it) {
    const L = it.layout;
    return L && L.ref !== undefined && it.chars && it.chars[L.ref] === 'H' ? L.ref : -1;
  }

  async function processSheet(it, recognise) {
    it.grid = it.gridManual || detectGrid(it.img, { rows: it.rows, cols: it.cols });
    // shapes are assigned to cells by their centre, so glyphs crossing a grid line stay whole
    it.cells = extractGlyphs(it.img, it.grid, { clearLines: opts.clearLines, low: opts.low, high: opts.high, minArea: opts.minArea, streaks: opts.streaks !== false });
    if (recognise || !it.chars || it.chars.length !== it.cells.length) {
      it.chars = it.cells.map(() => null);
      const n = it.cells.length;
      const ref = refFont();
      const candidates = ALL_LAYOUTS.filter((L) => L.chars.length === n);
      it.recog = null;
      if (ref && candidates.length) {
        const ranked = rankLayouts(it.cells.map((c) => c.image), ref, candidates);
        // accept a clear winner: a close match, or one much better than the runner-up (a new design differs in detail)
        if (ranked[0] && (ranked[0].score < 0.12 || (ranked[1] && ranked[0].score < ranked[1].score * 0.7))) {
          it.chars = [...ranked[0].layout.chars];
          it.layout = ranked[0].layout;
          it.recog = { name: ranked[0].layout.name, score: ranked[0].score, from: ref.name };
        }
      }
      if (!it.recog) {
        // fall back to the layouts in order (prompt sheet 1, 2, 3 … or bubble sheet 1, 2 …) for sheets with this many cells
        const idx = items.filter((x) => x.kind === 'sheet' && x.cells && x.cells.length === n).indexOf(it);
        const L = candidates[Math.max(0, idx)] || candidates[0];
        if (L) { it.chars = [...L.chars]; it.layout = L; }
      }
      it.cells.forEach((c, i) => { if (c.empty) it.chars[i] = null; });
    }
  }

  // ---------- rendering ----------
  function renderAll() { renderFiles(); renderSide(); renderStage(); renderCells(); }

  function renderFiles() {
    clear(filesRow);
    items.forEach((it, i) => {
      const c = h('canvas');
      c.width = 64; c.height = 64;
      const src = it.kind === 'sheet' ? it.img : it.single.image || it.img;
      const cv = imageToCanvas(src);
      const k = Math.min(64 / cv.width, 64 / cv.height);
      c.getContext('2d').drawImage(cv, (64 - cv.width * k) / 2, (64 - cv.height * k) / 2, cv.width * k, cv.height * k);
      filesRow.appendChild(h('button.imp-file', { type: 'button', class: i === active ? 'on' : '', title: it.file.name, on: { click: () => { active = i; renderAll(); } } }, c));
    });
    filesRow.appendChild(button({ label: t('Add files'), icon: 'plus', onClick: async () => addFiles(await pickFiles({ accept: 'image/*', multiple: true })) }));
  }

  let view = null;
  const renderStage = rafThrottle(() => {
    const it = items[active];
    if (!it) return;
    stage.hidden = it.kind !== 'sheet';
    if (it.kind !== 'sheet') return;
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(200, r.width), H = Math.max(200, r.height);
    stageCanvas.width = W * dpr; stageCanvas.height = H * dpr;
    const ctx = stageCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const k = Math.min((W - 20) / it.img.width, (H - 20) / it.img.height);
    const ox = (W - it.img.width * k) / 2, oy = (H - it.img.height * k) / 2;
    view = { k, ox, oy };
    ctx.drawImage(imageToCanvas(it.img), ox, oy, it.img.width * k, it.img.height * k);
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    // dim skipped cells, label chars, baseline line in "from sheet" mode
    it.cells.forEach((c, i) => {
      const x = ox + it.grid.xs[c.col] * k, y = oy + it.grid.ys[c.row] * k;
      const w = (it.grid.xs[c.col + 1] - it.grid.xs[c.col]) * k, hh = (it.grid.ys[c.row + 1] - it.grid.ys[c.row]) * k;
      if (!it.chars[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, w, hh); }
      else {
        ctx.fillStyle = css('--accent'); ctx.font = `600 ${Math.max(10, Math.min(16, w / 6))}px ${css('--font-ui')}`;
        ctx.fillText(it.chars[i] === ' ' ? '␠' : it.chars[i], x + 4, y + 14);
      }
      if (opts.baselineMode === 'cell') {
        ctx.strokeStyle = css('--guide-base'); ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(x + 2, y + hh * opts.baselinePos); ctx.lineTo(x + w - 2, y + hh * opts.baselinePos); ctx.stroke(); ctx.setLineDash([]);
      }
    });
    ctx.strokeStyle = css('--cyan'); ctx.lineWidth = 2;
    for (const gx of it.grid.xs) { ctx.beginPath(); ctx.moveTo(ox + gx * k, oy); ctx.lineTo(ox + gx * k, oy + it.img.height * k); ctx.stroke(); }
    for (const gy of it.grid.ys) { ctx.beginPath(); ctx.moveTo(ox, oy + gy * k); ctx.lineTo(ox + it.img.width * k, oy + gy * k); ctx.stroke(); }
  });

  // drag grid lines; click a cell to skip / include it
  stageCanvas.addEventListener('pointerdown', (e) => {
    const it = items[active];
    if (!it || it.kind !== 'sheet' || !view) return;
    const r = stageCanvas.getBoundingClientRect();
    const px = (e.clientX - r.left - view.ox) / view.k, py = (e.clientY - r.top - view.oy) / view.k;
    const tol = 7 / view.k;
    const xi = it.grid.xs.findIndex((x) => Math.abs(x - px) < tol);
    const yi = it.grid.ys.findIndex((y) => Math.abs(y - py) < tol);
    if (xi >= 0 || yi >= 0) {
      stageCanvas.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const qx = (ev.clientX - r.left - view.ox) / view.k, qy = (ev.clientY - r.top - view.oy) / view.k;
        if (xi >= 0) it.grid.xs[xi] = Math.round(Math.max(0, Math.min(it.img.width, qx)));
        else it.grid.ys[yi] = Math.round(Math.max(0, Math.min(it.img.height, qy)));
        it.gridManual = it.grid;
        renderStage();
      };
      const up = async () => { stageCanvas.removeEventListener('pointermove', mv); stageCanvas.removeEventListener('pointerup', up); await processSheet(it, false); renderCells(); renderStage(); };
      stageCanvas.addEventListener('pointermove', mv);
      stageCanvas.addEventListener('pointerup', up);
      return;
    }
    const cell = it.cells.find((c) => px >= it.grid.xs[c.col] && px < it.grid.xs[c.col + 1] && py >= it.grid.ys[c.row] && py < it.grid.ys[c.row + 1]);
    if (cell) {
      const inp = cellsEl.querySelectorAll('input')[cell.index];
      if (inp) { inp.focus(); inp.select(); }
    }
  });
  stageCanvas.addEventListener('pointermove', (e) => {
    const it = items[active];
    if (!it || it.kind !== 'sheet' || !view || e.buttons) return;
    const r = stageCanvas.getBoundingClientRect();
    const px = (e.clientX - r.left - view.ox) / view.k, py = (e.clientY - r.top - view.oy) / view.k;
    const tol = 7 / view.k;
    stageCanvas.style.cursor = it.grid.xs.some((x) => Math.abs(x - px) < tol) ? 'col-resize' : it.grid.ys.some((y) => Math.abs(y - py) < tol) ? 'row-resize' : 'pointer';
  });

  function renderCells() {
    clear(cellsEl);
    const it = items[active];
    if (!it) return;
    if (it.kind === 'single') {
      cellsEl.style.gridTemplateColumns = '';
      const c = h('canvas');
      const cv = it.single.image ? imageToCanvas(it.single.image) : null;
      c.width = 160; c.height = 160;
      if (cv) { const k = Math.min(150 / cv.width, 150 / cv.height); c.getContext('2d').drawImage(cv, (160 - cv.width * k) / 2, (160 - cv.height * k) / 2, cv.width * k, cv.height * k); }
      const inp = h('input', { type: 'text', value: it.single.char, maxLength: 8, 'aria-label': t('Character'), on: { input: (e) => { it.single.char = e.target.value; }, keydown: (e) => e.stopPropagation() } });
      cellsEl.appendChild(h('div.imp-cell', { style: { gridColumn: 'span 2' } }, c, inp));
      cellsEl.appendChild(h('p.hint', { style: { gridColumn: 'span 4', alignSelf: 'center' } }, t('Type the character this image draws.')));
      return;
    }
    cellsEl.style.gridTemplateColumns = `repeat(${Math.min(it.grid.cols, 12)}, minmax(0, 84px))`;
    const ref = refFont();
    it.cells.forEach((cell, i) => {
      const c = h('canvas');
      c.width = 72; c.height = 72;
      if (cell.image) { const cv = imageToCanvas(cell.image); const k = Math.min(66 / cv.width, 66 / cv.height); c.getContext('2d').drawImage(cv, (72 - cv.width * k) / 2, (72 - cv.height * k) / 2, cv.width * k, cv.height * k); }
      const inp = h('input', {
        type: 'text', value: it.chars[i] ?? '', maxLength: 8, 'aria-label': t('Character for cell {n}', { n: i + 1 }), placeholder: cell.empty ? '—' : '?',
        on: { input: (e) => { it.chars[i] = e.target.value || null; box.classList.toggle('skip', !it.chars[i]); renderStage(); syncMapping(); }, keydown: (e) => e.stopPropagation() },
      });
      let low = false;
      if (ref && cell.image && it.chars[i]) {
        const s = suggestChars(cell.image, ref, 1)[0];
        low = s && s.char !== it.chars[i] && it.recog;
      }
      const isRef = i === refIndexOf(it);
      const box = h('div.imp-cell', { class: (!it.chars[i] ? 'skip ' : '') + (low ? 'match-low ' : '') + (isRef ? 'ref' : ''), title: isRef ? t('Size reference') : cell.empty ? t('Empty cell') : '' }, c, inp, isRef ? h('span.imp-ref', t('Size reference')) : null);
      cellsEl.appendChild(box);
    });
  }

  let mappingInput;
  function syncMapping() { const it = items[active]; if (mappingInput && it && it.kind === 'sheet') mappingInput.value = mappingToString(it.chars); }

  function renderSide() {
    clear(side);
    const it = items[active];
    if (!it) return;
    if (it.kind === 'sheet') {
      const rows = numberField({ label: t('Rows'), min: 1, max: 32, value: it.grid.rows, onChange: async (v) => { it.rows = v; it.gridManual = null; await processSheet(it, true); renderAll(); }, onInput: () => {} });
      const cols = numberField({ label: t('Columns'), min: 1, max: 32, value: it.grid.cols, onChange: async (v) => { it.cols = v; it.gridManual = null; await processSheet(it, true); renderAll(); }, onInput: () => {} });
      const even = button({ label: t('Even grid'), icon: 'grid', onClick: async () => { it.gridManual = uniformGrid(it.img.width, it.img.height, it.grid.rows, it.grid.cols); await processSheet(it, false); renderAll(); } });
      const auto = button({ label: t('Detect lines'), icon: 'scan', onClick: async () => { it.gridManual = null; await processSheet(it, false); renderAll(); } });
      side.appendChild(section({ id: 'imp-grid', title: t('Grid'), iconName: 'grid' }, h('div.grid2', rows, cols), h('div.row-ctl', auto, even),
        h('p.hint', t('Drag the blue lines to fix the grid. Partial sheets work too: set the rows and columns you have.'))));

      const presetOpts = [{ value: '', label: t('Choose…') }, ...ALL_LAYOUTS.map((L) => ({ value: L.id, label: `${t(L.name)} (${L.chars.length})` })), ...SIMPLE_SETS.map((S) => ({ value: S.id, label: S.name }))];
      const preset = select({ label: t('Character layout'), iconName: 'layout', value: it.layout?.id || '', options: presetOpts, onChange: (v) => {
        const L = ALL_LAYOUTS.find((x) => x.id === v) || SIMPLE_SETS.find((x) => x.id === v);
        if (!L) return;
        it.layout = L;
        it.chars = it.cells.map((c, i) => (c.empty ? null : L.chars[i] ?? null));
        it.recog = null; renderAll();
      } });
      mappingInput = h('textarea.text-area', { rows: 3, 'aria-label': t('Characters in reading order'), spellcheck: false, on: { keydown: (e) => e.stopPropagation(), change: (e) => { const arr = parseMapping(e.target.value); it.chars = it.cells.map((_, i) => arr[i] ?? null); renderCells(); renderStage(); } } });
      syncMapping();
      const ref = refFont();
      const recogBtn = button({ label: t('Recognise from {font}', { font: ref ? ref.name : t('a font') }), icon: 'fingerprint', disabled: !ref, onClick: () => {
        const r2 = refFont();
        if (!r2) return;
        it.chars = it.cells.map((c) => (c.image ? suggestChars(c.image, r2, 1)[0]?.char ?? null : null));
        // whole-sheet layouts are more reliable than cell-by-cell guesses
        const ranked = rankLayouts(it.cells.map((c) => c.image), r2, ALL_LAYOUTS.filter((L) => L.chars.length === it.cells.length));
        if (ranked[0] && (ranked[0].score < 0.12 || (ranked[1] && ranked[0].score < ranked[1].score * 0.7))) { it.chars = ranked[0].layout.chars.map((ch, i) => (it.cells[i].empty ? null : ch)); it.layout = ranked[0].layout; it.recog = { name: ranked[0].layout.name, score: ranked[0].score, from: r2.name }; }
        else it.recog = null;
        renderAll();
      } });
      side.appendChild(section({ id: 'imp-map', title: t('Characters'), iconName: 'letters' },
        it.recog ? h('p.hint', icon('check', 14), ' ', t('Recognised as {name} by comparing shapes with {font}.', { name: t(it.recog.name), font: it.recog.from })) : null,
        refIndexOf(it) >= 0 ? h('p.hint', t('The H marked “size reference” is not imported. It matches this sheet’s size to your capitals.')) : null,
        preset, recogBtn,
        h('label.field', h('span', t('Characters in reading order (\\s skips a cell)')), mappingInput)));
    }
    const nf = (key, label, o) => numberField({ label, value: opts[key], def: IMPORT_DEFAULTS[key], ...o, onChange: async (v) => { opts[key] = v; storeSet('importOpts', opts); for (const x of items) if (x.kind === 'sheet') await processSheet(x, false); renderAll(); }, onInput: () => {} });
    const anyBg = items.some((x) => x.bg);
    const bgToggle = anyBg ? toggle({ label: t('Remove the flat background colour'), value: opts.keyBackground !== false, onChange: async (v) => {
      opts.keyBackground = v; storeSet('importOpts', opts);
      for (const x of items) if (x.bg) { x.img = v ? removeBackgroundColor(x.orig, x.bg) : x.orig; if (x.kind === 'sheet') await processSheet(x, false); }
      renderAll();
    } }) : null;
    side.appendChild(section({ id: 'imp-clean', title: t('Clean-up'), iconName: 'eraser', open: anyBg, onReset: resetOpts(['keyBackground', 'clearLines', 'streaks', 'low', 'high', 'minArea']) },
      bgToggle,
      toggle({ label: t('Remove grid lines'), value: opts.clearLines, onChange: async (v) => { opts.clearLines = v; storeSet('importOpts', opts); for (const x of items) if (x.kind === 'sheet') await processSheet(x, false); renderAll(); } }),
      toggle({ label: t('Remove thin streaks'), value: opts.streaks !== false, onChange: async (v) => { opts.streaks = v; storeSet('importOpts', opts); for (const x of items) if (x.kind === 'sheet') await processSheet(x, false); renderAll(); } }),
      nf('low', t('Edge threshold'), { min: 0, max: 200, slider: true, title: t('Pixels fainter than this are removed unless they touch the glyph') }),
      nf('high', t('Solid threshold'), { min: 1, max: 255, slider: true }),
      nf('minArea', t('Smallest speck kept'), { min: 0, max: 2000, unit: 'px' })));
    const bl = pills({ class: 'stretch', value: opts.baselineMode, options: [{ value: 'auto', label: t('By character') }, { value: 'cell', label: t('From the sheet') }], onChange: (v) => { opts.baselineMode = v; storeSet('importOpts', opts); renderSide(); renderStage(); } });
    const blPos = opts.baselineMode === 'cell' ? numberField({ label: t('Baseline in cell'), min: 0, max: 100, unit: '%', slider: true, value: Math.round(opts.baselinePos * 100), onInput: (v) => { opts.baselinePos = v / 100; renderStage(); }, onChange: () => storeSet('importOpts', opts) }) : null;
    side.appendChild(section({ id: 'imp-base', title: t('Placement'), iconName: 'baseline', onReset: resetOpts(['baselineMode', 'baselinePos', 'evenSizes']) }, bl, blPos,
      toggle({ label: t('Even out sizes'), value: opts.evenSizes, onChange: (v) => { opts.evenSizes = v; storeSet('importOpts', opts); } }),
      h('p.hint', opts.baselineMode === 'auto' ? t('Each glyph is placed by what it is: letters on the baseline, descenders below it, quotes at the top, maths centred, with overshoot for round shapes.') : t('Use this when the sheet was drawn on a shared baseline. Drag the slider to the baseline.'))));
    // target
    const tgt = pills({ class: 'stretch', value: target, options: [{ value: 'new', label: t('New font'), icon: 'plus' }, { value: 'existing', label: t('Add to font'), icon: 'shapes' }], onChange: (v) => { target = v; renderSide(); } });
    const kids = [tgt];
    if (target === 'new') kids.push(h('label.field', h('span', t('Font name')), h('input.text-input', { type: 'text', value: newName, on: { input: (e) => { newName = e.target.value; }, keydown: (e) => e.stopPropagation() } })));
    else {
      kids.push(select({ label: t('Font'), value: targetFontId, options: state.fontOrder.map((id) => ({ value: id, label: state.fonts.get(id).name })), onChange: (v) => { targetFontId = v; } }));
      kids.push(toggle({ label: t('Replace glyphs it already has'), value: opts.replace, onChange: (v) => { opts.replace = v; storeSet('importOpts', opts); } }));
    }
    side.appendChild(section({ id: 'imp-target', title: t('Import into'), iconName: 'download' }, ...kids));
  }

  function doImport() {
    const sheets = items.filter((it) => it.kind === 'sheet').map((it) => ({ chars: it.chars, cells: it.cells, ref: refIndexOf(it), it }));
    const fh = target === 'existing' ? state.fonts.get(targetFontId)?.glyphs.get('H') : null;
    const glyphs = sheetGlyphs(sheets, fh && fh.image ? fh.image.height * fh.scale : null).map((g) => {
      const it = g.sheet.it, c = g.cell;
      const cellH = it.grid.ys[c.row + 1] - it.grid.ys[c.row];
      return { char: g.char, image: g.image, scale: g.scale, baselineFromTop: opts.baselineMode === 'cell' ? cellH * opts.baselinePos - c.offsetY : null };
    });
    for (const it of items) if (it.kind === 'single' && it.single.image && it.single.char) glyphs.push({ char: it.single.char, image: it.single.image, scale: 1 });
    if (!glyphs.length) { toast(t('Nothing to import: give at least one cell a character.'), 'error'); return; }
    let font;
    if (target === 'new' || !state.fonts.get(targetFontId)) {
      font = createFont(newName || t('My font'));
      font.family = font.name;
    } else {
      font = state.fonts.get(targetFontId);
      checkpoint('font:' + font.id, 'Import glyphs');
    }
    let added = 0, skipped = 0;
    for (const g of glyphs) {
      const prev = font.glyphs.get(g.char);
      if (prev && prev.image && target === 'existing' && !opts.replace) { skipped++; continue; }
      const extra = { scale: g.scale || 1, baseScale: g.scale || 1 };
      if (g.baselineFromTop !== null && g.baselineFromTop !== undefined) Object.assign(extra, { baseline: g.baselineFromTop, autoBaseline: false });
      setGlyph(font, g.char, g.image, extra);
      added++;
    }
    if (opts.evenSizes) normalizeSizes(font);
    autoMetrics(font);
    if (target === 'new' || !state.fonts.has(font.id)) addFont(font);
    else { state.currentFontId = font.id; fontChanged(font); }
    saveFontRecord(font);
    emit('fonts');
    m.close();
    toast(skipped ? t('Imported {n} glyphs into {font} ({s} kept as they were)', { n: added, font: font.name, s: skipped }) : t('Imported {n} glyphs into {font}', { n: added, font: font.name }), 'ok', 4000);
  }

  const ro = new ResizeObserver(() => renderStage());
  ro.observe(stage);
  if (initialFiles && initialFiles.length) addFiles(initialFiles);
}
