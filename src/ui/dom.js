// Tiny DOM helpers and the icon set (Lucide, ISC licence).
import {
  Type, Shapes, Layers, Sparkles, Waves, Clapperboard, Download, Upload, Undo2, Redo2, Sun, Moon, Languages,
  Plus, Minus, Trash2, Copy, Eye, EyeOff, Lock, LockOpen, ChevronDown, ChevronRight, ChevronUp, ChevronLeft, MoreHorizontal,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, Play, Pause, SkipBack, Repeat, ZoomIn, ZoomOut, Maximize, Scan,
  Grid3x3, Ruler, Move, RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2, Crop, Eraser, Wand2, Palette, Replace,
  ImagePlus, FolderOpen, Save, X, Check, Search, Settings2, SlidersHorizontal, Pilcrow, CaseSensitive, Baseline,
  MoveHorizontal, MoveVertical, ArrowLeftRight, ArrowUpDown, Underline, Strikethrough, Superscript, Subscript,
  Italic, Film, FileImage, FileArchive, Info, TriangleAlert, Square, SquareDashed, TextCursorInput, MousePointer2,
  Hand, ScanText, Blend, Droplet, Sun as SunIcon, CircleDot, Spline, Box, Fingerprint, Shuffle, ListOrdered,
  IndentIncrease, IndentDecrease, ArrowDownToLine, ArrowUpToLine, PanelLeft, PanelRight, PanelBottom, Keyboard,
  GripVertical, Link2, Unlink2, Heart, Zap, Briefcase, Smile, PartyPopper, Timer, Hash, CaseUpper, CaseLower,
  WrapText, LetterText, Combine, Scissors, Pipette, Contrast, Paintbrush, Layers2, LayoutGrid, Cloud,
} from 'lucide';

export const ICONS = {
  type: Type, shapes: Shapes, layers: Layers, sparkles: Sparkles, waves: Waves, film: Clapperboard, download: Download,
  upload: Upload, undo: Undo2, redo: Redo2, sun: Sun, moon: Moon, languages: Languages, plus: Plus, minus: Minus,
  trash: Trash2, copy: Copy, eye: Eye, eyeOff: EyeOff, lock: Lock, unlock: LockOpen, chevronDown: ChevronDown,
  chevronRight: ChevronRight, chevronUp: ChevronUp, chevronLeft: ChevronLeft, more: MoreHorizontal, alignLeft: AlignLeft,
  alignCenter: AlignCenter, alignRight: AlignRight, alignJustify: AlignJustify, play: Play, pause: Pause,
  skipBack: SkipBack, repeat: Repeat, zoomIn: ZoomIn, zoomOut: ZoomOut, fit: Maximize, scan: Scan, grid: Grid3x3,
  ruler: Ruler, move: Move, rotateCw: RotateCw, rotateCcw: RotateCcw, flipH: FlipHorizontal2, flipV: FlipVertical2,
  crop: Crop, eraser: Eraser, wand: Wand2, palette: Palette, replace: Replace, imagePlus: ImagePlus, open: FolderOpen,
  save: Save, x: X, check: Check, search: Search, settings: Settings2, sliders: SlidersHorizontal, pilcrow: Pilcrow,
  caseSensitive: CaseSensitive, baseline: Baseline, moveH: MoveHorizontal, moveV: MoveVertical, arrowsH: ArrowLeftRight,
  arrowsV: ArrowUpDown, underline: Underline, strike: Strikethrough, superscript: Superscript, subscript: Subscript,
  italic: Italic, filmStrip: Film, fileImage: FileImage, archive: FileArchive, info: Info, alert: TriangleAlert,
  square: Square, squareDashed: SquareDashed, textCursor: TextCursorInput, pointer: MousePointer2, hand: Hand,
  scanText: ScanText, blend: Blend, droplet: Droplet, glow: SunIcon, dot: CircleDot, spline: Spline, box: Box,
  fingerprint: Fingerprint, shuffle: Shuffle, list: ListOrdered, indentInc: IndentIncrease, indentDec: IndentDecrease,
  spaceAfter: ArrowDownToLine, spaceBefore: ArrowUpToLine, panelLeft: PanelLeft, panelRight: PanelRight,
  panelBottom: PanelBottom, keyboard: Keyboard, grip: GripVertical, link: Link2, unlink: Unlink2, heart: Heart,
  zap: Zap, briefcase: Briefcase, smile: Smile, party: PartyPopper, timer: Timer, hash: Hash, caseUpper: CaseUpper,
  caseLower: CaseLower, wrap: WrapText, letters: LetterText, combine: Combine, scissors: Scissors, pipette: Pipette,
  contrast: Contrast, brush: Paintbrush, layers2: Layers2, layout: LayoutGrid, cloud: Cloud,
  // a hollow capital A: outlined text, for the stroke effect (lucide has none)
  outlineText: ['svg', Square[1], [['path', { d: 'M3 21 10 3h4l7 18h-4.5l-1.3-3.5H8.8L7.5 21Z' }], ['path', { d: 'M10.1 14h3.8L12 8.6Z' }]]],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function buildSvg([tag, attrs, children]) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const c of children || []) el.appendChild(buildSvg(c));
  return el;
}

export function icon(name, size = 16) {
  const node = ICONS[name];
  if (!node) return document.createTextNode('');
  const svg = buildSvg(node);
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ic');
  return svg;
}

/** h('div.cls#id', {attrs, on:{click}}, ...children) */
export function h(sel, props, ...children) {
  if (props instanceof Node || typeof props === 'string' || Array.isArray(props)) { children.unshift(props); props = null; }
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function storeGet(key, fallback) {
  try { const v = localStorage.getItem('pfs:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function storeSet(key, value) {
  try { localStorage.setItem('pfs:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function rafThrottle(fn) {
  let pending = false, args;
  return (...a) => {
    args = a;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...args); });
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function pickFiles({ accept = 'image/png,image/*', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}
