// Animated titles: how a title plays, transition in, while on screen (loop), transition out, and the player.
import { SEL, intro } from './common.mjs';

const IN = SEL.section('Transition in'), LOOP = SEL.section('While on screen (loop)'), OUT = SEL.section('Transition out');
// replay this title from the start, as the Preview button does (it is scrolled out of view by then)
const preview = (page) => page.evaluate(() => [...document.querySelectorAll('.panel-right section.sec button')].find((b) => b.textContent.includes('Preview'))?.click());

export default async function animated(r) {
  await intro(r, 'Animated titles', 'Bring a title to life', 'In this video, you’ll animate a title: how it arrives, what it does on screen, and how it leaves.');

  r.chapter('Animated mode');
  await r.say('In Animated, the interface is blue, and the player sits under the stage.');
  await r.spot('.mode-switch');
  await r.hold(1.2);
  await r.spot('.player');
  await r.done();
  await r.spot(null);
  await r.say('Select a title, and open the Animate tab.');
  await r.click(SEL.hello, { dur: 0.8, after: 0.3 });
  await r.click(SEL.tab('Animate'), { dur: 0.7, after: 0.4 });
  await r.done();

  r.chapter('How it plays');
  await r.say('Every title plays in three parts: it animates in, stays on screen, then animates out. Preview plays just this title.');
  await r.spot(SEL.section('How it plays'));
  await r.click(`${SEL.section('How it plays')} button:has-text("Preview")`, { dur: 0.7, after: 0.2 });
  await r.spot(null);
  await r.done(2.2);

  r.chapter('Transition in');
  await r.scrollTo(IN, { dur: 0.7 });
  await r.say('Transition in is how the title arrives. Presets are grouped: cute, cartoony, professional and fun.');
  await r.spot(IN);
  await r.done(0.1);
  await r.click(`${IN} .preset:has-text("Bubble rise")`, { dur: 0.7, after: 0.1 });
  await preview(r.page);
  await r.hold(2.4);
  await r.click(`${IN} .preset:has-text("Spin pop")`, { dur: 0.6, after: 0.1 });
  await preview(r.page);
  await r.hold(2.4);
  await r.scrollTo(`${IN} .pills`, { dur: 0.6, offset: 220 });
  await r.say('Set its duration, the stagger between letters, and whether it moves by letter, word, line, or all at once.');
  await r.spot(`${IN} .pills`, { pad: 70 });
  await r.click(`${IN} .pill:has-text("Words")`, { dur: 0.7, after: 0.1 });
  await preview(r.page);
  await r.hold(2.2);
  await r.click(`${IN} .pill:has-text("Letters")`, { dur: 0.6, after: 0.4 });
  await r.done();
  await r.spot(null);

  r.chapter('While on screen');
  await r.scrollTo(LOOP, { dur: 0.8 });
  await r.say('While on screen, a gentle loop keeps the title alive between its entrance and its exit.');
  await r.spot(LOOP);
  await r.click(`${LOOP} .preset:has-text("Wave")`, { dur: 0.7, after: 0.1 });
  await preview(r.page);
  await r.done(1.6);
  await r.spot(null);

  r.chapter('Transition out');
  await r.scrollTo(OUT, { dur: 0.8 });
  await r.say('Transition out is how it leaves the screen.');
  await r.spot(OUT);
  await r.click(`${OUT} .preset:has-text("Float away")`, { dur: 0.7, after: 0.1 });
  await preview(r.page);
  await r.done(2.4);
  await r.spot(null);

  r.chapter('The player');
  await r.say('The player plays the whole title. Press play, or drag the bar to scrub through it.');
  await r.spot('.player');
  await r.camera('.player', { pad: 60, maxZoom: 1.8 });
  await r.click('.player button[aria-label^="Play"]', { dur: 0.7, after: 2.6 });
  await r.click('.player button[aria-label^="Pause"], .player button[aria-label^="Play"]', { dur: 0.3, after: 0.2 });
  await r.drag('.player-scrub', (m) => ({ x: m.x - 120, y: m.y }), { dur: 1.0 });
  await r.drag('.player-scrub', (m) => ({ x: m.x + 160, y: m.y }), { dur: 1.2 });
  await r.done();
  await r.say('Hold sets how long the title stays on screen. Loop repeats it while you work.');
  await r.ring('.player-hold');
  await r.click('input.nf-input[aria-label="Hold"]', { dur: 0.7, after: 0.1 });
  await r.press('Control+a', { after: 0.1 });
  await r.type('2.5', { cps: 8 });
  await r.press('Enter', { after: 0.3 });
  await r.ring('.player .toggle');
  await r.move('.player .switch', { dur: 0.6 });
  await r.done();
  await r.say('Press K to play or pause at any time.');
  await r.spot(null);
  await r.camera(null);
  await r.page.evaluate(() => document.activeElement && document.activeElement.blur());
  await r.press('k', { show: ['K'], after: 3.2 });
  await r.press('k', { after: 0.3 });
  await r.keys(null);
  await r.say('Next, let’s export it.');
  await r.done(1);
}
animated.title = 'Animated titles';
animated.poster = 26;
