// File formats: font package (.font.zip), title project (.title.zip), PNG coding, and saving files.
import { zipSync, unzip, textOf } from '../core/zip.js';
import { fontToJSON, fontFromJSON } from '../core/font.js';
import { createImage } from '../core/image.js';

// ---------- PNG coding ----------

const pngCache = new WeakMap(); // image object → Blob

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality));
}

export async function imageToPNG(img) {
  const hit = pngCache.get(img);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const blob = await canvasToBlob(c);
  pngCache.set(img, blob);
  return blob;
}

/** Decode any browser-readable image (Blob/File/bytes) to an RGBA image object (straight alpha). */
export async function decodeImage(src) {
  const blob = src instanceof Blob ? src : new Blob([src], { type: 'image/png' });
  let bmp;
  try { bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
  catch {
    bmp = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im); im.onerror = () => reject(new Error('Unsupported image'));
      im.src = URL.createObjectURL(blob);
    });
  }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const img = createImage(d.width, d.height, d.data);
  if (src instanceof Blob && src.type === 'image/png') pngCache.set(img, src);
  return img;
}

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed zip files');
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

// ---------- font packages ----------

export async function fontToZip(font) {
  const json = fontToJSON(font);
  const entries = [{ name: 'font.json', data: JSON.stringify(json, null, 1) }];
  for (const gj of json.glyphs) {
    if (!gj.file) continue;
    const blob = await imageToPNG(font.glyphs.get(gj.char).image);
    entries.push({ name: gj.file, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return zipSync(entries);
}

export async function fontFromZipBytes(bytes, prefix = '') {
  const files = await unzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), inflateRaw);
  const jsonBytes = files.get(prefix + 'font.json');
  if (!jsonBytes) throw new Error('This zip has no font.json, so it is not a PNG Font Studio font');
  const json = JSON.parse(textOf(jsonBytes));
  const images = new Map();
  await Promise.all(json.glyphs.filter((g) => g.file).map(async (g) => {
    const b = files.get(prefix + g.file);
    if (b) images.set(g.file, await decodeImage(new Blob([b], { type: 'image/png' })));
  }));
  return fontFromJSON(json, images);
}

// ---------- projects ----------

export async function projectToZip(projectJSON, fonts) {
  const entries = [{ name: 'project.json', data: JSON.stringify(projectJSON, null, 1) }];
  for (const f of fonts) {
    const z = await fontToZip(f);
    const inner = await unzip(z);
    for (const [n, b] of inner) entries.push({ name: `fonts/${f.id}/${n}`, data: b });
  }
  return zipSync(entries);
}

export async function projectFromZipBytes(bytes) {
  const files = await unzip(new Uint8Array(bytes), inflateRaw);
  const pj = files.get('project.json');
  if (!pj) throw new Error('This zip has no project.json, so it is not a PNG Font Studio title');
  const project = JSON.parse(textOf(pj));
  const fontIds = [...new Set([...files.keys()].filter((n) => n.startsWith('fonts/') && n.endsWith('/font.json')).map((n) => n.split('/')[1]))];
  const fonts = [];
  for (const id of fontIds) {
    const sub = new Map([...files].filter(([n]) => n.startsWith(`fonts/${id}/`)).map(([n, b]) => [n.slice(`fonts/${id}/`.length), b]));
    const json = JSON.parse(textOf(sub.get('font.json')));
    const images = new Map();
    await Promise.all(json.glyphs.filter((g) => g.file && sub.get(g.file)).map(async (g) => images.set(g.file, await decodeImage(new Blob([sub.get(g.file)], { type: 'image/png' })))));
    fonts.push(fontFromJSON(json, images));
  }
  return { project, fonts };
}

// ---------- saving files ----------

let downloadsCap; // undefined = unknown, null = not available
export async function detectDownloads() {
  if (downloadsCap !== undefined) return downloadsCap;
  try {
    downloadsCap = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  } catch { downloadsCap = null; }
  return downloadsCap;
}

export const inArtifact = () => !!(window.claude && typeof window.claude.use === 'function');

export function safeName(name, fallback = 'untitled') {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 120) || fallback;
}

/**
 * Save a file. Inside claude.ai the viewer confirms each download; standalone it downloads directly.
 * Returns 'saved' | 'declined' | throws an Error with a readable message.
 */
export async function saveFile(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const dl = await detectDownloads();
  if (dl) {
    try { await dl.save({ filename, data: blob }); return 'saved'; }
    catch (e) {
      if (e && e.code === 'declined') return 'declined';
      if (e && e.code === 'rejected_extension') throw new Error(`claude.ai does not allow saving .${filename.split('.').pop()} files here`);
      if (e && e.code === 'not_signed') throw new Error('MOV files made in the page cannot be saved inside claude.ai. Use WebM or PNG sequence, or open the standalone app.');
      if (e && e.code === 'rate_limited') throw new Error('A save is already waiting for your confirmation');
      if (e && (e.code === 'unavailable' || e.code === 'not_granted')) { /* fall back below */ } else throw new Error(e?.message || 'Saving failed');
    }
  }
  if (inArtifact()) throw new Error('Saving files is not available in this view');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}
