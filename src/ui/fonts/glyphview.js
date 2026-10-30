// Drawing a glyph on its guides (sheet cells and the large inspector preview).
import { imageToCanvas } from '../../render/glyphs.js';
import { glyphAdvance } from '../../core/font.js';

export function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }

/**
 * Draw glyph g of font into canvas (CSS size w×h). guides: { baseline, cap, xheight, ascender, descender, bounds, advance }.
 * Returns the transform info { scale, originX, baselineY } for hit testing.
 */
export function drawGlyphOnGuides(canvas, font, g, guides, { w, h, pad = 10, zoom = 1, empty = null } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = font.metrics;
  const top = Math.max(m.ascender, m.capHeight) * 1.12, bottom = m.descender * 1.35 + m.capHeight * 0.06;
  const span = top + bottom;
  const scale = ((h - pad * 2) / span) * zoom;
  const baselineY = pad + top * scale + (h - pad * 2 - span * scale) / 2;
  const adv = g ? glyphAdvance(font, g) : font.spacing.space;
  const originX = (w - adv * scale) / 2;
  const line = (y, color, dash) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash ? [3, 3] : []);
    ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); ctx.stroke();
  };
  ctx.globalAlpha = 0.85;
  if (guides.ascender) line(baselineY - m.ascender * scale, css('--guide-asc'), true);
  if (guides.cap) line(baselineY - m.capHeight * scale, css('--guide-cap'));
  if (guides.xheight) line(baselineY - m.xHeight * scale, css('--guide-x'));
  if (guides.descender) line(baselineY + m.descender * scale, css('--guide-desc'), true);
  if (guides.baseline) line(baselineY, css('--guide-base'));
  if (guides.advance) {
    ctx.strokeStyle = css('--muted'); ctx.setLineDash([2, 3]);
    for (const x of [originX, originX + adv * scale]) { ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
  if (g && g.image) {
    const gx = originX + g.lsb * scale, gy = baselineY - g.baseline * g.scale * scale;
    const gw = g.image.width * g.scale * scale, gh = g.image.height * g.scale * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageToCanvas(g.image), gx, gy, gw, gh);
    if (guides.bounds) { ctx.strokeStyle = css('--cyan'); ctx.setLineDash([2, 2]); ctx.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1); ctx.setLineDash([]); }
  } else if (empty) {
    ctx.fillStyle = css('--muted');
    ctx.globalAlpha = 0.45;
    ctx.font = `${Math.round(m.capHeight * scale)}px ${css('--font-ui')}`;
    ctx.textAlign = 'center';
    ctx.fillText(empty, w / 2, baselineY);
    ctx.globalAlpha = 1;
  }
  return { scale, originX, baselineY, dpr };
}
