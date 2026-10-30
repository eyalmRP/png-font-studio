// Sheet layout presets and per-character placement categories.

/** Built-in 6×6 layouts matching the bubble sheets (reading order, row-major). */
export const LAYOUTS = [
  {
    id: 'bubble-1', name: 'Bubble sheet 1 · A–Z a–j', rows: 6, cols: 6,
    chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'],
  },
  {
    id: 'bubble-2', name: 'Bubble sheet 2 · k–z 0–9 punctuation', rows: 6, cols: 6,
    chars: [...'klmnopqrstuvwxyz0123456789.,:;!?¡¿', "'", '"'],
  },
  {
    id: 'bubble-3', name: 'Bubble sheet 3 · quotes, maths, brackets', rows: 6, cols: 6,
    chars: ['‘', '’', '“', '”', '`', '~', '…', '•', '+', '−', '×', '÷', '=', '≠', '≈', '≤', '≥', '±',
      '%', '‰', '∞', '√', 'π', 'Σ', '(', ')', '[', ']', '{', '}', '<', '>', '/', '\\', '|', '_'],
  },
  {
    id: 'bubble-4', name: 'Bubble sheet 4 · dashes, currency, signs', rows: 6, cols: 6,
    chars: ['-', '–', '—', '^', '&', '*', '#', '@', '$', '€', '£', '¥', '₪', '¢', '₹', '₽', '₩', '₿',
      '©', '®', '™', '°', '§', '¶', '†', '‡', 'µ', 'Ω', '∆', '∂', '∫', '∏', '∈', '∩', '∪', '¬'],
  },
];

/**
 * Layouts of the six ChatGPT prompt sheets (7×4, last one 3×3). `ref` is the index of the reference H
 * used only to match sizes between sheets.
 */
const rowsOf = (...rows) => rows.flatMap((r) => r.split(' '));
export const PROMPT_LAYOUTS = [
  { id: 'prompt-1', name: 'Prompt sheet 1 · capitals', rows: 4, cols: 7, chars: rowsOf('A B C D E F G', 'H I J K L M N', 'O P Q R S T U', 'V W X Y Z ! ?') },
  { id: 'prompt-2', name: 'Prompt sheet 2 · lowercase', rows: 4, cols: 7, ref: 26, chars: rowsOf('a b c d e f g', 'h i j k l m n', 'o p q r s t u', 'v w x y z H .') },
  { id: 'prompt-3', name: 'Prompt sheet 3 · digits & punctuation', rows: 4, cols: 7, ref: 27, chars: rowsOf("0 1 2 3 4 5 6", "7 8 9 , : ; '", '" ‘ ’ “ ” ¡ ¿', '- – — … • ` H') },
  { id: 'prompt-4', name: 'Prompt sheet 4 · brackets & signs', rows: 4, cols: 7, ref: 27, chars: rowsOf('( ) [ ] { } /', '\\ | _ < > ~ ^', '& * # @ % ‰ §', '¶ † ‡ © ® ™ H') },
  { id: 'prompt-5', name: 'Prompt sheet 5 · currency & maths', rows: 4, cols: 7, ref: 27, chars: rowsOf('$ € £ ¥ ₪ ¢ ₹', '₽ ₩ ₿ ° + − ×', '÷ = ≠ ≈ ≤ ≥ ±', '∞ √ π Σ µ Ω H') },
  { id: 'prompt-6', name: 'Prompt sheet 6 · more maths', rows: 3, cols: 3, ref: 8, chars: rowsOf('∆ ∂ ∫', '∏ ∈ ∩', '∪ ¬ H') },
  // redraws of glyphs that came out wrong or in a different weight; the H is only a size reference
  { id: 'prompt-7', name: 'Prompt sheet 7 · fixes (maths symbols and l)', rows: 2, cols: 5, ref: 9, chars: rowsOf('∆ ∂ ∫ ∏ ∈', '∩ ∪ ¬ l H') },
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
export const X_REF = [...'xzvwunmr']; // mostly flat-topped; round letters overshoot
export const ASC_REF = [...'bdfhkl'];
export const DESC_REF = [...'gpqy'];

/** Mirror pairs for right-to-left runs. */
export const MIRROR = new Map([['(', ')'], [')', '('], ['[', ']'], [']', '['], ['{', '}'], ['}', '{'], ['<', '>'], ['>', '<'], ['«', '»'], ['»', '«'], ['≤', '≥'], ['≥', '≤']]);

export function charLabel(ch) {
  if (ch === ' ') return 'Space';
  const cp = ch.codePointAt(0);
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Groups whose members should share a height (used to even out sheets where every cell was scaled to fit). */
export const SIZE_GROUPS = [
  { id: 'caps', chars: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] },
  { id: 'xheight', chars: [...'acemnorsuvwxz'] },
  { id: 'ascender', chars: [...'bdfhklt'] },
  { id: 'descender', chars: [...'gpqy'] },
  { id: 'digits', chars: [...'0123456789'] },
  { id: 'hebrew', chars: [...'אבגדהוזחטכמנסעפצרשתם'] },
  { id: 'hebrewDesc', chars: [...'קךןףץ'] },
];

// Optical overshoot: round shapes extend past the flat guide lines so they look the same size.
// both = above the top line and below the baseline · top = above only · bottom = below only.
const ROUND = new Map();
const round = (side, chars) => { for (const c of chars) ROUND.set(c, side); };
round('both', 'CGOQS' + 'oces' + 'a' + '03689' + '@©®' + 'סםעט');
round('top', 'nmhr2' + 'gpq' + 'f');
round('bottom', 'JUu5bdt' + 'ו');

/** Which sides of a character overshoot: 'both' | 'top' | 'bottom' | null. glyph.round overrides when set. */
export function roundSides(ch, override) {
  if (override !== undefined && override !== null && override !== 'auto') return override === 'none' ? null : override;
  return ROUND.get(ch) || null;
}
