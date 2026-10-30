import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, newTextLayer, createProject, undo } from '../src/app/store.js';
import { nudgeSpacing, kernIndex, setPairKern, enterEdit, setCaret } from '../src/app/textedit.js';

const setup = () => {
  state.project = createProject();
  const l = newTextLayer('Hello', 'f', 0, 0);
  state.project.layers.push(l);
  state.selectedLayerId = l.id;
  state.edit = null;
  return l;
};
const kerns = () => state.project.layers[0].doc.styles.map((s) => s.kern || 0);
const tracks = () => state.project.layers[0].doc.styles.map((s) => s.tracking || 0);

test('Alt+←/→ kerns the pair at the caret, the same pair the Pair kern field shows', () => {
  const l = setup();
  enterEdit(l.id, 2);
  assert.equal(kernIndex(l), 2);
  assert.deepEqual(nudgeSpacing(20), { kind: 'kern', value: 20 });
  nudgeSpacing(20);
  assert.deepEqual(kerns(), [0, 0, 40, 0, 0]);
  setPairKern(-15);
  assert.deepEqual(kerns(), [0, 0, -15, 0, 0]);
});

test('no pair at the ends of the text: nothing changes', () => {
  const l = setup();
  enterEdit(l.id, 0);
  assert.equal(nudgeSpacing(20), null);
  setCaret(5);
  assert.equal(kernIndex(l), -1);
  assert.equal(nudgeSpacing(20), null);
  assert.deepEqual(kerns(), [0, 0, 0, 0, 0]);
});

test('a selection, or the title when not editing, gets tracking added to what each letter has', () => {
  const l = setup();
  enterEdit(l.id, 1); setCaret(3, true);
  nudgeSpacing(20);
  state.edit = null;
  assert.deepEqual(nudgeSpacing(100), { kind: 'tracking', value: undefined });
  assert.deepEqual(tracks(), [100, 120, 120, 100, 100]);
});

test('each pair is its own undo step', () => {
  const l = setup();
  enterEdit(l.id, 1); nudgeSpacing(20); nudgeSpacing(20);
  setCaret(2); nudgeSpacing(-20);
  undo();
  assert.deepEqual(kerns(), [0, 40, 0, 0, 0]);
});
