// Title commands shared by the layer panel, the stage, the inspector and their right-click menus.
import { t, iso } from '../i18n.js';
import { promptDialog, toast } from '../controls.js';
import { state, emit, selectLayer, selectedLayer, checkpoint, projectChanged } from '../../app/store.js';
import { renderLayer, layerMatrix } from '../../render/layer.js';
import { undoToast } from '../undotoast.js';

const newId = (p) => p + Math.random().toString(36).slice(2);

export function duplicateLayer(l = selectedLayer()) {
  if (!l) return;
  checkpoint('project', 'Duplicate layer');
  const json = JSON.parse(JSON.stringify({ ...l, doc: null }));
  const copy = { ...json, id: newId('layer_'), doc: { chars: [...l.doc.chars], styles: [...l.doc.styles], paras: l.doc.paras.map((p) => ({ ...p })), typing: l.doc.typing }, x: l.x + 30, y: l.y + 30, name: l.name + ' ' + t('copy'), rev: 0, layoutRev: 0 };
  const i = state.project.layers.indexOf(l);
  state.project.layers.splice(i + 1, 0, copy);
  projectChanged();
  selectLayer(copy.id);
}

export function deleteLayer(l = selectedLayer()) {
  if (!l) return;
  checkpoint('project', 'Delete layer');
  if (state.edit && state.edit.layerId === l.id) state.edit = null;
  state.project.layers = state.project.layers.filter((x) => x !== l);
  if (state.selectedLayerId === l.id) selectLayer(null);
  projectChanged();
  undoToast(t('Deleted {name}', { name: iso(l.name || t('Text')) }));
}

/** Where a layer can go in the stack: the list is drawn top-down, so the last layer is in front. */
export function canMove(l, where) {
  const L = state.project.layers, i = L.indexOf(l);
  return where === 'front' || where === 'forward' ? i < L.length - 1 : i > 0;
}
export function moveLayer(l, where) {
  const L = state.project.layers, i = L.indexOf(l);
  if (i < 0 || !canMove(l, where)) return;
  checkpoint('project', 'Reorder layers');
  L.splice(i, 1);
  const j = where === 'front' ? L.length : where === 'back' ? 0 : where === 'forward' ? i + 1 : i - 1;
  L.splice(j, 0, l);
  projectChanged();
}

export function toggleVisible(l) { checkpoint('project', 'Visibility'); l.visible = !l.visible; projectChanged('render', l); }
export function toggleLock(l) { l.locked = !l.locked; projectChanged('render', l); }

export async function renameLayer(l) {
  const name = await promptDialog(t('Rename layer'), t('Layer name'), l.name || '');
  if (name == null || !name.trim()) return;
  checkpoint('project', 'Layer');
  Object.assign(l, { name: name.trim(), autoName: false });
  projectChanged('render', l);
}

/** The title's drawn box on the artboard (after warp, rotation and scale). */
export function layerRect(layer) {
  const r = renderLayer(layer, state.time, 1);
  if (!r) return null;
  const M = layerMatrix(layer), rc = r.contentRect;
  const pts = [[rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x, rc.y + rc.h], [rc.x + rc.w, rc.y + rc.h]].map(([x, y]) => M.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function centerLayer(layer, axis) {
  const ab = state.project.artboard;
  const r = layerRect(layer);
  if (!r) return;
  checkpoint('project', 'Align');
  if (axis === 'x') layer.x += ab.w / 2 - (r.x + r.w / 2);
  else layer.y += ab.h / 2 - (r.y + r.h / 2);
  projectChanged('transform', layer);
}

// copy a title's look (effects and warp) onto other titles
let copiedStyle = null;
export const hasCopiedStyle = () => !!copiedStyle;
export function copyStyle(l) {
  copiedStyle = JSON.parse(JSON.stringify({ effects: l.effects || [], warp: l.warp }));
  toast(t('Style copied: right-click another title to paste it'), 'ok');
}
export function pasteStyle(l) {
  if (!copiedStyle) return;
  checkpoint('project', 'Paste style');
  l.effects = copiedStyle.effects.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newId('fx') }));
  if (copiedStyle.warp) l.warp = JSON.parse(JSON.stringify(copiedStyle.warp));
  projectChanged('layout', l);
  emit('selection');
}

/** Right-click items for a title (on the stage or in the layer list). */
export function layerMenuItems(l) {
  return [
    { label: t('Edit text'), icon: 'textCursor', hint: 'Enter', disabled: l.locked, onClick: () => { selectLayer(l.id); emit('edit-layer', l.id); } },
    { label: t('Duplicate'), icon: 'copy', hint: 'Ctrl+D', onClick: () => duplicateLayer(l) },
    { label: t('Rename…'), icon: 'pencil', onClick: () => renameLayer(l) },
    '-',
    { label: t('Copy style'), icon: 'brush', onClick: () => copyStyle(l) },
    { label: t('Paste style'), icon: 'paste', disabled: !hasCopiedStyle() || l.locked, onClick: () => pasteStyle(l) },
    '-',
    { label: t('Bring to front'), icon: 'bringFront', disabled: !canMove(l, 'front'), onClick: () => moveLayer(l, 'front') },
    { label: t('Bring forward'), icon: 'arrowUp', disabled: !canMove(l, 'forward'), onClick: () => moveLayer(l, 'forward') },
    { label: t('Send backward'), icon: 'arrowDown', disabled: !canMove(l, 'backward'), onClick: () => moveLayer(l, 'backward') },
    { label: t('Send to back'), icon: 'sendBack', disabled: !canMove(l, 'back'), onClick: () => moveLayer(l, 'back') },
    '-',
    { label: t('Centre horizontally'), icon: 'arrowsH', disabled: l.locked, onClick: () => centerLayer(l, 'x') },
    { label: t('Centre vertically'), icon: 'arrowsV', disabled: l.locked, onClick: () => centerLayer(l, 'y') },
    '-',
    { label: t('Hidden'), checked: !l.visible, onClick: () => toggleVisible(l) },
    { label: t('Locked'), checked: !!l.locked, onClick: () => toggleLock(l) },
    '-',
    { label: t('Delete'), icon: 'trash', hint: 'Del', danger: true, onClick: () => deleteLayer(l) },
  ];
}
