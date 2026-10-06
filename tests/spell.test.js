/* Spell Forge — Playwright test.   Run: node tests/spell.test.js
   Screenshots go to $PQ_SHOTS (defaults to the OS temp dir). */
const os = require('os');
const path = require('path');
const { launch, assert, SITE } = require('./helpers');

const SHOTS = process.env.PQ_SHOTS || os.tmpdir();
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'spell-' + name + '.png'), fullPage: true });

/* ---------- helpers that talk to PQ.debug.spell ---------- */
const snap = (page) => page.evaluate(() => {
  const s = PQ.debug.spell.state;
  if (!s) return null;
  return {
    screen: s.screen, mode: s.mode, index: s.index, score: s.score, streak: s.streak, mult: s.mult,
    lives: s.lives === Infinity ? -1 : s.lives, accentSlips: s.accentSlips, xp: s.xp,
    total: s.round ? (s.round.total === Infinity ? -1 : s.round.total) : null,
    used: s.used ? Array.from(s.used) : [],
    answers: (s.answers || []).map((a) => ({ id: a.id, status: a.status, points: a.points, usedHint: a.usedHint, skipped: a.skipped, kind: a.kind })),
    missed: (s.missed || []).map((a) => a.id),
    accuracy: s.accuracy, newBest: s.newBest, reason: s.reason,
  };
});
const question = (page) => page.evaluate(() => {
  const c = PQ.debug.spell.ctl;
  if (!c) return null;
  const q = c.question;
  return { kind: q.kind, id: q.entry.id, canonical: q.canonical, correctIdx: q.options ? q.options.findIndex((o) => o.correct) : -1, needs: q.needs || null, answered: c.answered };
});
/** Force a specific question, choosing the first candidate word the round has not used yet (rounds never repeat a word). */
const force = (page, candidates, kind) => page.evaluate(([ids, k]) => {
  const used = PQ.debug.spell.state.used;
  const id = ids.find((x) => !used.has(x));
  if (!id) throw new Error('no unused candidate among ' + ids.join(','));
  PQ.debug.spell.force(id, k);
  return id;
}, [candidates, kind]);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Type an answer into the focused quiz input and submit with Enter. */
async function typeAnswer(page, text) {
  await page.waitForSelector('.g-spell-mount input:not(:disabled)');
  // The widget focuses the input a few ms after mounting; it must end up focused without any click.
  await page.waitForFunction(() => !!document.activeElement && document.activeElement.matches('.g-spell-mount input'), undefined, { timeout: 2000 })
    .catch((e) => { throw new Error('ASSERT: quiz input should be auto-focused (' + e.message.split('\n')[0] + ')'); });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-spell-mount .quiz-feedback');
}
/** Continue past the feedback with Enter (the widget's own keyboard handling). */
async function next(page) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);
}
/** Answer the current typed question correctly. */
async function answerCorrect(page) {
  const q = await question(page);
  assert(q && q.kind === 'typed', 'expected a typed question, got ' + JSON.stringify(q));
  await typeAnswer(page, q.canonical);
}

async function desktop() {
  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
  // Track live intervals so we can prove unmount leaves none running.
  await page.addInitScript(() => {
    const live = new Set();
    const si = window.setInterval, ci = window.clearInterval;
    window.setInterval = function () { const id = si.apply(window, arguments); live.add(id); return id; };
    window.clearInterval = function (id) { live.delete(id); return ci.call(window, id); };
    window.__liveIntervals = () => live.size;
  });
  await page.goto(SITE + '#/play/spell');
  await page.waitForSelector('.g-spell-start');

  // ---- Start screen ----
  const modeCount = await page.locator('.g-spell-mode').count();
  assert(modeCount === 4, 'four mode cards, got ' + modeCount);
  assert((await page.locator('.g-spell-cats .chip').count()) === 5, 'one chip per category');
  assert(await page.locator('.g-spell-toggle input').count() === 1, 'mix toggle present');
  assert(!(await page.locator('.g-spell-toggle input').isChecked()), 'mix toggle defaults to off');
  const registered = await page.evaluate(() => { const g = PQ.Games.get('spell'); return g && g.name + '|' + g.icon + '|' + g.order + '|' + g.accent; });
  assert(registered === 'Spell Forge|✍️|2|var(--c-mint)', 'registration: ' + registered);
  await shot(page, 'desktop-start');

  // ---- Quick 10 via click ----
  await page.click('.g-spell-mode[data-mode="quick"]');
  await page.waitForSelector('.g-spell-round .quiz');
  let s = await snap(page);
  assert(s.screen === 'round' && s.mode === 'quick' && s.total === 10 && s.index === 1, 'round started: ' + JSON.stringify(s));
  assert((await page.locator('.g-spell-progress-label').textContent()).includes('Question 1 of 10'), 'progress label');

  // The round timer runs, and pauses while the tab is hidden (visibilitychange)
  assert((await page.evaluate(() => window.__liveIntervals())) === 1, 'round timer interval running');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const tHidden = await page.evaluate(() => PQ.debug.spell.elapsed());
  await page.waitForTimeout(350);
  assert((await page.evaluate(() => PQ.debug.spell.elapsed())) === tHidden, 'timer paused while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(120);
  assert((await page.evaluate(() => PQ.debug.spell.elapsed())) > tHidden, 'timer resumed when visible');

  // Q1: correct answer
  await answerCorrect(page);
  s = await snap(page);
  assert(s.answers[0].status === 'correct' && s.answers[0].points >= 100 && s.score === s.answers[0].points, 'correct answer scored: ' + JSON.stringify(s.answers[0]));
  assert(s.streak === 1, 'streak 1');
  assert(await page.locator('.g-spell-float.is-ok').count() === 1, 'score float shown');
  assert(await page.locator('.quiz-feedback.ok').count() === 1, 'ok feedback');
  await next(page);

  // Q2: accent-only mistake (forced word with an accent)
  const accentWord = await force(page, ['frances', 'ingles', 'espanol', 'dificil', 'tecnologia'], 'typed');
  await typeAnswer(page, await page.evaluate((id) => PQ.Text.stripAccents(PQ.Vocab.byId(id).base), accentWord));
  s = await snap(page);
  assert(s.answers[1].status === 'accent' && s.answers[1].points === 20, 'accent slip: ' + JSON.stringify(s.answers[1]));
  assert(s.streak === 0 && s.accentSlips === 1, 'accent resets streak and counts a slip');
  const fb = await page.locator('.quiz-feedback.accent').textContent();
  const accentBase = await page.evaluate((id) => PQ.Vocab.byId(id).base, accentWord);
  assert(fb.includes(accentBase), 'accent feedback shows the correct spelling ' + accentBase + ': ' + fb);
  assert(await page.locator('.g-spell-tip:not(.hidden)').count() === 1, 'accent tip chip visible');
  assert((await page.locator('.g-spell-tip').textContent()).includes('1 accent slip'), 'tip chip counts slips');
  await shot(page, 'desktop-accent-feedback');
  await next(page);

  // Q3: wrong answer
  await force(page, ['facil', 'horario', 'cuando', 'quinto', 'arte'], 'typed');
  await typeAnswer(page, 'zzzz');
  s = await snap(page);
  assert(s.answers[2].status === 'wrong' && s.answers[2].points === 0, 'wrong answer scores 0');
  assert(await page.locator('.quiz-feedback.bad').count() === 1 && await page.locator('.g-spell-float.is-bad').count() === 1, 'bad feedback + miss float');
  await next(page);

  // Q4: hint halves the points
  await force(page, ['util', 'septimo', 'como', 'donde', 'sexto'], 'typed');
  await page.click('.g-spell-mount .quiz-actions button:has-text("Hint")');
  await answerCorrect(page);
  s = await snap(page);
  const hinted = s.answers[3];
  assert(hinted.status === 'correct' && hinted.usedHint && hinted.points >= 50 && hinted.points <= 75, 'hint halves points: ' + JSON.stringify(hinted));
  await next(page);

  // Q5: skip ("Don't know") counts as wrong + skipped
  await page.click('.g-spell-mount .quiz-actions button:has-text("Don\'t know")');
  await page.waitForSelector('.quiz-feedback.bad');
  s = await snap(page);
  assert(s.answers[4].status === 'wrong' && s.answers[4].skipped, 'skip recorded');
  await next(page);

  // Q6..Q10: all correct → streak multiplier kicks in at 3 (x2)
  for (let i = 5; i < 10; i++) {
    await answerCorrect(page);
    s = await snap(page);
    if (i === 7) assert(s.mult === 2 && (await page.locator('.g-spell-mult.is-on').count()) === 1, 'x2 at a streak of 3');
    if (i === 8) assert(s.answers[8].points >= 200, 'x2 applied to the 4th correct in a row: ' + s.answers[8].points);
    await next(page);
  }
  await page.waitForSelector('.g-spell-end');
  s = await snap(page);
  assert(s.screen === 'end' && s.answers.length === 10, 'round ended after 10: ' + JSON.stringify(s));
  const ids = s.answers.map((a) => a.id);
  assert(new Set(ids).size === 10, 'no word repeats within a round');
  assert(s.missed.length === 3, 'three missed words (accent, wrong, skipped): ' + s.missed);
  assert(await page.locator('.g-spell-miss').count() === 3, 'missed list rendered');
  assert(await page.locator('.g-spell-miss[data-status="accent"] .accent-char').count() >= 1, 'accents highlighted in the missed list');
  assert(await page.locator('.ring').count() === 1, 'accuracy ring');
  assert(await page.locator('.g-spell-retry').count() === 1, 'retry button');
  const speech = await page.evaluate(() => PQ.Speech.available());
  if (speech) {
    assert(await page.locator('.g-spell-say').count() === 3, 'speaker button per missed word');
    await page.click('.g-spell-say >> nth=0');
  }
  const stats = await page.evaluate(() => PQ.Progress.gameStats('spell'));
  assert(stats.plays === 1 && stats.best === s.score && stats.bests && stats.bests.quick === s.score && stats.mode === 'quick', 'best saved per mode: ' + JSON.stringify(stats));
  await page.waitForTimeout(1000); // let the score count-up finish
  const big = await page.locator('.g-spell-bigscore').textContent();
  assert(big.replace(/,/g, '') === String(s.score), 'big score shows ' + s.score + ' (got ' + big + ')');
  await shot(page, 'desktop-end');

  // ---- Retry missed words: exactly those words, in a round of 3 ----
  const missedIds = s.missed.slice();
  await page.click('.g-spell-retry');
  await page.waitForSelector('.g-spell-round .quiz');
  s = await snap(page);
  assert(s.mode === 'retry' && s.total === 3, 'retry round of 3: ' + JSON.stringify(s));
  for (let i = 0; i < 3; i++) { await answerCorrect(page); await next(page); }
  await page.waitForSelector('.g-spell-end');
  s = await snap(page);
  assert(s.answers.map((a) => a.id).sort().join() === missedIds.slice().sort().join(), 'retry used exactly the missed words');
  assert(s.accuracy === 1, 'perfect retry');
  await page.waitForTimeout(400);
  assert(await page.locator('.confetti-canvas').count() >= 1, 'confetti on a win');
  assert(await page.locator('.g-spell-clean').count() === 1, 'clean-sheet message when nothing was missed');

  // ---- Unmount / remount: navigate home then back ----
  await page.evaluate(() => PQ.Router.go('/'));
  await page.waitForSelector('.hero');
  assert(await page.locator('.g-spell').count() === 0, 'game DOM removed on unmount');
  assert(await page.evaluate(() => PQ.debug.spell.state === null && !PQ.debug.spell.mounted), 'state cleared on unmount');
  assert((await page.locator('.game-card:has-text("Spell Forge")').textContent()).includes('Best:'), 'home card shows the best score');
  await page.evaluate(() => PQ.Router.go('/play/spell'));
  await page.waitForSelector('.g-spell-start');
  assert((await page.locator('.g-spell-mode[data-mode="quick"] .g-spell-mode-best').textContent()).includes('best'), 'start screen shows the Quick 10 best');

  // ---- Keyboard shortcut starts Weak words (ordered weakest first) ----
  await page.keyboard.press('2');
  await page.waitForSelector('.g-spell-round .quiz');
  s = await snap(page);
  assert(s.mode === 'weak' && s.total === 10, 'weak mode via key 2: ' + JSON.stringify(s));
  const firstWeak = await question(page);
  const weakestIds = await page.evaluate(() => PQ.Progress.weakest(10, { pool: PQ.Vocab.active(), includeUnseen: true }).map((e) => e.id));
  assert(firstWeak.id === weakestIds[0], 'weak mode asks the weakest word first');

  // Esc opens the quit dialog; "Finish now" ends the round early
  await answerCorrect(page); await next(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal');
  await page.click('.modal button:has-text("Finish now")');
  await page.waitForSelector('.g-spell-end');
  s = await snap(page);
  assert(s.reason === 'quit' && s.answers.length === 1, 'finished early');
  assert(await page.locator('.modal-backdrop').count() === 0, 'modal closed');

  // ---- Category mode ----
  await page.click('.g-spell-end button:has-text("Home")');
  await page.waitForSelector('.hero');
  await page.goto(SITE + '#/play/spell');
  await page.waitForSelector('.g-spell-start');
  await page.click('.g-spell-cats .chip[data-cat="question"]');
  await page.waitForSelector('.g-spell-round .quiz');
  s = await snap(page);
  assert(s.mode === 'category' && s.total === 8, 'category round covers all 8 question words: ' + JSON.stringify(s));
  assert((await page.locator('.g-spell-modechip').textContent()).includes('Question words'), 'mode chip names the category');
  const catQ = await question(page);
  assert((await page.evaluate((id) => PQ.Vocab.byId(id).cat, catQ.id)) === 'question', 'question from the chosen category');

  // ---- Marathon with mixed question kinds, lives and the 3-miss ending ----
  await page.evaluate(() => PQ.debug.spell.start('marathon', { mix: true }));
  await page.waitForSelector('.g-spell-round .quiz');
  s = await snap(page);
  assert(s.mode === 'marathon' && s.lives === 3 && s.total === -1, 'marathon: ' + JSON.stringify(s));
  assert(await page.locator('.g-spell-heart').count() === 3, 'three hearts');

  // choice question answered with a number key
  await force(page, ['cual', 'quien', 'que'], 'choice');
  let q = await question(page);
  assert(q.kind === 'choice' && q.correctIdx >= 0, 'choice question forced');
  await page.keyboard.press(String(q.correctIdx + 1));
  await page.waitForSelector('.quiz-feedback.ok');
  s = await snap(page);
  assert(s.answers[0].status === 'correct' && s.answers[0].kind === 'choice', 'choice answered by number key');
  await next(page);

  // accent-placement question answered by tapping letters
  await force(page, ['tecnologia', 'matematicas', 'edfisica'], 'accent');
  q = await question(page);
  assert(q.kind === 'accent' && q.needs.length === 1, 'accent question forced');
  for (const idx of q.needs) await page.click('.quiz-letter[data-idx="' + idx + '"]');
  await page.click('.quiz-actions button:has-text("Confirm")');
  await page.waitForSelector('.quiz-feedback.ok');
  s = await snap(page);
  assert(s.answers[1].status === 'correct' && s.answers[1].kind === 'accent', 'accent question solved');
  await next(page);

  // three misses (wrong, accent, wrong) end the marathon
  await force(page, ['dificil', 'practico', 'estricto'], 'typed');
  await typeAnswer(page, 'qqqq');
  s = await snap(page);
  assert(s.lives === 2, 'life lost on a wrong answer');
  await next(page);
  const slipWord = await force(page, ['ingles', 'frances', 'espanol'], 'typed');
  await typeAnswer(page, await page.evaluate((id) => PQ.Text.stripAccents(PQ.Vocab.byId(id).base), slipWord));
  s = await snap(page);
  assert(s.lives === 1 && s.accentSlips === 1, 'accent slip also costs a life');
  await shot(page, 'desktop-marathon');
  await next(page);
  await force(page, ['horario', 'clase', 'almuerzo'], 'typed');
  await typeAnswer(page, 'qqqq');
  s = await snap(page);
  assert(s.lives === 0, 'no lives left');
  await next(page);
  await page.waitForSelector('.g-spell-end');
  s = await snap(page);
  assert(s.reason === 'lives' && s.answers.length === 5, 'marathon ended on the third miss: ' + JSON.stringify(s));
  assert((await page.locator('.g-spell-end .eyebrow').textContent()).includes('Out of lives'), 'end reason shown');

  // Mix toggle persists
  await page.click('.g-spell-end button:has-text("Home")');
  await page.waitForSelector('.hero');
  await page.goto(SITE + '#/play/spell');
  await page.waitForSelector('.g-spell-start');
  await page.click('.g-spell-toggle');
  assert(await page.locator('.g-spell-toggle input').isChecked(), 'toggle turned on');
  await page.reload();
  await page.waitForSelector('.g-spell-start');
  assert(await page.locator('.g-spell-toggle input').isChecked(), 'toggle remembered after reload');
  await page.click('.g-spell-mode[data-mode="quick"]');
  await page.waitForSelector('.g-spell-round .quiz');
  assert((await snap(page)).mode === 'quick' && (await page.evaluate(() => PQ.debug.spell.state.round.mix)) === true, 'mixed round started from the toggle');

  // Leaving mid-question must not leak: no RAF/interval/listeners, QuizUI destroyed
  await page.evaluate(() => PQ.Router.go('/'));
  await page.waitForSelector('.hero');
  assert(await page.locator('.quiz').count() === 0, 'quiz widget destroyed on unmount');
  assert((await page.evaluate(() => window.__liveIntervals())) === 0, 'no interval left running after unmount');
  await page.keyboard.press('Enter'); // would throw / navigate if a stale listener survived
  await page.keyboard.press('2');
  await page.waitForTimeout(200);
  assert(await page.locator('.g-spell').count() === 0, 'stale shortcuts do nothing after unmount');

  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  await browser.close();
  console.log('desktop ok');
}

async function mobile() {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  await page.goto(SITE + '#/play/spell');
  await page.waitForSelector('.g-spell-start');
  assert(await noOverflow(page), 'no horizontal overflow on the start screen');
  await shot(page, 'mobile-start');

  await page.tap('.g-spell-mode[data-mode="quick"]');
  await page.waitForSelector('.g-spell-round .quiz');
  assert(await noOverflow(page), 'no horizontal overflow in a round');

  // Touch: force an accented word, type the stem, tap the accent key, tap Check
  const word = await force(page, ['frances', 'ingles'], 'typed'); // francés / inglés: stem + é + s
  await page.waitForSelector('.g-spell-mount input:not(:disabled)');
  await page.tap('.g-spell-mount input');
  await page.keyboard.type(word === 'frances' ? 'franc' : 'ingl');
  await page.tap('.accent-key:has-text("é")');
  await page.keyboard.type('s');
  const val = await page.inputValue('.g-spell-mount input');
  assert(val === (word === 'frances' ? 'francés' : 'inglés'), 'accent key inserted at the caret: ' + val);
  await page.tap('.quiz-actions button:has-text("Check")');
  await page.waitForSelector('.quiz-feedback.ok');
  await shot(page, 'mobile-feedback');
  assert(await noOverflow(page), 'no horizontal overflow with feedback shown');
  await page.tap('.quiz-actions button:has-text("Continue")');
  await page.waitForSelector('.g-spell-mount input:not(:disabled)');
  const s = await snap(page);
  assert(s.index === 2 && s.answers.length === 1 && s.answers[0].status === 'correct', 'continued to question 2 by touch');

  // Quit via the touch button → dialog → finish
  await page.tap('.g-spell-round button:has-text("Quit")');
  await page.waitForSelector('.modal');
  await page.tap('.modal button:has-text("Finish now")');
  await page.waitForSelector('.g-spell-end');
  assert(await noOverflow(page), 'no horizontal overflow on the end screen');
  await shot(page, 'mobile-end');
  await page.tap('.g-spell-end button:has-text("Play again")');
  await page.waitForSelector('.g-spell-round .quiz');

  assert(errors.length === 0, 'console errors (mobile): ' + errors.join('\n'));
  await browser.close();
  console.log('mobile ok');
}

(async () => {
  await desktop();
  await mobile();
  console.log('ALL PASS: tests/spell.test.js');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
