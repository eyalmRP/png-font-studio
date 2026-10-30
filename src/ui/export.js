// Export dialog: still PNG, PNG sequence, WebM (alpha), MP4, GIF, APNG, animated WebP, MOV (standalone only),
// and an After Effects composition (letter images plus a script that rebuilds the title).
import { h, storeGet, storeSet } from './dom.js';
import { t, ltr } from './i18n.js';
import { modal, button, pills, toggle, toast, numberField } from './controls.js';
import { state, selectedLayer } from '../app/store.js';
import { renderFrame, contentBounds, renderLayer, layerMatrix, layerVisibleAt } from '../render/layer.js';
import { canvasToBlob, saveFile, safeName, detectDownloads, inArtifact } from '../storage/files.js';
import { zipSync } from '../core/zip.js';
import { encodeAPNG } from '../encoders/apng.js';
import { encodeAnimatedWebP } from '../encoders/webp.js';
import { encodeMOV } from '../encoders/mov.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { muxWebM, bleedColors, alphaI420 } from '../encoders/webm.js';
import { Muxer as MP4Muxer, ArrayBufferTarget as MP4Target } from 'mp4-muxer';
import { syncTiming } from './titles/player.js';
import { exportAEComp } from './aecomp.js';

const FORMATS = [
  { id: 'png', label: 'PNG image', desc: 'The current frame with transparency.', still: true },
  { id: 'pngseq', label: 'PNG sequence', desc: 'Every frame as PNG in a ZIP. Imports into After Effects, Premiere, DaVinci, Final Cut.' },
  { id: 'webm', label: 'WebM video', desc: 'VP9 with alpha. Plays in Chrome, OBS and web pages.' },
  { id: 'mov', label: 'MOV video', desc: 'QuickTime Animation codec with alpha (lossless).', standaloneOnly: true },
  { id: 'mp4', label: 'MP4 video', desc: 'H.264. MP4 has no alpha: a transparent title comes with a luma matte video.' },
  { id: 'gif', label: 'GIF', desc: 'For chat stickers. Edges are hard (1-bit transparency).' },
  { id: 'apng', label: 'Animated PNG', desc: 'Soft transparency, plays in all browsers.' },
  { id: 'webp', label: 'Animated WebP', desc: 'Small files with soft transparency.' },
  { id: 'aecomp', label: 'After Effects composition', desc: 'A ZIP with the letters used and a script that builds an editable comp: one layer per letter, with warp and effects on each title.', still: true },
];

export async function openExport() {
  const DEFAULTS = { format: 'png', scale: 1, trim: false, background: false, onlySelected: false, loop: true, quality: 'high', matte: true };
  const opts = storeGet('export', { ...DEFAULTS });
  const dl = await detectDownloads();
  const standalone = !inArtifact();
  const cards = h('div.export-grid');
  const optsEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
  const status = h('p.hint');
  const bar = h('div.progress', h('div'));
  bar.hidden = true;
  let cancelled = false, busy = false;
  // a still title exports images only
  const still = state.project.animated === false;
  const formats = still ? FORMATS.filter((f) => f.still) : FORMATS;
  if (!formats.some((f) => f.id === opts.format)) opts.format = formats[0].id;

  const render = () => {
    cards.replaceChildren(...formats.map((f) => {
      const disabled = f.standaloneOnly && !standalone;
      return h('button.export-card', {
        type: 'button', class: opts.format === f.id ? 'on' : '', disabled,
        title: disabled ? t('Pages inside claude.ai can’t save MOV files they make themselves. Use WebM for video with transparency, or export MOV from the standalone version of PNG Font Studio (png-font-studio.html), which runs offline in your browser.') : '',
        on: { click: () => { opts.format = f.id; render(); } },
      }, h('b', t(f.label)), h('span', disabled ? t('Available in the standalone app') : t(f.desc)));
    }));
    const fmt = FORMATS.find((f) => f.id === opts.format);
    const ab = state.project.artboard;
    const ae = opts.format === 'aecomp';
    const mp4 = opts.format === 'mp4' ? mp4Kind(opts, ab) : null;
    const timed = !still && (!fmt.still || ae);
    optsEl.replaceChildren(...[
      h('div.field', h('span', t('Size')), pills({ value: opts.scale, options: [0.25, 0.5, 1, 2, 4].map((s) => ({ value: s, label: ltr(`${s}× · ${Math.round(ab.w * s)}×${Math.round(ab.h * s)}`) })), onChange: (v) => { opts.scale = v; render(); } })),
      ae ? null : toggle({ label: t('Trim to the title (crop away empty space)'), iconName: 'crop', value: opts.trim, onChange: (v) => { opts.trim = v; } }),
      toggle({ label: t('Include background colour'), iconName: 'palette', value: opts.background, onChange: (v) => { opts.background = v; if (opts.format === 'mp4') render(); } }),
      mp4 && mp4 !== 'background' ? toggle({ label: t('Luma matte video for transparency'), iconName: 'contrast', value: opts.matte !== false, onChange: (v) => { opts.matte = v; render(); } }) : null,
      toggle({ label: t('Only the selected layer'), iconName: 'layers', value: opts.onlySelected, onChange: (v) => { opts.onlySelected = v; } }),
      timed ? h('div.field', h('span', t('Frame rate')), pills({ value: state.project.fps, options: [24, 25, 30, 50, 60].map((f) => ({ value: f, label: `${f} fps` })), onChange: (v) => { state.project.fps = v; syncTiming(); render(); } })) : null,
      timed ? h('p.hint', t('{n} frames, {s} s. The length comes from the animation presets and the hold time in the player.', { n: Math.max(1, Math.round(syncTiming() * state.project.fps)), s: +state.project.duration.toFixed(2) })) : null,
      ae ? h('p.hint', t('Size sets the composition size. Unzip, then in After Effects choose File > Scripts > Run Script File and pick the .jsx inside. Animation becomes keyframes on each letter; effects without an After Effects match are listed in the README.')) : null,
      ['gif', 'apng', 'webp'].includes(opts.format) ? toggle({ label: t('Loop forever'), iconName: 'repeat', value: opts.loop, onChange: (v) => { opts.loop = v; } }) : null,
      mp4 === 'matte' ? h('p.hint', t('MP4 cannot store transparency, so you get a ZIP with two videos: the colours, and a black-and-white matte (white where the title is). In your editor, put the matte above the colour video and use it as a luma matte (track matte).')) : null,
      mp4 === 'flat' ? h('p.hint', t('MP4 cannot store transparency, so the artboard background colour is used.')) : null,
      still && !ae ? h('p.hint', t('This title is Still. Switch to Animated in the top bar to export video, GIF or a PNG sequence.')) : null,
    ].filter(Boolean));
  };
  render();
  const go = button({ label: t('Export'), icon: 'download', kind: 'primary', onClick: () => run() });
  const m = modal({
    title: t('Export'), iconName: 'download', class: 'modal-md',
    body: [cards, optsEl, bar, status, !dl && inArtifact() ? h('p.hint', t('Saving files is not available in this view.')) : null],
    actions: [
      button({ label: t('Reset to default'), icon: 'rotateCcw', kind: 'ghost', onClick: () => { Object.assign(opts, DEFAULTS); state.project.fps = 30; syncTiming(); if (!formats.some((f) => f.id === opts.format)) opts.format = formats[0].id; storeSet('export', opts); render(); } }),
      button({ label: t('Close'), onClick: () => { cancelled = true; m.close(); } }), go],
    onClose: () => { cancelled = true; },
  });

  async function run() {
    if (busy) return;
    busy = true; cancelled = false; go.disabled = true; bar.hidden = false;
    storeSet('export', opts);
    const setP = (f, msg) => { bar.firstChild.style.width = Math.round(f * 100) + '%'; if (msg) status.textContent = msg; };
    try {
      const res = await exportAs(opts, setP, () => cancelled);
      if (!res) { status.textContent = t('Export cancelled'); return; }
      setP(1, t('Saving {name}…', { name: res.name }));
      const r = await saveFile(res.name, res.blob);
      if (r === 'saved') { toast(t('Exported {name}', { name: res.name }), 'ok'); status.textContent = t('Saved {name} ({size})', { name: res.name, size: sizeLabel(res.blob.size) }); }
      else status.textContent = t('Save was cancelled');
    } catch (e) {
      console.error(e);
      status.textContent = e.message || String(e);
      toast(e.message || t('Export failed'), 'error', 6000);
    } finally { busy = false; go.disabled = false; }
  }
}

/** How an MP4 deals with transparency: on the artboard colour, with a luma matte video, or flat on the colour. */
function mp4Kind(opts, ab) {
  if (opts.background && ab.bg === 'color') return 'background';
  return opts.matte !== false ? 'matte' : 'flat';
}

const sizeLabel = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

function cropFor(opts, project, times) {
  if (!opts.trim) return null;
  let box = null;
  const only = opts.onlySelected ? selectedLayer() : null;
  for (const tm of times) {
    let b;
    if (only) {
      if (!layerVisibleAt(only, tm)) continue;
      const r = renderLayer(only, tm, 0.25, { noAnim: project.animated === false });
      if (!r) continue;
      const M = layerMatrix(only);
      const pts = [[r.rect.x, r.rect.y], [r.rect.x + r.rect.w, r.rect.y], [r.rect.x, r.rect.y + r.rect.h], [r.rect.x + r.rect.w, r.rect.y + r.rect.h]].map(([x, y]) => M.transformPoint(new DOMPoint(x, y)));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      b = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } else b = contentBounds(project, tm);
    if (!b) continue;
    if (!box) box = { ...b };
    else { const x1 = Math.max(box.x + box.w, b.x + b.w), y1 = Math.max(box.y + box.h, b.y + b.h); box.x = Math.min(box.x, b.x); box.y = Math.min(box.y, b.y); box.w = x1 - box.x; box.h = y1 - box.y; }
  }
  if (!box) return null;
  const pad = 4;
  return { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), w: Math.ceil(box.w + pad * 2), h: Math.ceil(box.h + pad * 2) };
}

/** Render frames and encode. Returns { name, blob } or null if cancelled. */
export async function exportAs(opts, progress = () => {}, isCancelled = () => false) {
  const project = state.project;
  syncTiming(project);
  const base = safeName(project.name === 'Untitled title' && project.layers[0] ? project.layers[0].name : project.name, 'title');
  const view = opts.onlySelected && selectedLayer() ? { ...project, layers: [selectedLayer()] } : project;
  const mp4 = opts.format === 'mp4' ? mp4Kind(opts, project.artboard) : null;
  const bg = mp4 ? mp4 === 'background' : opts.background;
  const fill = mp4 === 'flat' ? project.artboard.bgColor : null;
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));
  if (opts.format === 'aecomp') return exportAEComp(project, opts, view.layers.filter((l) => l.visible), progress, isCancelled);
  if (opts.format === 'png') {
    const crop = cropFor(opts, view, [state.time]);
    const c = renderFrame(view, state.time, opts.scale, { background: bg, crop });
    return { name: `${base}.png`, blob: await canvasToBlob(c) };
  }
  const fps = project.fps;
  const n = Math.max(1, Math.round(project.duration * fps));
  const times = Array.from({ length: n }, (_, i) => i / fps);
  progress(0, t('Measuring…'));
  const crop = cropFor(opts, view, times.filter((_, i) => i % 2 === 0 || i === n - 1));
  const even = ['webm', 'mp4'].includes(opts.format);
  const frameAt = (i) => {
    let c = renderFrame(view, times[i], opts.scale, { background: bg, crop, fill });
    if (even && (c.width % 2 || c.height % 2)) {
      const e = document.createElement('canvas');
      e.width = c.width + (c.width % 2); e.height = c.height + (c.height % 2);
      e.getContext('2d').drawImage(c, 0, 0);
      c = e;
    }
    return c;
  };
  const loops = opts.loop ? 0 : 1;
  switch (opts.format) {
    case 'pngseq': {
      const entries = [];
      for (let i = 0; i < n; i++) {
        if (isCancelled()) return null;
        const blob = await canvasToBlob(frameAt(i));
        entries.push({ name: `${base}/${base}_${String(i).padStart(5, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        progress((i + 1) / n, t('Frame {i} of {n}', { i: i + 1, n }));
      }
      return { name: `${base}_png_sequence.zip`, blob: new Blob([zipSync(entries)], { type: 'application/zip' }) };
    }
    case 'apng': case 'webp': {
      const frames = [];
      let w = 0, hh = 0;
      for (let i = 0; i < n; i++) {
        if (isCancelled()) return null;
        const c = frameAt(i); w = c.width; hh = c.height;
        const blob = opts.format === 'apng' ? await canvasToBlob(c) : await canvasToBlob(c, 'image/webp', 0.92);
        if (opts.format === 'webp' && blob.type !== 'image/webp') throw new Error(t('This browser cannot make WebP images. Try Chrome or Edge, or export APNG.'));
        frames.push(new Uint8Array(await blob.arrayBuffer()));
        progress((i + 1) / n, t('Frame {i} of {n}', { i: i + 1, n }));
        if (i % 4 === 0) await yieldUI();
      }
      const bytes = opts.format === 'apng' ? encodeAPNG(frames, w, hh, fps, loops) : encodeAnimatedWebP(frames, w, hh, fps, loops);
      return { name: `${base}.${opts.format === 'apng' ? 'png' : 'webp'}`, blob: new Blob([bytes], { type: opts.format === 'apng' ? 'image/png' : 'image/webp' }) };
    }
    case 'gif': {
      const gif = GIFEncoder();
      for (let i = 0; i < n; i++) {
        if (isCancelled()) return null;
        const c = frameAt(i);
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const palette = quantize(d, 256, { format: 'rgba4444', oneBitAlpha: 100, clearAlpha: true, clearAlphaThreshold: 100 });
        const index = applyPalette(d, palette, 'rgba4444');
        let ti = palette.findIndex((p) => p[3] === 0);
        const o = { palette, delay: Math.round(1000 / fps), dispose: 2 };
        if (i === 0) o.repeat = opts.loop ? 0 : -1;
        if (ti >= 0) { o.transparent = true; o.transparentIndex = ti; }
        gif.writeFrame(index, c.width, c.height, o);
        progress((i + 1) / n, t('Frame {i} of {n}', { i: i + 1, n }));
        if (i % 3 === 0) await yieldUI();
      }
      gif.finish();
      return { name: `${base}.gif`, blob: new Blob([gif.bytes()], { type: 'image/gif' }) };
    }
    case 'mov': {
      const frames = [];
      let w = 0, hh = 0;
      for (let i = 0; i < n; i++) {
        if (isCancelled()) return null;
        const c = frameAt(i); w = c.width; hh = c.height;
        frames.push(c.getContext('2d').getImageData(0, 0, w, hh).data);
        progress((i + 1) / n * 0.8, t('Frame {i} of {n}', { i: i + 1, n }));
        if (i % 4 === 0) await yieldUI();
      }
      progress(0.9, t('Encoding MOV…'));
      await yieldUI();
      return { name: `${base}.mov`, blob: new Blob([encodeMOV(frames, w, hh, fps)], { type: 'video/quicktime' }) };
    }
    case 'webm': return encodeWebMAlpha(base, n, fps, frameAt, progress, isCancelled);
    case 'mp4': return mp4 === 'matte' ? encodeMP4Matte(base, n, fps, frameAt, progress, isCancelled) : encodeVideo('mp4', base, n, fps, frameAt, progress, isCancelled);
    default: throw new Error('Unknown format');
  }
}

/** VP9 colour + VP9 alpha streams muxed into one WebM (alpha in BlockAdditional, as libvpx does). */
async function encodeWebMAlpha(base, n, fps, frameAt, progress, isCancelled) {
  if (typeof VideoEncoder === 'undefined') throw new Error(t('This browser cannot encode video. Use Chrome or Edge, or export a PNG sequence.'));
  const first = frameAt(0);
  const w = first.width, hh = first.height;
  const bitrate = Math.min(40e6, Math.max(3e6, w * hh * fps * 0.12));
  const config = { codec: 'vp09.00.10.08', width: w, height: hh, bitrate, framerate: fps, latencyMode: 'quality' };
  const sup = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error(t('This browser cannot encode WebM. Use Chrome or Edge, or export a PNG sequence.'));
  const color = [], alpha = [];
  let err = null;
  const grab = (list) => (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); list.push({ data: b, key: chunk.type === 'key', time: Math.round(chunk.timestamp / 1000) }); };
  const encC = new VideoEncoder({ output: grab(color), error: (e) => { err = e; } });
  const encA = new VideoEncoder({ output: grab(alpha), error: (e) => { err = e; } });
  encC.configure(config);
  encA.configure({ ...config, bitrate: bitrate * 0.5 });
  for (let i = 0; i < n; i++) {
    if (isCancelled()) { encC.close(); encA.close(); return null; }
    if (err) throw err;
    const c = i === 0 ? first : frameAt(i);
    const px = c.getContext('2d').getImageData(0, 0, w, hh).data;
    const ts = Math.round((i * 1e6) / fps), dur = Math.round(1e6 / fps);
    const a = alphaI420(px, w, hh);
    bleedColors(px, w, hh, 2);
    const fc = new VideoFrame(px, { format: 'RGBX', codedWidth: w, codedHeight: hh, timestamp: ts, duration: dur });
    const fa = new VideoFrame(a, { format: 'I420', codedWidth: w, codedHeight: hh, timestamp: ts, duration: dur });
    const key = i % (fps * 2) === 0;
    encC.encode(fc, { keyFrame: key }); encA.encode(fa, { keyFrame: key });
    fc.close(); fa.close();
    progress((i + 1) / n * 0.95, t('Frame {i} of {n}', { i: i + 1, n }));
    if (encC.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 10)); else if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await encC.flush(); await encA.flush();
  encC.close(); encA.close();
  if (err) throw err;
  const frames = color.map((f, i) => ({ ...f, alpha: alpha[i] ? alpha[i].data : null }));
  const bytes = muxWebM({ width: w, height: hh, frames, durationMs: (n * 1000) / fps, fps });
  return { name: `${base}.webm`, blob: new Blob([bytes], { type: 'video/webm' }) };
}

/**
 * A transparent title as two H.264 videos in a ZIP: the colours (straight colour, run past the edges so they stay
 * clean after compression) and a matte whose brightness is the alpha, for a luma matte in a video editor.
 */
async function encodeMP4Matte(base, n, fps, frameAt, progress, isCancelled) {
  if (typeof VideoEncoder === 'undefined') throw new Error(t('This browser cannot encode video. Use Chrome or Edge, or export a PNG sequence.'));
  const first = frameAt(0);
  const w = first.width, hh = first.height;
  const config = { codec: hh > 1080 || w > 1920 ? 'avc1.640033' : 'avc1.640028', width: w, height: hh, bitrate: Math.min(40e6, Math.max(4e6, w * hh * fps * 0.1)), framerate: fps };
  const sup = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) throw new Error(t('This browser cannot encode MP4 at this size. Try a smaller size or another browser.'));
  let err = null;
  const streams = ['fill', 'matte'].map(() => {
    const target = new MP4Target();
    const muxer = new MP4Muxer({ target, video: { codec: 'avc', width: w, height: hh }, fastStart: 'in-memory' });
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure(config);
    return { target, muxer, enc };
  });
  const close = () => streams.forEach((s) => { if (s.enc.state !== 'closed') s.enc.close(); });
  for (let i = 0; i < n; i++) {
    if (isCancelled()) { close(); return null; }
    if (err) { close(); throw err; }
    const c = i === 0 ? first : frameAt(i);
    const px = c.getContext('2d').getImageData(0, 0, w, hh).data;
    const matte = new Uint8ClampedArray(px.length);
    for (let j = 0; j < px.length; j += 4) { const a = px[j + 3]; matte[j] = a; matte[j + 1] = a; matte[j + 2] = a; matte[j + 3] = 255; }
    bleedColors(px, w, hh, 3);
    const ts = Math.round((i * 1e6) / fps), dur = Math.round(1e6 / fps);
    const key = i % (fps * 2) === 0;
    [px, matte].forEach((data, k) => {
      const vf = new VideoFrame(data, { format: 'RGBX', codedWidth: w, codedHeight: hh, timestamp: ts, duration: dur });
      streams[k].enc.encode(vf, { keyFrame: key });
      vf.close();
    });
    progress((i + 1) / n * 0.95, t('Frame {i} of {n}', { i: i + 1, n }));
    if (streams[0].enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 10));
    else if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  for (const s of streams) { await s.enc.flush(); s.enc.close(); }
  if (err) throw err;
  const [fillMp4, matteMp4] = streams.map((s) => { s.muxer.finalize(); return new Uint8Array(s.target.buffer); });
  const entries = [
    { name: `${base}.mp4`, data: fillMp4 },
    { name: `${base}_matte.mp4`, data: matteMp4 },
    { name: MATTE_README, data: matteReadme(base) },
  ];
  return { name: `${base}_mp4_luma_matte.zip`, blob: new Blob([zipSync(entries)], { type: 'application/zip' }) };
}

const MATTE_README = 'How to use the matte.txt';
function matteReadme(base) {
  return [
    `${base} - MP4 with a luma matte, from PNG Font Studio`,
    '',
    'MP4 cannot store transparency, so the title comes as two videos of the same size and length:',
    `- ${base}.mp4: the colours. They run past the title's edges so the edges stay clean.`,
    `- ${base}_matte.mp4: the matte. White where the title is, black where it is transparent, grey at soft edges.`,
    '',
    'Put the matte directly above the colour video and use it as a luma matte:',
    `- After Effects: set the Track Matte of ${base}.mp4 to ${base}_matte.mp4 and choose Luma Matte.`,
    `- Premiere Pro: add the Track Matte Key effect to ${base}.mp4, set Matte to the matte's track and`,
    '  Composite Using to Matte Luma, then hide the matte track.',
    '- Other editors: look for a luma matte, luma key with an external matte, or track matte.',
    '',
  ].join('\n');
}

async function encodeVideo(kind, base, n, fps, frameAt, progress, isCancelled) {
  if (typeof VideoEncoder === 'undefined') throw new Error(t('This browser cannot encode video. Use Chrome or Edge, or export a PNG sequence.'));
  const first = frameAt(0);
  const w = first.width, hh = first.height;
  const webm = kind === 'webm';
  const pxRate = w * hh * fps;
  const config = webm
    ? { codec: 'vp09.00.31.08', width: w, height: hh, bitrate: Math.min(40e6, Math.max(4e6, pxRate * 0.12)), framerate: fps, alpha: 'keep', latencyMode: 'quality' }
    : { codec: hh > 1080 || w > 1920 ? 'avc1.640033' : 'avc1.640028', width: w, height: hh, bitrate: Math.min(40e6, Math.max(4e6, pxRate * 0.1)), framerate: fps };
  const sup = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
  if (!sup.supported) {
    if (webm) throw new Error(t('This browser cannot encode WebM with transparency. Use Chrome or Edge, or export a PNG sequence.'));
    throw new Error(t('This browser cannot encode MP4 at this size. Try a smaller size or another browser.'));
  }
  const target = new MP4Target();
  const muxer = new MP4Muxer({ target, video: { codec: 'avc', width: w, height: hh }, fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
  enc.configure(config);
  for (let i = 0; i < n; i++) {
    if (isCancelled()) { enc.close(); return null; }
    if (err) throw err;
    const c = i === 0 ? first : frameAt(i);
    const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), alpha: webm ? 'keep' : 'discard' });
    enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    progress((i + 1) / n * 0.95, t('Frame {i} of {n}', { i: i + 1, n }));
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 10));
    else if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  muxer.finalize();
  return { name: `${base}.${kind}`, blob: new Blob([target.buffer], { type: webm ? 'video/webm' : 'video/mp4' }) };
}
