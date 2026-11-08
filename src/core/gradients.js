// Gradient presets: the colour transitions the sheet prompts ask for, so a title or a font recolour can use the
// same ones. Stops run left to right as the prompts describe them; `opacity` is 0..1 (1 when left out).

const even = (...colors) => colors.map((color, i) => ({ pos: i / (colors.length - 1), color, opacity: 1 }));

export const GRADIENT_PRESETS = [
  { name: 'Yellow to pink', stops: even('#f6d862', '#f4c952', '#f0ad60', '#eb7c9a') },
  { name: 'Blue to pink', stops: even('#476df7', '#4f69f3', '#7761f3', '#ca74db') },
  { name: 'Mint to blue', stops: even('#84eeae', '#75e0b3', '#67c8cf', '#5e9af3') },
  { name: 'Pink to purple', stops: even('#e98ac4', '#e376b9', '#ca66c0', '#985ee3') },
  { name: 'Purple to pink', stops: even('#8359f2', '#9562f1', '#b46de3', '#e17bc7') },
];

/** A stop's opacity (0..1); stops saved before opacity existed are fully opaque. */
export const stopOpacity = (s) => (s.opacity == null ? 1 : Math.min(1, Math.max(0, s.opacity)));

/** CSS colour for a stop: hex, with alpha when it is see-through. */
export function stopCss(s) {
  const a = stopOpacity(s);
  if (a >= 1) return s.color;
  const n = parseInt(String(s.color).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+a.toFixed(3)})`;
}

/** CSS linear-gradient for a list of stops, left to right. */
export function gradientCss(stops, angle = 90) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  return `linear-gradient(${angle}deg, ${sorted.map((s) => `${stopCss(s)} ${+(s.pos * 100).toFixed(2)}%`).join(', ')})`;
}
