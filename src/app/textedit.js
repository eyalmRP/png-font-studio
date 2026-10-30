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
export function nudgeSpacing(delta) {
  const layer = selectedLayer();
  const e = state.edit;
  if (!layer || !e) return;
  checkpoint('project', 'Kerning', 'kern:' + layer.id);
  if (e.caret === e.anchor) {
    const i = e.caret; // manual kern belongs to the character after the caret
    if (i <= 0 || i >= layer.doc.chars.length || layer.doc.chars[i] === '\n') return;
    const cur = layer.doc.styles[i]?.kern || 0;
    applyCharStyle(layer.doc, i, i + 1, { kern: cur + delta });
  } else {
    const [s, en] = [Math.min(e.caret, e.anchor), Math.max(e.caret, e.anchor)];
    const st = commonStyle(layer.doc, s, en, ['tracking']);
    applyCharStyle(layer.doc, s, en, { tracking: (st.tracking ?? 0) + delta });
  }
  edited(layer);
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
