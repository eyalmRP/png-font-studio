// The artboard stage: zoom/pan, layer selection and transform handles, text tool, and on-canvas text editing.
import { h, icon, rafThrottle } from '../dom.js';
import { t } from '../i18n.js';
import { iconButton } from '../controls.js';
import { state, on, emit, selectedLayer, selectLayer, checkpoint, projectChanged, newTextLayer, markLayer, getFont } from '../../app/store.js';
import { drawLayers, renderLayer, layerMatrix, getLayout, warpPoint, unwarpPoint, layerVisibleAt } from '../../render/layer.js';
import { caretAt, hitTest, selectionRects, moveVertical, moveHorizontal, lineStartEnd } from '../../core/layout.js';
import { nextWordBoundary } from '../../core/textdoc.js';
import {
  typeText, deleteText, setCaret, selectAll, selectWord, selectParagraph, enterEdit, exitEdit, selectedText, nudgeSpacing, setChar, currentCharStyle,
} from '../../app/textedit.js';

export function createStage() {
  const canvas = h('canvas.view', { 'aria-label': t('Title artboard'), tabIndex: 0 });
  const ime = h('textarea.ime', { 'aria-label': t('Text input'), autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: false, inputmode: 'text', enterkeyhint: 'enter', rows: 1 });
  const zoomLabel = h('span.zoom-label', '100%');
  const toolBtns = {};
  const setTool = (tool) => { view.tool = tool; for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === tool); updateHint(); updateCursor(); };
  toolBtns.select = iconButton('pointer', t('Select and move') + ' (V)', () => setTool('select'));
  toolBtns.text = iconButton('textCursor', t('Text tool') + ' (T)', () => setTool('text'));
  toolBtns.hand = iconButton('hand', t('Pan') + ' (H)', () => setTool('hand'));
  const guidesBtn = iconButton('baseline', t('Show text guides while editing'), () => { view.guides = !view.guides; guidesBtn.classList.toggle('on', view.guides); request(); });
  const safeBtn = iconButton('scan', t('Title-safe guides'), () => { state.project.artboard.safe = !state.project.artboard.safe; safeBtn.classList.toggle('on', state.project.artboard.safe); request(); });
  const bar = h('div.stage-bar',
    toolBtns.select, toolBtns.text, toolBtns.hand, h('span.divider', { style: { width: '1px', height: '20px', margin: '0 4px', background: 'var(--line)' } }),
    iconButton('zoomOut', t('Zoom out'), () => zoomBy(1 / 1.25)), zoomLabel, iconButton('zoomIn', t('Zoom in'), () => zoomBy(1.25)),
    iconButton('fit', t('Fit artboard') + ' (Ctrl+0)', () => fit()), guidesBtn, safeBtn);
  const hint = h('div.stage-hint');
  const el = h('div.stage', canvas, ime, bar, hint);
  const view = { zoom: 0.5, panX: 0, panY: 0, tool: 'select', guides: true, fitted: false, blink: true, hover: null };
  guidesBtn.classList.add('on');
  let dpr = 1, W = 0, H = 0;
  const offs = [];

  // ---------- geometry ----------
  const viewMatrix = () => new DOMMatrix().translate(view.panX, view.panY).scale(view.zoom);
  const toArtboard = (cx, cy) => viewMatrix().inverse().transformPoint(new DOMPoint(cx, cy));
  function fit() {
    const ab = state.project.artboard;
    const pad = 48;
    view.zoom = Math.max(0.02, Math.min((W - pad * 2) / ab.w, (H - pad * 2 - 30) / ab.h));
    view.panX = (W - ab.w * view.zoom) / 2;
    view.panY = (H - ab.h * view.zoom) / 2 + 12;
    view.fitted = true;
    request();
  }
  function zoomBy(f, cx = W / 2, cy = H / 2) {
    const z = Math.min(32, Math.max(0.02, view.zoom * f));
    const p = toArtboard(cx, cy);
    view.zoom = z;
    view.panX = cx - p.x * z; view.panY = cy - p.y * z;
    view.fitted = false;
    request();
  }
  function resize() {
    const r = el.getBoundingClientRect();
    dpr = Math.min(3, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    if (view.fitted || !view.inited) { fit(); view.inited = true; }
    request();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(el);

  // ---------- layer geometry for overlays ----------
  function layerContent(layer) {
    const r = renderLayer(layer, state.time, Math.max(0.05, view.zoom * dpr * Math.max(layer.scaleX, layer.scaleY) / 100), { showMissing: true });
    return r;
  }
  /** Local rect corners of a layer in screen px. */
  function quadOf(layer, rect) {
    const M = viewMatrix().multiply(layerMatrix(layer));
    return [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]].map(([x, y]) => { const p = M.transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; });
  }
  function boundsRect(layer) {
    const r = layerContent(layer);
    if (!r) return null;
    return r.contentRect;
  }
  function handlesOf(layer) {
    const rect = boundsRect(layer);
    if (!rect) return null;
    const q = quadOf(layer, rect);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const list = [
      { id: 'nw', p: q[0], lx: rect.x, ly: rect.y, ox: rect.x + rect.w, oy: rect.y + rect.h },
      { id: 'ne', p: q[1], lx: rect.x + rect.w, ly: rect.y, ox: rect.x, oy: rect.y + rect.h },
      { id: 'se', p: q[2], lx: rect.x + rect.w, ly: rect.y + rect.h, ox: rect.x, oy: rect.y },
      { id: 'sw', p: q[3], lx: rect.x, ly: rect.y + rect.h, ox: rect.x + rect.w, oy: rect.y },
      { id: 'n', p: mid(q[0], q[1]), lx: rect.x + rect.w / 2, ly: rect.y, ox: rect.x + rect.w / 2, oy: rect.y + rect.h, axis: 'y' },
      { id: 's', p: mid(q[3], q[2]), lx: rect.x + rect.w / 2, ly: rect.y + rect.h, ox: rect.x + rect.w / 2, oy: rect.y, axis: 'y' },
      { id: 'e', p: mid(q[1], q[2]), lx: rect.x + rect.w, ly: rect.y + rect.h / 2, ox: rect.x, oy: rect.y + rect.h / 2, axis: 'x' },
      { id: 'w', p: mid(q[0], q[3]), lx: rect.x, ly: rect.y + rect.h / 2, ox: rect.x + rect.w, oy: rect.y + rect.h / 2, axis: 'x' },
    ];
    const topMid = mid(q[0], q[1]);
    const ctr = mid(q[0], q[2]);
    const dx = topMid[0] - ctr[0], dy = topMid[1] - ctr[1], len = Math.hypot(dx, dy) || 1;
    list.push({ id: 'rot', p: [topMid[0] + (dx / len) * 28, topMid[1] + (dy / len) * 28], rot: true, cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 });
    return { rect, quad: q, list };
  }

  function layerAt(cx, cy) {
    const layers = state.project.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!layerVisibleAt(l, state.time) || l.locked) continue;
      const r = layerContent(l);
      if (!r) continue;
      const inv = viewMatrix().multiply(layerMatrix(l)).inverse();
      const p = inv.transformPoint(new DOMPoint(cx, cy));
      const rr = r.contentRect;
      const slack = 4 / view.zoom;
      if (p.x >= rr.x - slack && p.x <= rr.x + rr.w + slack && p.y >= rr.y - slack && p.y <= rr.y + rr.h + slack) return l;
    }
    return null;
  }

  /** Screen point → text position in a layer. */
  function textPosAt(layer, cx, cy) {
    const inv = viewMatrix().multiply(layerMatrix(layer)).inverse();
    const p = inv.transformPoint(new DOMPoint(cx, cy));
    const [ux, uy] = unwarpPoint(layer, p.x, p.y);
    return hitTest(getLayout(layer), ux, uy);
  }

  // ---------- drawing ----------
  const request = rafThrottle(draw);
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

  function draw() {
    if (!state.project) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const ab = state.project.artboard;
    const base = new DOMMatrix().scale(dpr).multiply(viewMatrix());
    // artboard background
    ctx.save();
    ctx.setTransform(base);
    if (ab.bg === 'color') { ctx.fillStyle = ab.bgColor; ctx.fillRect(0, 0, ab.w, ab.h); }
    else {
      const a = cssVar('--checker-a'), b = cssVar('--checker-b');
      ctx.fillStyle = a; ctx.fillRect(0, 0, ab.w, ab.h);
      const cell = 16 / view.zoom;
      ctx.fillStyle = b;
      ctx.beginPath();
      for (let y = 0, r = 0; y < ab.h; y += cell, r++) for (let x = (r % 2) * cell; x < ab.w; x += cell * 2) ctx.rect(x, y, Math.min(cell, ab.w - x), Math.min(cell, ab.h - y));
      ctx.fill();
    }
    ctx.restore();
    // layers (clipped to the artboard edge lightly: draw outside at reduced opacity)
    ctx.save();
    drawLayers(ctx, state.project, state.time, base, { showMissing: true });
    ctx.restore();
    // dim outside the artboard
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tl = viewMatrix().transformPoint(new DOMPoint(0, 0)), br = viewMatrix().transformPoint(new DOMPoint(ab.w, ab.h));
    ctx.fillStyle = cssVar('--stage');
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--line-strong');
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(br.x - tl.x), Math.round(br.y - tl.y));
    if (ab.safe) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = cssVar('--cyan');
      for (const f of [0.9, 0.8]) {
        const w = (br.x - tl.x) * f, hh = (br.y - tl.y) * f;
        ctx.strokeRect(tl.x + ((br.x - tl.x) - w) / 2, tl.y + ((br.y - tl.y) - hh) / 2, w, hh);
      }
      ctx.setLineDash([]);
    }
    drawOverlays(ctx);
    ctx.restore();
    zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
  }

  function polyline(ctx, pts, close) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (close) ctx.closePath();
  }

  /** Map a local layout point to screen. */
  function screenPt(layer, M, x, y, li) {
    const [wx, wy] = warpPoint(layer, x, y, li);
    const p = M.transformPoint(new DOMPoint(wx, wy));
    return [p.x, p.y];
  }

  function drawOverlays(ctx) {
    const accent = cssVar('--accent');
    const layer = selectedLayer();
    if (view.hover && view.hover !== layer && state.project.layers.includes(view.hover)) {
      const b = boundsRect(view.hover);
      if (b) { ctx.strokeStyle = accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; polyline(ctx, quadOf(view.hover, b), true); ctx.stroke(); ctx.globalAlpha = 1; }
    }
    if (!layer || !layerVisibleAt(layer, state.time)) return;
    const editing = state.edit && state.edit.layerId === layer.id;
    const M = viewMatrix().multiply(layerMatrix(layer));
    if (editing) {
      const layout = getLayout(layer);
      const e = state.edit;
      // text box frame
      if (layer.box.mode === 'box') {
        ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1;
        const fr = layout.frame;
        polyline(ctx, [[0, 0], [layer.box.width, 0], [layer.box.width, Math.max(fr.h, 20)], [0, Math.max(fr.h, 20)]].map(([x, y]) => { const p = M.transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; }), true);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (view.guides) {
        ctx.lineWidth = 1;
        layout.lines.forEach((ln, li) => {
          const x0 = Math.min(ln.x0, layout.frame.x) - 20, x1 = Math.max(ln.x0 + ln.width, layout.frame.x + layout.frame.w) + 20;
          const seg = (y) => { const pts = []; for (let k = 0; k <= 24; k++) pts.push(screenPt(layer, M, x0 + ((x1 - x0) * k) / 24, y, li)); return pts; };
          ctx.strokeStyle = cssVar('--guide-base'); ctx.globalAlpha = 0.55; polyline(ctx, seg(ln.baseline)); ctx.stroke();
          const font = ln.items.find((it) => it.font)?.font || getFont(null);
          const k = ln.items[0]?.kv || 0;
          if (font && k) {
            ctx.strokeStyle = cssVar('--guide-x'); ctx.globalAlpha = 0.35; polyline(ctx, seg(ln.baseline - font.metrics.xHeight * k)); ctx.stroke();
            ctx.strokeStyle = cssVar('--guide-cap'); polyline(ctx, seg(ln.baseline - font.metrics.capHeight * k)); ctx.stroke();
          }
          ctx.globalAlpha = 1;
        });
      }
      // selection
      const s = Math.min(e.caret, e.anchor), en = Math.max(e.caret, e.anchor);
      if (s !== en) {
        ctx.fillStyle = accent; ctx.globalAlpha = 0.28;
        for (const r of selectionRects(layout, s, en)) {
          const li = layout.lines.findIndex((ln) => r.y >= ln.top - 0.5 && r.y <= ln.bottom);
          const pts = [];
          const n = Math.max(1, Math.ceil(r.w / 30));
          for (let k = 0; k <= n; k++) pts.push(screenPt(layer, M, r.x + (r.w * k) / n, r.y, li));
          for (let k = n; k >= 0; k--) pts.push(screenPt(layer, M, r.x + (r.w * k) / n, r.y + r.h, li));
          polyline(ctx, pts, true); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // caret
      if (view.blink && s === en) {
        const c = caretAt(layout, e.caret);
        const a = screenPt(layer, M, c.x, c.top, c.line), b = screenPt(layer, M, c.x, c.bottom, c.line);
        ctx.strokeStyle = accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
        placeIme(a, b);
      }
      return;
    }
    const hd = handlesOf(layer);
    if (!hd) return;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    polyline(ctx, hd.quad, true); ctx.stroke();
    if (layer.locked) return;
    const top = hd.list.find((x) => x.id === 'n'), rot = hd.list.find((x) => x.rot);
    ctx.beginPath(); ctx.moveTo(...top.p); ctx.lineTo(...rot.p); ctx.stroke();
    for (const hnd of hd.list) {
      ctx.fillStyle = hnd.rot ? accent : cssVar('--panel-2');
      ctx.beginPath();
      if (hnd.rot) ctx.arc(hnd.p[0], hnd.p[1], 5, 0, Math.PI * 2);
      else ctx.rect(hnd.p[0] - 4.5, hnd.p[1] - 4.5, 9, 9);
      ctx.fill(); ctx.stroke();
    }
  }

  function placeIme(a, b) {
    ime.style.left = Math.round(a[0]) + 'px';
    ime.style.top = Math.round(Math.min(a[1], b[1])) + 'px';
  }

  // ---------- caret blink ----------
  let blinkTimer = setInterval(() => {
    if (!state.edit) return;
    view.blink = !view.blink;
    request();
  }, 530);
  const wake = () => { view.blink = true; request(); };

  // ---------- pointer interaction ----------
  let drag = null, spaceDown = false, clickCount = 0, lastClick = 0, lastClickPos = [0, 0];

  function updateCursor() {
    canvas.style.cursor = spaceDown || view.tool === 'hand' ? 'grab' : view.tool === 'text' ? 'text' : 'default';
  }
  function updateHint() {
    const layer = selectedLayer();
    let msg;
    if (state.edit) msg = t('Typing on the canvas · Esc to finish · Alt+←/→ kerning');
    else if (view.tool === 'text') msg = t('Click anywhere on the artboard to start a new title');
    else if (layer) msg = t('Double-click the text to edit it · drag handles to scale and rotate');
    else msg = t('Double-click a title to edit it, or press T to add one');
    hint.textContent = msg;
  }

  canvas.addEventListener('pointerdown', (ev) => {
    const r = canvas.getBoundingClientRect();
    const cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    canvas.setPointerCapture(ev.pointerId);
    const now = performance.now();
    if (now - lastClick < 380 && Math.hypot(cx - lastClickPos[0], cy - lastClickPos[1]) < 6) clickCount++; else clickCount = 1;
    lastClick = now; lastClickPos = [cx, cy];
    if (ev.button === 1 || spaceDown || view.tool === 'hand') {
      drag = { type: 'pan', sx: cx, sy: cy, px: view.panX, py: view.panY };
      canvas.style.cursor = 'grabbing';
      return;
    }
    const layer = selectedLayer();
    // editing: clicks inside the edited layer move the caret
    if (state.edit && layer && state.edit.layerId === layer.id) {
      const hit = layerAt(cx, cy);
      if (hit === layer) {
        const pos = textPosAt(layer, cx, cy);
        if (clickCount === 2) selectWord(pos);
        else if (clickCount >= 3) selectParagraph(pos);
        else setCaret(pos, ev.shiftKey);
        drag = { type: 'select', layer };
        focusIme(); wake();
        return;
      }
      exitEdit();
    }
    // handles of the selected layer
    if (layer && !layer.locked && view.tool === 'select') {
      const hd = handlesOf(layer);
      const hnd = hd && hd.list.find((x) => Math.hypot(x.p[0] - cx, x.p[1] - cy) < 9);
      if (hnd) { startHandleDrag(layer, hnd, cx, cy); return; }
    }
    const hit = layerAt(cx, cy);
    if (view.tool === 'text') {
      if (hit) { selectLayer(hit.id); enterEdit(hit.id, textPosAt(hit, cx, cy)); focusIme(); drag = { type: 'select', layer: hit }; return; }
      const p = toArtboard(cx, cy);
      addTextAt(p.x, p.y);
      return;
    }
    if (hit) {
      if (clickCount >= 2) {
        selectLayer(hit.id);
        enterEdit(hit.id, textPosAt(hit, cx, cy));
        if (clickCount === 2) selectWord(state.edit.caret);
        focusIme();
        return;
      }
      // on a touch screen, tapping the selected title again starts editing it (double-tap is awkward there)
      const tapEdit = ev.pointerType === 'touch' && selectedLayer() === hit && !hit.locked;
      selectLayer(hit.id);
      if (!hit.locked) {
        const p = toArtboard(cx, cy);
        drag = { type: 'move', layer: hit, sx: p.x, sy: p.y, lx: hit.x, ly: hit.y, moved: false, tapEdit, touch: ev.pointerType === 'touch' };
      }
    } else {
      selectLayer(null);
    }
    request();
  });

  function startHandleDrag(layer, hnd, cx, cy) {
    const p = toArtboard(cx, cy);
    checkpoint('project', hnd.rot ? 'Rotate' : 'Scale');
    drag = { type: hnd.rot ? 'rotate' : 'scale', layer, hnd, sx: p.x, sy: p.y, start: { x: layer.x, y: layer.y, rotation: layer.rotation, scaleX: layer.scaleX, scaleY: layer.scaleY, width: layer.box.width } };
  }

  canvas.addEventListener('pointermove', (ev) => {
    const r = canvas.getBoundingClientRect();
    const cx = ev.clientX - r.left, cy = ev.clientY - r.top;
    if (!drag) {
      const hov = view.tool !== 'hand' ? layerAt(cx, cy) : null;
      if (hov !== view.hover) { view.hover = hov; request(); }
      const layer = selectedLayer();
      if (layer && !state.edit && view.tool === 'select' && !spaceDown) {
        const hd = handlesOf(layer);
        const hnd = hd && hd.list.find((x) => Math.hypot(x.p[0] - cx, x.p[1] - cy) < 9);
        canvas.style.cursor = hnd ? (hnd.rot ? 'alias' : ['n', 's'].includes(hnd.id) ? 'ns-resize' : ['e', 'w'].includes(hnd.id) ? 'ew-resize' : ['nw', 'se'].includes(hnd.id) ? 'nwse-resize' : 'nesw-resize') : hov ? 'move' : 'default';
      } else if (state.edit && hov === selectedLayer()) canvas.style.cursor = 'text';
      else updateCursor();
      return;
    }
    if (drag.type === 'pan') { view.panX = drag.px + cx - drag.sx; view.panY = drag.py + cy - drag.sy; view.fitted = false; request(); return; }
    if (drag.type === 'select') { setCaret(textPosAt(drag.layer, cx, cy), true); wake(); return; }
    const p = toArtboard(cx, cy);
    const L = drag.layer;
    if (drag.type === 'move') {
      // a small dead zone, so a tap (fingers wobble) neither nudges the layer nor cancels tap-to-edit
      if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) * view.zoom < (drag.touch ? 8 : 3)) return;
      let nx = drag.lx + p.x - drag.sx, ny = drag.ly + p.y - drag.sy;
      if (ev.shiftKey) { if (Math.abs(p.x - drag.sx) > Math.abs(p.y - drag.sy)) ny = drag.ly; else nx = drag.lx; }
      // snap the anchor to the artboard centre lines
      const ab = state.project.artboard, snap = 8 / view.zoom;
      if (Math.abs(nx - ab.w / 2) < snap) nx = ab.w / 2;
      if (Math.abs(ny - ab.h / 2) < snap) ny = ab.h / 2;
      if (!drag.moved) { checkpoint('project', 'Move layer'); drag.moved = true; }
      L.x = Math.round(nx * 10) / 10; L.y = Math.round(ny * 10) / 10;
      projectChanged('transform');
      return;
    }
    if (drag.type === 'rotate') {
      const st = drag.start;
      const C = new DOMMatrix().translate(st.x, st.y).rotate(st.rotation).scale(st.scaleX / 100, st.scaleY / 100).transformPoint(new DOMPoint(drag.hnd.cx, drag.hnd.cy));
      const a0 = Math.atan2(drag.sy - C.y, drag.sx - C.x), a1 = Math.atan2(p.y - C.y, p.x - C.x);
      let rot = st.rotation + ((a1 - a0) * 180) / Math.PI;
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
      rot = ((rot + 540) % 360) - 180;
      L.rotation = Math.round(rot * 10) / 10;
      // keep the content centre fixed
      const R = new DOMMatrix().rotate(L.rotation).scale(st.scaleX / 100, st.scaleY / 100).transformPoint(new DOMPoint(drag.hnd.cx, drag.hnd.cy));
      L.x = C.x - R.x; L.y = C.y - R.y;
      projectChanged('transform');
      return;
    }
    if (drag.type === 'scale') {
      const st = drag.start, hnd = drag.hnd;
      const Rinv = new DOMMatrix().rotate(-st.rotation);
      const startM = new DOMMatrix().translate(st.x, st.y).rotate(st.rotation).scale(st.scaleX / 100, st.scaleY / 100);
      const O = startM.transformPoint(new DOMPoint(hnd.ox, hnd.oy));
      const q = Rinv.transformPoint(new DOMPoint(p.x - O.x, p.y - O.y));
      const dx = hnd.lx - hnd.ox, dy = hnd.ly - hnd.oy;
      if (L.box.mode === 'box' && hnd.axis === 'x') {
        // area text: side handles change the box width (text reflows)
        const w = Math.max(40, Math.abs(q.x / (st.scaleX / 100)));
        L.box.width = Math.round(w);
        if (hnd.id === 'w') {
          const shift = new DOMMatrix().rotate(st.rotation).transformPoint(new DOMPoint((st.width - w) * st.scaleX / 100, 0));
          L.x = st.x + shift.x; L.y = st.y + shift.y;
        }
        markLayer(L, 'layout');
        projectChanged('layout', L);
        return;
      }
      let sx = st.scaleX / 100, sy = st.scaleY / 100;
      if (hnd.axis === 'x') sx = dx ? q.x / dx : sx;
      else if (hnd.axis === 'y') sy = dy ? q.y / dy : sy;
      else if (ev.shiftKey) { sx = dx ? q.x / dx : sx; sy = dy ? q.y / dy : sy; }
      else {
        const d0x = sx * dx, d0y = sy * dy;
        const k = (q.x * d0x + q.y * d0y) / (d0x * d0x + d0y * d0y || 1);
        sx *= k; sy *= k;
      }
      sx = Math.sign(sx || 1) * Math.max(0.01, Math.abs(sx)); sy = Math.sign(sy || 1) * Math.max(0.01, Math.abs(sy));
      L.scaleX = Math.round(sx * 1000) / 10; L.scaleY = Math.round(sy * 1000) / 10;
      const R = new DOMMatrix().rotate(st.rotation).transformPoint(new DOMPoint(L.scaleX / 100 * hnd.ox, L.scaleY / 100 * hnd.oy));
      L.x = O.x - R.x; L.y = O.y - R.y;
      projectChanged('transform', L);
    }
  });

  const endDrag = (ev) => {
    if (drag && drag.type === 'move' && drag.tapEdit && !drag.moved && ev.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      enterEdit(drag.layer.id, textPosAt(drag.layer, ev.clientX - r.left, ev.clientY - r.top));
      focusIme();
      drag = null;
      return;
    }
    if (drag && drag.type === 'pan') updateCursor();
    if (drag && (drag.type === 'scale' || drag.type === 'rotate' || drag.type === 'move')) emit('selection');
    drag = null;
    void ev;
  };
  canvas.addEventListener('pointerup', endDrag);
  // a tap that lands in the text being edited must focus inside the tap for the phone keyboard to open
  canvas.addEventListener('click', () => { if (state.edit && document.activeElement !== ime) focusIme(); });
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { if (view.hover) { view.hover = null; request(); } });

  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey) zoomBy(Math.exp(-ev.deltaY * 0.0022), ev.clientX - r.left, ev.clientY - r.top);
    else { view.panX -= ev.deltaX; view.panY -= ev.deltaY; view.fitted = false; request(); }
  }, { passive: false });

  canvas.addEventListener('dblclick', (ev) => ev.preventDefault());

  function addTextAt(x, y) {
    checkpoint('project', 'Add title');
    const font = state.fontOrder[0];
    const layer = newTextLayer('', font, Math.round(x), Math.round(y), { size: Math.round(state.project.artboard.h / 7) });
    layer.name = 'Text'; layer.autoName = true;
    layer.doc.paras[0] = { ...layer.doc.paras[0], align: 'left' };
    // carry over the look of the last edited layer
    const last = selectedLayer();
    if (last) { layer.effects = JSON.parse(JSON.stringify(last.effects)); layer.doc.typing = Object.freeze({ ...last.doc.typing, ...(last.doc.styles[0] || {}) }); }
    state.project.layers.push(layer);
    projectChanged();
    selectLayer(layer.id);
    enterEdit(layer.id, 0);
    state.edit.typing = layer.doc.typing;
    focusIme();
    setTool('select');
  }

  // ---------- keyboard / IME ----------
  // Phones open their keyboard only when focus happens inside the tap itself, so focus right away (and again
  // after the event, in case the tap moved focus). The hidden field keeps one invisible character before the
  // caret: a phone keyboard's Backspace on an empty field sends nothing at all.
  const SENT = '\u200b';
  function resetIme() { ime.value = SENT; try { ime.setSelectionRange(1, 1); } catch { /* not focused */ } }
  function focusIme() {
    ime.focus({ preventScroll: true });
    if (!composing) resetIme();
    setTimeout(() => { if (state.edit && document.activeElement !== ime) { ime.focus({ preventScroll: true }); if (!composing) resetIme(); } }, 0);
  }
  // Android keyboards send the word being typed as a composition: show it live, then commit it
  let composing = false, compLen = 0;
  const unSent = (v) => v.split(SENT).join('');
  const removeTyped = (n) => { for (let i = 0; i < n; i++) deleteText(-1); };
  ime.addEventListener('compositionstart', () => { composing = true; compLen = 0; });
  ime.addEventListener('compositionend', (e) => {
    composing = false;
    removeTyped(compLen);
    compLen = 0;
    const v = e.data ?? unSent(ime.value);
    if (v) typeText(v.replace(/\r\n?/g, '\n'));
    resetIme();
  });
  ime.addEventListener('input', (e) => {
    if (!state.edit) { resetIme(); return; }
    const v = ime.value;
    if (composing) {
      const live = unSent(v);
      removeTyped(compLen);
      if (live) typeText(live);
      compLen = [...live].length;
      return;
    }
    if (!v.startsWith(SENT) && (e.inputType || '').startsWith('delete')) deleteText(-1, e.inputType === 'deleteWordBackward');
    else { const add = unSent(v); if (add) typeText(add.replace(/\r\n?/g, '\n')); }
    resetIme();
  });
  ime.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) typeText(text.replace(/\r\n?/g, '\n'));
  });
  ime.addEventListener('copy', (e) => { e.preventDefault(); e.clipboardData.setData('text/plain', selectedText()); });
  ime.addEventListener('cut', (e) => { e.preventDefault(); e.clipboardData.setData('text/plain', selectedText()); deleteText(1); });
  ime.addEventListener('blur', () => { request(); });
  ime.addEventListener('keydown', (e) => {
    if (!state.edit || composing) return;
    const layer = selectedLayer();
    if (!layer) return;
    const layout = getLayout(layer);
    const ed = state.edit;
    const mod = e.ctrlKey || e.metaKey;
    const rtlUI = document.documentElement.dir === 'rtl';
    wake();
    switch (e.key) {
      case 'Escape': e.preventDefault(); exitEdit(); return;
      case 'Enter': e.preventDefault(); typeText('\n'); return;
      case 'Tab': e.preventDefault(); typeText('\t'); return;
      case 'Backspace': e.preventDefault(); deleteText(-1, mod || e.altKey); return;
      case 'Delete': e.preventDefault(); deleteText(1, mod); return;
      case 'ArrowLeft': case 'ArrowRight': {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        if (e.altKey && !mod) { nudgeSpacing(dir * (e.shiftKey ? 100 : 20) * (rtlUI ? 1 : 1)); return; }
        let pos;
        if (mod) pos = nextWordBoundary(layer.doc, ed.caret, dir * (isRTLAt(layout, ed.caret) ? -1 : 1));
        else if (!e.shiftKey && ed.caret !== ed.anchor) pos = dir > 0 ? Math.max(ed.caret, ed.anchor) : Math.min(ed.caret, ed.anchor);
        else pos = moveHorizontal(layout, layer.doc, ed.caret, dir);
        setCaret(pos, e.shiftKey);
        ed.goalX = null;
        return;
      }
      case 'ArrowUp': case 'ArrowDown': {
        e.preventDefault();
        if (e.altKey) {
          const cs = currentCharStyle(layer);
          if (e.shiftKey) setChar({ baselineShift: (cs.baselineShift || 0) + (e.key === 'ArrowUp' ? 2 : -2) }, 'bshift');
          return;
        }
        if (ed.goalX === null || ed.goalX === undefined) ed.goalX = caretAt(layout, ed.caret).x;
        const g = ed.goalX;
        setCaret(moveVertical(layout, ed.caret, e.key === 'ArrowDown' ? 1 : -1, g), e.shiftKey);
        ed.goalX = g;
        return;
      }
      case 'Home': case 'End': {
        e.preventDefault();
        const [s, en] = mod ? [0, layer.doc.chars.length] : lineStartEnd(layout, ed.caret);
        setCaret(e.key === 'Home' ? s : en, e.shiftKey);
        return;
      }
      default: break;
    }
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'a') { e.preventDefault(); selectAll(); return; }
      if (k === 'z') { e.preventDefault(); emit('undo-request', e.shiftKey); return; }
      if (k === 'y') { e.preventDefault(); emit('undo-request', true); return; }
      if (k === 'u') { e.preventDefault(); const cs = currentCharStyle(layer); setChar({ underline: !cs.underline }); return; }
      if (e.key === '>' || e.key === '.' && e.shiftKey) { e.preventDefault(); const cs = currentCharStyle(layer); setChar({ size: Math.round((cs.size || 100) * 1.1) }); return; }
      if (e.key === '<' || e.key === ',' && e.shiftKey) { e.preventDefault(); const cs = currentCharStyle(layer); setChar({ size: Math.max(4, Math.round((cs.size || 100) / 1.1)) }); return; }
    }
  });

  function isRTLAt(layout, pos) {
    for (const ln of layout.lines) for (const it of ln.items) if (pos >= it.index && pos <= it.index + it.len) return !!(it.level & 1);
    return false;
  }

  // global shortcuts when not typing
  offs.push(on('key', (e) => {
    if (state.ui.mode !== 'titles') return;
    const mod = e.ctrlKey || e.metaKey;
    const layer = selectedLayer();
    if (e.key === ' ' && !spaceDown) { spaceDown = true; updateCursor(); e.preventDefault(); return; }
    if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.25); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomBy(0.8); return; }
    if (mod) return;
    if (e.key === 't' || e.key === 'T') { setTool('text'); return; }
    if (e.key === 'v' || e.key === 'V') { setTool('select'); return; }
    if (e.key === 'h' || e.key === 'H') { setTool('hand'); return; }
    if (layer && e.key === 'Enter') { enterEdit(layer.id); focusIme(); return; }
    if (layer && !layer.locked && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      checkpoint('project', 'Nudge', 'nudge:' + layer.id);
      if (e.key === 'ArrowLeft') layer.x -= d; if (e.key === 'ArrowRight') layer.x += d;
      if (e.key === 'ArrowUp') layer.y -= d; if (e.key === 'ArrowDown') layer.y += d;
      projectChanged('transform');
    }
  }));
  const keyUp = (e) => { if (e.key === ' ') { spaceDown = false; updateCursor(); } };
  window.addEventListener('keyup', keyUp);

  offs.push(on('project', request), on('selection', () => { request(); updateHint(); }), on('edit', () => { request(); updateHint(); }), on('time', request), on('theme', request), on('resize', resize), on('font', request));
  offs.push(on('focus-ime', focusIme));
  setTool('select');

  return {
    el, request, fit, focusIme,
    destroy() { offs.forEach((f) => f()); ro.disconnect(); clearInterval(blinkTimer); window.removeEventListener('keyup', keyUp); },
  };
}

export { icon };
