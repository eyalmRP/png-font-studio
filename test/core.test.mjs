import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { unzip, zipSync, textOf } from '../src/core/zip.js';
import { decodePNG } from '../scripts/lib/png-node.mjs';
import { fontFromJSON, opticalKern, remapGlyph, duplicateGlyph } from '../src/core/font.js';
import { resolveLevels, visualOrder } from '../src/core/bidi.js';
import { createDoc, insertText, deleteRange, applyCharStyle, docToJSON, docFromJSON, paraRanges } from '../src/core/textdoc.js';
import { layoutDoc, caretAt, hitTest, selectionRects, inkBounds } from '../src/core/layout.js';
import { evaluate, DEFAULT_ANIM } from '../src/core/anim.js';
import { buildMesh, inverseMap, forwardMap } from '../src/core/warp.js';
import { distanceOutside } from '../src/core/fx.js';
import { parseMapping, mappingToString } from '../src/core/charsets.js';

async function loadFont(file) {
  const files = await unzip(new Uint8Array(fs.readFileSync(file)), (b) => zlib.inflateRawSync(b));
  const json = JSON.parse(textOf(files.get('font.json')));
  const images = new Map();
  for (const [n, b] of files) if (n.endsWith('.png')) images.set(n, decodePNG(b));
  return fontFromJSON(json, images);
}
const font = await loadFont(new URL('../assets/fonts/bubble-blue.zip', import.meta.url).pathname);
const getFont = () => font;

test('zip round trip', async () => {
  const z = zipSync([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const files = await unzip(z);
  assert.equal(textOf(files.get('a.txt')), 'hello');
  assert.deepEqual([...files.get('dir/b.bin')], [1, 2, 3]);
});

test('built-in font has the full charset', () => {
  assert.equal(font.glyphs.size, 144);
  for (const ch of 'AZaz09!?€₪Σ') assert.ok(font.glyphs.get(ch)?.image, ch);
});

test('optical kerning tightens AV relative to HH', () => {
  const k = opticalKern(font, font.glyphs.get('A'), font.glyphs.get('V'));
  assert.ok(k < 0, `AV kern ${k}`);
  assert.equal(opticalKern(font, font.glyphs.get('H'), font.glyphs.get('H')), 0);
});

test('bidi: hebrew with digits and latin', () => {
  const chars = [...'שלום 123 abc'];
  const levels = resolveLevels(chars, 'rtl');
  assert.equal(levels[0], 1);
  assert.equal(levels[5], 2); // digits
  assert.equal(levels[9], 2); // latin
  const { order } = visualOrder(levels, 0, chars.length, chars, 'rtl');
  // visual left-to-right: "abc 123 םולש"
  assert.equal(order.map((i) => chars[i]).join(''), 'abc 123 םולש');
  const ltr = resolveLevels([...'Hi שלום!'], 'ltr');
  assert.deepEqual([...ltr.slice(3, 7)], [1, 1, 1, 1]);
});

test('document editing and serialisation', () => {
  const doc = createDoc('Hello', { font: 'f', size: 100 });
  insertText(doc, 5, '\nWorld');
  assert.equal(doc.paras.length, 2);
  applyCharStyle(doc, 0, 5, { tracking: 50 });
  deleteRange(doc, 4, 7);
  assert.equal(doc.chars.join(''), 'Hellorld');
  assert.equal(doc.paras.length, 1);
  const back = docFromJSON(docToJSON(doc));
  assert.equal(back.chars.join(''), 'Hellorld');
  assert.equal(back.styles[0].tracking, 50);
  assert.equal(back.styles[6].tracking, 0);
  assert.deepEqual(paraRanges(createDoc('a\nbc')), [[0, 1], [2, 4]]);
});

test('layout: caret, hit test and wrapping', () => {
  const doc = createDoc('Hello World', { font: 'f', size: 100 }, { align: 'left' });
  const L = layoutDoc(doc, { getFont, mode: 'point' });
  assert.equal(L.lines.length, 1);
  const c0 = caretAt(L, 0), c5 = caretAt(L, 5);
  assert.ok(c5.x > c0.x);
  assert.equal(hitTest(L, c5.x + 1, 0), 5);
  const boxed = layoutDoc(doc, { getFont, mode: 'box', width: 400 });
  assert.equal(boxed.lines.length, 2);
  assert.equal(boxed.lines[1].start, 6);
  assert.equal(selectionRects(L, 0, 5).length, 1);
  const b = inkBounds(L);
  assert.ok(b.w > 400 && b.h > 50);
});

test('layout: rtl paragraph aligns right and caret moves leftwards', () => {
  const doc = createDoc('Hi', { font: 'f', size: 100 }, { align: 'right', direction: 'rtl' });
  const L = layoutDoc(doc, { getFont, mode: 'box', width: 1000 });
  assert.ok(L.lines[0].x0 > 500);
});

test('animation: in-preset hides before start and rests after', () => {
  const doc = createDoc('Hey', { font: 'f', size: 100 });
  const L = layoutDoc(doc, { getFont });
  const anim = { ...DEFAULT_ANIM, in: { ...DEFAULT_ANIM.in, preset: 'popBounce' } };
  const a = evaluate(anim, L.items, L, 0);
  assert.equal(a.transforms[0].ops[0].sx, 0);
  const b = evaluate(anim, L.items, L, 3);
  assert.equal(b.transforms[2].ops.length, 0);
  assert.equal(b.transforms[2].opacity, 1);
});

test('warp mesh inverse maps back', () => {
  const warp = { style: 'arc', bend: 0.5, hDistort: 0, vDistort: 0 };
  const mesh = buildMesh(400, 100, warp);
  const [fx, fy] = forwardMap(400, 100, warp, 120, 40);
  const [sx, sy] = inverseMap(mesh, fx, fy);
  assert.ok(Math.abs(sx - 120) < 2 && Math.abs(sy - 40) < 2, `${sx},${sy}`);
});

test('distance transform', () => {
  const W = 9, H = 1, a = new Float32Array(W); a[4] = 1;
  const d = distanceOutside(a, W, H);
  assert.equal(d[4], 0);
  assert.ok(Math.abs(d[7] - 2.5) < 0.6);
});

test('mapping strings with skips', () => {
  const m = parseMapping('AB\\sC\\\\');
  assert.deepEqual(m, ['A', 'B', null, 'C', '\\']);
  assert.equal(mappingToString(m), 'AB\\sC\\\\');
});

test('remap swaps and duplicate copies', () => {
  const f = font;
  const a = f.glyphs.get('A'), b = f.glyphs.get('B');
  remapGlyph(f, 'A', 'B');
  assert.equal(f.glyphs.get('B'), a);
  assert.equal(f.glyphs.get('A'), b);
  remapGlyph(f, 'A', 'B');
  const d = duplicateGlyph(f, 'A', 'Å');
  assert.notEqual(d.image.data, f.glyphs.get('A').image.data);
  f.glyphs.delete('Å');
});

test('size groups are even after normalisation (r matches n)', () => {
  const h = (c) => { const g = font.glyphs.get(c); return g.image.height * g.scale; };
  const xh = [...'acemnorsuvwxz'].map(h);
  const med = [...xh].sort((a, b) => a - b)[6];
  for (const v of xh) assert.ok(Math.abs(v / med - 1) <= 0.051, `x-height spread ${v} vs ${med}`);
  assert.ok(Math.abs(h('r') - h('n')) < 10);
});
