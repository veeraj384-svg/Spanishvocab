/* Playwright test for Word Highway (highway), the open-world driving game with district gates.
   Run: node tests/highway.test.js */
const { launch, assert, SITE } = require('./helpers');
const path = require('path');

const SHOTS = process.env.PQ_SHOTS || require('os').tmpdir();
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }).catch(() => {}); };

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
const mode = (page) => dbg(page, () => PQ.debug.highway.state && PQ.debug.highway.state.mode);
const st = (page) => dbg(page, () => { const S = PQ.debug.highway.state; return S ? { mode: S.mode, score: S.score, fuel: S.fuel, nitro: S.nitro, boosting: S.car.boosting, v: S.car.v, x: S.car.x, z: S.car.z, a: S.car.a, gates: S.gates, coins: S.coins, bumps: S.bumps, biome: S.biome, biomes: S.biomesSeen.size, seen: Array.from(S.biomesSeen), asked: S.asked, correct: S.correct, streak: S.streak, dist: S.dist, cleared: Array.from(S.cleared), missed: S.missed.length, input: Object.assign({}, S.input) } : null; });
const noOverflow = (page) => dbg(page, () => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Answer the open gate question (typed kind) and press through Continue. */
async function answer(page, correct) {
  const q = await dbg(page, () => { const Q = PQ.debug.highway.state.question; const q = Q.ctl.question; return { kind: q.kind, canonical: q.canonical, entryId: q.entry.id }; });
  assert(q.kind === 'typed', 'question kind forced to typed, got ' + q.kind);
  await page.click('.modal-backdrop input.input');
  await page.keyboard.type(correct ? q.canonical : 'zzzz');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(160);
  assert(await page.$('.modal-backdrop .quiz-feedback'), 'feedback shown');
  await page.keyboard.press('Enter');
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
      const L = await dbg(page, () => PQ.debug.highway.layout());
      assert(L.DIST === 440 && L.WALL_OFF === 48 && L.BLOCK === 88, 'district layout: ' + JSON.stringify(L));
      await shot(page, 'highway-intro.png');
      // car colour picker
      assert((await page.$$('.g-highway-swatch')).length === 8, 'eight car colours');
      await page.click('.g-highway-swatch[data-color="red"]'); await page.waitForTimeout(40);
      assert(await dbg(page, () => PQ.Settings.get('highwayCar') === 'red' && PQ.debug.highway.state.car.color === 'red'), 'choosing red paints the car and is remembered');
      assert(await page.$eval('.g-highway-swatch[data-color="red"]', (el) => el.getAttribute('aria-pressed') === 'true'), 'swatch marked selected');

      // ---- start: on the road south of the first intersection, in the plains, the first gate up the road ----
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(150);
      let s = await st(page);
      assert(s.mode === 'play' && s.fuel > 99.5 && s.biome === 'plains' && Math.abs(s.x - 4) < 0.01 && s.z < 0, 'run started on the plains road: ' + JSON.stringify(s));
      const g0 = await dbg(page, () => PQ.debug.highway.nearestGate());
      assert(g0.open && g0.open.d > 40, 'the nearest open gate is a good drive away: ' + JSON.stringify(g0.open));
      const g1 = await dbg(page, () => PQ.debug.highway.nearestGate(4, 40));
      assert(g1.open && g1.open.key === 'z:0:0' && g1.open.x === 4 && g1.open.z === 48, 'up this road the gate sits where the road crosses the wall at z=48: ' + JSON.stringify(g1.open));

      // ---- full control: gas, brake, reverse, steering ----
      await dbg(page, () => PQ.debug.highway.setInput({ gas: true }));
      await page.waitForTimeout(900);
      s = await st(page);
      assert(s.v > 4 && s.z > -18 && s.dist > 2, 'gas moves the car north: ' + JSON.stringify({ v: s.v, z: s.z, dist: s.dist }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false, brake: true }));
      await page.waitForTimeout(700);
      const s2 = await st(page);
      assert(s2.v < s.v && s2.v <= 0.5, 'brake stops the car: v=' + s2.v);
      await page.waitForTimeout(600);
      assert((await st(page)).v < 0, 'holding brake reverses');
      await dbg(page, () => { PQ.debug.highway.setInput({ brake: false }); PQ.debug.highway.teleport(4, -20, 0); PQ.debug.highway.setInput({ gas: true, right: true }); });
      await page.waitForTimeout(700);
      s = await st(page);
      assert(s.a > 0.15 && s.x > 4.5, 'steering right turns the heading and drifts east: ' + JSON.stringify({ a: s.a, x: s.x }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false, right: false }));

      // ---- intersections no longer ask: drive straight through one ----
      await dbg(page, () => { PQ.debug.highway.teleport(4, -8, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1600);
      s = await st(page);
      assert(s.asked === 0 && !(await page.$('.modal-backdrop')) && s.z > 6, 'no question at a plain intersection: ' + JSON.stringify({ asked: s.asked, z: s.z }));
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));
      await shot(page, 'highway-play.png');

      // ---- the gate: driving up to it stops the car and asks ----
      await dbg(page, () => { PQ.debug.highway.forceKind('typed'); PQ.debug.highway.setFuel(50); PQ.debug.highway.setNitro(20); PQ.debug.highway.teleport(4, 36, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      s = await st(page);
      assert(s.mode === 'question' && s.v === 0 && s.asked === 1 && s.z < 48, 'question opened before the barrier, car stopped: ' + JSON.stringify({ mode: s.mode, v: s.v, z: s.z }));
      assert(/Gate 1/.test(await page.$eval('.g-highway-qhead', (el) => el.textContent)), 'gate header');
      await shot(page, 'highway-question.png');
      const q1 = await answer(page, true);
      s = await st(page);
      assert(s.mode === 'play' && !(await page.$('.modal-backdrop')), 'back to driving after Continue');
      assert(s.cleared.includes('z:0:0') && s.gates === 1 && s.correct === 1 && s.streak === 1, 'gate z:0:0 cleared: ' + JSON.stringify(s.cleared));
      assert(s.fuel > 50 && s.fuel <= 105.5 && s.nitro > 20, 'fuel and nitro refilled by the right answer: ' + JSON.stringify({ fuel: s.fuel, nitro: s.nitro }));
      assert(s.score >= 300, 'points for the gate: ' + s.score);
      const w1 = await dbg(page, (id) => PQ.Progress.word(id), q1.entryId);
      assert(w1.ok === 1 && w1.n === 1, 'progress recorded one correct answer for ' + q1.entryId);
      await dbg(page, () => PQ.debug.highway.setInput({ gas: true }));
      await page.waitForTimeout(1800);
      s = await st(page);
      assert(s.z > 50 && s.asked === 1, 'the open gate lets the car through into the next district: z=' + s.z);
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- wrong answer: no fuel, the barrier stays down and blocks, then the gate asks again ----
      await dbg(page, () => { PQ.debug.highway.setFuel(50); PQ.debug.highway.teleport(92, 36, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      const q2 = await answer(page, false);
      s = await st(page);
      assert(s.mode === 'play' && !s.cleared.includes('z:0:1') && s.gates === 1 && s.streak === 0 && s.missed === 1, 'wrong answer leaves the gate closed: ' + JSON.stringify(s.cleared));
      assert(Math.abs(s.fuel - 50) < 1.5, 'no fuel for a wrong answer: ' + s.fuel);
      const w2 = await dbg(page, (id) => PQ.Progress.word(id), q2.entryId);
      assert(w2.wrong === 1 || w2.acc === 1, 'progress recorded the miss');
      const bumpsBefore = s.bumps;
      await dbg(page, () => PQ.debug.highway.setInput({ gas: true }));
      await page.waitForTimeout(1500);
      s = await st(page);
      assert(s.z < 47.5 && s.bumps > bumpsBefore && s.asked === 2, 'the closed barrier blocks the car: ' + JSON.stringify({ z: s.z, bumps: s.bumps, asked: s.asked }));
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 6000 });
      assert((await st(page)).asked === 3, 'the gate asks again after a moment');
      await answer(page, true);
      s = await st(page);
      assert(s.cleared.includes('z:0:1') && s.gates === 2, 'second gate cleared on retry');
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- walls: no sneaking around a gate off-road, but roaming inside the district is free ----
      await dbg(page, () => { PQ.debug.highway.teleport(20, 36, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(2000);
      s = await st(page);
      assert(s.z < 47.5 && s.asked === 3 && !(await page.$('.modal-backdrop')), 'the district wall stops an off-road bypass: z=' + s.z);
      await dbg(page, () => { PQ.debug.highway.setInput({ gas: false }); PQ.debug.highway.teleport(20, 20, Math.PI / 2); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1000);
      s = await st(page);
      assert(s.x > 24, 'off-road driving inside the district is free: x=' + s.x);
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- coins refuel and add nitro; solid things stop the car ----
      await dbg(page, () => { PQ.debug.highway.setFuel(50); PQ.debug.highway.setNitro(10); PQ.debug.highway.teleport(4, 60, 0); PQ.debug.highway.spawn('coin', 4, 67); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1400);
      s = await st(page);
      assert(s.coins >= 1 && s.fuel > 50 && s.nitro > 10, 'coin collected, fuel and nitro up: ' + JSON.stringify({ coins: s.coins, fuel: s.fuel, nitro: s.nitro }));
      await dbg(page, () => { PQ.debug.highway.setInput({ gas: false }); PQ.debug.highway.teleport(4, 80, 0); PQ.debug.highway.spawn('rock', 4, 89); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForTimeout(1600);
      s = await st(page);
      assert(s.z < 88.5, 'the rock blocks the road: z=' + s.z);
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- nitro: faster than the normal top speed, drains the meter ----
      await dbg(page, () => { PQ.debug.highway.teleport(4, 100, 0); PQ.debug.highway.setNitro(100); PQ.debug.highway.setInput({ gas: true, nitro: true }); });
      await page.waitForTimeout(2200);
      s = await st(page);
      assert(s.boosting && s.v > 38 && s.nitro < 100, 'nitro boosts past the normal top speed: ' + JSON.stringify({ v: s.v, nitro: s.nitro, boosting: s.boosting }));
      await shot(page, 'highway-nitro.png');
      await dbg(page, () => PQ.debug.highway.setInput({ nitro: false }));
      await page.waitForTimeout(1500);
      s = await st(page);
      assert(!s.boosting && s.v <= 34.6 && s.v > 25, 'speed settles back to the normal top speed: v=' + s.v);
      await dbg(page, () => PQ.debug.highway.setInput({ gas: false }));

      // ---- biomes: discovering a new one is worth points ----
      const before = await st(page);
      const target = ['snow', 'desert', 'forest', 'badlands'].find((b) => !before.seen.includes(b));
      const spot = await dbg(page, (b) => PQ.debug.highway.findBiome(b), target);
      assert(spot, 'a ' + target + ' biome exists within reach');
      await dbg(page, (p) => PQ.debug.highway.teleport(p.x, p.z, 0), spot);
      await page.waitForTimeout(200);
      s = await st(page);
      assert(s.biome === target && s.biomes === before.biomes + 1 && s.score >= before.score + 500, target + ' discovered: ' + JSON.stringify({ biome: s.biome, biomes: s.biomes, seen: s.seen }));
      assert((await page.$eval('.g-highway-biome .val', (el) => el.textContent)).toLowerCase().includes(target), 'HUD shows the biome');
      const all = await dbg(page, () => ['plains', 'forest', 'desert', 'badlands', 'snow'].map((b) => !!PQ.debug.highway.findBiome(b)));
      assert(all.every(Boolean), 'every natural biome exists in this world');
      const city = await dbg(page, () => PQ.debug.highway.findCity());
      if (city) {
        const tower = await dbg(page, (c) => { for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) { const o = PQ.debug.highway.tileObj(Math.floor(c.x / 8) + dx, Math.floor(c.z / 8) + dz); if (o && o.type === 'tower') return o; } return null; }, city);
        assert(tower && tower.solid && tower.hgt > 6 && tower.biome === city.biome, 'a city has towers styled for its biome (' + city.biome + '): ' + JSON.stringify(tower));
        const zonesBefore = (await st(page)).biomes;
        await dbg(page, (c) => PQ.debug.highway.teleport(c.x, c.z, 0), city);
        await page.waitForTimeout(200);
        const hud = await page.$eval('.g-highway-biome .val', (el) => el.textContent);
        assert(/^City · /.test(hud) && (await st(page)).biomes >= zonesBefore, 'the HUD names the city and its biome: ' + hud);
      } else console.log('  (no city within the scan radius in this world)');
      await shot(page, 'highway-biome.png');

      // ---- keyboard: held keys, nitro, handbrake, pause ----
      await dbg(page, () => PQ.debug.highway.teleport(4, 120, 0));
      await page.keyboard.down('ArrowUp'); await page.waitForTimeout(40);
      assert((await st(page)).input.gas === true, 'ArrowUp held = gas');
      await page.keyboard.down('Shift'); await page.waitForTimeout(40);
      assert((await st(page)).input.nitro === true, 'Shift = nitro');
      await page.keyboard.up('Shift'); await page.keyboard.up('ArrowUp'); await page.waitForTimeout(40);
      assert((await st(page)).input.gas === false && (await st(page)).input.nitro === false, 'released');
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
      assert(gs.plays === 1 && gs.best >= Math.round(finalScore) && gs.gates === 2 && gs.biomes >= 2, 'best saved with gates and biomes: ' + JSON.stringify(gs));
      assert((await page.$$('.g-highway-missed-row')).length === 1, 'the missed word is listed for review');
      await shot(page, 'highway-over.png');

      // ---- restart, then leave ----
      await page.click('.g-highway-overlay-over button.btn-primary');
      await page.waitForTimeout(150);
      s = await st(page);
      assert(s.mode === 'play' && s.fuel === 100 && s.score === 0 && s.gates === 0 && s.cleared.length === 0, 'New world resets the run: ' + JSON.stringify(s));
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(300);
      assert(!(await dbg(page, () => PQ.debug.highway.running)), 'frame loop stopped on unmount');
      assert(!(await page.$('.g-highway')) && !(await page.$('.modal-backdrop')), 'game DOM removed');
      assert((await dbg(page, () => PQ.Progress.gameStats('highway').plays)) === 1, 'leaving before any gate does not count a play');
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
      assert((await page.$$('.g-highway-touch .touch-btn')).length === 6, 'steer, pause, nitro, brake and gas buttons');
      assert(await noOverflow(page), 'no horizontal overflow on mobile');
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(150);
      await page.dispatchEvent('.g-highway-gas', 'pointerdown'); await page.waitForTimeout(500);
      let s = await st(page);
      assert(s.input.gas === true && s.v > 1, 'holding the gas button drives: v=' + s.v);
      await page.dispatchEvent('.g-highway-nitrobtn', 'pointerdown'); await page.waitForTimeout(300);
      s = await st(page);
      assert(s.input.nitro === true && s.boosting, 'nitro button boosts');
      await page.dispatchEvent('.g-highway-nitrobtn', 'pointerup');
      await page.dispatchEvent('.g-highway-gas', 'pointerup'); await page.waitForTimeout(40);
      s = await st(page);
      assert(s.input.gas === false && s.input.nitro === false, 'buttons released');
      await dbg(page, () => { PQ.debug.highway.forceKind('typed'); PQ.debug.highway.teleport(4, 36, 0); PQ.debug.highway.setInput({ gas: true }); });
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 5000 });
      await answer(page, true);
      s = await st(page);
      assert(s.gates === 1, 'gate cleared on mobile');
      await shot(page, 'highway-mobile.png');
      assert(await noOverflow(page), 'no overflow mid-game');
      assert(errors.length === 0, 'no console errors (mobile): ' + errors.join('\n'));
      console.log('PASS highway mobile');
    } finally { await browser.close(); }
  }
  console.log('ALL HIGHWAY TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
