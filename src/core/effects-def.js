// Effect, warp and blend definitions with parameter schemas (the panels are generated from these).

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];

const RAINBOW = [{ pos: 0, color: '#ff3d8b' }, { pos: 0.5, color: '#ffd23f' }, { pos: 1, color: '#3ad0ff' }];
const SUNSET = [{ pos: 0, color: '#ffe066' }, { pos: 1, color: '#ff4d6d' }];

// placement: 'behind' draws under the text, 'content' modifies the text pixels, 'top' draws over, 'post' filters all.
export const EFFECTS = {
  stroke: {
    icon: 'outlineText', placement: (p) => (p.position === 'outside' ? 'behind' : p.position === 'inside' ? 'content' : 'top'),
    defaults: { position: 'outside', size: 10, fill: 'color', color: '#ffffff', gradient: SUNSET, gradAngle: 90, opacity: 100, soft: 0 },
    params: [
      { key: 'position', type: 'pills', options: ['outside', 'center', 'inside'] },
      { key: 'size', type: 'number', min: 0, max: 200, unit: 'px', slider: true, sliderMax: 60 },
      { key: 'fill', type: 'pills', options: ['color', 'gradient'] },
      { key: 'color', type: 'color', when: (p) => p.fill === 'color' },
      { key: 'gradient', type: 'gradient', when: (p) => p.fill === 'gradient' },
      { key: 'gradAngle', type: 'angle', when: (p) => p.fill === 'gradient' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'soft', type: 'number', min: 0, max: 50, unit: 'px', slider: true, sliderMax: 20 },
    ],
  },
  dropShadow: {
    icon: 'layers2', placement: () => 'behind',
    defaults: { color: '#1a0b2e', opacity: 55, angle: 120, distance: 14, spread: 0, size: 14, blend: 'multiply' },
    params: [
      { key: 'color', type: 'color' },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'angle', type: 'angle' },
      { key: 'distance', type: 'number', min: 0, max: 500, unit: 'px', slider: true, sliderMax: 100 },
      { key: 'spread', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'size', type: 'number', min: 0, max: 250, unit: 'px', slider: true, sliderMax: 80 },
    ],
  },
  outerGlow: {
    icon: 'glow', placement: () => 'behind',
    defaults: { color: '#ffe066', opacity: 80, spread: 8, size: 26, blend: 'screen' },
    params: [
      { key: 'color', type: 'color' },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'spread', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'size', type: 'number', min: 0, max: 250, unit: 'px', slider: true, sliderMax: 100 },
    ],
  },
  extrude: {
    icon: 'box', placement: () => 'behind',
    defaults: { depth: 24, angle: -60, mode: 'darken', color: '#5b1a8a', darken: 55, opacity: 100 },
    params: [
      { key: 'depth', type: 'number', min: 0, max: 400, unit: 'px', slider: true, sliderMax: 100 },
      { key: 'angle', type: 'angle' },
      { key: 'mode', type: 'pills', options: ['darken', 'color'] },
      { key: 'darken', type: 'number', min: 0, max: 100, unit: '%', slider: true, when: (p) => p.mode === 'darken' },
      { key: 'color', type: 'color', when: (p) => p.mode === 'color' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
    ],
  },
  longShadow: {
    icon: 'moveH', placement: () => 'behind',
    defaults: { angle: -45, length: 160, color: '#12081f', opacity: 45, fade: true },
    params: [
      { key: 'angle', type: 'angle' },
      { key: 'length', type: 'number', min: 0, max: 2000, unit: 'px', slider: true, sliderMax: 600 },
      { key: 'color', type: 'color' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'fade', type: 'toggle' },
    ],
  },
  innerShadow: {
    icon: 'contrast', placement: () => 'content',
    defaults: { color: '#000000', opacity: 45, angle: 120, distance: 6, choke: 0, size: 10, blend: 'multiply' },
    params: [
      { key: 'color', type: 'color' },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'angle', type: 'angle' },
      { key: 'distance', type: 'number', min: 0, max: 200, unit: 'px', slider: true, sliderMax: 60 },
      { key: 'choke', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'size', type: 'number', min: 0, max: 150, unit: 'px', slider: true, sliderMax: 60 },
    ],
  },
  innerGlow: {
    icon: 'dot', placement: () => 'content',
    defaults: { color: '#ffffff', opacity: 65, source: 'edge', choke: 0, size: 14, blend: 'screen' },
    params: [
      { key: 'color', type: 'color' },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'source', type: 'pills', options: ['edge', 'center'] },
      { key: 'choke', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'size', type: 'number', min: 0, max: 150, unit: 'px', slider: true, sliderMax: 60 },
    ],
  },
  bevel: {
    icon: 'spline', placement: () => 'content',
    defaults: { depth: 100, size: 12, soften: 2, angle: 120, altitude: 35, highlight: '#ffffff', highlightOpacity: 75, shadow: '#000000', shadowOpacity: 45 },
    params: [
      { key: 'depth', type: 'number', min: 1, max: 1000, unit: '%', slider: true, sliderMax: 400 },
      { key: 'size', type: 'number', min: 0, max: 150, unit: 'px', slider: true, sliderMax: 60 },
      { key: 'soften', type: 'number', min: 0, max: 16, unit: 'px', slider: true },
      { key: 'angle', type: 'angle' },
      { key: 'altitude', type: 'number', min: 0, max: 90, unit: '°', slider: true },
      { key: 'highlight', type: 'color' },
      { key: 'highlightOpacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'shadow', type: 'color' },
      { key: 'shadowOpacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
    ],
  },
  colorOverlay: {
    icon: 'droplet', placement: () => 'content',
    defaults: { color: '#ff3d8b', opacity: 100, blend: 'color' },
    params: [
      { key: 'color', type: 'color' },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
    ],
  },
  gradientOverlay: {
    icon: 'palette', placement: () => 'content',
    defaults: { gradient: RAINBOW, kind: 'linear', angle: 90, scale: 100, opacity: 100, blend: 'color' },
    params: [
      { key: 'gradient', type: 'gradient' },
      { key: 'kind', type: 'pills', options: ['linear', 'radial'] },
      { key: 'angle', type: 'angle', when: (p) => p.kind === 'linear' },
      { key: 'scale', type: 'number', min: 10, max: 300, unit: '%', slider: true },
      { key: 'blend', type: 'blend' },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
    ],
  },
  adjust: {
    icon: 'sliders', placement: () => 'content',
    defaults: { hue: 0, saturation: 0, lightness: 0, brightness: 0, contrast: 0 },
    params: [
      { key: 'hue', type: 'number', min: -180, max: 180, unit: '°', slider: true },
      { key: 'saturation', type: 'number', min: -100, max: 100, unit: '%', slider: true },
      { key: 'lightness', type: 'number', min: -100, max: 100, unit: '%', slider: true },
      { key: 'brightness', type: 'number', min: -100, max: 100, unit: '%', slider: true },
      { key: 'contrast', type: 'number', min: -100, max: 100, unit: '%', slider: true },
    ],
  },
  reflection: {
    icon: 'flipV', placement: () => 'final',
    defaults: { gap: 0, size: 55, opacity: 40, blur: 2 },
    params: [
      { key: 'gap', type: 'number', min: -200, max: 400, unit: 'px', slider: true, sliderMin: -50, sliderMax: 100 },
      { key: 'size', type: 'number', min: 5, max: 100, unit: '%', slider: true },
      { key: 'opacity', type: 'number', min: 0, max: 100, unit: '%', slider: true },
      { key: 'blur', type: 'number', min: 0, max: 40, unit: 'px', slider: true },
    ],
  },
  blur: {
    icon: 'droplet', placement: () => 'final',
    defaults: { radius: 4 },
    params: [{ key: 'radius', type: 'number', min: 0, max: 100, unit: 'px', slider: true, sliderMax: 30 }],
  },
};

export const EFFECT_ORDER = ['stroke', 'dropShadow', 'outerGlow', 'extrude', 'longShadow', 'innerShadow', 'innerGlow', 'bevel', 'colorOverlay', 'gradientOverlay', 'adjust', 'reflection', 'blur'];

let n = 0;
export function newEffect(type, overrides = {}) {
  const def = EFFECTS[type];
  return { id: `fx${Date.now().toString(36)}${n++}`, type, enabled: true, ...JSON.parse(JSON.stringify(def.defaults)), ...overrides };
}

/** Extra pixels an effect can paint outside the text (in artboard px). */
export function effectMargin(e) {
  switch (e.type) {
    case 'stroke': return e.position === 'inside' ? 0 : e.size + e.soft + 2;
    case 'dropShadow': return e.distance + e.size * 1.5 + 4;
    case 'outerGlow': return e.size * 1.6 + 4;
    case 'extrude': return e.depth + 2;
    case 'longShadow': return e.length + 2;
    case 'blur': return e.radius * 2 + 2;
    default: return 0;
  }
}

/** Ready-made effect stacks for the "Styles" picker. */
export const STYLE_PRESETS = [
  { id: 'sticker', effects: [['stroke', { size: 14, color: '#ffffff' }], ['dropShadow', { distance: 10, size: 10, opacity: 40 }]] },
  { id: 'neon', effects: [['outerGlow', { color: '#3ad0ff', size: 36, spread: 12, opacity: 90 }], ['innerGlow', { color: '#ffffff', size: 8, opacity: 50 }]] },
  { id: 'candy', effects: [['stroke', { size: 8, color: '#ffffff' }], ['stroke', { size: 18, color: '#ff3d8b' }], ['dropShadow', { distance: 12, size: 6, opacity: 50, color: '#5b1a8a' }]] },
  { id: 'comic', effects: [['stroke', { size: 10, color: '#111111' }], ['extrude', { depth: 22, angle: -45, mode: 'color', color: '#111111' }]] },
  { id: 'retro3d', effects: [['extrude', { depth: 36, angle: -50, mode: 'darken', darken: 60 }], ['dropShadow', { distance: 30, size: 30, opacity: 35 }]] },
  { id: 'gold', effects: [['gradientOverlay', { gradient: [{ pos: 0, color: '#fff1a8' }, { pos: 0.5, color: '#e0a526' }, { pos: 1, color: '#8a5a12' }], blend: 'color', angle: 90 }], ['stroke', { size: 6, color: '#5a3a08' }], ['dropShadow', { distance: 8, size: 10 }]] },
  { id: 'glowUp', effects: [['outerGlow', { color: '#ffe066', size: 50, spread: 20 }], ['stroke', { size: 6, color: '#ffffff' }]] },
  { id: 'longShadow', effects: [['longShadow', { length: 240, angle: -40, opacity: 35 }]] },
  { id: 'mirror', effects: [['reflection', { size: 60, opacity: 35, gap: 4 }]] },
  { id: 'embossed', effects: [['bevel', { size: 14, depth: 160 }], ['dropShadow', { distance: 6, size: 8, opacity: 40 }]] },
];
