/* Whole-site integration test: every route, every game, mount/unmount churn, leaks, overflow.
   Run: node tests/browser.test.js */
const { launch, assert, SITE } = require('./helpers');

const ROUTES = ['#/', '#/words', '#/stats', '#/play/platformer', '#/play/spell', '#/play/accent', '#/play/blaster', '#/play/flash'];
const GAMES = ['platformer', 'spell', 'accent', 'blaster', 'flash'];

const go = async (page, hash, ms) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(ms || 250); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Answer the question object q (from a module's debug hook) through real input. Returns the status. */
async function answerQuestion(page, q, scope) {
  scope = scope || '';
  if (q.kind === 'typed') { await page.click(scope + ' input.input'); await page.keyboard.type(q.canonical); await page.keyboard.press('Enter'); }
  else if (q.kind === 'choice' || q.kind === 'meaning') { const i = q.options.findIndex((o) => o.correct); await page.click(scope + ' .quiz-option[data-idx="' + i + '"]'); }
  else if (q.kind === 'accent') { for (const i of q.needs) await page.click(scope + ' .quiz-letter[data-idx="' + i + '"]'); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(120);
  const fb = await page.$(scope + ' .quiz-feedback');
  assert(fb, 'feedback shown after answering (' + q.kind + ')');
  const cls = await fb.getAttribute('class');
  assert(/\bok\b/.test(cls), 'correct answer graded as correct: ' + cls + ' for ' + q.canonical);
  const cont = await page.$(scope + ' .quiz-actions .btn-primary');
  if (cont) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
}

async function run(viewport, touch) {
  const { browser, page, errors } = await launch({ viewport, touch, mobile: touch });
  const label = viewport.width + 'px';
  try {
    await page.goto(SITE); await page.waitForTimeout(300);
    await page.evaluate(() => { PQ.Progress.reset(); PQ.Settings.set('cats', null); PQ.Settings.set('sound', false); });

    // ---- home ----
    const cards = await page.$$eval('.game-card', (els) => els.map((a) => a.getAttribute('href')));
    assert(cards.length === 5, label + ': 5 game cards, got ' + cards.length);
    const startHref = await page.$eval('a.btn-primary.btn-lg', (a) => a.getAttribute('href'));
    assert(GAMES.some((g) => startHref === '#/play/' + g), label + ': Start playing links to a game: ' + startHref);
    assert(await page.evaluate(() => PQ.Games.all().length === 5 && PQ.Vocab.all().length === 44), label + ': 5 games, 44 words registered');

    // ---- every route: no console errors, no horizontal overflow ----
    for (const r of ROUTES) {
      await go(page, r, 400);
      const ov = await overflow(page);
      assert(ov <= 0, label + ': horizontal overflow of ' + ov + 'px on ' + r);
      assert(errors.length === 0, label + ': console errors on ' + r + ': ' + errors.join('\n'));
    }

    // ---- platformer: energy question, answered for real ----
    await go(page, '#/play/platformer', 400);
    await page.evaluate(() => PQ.debug.platformer.start());
    await page.evaluate(() => PQ.debug.platformer.setEnergy(0));
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 4000 });
    const pq = await page.evaluate(() => { const q = PQ.debug.platformer.state.question.ctl.question; return { kind: q.kind, canonical: q.canonical, needs: q.needs, options: q.options, cat: q.entry.cat, id: q.entry.id }; });
    await answerQuestion(page, pq, '.modal-backdrop');
    assert(await page.evaluate(() => PQ.debug.platformer.state.mode === 'play' && PQ.debug.platformer.state.energy >= 40), label + ': energy recharged after a correct answer');
    assert(await page.evaluate(() => !document.querySelector('.modal-backdrop')), label + ': question modal closed');

    // ---- spell: category filter restricts the round; XP pill updates ----
    const xpBefore = await page.textContent('#xpPill');
    await page.evaluate(() => PQ.Settings.set('cats', ['question']));
    await go(page, '#/play/spell', 400);
    await page.evaluate(() => PQ.debug.spell.start('quick'));
    await page.waitForSelector('.g-spell .quiz', { timeout: 4000 });
    for (let i = 0; i < 3; i++) {
      const q = await page.evaluate(() => { const q = PQ.debug.spell.ctl.question; return { kind: q.kind, canonical: q.canonical, needs: q.needs, options: q.options, cat: q.entry.cat }; });
      assert(q.cat === 'question', label + ': category filter respected in Spell Forge, got ' + q.cat);
      await answerQuestion(page, q, '.g-spell');
    }
    await page.evaluate(() => PQ.Settings.set('cats', null));
    const xpAfter = await page.textContent('#xpPill');
    assert(xpBefore !== xpAfter, label + ': XP pill updates (' + xpBefore + ' → ' + xpAfter + ')');

    // ---- accent: one placement question ----
    await go(page, '#/play/accent', 400);
    await page.evaluate(() => PQ.debug.accent.start('zen'));
    await page.waitForSelector('.g-accent .quiz', { timeout: 4000 });
    const aq = await page.evaluate(() => { const q = PQ.debug.accent.ctl.question; return { kind: q.kind, canonical: q.canonical, needs: q.needs, options: q.options }; });
    await answerQuestion(page, aq, '.g-accent');

    // ---- blaster: destroy one meteor by typing ----
    await go(page, '#/play/blaster', 400);
    await page.evaluate(() => PQ.debug.blaster.start());
    await page.waitForFunction(() => PQ.debug.blaster.listMeteors().length > 0, null, { timeout: 5000 });
    const target = await page.evaluate(() => { const m = PQ.debug.blaster.listMeteors()[0]; return PQ.Vocab.byId(m.entryId).base; });
    await page.click('.g-blaster input');
    await page.keyboard.type(target); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    assert(await page.evaluate(() => PQ.debug.blaster.state.score > 0), label + ': Word Rain scored a hit');
    await page.evaluate(() => PQ.debug.blaster.pause());

    // ---- flash: flip + rate ----
    await go(page, '#/play/flash', 400);
    await page.evaluate(() => PQ.debug.flash.start('all'));
    await page.waitForTimeout(300);
    await page.evaluate(() => PQ.debug.flash.flip()); await page.waitForTimeout(600);
    const before = await page.evaluate(() => PQ.Progress.totals().answers);
    await page.evaluate(() => PQ.debug.flash.rate(3)); await page.waitForTimeout(300);
    assert((await page.evaluate(() => PQ.Progress.totals().answers)) === before + 1, label + ': flashcard rating recorded once');

    // ---- words page practice modal ----
    await go(page, '#/words', 400);
    assert((await page.$$('.word-row')).length === 44, label + ': 44 words listed');
    await page.click('.word-row button:has-text("Practice")');
    await page.waitForSelector('.modal-backdrop .quiz', { timeout: 4000 });
    const kind = await page.$eval('.modal-backdrop .quiz', (el) => el.getAttribute('data-kind'));
    assert(['typed', 'choice', 'accent', 'meaning'].includes(kind), label + ': practice modal shows a question');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert(!(await page.$('.modal-backdrop')), label + ': practice modal closes with Escape');

    // ---- progress reflected on home + stats ----
    await go(page, '#/', 400);
    assert((await page.$$('.word-row')).length >= 1, label + ': home lists trickiest words after play');
    await go(page, '#/stats', 400);
    const statsText = await page.textContent('#app');
    assert(/Energy Run|Spell Forge/.test(statsText) && !/NaN/.test(statsText), label + ': stats page renders game records without NaN');

    // ---- mount/unmount churn: nothing left running ----
    await page.evaluate(() => { window.__raf = 0; const o = window.requestAnimationFrame; window.requestAnimationFrame = function (cb) { window.__raf++; return o.call(window, cb); }; });
    for (let round = 0; round < 3; round++) for (const g of GAMES) { await go(page, '#/play/' + g, 120); }
    await go(page, '#/', 600);
    await page.evaluate(() => { window.__raf = 0; });
    await page.waitForTimeout(700);
    const raf = await page.evaluate(() => window.__raf);
    assert(raf === 0, label + ': no RAF loops after leaving the games (' + raf + ' frames requested on the home page)');
    const leftovers = await page.evaluate(() => ({ modals: document.querySelectorAll('.modal-backdrop').length, overlays: document.querySelectorAll('.game-overlay').length, shells: document.querySelectorAll('.game-shell').length }));
    assert(leftovers.modals === 0 && leftovers.overlays === 0 && leftovers.shells === 0, label + ': leftovers after churn: ' + JSON.stringify(leftovers));
    // keyboard listeners from games must be gone: pressing game keys on the home page does nothing / throws nothing
    for (const k of ['ArrowRight', 'Space', 'KeyP', 'Escape', 'Enter', 'Digit1', 'KeyN']) await page.keyboard.press(k);
    await page.waitForTimeout(100);
    assert(errors.length === 0, label + ': console errors at the end: ' + errors.join('\n'));
    console.log(label + ': OK');
  } finally {
    await browser.close();
  }
}

(async () => {
  await run({ width: 1280, height: 800 }, false);
  await run({ width: 390, height: 844 }, true);
  console.log('ALL BROWSER TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
