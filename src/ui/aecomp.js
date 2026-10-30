// After Effects export: a ZIP with the letter images a title uses and a script that builds the composition.
// Each title becomes a precomp with one layer per letter (its animation as keyframes). The warp and the effects
// go on top as After Effects' Warp effect, layer styles and effects, so everything stays editable. Titles with
// a 3D extrude, long shadow or reflection get a title comp that holds those as stacks of copies of the title.
import { t } from './i18n.js';
import { getLayout, getFrame, hasAnim, layerVisibleAt, renderLayer } from '../render/layer.js';
import { prepareText } from '../render/text.js';
import { glyphCanvas } from '../render/glyphs.js';
import { evaluate } from '../core/anim.js';
import { isEnvelopeWarp } from '../core/warp.js';
import { effectMargin } from '../core/effects-def.js';
import { canvasToBlob, safeName } from '../storage/files.js';
import { zipSync } from '../core/zip.js';
import { hexToRgb } from './controls.js';

// After Effects' Warp effect has the Photoshop styles, in this order
const AE_WARPS = ['arc', 'arcLower', 'arcUpper', 'arch', 'bulge', 'shellLower', 'shellUpper', 'flag', 'wave', 'fish', 'rise', 'fisheye', 'inflate', 'squeeze', 'twist'];
const AE_BLEND = {
  normal: 'NORMAL', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY', darken: 'DARKEN', lighten: 'LIGHTEN', 'color-dodge': 'COLOR_DODGE',
  'color-burn': 'COLOR_BURN', 'hard-light': 'HARD_LIGHT', 'soft-light': 'SOFT_LIGHT', difference: 'DIFFERENCE', exclusion: 'EXCLUSION',
  hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
};
// copies per extrude or long shadow (one per pixel up to this)
const MAX_COPIES = 300;
const rgb01 = (hex) => hexToRgb(hex).map((v) => +(v / 255).toFixed(4));
const r4 = (v) => Math.round(v * 1e4) / 1e4;
// Gaussian Blur's Blurriness is about 1/0.3 of the standard deviation
const blurriness = (sigmaPx) => r4(sigmaPx / 0.3);
// the app's angles point like Photoshop's (90 = up); an Angle Control dial has 0 = up, clockwise
const dial = (deg) => r4(90 - deg);

/** Keep the keys where a value changes (drop the inside of runs that hold still). */
function track(times, values) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (values.every((v) => same(v, values[0]))) return { v: values[0] };
  const tt = [], vv = [];
  for (let i = 0; i < values.length; i++) {
    if (i > 0 && i < values.length - 1 && same(values[i], values[i - 1]) && same(values[i], values[i + 1])) continue;
    tt.push(r4(times[i])); vv.push(values[i]);
  }
  return { t: tt, v: vv };
}

/**
 * A 2×2 matrix as After Effects' rotation · scale · skew: R(rot) · diag(sx, sy) · [[1, h], [0, 1]], with the
 * shear as the Transform effect's Skew (axis 0, positive leans right: x' = x − tan(skew) · y).
 */
function decompose(a, b, c, d) {
  const sx = Math.hypot(a, b), rot = Math.atan2(b, a);
  const sy = -c * Math.sin(rot) + d * Math.cos(rot);
  const m = c * Math.cos(rot) + d * Math.sin(rot);
  return { sx, sy, rot: (rot * 180) / Math.PI, skew: (-Math.atan(m / (sx || 1e-9)) * 180) / Math.PI };
}

/** A letter image with the faux-italic slant drawn in (After Effects layers cannot shear). */
function slanted(canvas, skewDeg, r) {
  const k = Math.tan((-skewDeg * Math.PI) / 180); // the stage applies skewX(-skew) around the baseline
  const px = canvas.width / r.w, py = canvas.height / r.h;
  // x' = x + k (y − baseline); find the horizontal extent of the slanted rect
  const shiftTop = k * (r.y - r.baseline), shiftBottom = k * (r.y + r.h - r.baseline);
  const minShift = Math.min(shiftTop, shiftBottom), maxShift = Math.max(shiftTop, shiftBottom);
  const out = document.createElement('canvas');
  out.width = Math.ceil(canvas.width + (maxShift - minShift) * px); out.height = canvas.height;
  // canvas pixel (u, v) → local (r.x + u/px, r.y + v/py) → slanted, then back to pixels from r.x + minShift
  out.getContext('2d').setTransform(1, 0, (k * px) / py, 1, (shiftTop - minShift) * px, 0);
  out.getContext('2d').drawImage(canvas, 0, 0);
  return { canvas: out, rect: { x: r.x + minShift, y: r.y, w: out.width / px, h: r.h } };
}

/** Ink box of a rendered layer in title units (alpha above thr), or null. */
function inkOf(r, thr) {
  if (!r) return null;
  const c = r.canvas, s = c.width / r.rect.w;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] <= thr) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return null;
  return { x0: r.rect.x + x0 / s, y0: r.rect.y + y0 / s, x1: r.rect.x + (x1 + 1) / s, y1: r.rect.y + (y1 + 1) / s };
}

/**
 * Layer styles and effects for a title's effect stack. Styles are 'content' (inside the letters) or 'outside';
 * extrude, long shadow and reflection are built from copies of the title, and the blur comes back on its own.
 */
function effectsFor(layer, q, notes) {
  const styles = [], fx = [];
  let blur = 0;
  const px = (v) => r4(v * q);
  for (const e of [...layer.effects].reverse()) {
    if (!e.enabled) continue;
    switch (e.type) {
      case 'stroke':
        styles.push({ kind: 'stroke', group: e.position === 'inside' ? 'content' : 'outside', color: rgb01(e.fill === 'gradient' ? e.gradient[0].color : e.color), size: px(e.size), opacity: e.opacity, position: { outside: 1, inside: 2, center: 3 }[e.position] || 1 });
        if (e.fill === 'gradient') notes.push(`${layer.name}: the gradient stroke became a solid stroke`);
        break;
      case 'dropShadow': styles.push({ kind: 'dropShadow', group: 'outside', color: rgb01(e.color), opacity: e.opacity, angle: e.angle, distance: px(e.distance), spread: e.spread, size: px(e.size) }); break;
      case 'outerGlow': styles.push({ kind: 'outerGlow', group: 'outside', color: rgb01(e.color), opacity: e.opacity, spread: e.spread, size: px(e.size) }); break;
      case 'innerShadow': styles.push({ kind: 'innerShadow', group: 'content', color: rgb01(e.color), opacity: e.opacity, angle: e.angle, distance: px(e.distance), choke: e.choke, size: px(e.size) }); break;
      case 'innerGlow': styles.push({ kind: 'innerGlow', group: 'content', color: rgb01(e.color), opacity: e.opacity, choke: e.choke, size: px(e.size), source: e.source === 'center' ? 1 : 2 }); break;
      case 'bevel': styles.push({ kind: 'bevel', group: 'content', depth: e.depth, size: px(e.size), soften: px(e.soften), angle: e.angle, altitude: e.altitude, highlight: rgb01(e.highlight), highlightOpacity: e.highlightOpacity, shadow: rgb01(e.shadow), shadowOpacity: e.shadowOpacity }); break;
      case 'colorOverlay': styles.push({ kind: 'colorOverlay', group: 'content', color: rgb01(e.color), opacity: e.opacity }); break;
      case 'gradientOverlay': styles.push({ kind: 'gradientOverlay', group: 'content', angle: e.angle, scale: e.scale, opacity: e.opacity }); notes.push(`${layer.name}: set the gradient overlay colours in After Effects`); break;
      case 'adjust': fx.push({ kind: 'adjust', hue: e.hue, saturation: e.saturation, lightness: e.lightness, brightness: e.brightness, contrast: e.contrast }); break;
      case 'blur': blur = blurriness((e.radius * q) / 2.4); break;
      default: break;
    }
  }
  return { styles, fx, blur };
}

export async function exportAEComp(project, opts, layers, progress = () => {}, isCancelled = () => false) {
  const animated = project.animated !== false;
  const fps = project.fps;
  const scale = opts.scale || 1;
  const n = animated ? Math.max(1, Math.round(project.duration * fps)) : 1;
  const times = animated ? Array.from({ length: n }, (_, i) => i / fps) : [0];
  const duration = animated ? project.duration : 5;
  const base = safeName(project.name === 'Untitled title' && layers[0] ? layers[0].name : project.name, 'title');
  const entries = [];
  const assets = new Map(); // key → { id, file, char, w, h }
  const notes = [];
  const titles = [];
  let done = 0;
  const total = layers.length;

  for (const [li, layer] of layers.entries()) {
    if (isCancelled()) return null;
    progress(done / total, t('Preparing {title}…', { title: layer.name }));
    const layout = getLayout(layer);
    const q = scale * Math.max(Math.abs(layer.scaleX), Math.abs(layer.scaleY), 1) / 100; // precomp px per title unit
    const env = isEnvelopeWarp(layer.warp);
    const aeWarp = env ? AE_WARPS.indexOf(layer.warp.style) + 1 : 0;
    if (env && !aeWarp) notes.push(`${layer.name}: After Effects has no ${layer.warp.style} warp, so the letters stay straight`);
    // the precomp holds the unwarped text; envelope warps happen on the precomp layer
    const warpLayer = env ? { ...layer, warp: { ...layer.warp, style: 'none' } } : layer;
    const anims = times.map((tm) => (animated && hasAnim(layer) ? evaluate(layer.anim, layout.items, layout, tm) : null));
    const preps = anims.map((a, fi) => ((a && !a.visible) || (animated && !layerVisibleAt(layer, times[fi])) ? null : prepareText(warpLayer, layout, a)));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of preps) if (p) { x0 = Math.min(x0, p.bounds.x); y0 = Math.min(y0, p.bounds.y); x1 = Math.max(x1, p.bounds.x + p.bounds.w); y1 = Math.max(y1, p.bounds.y + p.bounds.h); }
    if (x0 === Infinity) continue;
    const fxOn = layer.effects.filter((e) => e.enabled);
    const pad = Math.max(0, ...fxOn.map(effectMargin)) + 8;
    // After Effects' Warp bends the whole layer, so a warped title's letters precomp is exactly the box the app
    // bends; other letter precomps get room for the animation and the effects
    let ox, oy, W, H;
    if (aeWarp) {
      const f = getFrame(layer);
      ox = f.x; oy = f.y; W = Math.ceil(f.w * q); H = Math.ceil(f.h * q);
      if (x0 < f.x - 1 || y0 < f.y - 1 || x1 > f.x + f.w + 1 || y1 > f.y + f.h + 1) notes.push(`${layer.name}: letters move outside the warped box and are cut off in its precomp`);
    } else {
      ox = x0 - pad; oy = y0 - pad; W = Math.ceil((x1 - x0 + pad * 2) * q); H = Math.ceil((y1 - y0 + pad * 2) * q);
    }

    // letters: one track per layout item that has a glyph
    const letters = new Map(); // item index → samples per frame
    for (let fi = 0; fi < times.length; fi++) {
      const prep = preps[fi];
      const seen = new Set();
      if (prep) for (const d of prep.draws) {
        const it = d.it;
        if (!it.glyph || !it.glyph.image) continue;
        const idx = layout.items.indexOf(it);
        seen.add(idx);
        const st = it.style;
        let L = letters.get(idx);
        if (!L) {
          // the slant is drawn into the image, so the image also depends on the letter's proportions
          const key = `${st.font}|${it.glyph.id}:${it.glyph.rev}|${st.tintMode}|${st.hue}|${st.sat}|${st.light}|${st.tintColor}|${st.tintAmount}|${st.skew ? `${st.skew}:${(d.rect.w / d.rect.h).toFixed(3)}` : 0}`;
          const rect = { ...d.rect, baseline: it.baseline };
          let canvas = glyphCanvas(it.glyph, st, 0), arect = rect;
          if (st.skew) ({ canvas, rect: arect } = slanted(canvas, st.skew, rect));
          let a = assets.get(key);
          if (!a) {
            const code = [...it.ch].map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('_');
            a = { id: assets.size, file: `letters/${String(assets.size).padStart(3, '0')}_${code}.png`, char: it.ch, w: canvas.width, h: canvas.height };
            assets.set(key, a);
            entries.push({ name: a.file, data: new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer()) });
          }
          L = { a, char: it.ch, dx: arect.x - rect.x, kw: arect.w / rect.w, pos: [], scl: [], rot: [], skew: [], op: [], blur: [], wipe: [], hue: [], bright: [], rtl: !!(it.level & 1) };
          letters.set(idx, L);
        }
        // the letter's matrix without the slant (drawn into the image), in precomp pixels
        let M = d.M;
        if (st.skew) { const cx = d.rect.x + d.rect.w / 2; M = M.translate(cx, it.baseline).skewX(st.skew).translate(-cx, -it.baseline); }
        // image pixel (u, v) → title units (rect.x + dx + u·fx, rect.y + v·fy) → M → precomp px
        const fx = (d.rect.w * L.kw) / L.a.w, fy = d.rect.h / L.a.h;
        const A = new DOMMatrix().scale(q).translate(-ox, -oy).multiply(M).translate(d.rect.x + L.dx, d.rect.y).scale(fx, fy);
        const c = A.transformPoint(new DOMPoint(L.a.w / 2, L.a.h / 2));
        const dec = decompose(A.a, A.b, A.c, A.d);
        L.pos[fi] = [r4(c.x), r4(c.y)];
        L.scl[fi] = [r4(dec.sx * 100), r4(dec.sy * 100)];
        L.rot[fi] = r4(dec.rot);
        L.skew[fi] = r4(dec.skew);
        L.op[fi] = r4(Math.min(1, d.alpha) * 100);
        L.blur[fi] = blurriness(d.blur * q);
        L.wipe[fi] = r4((1 - Math.max(0, Math.min(1, d.clip))) * 100);
        L.hue[fi] = r4(anims[fi] ? anims[fi].transforms[idx].hue : 0);
        L.bright[fi] = r4(d.bright * 100);
      }
      // a letter that is not drawn this frame is fully transparent
      for (const [idx, L] of letters) if (!seen.has(idx)) L.op[fi] = 0;
    }
    const tracks = [];
    for (const [, L] of [...letters].sort((a, b) => a[0] - b[0])) {
      // frames before a letter first appeared copy its first known transform
      const first = L.pos.findIndex((v) => v);
      for (let fi = 0; fi < times.length; fi++) {
        if (!L.pos[fi]) { const j = fi < first ? first : fi - 1; L.pos[fi] = L.pos[j]; L.scl[fi] = L.scl[j]; L.rot[fi] = L.rot[j]; L.skew[fi] = L.skew[j]; L.blur[fi] = L.blur[j] ?? 0; L.wipe[fi] = L.wipe[j] ?? 0; L.hue[fi] = L.hue[j] ?? 0; L.bright[fi] = L.bright[j] ?? 0; }
        if (L.op[fi] === undefined) L.op[fi] = 0;
      }
      // keep the rotation continuous so After Effects doesn't spin the long way between keys
      for (let fi = 1; fi < L.rot.length; fi++) L.rot[fi] = r4(L.rot[fi] - 360 * Math.round((L.rot[fi] - L.rot[fi - 1]) / 360));
      const tr = { name: L.char, asset: L.a.id, pos: track(times, L.pos), scale: track(times, L.scl), rot: track(times, L.rot), opacity: track(times, L.op) };
      if (L.skew.some((v) => Math.abs(v) > 0.05)) tr.skew = track(times, L.skew);
      if (L.blur.some((v) => v > 0.01)) tr.blur = track(times, L.blur);
      if (L.wipe.some((v) => v > 0.01)) { tr.wipe = track(times, L.wipe); tr.wipeAngle = L.rtl ? 90 : 270; }
      if (L.hue.some((v) => Math.abs(v) > 0.01)) tr.hue = track(times, L.hue);
      if (L.bright.some((v) => Math.abs(v) > 0.01)) tr.bright = track(times, L.bright);
      tracks.push(tr);
    }
    if (layout.items.some((it) => it.style.underline || it.style.strike)) notes.push(`${layer.name}: underline and strikethrough were left out`);
    const { styles, fx, blur } = effectsFor(layer, q, notes);

    // extrude, long shadow and reflection need a title comp around the letters precomp
    const smearFx = fxOn.filter((e) => e.type === 'extrude' || e.type === 'longShadow');
    const reflFx = fxOn.find((e) => e.type === 'reflection');
    let S = null, smear = [], reflection = null;
    if (smearFx.length || reflFx) {
      // measure the title at rest as After Effects will draw it, with and without its effects
      const rest = (effects) => renderLayer({ ...layer, warp: env && !aeWarp ? { ...layer.warp, style: 'none' } : layer.warp, effects }, 0, Math.min(q, 1), { noAnim: true });
      const withFx = rest(fxOn.filter((e) => e.type !== 'reflection' && e.type !== 'blur'));
      const ink = inkOf(withFx, 10), plain = inkOf(rest([]), 12);
      let sx0 = Math.min(x0 - pad, ox), sy0 = Math.min(y0 - pad, oy), sx1 = Math.max(x1 + pad, ox + W / q), sy1 = Math.max(y1 + pad, oy + H / q);
      if (withFx) { sx0 = Math.min(sx0, withFx.rect.x); sy0 = Math.min(sy0, withFx.rect.y); sx1 = Math.max(sx1, withFx.rect.x + withFx.rect.w); sy1 = Math.max(sy1, withFx.rect.y + withFx.rect.h); }
      S = { w: Math.ceil((sx1 - sx0) * q), h: Math.ceil((sy1 - sy0) * q), a: [r4((ox - sx0) * q), r4((oy - sy0) * q)], anchor: [r4(-sx0 * q), r4(-sy0 * q)] };
      // the app stacks these behind the text with the first in the list on top; the builder adds layers bottom up
      smear = [...smearFx].reverse().map((e) => {
        const ext = e.type === 'extrude';
        const length = (ext ? e.depth : e.length) * q;
        const s = { label: ext ? '3D extrude' : 'Long shadow', length: r4(length), angle: dial(e.angle), n: Math.max(1, Math.min(MAX_COPIES, Math.ceil(length))), opacity: e.opacity ?? 100, fill: null, darken: null, fade: null };
        if (ext && e.mode !== 'color') s.darken = e.darken; else s.fill = rgb01(e.color);
        if (!ext && e.fade && plain) {
          // opaque at the far side of the text, clear at the end of the shadow (as the app's gradient)
          const a = (e.angle * Math.PI) / 180, ux = Math.cos(a), uy = -Math.sin(a);
          const bw = (plain.x1 - plain.x0) * q, bh = (plain.y1 - plain.y0) * q;
          const cx = ((plain.x0 + plain.x1) / 2 - sx0) * q, cy = ((plain.y0 + plain.y1) / 2 - sy0) * q;
          const reach = (Math.abs(ux) * bw) / 2 + (Math.abs(uy) * bh) / 2;
          const fx0 = cx - ux * reach, fy0 = cy - uy * reach, span = reach * 2 + length;
          s.fade = { from: [r4(fx0), r4(fy0)], to: [r4(fx0 + ux * span), r4(fy0 + uy * span)] };
        }
        if (length > MAX_COPIES) notes.push(`${layer.name}: the ${s.label.toLowerCase()} uses ${MAX_COPIES} copies; duplicate copies in its comp if the steps show`);
        return s;
      });
      if (reflFx && ink) {
        const inkH = (ink.y1 - ink.y0) * q;
        reflection = { line: r4((ink.y1 - sy0) * q), gap: r4(reflFx.gap * q), height: r4(Math.max(1, inkH * (reflFx.size / 100))), opacity: reflFx.opacity, blur: reflFx.blur ? blurriness((reflFx.blur * q) / 2.4) : 0 };
      }
    }

    const k = scale / q;
    titles.push({
      name: layer.name || `Title ${li + 1}`, w: W, h: H,
      anchor: S ? S.anchor : [r4(-ox * q), r4(-oy * q)], position: [r4(layer.x * scale), r4(layer.y * scale)],
      scale: [r4(layer.scaleX * k), r4(layer.scaleY * k)], rotation: r4(layer.rotation), opacity: layer.opacity,
      blend: AE_BLEND[layer.blend] || 'NORMAL', locked: !!layer.locked,
      inPoint: animated ? r4(Math.max(0, layer.anim?.start ?? 0)) : 0, outPoint: animated ? r4(Math.min(duration, layer.anim?.end ?? duration)) : duration,
      warp: aeWarp ? { style: aeWarp, axis: layer.warp.vertical ? 2 : 1, bend: r4(layer.warp.bend * 100), h: r4(layer.warp.hDistort * 100), v: r4(layer.warp.vDistort * 100) } : null,
      styles, fx, blur, S, smear, reflection, letters: tracks,
    });
    done++;
    progress(done / total, t('Preparing {title}…', { title: layer.name }));
    await new Promise((r) => setTimeout(r, 0));
  }

  const ab = project.artboard;
  const data = {
    name: base, width: Math.round(ab.w * scale), height: Math.round(ab.h * scale), fps, duration: r4(duration),
    background: opts.background && ab.bg === 'color' ? rgb01(ab.bgColor) : null,
    assets: [...assets.values()].map((a) => ({ file: a.file, name: a.char })),
    titles, notes,
  };
  // ASCII only: ExtendScript reads a script without a BOM in the system encoding
  const json = JSON.stringify(data).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const script = `// PNG Font Studio -> After Effects: builds the composition "${base.replace(/[^\w .-]/g, '')}".\n// In After Effects choose File > Scripts > Run Script File... and pick this file. Keep it next to the "letters" folder.\nvar DATA = ${json};\n${BUILDER}`;
  entries.push({ name: `Build ${base}.jsx`, data: script });
  entries.push({ name: 'README.txt', data: readme(base, notes) });
  return { name: `${base}_after_effects.zip`, blob: new Blob([zipSync(entries)], { type: 'application/zip' }) };
}

function readme(base, notes) {
  return [
    `${base} - After Effects composition from PNG Font Studio`,
    '',
    '1. Unzip this folder.',
    '2. In After Effects choose File > Scripts > Run Script File... and pick "Build ' + base + '.jsx".',
    '   (Keep the script next to its "letters" folder.)',
    '3. The script makes a composition with one layer per title. Each title is a precomp in which every letter is',
    '   its own layer, with its animation as keyframes. The warp and the effects sit on top of the letters: the Warp',
    '   effect, layer styles (stroke, shadows, glows, bevel, overlays) and effects (blur, colour adjustments).',
    '4. A title with a 3D extrude, long shadow or reflection gets a title comp (in the Precomps folder) with:',
    '   - "<title> face": the letters with the warp and the styles inside the letters.',
    '   - "<title> 3D extrude" / "<title> Long shadow": copies of the face along the angle. Select the Controls',
    '     layer in that comp to change Length and Angle. The colour (Fill) or shade (Tint) and the opacity are on',
    '     its layer in the title comp; the long shadow fades through a gradient matte above it.',
    '   - "<title> reflection" in the main comp: a mirrored copy of the title, parented to it and faded with a',
    '     feathered mask.',
    '5. Warp bends the whole layer, so a warped title\'s letters precomp is cut to the text\'s box. If you make that',
    '   precomp bigger, the same Bend looks softer.',
    '',
    notes.length ? 'Not recreated:\n- ' + notes.join('\n- ') : 'Everything was recreated.',
    '',
  ].join('\n');
}

// The builder runs inside After Effects (ExtendScript, ES3: var, function, plain loops).
const BUILDER = String.raw`
(function () {
  var skipped = [];
  function note(s) { skipped.push(s); }
  var root = File($.fileName).parent;
  if (!app.project) app.newProject();
  app.beginUndoGroup("PNG Font Studio: " + DATA.name);
  var folder = app.project.items.addFolder(DATA.name);
  var letterFolder = app.project.items.addFolder("Letters");
  letterFolder.parentFolder = folder;
  var precomps = app.project.items.addFolder("Precomps");
  precomps.parentFolder = folder;
  var footage = [];
  for (var i = 0; i < DATA.assets.length; i++) {
    var f = new File(root.fsName + "/" + DATA.assets[i].file);
    if (!f.exists) { note("Missing file " + DATA.assets[i].file); footage.push(null); continue; }
    var item = app.project.importFile(new ImportOptions(f));
    item.parentFolder = letterFolder;
    footage.push(item);
  }
  function newComp(name, w, h, where) {
    var c = app.project.items.addComp(name, Math.max(4, Math.round(w)), Math.max(4, Math.round(h)), 1, DATA.duration, DATA.fps);
    c.parentFolder = where;
    return c;
  }
  var comp = newComp(DATA.name, DATA.width, DATA.height, folder);
  if (DATA.background) {
    var bgL = comp.layers.addSolid(DATA.background, "Background", DATA.width, DATA.height, 1, DATA.duration);
    bgL.locked = true;
  }
  function setTrack(prop, tr) {
    if (!prop) return;
    if (tr.t) prop.setValuesAtTimes(tr.t, tr.v); else prop.setValue(tr.v);
  }
  function addFx(layer, names) {
    for (var k = 0; k < names.length; k++) { try { var e = layer.property("ADBE Effect Parade").addProperty(names[k]); if (e) return e; } catch (err) {} }
    return null;
  }
  function prop(group, names) {
    if (!group) return null;
    for (var k = 0; k < names.length; k++) { try { var p = group.property(names[k]); if (p) return p; } catch (err) {} }
    return null;
  }
  function setp(group, names, v) {
    var p = prop(group, names);
    if (!p) return false;
    try { p.setValue(v); return true; } catch (e1) {}
    try { if (v.length === 3) { p.setValue([v[0], v[1], v[2], 1]); return true; } } catch (e2) {}
    return false;
  }
  function tf(layer, name) { return layer.property("ADBE Transform Group").property(name); }
  function place(layer, xy) { tf(layer, "ADBE Anchor Point").setValue([0, 0]); tf(layer, "ADBE Position").setValue(xy); }
  function blurFx(layer, v, label) {
    if (!v) return;
    var e = addFx(layer, ["ADBE Gaussian Blur 2", "Gaussian Blur"]);
    if (!e) { note("Blur on " + layer.name); return; }
    if (label) e.name = label;
    setp(e, ["ADBE Gaussian Blur 2-0001", "Blurriness"], v);
  }
  var STYLE_CMD = { stroke: "Stroke", dropShadow: "Drop Shadow", innerShadow: "Inner Shadow", outerGlow: "Outer Glow", innerGlow: "Inner Glow", bevel: "Bevel and Emboss", colorOverlay: "Color Overlay", gradientOverlay: "Gradient Overlay" };
  function applyStyle(c, layer, s) {
    var cmd = app.findMenuCommandId(STYLE_CMD[s.kind]);
    if (!cmd) { note(STYLE_CMD[s.kind] + " (layer style) on " + layer.name); return; }
    c.openInViewer();
    for (var k = 1; k <= c.numLayers; k++) c.layer(k).selected = false;
    layer.selected = true;
    app.executeCommand(cmd);
    layer.selected = false;
    var g = prop(prop(layer, ["ADBE Layer Styles", "Layer Styles"]), [STYLE_CMD[s.kind]]);
    if (!g) { note(STYLE_CMD[s.kind] + " settings on " + layer.name); return; }
    setp(g, ["Use Global Light"], 0);
    if (s.color) setp(g, ["Color"], s.color);
    if (s.opacity !== undefined) setp(g, ["Opacity"], s.opacity);
    if (s.size !== undefined) setp(g, ["Size"], s.size);
    if (s.position) setp(g, ["Position"], s.position);
    if (s.angle !== undefined) setp(g, ["Angle"], s.angle);
    if (s.distance !== undefined) setp(g, ["Distance"], s.distance);
    if (s.spread !== undefined) setp(g, ["Spread"], s.spread);
    if (s.choke !== undefined) setp(g, ["Choke"], s.choke);
    if (s.source) setp(g, ["Source"], s.source);
    if (s.kind === "bevel") {
      setp(g, ["Depth"], s.depth); setp(g, ["Soften"], s.soften); setp(g, ["Altitude"], s.altitude);
      setp(g, ["Highlight Color"], s.highlight); setp(g, ["Highlight Opacity"], s.highlightOpacity);
      setp(g, ["Shadow Color"], s.shadow); setp(g, ["Shadow Opacity"], s.shadowOpacity);
    }
    if (s.scale !== undefined) setp(g, ["Scale"], s.scale);
  }
  // group: "all", "content" (warp, colour effects, styles inside the letters) or "outside" (stroke, shadow, glow)
  function look(c, layer, T, group) {
    if (group !== "outside") {
      if (T.warp) {
        var w = addFx(layer, ["ADBE Warp", "Warp"]);
        if (w) {
          setp(w, ["Warp Style"], T.warp.style); setp(w, ["Warp Axis"], T.warp.axis);
          setp(w, ["Bend"], T.warp.bend); setp(w, ["Horizontal Distortion"], T.warp.h); setp(w, ["Vertical Distortion"], T.warp.v);
        } else note("Warp effect on " + T.name);
      }
      for (var fi = 0; fi < T.fx.length; fi++) {
        var X = T.fx[fi];
        if (X.kind !== "adjust") continue;
        var h2 = addFx(layer, ["ADBE HUE SATURATION", "Hue/Saturation"]);
        if (h2) { setp(h2, ["Master Hue"], X.hue); setp(h2, ["Master Saturation"], X.saturation); setp(h2, ["Master Lightness"], X.lightness); } else note("Hue/Saturation on " + T.name);
        if (X.brightness || X.contrast) { var b3 = addFx(layer, ["ADBE Brightness & Contrast 2", "Brightness & Contrast"]); if (b3) { setp(b3, ["ADBE Brightness & Contrast 2-0001", "Brightness"], X.brightness); setp(b3, ["ADBE Brightness & Contrast 2-0002", "Contrast"], X.contrast); } else note("Brightness & Contrast on " + T.name); }
      }
    }
    for (var si = 0; si < T.styles.length; si++) {
      var s = T.styles[si];
      if (group !== "all" && s.group !== group) continue;
      try { applyStyle(c, layer, s); } catch (e4) { note(STYLE_CMD[s.kind] + " on " + T.name); }
    }
  }
  function lettersComp(T, name) {
    var pc = newComp(name, T.w, T.h, precomps);
    for (var li = 0; li < T.letters.length; li++) {
      var Lt = T.letters[li];
      if (!footage[Lt.asset]) continue;
      var L = pc.layers.add(footage[Lt.asset]);
      L.name = Lt.name;
      L.startTime = 0; L.outPoint = DATA.duration;
      tf(L, "ADBE Anchor Point").setValue([footage[Lt.asset].width / 2, footage[Lt.asset].height / 2]);
      setTrack(tf(L, "ADBE Position"), Lt.pos);
      setTrack(tf(L, "ADBE Scale"), Lt.scale);
      setTrack(tf(L, "ADBE Rotate Z"), Lt.rot);
      setTrack(tf(L, "ADBE Opacity"), Lt.opacity);
      if (Lt.skew) { var sk = addFx(L, ["ADBE Geometry2", "Transform"]); if (sk) setTrack(prop(sk, ["ADBE Geometry2-0005", "Skew"]), Lt.skew); else note("Slant on letter " + Lt.name); }
      if (Lt.blur) { var gb = addFx(L, ["ADBE Gaussian Blur 2", "Gaussian Blur"]); if (gb) setTrack(prop(gb, ["ADBE Gaussian Blur 2-0001", "Blurriness"]), Lt.blur); else note("Blur on letter " + Lt.name); }
      if (Lt.wipe) { var lw = addFx(L, ["ADBE Linear Wipe", "Linear Wipe"]); if (lw) { setTrack(prop(lw, ["ADBE Linear Wipe-0001", "Transition Completion"]), Lt.wipe); setp(lw, ["ADBE Linear Wipe-0002", "Wipe Angle"], Lt.wipeAngle); } else note("Wipe on letter " + Lt.name); }
      if (Lt.hue) { var hs = addFx(L, ["ADBE HUE SATURATION", "Hue/Saturation"]); if (hs) setTrack(prop(hs, ["Master Hue"]), Lt.hue); else note("Hue change on letter " + Lt.name); }
      if (Lt.bright) { var bc = addFx(L, ["ADBE Brightness & Contrast 2", "Brightness & Contrast"]); if (bc) setTrack(prop(bc, ["ADBE Brightness & Contrast 2-0001", "Brightness"]), Lt.bright); else note("Brightness change on letter " + Lt.name); }
    }
    return pc;
  }
  // copies of the face along the angle; the Controls layer drives the spacing, so Length and Angle stay editable
  var SPREAD = 'var c = thisComp.layer("Controls");\nvar k = (index - 1) / Math.max(1, thisComp.numLayers - 1);\nvar a = degreesToRadians(c.effect("Angle")(1));\nvar d = c.effect("Length")(1) * k;\nadd(value, [Math.sin(a) * d, -Math.cos(a) * d]);';
  function smearComp(T, s, face) {
    var c = newComp(T.name + " " + s.label, T.S.w, T.S.h, precomps);
    var ctl = c.layers.addNull();
    ctl.name = "Controls";
    var len = addFx(ctl, ["ADBE Slider Control", "Slider Control"]);
    if (len) { len.name = "Length"; setp(len, ["ADBE Slider Control-0001", "Slider"], s.length); }
    var ang = addFx(ctl, ["ADBE Angle Control", "Angle Control"]);
    if (ang) { ang.name = "Angle"; setp(ang, ["ADBE Angle Control-0001", "Angle"], s.angle); }
    // farthest copy first, so the nearest ends up on top
    for (var k = s.n; k >= 1; k--) { var cp = c.layers.add(face); cp.name = s.label + " " + k; }
    ctl.moveToBeginning();
    if (!len || !ang) { note(s.label + " controls on " + T.name); return c; }
    for (var j = 2; j <= c.numLayers; j++) {
      try { tf(c.layer(j), "ADBE Position").expression = SPREAD; } catch (e5) { note(s.label + " spacing on " + T.name); break; }
    }
    return c;
  }
  function fadeMatte(S, sl, s) {
    var mt = S.layers.addSolid([1, 1, 1], s.label + " fade", S.width, S.height, 1, DATA.duration);
    var rp = addFx(mt, ["ADBE Ramp", "Gradient Ramp"]);
    if (!rp) { mt.remove(); note(s.label + " fade on " + sl.name); return; }
    setp(rp, ["ADBE Ramp-0001", "Start of Ramp"], s.fade.from); setp(rp, ["ADBE Ramp-0002", "Start Color"], [1, 1, 1]);
    setp(rp, ["ADBE Ramp-0003", "End of Ramp"], s.fade.to); setp(rp, ["ADBE Ramp-0004", "End Color"], [0, 0, 0]);
    setp(rp, ["ADBE Ramp-0005", "Ramp Shape"], 1);
    // the matte sits directly above the shadow
    try { if (sl.setTrackMatte) sl.setTrackMatte(mt, TrackMatteType.LUMA); else sl.trackMatteType = TrackMatteType.LUMA; mt.enabled = false; }
    catch (e6) { note(s.label + " fade on " + sl.name); }
  }

  for (var ti = 0; ti < DATA.titles.length; ti++) {
    var T = DATA.titles[ti];
    var A = lettersComp(T, T.S ? T.name + " letters" : T.name);
    var P, S = null;
    if (!T.S) {
      P = comp.layers.add(A);
      look(comp, P, T, "all");
    } else {
      S = newComp(T.name, T.S.w, T.S.h, precomps);
      var face = A, faceDone = false;
      if (T.smear.length) {
        // the copies need the warped, coloured letters as one source
        var F = newComp(T.name + " face", T.S.w, T.S.h, precomps);
        var fl = F.layers.add(A);
        place(fl, T.S.a);
        look(F, fl, T, "content");
        face = F; faceDone = true;
      }
      for (var mi = 0; mi < T.smear.length; mi++) {
        var sm = T.smear[mi];
        var sl = S.layers.add(smearComp(T, sm, face));
        sl.name = sm.label;
        tf(sl, "ADBE Opacity").setValue(sm.opacity);
        if (sm.fill) { var fe = addFx(sl, ["ADBE Fill", "Fill"]); if (fe) setp(fe, ["ADBE Fill-0002", "Color"], sm.fill); else note(sm.label + " colour on " + T.name); }
        if (sm.darken !== null) {
          var te = addFx(sl, ["ADBE Tint", "Tint"]);
          if (te) { setp(te, ["ADBE Tint-0001", "Map Black To"], [0, 0, 0]); setp(te, ["ADBE Tint-0002", "Map White To"], [0, 0, 0]); setp(te, ["ADBE Tint-0003", "Amount to Tint"], sm.darken); } else note(sm.label + " shade on " + T.name);
        }
        if (sm.fade) fadeMatte(S, sl, sm);
      }
      var fl2 = S.layers.add(face);
      fl2.name = T.name;
      if (!faceDone) { place(fl2, T.S.a); look(S, fl2, T, "content"); }
      look(S, fl2, T, "outside");
      P = comp.layers.add(S);
    }
    P.name = T.name;
    if (T.outPoint > T.inPoint) { P.inPoint = T.inPoint; P.outPoint = T.outPoint; }
    tf(P, "ADBE Anchor Point").setValue(T.anchor);
    tf(P, "ADBE Position").setValue(T.position);
    tf(P, "ADBE Scale").setValue(T.scale);
    tf(P, "ADBE Rotate Z").setValue(T.rotation);
    tf(P, "ADBE Opacity").setValue(T.opacity);
    try { P.blendingMode = BlendingMode[T.blend]; } catch (e3) { note("Blend mode " + T.blend + " on " + T.name); }
    blurFx(P, T.blur);
    if (T.reflection && S) {
      var Rf = T.reflection;
      var R = comp.layers.add(S);
      R.name = T.name + " reflection";
      R.moveAfter(P);
      if (T.outPoint > T.inPoint) { R.inPoint = T.inPoint; R.outPoint = T.outPoint; }
      R.parent = P;
      // mirror around the bottom of the title (in the title comp's pixels, which are P's layer space)
      tf(R, "ADBE Anchor Point").setValue([0, Rf.line]);
      tf(R, "ADBE Position").setValue([0, Rf.line + Rf.gap]);
      tf(R, "ADBE Scale").setValue([100, -100]);
      tf(R, "ADBE Rotate Z").setValue(0);
      tf(R, "ADBE Opacity").setValue(T.opacity * Rf.opacity / 100);
      try { R.blendingMode = BlendingMode[T.blend]; } catch (e7) {}
      // fade: a mask whose top edge is feathered over the reflection's height
      try {
        var m = R.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.name = "Fade";
        var sh = new Shape();
        var top = Rf.line - Rf.height / 2, bottom = Rf.line + Rf.height + 20;
        sh.vertices = [[-20, top], [T.S.w + 20, top], [T.S.w + 20, bottom], [-20, bottom]];
        sh.closed = true;
        m.property("ADBE Mask Shape").setValue(sh);
        m.property("ADBE Mask Feather").setValue([0, Rf.height]);
      } catch (e8) { note("Reflection fade on " + T.name); }
      blurFx(R, Rf.blur, "Reflection blur");
      blurFx(R, T.blur);
      if (T.locked) R.locked = true;
    }
    if (T.locked) P.locked = true;
  }
  comp.openInViewer();
  app.endUndoGroup();
  var msg = "Built \"" + DATA.name + "\": " + DATA.titles.length + " title(s), " + DATA.assets.length + " letter image(s).";
  if (DATA.notes.length) msg += "\n\nNot recreated:\n- " + DATA.notes.join("\n- ");
  if (skipped.length) msg += "\n\nCould not be set up here (add by hand):\n- " + skipped.join("\n- ");
  alert(msg);
})();
`;
