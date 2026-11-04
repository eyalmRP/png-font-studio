// Records a guide video from the real app, frame by frame: the page clock is paused and stepped one frame at a time,
// so cursor moves, the app's own animations and the narration line up at a steady 30 fps however long a capture
// takes. A "camera" zooms by capturing a smaller area of the page at a higher scale (re-rendered, not enlarged).
// Captions are burned in afterwards, so the camera never crops them.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export const FPS = 30;
export const VIEW = { w: 1280, h: 800 };
export const OUT = { w: 1920, h: 1200 };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;

/** Narration voice: one long-lived Kokoro process (scripts/guide/tts.py). */
export class Voice {
  constructor({ python, cacheDir }) {
    this.cacheDir = cacheDir;
    fs.mkdirSync(cacheDir, { recursive: true });
    this.proc = spawn(python, ['-I', path.join(path.dirname(new URL(import.meta.url).pathname), 'tts.py')], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
    this.lines = readline.createInterface({ input: this.proc.stdout });
    this.waiting = [];
    this.lines.on('line', (l) => this.waiting.shift()(JSON.parse(l)));
  }
  speak(text) {
    const key = Buffer.from(text).toString('base64url').slice(0, 40) + '-' + simpleHash(text + (process.env.KOKORO_VOICE || 'af_heart'));
    const out = path.join(this.cacheDir, key + '.wav');
    return new Promise((resolve) => { this.waiting.push(resolve); this.proc.stdin.write(JSON.stringify({ text, out }) + '\n'); });
  }
  close() { this.proc.stdin.end(); }
}
function simpleHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export class Recorder {
  constructor(page, cdp, voice, { name, title, outDir, workDir }) {
    Object.assign(this, { page, cdp, voice, name, title, outDir, workDir });
    this.f = 0;
    this.cues = []; // { t, d, text, wav }
    this.chapters = [];
    this.sayEnd = 0;
    this.cam = { from: full(), to: full(), f0: 0, f1: 0 };
    this.mouse = { x: VIEW.w / 2, y: VIEW.h / 2 };
    fs.mkdirSync(workDir, { recursive: true });
    // PFS_GUIDE_DRAFT=1: run the scene without capturing frames, to check its steps quickly
    this.draft = !!process.env.PFS_GUIDE_DRAFT;
    this.raw = path.join(workDir, `${name}.raw.mp4`);
    if (this.draft) return;
    this.enc = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-vf', `scale=${OUT.w}:${OUT.h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', this.raw], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.encDone = new Promise((res, rej) => this.enc.on('exit', (c) => (c ? rej(new Error('ffmpeg exited ' + c)) : res())));
  }

  get t() { return this.f / FPS; }

  // ---------- time ----------
  async frame() {
    const ms = Math.round((this.f + 1) * 1000 / FPS) - Math.round(this.f * 1000 / FPS);
    await this.page.clock.runFor(ms);
    if (this.draft) { this.f++; return; }
    const c = this.cameraAt(this.f);
    const shot = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip: { x: c.x, y: c.y, width: c.w, height: c.h, scale: OUT.w / c.w } });
    const buf = Buffer.from(shot.data, 'base64');
    if (!this.enc.stdin.write(buf)) await new Promise((r) => this.enc.stdin.once('drain', r));
    this.f++;
  }
  async hold(sec) { const n = Math.round(sec * FPS); for (let i = 0; i < n; i++) await this.frame(); }
  /** Step frames until the page predicate is true (for work the app does in the background). */
  async until(fn, arg, maxSec = 20) {
    for (let i = 0; i < maxSec * FPS; i++) { if (await this.page.evaluate(fn, arg)) return true; await this.frame(); }
    throw new Error('until: timed out');
  }

  // ---------- narration ----------
  /** Start a line of narration (and its caption) now; returns at once, so actions can run while it is spoken. */
  async say(text) {
    if (this.sayEnd > this.f) await this.hold((this.sayEnd - this.f) / FPS); // never two voices at once
    const { out, dur } = await this.voice.speak(text);
    this.cues.push({ t: this.t, d: dur, text, wav: out });
    this.sayEnd = this.f + Math.ceil(dur * FPS);
  }
  /** Wait until the current line has been spoken, plus a short pause. */
  async done(pause = 0.35) { const end = this.sayEnd + Math.round(pause * FPS); if (end > this.f) await this.hold((end - this.f) / FPS); }
  chapter(title) { this.chapters.push({ t: Math.round(this.t * 10) / 10, title }); }

  // ---------- geometry ----------
  /** A target's box in page pixels: a Playwright selector (`:has-text()`, `>> nth=` work), or a rect. */
  async rect(target) {
    if (target && typeof target === 'object' && 'w' in target) return target;
    const b = await this.page.locator(target).filter({ visible: true }).first().boundingBox({ timeout: 5000 });
    if (!b) throw new Error('not found: ' + target);
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }
  async union(...targets) {
    const rs = await Promise.all(targets.map((t) => this.rect(t)));
    const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
    const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  center(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

  // ---------- camera ----------
  cameraAt(f) {
    const { from, to, f0, f1 } = this.cam;
    if (f >= f1) return to;
    const k = ease((f - f0) / Math.max(1, f1 - f0));
    return { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k) };
  }
  /** Zoom onto a target (selector, [selector, n], or rect), or back out with null. Does not wait. */
  async camera(target, { pad = 40, maxZoom = 2.2, dur = 0.9 } = {}) {
    let to = full();
    if (target) {
      const r = await this.rect(target);
      let w = Math.max(r.w + pad * 2, (r.h + pad * 2) * (VIEW.w / VIEW.h), VIEW.w / maxZoom);
      w = Math.min(VIEW.w, w);
      const h = w * VIEW.h / VIEW.w;
      const c = this.center(r);
      to = { x: Math.max(0, Math.min(VIEW.w - w, c.x - w / 2)), y: Math.max(0, Math.min(VIEW.h - h, c.y - h / 2)), w, h };
    }
    this.cam = { from: this.cameraAt(this.f), to, f0: this.f, f1: this.f + Math.round(dur * FPS) };
  }

  /** Scroll the panel holding a target so the target sits near the top (smoothly, over `dur` seconds). */
  async scrollTo(target, { dur = 0.6, offset = 12 } = {}) {
    const el = this.page.locator(target).filter({ visible: true }).first();
    const plan = await el.evaluate((e, off) => {
      let s = e.parentElement;
      while (s && !(s.scrollHeight > s.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
      if (!s) return null;
      s.dataset.dirScroll = '1';
      const to = Math.max(0, Math.min(s.scrollHeight - s.clientHeight, s.scrollTop + e.getBoundingClientRect().top - s.getBoundingClientRect().top - off));
      return { from: s.scrollTop, to };
    }, offset);
    if (!plan || Math.abs(plan.to - plan.from) < 2) return;
    const n = Math.max(1, Math.round(dur * FPS));
    for (let i = 1; i <= n; i++) {
      const y = lerp(plan.from, plan.to, ease(i / n));
      await this.page.evaluate((y) => { const s = document.querySelector('[data-dir-scroll]'); if (s) s.scrollTop = y; }, y);
      await this.frame();
    }
    await this.page.evaluate(() => document.querySelector('[data-dir-scroll]')?.removeAttribute('data-dir-scroll'));
  }

  // ---------- overlay ----------
  async spot(target, opts = {}) { const r = target ? await this.rect(target) : null; await this.page.evaluate(([r, o]) => window.__dir.spotTo(r, o), [r, opts]); }
  async ring(target, opts = {}) { return this.spot(target, { ...opts, dim: false }); }
  async callout(text, target, side = 'right') { const r = target ? await this.rect(target) : null; await this.page.evaluate(([t, r, s]) => window.__dir.callout(t, r, s), [text, r, side]); }
  async keys(list) { await this.page.evaluate((l) => window.__dir.showKeys(l), list); }
  async card(title, sub) { await this.page.evaluate(([t, s]) => window.__dir.showCard(t, s), [title, sub]); }
  async hideCard() { await this.page.evaluate(() => window.__dir.hideCard()); }

  // ---------- pointer and keys ----------
  async move(target, { dur = 0.7, dx = 0, dy = 0 } = {}) {
    const r = await this.rect(target);
    const to = { x: r.x + r.w / 2 + dx, y: r.y + r.h / 2 + dy };
    await this.glide(to, dur);
    return to;
  }
  async glide(to, dur = 0.7) {
    const from = { ...this.mouse }, n = Math.max(1, Math.round(dur * FPS));
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      this.mouse = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
      await this.page.mouse.move(this.mouse.x, this.mouse.y);
      await this.frame();
    }
  }
  async click(target, { dur = 0.7, dx = 0, dy = 0, after = 0.35, count = 1 } = {}) {
    if (target) await this.move(target, { dur, dx, dy });
    for (let i = 0; i < count; i++) {
      await this.page.mouse.down({ clickCount: i + 1 });
      await this.frame();
      await this.page.mouse.up({ clickCount: i + 1 });
      await this.frame();
    }
    await this.hold(after);
  }
  async dblclick(target, opts = {}) { return this.click(target, { ...opts, count: 2 }); }
  async drag(fromTarget, to, { dur = 1.2, steps } = {}) {
    await this.move(fromTarget, { dur: 0.6 });
    await this.page.mouse.down();
    await this.frame(); await this.frame();
    const dest = typeof to === 'function' ? to(this.mouse) : to;
    await this.glide(dest, dur);
    await this.frame();
    await this.page.mouse.up();
    await this.hold(0.3);
  }
  async type(text, { cps = 12 } = {}) {
    const per = Math.max(1, Math.round(FPS / cps));
    for (const ch of text) { await this.page.keyboard.type(ch); for (let i = 0; i < per; i++) await this.frame(); }
  }
  async press(key, { show, after = 0.3 } = {}) {
    if (show) await this.keys(show);
    await this.page.keyboard.press(key);
    await this.hold(after);
  }

  // ---------- output ----------
  /** Stop without output (a scene that failed). */
  async abort() { if (this.enc) { this.enc.stdin.end(); await this.encDone.catch(() => {}); } }

  async finish({ poster = 3.4 } = {}) {
    const dur = this.t;
    if (this.draft) return { mp4: null, dur, size: 0 };
    this.enc.stdin.end();
    await this.encDone;
    const work = this.workDir;
    // narration track: each clip at its start time
    const plan = path.join(work, `${this.name}.mix.json`), wav = path.join(work, `${this.name}.voice.wav`);
    fs.writeFileSync(plan, JSON.stringify({ duration: dur, clips: this.cues.map((c) => ({ t: c.t, wav: c.wav })) }));
    await run(process.env.PFS_GUIDE_PYTHON || 'python3', ['-I', path.join(path.dirname(new URL(import.meta.url).pathname), 'mix.py'), plan, wav]);
    // captions: each line from its start until the next starts (or a moment after it ends)
    const ass = path.join(work, `${this.name}.ass`);
    fs.writeFileSync(ass, assFile(this.cues, dur));
    fs.mkdirSync(this.outDir, { recursive: true });
    const mp4 = path.join(this.outDir, `${this.name}.mp4`);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', this.raw, '-i', wav,
      '-vf', `ass=${ass}:fontsdir=/usr/share/fonts/opentype/inter`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-tune', 'animation',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-ar', '48000', '-movflags', '+faststart', '-shortest', mp4]);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(poster), '-i', this.raw, '-frames:v', '1', '-vf', 'scale=1280:800:flags=lanczos', '-q:v', '4', path.join(this.outDir, `${this.name}.jpg`)]);
    const meta = { name: this.name, title: this.title, duration: Math.round(dur * 10) / 10, chapters: this.chapters, transcript: this.cues.map((c) => ({ t: Math.round(c.t * 10) / 10, text: c.text })) };
    fs.writeFileSync(path.join(this.outDir, `${this.name}.json`), JSON.stringify(meta, null, 1));
    return { mp4, dur, size: fs.statSync(mp4).size };
  }
}

function full() { return { x: 0, y: 0, w: VIEW.w, h: VIEW.h }; }
function run(cmd, args) { return new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit' }); p.on('exit', (c) => (c ? rej(new Error(`${cmd} exited ${c}`)) : res())); }); }

function assTime(s) {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
function assFile(cues, dur) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUT.w}
PlayResY: ${OUT.h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,44,&H00FFFFFF,&H00FFFFFF,&H28140F1A,&H28140F1A,0,0,0,0,100,100,0,0,3,18,0,2,300,300,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = cues.map((c, i) => {
    const next = cues[i + 1] ? cues[i + 1].t : dur;
    const end = Math.min(next, c.t + c.d + 0.6);
    return `Dialogue: 0,${assTime(c.t)},${assTime(end)},Cap,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`;
  });
  return head + lines.join('\n') + '\n';
}
