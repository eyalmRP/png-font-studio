// Sheet layout presets and per-character placement categories.

/** Built-in 6×6 layouts matching the bubble sheets (reading order, row-major). */
export const LAYOUTS = [
  {
    id: 'bubble-1', name: 'Sheet 1 · A–Z a–j', rows: 6, cols: 6,
    chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'],
  },
  {
    id: 'bubble-2', name: 'Sheet 2 · k–z 0–9 punctuation', rows: 6, cols: 6,
    chars: [...'klmnopqrstuvwxyz0123456789.,:;!?¡¿', "'", '"'],
  },
  {
    id: 'bubble-3', name: 'Sheet 3 · quotes, maths, brackets', rows: 6, cols: 6,
    chars: ['‘', '’', '“', '”', '`', '~', '…', '•', '+', '−', '×', '÷', '=', '≠', '≈', '≤', '≥', '±',
      '%', '‰', '∞', '√', 'π', 'Σ', '(', ')', '[', ']', '{', '}', '<', '>', '/', '\\', '|', '_'],
  },
  {
    id: 'bubble-4', name: 'Sheet 4 · dashes, currency, signs', rows: 6, cols: 6,
    chars: ['-', '–', '—', '^', '&', '*', '#', '@', '$', '€', '£', '¥', '₪', '¢', '₹', '₽', '₩', '₿',
      '©', '®', '™', '°', '§', '¶', '†', '‡', 'µ', 'Ω', '∆', '∂', '∫', '∏', '∈', '∩', '∪', '¬'],
  },
];

export const CHARSET_GROUPS = [
  { id: 'upper', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
  { id: 'lower', chars: [...'abcdefghijklmnopqrstuvwxyz'] },
  { id: 'digits', chars: [...'0123456789'] },
  { id: 'punct', chars: [...'.,:;!?¡¿\'"‘’“”`…•-–—_'] },
  { id: 'symbols', chars: [...'~+−×÷=≠≈≤≥±%‰∞√πΣ()[]{}<>/\\|^&*#@$€£¥₪¢₹₽₩₿©®™°§¶†‡µΩ∆∂∫∏∈∩∪¬'] },
  { id: 'hebrew', chars: [...'אבגדהוזחטיכךלמםנןסעפףצץקרשת'] },
];

/** Parse a user-typed mapping string. Whitespace separates nothing: every code point is a cell, except
 * that `\s` (literal backslash-s) means "skip this cell" and `\\` means a backslash. */
export function parseMapping(str) {
  const out = [];
  const cps = [...str.replace(/\r?\n/g, '')];
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] === '\\' && cps[i + 1] === 's') { out.push(null); i++; continue; }
    if (cps[i] === '\\' && cps[i + 1] === '\\') { out.push('\\'); i++; continue; }
    out.push(cps[i]);
  }
  return out;
}

export function mappingToString(chars) {
  return chars.map((c) => (c === null || c === undefined ? '\\s' : c === '\\' ? '\\\\' : c)).join('');
}

// Placement categories decide where a glyph sits relative to the baseline when metrics are automatic.
// base: bottom on baseline · desc: top at x-height (hangs below) · cap: top at cap height ·
// math: centred on the maths axis · center: centred on half cap height · j: top level with i ·
// comma: top level with the period · semi: top level with the colon · under: below the baseline.
const CATEGORY = new Map();
const put = (cat, chars) => { for (const c of chars) CATEGORY.set(c, cat); };
put('desc', 'gpqyµ¡¿');
put('j', 'j');
put('comma', ',');
put('semi', ';');
put('cap', '\'"‘’“”`^°™*');
put('math', '~•+−×÷=≠≈±-–—¬');
put('center', '()[]{}|/\\$¢§∫<>');
put('under', '_');

export function charCategory(ch) {
  if (CATEGORY.has(ch)) return CATEGORY.get(ch);
  // Hebrew final forms and qof hang below the baseline
  if ('ךןףץק'.includes(ch)) return 'base-desc';
  return 'base';
}

export const CAP_REF = [...'HEITLFNMZXKA'];
export const X_REF = [...'xzvwunmosceaR'.toLowerCase()];
export const ASC_REF = [...'bdfhkl'];
export const DESC_REF = [...'gpqy'];

/** Mirror pairs for right-to-left runs. */
export const MIRROR = new Map([['(', ')'], [')', '('], ['[', ']'], [']', '['], ['{', '}'], ['}', '{'], ['<', '>'], ['>', '<'], ['«', '»'], ['»', '«'], ['≤', '≥'], ['≥', '≤']]);

export function charLabel(ch) {
  if (ch === ' ') return 'Space';
  const cp = ch.codePointAt(0);
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}
