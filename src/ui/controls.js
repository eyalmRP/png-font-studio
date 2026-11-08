// Controls kit: scrub number fields, sliders, angle dials, pills, switches, sections, tabs, colour and gradient fields.
import { GRADIENT_PRESETS, gradientCss, stopCss } from '../core/gradients.js';
import { h, icon, storeGet, storeSet } from './dom.js';
import { t } from './i18n.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Evaluate a small arithmetic expression ("12*2", "100/3+4"). Returns NaN when invalid. */
export function evalExpr(str) {
  const s = String(str).replace(/,/g, '.').replace(/[^\d.+\-*/() ]/g, '');
  let i = 0;
  const peek = () => s[i], eat = () => s[i++];
  const ws = () => { while (s[i] === ' ') i++; };
  function num() {
    ws();
    if (peek() === '(') { eat(); const v = expr(); ws(); eat(); return v; }
    if (peek() === '-') { eat(); return -num(); }
    if (peek() === '+') { eat(); return num(); }
    let j = i; while (/[\d.]/.test(s[i] || '')) i++;
    return parseFloat(s.slice(j, i));
  }
  function term() { let v = num(); ws(); while (peek() === '*' || peek() === '/') { const op = eat(); const r = num(); v = op === '*' ? v * r : v / r; ws(); } return v; }
  function expr() { let v = term(); ws(); while (peek() === '+' || peek() === '-') { const op = eat(); const r = term(); v = op === '+' ? v + r : v - r; ws(); } return v; }
  const v = expr();
  ws();
  return i >= s.length && Number.isFinite(v) ? v : NaN;
}

function roundTo(v, decimals) { const f = 10 ** decimals; return Math.round(v * f) / f; }

/** Sliders paint their filled part from --fill: WebKit has no pseudo-element for it. */
export function rangeFill(r) {
  const min = +r.min || 0, max = +r.max || 100;
  r.style.setProperty('--fill', `${((+r.value - min) / (max - min || 1)) * 100}%`);
}

/**
 * Number field: drag on the label or the field to scrub, ▲▼ buttons, arrow keys, wheel when focused,
 * typed maths, optional slider. onInput fires live, onChange on commit (pointer up / enter / blur).
 */
export function numberField(o) {
  const { label, iconName, min = -Infinity, max = Infinity, step = 1, unit = '', slider = false, title } = o;
  const decimals = o.decimals ?? (step < 1 ? Math.min(3, String(step).split('.')[1]?.length || 1) : 0);
  const sMin = o.sliderMin ?? (Number.isFinite(min) ? min : 0), sMax = o.sliderMax ?? (Number.isFinite(max) ? max : 100);
  let value = o.value;
  // iOS's decimal keypad has no minus key, so fields that go negative get the full keyboard
  // numbers read left to right in Hebrew too, so a minus sign stays in front
  const input = h('input.nf-input', { type: 'text', dir: 'ltr', inputMode: min < 0 ? 'text' : 'decimal', spellcheck: false, 'aria-label': label || title || '' });
  const up = h('button.nf-spin.nf-up', { type: 'button', tabIndex: -1, title: t('Increase') }, icon('chevronUp', 11));
  const down = h('button.nf-spin.nf-down', { type: 'button', tabIndex: -1, title: t('Decrease') }, icon('chevronDown', 11));
  const hasDef = o.def !== undefined && o.def !== null;
  const tip = (title || label || '') + (hasDef ? ` · ${t('Double-click to reset')} (${o.def}${unit})` : '');
  const lab = label || iconName ? h('span.nf-label', { title: tip }, iconName ? icon(iconName, 14) : null, label ? h('span', label) : null) : null;
  const box = h('div.nf-box', input, unit ? h('span.nf-unit', unit) : null, h('div.nf-spins', up, down));
  const range = slider ? h('input.nf-slider', { type: 'range', min: sMin, max: sMax, step: o.sliderStep ?? step, tabIndex: -1, 'aria-label': label || title || '' }) : null;
  const el = h('div.nf', { class: o.class || '', title: title || '' }, h('div.nf-row', lab, box), range);
  const fmt = (v) => (v === undefined || v === null || Number.isNaN(v) ? '' : String(roundTo(v, decimals)));
  const render = () => {
    if (document.activeElement !== input) input.value = fmt(value);
    input.placeholder = value === undefined ? '—' : '';
    if (range && value !== undefined) { range.value = clamp(value, sMin, sMax); rangeFill(range); }
    el.classList.toggle('mixed', value === undefined);
  };
  const setLive = (v, commit) => {
    v = clamp(roundTo(v, decimals + 2), min, max);
    value = v; render();
    o.onInput && o.onInput(v);
    if (commit) o.onChange && o.onChange(v);
  };
  const stepMul = (e) => (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
  // scrubbing (label and field)
  function scrubbable(target, focusOnClick) {
    target.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX, startV = value ?? o.fallback ?? 0;
      let moved = false;
      target.setPointerCapture(e.pointerId);
      if (!focusOnClick || document.activeElement !== input) e.preventDefault();
      const move = (ev) => {
        const dx = (ev.clientX - startX) * (document.documentElement.dir === 'rtl' ? -1 : 1);
        if (!moved && Math.abs(dx) < 3) return;
        if (!moved) { moved = true; el.classList.add('scrubbing'); input.blur(); }
        const perPx = (o.scrubStep ?? step) * stepMul(ev) / 2;
        setLive(startV + Math.round(dx) * perPx, false);
      };
      const upH = (ev) => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', upH);
        target.removeEventListener('pointercancel', upH);
        el.classList.remove('scrubbing');
        if (moved) o.onChange && o.onChange(value);
        // a cancel is the page taking the touch to scroll: no keyboard then
        else if (focusOnClick && ev.type !== 'pointercancel') { input.focus(); input.select(); }
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', upH);
      target.addEventListener('pointercancel', upH);
    });
  }
  if (lab) scrubbable(lab, false);
  // double-click the label or the slider to return to the default value
  if (hasDef) for (const target of [lab, range]) if (target) target.addEventListener('dblclick', (e) => { e.preventDefault(); setLive(o.def, true); });
  scrubbable(input, true);
  // spinners with press-and-hold repeat
  for (const [btn, dir] of [[up, 1], [down, -1]]) {
    let timer;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const go = () => setLive((value ?? 0) + dir * step * stepMul(e), false);
      go();
      timer = setTimeout(function rep() { go(); timer = setTimeout(rep, 50); }, 380);
      const stop = () => { clearTimeout(timer); window.removeEventListener('pointerup', stop); o.onChange && o.onChange(value); };
      window.addEventListener('pointerup', stop);
    });
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setLive((value ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * stepMul(e), true);
      input.value = fmt(value); input.select();
    } else if (e.key === 'Enter') { commitText(); input.select(); }
    else if (e.key === 'Escape') { input.value = fmt(value); input.blur(); }
    e.stopPropagation();
  });
  const commitText = () => {
    const raw = input.value.trim();
    if (raw === '') { render(); return; }
    const v = evalExpr(raw);
    if (!Number.isNaN(v)) setLive(v, true); else render();
  };
  input.addEventListener('blur', commitText);
  input.addEventListener('wheel', (e) => {
    if (document.activeElement !== input) return;
    e.preventDefault();
    setLive((value ?? 0) + (e.deltaY < 0 ? 1 : -1) * step * stepMul(e), true);
    input.value = fmt(value);
  }, { passive: false });
  if (range) {
    range.addEventListener('input', () => setLive(parseFloat(range.value), false));
    range.addEventListener('change', () => o.onChange && o.onChange(value));
  }
  el.setValue = (v) => { value = v; render(); };
  el.getValue = () => value;
  render();
  return el;
}

/** Circular angle control with a scrub field. Angles in degrees, 0 = right, counter-clockwise positive (Adobe). */
export function angleField(o) {
  let value = o.value ?? 0;
  const knob = h('div.ang-knob');
  const dial = h('div.ang-dial', { title: o.label || t('Angle'), role: 'slider', tabIndex: 0, 'aria-label': o.label || t('Angle') }, knob, h('div.ang-dot'));
  const nf = numberField({
    label: o.label, iconName: o.iconName, value, min: -360, max: 360, step: 1, unit: '°', def: o.def,
    onInput: (v) => { value = v; draw(); o.onInput && o.onInput(v); },
    onChange: (v) => o.onChange && o.onChange(v),
  });
  const draw = () => { knob.style.transform = `rotate(${-(value ?? 0)}deg)`; dial.classList.toggle('mixed', value === undefined); };
  const fromEvent = (e, snap) => {
    const r = dial.getBoundingClientRect();
    let a = (Math.atan2(-(e.clientY - (r.top + r.height / 2)), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    if (snap) a = Math.round(a / 15) * 15;
    return Math.round(a);
  };
  if (o.def !== undefined) dial.addEventListener('dblclick', () => { value = o.def; nf.setValue(value); draw(); o.onInput && o.onInput(value); o.onChange && o.onChange(value); });
  dial.addEventListener('pointerdown', (e) => {
    dial.setPointerCapture(e.pointerId);
    const set = (ev, commit) => { value = fromEvent(ev, ev.shiftKey); nf.setValue(value); draw(); o.onInput && o.onInput(value); if (commit) o.onChange && o.onChange(value); };
    set(e, false);
    const mv = (ev) => set(ev, false);
    const upH = (ev) => { dial.removeEventListener('pointermove', mv); dial.removeEventListener('pointerup', upH); set(ev, true); };
    dial.addEventListener('pointermove', mv);
    dial.addEventListener('pointerup', upH);
  });
  dial.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      value = (value ?? 0) + ((e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : -1) * (e.shiftKey ? 15 : 1);
      nf.setValue(value); draw(); o.onChange && o.onChange(value);
    }
  });
  // the dial follows the box, so the label lines up with the fields above and below
  nf.querySelector('.nf-row').append(dial);
  const el = h('div.ang', nf);
  el.setValue = (v) => { value = v; nf.setValue(v); draw(); };
  draw();
  return el;
}

/** Segmented pills. options: [{ value, label, icon, title }] */
export function pills(o) {
  let value = o.value;
  const btns = o.options.map((op) => {
    const b = h('button.pill', {
      type: 'button', title: op.title || op.label || '', 'aria-label': op.title || op.label || '',
      on: { click: () => { if (o.multi) { value = { ...value, [op.value]: !value?.[op.value] }; } else value = op.value; render(); o.onChange && o.onChange(o.multi ? value : op.value); } },
    }, op.icon ? icon(op.icon, 15) : null, op.label && !o.iconOnly ? h('span', op.label) : null);
    b.dataset.value = op.value;
    return b;
  });
  const el = h('div.pills', { class: o.class || '', role: 'group' }, btns);
  const render = () => btns.forEach((b, i) => {
    const on = o.multi ? !!value?.[o.options[i].value] : value === o.options[i].value;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  });
  el.setValue = (v) => { value = v; render(); };
  render();
  return el;
}

/** Pill switch (on/off). */
export function toggle(o) {
  let value = !!o.value;
  const sw = h('button.switch', { type: 'button', role: 'switch', 'aria-label': o.label || o.title || '', title: o.title || '' }, h('span.switch-knob'));
  const el = h('label.toggle', { class: o.class || '' }, o.iconName ? icon(o.iconName, 15) : null, o.label ? h('span.toggle-label', o.label) : null, sw);
  const render = () => { sw.classList.toggle('on', value); sw.setAttribute('aria-checked', value); };
  sw.addEventListener('click', (e) => { e.preventDefault(); value = !value; render(); o.onChange && o.onChange(value); });
  el.setValue = (v) => { value = !!v; render(); };
  render();
  return el;
}

/** Collapsible section; open state remembered per id. */
export function section(o, ...children) {
  const key = 'sec:' + o.id;
  let open = storeGet(key, o.open ?? true);
  const body = h('div.sec-body', children);
  const head = h('button.sec-head', { type: 'button', 'aria-expanded': open },
    h('span.sec-chev', icon('chevronRight', 14)),
    o.iconName ? icon(o.iconName, 15) : null,
    h('span.sec-title', o.title),
    o.badge ? h('span.sec-badge', o.badge) : null);
  const reset = o.onReset ? iconButton('rotateCcw', o.resetLabel || t('Reset to default'), () => o.onReset(), { class: 'sec-reset' }) : null;
  const actions = h('div.sec-actions', ...(o.actions || []), reset);
  const top = h('div.sec-top', head, actions);
  const el = h('section.sec', { class: o.class || '' }, top, body);
  const render = () => { el.classList.toggle('open', open); head.setAttribute('aria-expanded', open); };
  // right-click a panel's header: its own buttons as a menu (show, move, reset, duplicate, delete…), and fold it
  top.addEventListener('contextmenu', (e) => {
    const btns = [...actions.querySelectorAll('button')].filter((b) => b.getClientRects().length);
    contextMenu(e, [
      { label: open ? t('Collapse') : t('Expand'), icon: open ? 'chevronUp' : 'chevronDown', onClick: () => head.click() },
      btns.length && '-',
      ...btns.map((b) => ({ label: b.getAttribute('aria-label') || b.title || b.textContent.trim(), iconNode: b.querySelector('svg'), disabled: b.disabled, onClick: () => b.click() })),
    ]);
  });
  head.addEventListener('click', () => { open = !open; storeSet(key, open); render(); });
  el.body = body;
  render();
  return el;
}

/** Tab bar with icons. */
export function tabs(o) {
  let value = o.value;
  const btns = o.tabs.map((tb) => h('button.tab', {
    type: 'button', role: 'tab', title: tb.label, 'aria-label': tb.label,
    on: { click: () => { value = tb.id; render(); o.onChange && o.onChange(tb.id); } },
  }, icon(tb.icon, 16), o.compact ? null : h('span.tab-label', tb.short || tb.label)));
  const el = h('div.tabs', { role: 'tablist', class: o.class || '' }, btns);
  const render = () => btns.forEach((b, i) => { const on = o.tabs[i].id === value; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  el.setValue = (v) => { value = v; render(); };
  render();
  return el;
}

export function select(o) {
  const s = h('select.sel', { 'aria-label': o.label || '', title: o.title || o.label || '' },
    o.options.map((op) => op.group ? h('optgroup', { label: op.group }, op.options.map((x) => h('option', { value: x.value }, x.label))) : h('option', { value: op.value }, op.label)));
  s.value = o.value;
  s.addEventListener('change', () => o.onChange && o.onChange(s.value));
  const el = o.label ? h('label.sel-wrap', h('span.sel-label', o.iconName ? icon(o.iconName, 14) : null, o.label), s) : s;
  el.setValue = (v) => { s.value = v ?? ''; };
  return el;
}

export function button(o) {
  return h('button.btn', {
    type: 'button', class: (o.kind ? 'btn-' + o.kind : '') + (o.class ? ' ' + o.class : ''), title: o.title || o.label || '',
    disabled: o.disabled, 'aria-label': o.title || o.label || '', on: { click: o.onClick },
  }, o.icon ? icon(o.icon, o.iconSize || 16) : null, o.label ? h('span', o.label) : null);
}

export const iconButton = (name, title, onClick, extra = {}) => button({ icon: name, title, onClick, class: 'icon-btn ' + (extra.class || ''), disabled: extra.disabled });

export function row(label, ...controls) {
  return h('div.row', label ? h('span.row-label', label) : null, h('div.row-ctl', controls));
}

const hex2 = (n) => n.toString(16).padStart(2, '0');
export function normHex(v) {
  let s = String(v || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = [...s].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}
export function hexToRgb(hex) { const n = parseInt(normHex(hex)?.slice(1) || '000000', 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgbToHex([r, g, b]) { return '#' + hex2(Math.round(r)) + hex2(Math.round(g)) + hex2(Math.round(b)); }

/** Colour swatch with native picker and hex input. */
export function colorField(o) {
  let value = normHex(o.value) || '#ffffff';
  const picker = h('input.cf-picker', { type: 'color', value, tabIndex: -1, 'aria-label': o.label || t('Colour') });
  const sw = h('span.cf-swatch', picker);
  const text = h('input.cf-hex', { type: 'text', dir: 'ltr', value, spellcheck: false, maxLength: 7, 'aria-label': (o.label || t('Colour')) + ' hex' });
  const el = h('div.cf', o.label ? h('span.cf-label', o.label) : null, sw, text);
  // the hex box always shows the colour (typing in it fires nothing until Enter or leaving it)
  const render = () => { sw.style.background = value; picker.value = value; text.value = value; };
  picker.addEventListener('input', () => { value = picker.value; render(); o.onInput && o.onInput(value); });
  picker.addEventListener('change', () => { value = picker.value; render(); o.onChange && o.onChange(value); });
  text.addEventListener('change', () => { const v = normHex(text.value); if (v) { value = v; render(); o.onInput && o.onInput(v); o.onChange && o.onChange(v); } else render(); });
  text.addEventListener('keydown', (e) => e.stopPropagation());
  el.setValue = (v) => { value = normHex(v) || value; render(); };
  render();
  return el;
}

/** Gradient bar: drag stops, click the bar to add, drag a stop away (down) to remove. stops: [{pos, color}] */
export function gradientField(o) {
  // a full gradient editor: colour, opacity and location per stop; add, delete, reverse, even spacing, presets
  const norm = (list) => (list || []).map((x) => ({ pos: clamp(+x.pos || 0, 0, 1), color: normHex(x.color) || '#000000', opacity: x.opacity == null ? 1 : clamp(+x.opacity, 0, 1) }));
  let stops = norm(o.stops);
  if (stops.length < 2) stops = norm([{ pos: 0, color: stops[0]?.color || '#ffffff' }, { pos: 1, color: '#000000' }]);
  let sel = 0;
  const bar = h('div.gf-bar', { title: t('Click to add a colour stop. Drag a stop away from the bar to remove it.') });
  const stopsEl = h('div.gf-stops');
  const color = colorField({ label: t('Colour'), value: stops[0].color, onInput: (c) => { if (stops[sel]) { stops[sel].color = c; render(); emit(false); } }, onChange: () => emit(true) });
  const opF = numberField({ label: t('Opacity'), iconName: 'droplet', value: 100, min: 0, max: 100, unit: '%', onInput: (v) => { if (stops[sel]) { stops[sel].opacity = v / 100; render(); emit(false); } }, onChange: () => emit(true) });
  const posF = numberField({ label: t('Location'), value: 0, min: 0, max: 100, unit: '%', onInput: (v) => { if (stops[sel]) { stops[sel].pos = v / 100; render(); emit(false); } }, onChange: () => emit(true) });
  const addB = iconButton('plus', t('Add a colour stop'), () => addAt(widestGap()));
  const delB = iconButton('trash', t('Delete the colour stop'), () => removeAt(sel));
  const revB = iconButton('arrowsH', t('Reverse the gradient'), () => reverse());
  const evenB = iconButton('distribute', t('Space the stops evenly'), () => distribute());
  const presetB = button({ label: t('Presets'), icon: 'palette', class: 'gf-presets', onClick: (e) => menu(e.currentTarget, presetItems()) });
  presetB.append(icon('chevronDown', 14));
  const el = h('div.gf', h('div.gf-track', bar, stopsEl), h('div.gf-tools', presetB, h('span.gf-spacer'), addB, delB, revB, evenB), color, h('div.grid2', opF, posF));

  const sorted = () => [...stops].sort((a, b) => a.pos - b.pos);
  const emit = (commit) => { const out = sorted().map((x) => ({ ...x })); (commit ? o.onChange : o.onInput)?.(out); };
  // colour and opacity of the gradient at a point, for a new stop that changes nothing until it is edited
  function sample(pos) {
    const st = sorted();
    let a = st[0], b = st[st.length - 1];
    if (pos <= a.pos) b = a; else if (pos >= b.pos) a = b;
    else for (let i = 0; i < st.length - 1; i++) if (pos >= st[i].pos && pos <= st[i + 1].pos) { a = st[i]; b = st[i + 1]; break; }
    const f = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
    const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
    return { color: rgbToHex(ca.map((v, k) => v + (cb[k] - v) * f)), opacity: a.opacity + (b.opacity - a.opacity) * f };
  }
  function widestGap() {
    const st = sorted();
    let best = 0.5, w = -1;
    for (let i = 0; i < st.length - 1; i++) if (st[i + 1].pos - st[i].pos > w) { w = st[i + 1].pos - st[i].pos; best = (st[i].pos + st[i + 1].pos) / 2; }
    return best;
  }
  function select(i, focus) {
    sel = clamp(i, 0, stops.length - 1);
    const x = stops[sel];
    color.setValue(x.color); opF.setValue(Math.round(x.opacity * 100)); posF.setValue(Math.round(x.pos * 100));
    render(focus);
  }
  function addAt(pos, from = null) {
    const x = from ? { ...from, pos } : { pos, ...sample(pos) };
    stops.push(x); select(stops.length - 1); emit(true);
  }
  function removeAt(i) {
    if (stops.length <= 2) return;
    stops.splice(i, 1); select(Math.min(i, stops.length - 1)); emit(true);
  }
  function reverse() { for (const x of stops) x.pos = Math.round((1 - x.pos) * 1000) / 1000; select(sel); emit(true); }
  function distribute() {
    const st = sorted();
    st.forEach((x, i) => { x.pos = Math.round((i / (st.length - 1)) * 1000) / 1000; });
    select(sel); emit(true);
  }
  function apply(list) { stops = norm(list); select(0); emit(true); }
  function presetItems() {
    const cur = presets();
    return cur.map((p) => ({ label: t(p.name), swatch: gradientCss(p.stops), onClick: () => apply(p.stops) }));
  }
  const presets = () => [...GRADIENT_PRESETS, ...(o.presets || [])];
  function stopMenu(e, i) {
    contextMenu(e, [
      { label: t('Duplicate the colour stop'), icon: 'copyPlus', onClick: () => addAt(clamp(stops[i].pos + (stops[i].pos > 0.9 ? -0.05 : 0.05), 0, 1), stops[i]) },
      { label: t('Delete the colour stop'), icon: 'trash', disabled: stops.length <= 2, onClick: () => removeAt(i) },
      '-',
      ...[100, 50, 0].map((v) => ({ label: `${t('Opacity')} ${v}%`, checked: Math.round(stops[i].opacity * 100) === v, onClick: () => { stops[i].opacity = v / 100; select(i); emit(true); } })),
      '-',
      { label: t('Reverse the gradient'), icon: 'arrowsH', onClick: reverse },
      { label: t('Space the stops evenly'), icon: 'distribute', onClick: distribute },
    ]);
  }
  bar.addEventListener('contextmenu', (e) => {
    const r = bar.getBoundingClientRect();
    const pos = clamp((e.clientX - r.left) / r.width, 0, 1);
    contextMenu(e, [
      { label: t('Add a colour stop here'), icon: 'plus', onClick: () => addAt(pos) },
      { label: t('Reverse the gradient'), icon: 'arrowsH', onClick: reverse },
      { label: t('Space the stops evenly'), icon: 'distribute', onClick: distribute },
      '-',
      ...presetItems(),
    ]);
  });

  function render(focus) {
    const hadFocus = focus || stopsEl.contains(document.activeElement);
    // see-through stops show the checkerboard behind them
    bar.style.background = `${gradientCss(stops)}, var(--checker) 0 0 / 10px 10px`;
    stopsEl.textContent = '';
    delB.disabled = stops.length <= 2;
    let selBtn = null;
    stops.forEach((x, i) => {
      const pct = Math.round(x.pos * 100);
      const k = h('button.gf-stop', {
        type: 'button', class: i === sel ? 'on' : '', tabIndex: i === sel ? 0 : -1,
        'aria-label': `${t('Colour stop')} ${i + 1}: ${x.color}, ${t('Opacity')} ${Math.round(x.opacity * 100)}%, ${t('Location')} ${pct}%`,
        title: t('Drag to move · Delete key removes · right-click for more'),
      }, h('span.gf-dot', { style: { background: `linear-gradient(${stopCss(x)}, ${stopCss(x)}), var(--checker) 0 0 / 6px 6px` } }));
      k.style.left = `${x.pos * 100}%`;
      k.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        select(i, true);
        const r = bar.getBoundingClientRect();
        const mv = (ev) => {
          x.pos = clamp((ev.clientX - r.left) / r.width, 0, 1);
          x._remove = Math.abs(ev.clientY - (r.top + r.height / 2)) > 40 && stops.length > 2;
          render(); posF.setValue(Math.round(x.pos * 100)); emit(false);
        };
        const upH = () => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upH);
          if (x._remove) { delete x._remove; removeAt(stops.indexOf(x)); return; }
          delete x._remove; render(true); emit(true);
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upH);
      });
      k.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); x.pos = Math.round(clamp(x.pos + (e.key === 'ArrowRight' ? step : -step), 0, 1) * 1000) / 1000; select(i, true); emit(true); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); x.pos = e.key === 'Home' ? 0 : 1; select(i, true); emit(true); }
        else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); removeAt(i); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); const st = sorted(); const j = st.indexOf(x) + (e.key === 'ArrowUp' ? 1 : -1); if (st[j]) select(stops.indexOf(st[j]), true); }
      });
      k.addEventListener('contextmenu', (e) => { select(i); stopMenu(e, i); });
      if (x._remove) k.classList.add('removing');
      if (i === sel) selBtn = k;
      stopsEl.appendChild(k);
    });
    if (hadFocus && selBtn) selBtn.focus({ preventScroll: true });
  }
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = bar.getBoundingClientRect();
    addAt(clamp((e.clientX - r.left) / r.width, 0, 1));
  });
  el.setValue = (v) => { stops = norm(v); if (stops.length < 2) stops = norm([{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#000000' }]); select(Math.min(sel, stops.length - 1)); };
  select(0);
  return el;
}

// ---------- overlays ----------

let toastHost;
/** A short message at the bottom; action: { label, onClick } adds a button (the toast then stays a little longer). */
export function toast(msg, kind = 'info', ms = 3200, action = null) {
  if (!toastHost) { toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  const btn = action ? h('button.toast-action', { type: 'button', on: { click: () => { close(); action.onClick(); } } }, action.label) : null;
  const el = h('div.toast', { class: 'toast-' + kind }, icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16), h('span', msg), btn);
  toastHost.appendChild(el);
  // a message with a button waits while the pointer or the keyboard is on it
  let timer = setTimeout(close, action ? Math.max(ms, 6000) : ms);
  if (action) {
    const hold = () => clearTimeout(timer);
    const go = () => { clearTimeout(timer); timer = setTimeout(close, 2500); };
    el.addEventListener('pointerenter', hold); el.addEventListener('focusin', hold);
    el.addEventListener('pointerleave', go); el.addEventListener('focusout', go);
  }
}

/** Modal dialog. Returns { el, close }. */
export function modal(o) {
  const body = h('div.modal-body', o.body || []);
  const foot = h('div.modal-foot', o.actions || []);
  const closeBtn = iconButton('x', t('Close'), () => close());
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title, class: o.class || '' },
    h('div.modal-head', o.iconName ? icon(o.iconName, 18) : null, h('h2', o.title), closeBtn), body, foot);
  const back = h('div.modal-back', box);
  const opener = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    // Tab stays inside the dialog
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (!box.contains(at) || at === box) { if (e.shiftKey) { e.preventDefault(); last.focus(); } else if (at !== box) { e.preventDefault(); first.focus(); } }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  function close(result) {
    back.remove(); window.removeEventListener('keydown', onKey, true);
    // back to where the keyboard was before the dialog opened
    if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    o.onClose && o.onClose(result);
  }
  back.addEventListener('pointerdown', (e) => { if (e.target === back && o.dismissable !== false) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  // the dialog takes the focus (a dialog that focuses a field of its own does so right after)
  box.tabIndex = -1;
  box.focus({ preventScroll: true });
  return { el: box, body, foot, close };
}

/** In-page confirm (window.confirm is not available in the artifact viewer). */
export function confirmDialog(title, message, okLabel = t('OK'), danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: [h('p.modal-text', message)], class: 'modal-sm',
      actions: [
        button({ label: t('Cancel'), onClick: () => { done = true; m.close(); resolve(false); } }),
        button({ label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; m.close(); resolve(true); } }),
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

export function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.text-input', { type: 'text', value, 'aria-label': label });
    const ok = () => { done = true; m.close(); resolve(input.value); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); });
    const m = modal({
      title, class: 'modal-sm', body: [h('label.field', h('span', label), input)],
      actions: [button({ label: t('Cancel'), onClick: () => { done = true; m.close(); resolve(null); } }), button({ label: t('OK'), kind: 'primary', onClick: ok })],
      onClose: () => { if (!done) resolve(null); },
    });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/** Dropdown menu anchored to an element. items: [{ label, icon, onClick, danger, disabled } | '-'] */
export function menu(anchor, items) {
  // anchor: the button that opened it (the menu drops below it), or a point { x, y } (a right-click)
  const point = anchor && typeof anchor.getBoundingClientRect !== 'function' ? anchor : null;
  const opener = point ? document.activeElement : anchor;
  // the keyboard goes back to whatever opened the menu, so a dialog opened from it returns there too
  const back = () => { if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true }); };
  const list = items.filter((it) => it); // conditional items can be left out with false
  while (list[0] === '-') list.shift();
  while (list[list.length - 1] === '-') list.pop();
  const el = h('div.menu', { role: 'menu' }, list.map((it, i) => it === '-' ? (list[i - 1] === '-' ? null : h('div.menu-sep')) : h('button.menu-item', {
    type: 'button', role: it.checked == null ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': it.checked == null ? null : String(!!it.checked),
    tabIndex: -1, disabled: it.disabled, class: it.danger ? 'danger' : '',
    on: { click: () => { close(); back(); it.onClick && it.onClick(); } },
  }, it.swatch ? h('span.menu-swatch', { class: /gradient/.test(it.swatch) ? 'wide' : '', style: { background: it.swatch } })
    : it.checked ? icon('check', 15) : it.icon ? icon(it.icon, 15) : it.iconNode ? sized(it.iconNode.cloneNode(true)) : h('span.menu-ic'),
  h('span', it.label), it.hint ? h('span.menu-hint', it.hint) : null)));
  document.body.appendChild(el);
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x, y;
  if (point) {
    // at the pointer, opening toward the reading direction, kept inside the window
    x = document.documentElement.dir === 'rtl' ? point.x - mw : point.x;
    y = point.y;
    if (x + mw > innerWidth - 8) x = point.x - mw;
    if (y + mh > innerHeight - 8) y = Math.max(8, point.y - mh);
  } else {
    const r = anchor.getBoundingClientRect();
    x = document.documentElement.dir === 'rtl' ? r.right - mw : r.left;
    y = r.bottom + 4;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  }
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (x < 8) x = 8;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const off = (e) => { if (!el.contains(e.target)) close(); };
  // arrows move between the items (and nowhere else: not the selected title on the stage), Esc or Tab leaves
  const btns = [...el.querySelectorAll('.menu-item:not(:disabled)')];
  const key = (e) => {
    const i = btns.indexOf(document.activeElement), n = btns.length;
    let j = -1;
    if (e.key === 'ArrowDown') j = i < 0 ? 0 : (i + 1) % n;
    else if (e.key === 'ArrowUp') j = i < 0 ? n - 1 : (i - 1 + n) % n;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = n - 1;
    if (j >= 0 && n) { e.preventDefault(); e.stopPropagation(); btns[j].focus(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); back(); }
    else if (e.key === 'Tab') close();
  };
  btns[0]?.focus({ preventScroll: true });
  // a right-click elsewhere closes this menu (and the next one opens); scrolling or resizing closes it too
  const gone = () => close();
  setTimeout(() => {
    window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', key, true);
    window.addEventListener('resize', gone); window.addEventListener('blur', gone);
  });
  openMenus.add(close);
  function close() {
    if (!el.isConnected) return;
    el.remove(); openMenus.delete(close);
    window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', gone); window.removeEventListener('blur', gone);
  }
  return { close };
}
const openMenus = new Set();
const sized = (svg) => { svg.setAttribute('width', 15); svg.setAttribute('height', 15); return svg; };

/**
 * A right-click menu at the pointer. Call it from a contextmenu listener: it stops the browser's own menu and any
 * menu further up the page (so the most specific place wins). Items as for menu(); false items are left out.
 */
export function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  for (const close of [...openMenus]) close();
  // a long press on a touch screen opens it at the finger, a keyboard (Shift+F10, the menu key) at the focus
  let x = e.clientX, y = e.clientY;
  if (!x && !y && e.target && e.target.getBoundingClientRect) { const r = e.target.getBoundingClientRect(); x = r.left + Math.min(24, r.width / 2); y = r.top + Math.min(24, r.height / 2); }
  return menu({ x, y }, items);
}

/** Make a splitter that resizes a panel. side: 'start' | 'end' | 'bottom'. */
export function splitter(o) {
  const el = h('div.splitter', { class: 'splitter-' + o.orient, role: 'separator', 'aria-orientation': o.orient === 'v' ? 'vertical' : 'horizontal', tabIndex: 0, title: t('Drag to resize') });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const start = o.orient === 'v' ? e.clientX : e.clientY;
    const startSize = o.get();
    el.classList.add('active');
    const mv = (ev) => {
      let d = (o.orient === 'v' ? ev.clientX : ev.clientY) - start;
      if (o.invert) d = -d;
      if (o.orient === 'v' && document.documentElement.dir === 'rtl') d = -d;
      o.set(clamp(startSize + d, o.min, o.max));
    };
    const upH = () => { el.classList.remove('active'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upH); o.done && o.done(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', upH);
  });
  el.addEventListener('keydown', (e) => {
    let k = { ArrowLeft: -16, ArrowRight: 16, ArrowUp: -16, ArrowDown: 16 }[e.key];
    // mirrored like the drag above, so the arrow moves the divider the way it points
    if (k && o.orient === 'v' && document.documentElement.dir === 'rtl') k = -k;
    if (k) { e.preventDefault(); o.set(clamp(o.get() + (o.invert ? -k : k), o.min, o.max)); o.done && o.done(); }
  });
  return el;
}
