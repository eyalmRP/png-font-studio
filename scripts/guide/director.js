// In-page overlay for the guide videos: a cursor, click ripples, a spotlight that darkens everything else, callout
// labels, key caps and a title card. Injected by the recorder only; never part of the app. Animations run on
// requestAnimationFrame and performance.now, which the recorder's paused clock steps one video frame at a time.
(() => {
  if (window.__dir) return;
  const css = `
  #dir-root { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; font-family: Rubik, Inter, system-ui, sans-serif; }
  #dir-spot { position: fixed; border-radius: 12px; opacity: 0; box-shadow: 0 0 0 3px #fff, 0 0 0 7px rgba(255,79,163,.85), 0 0 0 9999px rgba(6,4,12,.62); }
  #dir-spot.ring { box-shadow: 0 0 0 3px #fff, 0 0 0 7px rgba(255,79,163,.85), 0 0 26px 8px rgba(255,79,163,.45); }
  #dir-call { position: fixed; max-width: 340px; padding: 10px 14px; border-radius: 12px; background: #fff; color: #17131f;
    font-size: 17px; font-weight: 600; line-height: 1.3; box-shadow: 0 10px 30px rgba(0,0,0,.35); opacity: 0; }
  #dir-call::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; border-radius: 12px 0 0 12px; background: linear-gradient(#ff4fa3, #3ad0ff); }
  #dir-keys { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center; opacity: 0;
    padding: 8px 12px; border-radius: 14px; background: rgba(20,16,30,.92); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
  #dir-keys kbd { font: 600 18px Inter, system-ui, sans-serif; color: #fff; background: #2d283d; border: 1px solid #4a4360; border-bottom-width: 3px;
    border-radius: 8px; padding: 4px 10px; min-width: 34px; text-align: center; }
  #dir-keys span { color: #b9b3cc; font: 600 16px Inter, system-ui, sans-serif; }
  #dir-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
  .dir-ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid #ff4fa3; background: rgba(255,79,163,.25); }
  #dir-card { position: fixed; inset: 0; display: grid; place-items: center; background: radial-gradient(120% 120% at 30% 20%, #2a1840 0%, #0e0b16 60%); opacity: 0; }
  #dir-card .in { text-align: center; color: #fff; }
  #dir-card .brand { font: 800 30px Rubik, Inter, sans-serif; letter-spacing: .02em; background: linear-gradient(90deg, #ff4fa3, #3ad0ff);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  #dir-card .title { font: 700 64px Rubik, Inter, sans-serif; margin-top: 10px; }
  #dir-card .sub { font: 500 24px Rubik, Inter, sans-serif; color: #c9c2dc; margin-top: 12px; }
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'dir-root';
  root.innerHTML = `<div id="dir-spot"></div><div id="dir-call"></div><div id="dir-keys"></div><div id="dir-card"><div class="in"><div class="brand">PNG Font Studio · Guide</div><div class="title"></div><div class="sub"></div></div></div>
  <svg id="dir-cursor" viewBox="0 0 24 24"><path d="M5 2.5 L5 19.5 L9.3 15.4 L12.4 22 L15.2 20.7 L12.2 14.3 L18.2 14.3 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(root);
  const $ = (id) => root.querySelector(id);
  const spot = $('#dir-spot'), call = $('#dir-call'), keys = $('#dir-keys'), card = $('#dir-card'), cursor = $('#dir-cursor');

  // tweens on the page clock
  const tweens = new Set();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function tween(dur, step, done) {
    const t0 = performance.now(), tw = { t0, dur, step, done };
    tweens.add(tw); step(0);
    return tw;
  }
  (function loop() {
    const now = performance.now();
    for (const tw of [...tweens]) {
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.step(ease(k));
      if (k >= 1) { tweens.delete(tw); tw.done && tw.done(); }
    }
    requestAnimationFrame(loop);
  })();
  const lerp = (a, b, k) => a + (b - a) * k;

  // spotlight: one rectangle, moving between targets; dim 0 = a glowing ring without darkening the rest
  let spotRect = null, spotOn = 0;
  function setSpot(r, o) {
    spot.style.left = r.x + 'px'; spot.style.top = r.y + 'px'; spot.style.width = r.w + 'px'; spot.style.height = r.h + 'px';
    spot.style.opacity = o;
  }
  function spotTo(rect, { pad = 8, dim = true, dur = 450 } = {}) {
    spot.classList.toggle('ring', !dim);
    if (!rect) {
      const from = spotOn;
      if (spotRect) tween(dur * 0.8, (k) => setSpot(spotRect, lerp(from, 0, k)), () => { spotOn = 0; });
      return;
    }
    const to = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
    const from = spotRect && spotOn > 0 ? { ...spotRect } : to, o0 = spotOn;
    tween(dur, (k) => {
      spotRect = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k) };
      spotOn = lerp(o0, 1, k);
      setSpot(spotRect, spotOn);
    });
  }

  // callout next to a rectangle: side = right | left | below | above
  function callout(text, rect, side = 'right') {
    if (!text) { const o = +call.style.opacity || 0; tween(250, (k) => { call.style.opacity = lerp(o, 0, k); }); return; }
    call.textContent = text;
    call.style.opacity = 0;
    const cw = Math.min(340, call.offsetWidth + 2), ch = call.offsetHeight, gap = 18;
    let x, y;
    if (side === 'right') { x = rect.x + rect.w + gap; y = rect.y + rect.h / 2 - ch / 2; }
    else if (side === 'left') { x = rect.x - gap - cw; y = rect.y + rect.h / 2 - ch / 2; }
    else if (side === 'below') { x = rect.x + rect.w / 2 - cw / 2; y = rect.y + rect.h + gap; }
    else { x = rect.x + rect.w / 2 - cw / 2; y = rect.y - gap - ch; }
    x = Math.max(12, Math.min(innerWidth - cw - 12, x)); y = Math.max(12, Math.min(innerHeight - ch - 12, y));
    call.style.left = x + 'px'; call.style.top = y + 'px';
    tween(300, (k) => { call.style.opacity = k; call.style.transform = `translateY(${(1 - k) * 8}px)`; });
  }

  function showKeys(list) {
    if (!list) { const o = +keys.style.opacity || 0; tween(250, (k) => { keys.style.opacity = lerp(o, 0, k); }); return; }
    keys.innerHTML = list.map((k) => (k === '+' || k === '/' ? `<span>${k}</span>` : `<kbd>${k}</kbd>`)).join('');
    tween(200, (k) => { keys.style.opacity = k; });
  }

  function showCard(title, sub) {
    card.querySelector('.title').textContent = title;
    card.querySelector('.sub').textContent = sub || '';
    card.style.opacity = 1;
  }
  function hideCard(dur = 700) { tween(dur, (k) => { card.style.opacity = 1 - k; }); }

  function ripple(x, y) {
    const r = document.createElement('div'); r.className = 'dir-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
    root.insertBefore(r, cursor);
    tween(480, (k) => { r.style.transform = `scale(${1 + k * 2.4})`; r.style.opacity = 1 - k; }, () => r.remove());
  }

  // the drawn cursor follows the real pointer events the recorder sends, and dips with a ripple on press
  let down = false;
  const place = (e) => { window.__dir.cursor(e.clientX, e.clientY, down); };
  window.addEventListener('mousemove', place, true);
  window.addEventListener('mousedown', (e) => { down = true; place(e); ripple(e.clientX, e.clientY); }, true);
  window.addEventListener('mouseup', (e) => { down = false; place(e); }, true);

  window.__dir = {
    cursor(x, y, down) { cursor.style.transform = `translate(${x - 5}px, ${y - 3}px) scale(${down ? 0.86 : 1})`; },
    hideCursor() { cursor.style.transform = 'translate(-100px, -100px)'; },
    ripple, spotTo, callout, showKeys, showCard, hideCard,
  };
})();
