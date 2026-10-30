// First-run guide: a few cards that point at the parts of the Titles screen, from fonts to export. Shown once (the
// choice is remembered); Help > Getting started shows it again. The page stays usable underneath.
import { h, icon, storeGet, storeSet } from './dom.js';
import { t } from './i18n.js';
import { button } from './controls.js';
import { state, setUI, emit } from '../app/store.js';

const STEPS = [
  { target: '.mode-tabs .tab:nth-child(2)', icon: 'shapes', title: 'Your fonts', text: 'Fonts turns glyph sheets from an AI image tool into PNG fonts you can type with. Bubble Blue, Orange and Pearl are ready to use.' },
  { target: '.stage-bar', icon: 'type', title: 'Write a title', text: 'Press T or pick the text tool, click the artboard and type. Double-click a title to edit it again.' },
  { target: '.panel-right .icon-tabs', sheet: 'right', icon: 'sparkles', title: 'Style it', text: 'Size and spacing, alignment, effects, warp and animation each have a tab here.' },
  { target: '.mode-switch', icon: 'film', title: 'Still or animated', text: 'Still makes images and turns the interface pink. Animated makes video and turns it blue.' },
  { target: '.export-slot .btn-primary', icon: 'download', title: 'Export', text: 'PNG, GIF, WebM, MP4, animated PNG or WebP, a PNG sequence, or an editable After Effects composition.' },
];

/** Show the guide on a first visit (where the browser can remember that it was seen). */
export function maybeStartTour() {
  try { localStorage.getItem('pfs:tourDone'); } catch { return; }
  if (!storeGet('tourDone', false)) setTimeout(startTour, 500);
}

let running = null;
export function startTour() {
  if (running) return;
  let i = 0;
  const ring = h('div.tour-ring');
  const count = h('span.tour-count', { dir: 'ltr' });
  const title = h('h2.tour-title');
  const text = h('p.tour-text');
  const ic = h('span.tour-icon');
  const back = button({ label: t('Back'), kind: 'ghost', onClick: () => go(i - 1) });
  const next = button({ label: t('Next'), kind: 'primary', onClick: () => go(i + 1) });
  const skip = button({ label: t('Skip'), kind: 'ghost', onClick: () => end() });
  const card = h('div.tour-card', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tour-title' },
    h('div.tour-head', ic, title, count), text, h('div.tour-foot', skip, h('span.spacer'), back, next));
  title.id = 'tour-title';
  const el = h('div.tour', ring, card);
  document.body.appendChild(el);

  const onKey = (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      // the arrow that points forward in the reading direction goes on
      const fwd = (k === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
      e.preventDefault(); e.stopPropagation(); go(i + (fwd ? 1 : -1));
    }
  };
  const onMove = () => place();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onMove);
  window.addEventListener('scroll', onMove, true);
  running = { end };

  function go(n) {
    if (n < 0) return;
    if (n >= STEPS.length) { end(); return; }
    i = n;
    // every step points at the Titles screen
    if (state.ui.mode !== 'titles') { setUI({ mode: 'titles' }); emit('remount'); }
    const s = STEPS[i];
    ic.replaceChildren(icon(s.icon, 18));
    title.textContent = t(s.title);
    text.textContent = t(s.text);
    count.textContent = `${i + 1} / ${STEPS.length}`;
    back.disabled = i === 0;
    next.replaceChildren(document.createTextNode(i === STEPS.length - 1 ? t('Done') : t('Next')));
    // on a phone the inspector is a page of the bottom sheet: open it there
    if (s.sheet) emit('phone-sheet', s.sheet);
    const target = document.querySelector(s.target);
    // on a phone the card covers the bottom of the screen, so the part being explained goes to the middle
    if (target) target.scrollIntoView({ block: innerWidth < 600 ? 'center' : 'nearest', inline: 'nearest' });
    requestAnimationFrame(() => { place(); next.focus({ preventScroll: true }); });
  }

  function place() {
    const target = document.querySelector(STEPS[i].target);
    const r = target && target.getBoundingClientRect();
    const shown = !!(r && r.width && r.height && r.bottom > 0 && r.top < innerHeight);
    el.classList.toggle('no-target', !shown);
    if (shown) Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    // phones: the card sits at the bottom; otherwise next to the target, below it when there is room
    const docked = innerWidth < 600 || !shown;
    card.classList.toggle('docked', docked);
    if (docked) { card.style.left = card.style.top = ''; return; }
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top = r.bottom + 16;
    if (top + ch > innerHeight - 12) top = Math.max(12, r.top - 16 - ch);
    const left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), innerWidth - cw - 12);
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }

  function end() {
    storeSet('tourDone', true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onMove);
    window.removeEventListener('scroll', onMove, true);
    el.remove();
    running = null;
  }

  go(0);
}
