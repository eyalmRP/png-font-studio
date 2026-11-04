// A few seconds to check the recorder end to end.
export default async function smoke(r) {
  await r.card('Smoke test', 'Checking the recorder');
  await r.say('This is a quick check of the recorder.');
  await r.hold(1.5);
  await r.hideCard();
  await r.hold(0.8);
  await r.chapter('Toolbar');
  await r.say('Here is the toolbar above the stage.');
  await r.spot('.stage-bar');
  await r.camera('.stage-bar', { pad: 60 });
  await r.move('.stage-bar .icon-btn >> nth=3');
  await r.done();
  await r.spot(null);
  await r.camera(null);
  await r.click('.layer-item:has-text("Hello")');
  await r.hold(1);
}
smoke.title = 'Smoke test';
