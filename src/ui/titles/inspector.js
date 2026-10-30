// Right-hand inspector for titles: character, paragraph, effects, warp, animation and layer tabs.
import { h, clear, icon, storeSet } from '../dom.js';
import { t } from '../i18n.js';
import { numberField, angleField, pills, toggle, section, tabs, select, button, iconButton, colorField, gradientField, menu } from '../controls.js';
import { state, on, emit, selectedLayer, checkpoint, projectChanged, newEffect, getFont } from '../../app/store.js';
import { currentCharStyle, currentParaStyle, setChar, setPara, isCollapsedEdit } from '../../app/textedit.js';
import { EFFECTS, EFFECT_ORDER, BLEND_MODES, STYLE_PRESETS } from '../../core/effects-def.js';
import { WARP_STYLES, warpPoint, DEFAULT_WARP } from '../../core/warp.js';
import { IN_PRESETS, OUT_PRESETS, LOOP_PRESETS, ORDERS } from '../../core/anim.js';
import { drawSample } from '../sample.js';

export const LABELS = {
  // effects
  stroke: 'Stroke', dropShadow: 'Drop shadow', outerGlow: 'Outer glow', extrude: '3D extrude', longShadow: 'Long shadow', innerShadow: 'Inner shadow',
  innerGlow: 'Inner glow', bevel: 'Bevel & emboss', colorOverlay: 'Colour overlay', gradientOverlay: 'Gradient overlay', adjust: 'Hue / saturation', reflection: 'Reflection', blur: 'Blur',
  // params
  position: 'Position', size: 'Size', fill: 'Fill', color: 'Colour', gradient: 'Gradient', gradAngle: 'Gradient angle', opacity: 'Opacity', soft: 'Softness',
  blend: 'Blend', angle: 'Angle', distance: 'Distance', spread: 'Spread', depth: 'Depth', mode: 'Mode', darken: 'Darken', length: 'Length', fade: 'Fade out',
  choke: 'Choke', source: 'Source', soften: 'Soften', altitude: 'Altitude', highlight: 'Highlight', highlightOpacity: 'Highlight opacity', shadow: 'Shadow',
  shadowOpacity: 'Shadow opacity', kind: 'Type', scale: 'Scale', hue: 'Hue', saturation: 'Saturation', lightness: 'Lightness', brightness: 'Brightness',
  contrast: 'Contrast', gap: 'Gap', radius: 'Radius',
  // options
  outside: 'Outside', center: 'Centre', inside: 'Inside', linear: 'Linear', radial: 'Radial', edge: 'Edge',
  // styles
  sticker: 'Sticker', neon: 'Neon', candy: 'Candy', comic: 'Comic', retro3d: 'Retro 3D', gold: 'Gold', glowUp: 'Glow', mirror: 'Mirror', embossed: 'Embossed',
  // warps
  none: 'None', arc: 'Arc', arcLower: 'Arc lower', arcUpper: 'Arc upper', arch: 'Arch', bulge: 'Bulge', shellLower: 'Shell lower', shellUpper: 'Shell upper',
  flag: 'Flag', wave: 'Wave', fish: 'Fish', rise: 'Rise', fisheye: 'Fisheye', inflate: 'Inflate', squeeze: 'Squeeze', twist: 'Twist', chevron: 'Chevron',
  triangle: 'Triangle', curve: 'Curve', doubleWave: 'Double wave', slant: 'Slant', pathArc: 'Follow arc', pathCircle: 'Circle', pathWave: 'Wavy path',
  // animation categories
  cute: 'Cute', cartoon: 'Cartoony', pro: 'Professional', fun: 'Fun',
};
export const L = (k) => t(LABELS[k] || k);

const ANIM_NAMES = {
  popBounce: 'Pop bounce', jellyDrop: 'Jelly drop', bubbleRise: 'Bubble rise', hopIn: 'Hop in', wiggleIn: 'Wiggle in', heartbeat: 'Heartbeat',
  squashDrop: 'Squash drop', rubberBand: 'Rubber band', spinPop: 'Spin pop', slamIn: 'Slam', boing: 'Boing', tumbleIn: 'Tumble in',
  fadeUp: 'Fade up', slideIn: 'Slide in', blurIn: 'Blur in', trackingIn: 'Tracking in', wipeReveal: 'Wipe reveal', maskRise: 'Line rise', typewriter: 'Typewriter',
  zoomOutIn: 'Zoom settle', flipIn: 'Flip in', scatterIn: 'Scatter in', waveIn: 'Wave in', rainbowPop: 'Rainbow pop', swingIn: 'Swing in',
  popOut: 'Pop out', floatAway: 'Float away', shrinkWiggle: 'Wiggle away', fallDown: 'Fall down', squashOut: 'Squash & leap', explode: 'Explode',
  fadeDown: 'Fade down', slideOut: 'Slide out', blurOut: 'Blur out', wipeHide: 'Wipe hide', zoomAway: 'Zoom away', typeBack: 'Type back',
  scatterOut: 'Scatter out', spinOut: 'Spin out',
  wave: 'Wave', float: 'Float', bob: 'Bob', jiggle: 'Jiggle', pulse: 'Pulse', swing: 'Swing', rubber: 'Rubber', rainbow: 'Rainbow', shimmer: 'Shimmer',
  flicker: 'Flicker', breathe: 'Breathe',
};

export function createInspector() {
  const head = h('div', { style: { padding: '10px 10px 6px' } });
  const body = h('div.panel-scroll');
  const el = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' } }, head, body);
  const TABS = [
    { id: 'character', icon: 'type', label: t('Character') },
    { id: 'paragraph', icon: 'pilcrow', label: t('Paragraph') },
    { id: 'effects', icon: 'sparkles', label: t('Effects') },
    { id: 'warp', icon: 'waves', label: t('Warp') },
    { id: 'animate', icon: 'film', label: t('Animate') },
    { id: 'layer', icon: 'move', label: t('Layer') },
  ];
  const tabBar = tabs({ class: 'icon-tabs', tabs: TABS, value: state.ui.rightTab, onChange: (id) => { state.ui.rightTab = id; storeSet('rightTab', id); build(); } });
  head.appendChild(tabBar);
  let refreshers = [];
  let builtFor = null;
  const reg = (fn) => { refreshers.push(fn); fn(); };

  function build() {
    clear(body);
    refreshers = [];
    const layer = selectedLayer();
    builtFor = layer ? layer.id + ':' + state.ui.rightTab + ':' + (layer.effects?.map((e) => e.id + e.type + (e.fill || '') + (e.mode || '') + (e.kind || '') + e.position).join(',')) + ':' + layer.warp.style : null;
    if (!layer) {
      body.appendChild(h('div.empty', icon('type', 28), h('p', t('Select a title on the stage, or press T and click the artboard to add one.'))));
      return;
    }
    const tab = state.ui.rightTab;
    if (tab === 'character') buildCharacter(layer);
    else if (tab === 'paragraph') buildParagraph(layer);
    else if (tab === 'effects') buildEffects(layer);
    else if (tab === 'warp') buildWarp(layer);
    else if (tab === 'animate') buildAnimate(layer);
    else buildLayer(layer);
  }
  function refresh() {
    const layer = selectedLayer();
    const key = layer ? layer.id + ':' + state.ui.rightTab + ':' + (layer.effects?.map((e) => e.id + e.type + (e.fill || '') + (e.mode || '') + (e.kind || '') + e.position).join(',')) + ':' + layer.warp.style : null;
    if (key !== builtFor) { build(); return; }
    for (const r of refreshers) r();
  }

  // ---------- character ----------
  function buildCharacter(layer) {
    const cs = () => currentCharStyle(layer) || {};
    const fontSel = select({
      label: t('Font'), iconName: 'type', value: cs().font || state.fontOrder[0],
      options: state.fontOrder.map((id) => ({ value: id, label: state.fonts.get(id)?.name || id })),
      onChange: (v) => setChar({ font: v }),
    });
    const prev = h('canvas', { style: { maxWidth: '100%' } });
    reg(() => { fontSel.setValue(cs().font || state.fontOrder[0]); drawSample(prev, 'Aa Bb 123', { fontId: cs().font, height: 34, maxWidth: 260 }); });
    body.appendChild(section({ id: 'ch-font', title: t('Font'), iconName: 'type' }, fontSel, prev));

    const nf = (key, o) => {
      const f = numberField({ ...o, onInput: (v) => setChar({ [key]: v }, 'char:' + key), onChange: (v) => setChar({ [key]: v }, 'char:' + key) });
      reg(() => f.setValue(cs()[key]));
      return f;
    };
    const kernPills = pills({
      class: 'stretch', value: cs().kerning,
      options: [{ value: 'optical', label: t('Optical') }, { value: 'metrics', label: t('Metrics') }, { value: 'none', label: '0' }],
      onChange: (v) => setChar({ kerning: v }),
    });
    reg(() => kernPills.setValue(cs().kerning));
    const kernField = nf('kern', { label: t('Pair kern'), iconName: 'arrowsH', min: -1000, max: 1000, step: 5, unit: '‰', title: t('Kerning before the character after the caret (1/1000 em)') });
    reg(() => { kernField.style.display = isCollapsedEdit(layer) ? '' : 'none'; });
    body.appendChild(section({ id: 'ch-size', title: t('Size & spacing'), iconName: 'caseSensitive' },
      nf('size', { label: t('Size'), iconName: 'caseSensitive', min: 2, max: 3000, step: 1, unit: 'px', slider: true, sliderMin: 8, sliderMax: 600 }),
      nf('tracking', { label: t('Tracking'), iconName: 'moveH', min: -500, max: 2000, step: 5, unit: '‰', slider: true, sliderMin: -200, sliderMax: 600 }),
      h('div.field', h('span', t('Kerning')), kernPills), kernField,
      nf('baselineShift', { label: t('Baseline shift'), iconName: 'baseline', min: -2000, max: 2000, step: 1, unit: 'px', slider: true, sliderMin: -100, sliderMax: 100 }),
    ));
    body.appendChild(section({ id: 'ch-scale', title: t('Scale, rotate & slant'), iconName: 'arrowsV' },
      h('div.grid2',
        nf('scaleX', { label: 'H', iconName: 'arrowsH', min: 1, max: 1000, step: 1, unit: '%', title: t('Horizontal scale') }),
        nf('scaleY', { label: 'V', iconName: 'arrowsV', min: 1, max: 1000, step: 1, unit: '%', title: t('Vertical scale') })),
      (() => { const a = angleField({ label: t('Rotate characters'), value: cs().rotate, onInput: (v) => setChar({ rotate: v }, 'char:rot'), onChange: (v) => setChar({ rotate: v }, 'char:rot') }); reg(() => a.setValue(cs().rotate)); return a; })(),
      nf('skew', { label: t('Slant'), iconName: 'italic', min: -60, max: 60, step: 1, unit: '°', slider: true, title: t('Faux italic') }),
    ));
    const caps = pills({
      value: cs().caps, iconOnly: false,
      options: [{ value: 'normal', label: 'Aa', title: t('Normal') }, { value: 'upper', label: 'AA', title: t('All caps') }, { value: 'lower', label: 'aa', title: t('Lowercase') }, { value: 'title', label: 'Ab Cd', title: t('Title case') }, { value: 'small', label: 'Aᴀ', title: t('Small caps') }],
      onChange: (v) => setChar({ caps: v }),
    });
    const script = pills({
      value: cs().script,
      options: [{ value: 'normal', label: t('Normal') }, { value: 'super', icon: 'superscript', title: t('Superscript') }, { value: 'sub', icon: 'subscript', title: t('Subscript') }],
      onChange: (v) => setChar({ script: v }),
    });
    const under = toggle({ label: t('Underline'), iconName: 'underline', value: cs().underline, onChange: (v) => setChar({ underline: v }) });
    const strike = toggle({ label: t('Strikethrough'), iconName: 'strike', value: cs().strike, onChange: (v) => setChar({ strike: v }) });
    const lineColor = colorField({ label: t('Line colour'), value: cs().lineColor, onInput: (v) => setChar({ lineColor: v }, 'char:lc'), onChange: (v) => setChar({ lineColor: v }, 'char:lc') });
    reg(() => { const s = cs(); caps.setValue(s.caps); script.setValue(s.script); under.setValue(s.underline); strike.setValue(s.strike); lineColor.setValue(s.lineColor); });
    body.appendChild(section({ id: 'ch-case', title: t('Case & position'), iconName: 'caseUpper' }, caps, script, under, strike, lineColor));

    const tint = pills({
      class: 'stretch', value: cs().tintMode,
      options: [{ value: 'none', label: t('Original') }, { value: 'hsl', label: t('Shift hue') }, { value: 'colorize', label: t('Colourise') }],
      onChange: (v) => { setChar({ tintMode: v }); refreshTint(); },
    });
    const hue = nf('hue', { label: t('Hue'), min: -180, max: 180, step: 1, unit: '°', slider: true });
    const sat = nf('sat', { label: t('Saturation'), min: -100, max: 100, step: 1, unit: '%', slider: true });
    const light = nf('light', { label: t('Lightness'), min: -100, max: 100, step: 1, unit: '%', slider: true });
    const tcol = colorField({ label: t('Colour'), value: cs().tintColor, onInput: (v) => setChar({ tintColor: v }, 'char:tc'), onChange: (v) => setChar({ tintColor: v }, 'char:tc') });
    const tamt = nf('tintAmount', { label: t('Amount'), min: 0, max: 100, step: 1, unit: '%', slider: true });
    const op = nf('opacity', { label: t('Opacity'), iconName: 'droplet', min: 0, max: 100, step: 1, unit: '%', slider: true });
    function refreshTint() {
      const m = cs().tintMode;
      tint.setValue(m);
      for (const x of [hue, sat, light]) x.style.display = m === 'hsl' ? '' : 'none';
      for (const x of [tcol, tamt]) x.style.display = m === 'colorize' ? '' : 'none';
      tcol.setValue(cs().tintColor);
    }
    reg(refreshTint);
    body.appendChild(section({ id: 'ch-color', title: t('Colour'), iconName: 'palette' },
      h('p.hint', t('Recolour the glyph artwork itself: select letters while typing to colour just those.')), tint, hue, sat, light, tcol, tamt, op));
  }

  // ---------- paragraph ----------
  function buildParagraph(layer) {
    const ps = () => currentParaStyle(layer) || {};
    const align = pills({
      class: 'stretch', value: ps().align,
      options: [{ value: 'left', icon: 'alignLeft', title: t('Align left') }, { value: 'center', icon: 'alignCenter', title: t('Centre') }, { value: 'right', icon: 'alignRight', title: t('Align right') }, { value: 'justify', icon: 'alignJustify', title: t('Justify') }],
      onChange: (v) => { setPara({ align: v }); jl.style.display = v === 'justify' ? '' : 'none'; },
    });
    const jl = pills({
      class: 'stretch', value: ps().justifyLast,
      options: [{ value: 'start', label: t('Last line start') }, { value: 'center', label: t('Centre') }, { value: 'end', label: t('End') }, { value: 'full', label: t('All lines') }],
      onChange: (v) => setPara({ justifyLast: v }),
    });
    const dir = pills({
      class: 'stretch', value: ps().direction,
      options: [{ value: 'auto', label: t('Auto') }, { value: 'ltr', label: 'LTR ⟶' }, { value: 'rtl', label: '⟵ RTL' }],
      onChange: (v) => setPara({ direction: v }),
    });
    reg(() => { const p = ps(); align.setValue(p.align); jl.setValue(p.justifyLast); jl.style.display = p.align === 'justify' ? '' : 'none'; dir.setValue(p.direction); });
    body.appendChild(section({ id: 'pa-align', title: t('Alignment & direction'), iconName: 'alignLeft' }, align, jl,
      h('div.field', h('span', t('Text direction')), dir), h('p.hint', t('Auto picks right-to-left when a paragraph starts with Hebrew.'))));
    const nf = (key, o) => {
      const f = numberField({ ...o, onInput: (v) => setPara({ [key]: v }, 'para:' + key), onChange: (v) => setPara({ [key]: v }, 'para:' + key) });
      reg(() => f.setValue(ps()[key]));
      return f;
    };
    body.appendChild(section({ id: 'pa-indent', title: t('Indents'), iconName: 'indentInc' },
      nf('indentStart', { label: t('Start indent'), iconName: 'indentInc', min: -2000, max: 4000, unit: 'px' }),
      nf('indentEnd', { label: t('End indent'), iconName: 'indentDec', min: -2000, max: 4000, unit: 'px' }),
      nf('firstIndent', { label: t('First line'), iconName: 'pilcrow', min: -2000, max: 4000, unit: 'px' })));
    const lm = pills({
      class: 'stretch', value: ps().lineMode,
      options: [{ value: 'multiple', label: t('Multiple') }, { value: 'exact', label: t('Exactly') }, { value: 'atLeast', label: t('At least') }],
      onChange: (v) => { setPara({ lineMode: v, lineValue: v === 'multiple' ? 1 : Math.round((currentCharStyle(layer).size || 120) * 1.2) }); },
    });
    const lv = numberField({
      label: t('Line spacing'), iconName: 'arrowsV', min: 0, max: 5000, step: 0.05,
      onInput: (v) => setPara({ lineValue: v }, 'para:lv'), onChange: (v) => setPara({ lineValue: v }, 'para:lv'),
    });
    reg(() => { const p = ps(); lm.setValue(p.lineMode); lv.setValue(p.lineValue); });
    body.appendChild(section({ id: 'pa-space', title: t('Spacing'), iconName: 'arrowsV' }, lm, lv,
      nf('spaceBefore', { label: t('Space before'), iconName: 'spaceBefore', min: -2000, max: 4000, unit: 'px' }),
      nf('spaceAfter', { label: t('Space after'), iconName: 'spaceAfter', min: -2000, max: 4000, unit: 'px' }),
      nf('wordSpacing', { label: t('Word spacing'), iconName: 'moveH', min: 0, max: 1000, unit: '%', slider: true, sliderMax: 300 })));
    const mode = pills({
      class: 'stretch', value: layer.box.mode,
      options: [{ value: 'point', label: t('Point text'), icon: 'textCursor' }, { value: 'box', label: t('Area text'), icon: 'wrap' }],
      onChange: (v) => {
        checkpoint('project', 'Text box');
        if (v === 'box' && layer.box.mode !== 'box') {
          const lay = renderStateLayoutWidth(layer);
          layer.box.width = Math.max(200, Math.round(lay));
        }
        layer.box.mode = v; projectChanged('layout', layer); refresh();
      },
    });
    const bw = numberField({
      label: t('Box width'), iconName: 'arrowsH', min: 20, max: 20000, unit: 'px', value: layer.box.width,
      onInput: (v) => { checkpoint('project', 'Text box', 'boxw'); layer.box.width = v; projectChanged('layout', layer); }, onChange: () => {},
    });
    reg(() => { mode.setValue(layer.box.mode); bw.setValue(layer.box.width); bw.style.display = layer.box.mode === 'box' ? '' : 'none'; });
    body.appendChild(section({ id: 'pa-box', title: t('Text box'), iconName: 'wrap' }, mode, bw,
      h('p.hint', t('Point text grows as you type. Area text wraps inside a box you can resize from its side handles.'))));
  }

  // ---------- effects ----------
  function buildEffects(layer) {
    const stylesGrid = h('div.style-grid');
    for (const sp of STYLE_PRESETS) {
      const c = h('canvas');
      const effects = sp.effects.map(([type, o]) => newEffect(type, o));
      const chip = h('button.style-chip', { type: 'button', title: L(sp.id), on: { click: () => {
        checkpoint('project', 'Apply style');
        layer.effects = sp.effects.map(([type, o]) => newEffect(type, o));
        projectChanged('render', layer); build();
      } } }, c, h('span', L(sp.id)));
      stylesGrid.appendChild(chip);
      requestAnimationFrame(() => drawSample(c, 'Ab', { fontId: layer.doc.styles[0]?.font, height: 30, maxWidth: 80, effects: scaleEffects(effects, 0.35), fit: true }));
    }
    const clearBtn = button({ label: t('Remove all'), icon: 'trash', kind: 'ghost', onClick: () => { checkpoint('project', 'Remove effects'); layer.effects = []; projectChanged('render', layer); build(); } });
    body.appendChild(section({ id: 'fx-styles', title: t('Styles'), iconName: 'sparkles' }, stylesGrid, h('p.hint', t('A style replaces the layer’s effects. Fine-tune each one below.'))));

    const addBtn = button({ label: t('Add effect'), icon: 'plus', kind: 'primary', onClick: (e) => {
      menu(e.currentTarget, EFFECT_ORDER.map((type) => ({ label: L(type), icon: EFFECTS[type].icon, onClick: () => {
        checkpoint('project', 'Add effect');
        layer.effects.unshift(newEffect(type));
        projectChanged('render', layer); build();
      } })));
    } });
    const list = h('div.fx-list');
    layer.effects.forEach((fx, i) => list.appendChild(effectCard(layer, fx, i)));
    if (!layer.effects.length) list.appendChild(h('p.hint', t('No effects yet. Add a stroke, shadow, glow, bevel, 3D extrude and more. The top effect in the list sits on top.')));
    body.appendChild(section({ id: 'fx-list', title: t('Effects'), iconName: 'layers2', badge: String(layer.effects.length), actions: [clearBtn] }, addBtn, list));
  }

  function effectCard(layer, fx, i) {
    const def = EFFECTS[fx.type];
    const openKey = 'fxopen:' + fx.id;
    let open = sessionStorage.getItem?.(openKey) !== '0';
    const bodyEl = h('div.fx-body');
    const nameBtn = h('button.name', { type: 'button', on: { click: () => { open = !open; try { sessionStorage.setItem(openKey, open ? '1' : '0'); } catch { /* ignore */ } bodyEl.hidden = !open; } } }, icon(def.icon, 15), L(fx.type));
    const vis = iconButton(fx.enabled ? 'eye' : 'eyeOff', t('Show / hide'), () => { checkpoint('project', 'Toggle effect'); fx.enabled = !fx.enabled; projectChanged('render', layer); build(); });
    const up = iconButton('chevronUp', t('Move up'), () => move(-1), { disabled: i === 0 });
    const down = iconButton('chevronDown', t('Move down'), () => move(1), { disabled: i === layer.effects.length - 1 });
    const dup = iconButton('copy', t('Duplicate'), () => { checkpoint('project', 'Duplicate effect'); layer.effects.splice(i, 0, { ...JSON.parse(JSON.stringify(fx)), id: newEffect(fx.type).id }); projectChanged('render', layer); build(); });
    const del = iconButton('trash', t('Delete'), () => { checkpoint('project', 'Delete effect'); layer.effects.splice(i, 1); projectChanged('render', layer); build(); });
    function move(d) { checkpoint('project', 'Reorder effects'); const [x] = layer.effects.splice(i, 1); layer.effects.splice(i + d, 0, x); projectChanged('render', layer); build(); }
    const card = h('div.fx-item', { class: fx.enabled ? '' : 'off' }, h('div.fx-head', nameBtn, vis, up, down, dup, del), bodyEl);
    bodyEl.hidden = !open;
    const set = (k, v, live) => { checkpoint('project', 'Edit effect', 'fx:' + fx.id + k); fx[k] = v; projectChanged('render', layer); if (!live) refresh(); };
    paramControls(def.params, fx, set, bodyEl, reg);
    return card;
  }

  // ---------- warp ----------
  function buildWarp(layer) {
    const w = layer.warp;
    const setW = (patch, key) => { checkpoint('project', 'Warp', key); Object.assign(layer.warp, patch); projectChanged('layout', layer); };
    const grid = h('div.warp-grid');
    for (const st of WARP_STYLES) {
      const chip = h('button.warp-chip', { type: 'button', class: w.style === st.id ? 'on' : '', title: L(st.id), on: { click: () => { setW({ style: st.id }); build(); } } }, warpIcon(st.id), h('span', L(st.id)));
      grid.appendChild(chip);
    }
    body.appendChild(section({ id: 'wp-style', title: t('Warp style'), iconName: 'waves' }, grid));
    if (w.style === 'none') { body.appendChild(h('p.hint', { style: { padding: '12px' } }, t('Pick a warp to bend the whole title like Photoshop’s Warp Text, or a path to set letters along a curve without distorting them.'))); return; }
    const nf = (key, o) => { const f = numberField({ ...o, value: w[key], onInput: (v) => setW({ [key]: v }, 'warp:' + key), onChange: (v) => setW({ [key]: v }, 'warp:' + key) }); reg(() => f.setValue(layer.warp[key])); return f; };
    const isPath = w.style.startsWith('path');
    const controls = [
      (() => { const f = numberField({ label: t('Bend'), iconName: 'spline', min: -100, max: 100, unit: '%', slider: true, value: Math.round(w.bend * 100), onInput: (v) => setW({ bend: v / 100 }, 'warp:bend'), onChange: (v) => setW({ bend: v / 100 }, 'warp:bend') }); reg(() => f.setValue(Math.round(layer.warp.bend * 100))); return f; })(),
    ];
    if (!isPath) {
      controls.push(
        (() => { const f = numberField({ label: t('Horizontal distortion'), min: -100, max: 100, unit: '%', slider: true, value: Math.round(w.hDistort * 100), onInput: (v) => setW({ hDistort: v / 100 }, 'warp:h'), onChange: (v) => setW({ hDistort: v / 100 }, 'warp:h') }); reg(() => f.setValue(Math.round(layer.warp.hDistort * 100))); return f; })(),
        (() => { const f = numberField({ label: t('Vertical distortion'), min: -100, max: 100, unit: '%', slider: true, value: Math.round(w.vDistort * 100), onInput: (v) => setW({ vDistort: v / 100 }, 'warp:v'), onChange: (v) => setW({ vDistort: v / 100 }, 'warp:v') }); reg(() => f.setValue(Math.round(layer.warp.vDistort * 100))); return f; })(),
        pills({ class: 'stretch', value: w.vertical ? 'v' : 'h', options: [{ value: 'h', label: t('Horizontal'), icon: 'arrowsH' }, { value: 'v', label: t('Vertical'), icon: 'arrowsV' }], onChange: (v) => setW({ vertical: v === 'v' }) }),
      );
    } else if (w.style === 'pathCircle') {
      controls.push((() => { const a = angleField({ label: t('Start angle'), value: w.pathStart, onInput: (v) => setW({ pathStart: v }, 'warp:ps'), onChange: (v) => setW({ pathStart: v }, 'warp:ps') }); return a; })());
    }
    controls.push(button({ label: t('Reset warp'), icon: 'rotateCcw', kind: 'ghost', onClick: () => { setW({ ...DEFAULT_WARP }); build(); } }));
    body.appendChild(section({ id: 'wp-params', title: t('Warp settings'), iconName: 'sliders' }, ...controls));
    void nf;
  }

  // ---------- animation ----------
  function buildAnimate(layer) {
    const a = layer.anim;
    const setA = (fn, key) => { checkpoint('project', 'Animation', key); fn(layer.anim); projectChanged('render', layer); emit('anim'); };
    const presetGrid = (kind, src, cur, onPick) => {
      const wrap = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      const none = h('button.preset', { type: 'button', class: cur === 'none' ? 'on' : '', on: { click: () => onPick('none') } }, h('small', t('Off')), t('None'));
      const cats = ['cute', 'cartoon', 'pro', 'fun'];
      const grid = h('div.preset-grid', none);
      for (const c of cats) for (const [id, p] of Object.entries(src)) if (p.cat === c) {
        grid.appendChild(h('button.preset', { type: 'button', class: cur === id ? 'on' : '', title: t(ANIM_NAMES[id] || id), on: { click: () => onPick(id) } }, h('small', L(c)), t(ANIM_NAMES[id] || id)));
      }
      wrap.appendChild(grid);
      return wrap;
    };
    const playBtn = button({ label: t('Preview'), icon: 'play', kind: 'primary', onClick: () => emit('preview-layer', layer) });
    const timing = h('div.grid2',
      timeField(t('Starts'), () => layer.anim.start, (v) => setA((x) => { x.start = Math.max(0, Math.min(v, x.end - 0.1)); }, 'anim:start')),
      timeField(t('Ends'), () => layer.anim.end, (v) => setA((x) => { x.end = Math.max(x.start + 0.1, v); if (v > state.project.duration) state.project.duration = Math.ceil(v * 10) / 10; }, 'anim:end')));
    body.appendChild(section({ id: 'an-timing', title: t('Timing'), iconName: 'timer' }, timing, playBtn,
      h('p.hint', t('The layer is visible between Starts and Ends. Its entrance plays from Starts, its exit finishes at Ends.'))));

    const phaseSection = (kind, title, iconName, src) => {
      const cfg = a[kind];
      const grid = presetGrid(kind, src, cfg.preset, (id) => { setA((x) => { x[kind].preset = id; x[kind].duration = null; x[kind].stagger = null; x[kind].unit = null; }); build(); });
      const children = [grid];
      if (cfg.preset !== 'none') {
        const p = src[cfg.preset];
        const dur = numberField({ label: t('Duration'), iconName: 'timer', min: 0.01, max: 30, step: 0.05, unit: 's', value: cfg.duration ?? p.duration, onInput: (v) => setA((x) => { x[kind].duration = v; }, 'anim:' + kind + 'd'), onChange: () => {} });
        const stg = numberField({ label: t('Stagger'), iconName: 'list', min: 0, max: 5, step: 0.005, unit: 's', value: cfg.stagger ?? p.stagger, onInput: (v) => setA((x) => { x[kind].stagger = v; }, 'anim:' + kind + 's'), onChange: () => {} });
        const unit = pills({ class: 'stretch', value: cfg.unit || p.unit, options: [{ value: 'char', label: t('Letters') }, { value: 'word', label: t('Words') }, { value: 'line', label: t('Lines') }, { value: 'all', label: t('All') }], onChange: (v) => setA((x) => { x[kind].unit = v; }) });
        const order = select({ label: t('Order'), iconName: 'shuffle', value: cfg.order || 'forward', options: ORDERS.map((o) => ({ value: o, label: t({ forward: 'First to last', backward: 'Last to first', center: 'From the centre', edges: 'From the edges', random: 'Random' }[o]) })), onChange: (v) => setA((x) => { x[kind].order = v; }) });
        children.push(h('div.grid2', dur, stg), unit, order);
        if (kind === 'in') children.push(numberField({ label: t('Delay'), iconName: 'timer', min: 0, max: 60, step: 0.05, unit: 's', value: cfg.delay || 0, onInput: (v) => setA((x) => { x.in.delay = v; }, 'anim:delay'), onChange: () => {} }));
      }
      body.appendChild(section({ id: 'an-' + kind, title, iconName, badge: cfg.preset !== 'none' ? t(ANIM_NAMES[cfg.preset] || cfg.preset) : null }, ...children));
    };
    phaseSection('in', t('Transition in'), 'play', IN_PRESETS);
    // loop
    const loopGrid = presetGrid('loop', LOOP_PRESETS, a.loop.preset, (id) => { setA((x) => { x.loop.preset = id; }); build(); });
    const loopKids = [loopGrid];
    if (a.loop.preset !== 'none') {
      loopKids.push(h('div.grid2',
        numberField({ label: t('Period'), iconName: 'repeat', min: 0.1, max: 20, step: 0.05, unit: 's', value: a.loop.period, onInput: (v) => setA((x) => { x.loop.period = v; }, 'anim:lp'), onChange: () => {} }),
        numberField({ label: t('Strength'), iconName: 'zap', min: 0, max: 5, step: 0.05, value: a.loop.amount, onInput: (v) => setA((x) => { x.loop.amount = v; }, 'anim:la'), onChange: () => {} })));
    }
    body.appendChild(section({ id: 'an-loop', title: t('While on screen (loop)'), iconName: 'repeat', badge: a.loop.preset !== 'none' ? t(ANIM_NAMES[a.loop.preset]) : null }, ...loopKids));
    phaseSection('out', t('Transition out'), 'skipBack', OUT_PRESETS);
  }

  function timeField(label, get, setv) {
    const f = numberField({ label, iconName: 'timer', min: 0, max: 600, step: 0.05, unit: 's', value: get(), onInput: setv, onChange: setv });
    reg(() => f.setValue(get()));
    return f;
  }

  // ---------- layer ----------
  function buildLayer(layer) {
    const setL = (patch, key, what = 'transform') => { checkpoint('project', 'Layer', key); Object.assign(layer, patch); projectChanged(what, layer); };
    const nf = (key, o, what) => { const f = numberField({ ...o, value: layer[key], onInput: (v) => setL({ [key]: v }, 'layer:' + key, what), onChange: (v) => setL({ [key]: v }, 'layer:' + key, what) }); reg(() => f.setValue(layer[key])); return f; };
    const name = h('input.text-input', { type: 'text', value: layer.name, 'aria-label': t('Layer name'), on: { change: (e) => setL({ name: e.target.value, autoName: false }, null, 'render'), keydown: (e) => e.stopPropagation() } });
    const ab = state.project.artboard;
    const alignBtns = h('div.row-ctl',
      button({ label: t('Centre horizontally'), icon: 'arrowsH', onClick: () => centerLayer(layer, 'x') }),
      button({ label: t('Centre vertically'), icon: 'arrowsV', onClick: () => centerLayer(layer, 'y') }));
    let link = true;
    const linkBtn = iconButton('link', t('Keep proportions'), () => { link = !link; linkBtn.classList.toggle('on', link); });
    linkBtn.classList.add('on');
    const sx = numberField({ label: 'W', iconName: 'arrowsH', min: -2000, max: 2000, unit: '%', value: layer.scaleX, onInput: (v) => { const r = layer.scaleX ? v / layer.scaleX : 1; setL(link ? { scaleX: v, scaleY: Math.round(layer.scaleY * r * 10) / 10 } : { scaleX: v }, 'layer:scale'); }, onChange: () => {} });
    const sy = numberField({ label: 'H', iconName: 'arrowsV', min: -2000, max: 2000, unit: '%', value: layer.scaleY, onInput: (v) => { const r = layer.scaleY ? v / layer.scaleY : 1; setL(link ? { scaleY: v, scaleX: Math.round(layer.scaleX * r * 10) / 10 } : { scaleY: v }, 'layer:scale'); }, onChange: () => {} });
    reg(() => { sx.setValue(layer.scaleX); sy.setValue(layer.scaleY); });
    const rot = angleField({ label: t('Rotation'), value: layer.rotation, onInput: (v) => setL({ rotation: v }, 'layer:rot'), onChange: (v) => setL({ rotation: v }, 'layer:rot') });
    reg(() => rot.setValue(layer.rotation));
    body.appendChild(section({ id: 'ly-transform', title: t('Transform'), iconName: 'move' },
      h('label.field', h('span', t('Name')), name),
      h('div.grid2', nf('x', { label: 'X', min: -100000, max: 100000, unit: 'px' }), nf('y', { label: 'Y', min: -100000, max: 100000, unit: 'px' })),
      h('div.row', h('div.grid2', { style: { flex: 1 } }, sx, sy), linkBtn),
      rot,
      button({ label: t('Flip horizontally'), icon: 'flipH', onClick: () => setL({ scaleX: -layer.scaleX }, null) }),
      alignBtns));
    const blend = select({ label: t('Blend mode'), iconName: 'blend', value: layer.blend, options: BLEND_MODES.map((b) => ({ value: b, label: t(blendName(b)) })), onChange: (v) => setL({ blend: v }, null, 'render') });
    body.appendChild(section({ id: 'ly-look', title: t('Appearance'), iconName: 'droplet' },
      nf('opacity', { label: t('Opacity'), iconName: 'droplet', min: 0, max: 100, unit: '%', slider: true }, 'render'), blend,
      toggle({ label: t('Visible'), iconName: 'eye', value: layer.visible, onChange: (v) => setL({ visible: v }, null, 'render') }),
      toggle({ label: t('Locked'), iconName: 'lock', value: layer.locked, onChange: (v) => setL({ locked: v }, null, 'render') })));
    void ab;
  }

  function centerLayer(layer, axis) {
    checkpoint('project', 'Align');
    const ab = state.project.artboard;
    const r = renderStateRect(layer);
    if (!r) return;
    if (axis === 'x') layer.x += ab.w / 2 - (r.x + r.w / 2);
    else layer.y += ab.h / 2 - (r.y + r.h / 2);
    projectChanged('transform', layer);
  }

  const offs = [
    on('selection', () => refresh()), on('project', () => refresh()), on('edit', () => refresh()), on('fonts', () => build()), on('font', () => refresh()),
  ];
  build();
  return { el, destroy() { offs.forEach((f) => f()); }, build };
}

// helpers resolved lazily to avoid an import cycle with the stage
import { getLayout, renderLayer, layerMatrix } from '../../render/layer.js';
function renderStateLayoutWidth(layer) { return getLayout(layer).width + 40; }
function renderStateRect(layer) {
  const r = renderLayer(layer, state.time, 1);
  if (!r) return null;
  const M = layerMatrix(layer), rc = r.contentRect;
  const pts = [[rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x, rc.y + rc.h], [rc.x + rc.w, rc.y + rc.h]].map(([x, y]) => M.transformPoint(new DOMPoint(x, y)));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function blendName(b) {
  return { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'Colour dodge', 'color-burn': 'Colour burn', 'hard-light': 'Hard light', 'soft-light': 'Soft light', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Colour', luminosity: 'Luminosity' }[b] || b;
}

/** Scale pixel-sized effect params (for small previews). */
export function scaleEffects(effects, k) {
  const keys = ['size', 'distance', 'depth', 'length', 'gap', 'radius', 'soft', 'soften'];
  return effects.map((e) => { const c = { ...e }; for (const key of keys) if (typeof c[key] === 'number') c[key] *= k; return c; });
}

/** Build controls for a schema of params into `parent`. set(key, value, live). */
export function paramControls(params, obj, set, parent, reg) {
  for (const p of params) {
    let ctl;
    const label = L(p.key);
    if (p.type === 'number') ctl = numberField({ label, min: p.min, max: p.max, step: p.step || 1, unit: p.unit, slider: p.slider, sliderMin: p.sliderMin, sliderMax: p.sliderMax, value: obj[p.key], onInput: (v) => set(p.key, v, true), onChange: (v) => set(p.key, v, true) });
    else if (p.type === 'angle') ctl = angleField({ label, value: obj[p.key], onInput: (v) => set(p.key, v, true), onChange: (v) => set(p.key, v, true) });
    else if (p.type === 'color') ctl = colorField({ label, value: obj[p.key], onInput: (v) => set(p.key, v, true), onChange: (v) => set(p.key, v, true) });
    else if (p.type === 'gradient') ctl = gradientField({ stops: obj[p.key], onInput: (v) => set(p.key, v, true), onChange: (v) => set(p.key, v, true) });
    else if (p.type === 'pills') ctl = pills({ class: 'stretch', value: obj[p.key], options: p.options.map((o) => ({ value: o, label: L(o) })), onChange: (v) => set(p.key, v, false) });
    else if (p.type === 'toggle') ctl = toggle({ label, value: obj[p.key], onChange: (v) => set(p.key, v, false) });
    else if (p.type === 'blend') ctl = select({ label, value: obj[p.key], options: BLEND_MODES.map((b) => ({ value: b, label: t(blendName(b)) })), onChange: (v) => set(p.key, v, true) });
    if (!ctl) continue;
    if (p.when) {
      const c = ctl;
      reg(() => { c.style.display = p.when(obj) ? '' : 'none'; });
    }
    parent.appendChild(ctl);
  }
}

/** Small SVG showing how a warp bends a rectangle. */
export function warpIcon(style) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-26 -15 52 30');
  const a = 0.4;
  const pts = [];
  const map = (u, v) => {
    if (style.startsWith('path') || style === 'none') return [u * 20, v * 20];
    const [x, y] = warpPoint(style, u, v * a, a, { bend: 0.6, hDistort: 0, vDistort: 0 });
    return [x * 20, y * 20];
  };
  if (style.startsWith('path')) {
    const path = document.createElementNS(NS, 'path');
    const d = style === 'pathCircle' ? 'M -11 0 a 11 11 0 1 1 22 0 a 11 11 0 1 1 -22 0' : style === 'pathArc' ? 'M -20 8 Q 0 -14 20 8' : 'M -20 2 C -10 -12 -4 -12 0 2 S 10 16 20 2';
    path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(path);
    return svg;
  }
  for (let k = 0; k <= 16; k++) pts.push(map(-1 + k / 8, -1));
  for (let k = 0; k <= 16; k++) pts.push(map(1, -1 + k / 8));
  for (let k = 16; k >= 0; k--) pts.push(map(-1 + k / 8, 1));
  for (let k = 16; k >= 0; k--) pts.push(map(-1, -1 + k / 8));
  const poly = document.createElementNS(NS, 'polygon');
  poly.setAttribute('points', pts.filter((_, i) => i % 1 === 0).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
  poly.setAttribute('fill', 'var(--accent-soft)'); poly.setAttribute('stroke', 'currentColor'); poly.setAttribute('stroke-width', '1.5');
  svg.appendChild(poly);
  return svg;
}

export { getFont };
