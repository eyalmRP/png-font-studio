// Animated PNG from same-sized PNG frames (bytes). Each frame replaces the previous one.
import { crc32 } from '../core/zip.js';

function chunks(png) {
  const out = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p < png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    out.push({ type, data: png.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodeAPNG(frames, width, height, fps, loops = 0) {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const first = chunks(frames[0]);
  parts.push(chunk('IHDR', first.find((c) => c.type === 'IHDR').data));
  const actl = new Uint8Array(8); const ad = new DataView(actl.buffer);
  ad.setUint32(0, frames.length); ad.setUint32(4, loops);
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((png, i) => {
    const fc = new Uint8Array(26); const d = new DataView(fc.buffer);
    d.setUint32(0, seq++); d.setUint32(4, width); d.setUint32(8, height); d.setUint32(12, 0); d.setUint32(16, 0);
    d.setUint16(20, 1); d.setUint16(22, fps); fc[24] = 1; fc[25] = 0; // dispose to background, blend source
    parts.push(chunk('fcTL', fc));
    for (const c of chunks(png)) {
      if (c.type !== 'IDAT') continue;
      if (i === 0) parts.push(chunk('IDAT', c.data));
      else { const fd = new Uint8Array(4 + c.data.length); new DataView(fd.buffer).setUint32(0, seq++); fd.set(c.data, 4); parts.push(chunk('fdAT', fd)); }
    }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
