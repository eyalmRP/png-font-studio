// Export: formats, size and options, MP4 with a luma matte, After Effects, exporting, and Still mode's formats.
import { SEL, intro } from './common.mjs';

// by the card's title: descriptions mention other formats (PNG sequence names After Effects)
const card = (name) => `.export-card:has(b:text-is("${name}"))`;

export default async function exporter(r) {
  await intro(r, 'Export', 'Get your title out of the app', 'In this video, you’ll export your title as an image, a video, or an After Effects composition.');

  r.chapter('Open Export');
  await r.say('When your title is ready, press Export.');
  await r.spot(SEL.exportBtn, { pad: 8 });
  await r.click(SEL.exportBtn, { dur: 0.8, after: 0.4 });
  await r.spot(null);
  await r.done();

  r.chapter('Formats');
  await r.say('Pick a format. PNG image is the current frame, with transparency. PNG sequence is every frame, for any video editor.');
  await r.camera('.export-grid', { pad: 30, maxZoom: 1.6 });
  for (const [name, text] of [['PNG image', 'One frame, transparent'], ['PNG sequence', 'Every frame, in a ZIP']]) {
    await r.ring(card(name), { pad: 4 });
    await r.callout(text, card(name), 'below');
    await r.move(card(name), { dur: 0.6 });
    await r.hold(1.2);
  }
  await r.done(0.1);
  await r.say('WebM and MOV are videos that keep transparency. MP4 plays everywhere.');
  for (const [name, text] of [['WebM video', 'Video with transparency · web, OBS'], ['MOV video', 'Lossless, with transparency'], ['MP4 video', 'Plays everywhere']]) {
    await r.ring(card(name), { pad: 4 });
    await r.callout(text, card(name), 'below');
    await r.move(card(name), { dur: 0.55 });
    await r.hold(0.8);
  }
  await r.done(0.1);
  await r.say('GIF is for chat stickers. Animated PNG and WebP give soft edges in small files.');
  for (const [name, text] of [['GIF', 'Stickers · hard edges'], ['Animated PNG', 'Soft transparency'], ['Animated WebP', 'Small, soft transparency']]) {
    await r.ring(card(name), { pad: 4 });
    await r.callout(text, card(name), 'below');
    await r.move(card(name), { dur: 0.55 });
    await r.hold(0.8);
  }
  await r.done(0.1);
  await r.callout(null);
  await r.spot(null);
  await r.camera(null);

  r.chapter('Size and options');
  await r.click(card('PNG image'), { dur: 0.7, after: 0.3 });
  await r.say('Choose the size: one times is the artboard size, two times is twice as sharp.');
  await r.spot('.modal-body .pills');
  await r.click('.modal-body .pill:has-text("2×")', { dur: 0.7, after: 0.4 });
  await r.done();
  await r.say('Trim crops away empty space. You can add the background colour, or export only the selected title.');
  await r.spot('.modal-body .toggle >> nth=0', { pad: 10 });
  await r.move('.modal-body .toggle >> nth=0', { dur: 0.6 });
  await r.hold(0.8);
  await r.spot('.modal-body .toggle >> nth=1', { pad: 10 });
  await r.move('.modal-body .toggle >> nth=1', { dur: 0.5 });
  await r.done();
  await r.spot(null);

  r.chapter('MP4 and transparency');
  await r.say('MP4 can’t store transparency. For a transparent title, you get a ZIP with the video and a black and white matte.');
  await r.click(card('MP4 video'), { dur: 0.8, after: 0.4 });
  await r.spot('.modal-body .toggle:has-text("Luma matte")', { pad: 10 });
  await r.done(0.1);
  await r.say('In your video editor, put the matte above the video and use it as a luma matte.');
  await r.done();
  await r.spot(null);

  r.chapter('After Effects');
  await r.say('After Effects gives you a ZIP with a script. Run it, and it builds an editable composition, with each letter on its own layer.', { top: true });
  await r.click(card('After Effects composition'), { dur: 0.8, after: 0.4 });
  await r.spot('.modal-body .hint:has-text("After Effects")', { pad: 10 });
  await r.camera('.modal-body .hint:has-text("After Effects")', { pad: 140, maxZoom: 1.6 });
  await r.done();
  await r.spot(null);
  await r.camera(null);

  r.chapter('Export');
  await r.say('Press Export, and the file downloads.');
  await r.click(card('PNG image'), { dur: 0.7, after: 0.2 });
  await r.spot('.modal-foot .btn-primary', { pad: 8 });
  await r.click('.modal-foot .btn-primary', { dur: 0.7, after: 0.3 });
  await r.spot(null);
  await r.until(() => /Saved/.test(document.querySelector('.modal-body')?.textContent || ''), null, 30);
  await r.done(0.3);
  await r.say('The window stays open, so you can export another format. Close it when you’re done.');
  await r.ring('.modal-body p.hint:has-text("Saved")', { pad: 8 });
  await r.hold(1.2);
  await r.ring('.modal-foot button:has-text("Close")', { pad: 6 });
  await r.click('.modal-foot button:has-text("Close")', { dur: 0.7, after: 0.3 });
  await r.spot(null);
  await r.done(0.4);

  r.chapter('Still titles');
  await r.say('A Still title exports as an image. Switch to Animated whenever you want video.');
  await r.click(SEL.still, { dur: 0.8, after: 0.3 });
  await r.click(SEL.exportBtn, { dur: 0.7, after: 0.4 });
  await r.spot('.export-grid', { pad: 10 });
  await r.done(0.6);
  await r.spot(null);
  await r.press('Escape', { after: 0.4 });
  await r.click(SEL.anim, { dur: 0.7, after: 0.3 });
  await r.say('That’s everything. Have fun making titles!');
  await r.done(1.4);
}
exporter.title = 'Export';
exporter.poster = 12;
