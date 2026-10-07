/* Playwright test for Energy Run (platformer).
   Run: node tests/platformer.test.js */
const { launch, assert, SITE } = require('./helpers');
const path = require('path');

const SHOTS = process.env.PQ_SHOTS || require('os').tmpdir();
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }).catch(() => {}); };

const dbg = (page, fn) => page.evaluate(fn);
const mode = (page) => dbg(page, () => PQ.debug.platformer.state && PQ.debug.platformer.state.mode);

/** Answer the open question modal. kind: 'correct' | 'accent' | 'wrong' */
async function answer(page, kind) {
  await page.waitForSelector('.modal-backdrop .quiz', { timeout: 4000 });
  const info = await page.evaluate(() => {
    const q = PQ.debug.platformer.state.question.ctl.question;
    return { kind: q.kind, canonical: q.canonical, entryId: q.entry.id, needs: q.needs || null, options: (q.options || []).map((o) => o.text) };
  });
  assert(PQ_IDS.includes(info.entryId), 'question word must come from the vocab sheet: ' + info.entryId);
  if (info.kind === 'typed') {
    let text = info.canonical;
    if (kind === 'accent') text = await page.evaluate((w) => PQ.Text.stripAccents(w), info.canonical);
    if (kind === 'wrong') text = 'zzzz';
    await page.click('.modal-backdrop input.input');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  } else if (info.kind === 'choice') {
    let idx = info.options.findIndex((t) => t === info.canonical);
    if (kind !== 'correct') {
      const strip = await page.evaluate((o) => o.map((t) => PQ.Text.stripAccents(t)), info.options);
      const canonStrip = await page.evaluate((w) => PQ.Text.stripAccents(w), info.canonical);
      const acc = info.options.findIndex((t, i) => t !== info.canonical && strip[i] === canonStrip);
      const wrong = info.options.findIndex((t, i) => t !== info.canonical && strip[i] !== canonStrip);
      idx = kind === 'accent' ? (acc >= 0 ? acc : wrong) : (wrong >= 0 ? wrong : acc);
    }
    await page.click('.modal-backdrop .quiz-option[data-idx="' + idx + '"]');
  } else if (info.kind === 'accent') {
    if (kind === 'correct') for (const i of info.needs) await page.click('.modal-backdrop .quiz-letter[data-idx="' + i + '"]');
    // 'accent' / 'wrong' → confirm with no letters selected (graded as accent mistake)
    await page.keyboard.press('Enter');
  }
  await page.waitForSelector('.modal-backdrop .quiz-feedback', { timeout: 4000 });
  const status = await page.evaluate(() => {
    const fb = document.querySelector('.modal-backdrop .quiz-feedback');
    return fb.classList.contains('ok') ? 'correct' : fb.classList.contains('accent') ? 'accent' : 'wrong';
  });
  const feedbackHtml = await page.evaluate(() => document.querySelector('.modal-backdrop .quiz-feedback').innerHTML);
  // continue (Enter triggers the QuizUI continue handler)
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal-backdrop', { state: 'detached', timeout: 4000 });
  return { status, info, feedbackHtml };
}

let PQ_IDS = [];

async function holdKey(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

(async () => {
  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(SITE + '#/play/platformer');
    await page.waitForSelector('.g-platformer canvas');
    PQ_IDS = await page.evaluate(() => window.VOCAB.map((e) => e.id));

    // ---- registration + home hero link ----
    const reg = await page.evaluate(() => { const g = PQ.Games.get('platformer'); return { name: g.name, icon: g.icon, order: g.order, first: PQ.Games.all()[0].id }; });
    assert(reg.name === 'Energy Run' && reg.icon === '⚡' && reg.order === 1, 'registration fields');
    assert(reg.first === 'platformer', 'platformer must be the first (hero) game');

    // ---- intro overlay ----
    assert(await page.$('.g-platformer .game-overlay .panel') != null, 'intro overlay visible');
    assert(await mode(page) === 'intro', 'starts in intro mode');
    await shot(page, 'platformer-intro.png');
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(noOverflow, 'no horizontal page overflow on desktop');
    await page.click('.g-platformer .game-overlay button.btn-primary');
    assert(await mode(page) === 'play', 'Start button begins play');
    assert(await page.$('.g-platformer .game-overlay') == null, 'intro overlay removed');

    // ---- keyboard movement drains energy; jumping works ----
    const e0 = await dbg(page, () => PQ.debug.platformer.state.energy);
    const x0 = await dbg(page, () => PQ.debug.platformer.state.player.x);
    await holdKey(page, 'ArrowRight', 700);
    const x1 = await dbg(page, () => PQ.debug.platformer.state.player.x);
    const e1 = await dbg(page, () => PQ.debug.platformer.state.energy);
    assert(x1 > x0 + 60, 'player moved right with keyboard: ' + x0 + ' → ' + x1);
    assert(e1 < e0, 'energy drains while moving: ' + e0 + ' → ' + e1);
    await page.waitForTimeout(250); // let the run slide stop so no drain is counted
    const before = await dbg(page, () => ({ e: PQ.debug.platformer.state.energy, orbs: PQ.debug.platformer.state.orbs }));
    await page.keyboard.press('Space');
    await page.waitForTimeout(120);
    const vy = await dbg(page, () => PQ.debug.platformer.state.player.vy);
    const grounded = await dbg(page, () => PQ.debug.platformer.state.player.onGround);
    assert(vy < 0 || !grounded, 'space makes the player jump (vy=' + vy + ')');
    const afterJ = await dbg(page, () => ({ e: PQ.debug.platformer.state.energy, orbs: PQ.debug.platformer.state.orbs }));
    assert(afterJ.e <= before.e - 3 + 4 * (afterJ.orbs - before.orbs) + 0.01, 'jump costs 3 energy: ' + JSON.stringify(before) + ' → ' + JSON.stringify(afterJ));
    await page.waitForTimeout(700);
    // picked up the starter orbs while running
    const orbs = await dbg(page, () => PQ.debug.platformer.state.orbs);
    assert(orbs >= 1, 'collected at least one orb on the start pad: ' + orbs);
    await shot(page, 'platformer-play.png');

    // ---- pause with P and resume ----
    await page.keyboard.press('KeyP');
    assert(await mode(page) === 'pause', 'P pauses');
    assert(await page.$('.g-platformer .game-overlay') != null, 'pause overlay shown');
    await shot(page, 'platformer-pause.png');
    await page.keyboard.press('Escape');
    assert(await mode(page) === 'play', 'Esc resumes');

    // ---- energy at 0 → recharge question opens automatically; correct answer ----
    await dbg(page, () => PQ.debug.platformer.setEnergy(0));
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 3000 });
    assert(await mode(page) === 'question', 'mode is question while modal open');
    assert(await page.$('.modal-backdrop .modal-close') == null, 'forced question is not closable');
    assert((await page.$eval('.energy-bar', (el) => el.classList.contains('is-low'))), 'energy bar flagged low');
    await shot(page, 'platformer-question.png');
    // game keys must not act while the question is open (Escape would otherwise pause)
    await page.keyboard.press('Escape');
    assert(await mode(page) === 'question' && (await page.$('.modal-backdrop')) != null, 'Esc ignored while question open');
    const a1 = await answer(page, 'correct');
    assert(a1.status === 'correct', 'answered correctly, got ' + a1.status + ' ' + JSON.stringify(a1.info) + ' FB=' + a1.feedbackHtml.replace(/<[^>]+>/g, ''));
    const e3 = await dbg(page, () => PQ.debug.platformer.state.energy);
    assert(e3 >= 60, 'correct answer gives +60 energy: ' + e3);
    assert(await mode(page) === 'play', 'game resumes after answer');
    assert(await dbg(page, () => PQ.debug.platformer.state.streak) === 1, 'streak incremented');

    // ---- accent-only mistake: +30, streak reset, diff shown ----
    const asked1 = await dbg(page, () => PQ.debug.platformer.state.recent.slice());
    await dbg(page, () => PQ.debug.platformer.setEnergy(0));
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 3000 });
    const qinfo = await page.evaluate(() => { const q = PQ.debug.platformer.state.question.ctl.question; return { kind: q.kind, hasAccent: PQ.Text.hasAccent(q.canonical), id: q.entry.id }; });
    assert(qinfo.id !== asked1[asked1.length - 1], 'never the same word twice in a row');
    const a2 = await answer(page, 'accent');
    const e4 = await dbg(page, () => PQ.debug.platformer.state.energy);
    if (qinfo.kind === 'accent' || qinfo.hasAccent) {
      assert(a2.status === 'accent', 'accent-only mistake graded as accent (kind=' + qinfo.kind + '), got ' + a2.status);
      assert(/d-accent|accent-char|Correct spelling/.test(a2.feedbackHtml), 'accent feedback shows correct spelling');
      assert(e4 >= 30 && e4 < 60, 'accent gives +30: ' + e4);
    } else if (qinfo.kind === 'typed') {
      // word without accents: stripping changes nothing → counts as correct
      assert(a2.status === 'correct', 'unaccented word typed correctly');
    } else {
      // multiple choice about an unaccented word: the helper picks a wrong option
      assert(a2.status !== 'correct', 'unaccented choice question answered wrongly on purpose, got ' + a2.status);
    }
    assert(await mode(page) === 'play', 'resumes after accent answer');

    // ---- wrong answer: +15, still playable ----
    await dbg(page, () => PQ.debug.platformer.setEnergy(0));
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 3000 });
    const a3 = await answer(page, 'wrong');
    assert(a3.status !== 'correct', 'wrong answer not graded correct: ' + a3.status);
    const e5 = await dbg(page, () => PQ.debug.platformer.state.energy);
    assert(e5 >= 15, 'wrong answer still gives energy: ' + e5);
    assert(await dbg(page, () => PQ.debug.platformer.state.streak) === 0, 'streak reset on mistake');
    assert(await mode(page) === 'play', 'resumes after wrong answer');

    // ---- word gate: wrong keeps it closed, correct opens it + checkpoint ----
    const gate = await dbg(page, () => PQ.debug.platformer.teleportToGate(0));
    assert(gate && !gate.open, 'teleported to a closed gate');
    await dbg(page, () => PQ.debug.platformer.setEnergy(100));
    await page.keyboard.down('ArrowRight');
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 4000 });
    await page.keyboard.up('ArrowRight');
    assert((await page.$eval('.g-platformer-qhead', (el) => el.classList.contains('is-gate'))), 'gate question header');
    await shot(page, 'platformer-gate.png');
    const g1 = await answer(page, 'wrong');
    assert(g1.status !== 'correct', 'gate wrong answer');
    let gateOpen = await dbg(page, () => PQ.debug.platformer.state.level.gates[0].open);
    assert(gateOpen === false, 'gate stays closed after a wrong answer');
    await page.waitForTimeout(1300); // gate cooldown
    await page.keyboard.down('ArrowRight');
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 4000 });
    await page.keyboard.up('ArrowRight');
    const g2 = await answer(page, 'correct');
    assert(g2.status === 'correct', 'gate correct answer');
    gateOpen = await dbg(page, () => PQ.debug.platformer.state.level.gates[0].open);
    assert(gateOpen === true, 'gate opens after a correct answer');
    const cp = await dbg(page, () => PQ.debug.platformer.state.checkpoint.x);
    assert(cp > gate.x, 'checkpoint moved to the gate');
    // can now run through the gate
    await holdKey(page, 'ArrowRight', 600);
    const px = await dbg(page, () => PQ.debug.platformer.state.player.x);
    assert(px > gate.x + 20, 'player passed the opened gate: ' + px + ' > ' + gate.x);
    assert(await page.$('.modal-backdrop') == null, 'no modal after passing open gate');

    // ---- hazards: kill → heart lost → respawn at checkpoint with invulnerability ----
    await dbg(page, () => PQ.debug.platformer.kill());
    assert(await mode(page) === 'dead', 'dead mode after kill');
    await page.waitForTimeout(1100);
    const after = await dbg(page, () => { const s = PQ.debug.platformer.state; return { hearts: s.hearts, mode: s.mode, x: s.player.x, inv: s.player.invuln }; });
    assert(after.hearts === 2, 'lost one heart: ' + after.hearts);
    assert(after.mode === 'play', 'respawned into play');
    assert(Math.abs(after.x - cp) < 2, 'respawned at checkpoint ' + after.x + ' vs ' + cp);
    assert(after.inv > 0, 'invulnerable after respawn');
    assert((await page.$$('.g-platformer-heart.is-off')).length === 1, 'HUD shows one lost heart');

    // ---- level complete: flag → overlay with Next level ----
    await dbg(page, () => PQ.debug.platformer.teleportToFlag());
    await dbg(page, () => PQ.debug.platformer.setEnergy(100));
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(() => PQ.debug.platformer.state.mode === 'complete', null, { timeout: 5000 });
    await page.keyboard.up('ArrowRight');
    await page.waitForSelector('.g-platformer .game-overlay .panel', { timeout: 3000 });
    const scoreL1 = await dbg(page, () => PQ.debug.platformer.score());
    assert(scoreL1 > 0, 'score is positive');
    await shot(page, 'platformer-complete.png');
    const btnTxt = await page.$eval('.g-platformer .game-overlay button.btn-primary', (b) => b.textContent);
    assert(/Next level/.test(btnTxt), 'Next level button');
    await page.click('.g-platformer .game-overlay button.btn-primary');
    const lvl2 = await dbg(page, () => { const s = PQ.debug.platformer.state; return { level: s.level.level, mode: s.mode, gates: s.level.gates.length, width: s.level.width, hearts: s.hearts }; });
    assert(lvl2.level === 2 && lvl2.mode === 'play', 'level 2 started');
    const lvl1 = await dbg(page, () => { const L = PQ.debug.platformer.generate(1); return { gates: L.gates.length, width: L.width }; });
    assert(lvl2.width > lvl1.width && lvl2.gates >= lvl1.gates, 'level 2 is longer with at least as many gates');
    assert(lvl2.hearts === 3, 'heart restored on level up');
    assert((await page.$eval('.g-platformer-hud', (el) => el.textContent)).includes('2'), 'HUD shows level 2');

    // ---- game over: lose all hearts ----
    for (let i = 0; i < 3; i++) {
      await dbg(page, () => PQ.debug.platformer.kill());
      await page.waitForTimeout(1050);
    }
    assert(await mode(page) === 'over', 'game over after 3 deaths');
    await page.waitForSelector('.g-platformer .game-overlay .panel');
    const best = await dbg(page, () => PQ.Progress.best('platformer'));
    assert(best >= scoreL1, 'best saved via Progress.setBest: ' + best);
    await shot(page, 'platformer-gameover.png');
    await page.click('.g-platformer .game-overlay button.btn-primary'); // Retry
    assert(await mode(page) === 'play', 'retry restarts play');
    assert(await dbg(page, () => PQ.debug.platformer.state.hearts) === 3, 'fresh hearts after retry');

    // ---- visibilitychange pauses ----
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert(await mode(page) === 'pause', 'hidden tab pauses the game');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });

    // ---- unmount / remount: navigate away and back ----
    await page.evaluate(() => { location.hash = '#/words'; });
    await page.waitForTimeout(200);
    assert(await page.$('.g-platformer') == null, 'game DOM removed after navigating away');
    assert(await dbg(page, () => PQ.debug.platformer.state) === null, 'state cleared on unmount');
    assert(await page.$('.modal-backdrop') == null, 'no modal left behind');
    // keyboard must be inert now
    await page.keyboard.press('KeyP');
    await page.evaluate(() => { location.hash = '#/play/platformer'; });
    await page.waitForSelector('.g-platformer canvas');
    assert(await mode(page) === 'intro', 'remount starts fresh at intro');
    await page.keyboard.press('Space'); // space starts from intro
    assert(await mode(page) === 'play', 'remounted game plays');
    await holdKey(page, 'ArrowRight', 300);
    assert(await dbg(page, () => PQ.debug.platformer.state.player.x) > 70, 'remounted game responds to keys');
    // question + navigate away while modal open must clean up
    await dbg(page, () => PQ.debug.platformer.openQuestion());
    await page.waitForSelector('.modal-backdrop .quiz');
    await page.evaluate(() => { location.hash = '#/'; });
    await page.waitForTimeout(200);
    assert(await page.$('.modal-backdrop') == null, 'question modal closed on unmount');
    const heroHref = await page.$eval('.hero a.btn-primary', (a) => a.getAttribute('href'));
    assert(heroHref === '#/play/platformer', 'home Start playing links to Energy Run');

    assert(errors.length === 0, 'console errors (desktop): ' + errors.join('\n'));
    console.log('desktop: OK');
  } finally {
    await browser.close();
  }

  // ================= MOBILE 390px, touch =================
  {
    const { browser, page, errors, context } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    try {
      await page.goto(SITE + '#/play/platformer');
      await page.waitForSelector('.g-platformer canvas');
      const over = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      assert(over, 'no horizontal overflow at 390px');
      const cs = await page.$eval('.g-platformer canvas', (c) => ({ w: c.clientWidth, h: c.clientHeight }));
      assert(cs.w <= 390 && cs.w > 300 && cs.h >= 280 && cs.h <= cs.w, 'canvas sized for mobile: ' + JSON.stringify(cs));
      const tcVisible = await page.$eval('.g-platformer .touch-controls', (el) => getComputedStyle(el).display !== 'none');
      assert(tcVisible, 'touch controls visible on touch device');
      await shot(page, 'platformer-mobile-intro.png');
      // tap Start with touch
      const sb = await page.$('.g-platformer .game-overlay button.btn-primary');
      const bb = await sb.boundingBox();
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      assert(await mode(page) === 'play', 'touch tap starts the game');
      // hold the right button via CDP touch events, press jump at the same time (multi-touch)
      const client = await context.newCDPSession(page);
      const rb = await (await page.$('.g-platformer .touch-controls [aria-label="Move right"]')).boundingBox();
      const jb = await (await page.$('.g-platformer .touch-controls [aria-label="Jump"]')).boundingBox();
      const R = { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2, id: 1 }, J = { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2, id: 2 };
      const mx0 = await dbg(page, () => PQ.debug.platformer.state.player.x);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [R] });
      await page.waitForTimeout(400);
      assert(await dbg(page, () => PQ.debug.platformer.state.input.right) === true, 'touch right button held');
      assert(await page.$eval('[aria-label="Move right"]', (b) => b.classList.contains('is-down')), 'button shows pressed state');
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [R, J] });
      await page.waitForTimeout(80);
      const jumped = await dbg(page, () => !PQ.debug.platformer.state.player.onGround);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [J] }); // lift the jump finger only (touchEnd lists released points)
      await page.waitForTimeout(300);
      assert(await dbg(page, () => PQ.debug.platformer.state.input.right) === true, 'right still held after lifting jump finger (multi-touch safe)');
      await shot(page, 'platformer-mobile-play.png');
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [R] }); // now release right
      await page.waitForTimeout(100);
      const mx1 = await dbg(page, () => PQ.debug.platformer.state.player.x);
      assert(mx1 > mx0 + 50, 'touch moved the player: ' + mx0 + ' → ' + mx1);
      assert(jumped, 'touch jump button jumps');
      assert(await dbg(page, () => PQ.debug.platformer.state.input.right) === false, 'touch release stops movement');
      // question modal fits on mobile (first put the hero back on the start pad so a long hold under CPU load cannot have killed it)
      await page.waitForFunction(() => { const s = PQ.debug.platformer.state; return s && (s.mode === 'play' || s.mode === 'dead'); }, null, { timeout: 3000 });
      await page.waitForFunction(() => PQ.debug.platformer.state.mode === 'play', null, { timeout: 4000 });
      await dbg(page, () => { const s = PQ.debug.platformer.state; s.player.x = 100; s.player.y = 310; s.player.vx = 0; s.player.vy = 0; s.hearts = 3; });
      await page.waitForTimeout(120);
      await dbg(page, () => PQ.debug.platformer.setEnergy(0));
      await page.waitForSelector('.modal-backdrop .quiz', { timeout: 3000 });
      const mw = await page.$eval('.modal-backdrop .modal', (m) => m.getBoundingClientRect().width);
      assert(mw <= 390, 'modal fits mobile width: ' + mw);
      await shot(page, 'platformer-mobile-question.png');
      const ma = await answer(page, 'correct');
      assert(ma.status === 'correct', 'mobile answer');
      assert(await mode(page) === 'play', 'mobile resumes');
      // game over panel must fit inside the stage on mobile (buttons reachable)
      for (let i = 0; i < 3; i++) { await dbg(page, () => PQ.debug.platformer.kill()); await page.waitForTimeout(1050); }
      assert(await mode(page) === 'over', 'mobile game over');
      await page.waitForSelector('.g-platformer .game-overlay button.btn-primary');
      const fit = await page.evaluate(() => { const s = document.querySelector('.g-platformer-stage').getBoundingClientRect(); const b = document.querySelector('.g-platformer .game-overlay button.btn-primary').getBoundingClientRect(); return b.top >= s.top && b.bottom <= s.bottom && b.left >= s.left && b.right <= s.right; });
      assert(fit, 'Retry button fully inside the stage on mobile');
      await shot(page, 'platformer-mobile-gameover.png');
      const rb2 = await (await page.$('.g-platformer .game-overlay button.btn-primary')).boundingBox();
      await page.touchscreen.tap(rb2.x + rb2.width / 2, rb2.y + rb2.height / 2);
      assert(await mode(page) === 'play', 'touch Retry restarts');
      // unmount / remount on mobile
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(150);
      await page.evaluate(() => { location.hash = '#/play/platformer'; });
      await page.waitForSelector('.g-platformer canvas');
      assert(await mode(page) === 'intro', 'mobile remount ok');
      assert(errors.length === 0, 'console errors (mobile): ' + errors.join('\n'));
      console.log('mobile: OK');
    } finally {
      await browser.close();
    }
  }
  // ---------------- regression checks (round-1 review findings) ----------------
  {
    const { browser, page, errors } = await launch();
    try {
      await page.goto(SITE + '#/play/platformer'); await page.waitForSelector('.g-platformer canvas');
      await dbg(page, () => { PQ.Progress.reset(); PQ.Settings.set('cats', null); });
      // every generated floating platform is landable (jump apex ≈ 117px)
      const maxH = await dbg(page, () => { let m = 0; for (let l = 1; l <= 12; l++) for (const p of PQ.debug.platformer.generate(l).platforms) if (!p.ground) m = Math.max(m, 350 - p.y); return m; });
      assert(maxH <= 110, 'floating platforms reachable, max height ' + maxH);
      // fresh run shows 0 score / 0 m, and an untouched run is never persisted
      const hud0 = await page.textContent('.g-platformer-hud');
      assert(/Score0/.test(hud0) && /Dist0m/.test(hud0), 'fresh HUD starts at 0: ' + hud0);
      // holding → on the intro starts the run AND keeps the hero moving
      await page.keyboard.down('ArrowRight'); await page.waitForTimeout(500);
      assert(await mode(page) === 'play' && (await dbg(page, () => PQ.debug.platformer.state.player.x)) > 100, 'held → at intro moves the hero');
      await page.keyboard.up('ArrowRight');
      // Space on the pause overlay: ignored for the first 400ms (mashed keys), then resumes; never scrolls the page
      await page.keyboard.press('KeyP'); await page.waitForTimeout(80); await page.keyboard.press('Space'); await page.waitForTimeout(80);
      assert(await mode(page) === 'pause', 'overlay shortcut not armed yet');
      await page.waitForTimeout(400); await page.keyboard.press('Space'); await page.waitForTimeout(80);
      assert((await dbg(page, () => window.scrollY)) === 0 && await mode(page) === 'play', 'Space resumes without scrolling');
      // Restart from the pause panel persists the run and counts a play
      await page.keyboard.press('KeyP'); await page.waitForTimeout(80);
      await page.click('.g-platformer-overlay button:has-text("Restart")'); await page.waitForTimeout(100);
      const gs = await dbg(page, () => PQ.Progress.gameStats('platformer'));
      assert(gs.plays === 1 && gs.best > 0, 'restart persisted the run: ' + JSON.stringify(gs));
      // the word just asked is not asked again right after a restart; jump buffer does not survive a question;
      // a key still held when the question closes keeps the hero moving
      await dbg(page, () => PQ.Settings.set('cats', ['useful']));
      await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100);
      await dbg(page, () => { PQ.debug.platformer.state.energy = 0; PQ.debug.platformer.state.player.buffer = 0.12; });
      await page.waitForSelector('.modal-backdrop .quiz');
      const firstId = await dbg(page, () => PQ.debug.platformer.state.question.entry.id);
      assert((await dbg(page, () => PQ.debug.platformer.state.player.buffer)) === 0, 'jump buffer cleared when a question opens');
      const xq = await dbg(page, () => PQ.debug.platformer.state.player.x);
      await answer(page, 'wrong'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      assert(await mode(page) === 'play', 'back to play after the question');
      assert((await dbg(page, () => PQ.debug.platformer.state.player.vy)) > -50, 'no involuntary jump after the question');
      assert((await dbg(page, () => PQ.debug.platformer.state.player.x)) - xq > 20, 'held → keeps moving after the question');
      await page.keyboard.up('ArrowRight');
      await page.keyboard.press('KeyP'); await page.waitForTimeout(80); await page.click('.g-platformer-overlay button:has-text("Restart")'); await page.waitForTimeout(100);
      assert((await dbg(page, () => PQ.debug.platformer.state.recent)).includes(firstId), 'recent words carried across restart');
      await dbg(page, () => PQ.Settings.set('cats', null));
      // energy does not drain while pushing against the world edge
      await dbg(page, () => { const s = PQ.debug.platformer.state; s.player.x = 0; s.player.vx = 0; s.energy = 50; });
      await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(600); await page.keyboard.up('ArrowLeft');
      assert(Math.round(await dbg(page, () => PQ.debug.platformer.state.energy)) === 50, 'no drain while blocked');
      // hearts are stable DOM nodes whose animation actually runs
      const ha = await dbg(page, async () => { const el = document.querySelector('.g-platformer-heart'); const a = el.getAnimations()[0]; const t0 = a ? a.currentTime : -1; await new Promise((r) => setTimeout(r, 250)); return { adv: a ? a.currentTime - t0 : -1, same: el === document.querySelector('.g-platformer-heart') }; });
      assert(ha.same && ha.adv > 100, 'heart animation runs: ' + JSON.stringify(ha));
      // Best badge matches the level-complete panel
      await dbg(page, () => { PQ.debug.platformer.setEnergy(100); PQ.debug.platformer.teleportToFlag(); });
      await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1500); await page.keyboard.up('ArrowRight'); await page.waitForTimeout(900);
      const cp = await dbg(page, () => ({ mode: PQ.debug.platformer.state.mode, badge: document.querySelector('.g-platformer-best').textContent, panel: (document.querySelector('.g-platformer-overlay .stat:last-child .stat-val') || {}).textContent }));
      assert(cp.mode === 'complete' && cp.badge === 'Best ' + cp.panel, 'best badge in sync at level complete: ' + JSON.stringify(cp));
      // mounting twice never leaves two shells / loops
      const dm = await dbg(page, () => { const g = PQ.Games.get('platformer'); const div = document.createElement('div'); document.body.appendChild(div); g.mount(div, PQ.Router.ctx()); const shells = document.querySelectorAll('.g-platformer').length; g.unmount(); const after = document.querySelectorAll('.g-platformer').length; div.remove(); return { shells, after }; });
      assert(dm.shells === 1 && dm.after === 0, 'double mount guarded: ' + JSON.stringify(dm));
      assert(errors.length === 0, 'console errors (regressions): ' + errors.join('\n'));
      console.log('regressions: OK');
    } finally { await browser.close(); }
  }
  {
    // mobile HUD keeps a fixed height whatever the score / streak
    const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    try {
      await page.goto(SITE + '#/play/platformer'); await page.waitForSelector('.g-platformer canvas');
      await dbg(page, () => PQ.debug.platformer.start());
      const h1 = await dbg(page, () => document.querySelector('.g-platformer-hud').getBoundingClientRect().height);
      await dbg(page, () => { const s = PQ.debug.platformer.state; s.questionPts = 99999; s.maxX = 9995; s.streak = 12; }); await page.waitForTimeout(150);
      const h2 = await dbg(page, () => document.querySelector('.g-platformer-hud').getBoundingClientRect().height);
      assert(Math.abs(h1 - h2) < 1, 'mobile HUD height stable: ' + h1 + ' vs ' + h2);
      assert((await dbg(page, () => document.documentElement.scrollWidth <= document.documentElement.clientWidth)), 'no horizontal overflow with a big score');
      assert(errors.length === 0, 'console errors (mobile hud): ' + errors.join('\n'));
    } finally { await browser.close(); }
  }
  console.log('ALL PLATFORMER TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
