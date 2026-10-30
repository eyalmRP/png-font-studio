// Title player: a single bar under the stage. A title animates in, holds, then animates out; the total
// length follows from the presets and the hold time.
import { h, storeGet, storeSet } from '../dom.js';
import { t } from '../i18n.js';
import { iconButton, numberField, toggle } from '../controls.js';
import { state, on, emit, checkpoint } from '../../app/store.js';
import { IN_PRESETS, OUT_PRESETS, phaseLength, unitIndex } from '../../core/anim.js';
import { getLayout } from '../../render/layer.js';

const fmt = (s) => { const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; };

function phaseLen(layer, kind) {
  const cfg = layer.anim[kind];
  const p = (kind === 'in' ? IN_PRESETS : OUT_PRESETS)[cfg.preset];
  if (!p) return 0;
  const layout = getLayout(layer);
  return phaseLength(cfg, p, unitIndex(layout.items, cfg.unit || p.unit, layout).count) + (kind === 'in' ? cfg.delay || 0 : 0);
}

/** Entrance → hold → exit. Every title starts at 0 and finishes its exit at the end. Returns the length. */
export function syncTiming(project = state.project) {
  if (!project) return 0;
  if (project.hold === undefined) project.hold = 1.5;
  let maxIn = 0, maxOut = 0;
  for (const l of project.layers) { maxIn = Math.max(maxIn, phaseLen(l, 'in')); maxOut = Math.max(maxOut, phaseLen(l, 'out')); }
  const fps = project.fps || 30;
  const total = Math.max(0.5, Math.ceil((maxIn + project.hold + maxOut) * fps) / fps);
  for (const l of project.layers) { l.anim.start = 0; l.anim.end = total; }
  project.duration = total;
  return total;
}

export function createPlayer() {
  const playBtn = iconButton('play', t('Play') + ' (K)', () => toggle_());
  const startBtn = iconButton('skipBack', t('Go to start'), () => setTime(0));
  const scrub = h('input.player-scrub', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('Position in the animation') });
  const timeLabel = h('span.tl-time', '0:00.00');
  let loopOn = storeGet('loop', true);
  const loopT = toggle({ label: t('Loop'), iconName: 'repeat', value: loopOn, onChange: (v) => { loopOn = v; storeSet('loop', v); } });
  const hold = numberField({
    label: t('Hold'), iconName: 'timer', min: 0, max: 120, step: 0.1, unit: 's', value: state.project.hold ?? 1.5,
    title: t('How long the title stays on screen between its entrance and its exit'),
    onInput: (v) => { checkpoint('project', 'Hold time', 'hold'); state.project.hold = v; refresh(); emit('project', { what: 'timing' }); }, onChange: () => {},
  });
  hold.classList.add('player-hold');
  const el = h('section.player', { 'aria-label': t('Animation player') }, startBtn, playBtn, scrub, timeLabel, hold, loopT);
  let raf = null, last = 0;

  function refresh() {
    syncTiming();
    scrub.value = Math.round((state.time / Math.max(0.01, state.project.duration)) * 1000);
    timeLabel.textContent = `${fmt(state.time)} / ${fmt(state.project.duration)}`;
  }
  function setTime(tm) {
    state.time = Math.max(0, Math.min(state.project.duration, tm));
    refresh();
    emit('time');
  }
  function toggle_() { if (state.playing) stop(); else play(); }
  function play(from) {
    syncTiming();
    if (typeof from === 'number') state.time = from;
    if (state.time >= state.project.duration - 1e-3) state.time = 0;
    state.playing = true;
    playBtn.replaceChildren(...iconButton('pause', '').childNodes); playBtn.title = t('Pause') + ' (K)';
    last = performance.now();
    const step = (now) => {
      if (!state.playing) return;
      const dt = (now - last) / 1000; last = now;
      let tm = state.time + dt;
      if (tm >= state.project.duration) {
        if (loopOn) tm %= state.project.duration;
        else { setTime(state.project.duration); stop(); return; }
      }
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
  scrub.addEventListener('input', () => { if (state.playing) stop(); setTime((scrub.value / 1000) * state.project.duration); });
  scrub.addEventListener('keydown', (e) => e.stopPropagation());

  const offs = [
    on('project', (d) => { if (!d || d.what !== 'timing') refresh(); hold.setValue(state.project.hold ?? 1.5); }),
    on('anim', refresh),
    on('key', (e) => { if (state.ui.mode === 'titles' && state.project.animated !== false && (e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey) toggle_(); }),
    on('preview-layer', () => play(0)),
  ];
  refresh();
  return { el, play, stop, setTime, destroy() { stop(); offs.forEach((f) => f()); } };
}
