// Paragraph layout for PNG fonts: case transforms, ligatures, kerning, tracking, line breaking,
// bidi reordering, alignment and justification. Produces positioned items plus caret/hit-test helpers.
import { glyphAdvance, opticalKern, metricKern, unitsPerEm } from './font.js';
import { resolveLevels, visualOrder, firstStrong, mirrorChar } from './bidi.js';
import { paraRanges } from './textdoc.js';

const isSpace = (c) => c === ' ' || c === '\t' || c === ' ';
const isWordStart = (chars, i) => i === 0 || /[\s\-–—("'“‘[{]/u.test(chars[i - 1]);

function displayChar(chars, i, style) {
  const c = chars[i];
  switch (style.caps) {
    case 'upper': return { ch: c.toUpperCase(), scale: 1 };
    case 'lower': return { ch: c.toLowerCase(), scale: 1 };
    case 'title': return { ch: isWordStart(chars, i) ? c.toUpperCase() : c, scale: 1 };
    case 'small': {
      const up = c.toUpperCase();
      return up !== c ? { ch: up, scale: 0.76 } : { ch: c, scale: 1 };
    }
    default: return { ch: c, scale: 1 };
  }
}

function findGlyph(font, ch) {
  if (!font) return null;
  let g = font.glyphs.get(ch);
  if (g && g.image) return g;
  const alt = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
  g = font.glyphs.get(alt);
  if (g && g.image) return g;
  return null;
}

function ligaturesOf(font) {
  if (!font) return [];
  if (font._ligRev === font.rev) return font._ligs;
  const ligs = [...font.glyphs.keys()].filter((k) => [...k].length > 1).sort((a, b) => [...b].length - [...a].length);
  Object.defineProperty(font, '_ligs', { value: ligs, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(font, '_ligRev', { value: font.rev, writable: true, configurable: true, enumerable: false });
  return ligs;
}

/**
 * doc: text document; opts: { getFont(id), mode: 'point'|'box', width, defaultDir }
 */
export function layoutDoc(doc, opts) {
  const { getFont, mode = 'point', width = 800, defaultDir = 'ltr' } = opts;
  const chars = doc.chars;
  const ranges = paraRanges(doc);
  const lines = [];
  const allItems = [];
  let y = 0;
  let maxLineW = 0;

  // pass 1: build items and lines per paragraph
  const paraData = ranges.map(([ps, pe], pi) => {
    const para = doc.paras[pi];
    const pchars = chars.slice(ps, pe);
    const dir = para.direction === 'auto' ? firstStrong(pchars) || defaultDir : para.direction;
    const levels = resolveLevels(pchars, dir);
    const items = [];
    for (let i = ps; i < pe;) {
      const style = doc.styles[i];
      const font = getFont(style.font);
      const level = levels[i - ps];
      // ligatures: longest glyph key matching the upcoming characters with the same style
      let len = 1, ch, capScale = 1;
      const ligs = ligaturesOf(font);
      let lig = null;
      for (const key of ligs) {
        const k = [...key];
        if (i + k.length > pe) continue;
        let ok = true;
        for (let j = 0; j < k.length; j++) if (chars[i + j] !== k[j] || doc.styles[i + j] !== style) { ok = false; break; }
        if (ok) { lig = key; break; }
      }
      if (lig) { ch = lig; len = [...lig].length; } else {
        const d = displayChar(chars, i, style);
        ch = d.ch; capScale = d.scale;
        if (level & 1) ch = mirrorChar(ch);
      }
      let size = style.size * capScale;
      let shift = style.baselineShift;
      if (style.script === 'super') { shift += style.size * 0.34; size *= 0.62; }
      else if (style.script === 'sub') { shift -= style.size * 0.12; size *= 0.62; }
      const upm = font ? unitsPerEm(font) : 200;
      const kv = (size / upm) * (style.scaleY / 100);
      const kx = (size / upm) * (style.scaleX / 100);
      const space = isSpace(ch);
      const glyph = space ? null : findGlyph(font, ch);
      let adv;
      if (space) adv = (font ? font.spacing.space : upm * 0.3) * kx * (para.wordSpacing / 100);
      else if (glyph) adv = glyphAdvance(font, glyph) * kx;
      else adv = size * 0.5 * (style.scaleX / 100);
      const track = (style.tracking / 1000) * size;
      items.push({
        index: i, len, ch, glyph, font, style, size, kv, kx, shift, level,
        isSpace: space, missing: !space && !glyph,
        adv, track, kern: 0, x: 0, baseline: 0,
        ascent: font ? font.metrics.ascender * kv : size * 0.8,
        descent: font ? font.metrics.descender * kv : size * 0.2,
      });
      i += len;
    }
    // logical-order pair kerning (used for widths; recomputed visually later)
    for (let n = 1; n < items.length; n++) {
      const a = items[n - 1], b = items[n];
      b.kernLogical = pairKern(a, b, (a.level & 1) && (b.level & 1));
    }
    return { pi, ps, pe, para, dir, levels, items };
  });

  const lineWidth = (items, s, e) => {
    let w = 0;
    for (let n = s; n < e; n++) {
      const it = items[n];
      w += it.adv + (n > s ? it.kernLogical || 0 : 0) + (n < e - 1 ? it.track : 0);
    }
    return w;
  };

  // pass 2: line breaking
  for (const pd of paraData) {
    const { items, para } = pd;
    const brk = [];
    if (mode === 'box' && items.length) {
      let s = 0;
      while (s < items.length) {
        const avail = width - para.indentStart - para.indentEnd - (s === 0 ? para.firstIndent : 0);
        let w = 0, lastBreak = -1, e = s;
        while (e < items.length) {
          const it = items[e];
          const add = it.adv + (e > s ? it.kernLogical || 0 : 0);
          if (w + add > avail && e > s && !it.isSpace) break;
          w += add + it.track;
          if (it.isSpace || /[-–—/]/.test(it.ch)) lastBreak = e;
          e++;
        }
        if (e < items.length) {
          if (lastBreak >= s) e = lastBreak + 1;
          while (e < items.length && items[e].isSpace) e++;
        }
        if (e === s) e = s + 1;
        brk.push([s, e]);
        s = e;
      }
    } else brk.push([0, items.length]);
    pd.lineRanges = brk;
    for (const [s, e] of brk) {
      let we = e;
      while (we > s && items[we - 1].isSpace) we--;
      maxLineW = Math.max(maxLineW, lineWidth(items, s, we) + para.indentStart + para.indentEnd + (s === 0 ? para.firstIndent : 0));
    }
  }

  const blockW = mode === 'box' ? width : maxLineW;
  const blockX = mode === 'box' ? 0 : null; // point text x0 depends on first paragraph alignment

  // pass 3: positions
  let first = true;
  for (const pd of paraData) {
    const { items, para, dir, ps, pe, pi } = pd;
    const rtl = dir === 'rtl';
    if (!first) y += para.spaceBefore;
    pd.lineRanges.forEach(([s, e], li) => {
      const lineItems = items.slice(s, e);
      const style = lineItems.length ? lineItems[0].style : doc.styles[Math.max(0, ps - 1)] || doc.typing;
      const font = getFont(style.font);
      const upm = font ? unitsPerEm(font) : 200;
      let maxSize = 0, maxAsc = 0, maxDesc = 0;
      for (const it of lineItems) {
        maxSize = Math.max(maxSize, it.size); maxAsc = Math.max(maxAsc, it.ascent + Math.max(0, it.shift)); maxDesc = Math.max(maxDesc, it.descent - Math.min(0, it.shift));
      }
      if (!lineItems.length) {
        maxSize = style.size;
        maxAsc = font ? font.metrics.ascender * style.size / upm : style.size * 0.8;
        maxDesc = font ? font.metrics.descender * style.size / upm : style.size * 0.2;
      }
      const natural = maxSize * 1.2;
      const adv = para.lineMode === 'exact' ? para.lineValue : para.lineMode === 'atLeast' ? Math.max(para.lineValue, natural) : natural * para.lineValue;
      if (first) y += maxAsc; else y += adv;
      first = false;
      // visual order (per code point, relative to the line start; ligatures cover several code points)
      const startCp = lineItems.length ? lineItems[0].index : ps;
      const endCp = lineItems.length ? lineItems[lineItems.length - 1].index + lineItems[lineItems.length - 1].len : ps;
      const { order } = visualOrder(pd.levels, startCp - ps, endCp - ps, chars.slice(ps, pe), dir);
      const byCp = new Map();
      lineItems.forEach((it) => byCp.set(it.index - startCp, it));
      const visual = [];
      const seen = new Set();
      for (const o of order) { const it = byCp.get(o); if (it && !seen.has(it)) { seen.add(it); visual.push(it); } }
      // trailing spaces (logical end) do not count for alignment; bidi puts them at the paragraph's end side
      let trailing = 0;
      for (let n = lineItems.length - 1; n >= 0 && lineItems[n].isSpace; n--) trailing++;
      const trailingSet = new Set(lineItems.slice(lineItems.length - trailing));
      let x = 0, inkW = 0;
      const placed = [];
      visual.forEach((it, n) => {
        const prev = n ? visual[n - 1] : null;
        it.kern = prev ? visualKern(prev, it) : 0;
        x += it.kern;
        it.x = x;
        x += it.adv + it.track;
        placed.push(it);
      });
      const content = placed.filter((it) => !trailingSet.has(it));
      if (content.length) {
        const minX = Math.min(...content.map((it) => it.x));
        const maxX = Math.max(...content.map((it) => it.x + it.adv));
        inkW = maxX - minX;
        placed.forEach((it) => { it.x -= minX; });
      } else if (placed.length && rtl) {
        const maxX = Math.max(...placed.map((it) => it.x + it.adv));
        placed.forEach((it) => { it.x -= maxX; });
      }
      const firstLine = s === 0;
      const indL = rtl ? para.indentEnd : para.indentStart + (firstLine && !rtl ? para.firstIndent : 0);
      const indR = rtl ? para.indentStart + (firstLine ? para.firstIndent : 0) : para.indentEnd;
      const avail = blockW - indL - indR;
      const lastLine = li === pd.lineRanges.length - 1;
      let align = para.align;
      if (align === 'justify') {
        if (!lastLine || para.justifyLast === 'full') {
          const extra = avail - inkW;
          const gaps = content.filter((it, n) => it.isSpace && n > 0 && n < content.length - 1);
          if (extra > 0 && content.length > 1) {
            const sorted = [...content].sort((a, b) => a.x - b.x);
            if (gaps.length) {
              const per = extra / gaps.length;
              let acc = 0;
              for (const it of sorted) { it.x += acc; if (gaps.includes(it)) acc += per; }
            } else {
              const per = extra / (sorted.length - 1);
              sorted.forEach((it, n) => { it.x += per * n; });
            }
            inkW = avail;
          }
          align = rtl ? 'right' : 'left';
        } else {
          const jl = para.justifyLast;
          align = jl === 'center' ? 'center' : (jl === 'end') !== rtl ? 'right' : 'left';
        }
      }
      let x0;
      if (align === 'center') x0 = indL + (avail - inkW) / 2;
      else if (align === 'right') x0 = blockW - indR - inkW;
      else x0 = indL;
      placed.forEach((it) => {
        it.x += x0;
        it.baseline = y - it.shift;
      });
      const line = {
        para: pi, start: lineItems.length ? lineItems[0].index : ps,
        end: lineItems.length ? lineItems[lineItems.length - 1].index + lineItems[lineItems.length - 1].len : ps,
        paraEnd: lastLine, baseline: y, ascent: maxAsc, descent: maxDesc,
        top: y - maxAsc, bottom: y + maxDesc,
        x0, width: inkW, align, rtl, items: placed,
      };
      // the line end includes the newline position for the last line of a paragraph
      lines.push(line);
      allItems.push(...placed);
    });
    y += para.spaceAfter;
    if (pi === paraData.length - 1) y -= para.spaceAfter;
  }
  const last = lines[lines.length - 1];
  const height = last ? last.bottom : 0;
  // point text: shift so the anchor (x = 0) is at the alignment edge of the first paragraph
  let offsetX = 0;
  if (mode !== 'box') {
    const a = doc.paras[0].align;
    offsetX = a === 'center' ? -blockW / 2 : a === 'right' ? -blockW : 0;
    if (a === 'justify') offsetX = paraData[0].dir === 'rtl' ? -blockW : 0;
  }
  if (offsetX) for (const ln of lines) { ln.x0 += offsetX; for (const it of ln.items) it.x += offsetX; }
  return {
    lines, items: allItems, length: doc.chars.length,
    frame: { x: mode === 'box' ? blockX : offsetX, y: 0, w: blockW, h: Math.max(height, last ? last.bottom : 0) },
    mode, width: blockW,
  };
}

function pairKern(a, b, rtl) {
  if (a.isSpace || b.isSpace || !a.glyph || !b.glyph || a.font !== b.font) return 0;
  const [l, r] = rtl ? [b, a] : [a, b];
  const mode = b.style.kerning;
  let k = 0;
  if (mode === 'optical') k = opticalKern(a.font, l.glyph, r.glyph);
  else if (mode === 'metrics') k = metricKern(a.font, l.glyph.char, r.glyph.char);
  return k * Math.min(l.kx, r.kx) + (b.style.kern / 1000) * b.size;
}

function visualKern(left, right) {
  if (left.isSpace || right.isSpace) return 0;
  // manual kern belongs to the logically later character of an adjacent pair
  let manual = 0;
  if (right.index === left.index + left.len) manual = (right.style.kern / 1000) * right.size;
  else if (left.index === right.index + right.len) manual = (left.style.kern / 1000) * left.size;
  if (!left.glyph || !right.glyph || left.font !== right.font) return manual;
  const mode = (right.index > left.index ? right : left).style.kerning;
  let k = 0;
  if (mode === 'optical') k = opticalKern(left.font, left.glyph, right.glyph);
  else if (mode === 'metrics') k = metricKern(left.font, left.glyph.char, right.glyph.char);
  return k * Math.min(left.kx, right.kx) + manual;
}

// ---------- caret & hit testing ----------

export function lineOfPos(layout, pos) {
  const { lines } = layout;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const next = lines[i + 1];
    if (pos < ln.start) continue;
    if (pos < ln.end) return i;
    if (pos === ln.end && (!next || next.para !== ln.para || next.start > pos)) return i;
  }
  for (let i = lines.length - 1; i >= 0; i--) if (pos >= lines[i].start) return i;
  return 0;
}

function itemAt(line, pos) {
  for (const it of line.items) if (pos >= it.index && pos < it.index + it.len) return it;
  return null;
}

/** Caret geometry for logical position pos. */
export function caretAt(layout, pos) {
  if (!layout.lines.length) return { x: 0, top: -50, bottom: 10, line: 0 };
  const li = lineOfPos(layout, pos);
  const ln = layout.lines[li];
  let x;
  const it = pos < ln.end ? itemAt(ln, pos) : null;
  if (it) x = it.level & 1 ? it.x + it.adv : it.x;
  else {
    const prev = itemAt(ln, pos - 1);
    if (prev) x = prev.level & 1 ? prev.x : prev.x + prev.adv;
    else x = ln.align === 'center' ? ln.x0 + ln.width / 2 : ln.align === 'right' ? ln.x0 + ln.width : ln.x0;
  }
  const size = it ? it.size : ln.ascent + ln.descent;
  return { x, top: ln.baseline - ln.ascent, bottom: ln.baseline + ln.descent, line: li, size };
}

/** Logical position nearest to local point (x, y). */
export function hitTest(layout, x, y) {
  const { lines } = layout;
  if (!lines.length) return 0;
  let li = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const next = lines[i + 1];
    const limit = next ? (ln.bottom + next.top) / 2 : Infinity;
    if (y < limit) { li = i; break; }
  }
  const ln = lines[li];
  const items = [...ln.items].sort((a, b) => a.x - b.x);
  const lineEnd = li < lines.length - 1 && lines[li + 1].para === ln.para ? ln.end : ln.end;
  if (!items.length) return ln.start;
  if (x <= items[0].x) return edgeIndex(items[0], 'left');
  if (x >= items[items.length - 1].x + items[items.length - 1].adv) return edgeIndex(items[items.length - 1], 'right', lineEnd);
  for (const it of items) {
    if (x >= it.x && x <= it.x + it.adv) {
      const leftHalf = x < it.x + it.adv / 2;
      return edgeIndex(it, leftHalf ? 'left' : 'right', lineEnd);
    }
  }
  return ln.end;
}

function edgeIndex(it, side, lineEnd = Infinity) {
  const rtl = it.level & 1;
  const after = it.index + it.len;
  let pos;
  if (side === 'left') pos = rtl ? after : it.index;
  else pos = rtl ? it.index : after;
  // a soft-wrapped line's trailing space: keep caret on this line
  return Math.min(pos, lineEnd);
}

/** Selection highlight rectangles (local coordinates). */
export function selectionRects(layout, start, end) {
  if (start === end) return [];
  if (start > end) [start, end] = [end, start];
  const rects = [];
  for (const ln of layout.lines) {
    const sel = ln.items.filter((it) => it.index + it.len > start && it.index < end).sort((a, b) => a.x - b.x);
    let cur = null;
    for (const it of sel) {
      if (cur && Math.abs(cur.x + cur.w - it.x) < 1) cur.w = it.x + it.adv - cur.x;
      else { cur = { x: it.x, y: ln.top, w: it.adv, h: ln.bottom - ln.top }; rects.push(cur); }
    }
    // selected paragraph break: show a small block at line end
    if (ln.paraEnd && end > ln.end && start <= ln.end) {
      const cx = ln.rtl ? ln.x0 - 8 : ln.x0 + ln.width;
      rects.push({ x: cx, y: ln.top, w: 8, h: ln.bottom - ln.top });
    }
  }
  return rects;
}

/** Position one line up/down keeping the goal x. */
export function moveVertical(layout, pos, dir, goalX) {
  const li = lineOfPos(layout, pos);
  const target = li + dir;
  if (target < 0) return 0;
  if (target >= layout.lines.length) return layout.length;
  const ln = layout.lines[target];
  return hitTest(layout, goalX, ln.baseline - ln.ascent / 2);
}

export function lineStartEnd(layout, pos) {
  const ln = layout.lines[lineOfPos(layout, pos)];
  return ln ? [ln.start, ln.end] : [0, 0];
}

/** Visual left/right movement: returns new logical position. */
export function moveHorizontal(layout, doc, pos, dirVisual) {
  // move logically, flipped for right-to-left characters
  const li = lineOfPos(layout, pos);
  const ln = layout.lines[li];
  const probe = dirVisual > 0 ? itemAt(ln, pos) || itemAt(ln, pos - 1) : itemAt(ln, pos - 1) || itemAt(ln, pos);
  const rtl = probe ? probe.level & 1 : ln && ln.rtl;
  const step = rtl ? -dirVisual : dirVisual;
  let next = pos + step;
  // skip over ligature clusters
  for (const l of layout.lines) for (const it of l.items) if (it.len > 1 && next > it.index && next < it.index + it.len) next = step > 0 ? it.index + it.len : it.index;
  return Math.max(0, Math.min(doc.chars.length, next));
}

/** Ink bounds of the laid-out glyphs (local coords), including missing-glyph boxes. */
export function inkBounds(layout) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of layout.items) {
    if (it.isSpace) continue;
    let gx0, gy0, gx1, gy1;
    if (it.glyph) {
      const g = it.glyph;
      gx0 = it.x + g.lsb * it.kx; gx1 = gx0 + g.image.width * g.scale * it.kx;
      gy0 = it.baseline - g.baseline * g.scale * it.kv; gy1 = gy0 + g.image.height * g.scale * it.kv;
    } else { gx0 = it.x; gx1 = it.x + it.adv; gy0 = it.baseline - it.ascent; gy1 = it.baseline + it.descent; }
    if (gx0 < x0) x0 = gx0; if (gy0 < y0) y0 = gy0; if (gx1 > x1) x1 = gx1; if (gy1 > y1) y1 = gy1;
  }
  for (const ln of layout.lines) { if (ln.top < y0) y0 = ln.top; if (ln.bottom > y1) y1 = ln.bottom; }
  if (x0 === Infinity) { x0 = layout.frame.x; x1 = x0 + Math.max(10, layout.frame.w); y0 = 0; y1 = Math.max(10, layout.frame.h); }
  if (layout.mode === 'box') { x0 = Math.min(x0, layout.frame.x); x1 = Math.max(x1, layout.frame.x + layout.frame.w); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
