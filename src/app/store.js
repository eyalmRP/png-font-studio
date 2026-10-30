// Application state, change events and undo/redo.
import { createDoc, docToJSON, docFromJSON } from '../core/textdoc.js';
import { DEFAULT_WARP } from '../core/warp.js';
import { DEFAULT_ANIM } from '../core/anim.js';
import { newEffect } from '../core/effects-def.js';
import { newId, createGlyph } from '../core/font.js';
import { storeGet, storeSet } from '../ui/dom.js';

const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); }
export function emit(ev, data) { for (const fn of listeners.get(ev) || []) fn(data); }

export const state = {
  ui: {
    mode: storeGet('mode', 'titles'), // titles | fonts
    theme: storeGet('theme', 'dark'),
    rightTab: storeGet('rightTab', 'character'),
    guides: storeGet('guides', { baseline: true, cap: true, xheight: true, ascender: false, descender: true, bounds: false, advance: true }),
    glyphZoom: storeGet('glyphZoom', 96),
  },
  fonts: new Map(),
  fontOrder: [],
  currentFontId: null,
  selectedGlyph: null, // char in the font studio
  selectedGlyphs: new Set(),
  project: null,
  selectedLayerId: null,
  edit: null, // { layerId, caret, anchor, goalX }
  time: 0,
  playing: false,
};

export function setUI(patch) {
  Object.assign(state.ui, patch);
  for (const [k, v] of Object.entries(patch)) storeSet(k, v);
  emit('ui', patch);
}

// ---------- fonts ----------

export function addFont(font, { select = true } = {}) {
  state.fonts.set(font.id, font);
  if (!state.fontOrder.includes(font.id)) state.fontOrder.push(font.id);
  if (select || !state.currentFontId) state.currentFontId = font.id;
  emit('fonts');
}

export function removeFont(id) {
  state.fonts.delete(id);
  state.fontOrder = state.fontOrder.filter((x) => x !== id);
  if (state.currentFontId === id) state.currentFontId = state.fontOrder[0] || null;
  emit('fonts');
}

export const currentFont = () => state.fonts.get(state.currentFontId) || null;
export const getFont = (id) => state.fonts.get(id) || state.fonts.get(state.fontOrder[0]) || null;

export function fontChanged(font, glyph) {
  if (glyph) glyph.rev++;
  font.rev++;
  font.updated = Date.now();
  // every layer using this font must re-layout
  if (state.project) for (const l of state.project.layers) if (layerUsesFont(l, font.id)) markLayer(l, 'layout');
  emit('font', font);
  emit('project');
}

function layerUsesFont(layer, id) {
  if (layer.type !== 'text') return false;
  const first = state.fontOrder[0];
  return layer.doc.styles.some((s) => (s.font || first) === id) || layer.doc.typing.font === id;
}

// ---------- project ----------

export function createProject() {
  return {
    id: newId('proj'),
    name: 'Untitled title',
    artboard: { w: 1920, h: 1080, bg: 'transparent', bgColor: '#20193a', checker: true, safe: false },
    fps: 30,
    duration: 4,
    // Still titles are designed and exported as PNG; Animated titles add entrance, hold and exit animation
    animated: storeGet('animatedDefault', true),
    layers: [],
    rev: 0,
  };
}

export function newTextLayer(text, fontId, x, y, opts = {}) {
  const size = opts.size || 180;
  return {
    id: newId('layer'),
    type: 'text',
    name: text.split('\n')[0].slice(0, 24) || 'Text',
    visible: true,
    locked: false,
    x, y,
    rotation: 0,
    scaleX: 100,
    scaleY: 100,
    opacity: 100,
    blend: 'normal',
    doc: createDoc(text, { font: fontId, size }, { align: opts.align || 'center' }),
    box: { mode: 'point', width: 900 },
    warp: { ...DEFAULT_WARP },
    effects: opts.effects || [],
    anim: JSON.parse(JSON.stringify({ ...DEFAULT_ANIM, end: state.project ? state.project.duration : 4 })),
    rev: 0,
    layoutRev: 0,
  };
}

export function markLayer(layer, what = 'render') {
  layer.rev++;
  if (what === 'layout') layer.layoutRev++;
  if (state.project) state.project.rev++;
}

export const selectedLayer = () => state.project?.layers.find((l) => l.id === state.selectedLayerId) || null;

export function selectLayer(id) {
  if (state.edit && state.edit.layerId !== id) state.edit = null;
  state.selectedLayerId = id;
  emit('selection');
}

export function projectToJSON(p = state.project) {
  return {
    format: 'png-font-studio/title', version: 1,
    ...p,
    layers: p.layers.map((l) => ({ ...l, doc: docToJSON(l.doc), rev: undefined, layoutRev: undefined })),
  };
}

export function projectFromJSON(json) {
  const p = { ...createProject(), ...json, rev: 0 };
  p.artboard = { ...createProject().artboard, ...json.artboard };
  p.layers = (json.layers || []).map((l) => ({
    ...newTextLayer('', null, 0, 0), ...l,
    doc: docFromJSON(l.doc),
    warp: { ...DEFAULT_WARP, ...l.warp },
    anim: { ...JSON.parse(JSON.stringify(DEFAULT_ANIM)), ...l.anim, in: { ...DEFAULT_ANIM.in, ...l.anim?.in }, out: { ...DEFAULT_ANIM.out, ...l.anim?.out }, loop: { ...DEFAULT_ANIM.loop, ...l.anim?.loop } },
    rev: 0, layoutRev: 0,
  }));
  // titles saved before the Still/Animated switch keep their animation
  p.animated = json.animated ?? true;
  delete p.format; delete p.version;
  return p;
}

export function projectChanged(what = 'render', layer) {
  if (layer) markLayer(layer, what);
  else if (state.project) state.project.rev++;
  emit('project', { what, layer });
}

// ---------- undo / redo ----------
// Snapshots: project → JSON; font → shallow glyph copies (glyph images are immutable and shared).

const undoStack = [], redoStack = [];
let lastKey = null, lastTime = 0;

function snapshot(scope) {
  if (scope === 'project') return { project: JSON.stringify(projectToJSON()), selected: state.selectedLayerId };
  const id = scope.slice(5);
  const f = state.fonts.get(id);
  if (!f) return null;
  return {
    meta: { name: f.name, family: f.family, variant: f.variant, metrics: { ...f.metrics }, spacing: { ...f.spacing }, kerning: { ...f.kerning } },
    glyphs: [...f.glyphs.values()].map((g) => ({ ...g })),
  };
}

function restore(scope, snap) {
  if (!snap) return;
  if (scope === 'project') {
    state.project = projectFromJSON(JSON.parse(snap.project));
    state.selectedLayerId = snap.selected;
    if (state.edit && !state.project.layers.some((l) => l.id === state.edit.layerId)) state.edit = null;
    if (state.edit) { const l = selectedLayer(); if (l) { const n = l.doc.chars.length; state.edit.caret = Math.min(state.edit.caret, n); state.edit.anchor = Math.min(state.edit.anchor, n); } }
    emit('selection'); emit('project', { what: 'layout' });
    return;
  }
  const f = state.fonts.get(scope.slice(5));
  if (!f) return;
  Object.assign(f, snap.meta);
  f.metrics = { ...snap.meta.metrics }; f.spacing = { ...snap.meta.spacing }; f.kerning = { ...snap.meta.kerning };
  f.glyphs = new Map(snap.glyphs.map((g) => [g.char, { ...g, rev: g.rev + 1000 }]));
  fontChanged(f);
  emit('fonts');
}

/** Record the state of a scope before a change. coalesce: same key within 700 ms merges into one step. */
export function checkpoint(scope, label, coalesce) {
  const now = Date.now();
  if (coalesce && coalesce === lastKey && now - lastTime < 700) { lastTime = now; return; }
  lastKey = coalesce || null; lastTime = now;
  undoStack.push({ scope, label, before: snapshot(scope) });
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  emit('history');
}

export function undo() {
  const e = undoStack.pop();
  if (!e) return false;
  redoStack.push({ ...e, before: snapshot(e.scope) });
  restore(e.scope, e.before);
  lastKey = null;
  emit('history');
  return e.label;
}

export function redo() {
  const e = redoStack.pop();
  if (!e) return false;
  undoStack.push({ ...e, before: snapshot(e.scope) });
  restore(e.scope, e.before);
  lastKey = null;
  emit('history');
  return e.label;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export { newEffect, createGlyph };
