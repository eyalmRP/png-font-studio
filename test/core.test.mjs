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
  const boxed = layoutDoc(doc, { getFont, mode: 'box', width: 560 });
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

test('recolorRange changes the blue face only and keeps the pink base', async () => {
  const { recolorRange } = await import('../src/core/image.js');
  // cyan, blue, magenta base, white highlight
  const px = new Uint8ClampedArray([0, 230, 255, 255, 0, 100, 255, 255, 230, 40, 200, 255, 250, 250, 255, 255]);
  recolorRange(px, { hue: 205, width: 38, soft: 30 }, [{ pos: 0.3, color: [255, 100, 0] }, { pos: 0.75, color: [255, 230, 50] }]);
  assert.ok(px[0] > 200 && px[2] < 120, 'cyan became warm');
  assert.ok(px[4] > 200 && px[6] < 120, 'blue became warm');
  assert.ok(px[0] > px[4] - 1 && px[1] > px[5], 'brighter cyan maps to the lighter end');
  assert.deepEqual([...px.slice(8, 11)], [230, 40, 200], 'magenta base untouched');
  assert.deepEqual([...px.slice(12, 15)], [250, 250, 255], 'white highlight untouched');
});

test('flat green background is detected and removed without a green fringe', async () => {
  const { createImage, detectBackground, removeBackgroundColor } = await import('../src/core/image.js');
  const img = createImage(20, 20);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 0; img.data[i + 1] = 255; img.data[i + 2] = 0; img.data[i + 3] = 255; }
  const set = (x, y, c) => { const i = (y * 20 + x) * 4; img.data.set(c, i); };
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) set(x, y, [40, 120, 255, 255]);
  set(4, 10, [20, 188, 128, 255]); // 50% blend of blue and green
  const bg = detectBackground(img);
  assert.deepEqual(bg, [0, 255, 0]);
  const out = removeBackgroundColor(img, bg);
  assert.equal(out.data[3], 0, 'background gone');
  assert.equal(out.data[(10 * 20 + 10) * 4 + 3], 255, 'letter kept');
  const e = (10 * 20 + 4) * 4;
  assert.ok(out.data[e + 3] > 60 && out.data[e + 3] < 200, 'edge semi-transparent');
  assert.ok(out.data[e + 1] < 160, 'green un-mixed from the edge');
});

test('a grid frame on the edge of a transparent sheet is not taken for a background', async () => {
  const { createImage, detectBackground } = await import('../src/core/image.js');
  const img = createImage(200, 200);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
    if (x < 2 || y < 2 || x > 197 || y > 197) img.data.set([150, 150, 150, 255], (y * 200 + x) * 4);
  }
  assert.equal(detectBackground(img), null);
});

test('half-transparent tinted grid lines are found and kept off the glyphs', async () => {
  const { createImage, detectGrid, extractGlyphs } = await import('../src/core/image.js');
  const W = 300, H = 150, img = createImage(W, H);
  const put = (x, y, c) => img.data.set(c, (y * W + x) * 4);
  // purple 2px lines at alpha 80 (what AI background removal leaves) on a 2×1 grid
  for (let x = 0; x < W; x++) for (const y of [4, 5, 144, 145]) put(x, y, [140, 70, 185, 80]);
  for (let y = 0; y < H; y++) for (const x of [4, 5, 149, 150, 294, 295]) put(x, y, [140, 70, 185, 80]);
  // a glyph whose bottom sits on the bottom line, so the line touches it
  for (let y = 60; y < 144; y++) for (let x = 40; x < 100; x++) put(x, y, [40, 160, 255, 255]);
  const grid = detectGrid(img, { rows: 1, cols: 2 });
  assert.deepEqual(grid.sources.x, ['line', 'line', 'line']);
  assert.deepEqual(grid.sources.y, ['line', 'line']);
  const cells = extractGlyphs(img, grid);
  assert.equal(cells[0].image.width, 62, 'line fragments do not stretch the glyph');
  assert.ok(cells[1].empty, 'nothing but line in the second cell');
});

test('overshoot is measured from the artwork: round and pointed edges overshoot, flat edges do not', async () => {
  const { createImage } = await import('../src/core/image.js');
  const { createGlyph, glyphRound, glyphInk } = await import('../src/core/font.js');
  const draw = (w, h, inside) => {
    const img = createImage(w, h + 6);
    for (let y = 0; y < h + 6; y++) for (let x = 0; x < w; x++) {
      // a soft 3px halo above and below the solid shape must not count as ink
      const a = y < 3 || y >= h + 3 ? 40 : inside(x, y - 3) ? 255 : 0;
      img.data.set([40, 160, 255, a], (y * w + x) * 4);
    }
    return img;
  };
  const r = 50;
  const disc = createGlyph('o', draw(2 * r, 2 * r, (x, y) => (x - r + 0.5) ** 2 + (y - r + 0.5) ** 2 <= r * r));
  const bar = createGlyph('H', draw(80, 100, () => true));
  const arch = createGlyph('n', draw(100, 100, (x, y) => y >= 50 || (x - 49.5) ** 2 + (y - 50) ** 2 <= 50 * 50));
  assert.equal(glyphRound(disc), 'both');
  assert.equal(glyphRound(bar), null);
  assert.equal(glyphRound(arch), 'top');
  assert.deepEqual([glyphInk(bar).t, glyphInk(bar).b], [3, 102], 'halo rows are not ink');
  disc.round = 'none';
  assert.equal(glyphRound(disc), null, 'a manual setting wins');
});
