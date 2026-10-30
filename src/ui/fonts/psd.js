// Photoshop round trip for a font. Export: a PSD the size of one glyph box with every character as a layer (named by
// its character, grouped, one shown at a time) over locked guides, zipped with a short how-to (claude.ai saves .zip,
// not .psd). Import: each character layer, with the layers clipped to it and its mask, becomes the glyph again;
// untouched letters stay exactly as they were, moved ones keep their artwork, edited ones keep their side bearings.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { modal, button, toast } from '../controls.js';
import { CHARSET_GROUPS } from '../../core/charsets.js';
import { glyphFrame, placeGlyph, alphaBox, inkBearings, frameName, parseFrameName, layerChar } from '../../core/glyphframe.js';
import { setGlyph, touch, cloneFont } from '../../core/font.js';
import { createImage } from '../../core/image.js';
import { zipSync, unzip } from '../../core/zip.js';
import { inflateRaw, saveFile, safeName } from '../../storage/files.js';

// the build names the ag-psd script file (it carries a content hash)
const PSD_FILE = typeof __PFS_PSD_FILE__ !== 'undefined' ? __PFS_PSD_FILE__ : 'psd.js';
let loading = null;
function loadPSD() {
  if (window.__pfsPSD) return Promise.resolve(window.__pfsPSD);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PSD_FILE;
    s.onload = () => (window.__pfsPSD ? resolve(window.__pfsPSD) : reject(new Error(t('Could not load the Photoshop file reader'))));
    s.onerror = () => { loading = null; reject(new Error(t('Could not load the Photoshop file reader'))); };
    document.head.appendChild(s);
  });
  return loading;
}

const GROUPS = [['upper', 'Uppercase'], ['lower', 'Lowercase'], ['digits', 'Digits'], ['punct', 'Punctuation'], ['symbols', 'Symbols'], ['hebrew', 'Hebrew'], ['other', 'Other']];
// the app's guide colours
const LINES = [['ascender', 'Ascender', '#9a5cff'], ['capHeight', 'Cap height', '#19a463'], ['xHeight', 'x-height', '#2f7fff'], ['baseline', 'Baseline', '#ff4d6d'], ['descender', 'Descender', '#e08a00']];

const canvasOf = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, hh); return c; };
const toImageData = (img) => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

/** The glyph's pixels as drawn in the frame: { x, y, imageData }. */
function glyphPixels(frame, g) {
  const pl = placeGlyph({ ...frame }, g);
  if (pl.exact) return { x: pl.x, y: pl.y, imageData: toImageData(g.image) };
  const src = canvasOf(g.image.width, g.image.height);
  src.getContext('2d').putImageData(toImageData(g.image), 0, 0);
  const c = canvasOf(pl.w, pl.h);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, pl.w, pl.h);
  return { x: pl.x, y: pl.y, imageData: x.getImageData(0, 0, pl.w, pl.h) };
}

function groupOf(ch) {
  for (const g of CHARSET_GROUPS) if (g.chars.includes(ch)) return g.id;
  return 'other';
}

/** Export the font as a PSD (inside a ZIP with the how-to). Returns 'saved' | 'declined'. */
export async function exportFontPSD(font) {
  const lib = await loadPSD();
  const frame = glyphFrame(font);
  const have = new Map([...font.glyphs].filter(([, g]) => g.image));
  // empty layers for characters the font doesn't have yet (Hebrew only when the font has some)
  const missing = CHARSET_GROUPS.filter((g) => g.id !== 'hebrew' || g.chars.some((c) => have.has(c))).flatMap((g) => g.chars).filter((c) => !have.has(c));
  const shown = have.has('H') ? 'H' : [...have.keys()][0];
  const order = (chars) => chars.sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const groups = [];
  for (const [id, label] of GROUPS) {
    const chars = order([...have.keys()].filter((c) => groupOf(c) === id));
    const empty = order(missing.filter((c) => groupOf(c) === id));
    if (!chars.length && !empty.length) continue;
    // Photoshop lists the last child on top: put the group's first character on top
    const layers = [...chars, ...empty].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).reverse().map((c) => {
      if (!have.has(c)) return { name: c, hidden: true, layerColor: 'gray' };
      const px = glyphPixels(frame, have.get(c));
      return { name: c, left: px.x, top: px.y, imageData: px.imageData, hidden: c !== shown };
    });
    groups.push({ name: t(label), opened: chars.includes(shown), children: layers });
  }

  // guides: lines and labels as locked layers, the same lines as Photoshop guides, and the frame numbers
  const lines = canvasOf(frame.w, frame.h), labels = canvasOf(frame.w, frame.h);
  const lx = lines.getContext('2d'), tx = labels.getContext('2d');
  const rows = new Map();
  for (const [key, name, color] of LINES) {
    const y = frame.lines[key];
    if (y < 0 || y >= frame.h) continue;
    const r = rows.get(y) || { names: [], color };
    r.names.push(t(name));
    rows.set(y, r);
  }
  const fontPx = Math.max(10, Math.round(frame.h / 45));
  tx.font = `${fontPx}px system-ui, sans-serif`;
  tx.textBaseline = 'bottom';
  for (const [y, r] of rows) {
    lx.fillStyle = r.color; lx.fillRect(0, y, frame.w, 1);
    tx.fillStyle = r.color; tx.fillText(r.names.join(' · '), 4, y - 2);
  }
  lx.fillStyle = 'rgba(128,128,128,0.6)';
  for (let y = 0; y < frame.h; y += 6) lx.fillRect(Math.floor(frame.w / 2), y, 1, 3); // centre line, dashed
  const guides = {
    name: t('Guides'), opened: true, layerColor: 'violet', protected: { all: true },
    children: [
      { name: frameName(frame), hidden: true, protected: { all: true } },
      { name: t('Labels'), left: 0, top: 0, imageData: tx.getImageData(0, 0, frame.w, frame.h), opacity: 0.85, protected: { all: true } },
      { name: t('Lines'), left: 0, top: 0, imageData: lx.getImageData(0, 0, frame.w, frame.h), opacity: 0.85, protected: { all: true } },
    ],
  };
  // what other apps show as the preview: the guides with the visible letter
  const comp = canvasOf(frame.w, frame.h);
  const cx = comp.getContext('2d');
  if (shown) { const px = glyphPixels(frame, have.get(shown)); const c = canvasOf(px.imageData.width, px.imageData.height); c.getContext('2d').putImageData(px.imageData, 0, 0); cx.drawImage(c, px.x, px.y); }
  cx.globalAlpha = 0.85; cx.drawImage(lines, 0, 0); cx.drawImage(labels, 0, 0);

  const psd = {
    width: frame.w, height: frame.h,
    children: [...groups.reverse(), guides],
    imageData: cx.getImageData(0, 0, frame.w, frame.h),
    imageResources: { gridAndGuidesInformation: { guides: [...[...rows.keys()].map((y) => ({ location: y, direction: 'horizontal' })), { location: Math.floor(frame.w / 2), direction: 'vertical' }] } },
  };
  const bytes = new Uint8Array(lib.writePsd(psd, { generateThumbnail: false }));
  const base = safeName(font.name, 'font');
  const zip = zipSync([{ name: `${base}.psd`, data: bytes }, { name: 'How to edit in Photoshop.txt', data: howTo(base) }]);
  return saveFile(`${base} for Photoshop.zip`, new Blob([zip], { type: 'application/zip' }));
}

function howTo(base) {
  return [
    `${base}.psd - editing a PNG Font Studio font in Photoshop`,
    '',
    'The document is one glyph box. Every character is a layer named by its character, in groups (Uppercase,',
    'Lowercase, Digits ...). One is shown at a time: turn layers on and off to compare letters with each other',
    'and with the guides. The locked Guides group holds the ascender, cap height, x-height, baseline and descender',
    'lines; they are also Photoshop guides (View > Show > Guides).',
    '',
    'Editing',
    '- Paint, retouch or replace a letter on its own layer, and keep the layer name (the character).',
    '- Moving a letter up or down moves it on the baseline. Left and right spacing comes from the font.',
    '- Layers clipped to a letter (Alt/Option-click between them) and layer masks are merged into the letter.',
    '- Layer styles (fx) and adjustment layers are not read. Rasterize the style first (Layer > Rasterize >',
    '  Layer Style) or apply the adjustment to the letter itself. The app lists any it finds.',
    '- Grey empty layers are characters the font does not have yet: draw on them to add them.',
    '- Keep the canvas size, and keep the "PNG Font Studio frame" layer in the Guides group.',
    '',
    'Back in PNG Font Studio: Fonts > Update from Photoshop, and pick the .psd (or this zip).',
    'Letters you did not change stay exactly as they were.',
    '',
  ].join('\n');
}

/** Find the PSD bytes in a picked file (a .psd, or a zip holding one). */
async function psdBytes(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) return bytes; // 8BPS
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = await unzip(bytes, inflateRaw);
    for (const [name, b] of files) if (/\.psd$/i.test(name) && !name.startsWith('__MACOSX')) return b;
  }
  throw new Error(t('This is not a Photoshop file (.psd)'));
}

const BLEND = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };

/** A layer's pixels (with its mask) on a frame-size canvas. */
function layerCanvas(L, w, hh) {
  const c = canvasOf(w, hh);
  const d = L.imageData;
  if (!d || !d.width || !d.height) return c;
  const x = c.getContext('2d');
  x.putImageData(new ImageData(to8(d), d.width, d.height), L.left || 0, L.top || 0);
  const m = L.mask;
  if (m && !m.disabled && m.imageData && m.imageData.width) {
    // the mask's grey level is the layer's visibility; outside the mask its default colour applies
    const mc = canvasOf(w, hh), mx = mc.getContext('2d');
    mx.fillStyle = `rgba(0,0,0,${(m.defaultColor ?? 255) / 255})`; mx.fillRect(0, 0, w, hh);
    mx.clearRect(m.left || 0, m.top || 0, m.imageData.width, m.imageData.height);
    const md = to8(m.imageData), a = new ImageData(m.imageData.width, m.imageData.height);
    for (let i = 0; i < a.data.length; i += 4) a.data[i + 3] = md[i];
    const tmp = canvasOf(a.width, a.height); tmp.getContext('2d').putImageData(a, 0, 0);
    mx.drawImage(tmp, m.left || 0, m.top || 0);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(mc, 0, 0); x.globalCompositeOperation = 'source-over';
  }
  return c;
}

/** 16-bit and 32-bit layer data as 8-bit RGBA. */
function to8(d) {
  if (d.data instanceof Uint8ClampedArray) return d.data;
  if (d.data instanceof Uint16Array) return Uint8ClampedArray.from(d.data, (v) => v >> 8);
  return Uint8ClampedArray.from(d.data, (v) => Math.round(v * 255));
}

const hasEffects = (L) => !!(L.effects && !L.effects.disabled && Object.entries(L.effects).some(([k, v]) => k !== 'scale' && k !== 'disabled' && (Array.isArray(v) ? v.some((e) => e.enabled !== false) : v && v.enabled !== false)));

/**
 * Read a PSD against a font: which letters changed, moved or are new. Returns
 * { frame, changes: [{ char, kind: 'changed'|'moved'|'new', image, top, dy }], unchanged, notes }.
 */
export async function readFontPSD(font, file) {
  const lib = await loadPSD();
  const psd = lib.readPsd((await psdBytes(file)).slice().buffer, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true, skipLinkedFilesData: true });
  if (psd.colorMode !== undefined && psd.colorMode !== 3) throw new Error(t('Save the PSD in RGB colour mode (Image > Mode > RGB Color)'));
  const notes = [];
  // the frame the PSD was made with; without it, the font's frame now
  let frame = null;
  const walkFrame = (list) => { for (const L of list || []) { const f = parseFrameName(L.name); if (f) frame = f; walkFrame(L.children); } };
  walkFrame(psd.children);
  const fresh = glyphFrame(font);
  if (!frame) { frame = { p: fresh.p, baseline: fresh.baseline, w: fresh.w, h: fresh.h }; notes.push(t('The frame layer is missing, so the letters were placed with the font’s current frame')); }
  if (psd.width !== frame.w || psd.height !== frame.h) throw new Error(t('The canvas size changed ({w}×{h} instead of {fw}×{fh}). Change it back so the letters line up with the font.', { w: psd.width, h: psd.height, fw: frame.w, fh: frame.h }));

  // character layers (the topmost wins when a name repeats) and what is clipped to each
  const found = new Map();
  const walk = (list) => {
    const kids = list || [];
    for (let i = 0; i < kids.length; i++) {
      const L = kids[i];
      if (L.children) { if (!L.children.some((c) => parseFrameName(c.name))) walk(L.children); continue; }
      if (L.clipping) continue;
      const clipped = [];
      for (let j = i + 1; j < kids.length && kids[j].clipping; j++) clipped.push(kids[j]);
      const ch = layerChar(L.name);
      if (!ch) {
        if (L.adjustment && !L.hidden) notes.push(t('Adjustment layer “{name}” is not applied', { name: L.name }));
        else if (L.imageData && L.imageData.width) notes.push(t('Layer “{name}” is not a character name, so it was skipped', { name: L.name }));
        continue;
      }
      if (found.has(ch)) notes.push(t('More than one layer is named “{c}”; the top one was used', { c: ch }));
      found.set(ch, { L, clipped });
    }
  };
  walk(psd.children);

  const changes = [];
  let unchanged = 0;
  for (const [ch, { L, clipped }] of found) {
    // the letter with its clipped layers, as Photoshop shows it (layer styles aside)
    const c = layerCanvas(L, frame.w, frame.h);
    const x = c.getContext('2d');
    if (L.opacity !== undefined && L.opacity < 1) { const tmp = canvasOf(frame.w, frame.h); const tx = tmp.getContext('2d'); tx.globalAlpha = L.opacity; tx.drawImage(c, 0, 0); x.clearRect(0, 0, frame.w, frame.h); x.drawImage(tmp, 0, 0); }
    const base = canvasOf(frame.w, frame.h); base.getContext('2d').drawImage(c, 0, 0);
    if (hasEffects(L)) notes.push(t('“{c}” has layer styles (fx), which are not read: rasterize them first', { c: ch }));
    for (const C of clipped) {
      if (C.hidden) continue;
      if (C.adjustment) { notes.push(t('Adjustment layer “{name}” on “{c}” is not applied', { name: C.name, c: ch })); continue; }
      if (hasEffects(C)) notes.push(t('“{c}” has layer styles (fx), which are not read: rasterize them first', { c: ch }));
      const cc = layerCanvas(C, frame.w, frame.h), ccx = cc.getContext('2d');
      ccx.globalCompositeOperation = 'destination-in'; ccx.drawImage(base, 0, 0);
      x.globalAlpha = C.opacity ?? 1;
      x.globalCompositeOperation = BLEND[C.blendMode] || 'source-over';
      x.drawImage(cc, 0, 0);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    }
    const all = x.getImageData(0, 0, frame.w, frame.h);
    const box = alphaBox(all);
    if (!box) continue; // an empty layer changes nothing
    const w = box.r - box.l + 1, hh = box.b - box.t + 1;
    const img = createImage(w, hh, x.getImageData(box.l, box.t, w, hh).data);
    const old = font.glyphs.get(ch);
    if (!old || !old.image) { changes.push({ char: ch, kind: 'new', image: img, top: box.t }); continue; }
    // compare with the letter as exported
    const px = glyphPixels(frame, old);
    const ob = alphaBox(px.imageData);
    const same = ob && ob.r - ob.l + 1 === w && ob.b - ob.t + 1 === hh && samePixels(px.imageData, ob, img);
    if (same && px.x + ob.l === box.l && px.y + ob.t === box.t) { unchanged++; continue; }
    // a sideways move changes nothing: the spacing comes from the font
    if (same) { const dy = px.y + ob.t - box.t; if (dy) changes.push({ char: ch, kind: 'moved', dy }); else unchanged++; continue; }
    changes.push({ char: ch, kind: 'changed', image: img, top: box.t });
  }
  return { frame, changes, unchanged, notes: [...new Set(notes)] };
}

/** Same artwork, allowing for 8-bit rounding of half-transparent colours. */
function samePixels(d, ob, img) {
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = ((ob.t + y) * d.width + ob.l + x) * 4, j = (y * img.width + x) * 4;
    const a = d.data[i + 3], b = img.data[j + 3];
    if (Math.abs(a - b) > 1) return false;
    if (a > 8) for (let k = 0; k < 3; k++) if (Math.abs(d.data[i + k] - img.data[j + k]) * a > 3 * 255) return false;
  }
  return true;
}

/** Put the changes into a font (mutates it). */
export function applyPSD(font, res) {
  const { frame } = res;
  const scale = 1 / frame.p;
  // new characters take the font's typical side bearings
  const bear = [...font.glyphs.values()].filter((g) => g.image).map(inkBearings);
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
  const typical = { left: med(bear.map((b) => b.left)), right: med(bear.map((b) => b.right)) };
  for (const c of res.changes) {
    const old = font.glyphs.get(c.char);
    if (c.kind === 'moved') {
      old.baseline += c.dy / (old.scale * frame.p);
      old.autoBaseline = false;
      touch(font, old);
      continue;
    }
    const b = old && old.image ? inkBearings(old) : typical;
    setGlyph(font, c.char, c.image, {
      lsb: b.left, rsb: b.right, scale, baseScale: scale, sx: 1, baseline: frame.baseline - c.top, autoBaseline: false,
      round: old ? old.round ?? null : null,
    });
  }
  touch(font);
  return font;
}

/** Pick a PSD, show what changes, then update the font or save the result as a new font. */
export async function updateFromPSD(font, file, { beforeUpdate, onApply }) {
  toast(t('Reading {name}…', { name: file.name }), 'info', 2500);
  const res = await readFontPSD(font, file);
  const count = (k) => res.changes.filter((c) => c.kind === k);
  const list = (k, label) => { const cs = count(k); return cs.length ? h('p.psd-row', h('b', label(cs.length)), ' ', h('span.psd-chars', cs.map((c) => c.char).join(' '))) : null; };
  const body = [
    list('changed', (n) => t('{n} changed:', { n })), list('moved', (n) => t('{n} moved up or down:', { n })), list('new', (n) => t('{n} new:', { n })),
    h('p.hint', t('{n} letters are unchanged and stay exactly as they were.', { n: res.unchanged })),
    res.notes.length ? h('div', h('b', t('Not read from the file')), h('ul.psd-notes', res.notes.map((n) => h('li', n)))) : null,
  ].filter(Boolean);
  if (!res.changes.length) body.unshift(h('p', t('Nothing changed in this file.')));
  const apply = (asNew) => {
    if (!asNew && beforeUpdate) beforeUpdate();
    const target = asNew ? cloneFont(font, `${font.name} (Photoshop)`) : font;
    if (asNew) target.family = font.family || font.name;
    onApply(applyPSD(target, res), asNew);
    m.close();
  };
  const m = modal({
    title: t('Update from Photoshop'), iconName: 'layers', class: 'modal-md', body,
    actions: res.changes.length
      ? [button({ label: t('Cancel'), onClick: () => m.close() }),
        button({ label: t('Save as a new font'), kind: font.builtin ? 'primary' : '', onClick: () => apply(true) }),
        button({ label: t('Update {name}', { name: font.name }), kind: font.builtin ? '' : 'primary', onClick: () => apply(false) })]
      : [button({ label: t('Close'), onClick: () => m.close() })],
  });
}
