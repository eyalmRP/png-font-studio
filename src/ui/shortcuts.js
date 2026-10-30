// Keyboard shortcuts dialog: press ? or the keyboard button in the top bar. The list follows the key handlers in
// app.js, titles/stage.js, titles/titles.js, titles/player.js, fonts/fonts.js and the number field in controls.js;
// change it with them.
import { h } from './dom.js';
import { t } from './i18n.js';
import { modal } from './controls.js';

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const KEY_NAMES = MAC ? { Ctrl: '⌘', Alt: '⌥', Shift: '⇧' } : {};
// words that stand for a mouse action rather than a key
const WORDS = { drag: 'drag', wheel: 'wheel', 'double-click': 'Double-click', 'triple-click': 'Triple-click', click: 'click', arrows: 'Arrow keys' };

// each row: [combos, what it does]; a combo is keys joined with +, combos are alternatives
const GROUPS = [
  ['Anywhere', [
    [['Ctrl+Z'], 'Undo'],
    [['Ctrl+Shift+Z', 'Ctrl+Y'], 'Redo'],
    [['?'], 'Keyboard shortcuts'],
  ]],
  ['Stage', [
    [['V'], 'Select and move'],
    [['T'], 'Text tool: click the artboard to add a title'],
    [['H'], 'Hand: drag to pan'],
    [['Space+drag'], 'Pan while held'],
    [['wheel'], 'Pan'],
    [['Ctrl+wheel'], 'Zoom at the pointer'],
    [['Ctrl+=', 'Ctrl+-'], 'Zoom in / out'],
    [['Ctrl+0'], 'Fit the artboard'],
    [['K'], 'Play / pause'],
  ]],
  ['Selected title', [
    [['Enter', 'double-click'], 'Edit its text'],
    [['arrows'], 'Nudge 1 px (Shift: 10 px)'],
    [['Alt+←', 'Alt+→'], 'Tracking of the whole title (Shift: ×5)'],
    [['Ctrl+D'], 'Duplicate'],
    [['Delete'], 'Delete'],
    [['Shift+drag'], 'Move along one axis · rotate in 15° steps · scale freely from a corner'],
  ]],
  ['Typing on the canvas', [
    [['Esc'], 'Finish editing'],
    [['Shift+arrows'], 'Select letters'],
    [['Ctrl+←', 'Ctrl+→'], 'Jump a word'],
    [['Home', 'End'], 'Start / end of the line (Ctrl: of the text)'],
    [['double-click', 'triple-click'], 'Select a word / paragraph'],
    [['Ctrl+A'], 'Select all'],
    [['Alt+←', 'Alt+→'], 'Kern the pair at the caret, or track the selection (Shift: ×5)'],
    [['Alt+↑', 'Alt+↓'], 'Line spacing'],
    [['Alt+Shift+↑', 'Alt+Shift+↓'], 'Baseline shift'],
    [['Ctrl+Shift+>', 'Ctrl+Shift+<'], 'Bigger / smaller text'],
    [['Ctrl+U'], 'Underline'],
    [['Ctrl+Backspace', 'Alt+Backspace'], 'Delete the word before the caret'],
  ]],
  ['Number fields', [
    [['↑', '↓'], 'Step (Shift: ×10, Alt: ×0.1)'],
    [['drag'], 'Drag the label or the field sideways to scrub'],
    [['double-click'], 'Double-click the label to reset'],
    [['Enter'], 'Type maths like 120*2 and press Enter'],
  ]],
  ['Fonts', [
    [['Shift+click', 'Ctrl+click'], 'Select several glyphs'],
    [['Delete'], 'Delete the selected glyphs'],
    [['Ctrl+V'], 'Paste an image into the selected glyph'],
    [['Shift+drag', 'Alt+drag'], 'In the glyph preview: move only up and down / only sideways'],
  ]],
];

function combo(text) {
  // '+' alone is a key, so split on the + that joins two names
  const keys = text.split(/\+(?=.)/);
  return h('span.combo', keys.map((k, i) => [i ? h('span.plus', '+') : null, WORDS[k] ? h('span.word', t(WORDS[k])) : h('kbd.kbd', KEY_NAMES[k] || k)]));
}

let open = null;
export function showShortcuts() {
  if (open) return open;
  const body = h('div.keys-grid', GROUPS.map(([title, rows]) => h('section.keys-group',
    h('h3.tool-head', t(title)),
    rows.map(([combos, what]) => h('div.keys-row', h('span.keys-what', t(what)), h('span.keys-combos', combos.map((c, i) => [i ? h('span.or', '/') : null, combo(c)])))))));
  open = modal({ title: t('Keyboard shortcuts'), iconName: 'keyboard', class: 'modal-md', body, onClose: () => { open = null; } });
  return open;
}
