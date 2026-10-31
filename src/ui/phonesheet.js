// Phones: the two side panels share one bottom sheet with tabs, under a stage that always fits above it. Drag the
// handle (or tap it) to change its height: peek (only the tabs), half, or full. On wider screens the sheet's box is
// display: contents, so the panels sit in the workspace grid as before, and its head is hidden.
import { h, icon, storeGet, storeSet } from './dom.js';
import { t } from './i18n.js';
import { on, emit } from '../app/store.js';

const SIZES = ['peek', 'half', 'full'];

/** pages: [{ id: 'left' | 'right', icon, label, el }] → { el, show(id), destroy() } */
export function phoneSheet(workspace, pages) {
  let page = storeGet('sheetPage:' + workspace, 'right');
  let size = storeGet('sheetSize', 'half');
  const btns = pages.map((p) => h('button.sheet-tab', { type: 'button', role: 'tab', on: { click: () => tap(p.id) } }, icon(p.icon, 16), h('span', p.label)));
  const grip = h('button.sheet-grip', { type: 'button', 'aria-label': t('Resize the panel') });
  const head = h('div.sheet-head', grip, h('div.sheet-tabs', { role: 'tablist' }, btns));
  const el = h('div.phone-sheet', head, pages.map((p) => p.el));

  const heights = () => {
    const top = el.parentElement ? el.parentElement.getBoundingClientRect().top : 0;
    const peek = head.offsetHeight || 58;
    // full still leaves the stage (and the player under it) a strip to work in
    return { peek, half: Math.round((innerHeight - top) * 0.4), full: Math.round(innerHeight - top - 230) };
  };
  function apply(animate = true) {
    el.dataset.page = page; el.dataset.size = size;
    el.classList.toggle('animate', animate);
    el.style.setProperty('--sheet-h', heights()[size] + 'px');
    // messages pop up above the sheet, not over it
    if (getComputedStyle(el).display === 'contents') document.documentElement.style.removeProperty('--sheet-offset');
    else document.documentElement.style.setProperty('--sheet-offset', heights()[size] + 'px');
    btns.forEach((b, i) => { const on_ = pages[i].id === page; b.classList.toggle('on', on_); b.setAttribute('aria-selected', on_); });
    emit('resize');
  }
  function tap(id) {
    // the open tab folds the sheet down; another tab, or any tab while folded, opens it
    if (id === page && size !== 'peek') size = 'peek';
    else { page = id; if (size === 'peek') size = 'half'; }
    storeSet('sheetPage:' + workspace, page); storeSet('sheetSize', size);
    apply();
  }

  // drag the head to resize; let go and it settles on the nearest height
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sheet-tab')) return;
    const y0 = e.clientY, h0 = el.offsetHeight;
    let moved = false;
    head.setPointerCapture(e.pointerId);
    el.classList.remove('animate');
    const mv = (ev) => {
      const dy = ev.clientY - y0;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      const hs = heights();
      el.style.setProperty('--sheet-h', Math.max(hs.peek, Math.min(hs.full, h0 - dy)) + 'px');
    };
    const up = () => {
      head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); head.removeEventListener('pointercancel', up);
      if (!moved) { if (e.target.closest('.sheet-grip')) { size = SIZES[(SIZES.indexOf(size) + 1) % 3]; storeSet('sheetSize', size); apply(); } return; }
      const hs = heights(), cur = el.offsetHeight;
      size = SIZES.reduce((a, b) => (Math.abs(hs[b] - cur) < Math.abs(hs[a] - cur) ? b : a));
      storeSet('sheetSize', size);
      apply();
    };
    head.addEventListener('pointermove', mv); head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
  });

  // Enter or Space on the handle steps through the heights, as a tap does (a keyboard click has no pointer)
  grip.addEventListener('click', (e) => { if (e.detail === 0) { size = SIZES[(SIZES.indexOf(size) + 1) % 3]; storeSet('sheetSize', size); apply(); } });

  const onResize = () => apply(false);
  window.addEventListener('resize', onResize);
  // the top bar can change height after the first layout (it wraps on phones), which moves the space the sheet has
  const ro = new ResizeObserver(() => { if (getComputedStyle(el).display !== 'contents') apply(false); });
  const off = on('phone-sheet', (id) => { if (id) page = id; if (size === 'peek') size = 'half'; apply(); });
  requestAnimationFrame(() => { apply(false); if (el.parentElement) ro.observe(el.parentElement); });
  return {
    el,
    destroy() { window.removeEventListener('resize', onResize); ro.disconnect(); off(); document.documentElement.style.removeProperty('--sheet-offset'); },
  };
}
