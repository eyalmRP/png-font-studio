// Timeline: playback, scrubbing, and per-layer bars showing entrance / hold / exit.
import { h, rafThrottle, storeGet, storeSet } from '../dom.js';
import { t } from '../i18n.js';
import { iconButton, numberField, select, toggle } from '../controls.js';
import { state, on, emit, selectLayer, checkpoint, projectChanged } from '../../app/store.js';
import { IN_PRESETS, OUT_PRESETS, phaseLength, unitIndex } from '../../core/anim.js';
import { getLayout } from '../../render/layer.js';

const fmt = (s) => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };

export function createTimeline() {
  const playBtn = iconButton('play', t('Play') + ' (K)', () => toggle_());
  const startBtn = iconButton('skipBack', t('Go to start'), () => setTime(0));
  const timeLabel = h('span.tl-time', '0:00.00');
  let loopOn = storeGet('loop', true);
  const loopT = toggle({ label: t('Loop'), iconName: 'repeat', value: loopOn, onChange: (v) => { loopOn = v; storeSet('loop', v); } });
  const dur = numberField({ label: t('Length'), iconName: 'timer', min: 0.2, max: 600, step: 0.1, unit: 's', value: state.project.duration, onInput: (v) => { checkpoint('project', 'Length', 'dur'); state.project.duration = v; projectChanged(); draw(); }, onChange: () => {} });
  const fps = select({ value: String(state.project.fps), label: null, options: [12, 24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: f + ' fps' })), onChange: (v) => { state.project.fps = +v; projectChanged(); } });
  const bar = h('div.tl-bar', startBtn, playBtn, timeLabel, h('div', { style: { width: '150px' } }, dur), fps, loopT);
  const canvas = h('canvas.tl-canvas');
  const bodyEl = h('div.tl-body', canvas);
  const el = h('section.timeline', { 'aria-label': t('Timeline') }, bar, bodyEl);
  const NAME_W = 130, RULER = 24, ROW = 26;
  let dpr = 1, W = 0;
  let raf = null, last = 0;

  const xOf = (time) => NAME_W + (time / Math.max(0.1, state.project.duration)) * (W - NAME_W - 14);
  const timeOf = (x) => Math.max(0, Math.min(state.project.duration, ((x - NAME_W) / Math.max(1, W - NAME_W - 14)) * state.project.duration));

  function setTime(time) { state.time = Math.max(0, Math.min(state.project.duration, time)); timeLabel.textContent = `${fmt(state.time)} / ${fmt(state.project.duration)}`; emit('time'); draw(); }
  function toggle_() { if (state.playing) stop(); else play(); }
  function play(from) {
    if (typeof from === 'number') state.time = from;
    if (state.time >= state.project.duration - 1e-3) state.time = 0;
    state.playing = true; playBtn.replaceChildren(...iconButton('pause', '').childNodes); playBtn.title = t('Pause') + ' (K)';
    last = performance.now();
    const step = (now) => {
      if (!state.playing) return;
      const dt = (now - last) / 1000; last = now;
      let tm = state.time + dt;
      if (tm >= state.project.duration) { if (loopOn) tm = tm % state.project.duration; else { tm = state.project.duration; setTime(tm); stop(); return; } }
      setTime(tm);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    emit('playing', true);
  }
  function stop() {
    state.playing = false; cancelAnimationFrame(raf);
    playBtn.replaceChildren(...iconButton('play', '').childNodes); playBtn.title = t('Play') + ' (K)';
    emit('playing', false);
  }

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function phaseLen(layer, kind) {
    const cfg = layer.anim[kind];
    const src = kind === 'in' ? IN_PRESETS : OUT_PRESETS;
    const p = src[cfg.preset];
    if (!p) return 0;
    const layout = getLayout(layer);
    return phaseLength(cfg, p, unitIndex(layout.items, cfg.unit || p.unit, layout).count) + (kind === 'in' ? cfg.delay || 0 : 0);
  }
  const draw = rafThrottle(() => {
    const r = bodyEl.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    const layers = [...state.project.layers].reverse();
    const Hh = Math.max(r.height, RULER + layers.length * ROW + 8);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
    canvas.style.height = Hh + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    ctx.font = '11px ' + css('--font-ui');
    // ruler
    const d = state.project.duration;
    const stepS = d <= 2 ? 0.25 : d <= 6 ? 0.5 : d <= 20 ? 1 : d <= 60 ? 5 : 10;
    ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--line');
    for (let s = 0; s <= d + 1e-6; s += stepS) {
      const x = Math.round(xOf(s)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, RULER - 7); ctx.lineTo(x, Hh); ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(s % 1 === 0 ? s + 's' : s.toFixed(2).replace(/0$/, ''), x + 3, 14);
    }
    layers.forEach((layer, i) => {
      const y = RULER + i * ROW;
      const sel = layer.id === state.selectedLayerId;
      if (sel) { ctx.fillStyle = css('--accent-soft'); ctx.fillRect(0, y, W, ROW); }
      ctx.fillStyle = layer.visible ? css('--fg') : css('--muted');
      ctx.save(); ctx.beginPath(); ctx.rect(6, y, NAME_W - 12, ROW); ctx.clip();
      ctx.fillText(layer.name || t('Text'), 10, y + 17);
      ctx.restore();
      const x0 = xOf(layer.anim.start), x1 = xOf(Math.min(d, layer.anim.end));
      const inL = phaseLen(layer, 'in'), outL = phaseLen(layer, 'out');
      const xi = xOf(layer.anim.start + inL), xo = xOf(layer.anim.end - outL);
      ctx.fillStyle = css('--field-hover');
      roundRect(ctx, x0, y + 5, Math.max(4, x1 - x0), ROW - 10, 5); ctx.fill();
      ctx.fillStyle = css('--accent');
      if (inL > 0) { ctx.globalAlpha = 0.75; roundRect(ctx, x0, y + 5, Math.max(3, Math.min(xi, x1) - x0), ROW - 10, 5); ctx.fill(); }
      if (outL > 0) { ctx.globalAlpha = 0.45; roundRect(ctx, Math.max(x0, xo), y + 5, Math.max(3, x1 - Math.max(x0, xo)), ROW - 10, 5); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (layer.anim.loop.preset !== 'none') { ctx.strokeStyle = css('--cyan'); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(Math.min(xi, x1), y + ROW / 2); ctx.lineTo(Math.max(x0, xo), y + ROW / 2); ctx.stroke(); ctx.setLineDash([]); }
    });
    // playhead
    const px = Math.round(xOf(state.time)) + 0.5;
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, Hh); ctx.stroke();
    ctx.fillStyle = css('--accent');
    ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 8); ctx.fill();
    timeLabel.textContent = `${fmt(state.time)} / ${fmt(d)}`;
  });

  function roundRect(ctx, x, y, w, h2, r) {
    r = Math.min(r, w / 2, h2 / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h2, r); ctx.arcTo(x + w, y + h2, x, y + h2, r); ctx.arcTo(x, y + h2, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    canvas.setPointerCapture(e.pointerId);
    if (y < RULER) { drag = { type: 'scrub' }; setTime(timeOf(x)); return; }
    const layers = [...state.project.layers].reverse();
    const i = Math.floor((y - RULER) / ROW);
    const layer = layers[i];
    if (!layer) { drag = { type: 'scrub' }; setTime(timeOf(x)); return; }
    selectLayer(layer.id);
    if (x < NAME_W) return;
    const x0 = xOf(layer.anim.start), x1 = xOf(layer.anim.end);
    const edge = Math.abs(x - x0) < 7 ? 'start' : Math.abs(x - x1) < 7 ? 'end' : x > x0 && x < x1 ? 'move' : null;
    if (!edge) { drag = { type: 'scrub' }; setTime(timeOf(x)); return; }
    checkpoint('project', 'Layer timing');
    drag = { type: edge, layer, sx: x, s0: layer.anim.start, e0: layer.anim.end };
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) {
      const layers = [...state.project.layers].reverse();
      const layer = layers[Math.floor((y - RULER) / ROW)];
      let cur = 'default';
      if (layer && y >= RULER && x >= NAME_W) {
        const x0 = xOf(layer.anim.start), x1 = xOf(layer.anim.end);
        cur = Math.abs(x - x0) < 7 || Math.abs(x - x1) < 7 ? 'ew-resize' : x > x0 && x < x1 ? 'grab' : 'default';
      }
      canvas.style.cursor = cur;
      return;
    }
    if (drag.type === 'scrub') { setTime(timeOf(x)); return; }
    const dt = ((x - drag.sx) / Math.max(1, W - NAME_W - 14)) * state.project.duration;
    const L = drag.layer, snap = (v) => Math.round(v * state.project.fps) / state.project.fps;
    if (drag.type === 'start') L.anim.start = Math.max(0, Math.min(snap(drag.s0 + dt), L.anim.end - 0.1));
    else if (drag.type === 'end') L.anim.end = Math.max(L.anim.start + 0.1, snap(drag.e0 + dt));
    else { const len = drag.e0 - drag.s0; L.anim.start = Math.max(0, snap(drag.s0 + dt)); L.anim.end = L.anim.start + len; }
    projectChanged('render', L);
    draw();
  });
  const up = () => { if (drag && drag.type !== 'scrub') emit('selection'); drag = null; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const ro = new ResizeObserver(() => draw());
  ro.observe(bodyEl);
  const offs = [
    on('project', () => { dur.setValue(state.project.duration); fps.setValue(String(state.project.fps)); draw(); }),
    on('selection', draw), on('theme', draw), on('anim', draw),
    on('key', (e) => { if (state.ui.mode === 'titles' && (e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey) toggle_(); }),
    on('preview-layer', (layer) => play(layer.anim.start)),
  ];
  draw();
  return { el, play, stop, setTime, destroy() { stop(); ro.disconnect(); offs.forEach((f) => f()); } };
}
