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
import { buildMesh, inverseMap, forwardMap, fitWarpToBox, warpLocal } from '../src/core/warp.js';
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

test('palette transfer recolours each colour band of a design towards its target', async () => {
  const { remapPalette } = await import('../src/core/recolor.js');
  // a cyan face pixel, a dark blue rim pixel and a white highlight
  const data = new Uint8ClampedArray([40, 220, 255, 255, 20, 30, 120, 255, 250, 250, 255, 255]);
  const anchors = [{ d: 0, hue: 45, k: 1, m: 0.6, y: 0.7, g: 1 }, { d: 50, hue: 10, k: 0.8, m: 0.2, y: 0.3, g: 1.5 }];
  remapPalette(data, 190, anchors);
  const hueOf = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn; const h = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; return (h * 60 + 360) % 360; };
  assert.ok(Math.abs(hueOf(data[0], data[1], data[2]) - 45) < 6, 'face becomes the face target');
  assert.ok(hueOf(data[4], data[5], data[6]) < 30, 'rim becomes the rim target');
  assert.deepEqual([...data.slice(8, 11)], [250, 250, 255], 'white highlight stays');
});

test('warp refitted to a padded box bends the text the same way', () => {
  const frame = { x: -500, y: -80, w: 1000, h: 160 };
  const tall = { x: -500, y: -280, w: 1000, h: 560 };
  // an arc is a circle around the box centre: extra height leaves it alone, extra width needs a stronger bend
  const arc = { style: 'arc', bend: 0.5, hDistort: 0, vDistort: 0 };
  assert.ok(Math.abs(fitWarpToBox(frame, tall, arc).warp.bend - 0.5) < 1e-3);
  const wide = fitWarpToBox(frame, { x: -560, y: -80, w: 1120, h: 160 }, arc);
  assert.ok(Math.abs(wide.warp.bend - 0.56) < 2e-3 && wide.err < 0.05);
  // a flag's swing scales with the box height
  const flag = fitWarpToBox(frame, tall, { style: 'flag', bend: 0.5, hDistort: 0, vDistort: 0 });
  assert.ok(Math.abs(flag.warp.bend - 0.5 * 160 / 560) < 2e-3 && flag.err < 0.05);
  const [x, y] = warpLocal(tall, flag.warp, 250, 30), [ex, ey] = warpLocal(frame, { ...flag.warp, bend: 0.5 }, 250, 30);
  assert.ok(Math.hypot(x - ex, y - ey) < 0.05);
  // the box the app bends needs no change
  assert.ok(Math.abs(fitWarpToBox(frame, frame, { style: 'twist', bend: 0.4, hDistort: 0, vDistort: 0 }).warp.bend - 0.4) < 1e-6);
});

test('Photoshop glyph frame: shared baseline, finest resolution, frame numbers survive a layer name', async () => {
  const { glyphFrame, placeGlyph, frameName, parseFrameName, layerChar, inkBearings, alphaBox } = await import('../src/core/glyphframe.js');
  const { createFont, createGlyph } = await import('../src/core/font.js');
  const img = (w, hh, fill = (x, y) => x >= 2 && x < w - 2) => {
    const data = new Uint8ClampedArray(w * hh * 4);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (fill(x, y)) data.set([200, 40, 90, 255], (y * w + x) * 4);
    return { width: w, height: hh, data };
  };
  const font = createFont('t');
  font.glyphs.set('A', createGlyph('A', img(100, 160), { scale: 1, baseline: 155, lsb: 4, rsb: 6 }));
  font.glyphs.set('g', createGlyph('g', img(60, 120), { scale: 0.8, baseline: 80, lsb: 3, rsb: 3 }));
  const fr = glyphFrame(font);
  assert.ok(Math.abs(fr.p - 1.25) < 1e-9); // the finer glyph (0.8 units per pixel) sets the resolution
  for (const g of font.glyphs.values()) {
    const pl = placeGlyph(fr, g);
    // the glyph's own baseline row lands on the frame baseline, inside the canvas
    assert.ok(Math.abs(pl.y + g.baseline * g.scale * fr.p - fr.baseline) <= 0.5);
    assert.ok(pl.x >= 0 && pl.y >= 0 && pl.x + pl.w <= fr.w && pl.y + pl.h <= fr.h);
  }
  assert.equal(placeGlyph(fr, font.glyphs.get('g')).exact, true); // drawn 1:1
  assert.equal(placeGlyph(fr, font.glyphs.get('A')).exact, false); // scaled up 1.25×, never down
  const back = parseFrameName(frameName(fr));
  assert.deepEqual(back, { p: fr.p, baseline: fr.baseline, w: fr.w, h: fr.h });
  assert.equal(parseFrameName('Layer 1'), null);
  assert.equal(layerChar('A'), 'A');
  assert.equal(layerChar(' ש '), 'ש');
  assert.equal(layerChar('U+20AA'), '₪');
  assert.equal(layerChar('A copy'), null);
  // bearings are measured to the visible pixels: 2 transparent columns each side here
  assert.deepEqual(inkBearings(font.glyphs.get('A')), { left: 6, right: 8 });
  assert.deepEqual(alphaBox(img(10, 4)), { l: 2, t: 0, r: 7, b: 3 });
});

test('Photoshop sheet: each group starts a row, and the sheet numbers survive a layer name', async () => {
  const { sheetCells, sheetName, parseSheetName } = await import('../src/core/glyphframe.js');
  const { cols, rows, cells } = sheetCells([[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], [...'0123456789'], [], ['!']], 13);
  assert.equal(cols, 13);
  assert.equal(rows, 4); // 2 rows of capitals, then the digits, then '!'
  const at = Object.fromEntries(cells.map((c) => [c.char, [c.col, c.row]]));
  assert.deepEqual([at.A, at.M, at.N, at.Z, at['0'], at['9'], at['!']], [[0, 0], [12, 0], [0, 1], [12, 1], [0, 2], [9, 2], [0, 3]]);
  const frame = { p: 1.3956043956043958, baseline: 384, w: 435, h: 555 };
  assert.deepEqual(parseSheetName(sheetName(frame, 13)), { ...frame, cols: 13 });
  assert.equal(parseSheetName('PNG Font Studio frame · p=1'), null);
});
