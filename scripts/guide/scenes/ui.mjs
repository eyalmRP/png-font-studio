// The workspace: layout, Still pink / Animated blue, draggable panels, the stage toolbar, English / Hebrew, dark / light.
import { SEL, intro } from './common.mjs';

export default async function ui(r) {
  await intro(r, 'The workspace', 'Find your way around PNG Font Studio', 'Welcome to PNG Font Studio. Let’s take a quick tour of the workspace.');

  r.chapter('The main window');
  await r.say('Up top, Titles is where you design and animate. Fonts is where you make the letters themselves.');
  await r.spot('.mode-tabs');
  await r.camera('.mode-tabs', { pad: 120, maxZoom: 2 });
  await r.move(SEL.fontsTab, { dur: 0.8 });
  await r.done();
  await r.say('Undo and redo sit next to them. Every change can be undone.');
  await r.spot('.topbar .group >> nth=0');
  await r.camera('.topbar .group >> nth=0', { pad: 150, maxZoom: 2 });
  await r.move('.topbar button[aria-label^="Undo"]', { dur: 0.6 });
  await r.done();

  r.chapter('Still is pink, Animated is blue');
  await r.say('Still makes images. Animated makes videos. The interface colour tells you which one you’re in.');
  await r.spot('.mode-switch');
  await r.camera('.export-slot', { pad: 150, maxZoom: 2 });
  await r.done(0.1);
  await r.say('In Still, the interface turns pink.');
  await r.click(SEL.still, { dur: 0.6 });
  await r.spot(null);
  await r.camera(null, { dur: 1 });
  await r.done(0.6);
  await r.say('In Animated, it turns blue, and a player appears under the stage.');
  await r.click(SEL.anim, { dur: 0.8 });
  await r.ring('.player');
  await r.done(0.4);
  await r.spot(null);

  r.chapter('Panels');
  await r.click(SEL.hello, { dur: 0.8 });
  await r.say('On the left are your layers, the artboard size, and your title files.');
  await r.spot('.panel-left');
  await r.done();
  await r.say('On the right, the inspector edits whatever you select: text, alignment, effects, warp, animation, and the layer.');
  await r.spot('.panel-right');
  await r.move('.icon-tabs', { dur: 0.8 });
  await r.done();
  await r.say('Every divider between panels can be dragged. Make a panel wider or narrower to suit your screen.');
  await r.spot('.split-right', { pad: 6 });
  await r.callout('Drag to resize', '.split-right', 'left');
  await r.drag('.split-right', (m) => ({ x: m.x - 150, y: m.y }), { dur: 1.1 });
  await r.callout(null);
  await r.spot(null);
  await r.drag('.split-right', (m) => ({ x: m.x + 150, y: m.y }), { dur: 1.0 });
  await r.drag('.split-left', (m) => ({ x: m.x + 90, y: m.y }), { dur: 0.9 });
  await r.drag('.split-left', (m) => ({ x: m.x - 90, y: m.y }), { dur: 0.8 });
  await r.done();

  r.chapter('The stage toolbar');
  await r.say('The toolbar over the stage holds the tools and the view controls.');
  await r.spot('.stage-bar');
  await r.camera('.stage-bar', { pad: 70, maxZoom: 2.1 });
  await r.done();
  const tools = [
    ['Select and move', 'Select and move titles · V'],
    ['Text tool', 'Add a title: click the artboard · T'],
    ['Pan', 'Hand: drag the view · H'],
  ];
  await r.say('Select and move, add text, and pan around.');
  for (const [label, text] of tools) { await r.move(SEL.tool(label), { dur: 0.45 }); await r.callout(text, SEL.tool(label), 'below'); await r.hold(0.55); }
  await r.done(0.1);
  await r.say('Zoom out, zoom in, and fit the artboard to the window.');
  await r.callout('Zoom out · in', SEL.tool('Zoom in'), 'below');
  await r.click(SEL.tool('Zoom in'), { dur: 0.5, after: 0.25 });
  await r.click(null, { after: 0.3 });
  await r.click(SEL.tool('Zoom out'), { dur: 0.4, after: 0.3 });
  await r.callout('Fit the artboard · Ctrl 0', SEL.tool('Fit artboard'), 'below');
  await r.click(SEL.tool('Fit artboard'), { dur: 0.5, after: 0.4 });
  await r.done();
  await r.say('Show the text guides while you type, and the title-safe frame that keeps titles clear of the screen edge.');
  await r.callout('Text guides while editing', SEL.tool('Show text guides'), 'below');
  await r.move(SEL.tool('Show text guides'), { dur: 0.5 });
  await r.hold(0.6);
  await r.callout('Title-safe guides', SEL.tool('Title-safe'), 'below');
  await r.click(SEL.tool('Title-safe'), { dur: 0.5, after: 0.2 });
  await r.camera(null, { dur: 1.0 });
  await r.spot('.stage', { pad: -4, dim: false });
  await r.done(0.3);
  await r.spot('.stage-bar');
  await r.camera('.stage-bar', { pad: 70, maxZoom: 2.1, dur: 0.8 });
  await r.click(SEL.tool('Title-safe'), { dur: 0.4, after: 0.2 });
  await r.say('And the preview background, to see your title on dark, light, or a colour of your own. It’s for viewing only, never exported.');
  await r.callout('Preview background', SEL.tool('Preview background'), 'below');
  await r.click(SEL.tool('Preview background'), { dur: 0.5, after: 0.3 });
  await r.callout(null);
  await r.spot(null);
  await r.camera(null, { dur: 0.9 });
  await r.click('.menu-item:has-text("Grey")', { dur: 0.6, after: 0.9 });
  await r.click(SEL.tool('Preview background'), { dur: 0.6, after: 0.3 });
  await r.click('.menu-item:has-text("Checkerboard")', { dur: 0.5, after: 0.3 });
  await r.done();

  r.chapter('English and Hebrew');
  await r.say('The app speaks English and Hebrew. Switch here, and the whole layout mirrors for right to left.');
  await r.spot('.lang-pills');
  await r.camera('.topbar .lang-pills', { pad: 140, maxZoom: 1.7 });
  await r.click('.lang-pills .pill >> nth=1', { dur: 0.7, after: 0.2 });
  await r.spot(null);
  await r.camera(null, { dur: 1 });
  await r.done(1.2);
  await r.say('Switch back to English the same way.');
  await r.click('.lang-pills .pill >> nth=0', { dur: 0.9, after: 0.6 });
  await r.done();

  r.chapter('Dark and light');
  await r.say('This button switches between dark and light.');
  await r.spot(SEL.theme, { pad: 8 });
  await r.click(SEL.theme, { dur: 0.7, after: 0.2 });
  await r.spot(null);
  await r.done(1.4);
  await r.click(SEL.theme, { after: 0.6 });

  r.chapter('Help and shortcuts');
  await r.say('Help opens a short guided tour, and every keyboard shortcut. You can also press the question mark key at any time.');
  await r.spot(SEL.help, { pad: 8 });
  await r.click(SEL.help, { dur: 0.7, after: 0.6 });
  await r.spot(null);
  await r.press('Escape', { after: 0.3 });
  await r.press('Shift+Slash', { show: ['?'], after: 0.4 });
  await r.camera('.modal', { pad: 10, maxZoom: 1.4 });
  await r.done(0.8);
  await r.keys(null);
  await r.camera(null);
  await r.press('Escape', { after: 0.6 });
  await r.say('That’s the workspace. Next, let’s make a font.');
  await r.done(1);
}
ui.title = 'The workspace';
ui.poster = 9;
