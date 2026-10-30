// Animated WebP assembled from still WebP frames produced by the browser's encoder.
function riffChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let p = 12;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(p, p + 4));
    const size = dv.getUint32(p + 4, true);
    out.push({ id, data: bytes.subarray(p + 8, p + 8 + size), raw: bytes.subarray(p, p + 8 + size + (size & 1)) });
    p += 8 + size + (size & 1);
  }
  return out;
}
const u24 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
function chunk(id, data) {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

export function encodeAnimatedWebP(frames, width, height, fps, loops = 0) {
  const dur = Math.round(1000 / fps);
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | 0x10; // animation + alpha
  vp8x.set(u24(width - 1), 4); vp8x.set(u24(height - 1), 7);
  const anim = new Uint8Array(6); // transparent background, loop count
  new DataView(anim.buffer).setUint16(4, loops, true);
  const parts = [chunk('VP8X', vp8x), chunk('ANIM', anim)];
  for (const f of frames) {
    const img = riffChunks(f).filter((c) => c.id === 'ALPH' || c.id === 'VP8 ' || c.id === 'VP8L').map((c) => c.raw);
    const head = new Uint8Array(16);
    head.set(u24(0), 0); head.set(u24(0), 3); head.set(u24(width - 1), 6); head.set(u24(height - 1), 9); head.set(u24(dur), 12);
    head[15] = 0x02 | 0x01; // no blending, dispose to background
    const body = new Uint8Array(16 + img.reduce((s, c) => s + c.length, 0));
    body.set(head, 0);
    let o = 16; for (const c of img) { body.set(c, o); o += c.length; }
    parts.push(chunk('ANMF', body));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(12 + total);
  out.set([82, 73, 70, 70], 0);
  new DataView(out.buffer).setUint32(4, 4 + total, true);
  out.set([87, 69, 66, 80], 8);
  let o = 12; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
