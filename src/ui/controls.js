// Controls kit: scrub number fields, sliders, angle dials, pills, switches, sections, tabs, colour and gradient fields.
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
  const input = h('input.nf-input', { type: 'text', inputMode: min < 0 ? 'text' : 'decimal', spellcheck: false, 'aria-label': label || title || '' });
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
    if (range && value !== undefined) range.value = clamp(value, sMin, sMax);
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
  const el = h('div.ang', dial, nf);
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
  const el = h('section.sec', { class: o.class || '' }, h('div.sec-top', head, actions), body);
  const render = () => { el.classList.toggle('open', open); head.setAttribute('aria-expanded', open); };
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
  const text = h('input.cf-hex', { type: 'text', value, spellcheck: false, maxLength: 7, 'aria-label': (o.label || t('Colour')) + ' hex' });
  const el = h('div.cf', o.label ? h('span.cf-label', o.label) : null, sw, text);
  const render = () => { sw.style.background = value; picker.value = value; if (document.activeElement !== text) text.value = value; };
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
  let stops = (o.stops || []).map((s) => ({ ...s }));
  let sel = 0;
  const bar = h('div.gf-bar', { title: t('Click to add a colour stop. Drag a stop down to remove it.') });
  const stopsEl = h('div.gf-stops');
  const color = colorField({ value: stops[0]?.color, onInput: (c) => { if (stops[sel]) { stops[sel].color = c; render(); emit(false); } }, onChange: () => emit(true) });
  const posF = numberField({ label: t('Location'), value: 0, min: 0, max: 100, unit: '%', onInput: (v) => { if (stops[sel]) { stops[sel].pos = v / 100; render(); emit(false); } }, onChange: () => emit(true) });
  const el = h('div.gf', h('div.gf-track', bar, stopsEl), h('div.gf-edit', color, posF));
  const emit = (commit) => { const out = stops.map((s) => ({ ...s })).sort((a, b) => a.pos - b.pos); (commit ? o.onChange : o.onInput)?.(out); };
  function render() {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    bar.style.background = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${s.pos * 100}%`).join(', ')})`;
    stopsEl.textContent = '';
    stops.forEach((s, i) => {
      const k = h('button.gf-stop', { type: 'button', class: i === sel ? 'on' : '', style: { insetInlineStart: `${s.pos * 100}%`, background: s.color }, 'aria-label': `${t('Colour stop')} ${i + 1}` });
      if (document.documentElement.dir === 'rtl') { k.style.insetInlineStart = ''; k.style.left = `${s.pos * 100}%`; }
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        sel = i; color.setValue(s.color); posF.setValue(Math.round(s.pos * 100)); render();
        const r = bar.getBoundingClientRect();
        const mv = (ev) => {
          s.pos = clamp((ev.clientX - r.left) / r.width, 0, 1);
          const away = Math.abs(ev.clientY - (r.top + r.height / 2)) > 40 && stops.length > 2;
          s._remove = away;
          render(); posF.setValue(Math.round(s.pos * 100)); emit(false);
        };
        const upH = () => {
          window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', upH);
          if (s._remove) { stops.splice(stops.indexOf(s), 1); sel = 0; }
          delete s._remove; render(); emit(true);
        };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', upH);
      });
      if (s._remove) k.classList.add('removing');
      stopsEl.appendChild(k);
    });
  }
  bar.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    const pos = clamp((e.clientX - r.left) / r.width, 0, 1);
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    let c = sorted[0].color;
    for (let i = 0; i < sorted.length - 1; i++) if (pos >= sorted[i].pos && pos <= sorted[i + 1].pos) {
      const f = (pos - sorted[i].pos) / (sorted[i + 1].pos - sorted[i].pos || 1);
      const a = hexToRgb(sorted[i].color), b = hexToRgb(sorted[i + 1].color);
      c = rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
    }
    stops.push({ pos, color: c }); sel = stops.length - 1; color.setValue(c); posF.setValue(Math.round(pos * 100)); render(); emit(true);
  });
  el.setValue = (v) => { stops = (v || []).map((s) => ({ ...s })); sel = Math.max(0, Math.min(sel, stops.length - 1)); if (stops[sel]) { color.setValue(stops[sel].color); posF.setValue(Math.round(stops[sel].pos * 100)); } render(); };
  posF.setValue(Math.round((stops[0]?.pos || 0) * 100));
  render();
  return el;
}

// ---------- overlays ----------

let toastHost;
export function toast(msg, kind = 'info', ms = 3200) {
  if (!toastHost) { toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  const el = h('div.toast', { class: 'toast-' + kind }, icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16), h('span', msg));
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Modal dialog. Returns { el, close }. */
export function modal(o) {
  const body = h('div.modal-body', o.body || []);
  const foot = h('div.modal-foot', o.actions || []);
  const closeBtn = iconButton('x', t('Close'), () => close());
  const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title, class: o.class || '' },
    h('div.modal-head', o.iconName ? icon(o.iconName, 18) : null, h('h2', o.title), closeBtn), body, foot);
  const back = h('div.modal-back', box);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  function close(result) {
    back.remove(); window.removeEventListener('keydown', onKey, true);
    o.onClose && o.onClose(result);
  }
  back.addEventListener('pointerdown', (e) => { if (e.target === back && o.dismissable !== false) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
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
  const el = h('div.menu', { role: 'menu' }, items.map((it) => it === '-' ? h('div.menu-sep') : h('button.menu-item', {
    type: 'button', role: 'menuitem', disabled: it.disabled, class: it.danger ? 'danger' : '',
    on: { click: () => { close(); it.onClick && it.onClick(); } },
  }, it.swatch ? h('span.menu-swatch', { style: { background: it.swatch } }) : it.icon ? icon(it.icon, 15) : h('span.menu-ic'), h('span', it.label), it.hint ? h('span.menu-hint', it.hint) : null)));
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x = document.documentElement.dir === 'rtl' ? r.right - mw : r.left;
  let y = r.bottom + 4;
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (x < 8) x = 8;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  const off = (e) => { if (!el.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { window.addEventListener('pointerdown', off, true); window.addEventListener('keydown', key, true); });
  function close() { el.remove(); window.removeEventListener('pointerdown', off, true); window.removeEventListener('keydown', key, true); }
  return { close };
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
