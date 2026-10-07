/* Accent Hunter — Playwright test.   Run: node tests/accent.test.js
   Screenshots go to $PQ_SHOTS (defaults to the OS temp dir). */
const os = require('os');
const path = require('path');
const { launch, assert, SITE } = require('./helpers');

const SHOTS = process.env.PQ_SHOTS || os.tmpdir();
const shot = async (page, name) => {
  // A full-page capture draws the sticky header at the current scroll offset, so jump to the top (instantly: the site uses smooth scrolling).
  await page.evaluate(() => { const h = document.documentElement; const prev = h.style.scrollBehavior; h.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); h.style.scrollBehavior = prev; });
  await page.screenshot({ path: path.join(SHOTS, 'accent-' + name + '.png'), fullPage: true });
};
const log = (msg) => console.log('  · ' + msg);

/* ---------- helpers that talk to PQ.debug.accent ---------- */
const snap = (page) => page.evaluate(() => {
  const s = PQ.debug.accent.state;
  if (!s) return null;
  return {
    screen: s.screen, mode: s.mode, index: s.index, answered: s.answered, correct: s.correct, accentSlips: s.accentSlips, wrong: s.wrong,
    score: s.score, combo: s.combo, maxCombo: s.maxCombo, mult: s.mult, timeLeft: s.timeLeft, timeBonus: s.timeBonus, paused: s.paused,
    total: s.round ? (s.round.total === Infinity ? -1 : s.round.total) : null,
    lastId: s.round ? s.round.lastId : null,
    answers: (s.answers || []).map((a) => ({ id: a.id, status: a.status, points: a.points, kind: a.kind })),
    missed: (s.missed || []).map((a) => ({ id: a.id, status: a.status, expected: a.expected, input: a.input })),
    accuracy: s.accuracy, newBest: s.newBest, reason: s.reason,
  };
});
const question = (page) => page.evaluate(() => {
  const c = PQ.debug.accent.ctl;
  if (!c) return null;
  const q = c.question;
  return {
    kind: q.kind, id: q.entry.id, canonical: q.canonical, needs: q.needs || null, answered: c.answered,
    options: q.options ? q.options.map((o) => ({ text: o.text, correct: o.correct, trap: !o.correct && PQ.Text.stripAccents(o.text) === PQ.Text.stripAccents(q.canonical) })) : null,
  };
});
const force = (page, id) => page.evaluate((id) => { PQ.debug.accent.force(id); return !!PQ.debug.accent.ctl; }, id);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** Every element of this module lies inside the layout viewport (the shared header is outside the module's control). */
const moduleFits = (page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  return Array.from(document.querySelectorAll('.g-accent, .g-accent *:not(.g-accent-fx *)')).every((el) => { const r = el.getBoundingClientRect(); return r.right <= w + 1 && r.left >= -1; });
});
const settle = (page) => page.waitForTimeout(700);   // let entrance animations finish before a screenshot
/** Wait until the widget has moved on to question number `n`. */
const waitForIndex = (page, n) => page.waitForFunction((n) => { const s = PQ.debug.accent.state; return s && s.screen === 'round' && s.index === n && PQ.debug.accent.ctl && !PQ.debug.accent.ctl.answered; }, n, { timeout: 6000 });
const waitForEnd = (page) => page.waitForSelector('.g-accent-end', { timeout: 8000 });

/** Shared init script: track live RAF callbacks + intervals so unmount can be proven clean. */
const trackLoops = (page) => page.addInitScript(() => {
  const rafs = new Set(), ints = new Set();
  const raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (fn) { let id = 0; id = raf.call(window, function (t) { rafs.delete(id); fn(t); }); rafs.add(id); return id; };
  window.cancelAnimationFrame = function (id) { rafs.delete(id); return caf.call(window, id); };
  const si = window.setInterval, ci = window.clearInterval;
  window.setInterval = function () { const id = si.apply(window, arguments); ints.add(id); return id; };
  window.clearInterval = function (id) { ints.delete(id); return ci.call(window, id); };
  window.__liveRafs = () => rafs.size;
  window.__liveIntervals = () => ints.size;
  // Live document listeners (net adds minus removes) for the event types the module uses
  const live = new Map();
  const add = document.addEventListener, rem = document.removeEventListener;
  document.addEventListener = function (type, fn, opts) { live.set(type, (live.get(type) || 0) + 1); return add.call(document, type, fn, opts); };
  document.removeEventListener = function (type, fn, opts) { live.set(type, (live.get(type) || 0) - 1); return rem.call(document, type, fn, opts); };
  window.__liveListeners = () => ['keydown', 'keyup', 'visibilitychange'].map((t) => live.get(t) || 0).join('/');
});

async function desktop() {
  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
  await trackLoops(page);
  await page.goto(SITE + '#/play/accent');
  await page.waitForSelector('.g-accent-modes');

  // ---- Registration + start screen ----
  const registered = await page.evaluate(() => { const g = PQ.Games.get('accent'); return g && [g.name, g.icon, g.order, g.accent].join('|'); });
  assert(registered === 'Accent Hunter|🎯|3|var(--c-lav)', 'registration: ' + registered);
  assert((await page.locator('.g-accent-mode').count()) === 3, 'three mode cards');
  assert((await snap(page)).screen === 'start', 'start screen');
  assert(await noOverflow(page), 'no horizontal overflow on start');
  assert(await moduleFits(page), 'module fits the desktop viewport');
  assert((await page.locator('.g-accent.is-touch').count()) === 0, 'desktop is not flagged as touch');
  await shot(page, 'desktop-start');
  log('start screen ok');

  // ---- Blitz via click ----
  await page.click('.g-accent-mode[data-mode="blitz"]');
  await page.waitForSelector('.g-accent-mount .quiz[data-kind="accent"]');
  let s = await snap(page);
  assert(s.screen === 'round' && s.mode === 'blitz' && s.total === -1 && s.index === 1, 'blitz started: ' + JSON.stringify(s));
  assert(s.timeLeft > 59 && s.timeLeft <= 60, 'timer starts at 60s: ' + s.timeLeft);
  assert((await page.locator('.g-accent-timer').count()) === 1, 'time bar present');
  assert((await page.locator('.g-accent-float.is-go').count()) === 1, '"¡Vamos!" float');
  await page.waitForTimeout(250);
  s = await snap(page);
  assert(s.timeLeft < 59.95, 'timer is counting down: ' + s.timeLeft);
  log('blitz round started, timer running');

  // Q1: correct via mouse (francés → tile 5)
  await force(page, 'frances');
  let q = await question(page);
  assert(q.kind === 'accent' && q.id === 'frances' && JSON.stringify(q.needs) === '[5]', 'forced francés: ' + JSON.stringify(q));
  assert((await page.locator('.g-accent-mount .quiz-prompt').textContent()).includes('frances'), 'word shown without accents');
  const clock = () => page.evaluate(() => ({ t: PQ.debug.accent.state.timeLeft, now: performance.now() }));
  const before = await clock();
  await page.click('.g-accent-mount .quiz-letter[data-idx="5"]');
  assert((await page.locator('.g-accent-mount .quiz-letter[data-idx="5"]').textContent()) === 'é', 'tile toggled to é');
  await page.click('.g-accent-mount .quiz-actions button:has-text("Confirm")');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  const after = await clock();
  s = await snap(page);
  assert(s.answers[0].status === 'correct' && s.answers[0].points === 100 && s.score === 100, 'correct = +100: ' + JSON.stringify(s.answers[0]));
  assert(s.combo === 1 && s.mult === 1 && s.correct === 1, 'combo 1');
  // The clock kept running while we clicked: bonus = change in timeLeft + wall time that passed.
  const bonus = after.t - before.t + (after.now - before.now) / 1000;
  assert(s.timeBonus === 2 && bonus > 1.8 && bonus < 2.3, 'correct answer adds +2s (net ' + bonus.toFixed(2) + 's)');
  assert((await page.locator('.g-accent-float.is-ok').count()) === 1, '+100 float');
  assert((await page.locator('.g-accent-float.is-time').count()) === 1, '+2s float');
  assert((await page.locator('.g-accent-spark').count()) > 0, 'spark burst');
  assert((await page.locator('.g-accent-hud .g-accent-scorewrap .val').textContent()) === '100', 'HUD score');
  log('correct answer by mouse');

  // Q2: correct via keyboard (difícil → tile 3): → → → Space Enter
  await waitForIndex(page, 2);
  await force(page, 'dificil');
  q = await question(page);
  assert(JSON.stringify(q.needs) === '[3]', 'difícil needs [3]');
  assert((await page.locator('.g-accent-cursor').count()) === 0, 'cursor hidden until the keyboard is used');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert((await page.evaluate(() => PQ.debug.accent.cursor)) === 3, 'cursor moved to 3');
  assert((await page.locator('.g-accent-cursor').getAttribute('data-idx')) === '3', 'cursor highlight on tile 3');
  await page.keyboard.press(' ');
  assert((await page.locator('.g-accent-mount .quiz-letter[data-idx="3"]').textContent()) === 'í', 'Space toggled í');
  await page.keyboard.press(' ');
  assert((await page.locator('.g-accent-mount .quiz-letter[data-idx="3"]').textContent()) === 'i', 'Space toggles back');
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  assert((await page.evaluate(() => PQ.debug.accent.cursor)) === 6, 'cursor wraps around (7 tiles)');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  s = await snap(page);
  assert(s.score === 200 && s.combo === 2, 'keyboard answer scored: ' + JSON.stringify(s));
  await shot(page, 'desktop-round-correct');
  log('correct answer by keyboard');

  // Q3: accent-only mistake — N on a word that needs an accent
  await waitForIndex(page, 3);
  await force(page, 'ingles');
  await page.keyboard.press('n');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.accent');
  s = await snap(page);
  assert(s.answers[2].status === 'accent' && s.answers[2].points === 0 && s.score === 200, 'accent slip: ' + JSON.stringify(s.answers[2]));
  assert(s.combo === 0 && s.mult === 1 && s.accentSlips === 1, 'accent slip resets combo');
  assert(s.missed.length === 1 && s.missed[0].expected === 'inglés' && s.missed[0].input === 'ingles', 'missed list records inglés: ' + JSON.stringify(s.missed));
  assert((await page.locator('.g-accent-stage').getAttribute('class')).includes('is-shake'), 'screen shake on a miss');
  assert((await page.locator('.g-accent-float.is-bad').count()) === 1, 'miss float');
  const fb = await page.locator('.g-accent-mount .quiz-feedback.accent').textContent();
  assert(fb.includes('inglés'), 'feedback shows the correct spelling: ' + fb);
  assert((await page.locator('.g-accent-mount .quiz-letter.is-missed').count()) === 1, 'missed tile highlighted');
  await shot(page, 'desktop-round-accent');
  log('accent-only mistake');

  // Q4: "No accents needed" is the right call for a plain word
  await waitForIndex(page, 4);
  await force(page, 'arte');
  await page.keyboard.press('N');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  s = await snap(page);
  assert(s.answers[3].status === 'correct' && s.score === 300 && s.combo === 1, 'no-accent word correct: ' + JSON.stringify(s));
  log('"No accents needed" correct');

  // Q5: multiplier ×4 at a combo of 10 (fácil → tile 1)
  await waitForIndex(page, 5);
  await page.evaluate(() => PQ.debug.accent.setCombo(9));
  await force(page, 'facil');
  await page.click('.g-accent-mount .quiz-letter[data-idx="1"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  s = await snap(page);
  assert(s.combo === 10 && s.mult === 4 && s.answers[4].points === 400 && s.score === 700, '×4 multiplier: ' + JSON.stringify(s));
  const comboCls = await page.locator('.g-accent-combo').getAttribute('class');
  assert(comboCls.includes('is-on') && comboCls.includes('is-x4'), 'combo badge glows ×4: ' + comboCls);
  assert((await page.locator('.g-accent-combo').textContent()).includes('×4'), 'badge text');
  assert((await page.evaluate(() => [2, 3, 6, 10].map(PQ.debug.accent.multFor).join())) === '1,2,3,4', 'multiplier ladder');
  log('combo multiplier');

  // Never the same word twice in a row; the pool cycles before repeating
  const seq = await page.evaluate(() => { const out = []; for (let i = 0; i < 60; i++) out.push(PQ.debug.accent.pick().id); return out; });
  assert(seq.every((id, i) => i === 0 || id !== seq[i - 1]), 'no back-to-back repeats');
  const pools = await page.evaluate(() => ({ accented: PQ.debug.accent.state.round.accented.length, plain: PQ.debug.accent.state.round.plain.length }));
  const accentedSeen = await page.evaluate((seq) => seq.filter((id) => PQ.Text.hasAccent(PQ.Vocab.byId(id).base)).length, seq);
  assert(accentedSeen > seq.length * 0.55 && accentedSeen < seq.length * 0.95, 'roughly 75% accent words (' + accentedSeen + '/' + seq.length + ', pools ' + JSON.stringify(pools) + ')');
  log('word pool mixing ok');

  // Tab hidden → timer pauses; visible → resumes
  await waitForIndex(page, 6);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const tHidden = (await snap(page)).timeLeft;
  await page.waitForTimeout(300);
  assert((await snap(page)).paused === true && (await snap(page)).timeLeft === tHidden, 'timer paused while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(150);
  assert((await snap(page)).timeLeft < tHidden, 'timer resumed');
  log('visibility pause');

  // Low time: red bar + ticks; then time runs out → end screen
  await page.evaluate(() => PQ.debug.accent.setTime(9.4));
  await page.waitForTimeout(120);
  assert((await page.locator('.g-accent-timer').getAttribute('class')).includes('is-low'), 'timer bar turns red under 10s');
  assert((await page.locator('.g-accent-time').getAttribute('class')).includes('is-low'), 'readout turns red');
  await page.evaluate(() => PQ.debug.accent.setTime(0.3));
  await waitForEnd(page);
  s = await snap(page);
  assert(s.screen === 'end' && s.reason === 'time', 'round ended on time: ' + s.reason);
  assert(s.answered === 5 && s.correct === 4 && Math.round(s.accuracy * 100) === 80, 'accuracy 80%: ' + JSON.stringify(s));
  assert(s.newBest === true, 'first round is a new best');
  assert((await page.evaluate(() => PQ.Progress.best('accent'))) === 700, 'Progress.setBest stored 700');
  assert((await page.evaluate(() => PQ.Progress.gameStats('accent').mode)) === 'blitz', 'mode stored with the best');
  assert((await page.locator('.confetti-canvas').count()) === 1, 'confetti on a new best');
  assert((await page.locator('.g-accent-newbest').count()) === 1, 'new best badge');
  assert((await page.locator('.g-accent-miss').count()) === 1, 'one missed word listed');
  const missHtml = await page.locator('.g-accent-miss-es').innerHTML();
  assert(missHtml.includes('accent-char') && missHtml.includes('é'), 'missed word has the accent highlighted: ' + missHtml);
  assert((await page.locator('.g-accent-miss-typed').textContent()).includes('ingles'), 'shows what the learner had');
  const speechAvail = await page.evaluate(() => PQ.Speech.available());
  if (speechAvail) { assert((await page.locator('.g-accent-say').count()) === 1, '🔊 button'); await page.click('.g-accent-say'); }
  await page.waitForTimeout(1000);
  assert((await page.locator('.g-accent-final-score').textContent()) === '700', 'score counted up to 700');
  await shot(page, 'desktop-end');
  log('end screen');

  // Play again → fresh blitz round
  await page.click('.g-accent-actions button:has-text("Play again")');
  await page.waitForSelector('.g-accent-mount .quiz');
  s = await snap(page);
  assert(s.screen === 'round' && s.mode === 'blitz' && s.score === 0 && s.answered === 0 && s.timeLeft > 59, 'play again: ' + JSON.stringify(s));

  // ---- Navigate away: unmount leaves nothing running ----
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.hero');
  await page.waitForFunction(() => !document.querySelector('.confetti-canvas'), undefined, { timeout: 5000 });
  await page.waitForTimeout(150);
  assert((await page.evaluate(() => PQ.debug.accent.mounted)) === false, 'unmounted');
  assert((await page.evaluate(() => PQ.debug.accent.state)) === null, 'state cleared');
  assert((await page.locator('.g-accent').count()) === 0, 'DOM removed');
  assert((await page.evaluate(() => window.__liveRafs())) === 0, 'no RAF loops after unmount');
  assert((await page.evaluate(() => window.__liveIntervals())) === 0, 'no intervals after unmount');
  assert((await page.evaluate(() => document.querySelectorAll('.modal-backdrop').length)) === 0, 'no modals left');
  // Keys after unmount are harmless
  await page.keyboard.press('ArrowRight'); await page.keyboard.press(' '); await page.keyboard.press('n'); await page.keyboard.press('1');
  await page.waitForTimeout(100);
  assert((await page.evaluate(() => PQ.debug.accent.mounted)) === false, 'keys after unmount do nothing');
  const listenersAfterFirstUnmount = await page.evaluate(() => window.__liveListeners());
  log('unmount clean');

  // ---- Remount → Zen via the "2" key ----
  await page.evaluate(() => { location.hash = '#/play/accent'; });
  await page.waitForSelector('.g-accent-modes');
  assert((await page.locator('.g-accent-mode[data-mode="blitz"] .g-accent-mode-best').textContent()).includes('700'), 'start screen shows the blitz best');
  await page.keyboard.press('2');
  await page.waitForSelector('.g-accent-mount .quiz[data-kind="accent"]');
  s = await snap(page);
  assert(s.mode === 'zen' && s.total === 15 && s.index === 1, 'zen round of 15: ' + JSON.stringify(s));
  assert((await page.locator('.g-accent-timer').count()) === 0 && (await page.locator('.g-accent-progress').count()) === 1, 'zen has a progress bar, no timer');
  assert((await page.locator('.g-accent-hud').textContent()).includes('1 / 15'), 'progress label');
  assert((await page.evaluate(() => window.__liveRafs())) === 0, 'no timer loop in zen');
  await force(page, 'tecnologia');
  q = await question(page);
  assert(JSON.stringify(q.needs) === '[8]', 'tecnología needs [8]: ' + JSON.stringify(q.needs));
  await page.click('.g-accent-mount .quiz-letter[data-idx="8"]');
  await page.click('.g-accent-mount .quiz-actions button:has-text("Confirm")');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  await waitForIndex(page, 2);
  assert((await page.locator('.g-accent-hud').textContent()).includes('2 / 15'), 'progress advanced');

  // Esc → quit dialog; Enter keeps playing (and must NOT confirm the question behind it)
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);
  assert((await page.locator('.modal-backdrop').count()) === 0, 'Enter closes the dialog');
  q = await question(page);
  assert(q && !q.answered, 'question behind the dialog was not confirmed');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop');
  await shot(page, 'desktop-quit-modal');
  await page.click('.modal button:has-text("Finish now")');
  await waitForEnd(page);
  s = await snap(page);
  assert(s.reason === 'quit' && s.answered === 1 && s.correct === 1, 'quit → end screen: ' + JSON.stringify(s));
  assert((await page.locator('.g-accent-clean').count()) === 1, 'flawless message when nothing was missed');
  await page.click('.g-accent-actions button:has-text("Change mode")');
  await page.waitForSelector('.g-accent-modes');
  log('zen + quit dialog');

  // ---- Spot the spelling (multiple choice, number keys) ----
  await page.click('.g-accent-mode[data-mode="spot"]');
  await page.waitForSelector('.g-accent-mount .quiz[data-kind="choice"]');
  s = await snap(page);
  assert(s.mode === 'spot' && s.total === 12, 'spot round of 12');
  q = await question(page);
  assert(q.options.length === 4, 'four options');
  await page.keyboard.press(String(q.options.findIndex((o) => o.correct) + 1));
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  s = await snap(page);
  assert(s.answers[0].status === 'correct' && s.answers[0].kind === 'choice' && s.score === 100, 'number key picks the correct spelling');

  // accent trap → 'accent'; a non-accent distractor → 'wrong'
  await waitForIndex(page, 2);
  let trapIdx = -1, wrongIdx = -1;
  for (let tries = 0; tries < 12 && (trapIdx < 0 || wrongIdx < 0); tries++) {
    await force(page, 'frances');
    q = await question(page);
    trapIdx = q.options.findIndex((o) => o.trap);
    wrongIdx = q.options.findIndex((o) => !o.correct && !o.trap);
  }
  assert(trapIdx >= 0 && wrongIdx >= 0, 'options include both an accent trap and a wrong spelling: ' + JSON.stringify(q.options));
  await page.click('.g-accent-mount .quiz-option[data-idx="' + trapIdx + '"]');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.accent');
  s = await snap(page);
  assert(s.answers[1].status === 'accent' && s.combo === 0, 'accent trap counts as an accent slip');
  await waitForIndex(page, 3);
  for (let tries = 0; tries < 12; tries++) {
    await force(page, 'frances');
    q = await question(page);
    wrongIdx = q.options.findIndex((o) => !o.correct && !o.trap);
    if (wrongIdx >= 0) break;
  }
  assert(wrongIdx >= 0, 'a wrong spelling is offered');
  await page.click('.g-accent-mount .quiz-option[data-idx="' + wrongIdx + '"]');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.bad');
  s = await snap(page);
  assert(s.answers[2].status === 'wrong' && s.wrong === 1 && s.missed.length === 2, 'wrong pick recorded: ' + JSON.stringify(s.answers[2]));
  assert((await page.locator('.g-accent-stage').getAttribute('class')).includes('is-shake'), 'shake on wrong');
  await shot(page, 'desktop-spot-wrong');
  await page.evaluate(() => PQ.debug.accent.endRound());
  await waitForEnd(page);
  s = await snap(page);
  assert(s.mode === 'spot' && s.missed.length === 2 && (await page.locator('.g-accent-miss[data-status="wrong"]').count()) === 1, 'spot end screen lists both misses');
  log('spot the spelling');

  // ---- Second unmount: nothing accumulated across mount → play → unmount cycles ----
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.hero');
  await page.waitForFunction(() => !document.querySelector('.confetti-canvas'), undefined, { timeout: 5000 });
  await page.waitForTimeout(150);
  const listenersAfterSecondUnmount = await page.evaluate(() => window.__liveListeners());
  assert(listenersAfterSecondUnmount === listenersAfterFirstUnmount, 'document listeners do not accumulate (' + listenersAfterFirstUnmount + ' vs ' + listenersAfterSecondUnmount + ')');
  assert((await page.evaluate(() => window.__liveRafs() + window.__liveIntervals())) === 0, 'no loops after the second unmount');
  log('second unmount clean');

  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  await browser.close();
}

async function mobile() {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  await page.goto(SITE + '#/play/accent');
  await page.waitForSelector('.g-accent-modes');
  const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (docOverflow > 1) console.log('  ! note: the page is ' + docOverflow + 'px wider than the 390px viewport (shared site header), outside this module');
  assert(await moduleFits(page), 'mobile start: module fits the viewport');
  assert((await page.locator('.g-accent.is-touch').count()) === 1, 'touch device flagged on the shell');
  assert(await page.locator('.g-accent-touchhint').first().isVisible(), 'touch hint shown');
  assert(!(await page.locator('.g-accent-keys .kbd').first().isVisible()), 'keyboard hints hidden on touch');
  await settle(page);
  await shot(page, 'mobile-start');

  await page.tap('.g-accent-mode[data-mode="blitz"]');
  await page.waitForSelector('.g-accent-mount .quiz[data-kind="accent"]');
  assert(await moduleFits(page), 'mobile round: module fits the viewport');
  // A long two-word entry wraps its tiles without overflowing
  await force(page, 'edfisica');   // educación física: two accents, a space, 16 tiles
  assert(await moduleFits(page), 'mobile long word: tiles wrap inside the viewport');
  const needs = (await question(page)).needs;
  assert(JSON.stringify(needs) === '[7,11]', 'educación física needs [7,11]: ' + JSON.stringify(needs));
  for (const i of needs) await page.tap('.g-accent-mount .quiz-letter[data-idx="' + i + '"]');
  await settle(page);
  await shot(page, 'mobile-round');
  await page.tap('.g-accent-mount .quiz-actions button:has-text("Confirm")');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  let s = await snap(page);
  assert(s.score === 100 && s.correct === 1, 'touch answer scored');
  await waitForIndex(page, 2);
  await force(page, 'quien');
  await page.tap('.g-accent-mount .quiz-actions button:has-text("No accents needed")');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.accent');
  s = await snap(page);
  assert(s.accentSlips === 1, 'touch accent slip');
  await settle(page);
  await shot(page, 'mobile-accent');
  await page.evaluate(() => PQ.debug.accent.setTime(0.2));
  await waitForEnd(page);
  assert(await moduleFits(page), 'mobile end: module fits the viewport');
  await page.waitForTimeout(1200);
  await shot(page, 'mobile-end');

  // Spot mode on touch
  await page.tap('.g-accent-actions button:has-text("Change mode")');
  await page.waitForSelector('.g-accent-modes');
  await page.tap('.g-accent-mode[data-mode="spot"]');
  await page.waitForSelector('.g-accent-mount .quiz[data-kind="choice"]');
  assert(await moduleFits(page), 'mobile spot: module fits the viewport');
  const q = await question(page);
  await page.tap('.g-accent-mount .quiz-option[data-idx="' + q.options.findIndex((o) => o.correct) + '"]');
  await page.waitForSelector('.g-accent-mount .quiz-feedback.ok');
  await settle(page);
  await shot(page, 'mobile-spot');

  // Leave mid-round: unmount is clean on mobile too
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('.hero');
  assert((await page.evaluate(() => PQ.debug.accent.mounted)) === false, 'mobile unmount');
  assert(errors.length === 0, 'mobile console errors: ' + errors.join('\n'));
  await browser.close();
}

(async () => {
  console.log('accent.test.js: desktop');
  await desktop();
  console.log('accent.test.js: mobile (390px, touch)');
  await mobile();
  console.log('accent.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
