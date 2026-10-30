// Text editing actions shared by the stage (typing on canvas) and the character/paragraph panels.
import { state, emit, selectedLayer, markLayer, checkpoint, projectChanged } from './store.js';
import {
  insertText, deleteRange, applyCharStyle, applyParaStyle, commonStyle, commonPara, styleAt, nextWordBoundary, wordAt, paraRanges,
} from '../core/textdoc.js';

/** Current target range: the selection while editing, else the whole layer. */
export function targetRange(layer = selectedLayer()) {
  if (!layer) return [0, 0];
  const e = state.edit;
  if (e && e.layerId === layer.id) return [Math.min(e.caret, e.anchor), Math.max(e.caret, e.anchor)];
  return [0, layer.doc.chars.length];
}

export function isCollapsedEdit(layer = selectedLayer()) {
  const e = state.edit;
  return !!(e && layer && e.layerId === layer.id && e.caret === e.anchor);
}

/** Character style values shown in the panel (undefined = mixed). */
export function currentCharStyle(layer = selectedLayer()) {
  if (!layer) return null;
  const e = state.edit;
  if (isCollapsedEdit(layer)) return { ...(e.typing || styleAt(layer.doc, e.caret)) };
  const [s, en] = targetRange(layer);
  if (s === en) return { ...styleAt(layer.doc, s) };
  return commonStyle(layer.doc, s, en);
}

export function currentParaStyle(layer = selectedLayer()) {
  if (!layer) return null;
  const [s, e] = targetRange(layer);
  return commonPara(layer.doc, s, e);
}

/** Apply character style. live = during a drag (coalesced into one undo step). */
export function setChar(patch, coalesceKey) {
  const layer = selectedLayer();
  if (!layer) return;
  checkpoint('project', 'Character style', coalesceKey);
  if (isCollapsedEdit(layer)) {
    const e = state.edit;
    e.typing = Object.freeze({ ...(e.typing || styleAt(layer.doc, e.caret)), ...patch });
    emit('edit');
    return;
  }
  const [s, e] = targetRange(layer);
  if (s === e && layer.doc.chars.length === 0) layer.doc.typing = Object.freeze({ ...layer.doc.typing, ...patch });
  applyCharStyle(layer.doc, s, e, patch);
  if (!state.edit) layer.doc.typing = Object.freeze({ ...layer.doc.typing, ...patch });
  projectChanged('layout', layer);
}

export function setPara(patch, coalesceKey) {
  const layer = selectedLayer();
  if (!layer) return;
  checkpoint('project', 'Paragraph style', coalesceKey);
  const [s, e] = targetRange(layer);
  applyParaStyle(layer.doc, s, e, patch);
  projectChanged('layout', layer);
}

// ---------- typing ----------

function edited(layer) {
  markLayer(layer, 'layout');
  emit('project', { what: 'layout', layer });
  emit('edit');
}

export function typeText(text) {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  checkpoint('project', 'Typing', 'type:' + layer.id);
  const [s, en] = [Math.min(e.caret, e.anchor), Math.max(e.caret, e.anchor)];
  const style = e.typing || (en > s ? layer.doc.styles[s] : styleAt(layer.doc, s));
  deleteRange(layer.doc, s, en);
  e.caret = e.anchor = insertText(layer.doc, s, text, style);
  e.goalX = null;
  if (layer.name === 'Text' || layer.autoName) { layer.name = layer.doc.chars.join('').split('\n')[0].slice(0, 24) || 'Text'; layer.autoName = true; }
  edited(layer);
}

/**
 * Replace a layer's whole text from a plain text box. Only the changed middle part is replaced, so characters
 * that stay keep their own styles and new ones take the style of their neighbour.
 */
export function setLayerText(layer, text) {
  if (!layer) return;
  const doc = layer.doc, old = doc.chars, nw = [...text.replace(/\r\n?/g, '\n')];
  let a = 0;
  while (a < old.length && a < nw.length && old[a] === nw[a]) a++;
  let b = 0;
  while (b < old.length - a && b < nw.length - a && old[old.length - 1 - b] === nw[nw.length - 1 - b]) b++;
  if (a === old.length && a === nw.length) return;
  checkpoint('project', 'Typing', 'box:' + layer.id);
  const style = old.length ? (a > 0 ? doc.styles[a - 1] : doc.styles[0]) : doc.typing;
  deleteRange(doc, a, old.length - b);
  const end = nw.length > a + b ? insertText(doc, a, nw.slice(a, nw.length - b).join(''), style) : a;
  const e = state.edit;
  if (e && e.layerId === layer.id) { e.caret = e.anchor = end; e.goalX = null; }
  if (layer.name === 'Text' || layer.autoName) { layer.name = doc.chars.join('').split('\n')[0].slice(0, 24) || 'Text'; layer.autoName = true; }
  edited(layer);
}

export function deleteText(dir, word = false) {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  let s = Math.min(e.caret, e.anchor), en = Math.max(e.caret, e.anchor);
  if (s === en) {
    if (dir < 0) s = word ? nextWordBoundary(layer.doc, s, -1) : Math.max(0, s - 1);
    else en = word ? nextWordBoundary(layer.doc, en, 1) : Math.min(layer.doc.chars.length, en + 1);
  }
  if (s === en) return;
  checkpoint('project', 'Delete text', 'del:' + layer.id + dir);
  // keep the typing style of what was deleted
  e.typing = layer.doc.styles[s] || e.typing;
  deleteRange(layer.doc, s, en);
  e.caret = e.anchor = s;
  e.goalX = null;
  edited(layer);
}

export function selectedText() {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return '';
  return layer.doc.chars.slice(Math.min(e.caret, e.anchor), Math.max(e.caret, e.anchor)).join('');
}

export function setCaret(pos, extend = false) {
  const e = state.edit;
  if (!e) return;
  e.caret = pos;
  if (!extend) e.anchor = pos;
  e.typing = null;
  emit('edit');
}

export function selectAll() {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  e.anchor = 0; e.caret = layer.doc.chars.length; e.typing = null;
  emit('edit');
}

export function selectWord(pos) {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  const [s, en] = wordAt(layer.doc, pos);
  e.anchor = s; e.caret = en; e.typing = null;
  emit('edit');
}

export function selectParagraph(pos) {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  for (const [s, en] of paraRanges(layer.doc)) if (pos >= s && pos <= en) { e.anchor = s; e.caret = en; break; }
  e.typing = null;
  emit('edit');
}

/** Alt+←/→: kern the pair at a collapsed caret, or track the selection (1/1000 em steps). */
/** The character whose manual kern sits at the caret (the one after it), or -1 when the caret is not between two letters. */
export function kernIndex(layer = selectedLayer()) {
  if (!isCollapsedEdit(layer)) return -1;
  const i = state.edit.caret, c = layer.doc.chars;
  return i > 0 && i < c.length && c[i] !== '\n' && c[i - 1] !== '\n' ? i : -1;
}

/** Set the manual kern of the pair at the caret (1/1000 em). */
export function setPairKern(value, coalesceKey) {
  const layer = selectedLayer();
  const i = kernIndex(layer);
  if (i < 0) return;
  checkpoint('project', 'Kerning', coalesceKey);
  applyCharStyle(layer.doc, i, i + 1, { kern: value });
  edited(layer);
}

/**
 * Alt+←/→: with a caret, kern the pair at it; with a selection, or a title selected but not being edited, add to the
 * tracking of those letters (keeping any differences between them). Returns { kind, value } or null when nothing changed.
 */
export function nudgeSpacing(delta, layer = selectedLayer()) {
  if (!layer) return null;
  const e = state.edit && state.edit.layerId === layer.id ? state.edit : null;
  const doc = layer.doc;
  if (e && e.caret === e.anchor) {
    const i = kernIndex(layer);
    if (i < 0) return null;
    checkpoint('project', 'Kerning', `kern:${layer.id}:${i}`);
    const value = (doc.styles[i].kern || 0) + delta;
    applyCharStyle(doc, i, i + 1, { kern: value });
    edited(layer);
    return { kind: 'kern', value };
  }
  const [s, en] = e ? [Math.min(e.caret, e.anchor), Math.max(e.caret, e.anchor)] : [0, doc.chars.length];
  if (s === en) return null;
  checkpoint('project', 'Tracking', `track:${layer.id}:${s}-${en}`);
  const next = new Map();
  for (let i = s; i < en; i++) {
    const old = doc.styles[i];
    if (!next.has(old)) next.set(old, Object.freeze({ ...old, tracking: (old.tracking || 0) + delta }));
    doc.styles[i] = next.get(old);
  }
  if (e) edited(layer); else projectChanged('layout', layer);
  return { kind: 'tracking', value: commonStyle(doc, s, en, ['tracking']).tracking };
}

export function enterEdit(layerId, caret = null) {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer) return;
  state.selectedLayerId = layerId;
  const n = layer.doc.chars.length;
  const pos = caret === null ? n : caret;
  state.edit = { layerId, caret: pos, anchor: caret === null ? 0 : pos, goalX: null, typing: null };
  emit('selection');
  emit('edit');
}

export function exitEdit() {
  const e = state.edit;
  if (!e) return;
  state.edit = null;
  const layer = state.project.layers.find((l) => l.id === e.layerId);
  if (layer && layer.doc.chars.length === 0) {
    state.project.layers = state.project.layers.filter((l) => l !== layer);
    state.selectedLayerId = null;
    projectChanged();
  }
  emit('selection');
  emit('edit');
}
