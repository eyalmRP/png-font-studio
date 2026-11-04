// Still titles: edit the text live on the stage, style selected letters, move / scale / rotate, effects, warp, layers.
import { SEL, intro, handle, pt } from './common.mjs';

export default async function still(r, page) {
  await intro(r, 'Still titles', 'Design a title and edit it live', 'In this video, you’ll design a still title: type on it, move it around, and style it.');

  r.chapter('Switch to Still');
  await r.say('Switch to Still. The interface turns pink, and the player goes away: this title is an image.');
  await r.spot('.mode-switch');
  await r.click(SEL.still, { dur: 0.8, after: 0.2 });
  await r.spot(null);
  await r.done(0.6);

  r.chapter('Type on the title');
  await r.say('Double-click a title to type on it directly. Everything updates live.');
  const body = await handle(page, 'body', 'Hello');
  await r.dblclick(pt(body), { dur: 0.9, after: 0.3 });
  await r.camera(pt(body), { pad: 230, maxZoom: 1.5 });
  await r.press('Control+a', { show: ['Ctrl', '+', 'A'], after: 0.3 });
  await r.keys(null);
  await r.type('Hi there!', { cps: 8 });
  await r.done(0.4);
  await r.say('Select letters to style just those. Here, Control Shift and the greater-than key make them bigger.');
  for (let i = 0; i < 6; i++) await r.press('Shift+ArrowLeft', { after: 0.08 });
  await r.hold(0.3);
  for (let i = 0; i < 2; i++) await r.press('Control+Shift+Period', { show: ['Ctrl', '+', 'Shift', '+', '>'], after: 0.25 });
  await r.keys(null);
  await r.done(0.2);
  await r.say('Or recolour them in the Colour section of the inspector.');
  await r.camera(null);
  await r.scrollTo(SEL.section('Colour'), { dur: 0.8 });
  await r.spot(SEL.section('Colour'));
  await r.click(`${SEL.section('Colour')} .pill:has-text("Colourise")`, { dur: 0.8, after: 0.6 });
  await r.spot(null);
  await r.done(0.3);
  await r.say('Press Escape when you’re done typing.');
  await r.press('Escape', { show: ['Esc'], after: 0.5 });
  await r.keys(null);
  await r.done();

  r.chapter('Move, scale and rotate');
  await r.say('Drag a title to move it anywhere on the artboard.');
  let p = await handle(page, 'body');
  await r.drag(pt(p), { x: p.x + 20, y: p.y - 75 }, { dur: 1.1 });
  await r.done();
  await r.say('Drag a corner handle to scale it.');
  p = await handle(page, 'se');
  await r.drag(pt(p), { x: p.x - 70, y: p.y - 14 }, { dur: 0.9 });
  await r.done();
  await r.say('Drag the round handle above it to rotate. Hold Shift to snap to fifteen degrees.');
  p = await handle(page, 'rot');
  await r.drag(pt(p), { x: p.x + 45, y: p.y + 6 }, { dur: 1.0 });
  await r.done(0.2);
  await r.say('Control Z undoes the last change.');
  await r.press('Control+z', { show: ['Ctrl', '+', 'Z'], after: 0.6 });
  await r.keys(null);
  await r.done();
  await r.say('With the title selected, the arrow keys nudge it one pixel at a time, or ten with Shift.');
  for (let i = 0; i < 4; i++) await r.press('Shift+ArrowUp', { show: ['Shift', '+', '↑'], after: 0.2 });
  await r.keys(null);
  await r.done();

  r.chapter('Effects and styles');
  await r.say('The Effects tab adds strokes, shadows, glows, bevels and 3D. Start from a ready-made style.');
  await r.click(SEL.tab('Effects'), { dur: 0.8, after: 0.3 });
  await r.scrollTo(SEL.section('Styles'), { dur: 0.6 });
  await r.spot(SEL.section('Styles'));
  await r.click('.style-chip:has-text("Candy")', { dur: 0.7, after: 0.9 });
  await r.click('.style-chip:has-text("Neon")', { dur: 0.6, after: 0.9 });
  await r.click('.style-chip:has-text("Sticker")', { dur: 0.6, after: 0.4 });
  await r.done();
  await r.say('Then fine-tune each effect in the list below. The top of the list is drawn on top.');
  await r.scrollTo(SEL.section('Effects'), { dur: 0.8 });
  await r.spot(SEL.section('Effects'));
  await r.done();
  await r.spot(null);

  r.chapter('Warp');
  await r.say('Warp bends the whole title, like Photoshop’s Warp Text, or sets the letters along a curve.');
  await r.click(SEL.tab('Warp'), { dur: 0.8, after: 0.3 });
  await r.click('.warp-chip >> nth=1', { dur: 0.7, after: 0.9 });
  await r.click('.warp-chip >> nth=9', { dur: 0.6, after: 0.9 });
  await r.click('.warp-chip >> nth=0', { dur: 0.6, after: 0.4 });
  await r.done();

  r.chapter('Add a title');
  await r.say('To add another title, press T, click the artboard, and type.');
  // click empty stage first, so the new title starts plain (it takes the look of a selected title), then add it between the others
  const g = await page.evaluate(() => {
    const s = window.__pfs.state, geom = (txt) => window.__pfs.stageGeom(s.project.layers.find((l) => l.doc.chars.join('').includes(txt)).id);
    const png = geom('PNG'), ab = png.artboard, above = Math.max(...geom('Hi').quad.map((p) => p.y)), below = Math.min(...png.quad.map((p) => p.y));
    const c = document.querySelector('canvas.view').getBoundingClientRect();
    // the new title's box starts at the click (about 64 px tall, 140 wide here): centre it in the gap
    return { off: { x: c.left + 40, y: c.bottom - 40 }, at: { x: ab.x + ab.w / 2 - 70, y: (above + below) / 2 - 32 } };
  });
  await r.click(pt(g.off), { dur: 0.7, after: 0.2 });
  await r.press('t', { show: ['T'], after: 0.3 });
  await r.keys(null);
  await r.click(pt(g.at), { dur: 0.8, after: 0.3 });
  await r.type('Wow!', { cps: 6 });
  await r.press('Escape', { after: 0.4 });
  await r.done();

  r.chapter('Layers and saving');
  await r.say('Every title is a layer. Show or hide it, lock it, or drag to reorder.');
  await r.spot(SEL.section('Layers'));
  await r.move('.layer-item >> nth=0', { dur: 0.7 });
  await r.done();
  await r.say('Your work is saved in this browser by itself. Save title makes a file to back it up, or open on another computer, with its fonts inside.');
  await r.spot(SEL.section('Title file'));
  await r.move('button:has-text("Save title")', { dur: 0.7 });
  await r.done();
  await r.spot(null);
  await r.say('Next, let’s animate a title.');
  await r.done(1);
}
still.title = 'Still titles';
still.poster = 20;
