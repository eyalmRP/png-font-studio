// Simplified Unicode bidi (UAX #9 levels 0–2) for Hebrew/Arabic mixed with Latin and digits.
import { MIRROR } from './charsets.js';

export function bidiClass(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x0591 && cp <= 0x05c7 && cp !== 0x05be && cp !== 0x05c0 && cp !== 0x05c3 && cp !== 0x05c6) return 'NSM';
  if ((cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff)) return 'R';
  if (cp >= 0x30 && cp <= 0x39) return 'EN';
  if (cp >= 0x660 && cp <= 0x669) return 'EN';
  if (ch === '\n') return 'B';
  if (ch === ' ' || ch === '\t' || cp === 0x2028) return 'WS';
  if ('+-−±#$%‰€£¥₪¢₹₽₩₿°'.includes(ch)) return 'ET';
  if ('.,:/'.includes(ch)) return 'CS';
  if (cp < 0x41 || (cp >= 0x5b && cp <= 0x60) || (cp >= 0x7b && cp <= 0xbf) || (cp >= 0x2000 && cp <= 0x2bff) || cp === 0xd7 || cp === 0xf7) return 'ON';
  return 'L';
}

/** Base direction from the first strong character; null when there is none. */
export function firstStrong(chars) {
  for (const ch of chars) {
    const c = bidiClass(ch);
    if (c === 'L') return 'ltr';
    if (c === 'R') return 'rtl';
  }
  return null;
}

/** Resolve embedding levels for one paragraph (array of single code points). */
export function resolveLevels(chars, baseDir) {
  const base = baseDir === 'rtl' ? 1 : 0;
  const n = chars.length;
  const types = chars.map(bidiClass);
  // W1: NSM takes the type of the previous character
  for (let i = 0; i < n; i++) if (types[i] === 'NSM') types[i] = i ? types[i - 1] : (base ? 'R' : 'L');
  // W4/W5 (simplified): separators between digits and terminators adjacent to digits become digits
  for (let i = 0; i < n; i++) {
    if (types[i] === 'CS' && types[i - 1] === 'EN' && types[i + 1] === 'EN') types[i] = 'EN';
  }
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'ET') continue;
    let j = i; while (j < n && types[j] === 'ET') j++;
    const touchesDigit = types[i - 1] === 'EN' || types[j] === 'EN';
    for (let k = i; k < j; k++) types[k] = touchesDigit ? 'EN' : 'ON';
    i = j - 1;
  }
  // W7: digits preceded (through any run) by L, or by the start in an LTR paragraph, behave as L
  let lastStrong = base ? 'R' : 'L';
  for (let i = 0; i < n; i++) {
    const t = types[i];
    if (t === 'L' || t === 'R') lastStrong = t;
    else if (t === 'EN' && lastStrong === 'L') types[i] = 'L';
  }
  // N1/N2: neutrals take the direction of matching neighbours, else the paragraph direction
  const strongOf = (t) => (t === 'L' ? 'L' : t === 'R' || t === 'EN' ? 'R' : null);
  for (let i = 0; i < n; i++) {
    if (strongOf(types[i])) continue;
    let j = i; while (j < n && !strongOf(types[j])) j++;
    const before = i ? strongOf(types[i - 1]) : base ? 'R' : 'L';
    const after = j < n ? strongOf(types[j]) : base ? 'R' : 'L';
    const dir = before === after ? before : base ? 'R' : 'L';
    for (let k = i; k < j; k++) types[k] = dir === 'L' ? 'NL' : 'NR';
    i = j - 1;
  }
  const levels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = types[i];
    if (base === 0) levels[i] = t === 'R' || t === 'NR' ? 1 : t === 'EN' ? 2 : 0;
    else levels[i] = t === 'L' || t === 'NL' || t === 'EN' ? 2 : 1;
  }
  return levels;
}

/**
 * Visual order for one line: indices (relative to the line start) left to right.
 * Trailing whitespace is reset to the paragraph level (rule L1).
 */
export function visualOrder(levels, start, end, chars, baseDir) {
  const base = baseDir === 'rtl' ? 1 : 0;
  const lv = [];
  for (let i = start; i < end; i++) lv.push(levels[i]);
  for (let i = lv.length - 1; i >= 0; i--) {
    const c = chars[start + i];
    if (c === ' ' || c === '\t' || c === '\n') lv[i] = base; else break;
  }
  const order = lv.map((_, i) => i);
  let max = 0, minOdd = 255;
  for (const l of lv) { if (l > max) max = l; if (l & 1 && l < minOdd) minOdd = l; }
  for (let level = max; level >= minOdd && level > 0; level--) {
    let i = 0;
    while (i < order.length) {
      if (lv[order[i]] >= level) {
        let j = i; while (j < order.length && lv[order[j]] >= level) j++;
        const seg = order.slice(i, j).reverse();
        for (let k = 0; k < seg.length; k++) order[i + k] = seg[k];
        i = j;
      } else i++;
    }
  }
  return { order, levels: lv };
}

export function mirrorChar(ch) { return MIRROR.get(ch) || ch; }
