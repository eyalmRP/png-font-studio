// Rich text document: an array of code points with a parallel array of character styles and one
// paragraph style per paragraph ('\n' separates paragraphs). Styles are treated as immutable objects.

export const DEFAULT_CHAR = Object.freeze({
  font: null,
  size: 120,
  tracking: 0, // 1/1000 em added after each character
  kerning: 'optical', // optical | metrics | none
  kern: 0, // manual kern before this character, 1/1000 em
  baselineShift: 0, // px, up is positive
  scaleX: 100,
  scaleY: 100,
  rotate: 0, // degrees, per character
  skew: 0, // degrees, faux italic
  caps: 'normal', // normal | upper | lower | title | small
  script: 'normal', // normal | super | sub
  underline: false,
  strike: false,
  lineColor: '#ffffff',
  opacity: 100,
  tintMode: 'none', // none | hsl | colorize
  hue: 0,
  sat: 0,
  light: 0,
  tintColor: '#ff3d8b',
  tintAmount: 100,
});

export const DEFAULT_PARA = Object.freeze({
  align: 'center', // left | center | right | justify
  justifyLast: 'start', // start | center | end | full
  direction: 'auto', // auto | ltr | rtl
  indentStart: 0,
  indentEnd: 0,
  firstIndent: 0,
  spaceBefore: 0,
  spaceAfter: 0,
  lineMode: 'multiple', // multiple | exact | atLeast
  lineValue: 1,
  wordSpacing: 100,
});

export const CHAR_KEYS = Object.keys(DEFAULT_CHAR);
export const PARA_KEYS = Object.keys(DEFAULT_PARA);

export function createDoc(text = '', charStyle = {}, paraStyle = {}) {
  const cs = { ...DEFAULT_CHAR, ...charStyle };
  const chars = [...text];
  const doc = { chars, styles: chars.map(() => cs), paras: [], typing: cs };
  const nParas = chars.filter((c) => c === '\n').length + 1;
  for (let i = 0; i < nParas; i++) doc.paras.push({ ...DEFAULT_PARA, ...paraStyle });
  return doc;
}

export function cloneDoc(doc) {
  return { chars: [...doc.chars], styles: [...doc.styles], paras: doc.paras.map((p) => ({ ...p })), typing: doc.typing };
}

export const docText = (doc) => doc.chars.join('');

/** Paragraph index containing logical position pos (0..length). */
export function paraIndexAt(doc, pos) {
  let p = 0;
  for (let i = 0; i < pos && i < doc.chars.length; i++) if (doc.chars[i] === '\n') p++;
  return p;
}

/** [start, end) of every paragraph (end excludes the '\n'). */
export function paraRanges(doc) {
  const out = [];
  let s = 0;
  for (let i = 0; i <= doc.chars.length; i++) {
    if (i === doc.chars.length || doc.chars[i] === '\n') { out.push([s, i]); s = i + 1; }
  }
  return out;
}

/** Style used for typing at pos: the character before, else the one after, else the doc's typing style. */
export function styleAt(doc, pos) {
  if (pos > 0 && doc.chars[pos - 1] !== '\n') return doc.styles[pos - 1];
  if (pos < doc.chars.length && doc.chars[pos] !== '\n') return doc.styles[pos];
  if (pos > 0) return doc.styles[pos - 1];
  return doc.styles[pos] || doc.typing;
}

/** Insert text at pos with style. Returns new caret position. Mutates doc. */
export function insertText(doc, pos, text, style) {
  const ins = [...text];
  const st = style || styleAt(doc, pos);
  const pi = paraIndexAt(doc, pos);
  const newParas = ins.filter((c) => c === '\n').length;
  doc.chars.splice(pos, 0, ...ins);
  doc.styles.splice(pos, 0, ...ins.map(() => st));
  if (newParas) {
    const base = doc.paras[pi];
    const add = [];
    for (let i = 0; i < newParas; i++) add.push({ ...base });
    doc.paras.splice(pi + 1, 0, ...add);
  }
  return pos + ins.length;
}

/** Delete [start, end). Mutates doc. */
export function deleteRange(doc, start, end) {
  if (end <= start) return start;
  const removedBreaks = doc.chars.slice(start, end).filter((c) => c === '\n').length;
  const pi = paraIndexAt(doc, start);
  doc.chars.splice(start, end - start);
  doc.styles.splice(start, end - start);
  if (removedBreaks) doc.paras.splice(pi + 1, removedBreaks);
  if (!doc.paras.length) doc.paras.push({ ...DEFAULT_PARA });
  return start;
}

/** Apply a partial character style to [start, end). Mutates doc; returns doc. */
export function applyCharStyle(doc, start, end, patch) {
  const cache = new Map();
  for (let i = start; i < end; i++) {
    const old = doc.styles[i];
    let next = cache.get(old);
    if (!next) { next = Object.freeze({ ...old, ...patch }); cache.set(old, next); }
    doc.styles[i] = next;
  }
  return doc;
}

/** Apply a partial paragraph style to every paragraph touching [start, end]. */
export function applyParaStyle(doc, start, end, patch) {
  const a = paraIndexAt(doc, start), b = paraIndexAt(doc, end);
  for (let p = a; p <= b; p++) doc.paras[p] = { ...doc.paras[p], ...patch };
  return doc;
}

/** Common value of a style key across [start, end) — undefined when mixed. */
export function commonStyle(doc, start, end, keys = CHAR_KEYS) {
  if (start === end) { const s = styleAt(doc, start); return Object.fromEntries(keys.map((k) => [k, s[k]])); }
  const out = {};
  for (const k of keys) {
    let v = doc.styles[start][k], mixed = false;
    for (let i = start + 1; i < end; i++) if (doc.styles[i][k] !== v) { mixed = true; break; }
    out[k] = mixed ? undefined : v;
  }
  return out;
}

export function commonPara(doc, start, end) {
  const a = paraIndexAt(doc, start), b = paraIndexAt(doc, end);
  const out = {};
  for (const k of PARA_KEYS) {
    let v = doc.paras[a][k], mixed = false;
    for (let p = a + 1; p <= b; p++) if (doc.paras[p][k] !== v) { mixed = true; break; }
    out[k] = mixed ? undefined : v;
  }
  return out;
}

const isWordChar = (c) => !!c && !/[\s.,:;!?¡¿'"‘’“”()[\]{}<>/\\|\-–—…•]/u.test(c);

export function wordAt(doc, pos) {
  let s = pos, e = pos;
  const c = doc.chars;
  if (!isWordChar(c[pos]) && isWordChar(c[pos - 1])) { s = pos - 1; e = pos - 1; }
  if (!isWordChar(c[s])) return [pos, Math.min(c.length, pos + 1)];
  while (s > 0 && isWordChar(c[s - 1])) s--;
  while (e < c.length && isWordChar(c[e])) e++;
  return [s, e];
}

export function nextWordBoundary(doc, pos, dir) {
  const c = doc.chars;
  let i = pos;
  if (dir > 0) {
    while (i < c.length && !isWordChar(c[i])) i++;
    while (i < c.length && isWordChar(c[i])) i++;
  } else {
    while (i > 0 && !isWordChar(c[i - 1])) i--;
    while (i > 0 && isWordChar(c[i - 1])) i--;
  }
  return i;
}

// ---------- serialisation as runs ----------

export function docToJSON(doc) {
  const runs = [];
  const styleIds = new Map();
  const styles = [];
  const idOf = (s) => {
    if (!styleIds.has(s)) {
      const diff = {};
      for (const k of CHAR_KEYS) if (s[k] !== DEFAULT_CHAR[k]) diff[k] = s[k];
      styleIds.set(s, styles.length); styles.push(diff);
    }
    return styleIds.get(s);
  };
  let cur = null;
  doc.chars.forEach((ch, i) => {
    const id = idOf(doc.styles[i]);
    if (cur && cur.s === id) cur.t += ch; else { cur = { t: ch, s: id }; runs.push(cur); }
  });
  return { runs, styles, paras: doc.paras.map((p) => { const d = {}; for (const k of PARA_KEYS) if (p[k] !== DEFAULT_PARA[k]) d[k] = p[k]; return d; }), typing: idOf(doc.typing) };
}

export function docFromJSON(json) {
  const styles = (json.styles || []).map((d) => Object.freeze({ ...DEFAULT_CHAR, ...d }));
  const doc = { chars: [], styles: [], paras: [], typing: styles[json.typing] || DEFAULT_CHAR };
  for (const r of json.runs || []) for (const ch of r.t) { doc.chars.push(ch); doc.styles.push(styles[r.s] || DEFAULT_CHAR); }
  doc.paras = (json.paras || []).map((d) => ({ ...DEFAULT_PARA, ...d }));
  const need = doc.chars.filter((c) => c === '\n').length + 1;
  while (doc.paras.length < need) doc.paras.push({ ...DEFAULT_PARA });
  doc.paras.length = need;
  return doc;
}
