// QuickTime MOV with the Animation codec (lossless run-length ARGB, keeps alpha).
// Works in After Effects, Premiere, Final Cut, DaVinci Resolve (macOS) and most editors that read QuickTime.

function encodeFrameRLE(rgba, w, h) {
  const out = [];
  const push32 = (v) => out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  out.push(0, 0, 0, 0); // chunk size placeholder
  out.push(0, 0); // header: whole frame
  for (let y = 0; y < h; y++) {
    out.push(1); // skip 0 pixels
    let x = 0;
    const px = (i) => { const p = (y * w + i) * 4; return [rgba[p + 3], rgba[p], rgba[p + 1], rgba[p + 2]]; };
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
    while (x < w) {
      const cur = px(x);
      let run = 1;
      while (x + run < w && run < 128 && same(px(x + run), cur)) run++;
      if (run >= 2) {
        out.push((256 - run) & 255, ...cur);
        x += run;
      } else {
        let lit = 1;
        while (x + lit < w && lit < 127) {
          if (x + lit + 1 < w && same(px(x + lit), px(x + lit + 1))) break;
          lit++;
        }
        out.push(lit);
        for (let k = 0; k < lit; k++) out.push(...px(x + k));
        x += lit;
      }
    }
    out.push(255); // -1: end of line
  }
  const bytes = new Uint8Array(out);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  return bytes;
}

const str = (s) => [...s].map((c) => c.charCodeAt(0));
function box(type, ...payload) {
  const body = payload.flat();
  const size = 8 + body.length;
  return [(size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...str(type), ...body];
}
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v) => [(v >> 8) & 255, v & 255];
const fixed = (v) => u32(Math.round(v * 65536));
const MATRIX = [...fixed(1), ...u32(0), ...u32(0), ...u32(0), ...fixed(1), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

/** frames: array of RGBA Uint8ClampedArray. Returns Uint8Array .mov */
export function encodeMOV(frames, w, h, fps) {
  const encoded = frames.map((f) => encodeFrameRLE(f, w, h));
  const timescale = fps * 100, frameDur = 100;
  const duration = frames.length * frameDur;
  const ftyp = box('ftyp', str('qt  '), u32(0x20050300), str('qt  '));
  const mdatSize = 8 + encoded.reduce((s, e) => s + e.length, 0);
  const dataOffset = ftyp.length + 8;
  const offsets = [];
  let o = dataOffset;
  for (const e of encoded) { offsets.push(o); o += e.length; }
  const name = str('Animation');
  const compressor = [name.length, ...name, ...new Array(31 - name.length).fill(0)];
  const stsd = box('stsd', u32(0), u32(1), box('rle ', new Array(6).fill(0), u16(1), u16(0), u16(0), str('appl'), u32(0), u32(1024), u16(w), u16(h), fixed(72), fixed(72), u32(0), u16(1), compressor, u16(32), u16(0xffff)));
  const stts = box('stts', u32(0), u32(1), u32(frames.length), u32(frameDur));
  const stsc = box('stsc', u32(0), u32(1), u32(1), u32(1), u32(1));
  const stsz = box('stsz', u32(0), u32(0), u32(frames.length), encoded.map((e) => u32(e.length)).flat());
  const stco = box('stco', u32(0), u32(frames.length), offsets.map(u32).flat());
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const dinf = box('dinf', box('dref', u32(0), u32(1), box('alis', u32(1))));
  const minf = box('minf', box('vmhd', u32(1), u16(0x40), u16(0x8000), u16(0x8000), u16(0x8000)), box('hdlr', u32(0), str('dhlr'), str('alis'), u32(0), u32(0), u32(0), [0]), dinf, stbl);
  const mdia = box('mdia', box('mdhd', u32(0), u32(0), u32(0), u32(timescale), u32(duration), u16(0), u16(0)), box('hdlr', u32(0), str('mhlr'), str('vide'), u32(0), u32(0), u32(0), [0]), minf);
  const tkhd = box('tkhd', u32(0x0000000f), u32(0), u32(0), u32(1), u32(0), u32(duration), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, fixed(w), fixed(h));
  const trak = box('trak', tkhd, mdia);
  const mvhd = box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(duration), fixed(1), u16(0x0100), new Array(10).fill(0), MATRIX, u32(0), u32(0), u32(0), u32(0), u32(0), u32(0), u32(2));
  const moov = box('moov', mvhd, trak);
  const out = new Uint8Array(ftyp.length + mdatSize + moov.length);
  out.set(ftyp, 0);
  const mh = [...u32(mdatSize), ...str('mdat')];
  out.set(mh, ftyp.length);
  let p = ftyp.length + 8;
  for (const e of encoded) { out.set(e, p); p += e.length; }
  out.set(moov, p);
  return out;
}
