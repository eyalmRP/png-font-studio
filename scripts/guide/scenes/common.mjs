// Shared openings and selectors for the guide scenes.
export const SEL = {
  still: '.mode-switch .pill[data-value="still"]',
  anim: '.mode-switch .pill[data-value="anim"]',
  titlesTab: '.mode-tabs .tab >> nth=0',
  fontsTab: '.mode-tabs .tab >> nth=1',
  exportBtn: '.export-slot .btn-primary',
  help: '.topbar button[aria-label="Help"]',
  theme: '.theme-btn',
  hello: '.layer-item:has-text("Hello")',
  tab: (name) => `.icon-tabs .tab[aria-label="${name}"]`,
  section: (title) => `section.sec:has(.sec-title:text-is("${title}"))`,
  tool: (label) => `.stage-bar button[aria-label^="${label}"]`,
};

/** Title card over the main window, the first line spoken over it, then the window. */
export async function intro(r, title, sub, line) {
  await r.card(title, sub);
  await r.hold(0.4);
  await r.say(line);
  await r.hold(1.6);
  await r.hideCard();
  await r.done(0.2);
}

/** The point a title's handle sits at (on the stage), from the app's test hook. */
export async function handle(page, which, layerText) {
  return page.evaluate(([w, txt]) => {
    const s = window.__pfs.state;
    const l = txt ? s.project.layers.find((x) => x.doc.chars.join('').includes(txt)) : null;
    const g = window.__pfs.stageGeom(l ? l.id : undefined);
    if (!g) return null;
    if (w === 'body') { const q = g.quad; return { x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 }; }
    return g.handles[w];
  }, [which, layerText || null]);
}
export const pt = (p, dx = 0, dy = 0) => ({ x: p.x + dx - 1, y: p.y + dy - 1, w: 2, h: 2 });
