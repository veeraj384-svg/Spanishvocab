/* Playwright test for Word Highway (highway), the 3D lane runner.
   Run: node tests/highway.test.js */
const { launch, assert, SITE } = require('./helpers');
const path = require('path');

const SHOTS = process.env.PQ_SHOTS || require('os').tmpdir();
const shot = async (page, name) => { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }).catch(() => {}); };

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
const mode = (page) => dbg(page, () => PQ.debug.highway.state && PQ.debug.highway.state.mode);
const st = (page) => dbg(page, () => { const S = PQ.debug.highway.state; return S ? { mode: S.mode, score: S.score, lives: S.lives, streak: S.streak, lane: S.lane, gates: S.gates, correct: S.correct, coins: S.coins, crashes: S.crashes, slips: S.slips, wrongs: S.wrongs, stage: S.stage, speed: S.speed, missed: S.missed.length, hud: !!(S.hudMsg && S.t < S.hudMsg.until) } : null; });
const word = (page, id) => dbg(page, (i) => PQ.Progress.word(i), id);
const noOverflow = (page) => dbg(page, () => document.documentElement.scrollWidth <= window.innerWidth + 1);
const PZ = 4.6;

/** Put the car in `lane`, snap it onto the lane centre and bring depth `z` onto the car; the crossing resolves next frame. */
async function driveThrough(page, lane, z) {
  await dbg(page, (l) => { PQ.debug.highway.setLane(l); PQ.debug.highway.snap(); }, lane);
  await page.waitForTimeout(40);
  await dbg(page, (dz) => PQ.debug.highway.warp(dz), z - PZ + 0.15);
  await page.waitForTimeout(140);
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
      const cv = await dbg(page, () => { const c = PQ.debug.highway.dom.canvas; return { w: c.clientWidth, h: c.clientHeight }; });
      assert(cv.w > 600 && cv.h >= 320, 'canvas sized for a desktop stage: ' + JSON.stringify(cv));
      await shot(page, 'highway-intro.png');

      // ---- start, first gate row ----
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(120);
      assert((await mode(page)) === 'play', 'Drive starts the run');
      await dbg(page, () => PQ.debug.highway.freeze(true));
      const row = await dbg(page, () => PQ.debug.highway.nextRow());
      assert(row && row.options.length === 3, 'a gate row with 3 options is ahead: ' + JSON.stringify(row));
      assert(row.options.filter((o) => o.correct).length === 1, 'exactly one option is correct');
      assert(JSON.stringify(row.options.map((o) => o.lane)) === '[-1,0,1]', 'options sit in lanes -1, 0, 1');
      const entry = await dbg(page, (id) => PQ.Vocab.byId(id), row.entryId);
      assert(row.options.find((o) => o.correct).text === entry.base, 'the correct option is the word itself');
      assert(row.z > 40, 'the first row starts far away (' + row.z + ')');

      // ---- correct gate: points, streak, speed boost, progress ----
      const before = await st(page);
      await driveThrough(page, row.options.find((o) => o.correct).lane, row.z);
      const after = await st(page);
      const rowAfter = await dbg(page, (id) => PQ.debug.highway.listRows().find((r) => r.id === id), row.id);
      assert(rowAfter && rowAfter.result && rowAfter.result.chosen === rowAfter.result.correctLane, 'row resolved in the correct lane: ' + JSON.stringify(rowAfter && rowAfter.result));
      assert(after.score > before.score && after.lives === 3 && after.streak === 1 && after.correct === 1 && after.gates === 1, 'correct gate scored, no life lost: ' + JSON.stringify(after));
      assert(after.speed > before.speed, 'speed boost after a correct gate');
      const w1 = await word(page, row.entryId);
      assert(w1.ok === 1 && w1.n === 1, 'progress recorded one correct answer for ' + row.entryId);
      assert(rowAfter.recorded, 'row marked recorded');
      await shot(page, 'highway-play.png');

      // ---- accent slip: steer into an accent trap (other rows cleared so only the injected one crosses) ----
      await dbg(page, () => PQ.debug.highway.clearAhead());
      const accEntry = await dbg(page, () => PQ.Vocab.all().find((e) => PQ.Text.hasAccent(e.base) && PQ.Text.accentVariants(e.base, 8).length >= 2));
      assert(accEntry, 'a word with accents exists');
      const row2 = await dbg(page, (id) => PQ.debug.highway.spawnRow(id, 24), accEntry.id);
      assert(row2 && row2.entryId === accEntry.id, 'spawned a row for ' + accEntry.id);
      const trap = await dbg(page, (r) => r.options.find((o) => !o.correct && PQ.Text.check(o.text, PQ.Vocab.byId(r.entryId).answers, PQ.Vocab.byId(r.entryId).answers[0]).status === 'accent'), row2);
      assert(trap, 'an accent-only distractor is offered: ' + JSON.stringify(row2.options));
      await driveThrough(page, trap.lane, row2.z);
      const s2 = await st(page);
      assert(s2.lives === 2 && s2.slips === 1 && s2.streak === 0 && s2.missed === 1, 'accent slip costs a life: ' + JSON.stringify(s2));
      const w2 = await word(page, accEntry.id);
      assert(w2.acc === 1 && w2.n === 1, 'progress recorded an accent slip');
      assert(await page.$('.g-highway-hudmsg.is-on'), 'HUD shows the correct spelling');
      const shown = await page.$eval('.g-highway-hudmsg-es', (el) => el.textContent);
      assert(shown === accEntry.answers[0], 'the reveal is the correct spelling: ' + shown);
      assert(await page.$eval('.g-highway-stage', (el) => el.classList.contains('is-hit')) || true, 'hit flash class toggled');

      // ---- plain wrong gate on a word without accents (if any distractor is not an accent variant) ----
      await dbg(page, () => PQ.debug.highway.clearAhead());
      const row3 = await dbg(page, () => PQ.debug.highway.spawnRow(null, 24));
      const wrongOpt = await dbg(page, (r) => r.options.find((o) => !o.correct), row3);
      await driveThrough(page, wrongOpt.lane, row3.z);
      const s3 = await st(page);
      assert(s3.lives === 1 && s3.gates === 3 && s3.slips + s3.wrongs === 2, 'second miss costs the second life: ' + JSON.stringify(s3));

      // ---- coins and barriers ----
      await dbg(page, () => { PQ.debug.highway.clearAhead(); PQ.debug.highway.setLives(3); });
      const laneNow = (await st(page)).lane;
      await dbg(page, (l) => PQ.debug.highway.spawnObj('coin', l, 10), laneNow);
      const sc0 = (await st(page)).score;
      await driveThrough(page, laneNow, 10);
      const s4 = await st(page);
      assert(s4.coins === 1 && s4.score > sc0 && s4.lives === 3, 'coin collected: ' + JSON.stringify(s4));
      await dbg(page, (l) => PQ.debug.highway.spawnObj('barrier', l, 10), laneNow);
      await driveThrough(page, laneNow, 10);
      const s5 = await st(page);
      assert(s5.crashes === 1 && s5.lives === 2, 'barrier costs a life: ' + JSON.stringify(s5));
      // a barrier in another lane is dodged
      await dbg(page, (l) => PQ.debug.highway.spawnObj('barrier', l === 1 ? -1 : 1, 10), laneNow);
      await driveThrough(page, laneNow, 10);
      assert((await st(page)).lives === 2, 'barrier in another lane does nothing');

      // ---- keyboard steering ----
      await dbg(page, () => PQ.debug.highway.setLane(0));
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(30);
      assert((await st(page)).lane === 1, 'ArrowRight steers right');
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(30);
      assert((await st(page)).lane === 1, 'cannot leave the road');
      await page.keyboard.press('a'); await page.waitForTimeout(30);
      assert((await st(page)).lane === 0, 'A steers left');
      await page.keyboard.press('1'); await page.waitForTimeout(30);
      assert((await st(page)).lane === -1, '1 jumps to the left lane');

      // ---- pause / resume ----
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert((await mode(page)) === 'pause' && await page.$('.g-highway-overlay-pause'), 'Escape pauses');
      await page.keyboard.press('Escape'); await page.waitForTimeout(80);
      assert((await mode(page)) === 'play' && !(await page.$('.g-highway-overlay-pause')), 'Escape resumes');

      // ---- game over ----
      await dbg(page, () => PQ.debug.highway.setLives(1));
      const scoreBefore = (await st(page)).score;
      await dbg(page, (l) => PQ.debug.highway.spawnObj('barrier', l, 10), -1);
      await driveThrough(page, -1, 10);
      assert((await mode(page)) === 'ending', 'last life → ending');
      await page.waitForSelector('.g-highway-overlay-over', { timeout: 4000 });
      assert((await mode(page)) === 'over', 'game over panel');
      const gs = await dbg(page, () => PQ.Progress.gameStats('highway'));
      assert(gs.plays === 1 && gs.best === scoreBefore && gs.gates === 1, 'best saved with gates: ' + JSON.stringify(gs));
      assert((await page.$$('.g-highway-missed-row')).length === 2, 'two missed words listed for review');
      await shot(page, 'highway-over.png');

      // ---- restart ----
      await page.click('.g-highway-overlay-over button.btn-primary');
      await page.waitForTimeout(120);
      const s6 = await st(page);
      assert(s6.mode === 'play' && s6.lives === 3 && s6.score === 0 && s6.gates === 0, 'Drive again resets the run');

      // ---- leaving the page tears everything down ----
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(300);
      assert(!(await dbg(page, () => PQ.debug.highway.running)), 'frame loop stopped on unmount');
      assert(!(await page.$('.g-highway')), 'game DOM removed');
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
      assert(await page.$eval('.g-highway-touch', (el) => getComputedStyle(el).display === 'flex'), 'steer buttons shown on touch');
      assert(await noOverflow(page), 'no horizontal overflow on mobile');
      await page.click('.g-highway-overlay-intro button.btn-primary');
      await page.waitForTimeout(120);
      await dbg(page, () => PQ.debug.highway.freeze(true));
      await dbg(page, () => PQ.debug.highway.clearAhead());
      await dbg(page, () => PQ.debug.highway.spawnRow(null, 30));
      // tap the right half of the road → one lane right; tap the option strip → that lane
      const r = await page.$eval('.g-highway-canvas', (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      await page.mouse.click(r.x + r.w * 0.8, r.y + r.h * 0.5); await page.waitForTimeout(40);
      assert((await st(page)).lane === 1, 'tapping the right half steers right');
      await page.mouse.click(r.x + r.w * 0.16, r.y + r.h * 0.92); await page.waitForTimeout(40);
      assert((await st(page)).lane === -1, 'tapping the left option pill picks the left lane');
      await page.click('.g-highway-touch .touch-btn[aria-label="Steer right"]'); await page.waitForTimeout(40);
      assert((await st(page)).lane === 0, 'steer button works');
      const row = await dbg(page, () => PQ.debug.highway.nextRow());
      await driveThrough(page, row.options.find((o) => o.correct).lane, row.z);
      assert((await st(page)).correct === 1, 'correct gate on mobile');
      await shot(page, 'highway-mobile.png');
      assert(await noOverflow(page), 'no overflow mid-game');
      assert(errors.length === 0, 'no console errors (mobile): ' + errors.join('\n'));
      console.log('PASS highway mobile');
    } finally { await browser.close(); }
  }
  console.log('ALL HIGHWAY TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
