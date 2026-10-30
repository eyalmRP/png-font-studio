// Envelope warp rendering: the text canvas is drawn through a deformed triangle mesh (WebGL, 2D fallback).
import { warpLocal } from '../core/warp.js';
import { makeCanvas } from './glyphs.js';

let gl = null, glCanvas = null, prog = null, isGL2 = false, glFailed = false, maxTex = 4096;

function initGL() {
  if (gl || glFailed) return gl;
  try {
    glCanvas = document.createElement('canvas');
    const attrs = { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: true };
    gl = glCanvas.getContext('webgl2', attrs);
    isGL2 = !!gl;
    if (!gl) gl = glCanvas.getContext('webgl', attrs);
    if (!gl) { glFailed = true; return null; }
    const vs = `attribute vec2 p; attribute vec2 uv; varying vec2 v; void main(){ v = uv; gl_Position = vec4(p, 0.0, 1.0); }`;
    const fs = `precision mediump float; varying vec2 v; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, v); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { glFailed = true; gl = null; return null; }
    maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  } catch { glFailed = true; gl = null; }
  return gl;
}

function meshFor(srcRect, frame, warp, scale) {
  const aspect = srcRect.w / Math.max(1, srcRect.h);
  const cols = Math.max(12, Math.min(220, Math.round(Math.sqrt(srcRect.w * scale) * 2.2)));
  const rows = Math.max(6, Math.min(120, Math.round(cols / Math.max(0.5, aspect) * 0.8)));
  const pts = new Float32Array((cols + 1) * (rows + 1) * 2);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const i = (r * (cols + 1) + c) * 2;
    const [wx, wy] = warpLocal(frame, warp, srcRect.x + (c / cols) * srcRect.w, srcRect.y + (r / rows) * srcRect.h);
    pts[i] = wx; pts[i + 1] = wy;
    if (wx < x0) x0 = wx; if (wx > x1) x1 = wx; if (wy < y0) y0 = wy; if (wy > y1) y1 = wy;
  }
  return { cols, rows, pts, rect: { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) } };
}

/**
 * src: canvas holding srcRect (local units) at `scale` px per unit. Returns { canvas, rect } with the warped result.
 */
export function warpCanvas(src, srcRect, frame, warp, scale) {
  const mesh = meshFor(srcRect, frame, warp, scale);
  const W = Math.ceil(mesh.rect.w * scale) + 2, H = Math.ceil(mesh.rect.h * scale) + 2;
  const rect = { x: mesh.rect.x - 1 / scale, y: mesh.rect.y - 1 / scale, w: W / scale, h: H / scale };
  const out = makeCanvas(W, H);
  const g = initGL();
  if (g && W <= maxTex && H <= maxTex && src.width <= maxTex && src.height <= maxTex) {
    drawGL(g, src, mesh, rect, W, H);
    out.getContext('2d').drawImage(glCanvas, 0, 0);
  } else {
    draw2D(out.getContext('2d'), src, mesh, rect, scale);
  }
  return { canvas: out, rect };
}

function drawGL(g, src, mesh, rect, W, H) {
  glCanvas.width = W; glCanvas.height = H;
  g.viewport(0, 0, W, H);
  g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.useProgram(prog);
  const { cols, rows, pts } = mesh;
  const pos = [], uv = [];
  const P = (c, r) => { const i = (r * (cols + 1) + c) * 2; return [((pts[i] - rect.x) / rect.w) * 2 - 1, 1 - ((pts[i + 1] - rect.y) / rect.h) * 2]; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = P(c, r), b = P(c + 1, r), d = P(c, r + 1), e = P(c + 1, r + 1);
    const ua = [c / cols, r / rows], ub = [(c + 1) / cols, r / rows], ud = [c / cols, (r + 1) / rows], ue = [(c + 1) / cols, (r + 1) / rows];
    pos.push(...a, ...b, ...e, ...a, ...e, ...d);
    uv.push(...ua, ...ub, ...ue, ...ua, ...ue, ...ud);
  }
  const tex = g.createTexture();
  g.bindTexture(g.TEXTURE_2D, tex);
  g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  if (isGL2) { g.generateMipmap(g.TEXTURE_2D); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); }
  else g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  const buf = (data, name) => {
    const b = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, b);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STATIC_DRAW);
    const loc = g.getAttribLocation(prog, name);
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    return b;
  };
  const b1 = buf(pos, 'p'), b2 = buf(uv, 'uv');
  g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
  g.drawArrays(g.TRIANGLES, 0, pos.length / 2);
  g.deleteBuffer(b1); g.deleteBuffer(b2); g.deleteTexture(tex);
}

function draw2D(ctx, src, mesh, rect, scale) {
  const { cols, rows, pts } = mesh;
  const P = (c, r) => { const i = (r * (cols + 1) + c) * 2; return [(pts[i] - rect.x) * scale, (pts[i + 1] - rect.y) * scale]; };
  const T = (c, r) => [(c / cols) * src.width, (r / rows) * src.height];
  const tri = (s0, s1, s2, d0, d1, d2) => {
    ctx.save();
    const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
    const ex = (p) => [p[0] + (p[0] - cx) * 0.04, p[1] + (p[1] - cy) * 0.04];
    ctx.beginPath(); ctx.moveTo(...ex(d0)); ctx.lineTo(...ex(d1)); ctx.lineTo(...ex(d2)); ctx.closePath(); ctx.clip();
    const den = s0[0] * (s2[1] - s1[1]) - s1[0] * s2[1] + s2[0] * s1[1] + (s1[0] - s2[0]) * s0[1];
    if (Math.abs(den) < 1e-9) { ctx.restore(); return; }
    const a = -(s0[1] * (d2[0] - d1[0]) - s1[1] * d2[0] + s2[1] * d1[0] + (s1[1] - s2[1]) * d0[0]) / den;
    const b = -(s0[1] * (d2[1] - d1[1]) - s1[1] * d2[1] + s2[1] * d1[1] + (s1[1] - s2[1]) * d0[1]) / den;
    const c = (s0[0] * (d2[0] - d1[0]) - s1[0] * d2[0] + s2[0] * d1[0] + (s1[0] - s2[0]) * d0[0]) / den;
    const d = (s0[0] * (d2[1] - d1[1]) - s1[0] * d2[1] + s2[0] * d1[1] + (s1[0] - s2[0]) * d0[1]) / den;
    const e = (s0[0] * (s2[1] * d1[0] - s1[1] * d2[0]) + s0[1] * (s1[0] * d2[0] - s2[0] * d1[0]) + (s2[0] * s1[1] - s1[0] * s2[1]) * d0[0]) / den;
    const f = (s0[0] * (s2[1] * d1[1] - s1[1] * d2[1]) + s0[1] * (s1[0] * d2[1] - s2[0] * d1[1]) + (s2[0] * s1[1] - s1[0] * s2[1]) * d0[1]) / den;
    ctx.setTransform(a, b, c, d, e, f);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    tri(T(c, r), T(c + 1, r), T(c + 1, r + 1), P(c, r), P(c + 1, r), P(c + 1, r + 1));
    tri(T(c, r), T(c + 1, r + 1), T(c, r + 1), P(c, r), P(c + 1, r + 1), P(c, r + 1));
  }
}
