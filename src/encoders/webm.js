// WebM (VP9) with alpha, the way libvpx/ffmpeg store it: colour frames in the Block, the alpha plane as a
// second VP9 stream in BlockAdditional (BlockAddID 1), and AlphaMode = 1 on the track.
// Works with any browser that has a plain VP9 VideoEncoder.

const enc = new TextEncoder();

function vintSize(n) {
  for (let len = 1; len <= 8; len++) if (n < 2 ** (7 * len) - 1) {
    const out = new Uint8Array(len);
    let v = n;
    for (let i = len - 1; i >= 0; i--) { out[i] = v & 255; v = Math.floor(v / 256); }
    out[0] |= 1 << (8 - len);
    return out;
  }
  throw new Error('EBML size too large');
}
function idBytes(id) { const b = []; let v = id; while (v > 0) { b.unshift(v & 255); v = Math.floor(v / 256); } return new Uint8Array(b); }
function concat(parts) { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
function el(id, data) { return concat([idBytes(id), vintSize(data.length), data]); }
const elm = (id, ...children) => el(id, concat(children));
function uint(id, v) { const b = []; do { b.unshift(v & 255); v = Math.floor(v / 256); } while (v > 0); return el(id, new Uint8Array(b)); }
function float(id, v) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return el(id, b); }
const str = (id, s) => el(id, enc.encode(s));

function block(trackTime, data) {
  const head = new Uint8Array(4);
  head[0] = 0x81; // track 1
  new DataView(head.buffer).setInt16(1, trackTime);
  head[3] = 0;
  return el(0xa1, concat([head, data]));
}

/** frames: [{ data, alpha, key, time (ms) }] */
export function muxWebM({ width, height, frames, durationMs, fps }) {
  const header = elm(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), str(0x4282, 'webm'), uint(0x4287, 4), uint(0x4285, 2));
  const info = elm(0x1549a966, uint(0x2ad7b1, 1000000), str(0x4d80, 'PNG Font Studio'), str(0x5741, 'PNG Font Studio'), float(0x4489, durationMs));
  const video = elm(0xe0, uint(0xb0, width), uint(0xba, height), uint(0x53c0, 1));
  const tracks = elm(0x1654ae6b, elm(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x9c, 0), str(0x86, 'V_VP9'), uint(0x83, 1), uint(0x23e383, Math.round(1e9 / fps)), video));
  const clusters = [];
  let cur = null;
  const frameDur = Math.round(1000 / fps);
  for (const f of frames) {
    if (!cur || f.key || f.time - cur.start > 30000) { cur = { start: f.time, parts: [uint(0xe7, f.time)] }; clusters.push(cur); }
    const rel = f.time - cur.start;
    const kids = [block(rel, f.data)];
    if (f.alpha) kids.push(elm(0x75a1, elm(0xa6, uint(0xee, 1), el(0xa5, f.alpha))));
    if (!f.key) {
      const rb = new Uint8Array(2); new DataView(rb.buffer).setInt16(0, -frameDur);
      kids.push(el(0xfb, rb));
    }
    kids.push(uint(0x9b, frameDur));
    cur.parts.push(elm(0xa0, ...kids));
  }
  const segment = elm(0x18538067, info, tracks, ...clusters.map((c) => elm(0x1f43b675, ...c.parts)));
  return concat([header, segment]);
}

/** Spread colours into fully transparent pixels so chroma subsampling does not darken soft edges. */
export function bleedColors(rgba, w, h, passes = 3) {
  const d = rgba;
  const src = new Uint8ClampedArray(d.length);
  const row = w * 4;
  for (let p = 0; p < passes; p++) {
    src.set(d);
    // a neighbour lends its colour when it is visible, or (after the first pass) already carries bled colour
    const lends = (j) => src[j + 3] > 0 || (p > 0 && (src[j] || src[j + 1] || src[j + 2]));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * row + x * 4;
      if (src[i + 3] > 0) continue;
      let r = 0, g = 0, b = 0, n = 0;
      if (x + 1 < w && lends(i + 4)) { r += src[i + 4]; g += src[i + 5]; b += src[i + 6]; n++; }
      if (x > 0 && lends(i - 4)) { r += src[i - 4]; g += src[i - 3]; b += src[i - 2]; n++; }
      if (y + 1 < h && lends(i + row)) { r += src[i + row]; g += src[i + row + 1]; b += src[i + row + 2]; n++; }
      if (y > 0 && lends(i - row)) { r += src[i - row]; g += src[i - row + 1]; b += src[i - row + 2]; n++; }
      if (n) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
    }
  }
  return d;
}

/** I420 frame whose luma is the alpha channel (full range). */
export function alphaI420(rgba, w, h) {
  const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2);
  const buf = new Uint8Array(w * h + cw * ch * 2);
  for (let i = 0, n = w * h; i < n; i++) buf[i] = rgba[i * 4 + 3];
  buf.fill(128, w * h);
  return buf;
}
