/* Playwright test for Word Highway (highway), the open-world driving game.
   Run: node tests/highway.test.js */
const { launch, assert, SITE } = require('./helpers');
const path = require('path');

const SHOTS = process.env.PQ_SHOTS || require('os').tmpdir();
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }).catch(() => {}); };

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
const mode = (page) => dbg(page, () => PQ.debug.highway.state && PQ.debug.highway.state.mode);
const st = (page) => dbg(page, () => { const S = PQ.debug.highway.state; return S ? { mode: S.mode, score: S.score, fuel: S.fuel, v: S.car.v, x: S.car.x, z: S.car.z, a: S.car.a, checkpoints: S.checkpoints, coins: S.coins, bumps: S.bumps, biome: S.biome, biomes: S.biomesSeen.size, seen: Array.from(S.biomesSeen), asked: S.asked, correct: S.correct, streak: S.streak, dist: S.dist, cleared: Array.from(S.cleared), missed: S.missed.length, input: Object.assign({}, S.input) } : null; });
const noOverflow = (page) => dbg(page, () => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Answer the open checkpoint question (typed kind) and press through Continue. */
async function answer(page, correct) {
  const q = await dbg(page, () => { const Q = PQ.debug.highway.state.question; const q = Q.ctl.question; return { kind: q.kind, canonical: q.canonical, entryId: q.entry.id }; });
  assert(q.kind === 'typed', 'question kind forced to typed, got ' + q.kind);
  await page.click('.modal-backdrop input.input');
  await page.keyboard.type(correct ? q.canonical : 'zzzz');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(160);
  const fb = await page.$('.modal-backdrop .quiz-feedback');
  assert(fb, 'feedback shown');
  await page.keyboard.press('Enter');   // Continue
  await page.waitForTimeout(220);
  return q;
}

(async () => {
  // ================= DESKTOP 1280px =================
  {
    const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(SITE + '#/play/highway');
      await page.waitForSelector('.g-highway canvas');
      await dbg(page, () => { PQ.Progress.reset(); PQ.Settings.set('cats', null); PQ.Settings.set('sound', false); });
      assert(await page.$('.g-highway-overlay-intro button.btn-primary'), 'intro overlay with a Drive button');
      assert((await mode(page)) === 'intro', 'starts in intro mode');
      assert(await dbg(page, () => PQ.debug.highway.running), 'frame loop running');
      assert(await page.$('.g-highway-mini'), 'minimap present');
      await shot(page, 'highway-intro.png');

      // ---- start: the car sits on the road south of the first intersection, in the plains ----
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(150);
      let s = await st(page);
      assert(s.mode === 'play' && s.fuel > 99.5 && s.biome === 'plains' && Math.abs(s.x - 4) < 0.01 && s.z < 0, 'run started on the plains road: ' + JSON.stringify(s));
      const t0 = await dbg(page, () => PQ.debug.highway.tileObj(0, -4));
      assert(!t0 || t0.type === 'coin', 'the start tile is clear road');

      // ---- full control: gas, brake, steering ----
      await dbg(page, () => PQ.debug.highway.setInput({ gas: true }));
      await page.waitForTimeout(900);
      s = await st(page);
      assert(s.v > 4 && s.z > -26 && s.dist > 2, 'gas moves the car north: ' + JSON.stringify({ v: s.v, z: s.z, dist: s.dist }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false, brake: true }));
      await page.waitForTimeout(700);
      const s2 = await st(page);
      assert(s2.v < s.v && s2.v <= 0.5, 'brake stops the car: v=' + s2.v);
      await page.waitForTimeout(600);
      assert((await st(page)).v < 0, 'holding brake reverses');
      await dbg(page, () => { PQ.debug.highway.setInput({ brake: false }); PQ.debug.highway.teleport(4, -28, 0); PQ.debug.highway.setInput({ gas: true, right: true }); });
      await page.waitForTimeout(700);
      s = await st(page);
      assert(s.a > 0.15 && s.x > 4.5, 'steering right turns the heading and drifts east: ' + JSON.stringify({ a: s.a, x: s.x }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false, right: false }));
      await shot(page, 'highway-play.png');

      // ---- checkpoint: driving into the intersection stops the car and asks a question ----
      await dbg(page, () => { PQ.debug.highway.forceKind('typed'); PQ.debug.highway.setFuel(50); PQ.debug.highway.teleport(4, -8, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      s = await st(page);
      assert(s.mode === 'question' && s.v === 0 && s.asked === 1, 'question opened, car stopped: ' + JSON.stringify({ mode: s.mode, v: s.v, asked: s.asked }));
      assert(/Checkpoint 1/.test(await page.$eval('.g-highway-qhead', (el) => el.textContent)), 'checkpoint header');
      await shot(page, 'highway-question.png');
      const q1 = await answer(page, true);
      s = await st(page);
      assert(s.mode === 'play' && !(await page.$('.modal-backdrop')), 'back to driving after Continue');
      assert(s.cleared.includes('0,0') && s.checkpoints === 1 && s.correct === 1 && s.streak === 1, 'checkpoint 0,0 cleared: ' + JSON.stringify(s.cleared));
      assert(s.fuel > 50 && s.fuel <= 90.5, 'fuel refilled by the right answer: ' + s.fuel);
      assert(s.score >= 300, 'points for the checkpoint: ' + s.score);
      const w1 = await dbg(page, (id) => PQ.Progress.word(id), q1.entryId);
      assert(w1.ok === 1 && w1.n === 1, 'progress recorded one correct answer for ' + q1.entryId);
      // no re-ask while sitting on a cleared checkpoint
      await page.waitForTimeout(400);
      assert((await st(page)).asked === 1 && !(await page.$('.modal-backdrop')), 'a cleared checkpoint stays quiet');

      // ---- wrong answer: no fuel, the checkpoint stays open and re-arms once you drive away ----
      await dbg(page, () => { PQ.debug.highway.setFuel(50); PQ.debug.highway.teleport(92, -8, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      const q2 = await answer(page, false);
      s = await st(page);
      assert(s.mode === 'play' && !s.cleared.includes('1,0') && s.checkpoints === 1 && s.streak === 0 && s.missed === 1, 'wrong answer leaves the checkpoint open: ' + JSON.stringify(s.cleared));
      assert(Math.abs(s.fuel - 50) < 1.5, 'no fuel for a wrong answer: ' + s.fuel);
      const w2 = await dbg(page, (id) => PQ.Progress.word(id), q2.entryId);
      assert(w2.wrong === 1 || w2.acc === 1, 'progress recorded the miss');
      await page.waitForTimeout(300);
      assert((await st(page)).asked === 2 && !(await page.$('.modal-backdrop')), 'not re-asked while still inside the intersection');
      await dbg(page, () => { PQ.debug.highway.setInput({ gas: false }); PQ.debug.highway.teleport(92, 40, 0); });
      await page.waitForTimeout(150);
      await dbg(page, () => { PQ.debug.highway.teleport(92, -8, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      assert((await st(page)).asked === 3, 'coming back re-asks');
      await answer(page, true);
      s = await st(page);
      assert(s.cleared.includes('1,0') && s.checkpoints === 2, 'second checkpoint cleared on retry');
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- coins refuel a little; solid things stop the car ----
      await dbg(page, () => { PQ.debug.highway.setFuel(50); PQ.debug.highway.teleport(4, 40, 0); PQ.debug.highway.spawn('coin', 4, 47); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1400);
      s = await st(page);
      assert(s.coins === 1 && s.fuel > 50 && s.score > 0, 'coin collected and fuel up: ' + JSON.stringify({ coins: s.coins, fuel: s.fuel }));
      await dbg(page, () => { PQ.debug.highway.setInput({ gas: false }); PQ.debug.highway.teleport(4, 60, 0); PQ.debug.highway.spawn('rock', 4, 69); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1600);
      s = await st(page);
      assert(s.bumps >= 1 && s.z < 68.5, 'the rock blocks the road: ' + JSON.stringify({ bumps: s.bumps, z: s.z }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- biomes: discovering a new one is worth points (the second checkpoint may already have been in another biome) ----
      const before = await st(page);
      const target = ['snow', 'desert', 'forest', 'badlands'].find((b) => !before.seen.includes(b));
      const spot = await dbg(page, (b) => PQ.debug.highway.findBiome(b), target);
      assert(spot, 'a ' + target + ' biome exists within reach');
      await dbg(page, (p) => PQ.debug.highway.teleport(p.x, p.z, 0), spot);
      await page.waitForTimeout(200);
      s = await st(page);
      assert(s.biome === target && s.biomes === before.biomes + 1 && s.score >= before.score + 500, target + ' discovered: ' + JSON.stringify({ biome: s.biome, biomes: s.biomes, seen: s.seen }));
      assert((await page.$eval('.g-highway-biome .val', (el) => el.textContent)).toLowerCase() === target, 'HUD shows the biome');
      await shot(page, 'highway-snow.png');
      const all = await dbg(page, () => ['plains', 'forest', 'desert', 'badlands'].map((b) => !!PQ.debug.highway.findBiome(b)));
      assert(all.every(Boolean), 'every biome exists in this world');

      // ---- keyboard: held keys, handbrake, pause ----
      await dbg(page, () => PQ.debug.highway.teleport(4, 100, 0));
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(40);
      assert((await st(page)).input.gas === true, 'ArrowUp held = gas');
      await page.keyboard.up('ArrowUp'); await page.waitForTimeout(40);
      assert((await st(page)).input.gas === false, 'released');
      await page.keyboard.down('Space'); await page.waitForTimeout(40);
      assert((await st(page)).input.hand === true, 'Space = handbrake');
      await page.keyboard.up('Space');
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert((await mode(page)) === 'pause' && await page.$('.g-highway-overlay-pause'), 'Escape pauses');
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert((await mode(page)) === 'play' && !(await page.$('.g-highway-overlay-pause')), 'Escape resumes');

      // ---- out of fuel ends the run ----
      const finalScore = (await st(page)).score;
      await dbg(page, () => { PQ.debug.highway.setFuel(0.4); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.g-highway-overlay-over', { timeout: 6000 });
      assert((await mode(page)) === 'over', 'game over panel');
      const gs = await dbg(page, () => PQ.Progress.gameStats('highway'));
      assert(gs.plays === 1 && gs.best >= Math.round(finalScore) && gs.checkpoints === 2 && gs.biomes >= 2, 'best saved with checkpoints and biomes: ' + JSON.stringify(gs));
      assert((await page.$$('.g-highway-missed-row')).length === 1, 'the missed word is listed for review');
      await shot(page, 'highway-over.png');

      // ---- restart: a fresh world ----
      await page.click('.g-highway-overlay-over button.btn-primary');
      await page.waitForTimeout(150);
      s = await st(page);
      assert(s.mode === 'play' && s.fuel === 100 && s.score === 0 && s.checkpoints === 0 && s.cleared.length === 0, 'New world resets the run');

      // ---- leaving the page tears everything down ----
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(300);
      assert(!(await dbg(page, () => PQ.debug.highway.running)), 'frame loop stopped on unmount');
      assert(!(await page.$('.g-highway')) && !(await page.$('.modal-backdrop')), 'game DOM removed');
      assert((await dbg(page, () => PQ.Progress.gameStats('highway').plays)) === 1, 'leaving before any checkpoint does not count a play');
      assert(await noOverflow(page), 'no horizontal overflow');
      assert(errors.length === 0, 'no console errors: ' + errors.join('\n'));
      console.log('PASS highway desktop');
    } finally { await browser.close(); }
  }

  // ================= MOBILE 390px, touch =================
  {
    const { browser, page, errors } = await launch({ viewport: { width: 390, height: 831 }, touch: true, mobile: true });
    try {
      await page.goto(SITE + '#/play/highway');
      await page.waitForSelector('.g-highway canvas');
      await dbg(page, () => { PQ.Progress.reset(); PQ.Settings.set('sound', false); });
      assert(await page.$eval('.g-highway', (el) => el.classList.contains('g-highway-is-touch')), 'touch mode detected');
      assert(await page.$eval('.g-highway-touch', (el) => getComputedStyle(el).display === 'flex'), 'touch controls shown');
      assert((await page.$$('.g-highway-touch .touch-btn')).length === 5, 'steer, pause, brake and gas buttons');
      assert(await noOverflow(page), 'no horizontal overflow on mobile');
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(150);
      await page.dispatchEvent('.g-highway-gas', 'pointerdown'); await page.waitForTimeout(500);
      let s = await st(page);
      assert(s.input.gas === true && s.v > 1, 'holding the gas button drives: v=' + s.v);
      await page.dispatchEvent('.g-highway-gas', 'pointerup'); await page.waitForTimeout(40);
      assert((await st(page)).input.gas === false, 'gas released');
      await page.dispatchEvent('.touch-btn[aria-label="Steer left"]', 'pointerdown'); await page.waitForTimeout(40);
      assert((await st(page)).input.left === true, 'steer button held');
      await page.dispatchEvent('.touch-btn[aria-label="Steer left"]', 'pointerup');
      await dbg(page, () => { PQ.debug.highway.forceKind('typed'); PQ.debug.highway.teleport(4, -8, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      await answer(page, true);
      s = await st(page);
      assert(s.checkpoints === 1, 'checkpoint cleared on mobile');
      await shot(page, 'highway-mobile.png');
      assert(await noOverflow(page), 'no overflow mid-game');
      assert(errors.length === 0, 'no console errors (mobile): ' + errors.join('\n'));
      console.log('PASS highway mobile');
    } finally { await browser.close(); }
  }
  console.log('ALL HIGHWAY TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
