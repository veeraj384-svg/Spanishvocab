/* Words (#/words) + Progress (#/stats) pages — Playwright test.   Run: node tests/pages.test.js
   Screenshots go to $PQ_SHOTS (defaults to the OS temp dir). */
const os = require('os');
const path = require('path');
const { launch, assert, SITE } = require('./helpers');

const SHOTS = process.env.PQ_SHOTS || os.tmpdir();
const shot = (page, name, full) => page.screenshot({ path: path.join(SHOTS, 'pages-' + name + '.png'), fullPage: full !== false });

/* Injected before any page script: tracks live window/document listeners by identity so the test can
   prove a page removed everything it added (QuizUI/modal keydown handlers, pq:progress, pq:settings, ...). */
function listenerTracker() {
  const sets = new Map();
  const key = (t, type, opts) => (t === window ? 'window:' : 'document:') + type + (opts === true || (opts && opts.capture) ? ':c' : '');
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if ((this === window || this === document) && fn) { const k = key(this, type, opts); if (!sets.has(k)) sets.set(k, new Set()); sets.get(k).add(fn); }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    if ((this === window || this === document) && fn) { const k = key(this, type, opts); if (sets.has(k)) sets.get(k).delete(fn); }
    return rem.call(this, type, fn, opts);
  };
  window.__listeners = () => { const o = {}; Array.from(sets.keys()).sort().forEach((k) => { if (sets.get(k).size) o[k] = sets.get(k).size; }); return o; };
}

/* ---------- helpers ---------- */
const state = (page) => page.evaluate(() => PQ.debug.pages.state);
const visible = (page) => page.evaluate(() => PQ.debug.pages.visibleIds());
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const insideViewport = (page, sel) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).every((el) => {
  const r = el.getBoundingClientRect(); return r.width === 0 || (r.right <= window.innerWidth + 1 && r.left >= -1);
}), sel);
const modals = (page) => page.locator('.modal-backdrop').count();
const totals = (page) => page.evaluate(() => PQ.Progress.totals());
const word = (page, id) => page.evaluate((id) => PQ.Progress.word(id), id);
const dotsOn = (page, id) => page.locator('.pg-row[data-id="' + id + '"] .mastery i.on').count();
const question = (page) => page.evaluate(() => {
  const q = PQ.debug.pages.question;
  return q ? { kind: q.kind, id: q.entry.id, canonical: q.canonical, correctIdx: q.options ? q.options.findIndex((o) => o.correct) : -1, needs: q.needs || null } : null;
});
const modalGone = (page) => page.waitForSelector('.modal-backdrop', { state: 'detached' });
/** Scroll a row-level control to the middle of the screen (keeps it out from under the sticky toolbar) and click/tap it. */
async function press(page, sel, tap) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' }));
  if (tap) await page.tap(sel); else await page.click(sel);
}
async function openPractice(page, id, kind) {
  assert(await page.evaluate(([id, kind]) => PQ.debug.pages.practice(id, kind), [id, kind]), 'practice hook opened ' + id);
  await page.waitForSelector('.modal .quiz');
}
/** Type into the auto-focused quiz input and submit with Enter. */
async function typeAnswer(page, text) {
  await page.waitForFunction(() => !!document.activeElement && document.activeElement.matches('.modal .quiz input'), undefined, { timeout: 2000 })
    .catch((e) => { throw new Error('ASSERT: quiz input should be auto-focused (' + e.message.split('\n')[0] + ')'); });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal .quiz-feedback');
}
/** Answer whatever question Quiz.any() produced, correctly, with pointer/touch input. */
async function answerCorrectly(page, tap) {
  const q = await question(page);
  assert(q, 'a question is open');
  const hit = (sel) => (tap ? page.tap(sel) : page.click(sel));
  if (q.kind === 'typed') {
    await hit('.modal .quiz input');
    await page.keyboard.type(q.canonical);
    await hit('.modal .quiz-actions .btn-primary'); // Check
  } else if (q.kind === 'choice' || q.kind === 'meaning') {
    await hit('.modal .quiz-option[data-idx="' + q.correctIdx + '"]');
  } else if (q.kind === 'accent') {
    for (const i of q.needs) await hit('.modal .quiz-letter[data-idx="' + i + '"]');
    await hit(q.needs.length ? '.modal .quiz-actions .btn-primary' : '.modal .quiz-actions .btn-outline');
  } else throw new Error('unexpected kind ' + q.kind);
  await page.waitForSelector('.modal .quiz-feedback.ok');
  return q;
}

/* ============================================================
   Desktop: mouse + keyboard
   ============================================================ */
async function desktop() {
  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(listenerTracker);
  await page.goto(SITE + '#/');
  await page.waitForSelector('.hero');
  await page.evaluate(() => PQ.Progress.reset());
  const baseline = await page.evaluate(() => window.__listeners());

  /* ---------- Words page ---------- */
  await page.goto(SITE + '#/words');
  await page.waitForSelector('.pg-words .pg-row');
  assert(await page.evaluate(() => typeof PQ.Pages.get('words') === 'function' && typeof PQ.Pages.get('stats') === 'function'), 'both pages registered');
  assert((await state(page)).id === 'words', 'live page is words');
  assert((await page.locator('.pg-words .word-row').count()) === 44, 'renders all 44 word rows');
  assert((await visible(page)).length === 44, '44 visible with no filter');
  assert((await page.locator('.pg-words .pg-cat:not(.hidden)').count()) === 5, 'five category sections');
  assert((await page.locator('.pg-chip').count()) === 6, 'All + 5 category chips');
  assert((await page.textContent('.pg-words .eyebrow')).trim() === 'Vocabulary', 'eyebrow');
  assert((await page.textContent('.pg-words h2')).includes('Unidad 1'), 'unit title from Vocab.meta()');
  assert((await page.textContent('.pg-chip[data-cat="all"] .pg-chip-count')) === '44', 'All chip count');
  assert((await page.textContent('.pg-chip[data-cat="question"] .pg-chip-count')) === '8', 'question chip count');
  assert((await page.locator('.pg-row[data-id="dificil"] .es .accent-char').count()) === 1, 'accents highlighted');
  assert((await page.textContent('.pg-row[data-id="primero"] .note')).includes('primer'), 'note rendered');
  assert((await page.locator('.pg-row .mastery').count()) === 44, 'mastery dots on every row');
  assert((await page.locator('.pg-row .pg-say').count()) === 44 && (await page.locator('.pg-row .pg-practice-btn').count()) === 44, 'speak + practice on every row');
  const foot = await page.textContent('.pg-footnote');
  assert(foot.includes('primer') && foot.includes('tercer') && foot.includes('`'), 'footnote: ordinal rule + backtick tip');
  assert((await page.locator('.pg-cat[data-cat="school"] .pg-cat-head h3').textContent()).includes('Para hablar de tu día escolar'), 'Spanish section title');
  assert(await noOverflow(page), 'no horizontal overflow (desktop words)');
  await page.waitForTimeout(700);
  await shot(page, 'desktop-words');

  // Search is typed with the keyboard and ignores accents
  await page.click('.pg-search-input');
  await page.keyboard.type('cual');
  let ids = await visible(page);
  assert(ids.length === 1 && ids[0] === 'cual', 'search "cual" matches ¿Cuál? only: ' + ids);
  assert((await page.textContent('.pg-count')).includes('1 of 44'), 'count label');
  assert((await page.locator('.pg-cat:not(.hidden)').count()) === 1, 'empty sections hidden');
  await page.keyboard.press('Escape');
  assert((await visible(page)).length === 44, 'Escape clears the search');
  assert(await page.evaluate(() => document.activeElement.classList.contains('pg-search-input')), 'search keeps focus after clearing');
  await page.keyboard.type('class');
  ids = await visible(page);
  assert(ids.length === 3 && ids.includes('clase') && ids.includes('clase-de') && ids.includes('hora-de'), 'English search (class, … class, class period): ' + ids);
  await page.keyboard.type('zzz');
  assert((await visible(page)).length === 0 && (await page.locator('.pg-empty:not(.hidden)').count()) === 1, 'empty state');
  await page.click('.pg-empty .btn');
  assert((await visible(page)).length === 44 && (await page.locator('.pg-empty:not(.hidden)').count()) === 0, 'Clear filters');

  // "/" focuses the search, Escape on an empty search blurs it
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('/');
  assert(await page.evaluate(() => document.activeElement.classList.contains('pg-search-input')), '"/" focuses the search');
  assert((await page.inputValue('.pg-search-input')) === '', 'slash not typed into the search');
  await page.keyboard.press('Escape');
  assert(await page.evaluate(() => !document.activeElement.classList.contains('pg-search-input')), 'Escape on empty search blurs');

  // Category chips
  await page.click('.pg-chip[data-cat="question"]');
  ids = await visible(page);
  assert(ids.length === 8 && (await page.evaluate((ids) => ids.every((id) => PQ.Vocab.byId(id).cat === 'question'), ids)), 'question chip → 8 question words');
  assert((await page.getAttribute('.pg-chip[data-cat="question"]', 'aria-pressed')) === 'true', 'chip pressed state');
  assert((await page.locator('.pg-cat:not(.hidden)').count()) === 1, 'one section visible');
  await page.click('.pg-chip[data-cat="all"]');
  assert((await visible(page)).length === 44, 'All chip restores');

  // Accents-only toggle
  const accentIds = await page.evaluate(() => PQ.Vocab.withAccents(PQ.Vocab.all()).map((e) => e.id));
  await page.click('.pg-toggle-accents');
  ids = await visible(page);
  assert(ids.length === accentIds.length && ids.every((id) => accentIds.includes(id)), 'accents only → ' + ids.length + ' words');
  assert((await page.textContent('.pg-chip[data-cat="all"] .pg-chip-count')) === String(accentIds.length), 'chip counts follow the toggle');
  await page.click('.pg-toggle-accents');
  assert((await visible(page)).length === 44, 'toggle off');

  /* ---------- Practice modal: correct ---------- */
  await openPractice(page, 'dificil', 'typed');
  assert((await page.locator('.modal .quiz[data-kind="typed"]').count()) === 1, 'typed question in a modal');
  assert((await page.textContent('.modal .quiz-prompt')).includes('difficult'), 'prompt is the English');
  assert((await state(page)).practiceOpen, 'state reports the open practice');
  await typeAnswer(page, 'difícil');
  assert(await page.$('.modal .quiz-feedback.ok'), 'correct feedback');
  assert(await page.$('.pg-row[data-id="dificil"].flash-ok'), 'row flashes green');
  await page.keyboard.press('Enter'); // Continue → modal closes
  await modalGone(page);
  assert(!(await state(page)).practiceOpen, 'practice closed after continue');
  assert((await dotsOn(page, 'dificil')) === 1, 'row mastery dots refreshed');
  assert((await word(page, 'dificil')).box === 1, 'progress recorded once');

  /* ---------- Practice modal: accent-only mistake ---------- */
  await openPractice(page, 'frances', 'typed');
  await typeAnswer(page, 'frances');
  assert(await page.$('.modal .quiz-feedback.accent'), 'accent feedback');
  assert((await page.textContent('.modal .quiz-feedback')).includes('francés'), 'shows the correct spelling');
  assert(await page.$('.modal .diff .d-accent'), 'letter diff highlights the accent');
  await page.click('.modal .quiz-actions .btn-primary'); // Got it →
  await modalGone(page);
  assert((await word(page, 'frances')).acc === 1, 'accent slip recorded');

  /* ---------- Practice modal: wrong answer, dismissed with Escape ---------- */
  await openPractice(page, 'horario', 'typed');
  await typeAnswer(page, 'zzz');
  assert(await page.$('.modal .quiz-feedback.bad'), 'wrong feedback');
  assert((await page.textContent('.modal .fb-answer')).includes('el horario'), 'shows the canonical answer');
  await page.keyboard.press('Escape');
  await modalGone(page);
  assert((await word(page, 'horario')).wrong === 1, 'wrong recorded');
  assert((await dotsOn(page, 'horario')) === 0, 'dots refreshed (box 0)');

  /* ---------- The real Practice button (Quiz.any), closed with ✕ before answering ---------- */
  const answersBefore = (await totals(page)).answers;
  await press(page, '.pg-row[data-id="facil"] .pg-practice-btn');
  await page.waitForSelector('.modal .quiz');
  const q = await question(page);
  assert(q.id === 'facil' && ['typed', 'choice', 'accent'].includes(q.kind), 'Quiz.any question: ' + JSON.stringify(q));
  assert((await page.textContent('.modal .pg-practice-cat')).includes('Adjectives'), 'category label in modal');
  await page.click('.modal .modal-close');
  await modalGone(page);
  assert((await totals(page)).answers === answersBefore, 'closing early records nothing');

  // Answer with the mouse through the real button as well
  await press(page, '.pg-row[data-id="facil"] .pg-practice-btn');
  await page.waitForSelector('.modal .quiz');
  await answerCorrectly(page, false);
  await page.click('.modal .quiz-actions .btn-primary');
  await modalGone(page);
  assert((await dotsOn(page, 'facil')) === 1, 'facil dots after mouse answer');

  // 🔊 is safe to click (speech may be unavailable headless) and pq:progress refreshes dots
  await press(page, '.pg-row[data-id="espanol"] .pg-say');
  await page.evaluate(() => PQ.Progress.record('espanol', 'correct'));
  assert((await dotsOn(page, 'espanol')) === 1, 'dots refresh on pq:progress');

  /* ---------- Progress page ---------- */
  await page.goto(SITE + '#/stats');
  await page.waitForSelector('.pg-stats .pg-overview');
  assert((await state(page)).id === 'stats', 'live page is stats');
  assert((await page.locator('.pg-overview .ring').count()) === 1, 'mastery ring');
  const lvl = await page.evaluate(() => PQ.Progress.level());
  assert((await page.textContent('.pg-level-badge')).trim() === String(lvl), 'level badge');
  assert((await page.locator('.pg-catbar').count()) === 5, 'five category bars');
  assert((await page.locator('.pg-box-col').count()) === 6, 'six box columns');
  let counts = await page.$$eval('.pg-box-count', (els) => els.map((e) => +e.textContent));
  assert(counts.reduce((a, b) => a + b, 0) === 44, 'box counts sum to 44: ' + counts);
  // dificil, facil, espanol → box 1; frances (accent) + horario (wrong) → box 0
  assert(counts[1] === 3 && counts[0] === 41, 'box distribution: ' + counts);
  assert((await page.textContent('.pg-stat-answers .stat-val')) === '5', 'answers total');
  assert((await page.textContent('.pg-stat-accuracy .stat-val')) === '60%', 'accuracy');
  assert((await page.locator('.pg-trouble .pg-trouble-row').count()) === 1, 'one accent-trouble word');
  assert((await page.textContent('.pg-trouble .pg-trouble-row .es')).includes('francés'), 'accent trouble shows francés');
  assert((await page.locator('.pg-trouble .pg-trouble-row .es .accent-char').count()) === 1, 'trouble spelling highlighted');
  assert((await page.locator('.pg-trouble .pg-say').count()) === 1, 'trouble row has 🔊');
  const nGames = await page.evaluate(() => PQ.Games.all().length);
  assert(nGames > 0 && (await page.locator('.pg-game').count()) === nGames, 'one record card per game (' + nGames + ')');
  const firstGame = await page.evaluate(() => { PQ.Progress.setBest(PQ.Games.all()[0].id, 1234); return PQ.Games.all()[0].id; });
  assert((await page.textContent('.pg-game[data-game="' + firstGame + '"] .pg-game-val')) === '1234', 'best score re-rendered on pq:progress');
  await page.waitForTimeout(750);
  assert(/\d+%$/.test(await page.$eval('.pg-catbar .pg-fill', (el) => el.style.width)), 'bars animate to their width');
  assert(await noOverflow(page), 'no horizontal overflow (desktop stats)');
  await shot(page, 'desktop-stats');

  // Settings: sound toggle keeps the header button in sync, both ways
  const soundBefore = await page.evaluate(() => PQ.Sound.enabled());
  await press(page, '.pg-toggle-sound');
  assert((await page.evaluate(() => PQ.Sound.enabled())) === !soundBefore, 'sound toggled');
  assert((await page.textContent('#soundBtn')) === (soundBefore ? '🔇' : '🔊'), 'header sound button repainted');
  await page.click('#soundBtn');
  assert((await page.evaluate(() => PQ.Sound.enabled())) === soundBefore, 'header toggles back');
  assert((await page.locator('.pg-toggle-sound input').isChecked()) === soundBefore, 'settings checkbox follows the header');
  if (await page.evaluate(() => PQ.Speech.available())) {
    await press(page, '.pg-toggle-speech');
    assert((await page.evaluate(() => PQ.Settings.get('speech'))) === false, 'speech off');
    await press(page, '.pg-toggle-speech');
    assert((await page.evaluate(() => PQ.Settings.get('speech'))) === true, 'speech on');
  }
  // Focus chips drive Settings 'cats' and therefore Vocab.active()
  await press(page, '.pg-focus .chip[data-cat="ordinal"]');
  assert(JSON.stringify(await page.evaluate(() => PQ.Settings.get('cats'))) === '["ordinal"]', 'cats = [ordinal]');
  assert((await page.evaluate(() => PQ.Vocab.active().length)) === 8, 'active pool follows the focus');
  assert((await page.getAttribute('.pg-focus .chip[data-cat="ordinal"]', 'aria-pressed')) === 'true', 'focus chip pressed');
  await press(page, '.pg-focus .chip[data-cat="ordinal"]');
  assert((await page.evaluate(() => PQ.Settings.get('cats'))) === null, 'cats back to null');

  // Reset: cancel, then confirm
  await press(page, '.pg-reset');
  await page.waitForSelector('.modal .pg-confirm');
  assert((await state(page)).confirmOpen, 'confirm modal tracked');
  await page.keyboard.press('Escape');
  await modalGone(page);
  assert((await totals(page)).answers === 5, 'cancel keeps progress');
  await press(page, '.pg-reset');
  await page.waitForSelector('.modal .pg-confirm');
  await page.click('.pg-reset-confirm');
  await modalGone(page);
  assert((await totals(page)).answers === 0 && (await page.evaluate(() => PQ.Progress.best(PQ.Games.all()[0].id))) === 0, 'progress reset');
  assert((await page.textContent('.pg-stat-answers .stat-val')) === '0', 're-rendered after reset');
  assert((await page.locator('.pg-trouble .pg-empty-inline').count()) === 1, 'accent trouble empty state');
  counts = await page.$$eval('.pg-box-count', (els) => els.map((e) => +e.textContent));
  assert(counts[0] === 44, 'all words back in box 0');

  // Practice from the accent-trouble list
  await page.evaluate(() => PQ.Progress.record('ingles', 'accent'));
  await page.waitForSelector('.pg-trouble .pg-trouble-row[data-id="ingles"]');
  await press(page, '.pg-trouble .pg-trouble-row[data-id="ingles"] .pg-practice-btn');
  await page.waitForSelector('.modal .quiz');
  assert((await question(page)).id === 'ingles', 'practice from trouble list');
  await page.keyboard.press('Escape');
  await modalGone(page);

  /* ---------- Unmount / remount cycles ---------- */
  await page.goto(SITE + '#/words');
  await page.waitForSelector('.pg-words .pg-row');
  assert((await visible(page)).length === 44 && (await page.locator('.pg-stats').count()) === 0, 'words remounted cleanly');
  await page.goto(SITE + '#/stats');
  await page.waitForSelector('.pg-stats .pg-overview');
  assert((await page.locator('.pg-words').count()) === 0 && (await page.locator('.pg-stats').count()) === 1, 'stats remounted cleanly');
  await page.goto(SITE + '#/');
  await page.waitForSelector('.hero');
  assert((await state(page)) === null, 'no live page on home');
  let after = await page.evaluate(() => window.__listeners());
  assert(JSON.stringify(after) === JSON.stringify(baseline), 'window/document listeners back to baseline\n  baseline ' + JSON.stringify(baseline) + '\n  after    ' + JSON.stringify(after));

  // Navigating away while a practice modal is open must close it and clean up the quiz
  await page.goto(SITE + '#/words');
  await page.waitForSelector('.pg-words .pg-row');
  await openPractice(page, 'tecnologia', 'typed');
  await page.goto(SITE + '#/stats');
  await page.waitForSelector('.pg-stats .pg-overview');
  assert((await modals(page)) === 0, 'modal closed by navigation');
  await press(page, '.pg-reset');
  await page.waitForSelector('.modal .pg-confirm');
  await page.goto(SITE + '#/');
  await page.waitForSelector('.hero');
  assert((await modals(page)) === 0, 'confirm modal closed by navigation');
  after = await page.evaluate(() => window.__listeners());
  assert(JSON.stringify(after) === JSON.stringify(baseline), 'listeners back to baseline after modal navigation\n  baseline ' + JSON.stringify(baseline) + '\n  after    ' + JSON.stringify(after));

  assert(errors.length === 0, 'console errors (desktop): ' + errors.join('\n'));
  await browser.close();
  console.log('PASS desktop');
}

/* ============================================================
   Mobile: 390px, touch
   ============================================================ */
async function mobile() {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  await page.goto(SITE + '#/words');
  await page.waitForSelector('.pg-words .pg-row');
  await page.evaluate(() => PQ.Progress.reset());
  await page.waitForTimeout(700);
  assert(await noOverflow(page), 'no horizontal overflow (mobile words)');
  assert(await insideViewport(page, '.pg-row, .pg-toolbar, .pg-cat-head, .pg-footnote, .pg-head'), 'everything fits the 390px viewport');
  const barH = await page.$eval('.pg-toolbar', (el) => el.getBoundingClientRect().height);
  assert(barH < 200, 'sticky toolbar stays compact on phones (' + Math.round(barH) + 'px)');
  await shot(page, 'mobile-words', false);
  await shot(page, 'mobile-words-full');

  await page.tap('.pg-chip[data-cat="adjective"]');
  assert((await visible(page)).length === 10, 'tap chip → 10 adjectives');
  await page.tap('.pg-chip[data-cat="all"]');
  assert((await visible(page)).length === 44, 'tap All');
  await page.tap('.pg-toggle-accents');
  const nAcc = await page.evaluate(() => PQ.Vocab.withAccents(PQ.Vocab.all()).length);
  assert((await visible(page)).length === nAcc, 'tap accents toggle');
  await page.tap('.pg-toggle-accents');

  await page.tap('.pg-search-input');
  await page.keyboard.type('tecn');
  assert(JSON.stringify(await visible(page)) === '["tecnologia"]', 'search on mobile');
  await page.tap('.pg-search-clear');
  assert((await visible(page)).length === 44, 'tap clear');

  // Practice through touch, answering whatever Quiz.any produced
  await press(page, '.pg-row[data-id="septimo"] .pg-practice-btn', true);
  await page.waitForSelector('.modal .quiz');
  assert(await noOverflow(page), 'modal fits (mobile)');
  await page.waitForTimeout(350);
  await shot(page, 'mobile-practice', false);
  await answerCorrectly(page, true);
  await page.tap('.modal .quiz-actions .btn-primary');
  await modalGone(page);
  assert((await dotsOn(page, 'septimo')) === 1, 'dots refreshed after touch practice');
  await press(page, '.pg-row[data-id="septimo"] .pg-say', true);

  // Forced accent slip through touch on the typed widget
  await openPractice(page, 'matematicas', 'typed');
  await page.tap('.modal .quiz input');
  await page.keyboard.type('matematicas');
  await page.tap('.modal .quiz-actions .btn-primary');
  await page.waitForSelector('.modal .quiz-feedback.accent');
  assert((await page.textContent('.modal .quiz-feedback')).includes('matemáticas'), 'accent feedback on mobile');
  await page.tap('.modal .quiz-actions .btn-primary');
  await modalGone(page);

  await page.goto(SITE + '#/stats');
  await page.waitForSelector('.pg-stats .pg-overview');
  await page.waitForTimeout(750);
  assert(await noOverflow(page), 'no horizontal overflow (mobile stats)');
  assert(await insideViewport(page, '.pg-overview, .pg-boxes, .pg-game, .pg-settings, .pg-catbar, .pg-trouble-row'), 'stats fit the 390px viewport');
  assert((await page.locator('.pg-trouble .pg-trouble-row[data-id="matematicas"]').count()) === 1, 'accent trouble lists matemáticas');
  await shot(page, 'mobile-stats', false);
  await shot(page, 'mobile-stats-full');
  const soundBefore = await page.evaluate(() => PQ.Sound.enabled());
  await press(page, '.pg-toggle-sound', true);
  assert((await page.evaluate(() => PQ.Sound.enabled())) === !soundBefore, 'tap sound toggle');
  await press(page, '.pg-toggle-sound', true);
  await press(page, '.pg-focus .chip[data-cat="school"]', true);
  assert(JSON.stringify(await page.evaluate(() => PQ.Settings.get('cats'))) === '["school"]', 'tap focus chip');
  await press(page, '.pg-focus .chip[data-cat="school"]', true);
  await press(page, '.pg-reset', true);
  await page.waitForSelector('.modal .pg-confirm');
  await page.waitForTimeout(350); // let the pop-in animation finish before the screenshot
  await shot(page, 'mobile-confirm', false);
  await page.tap('.pg-reset-confirm');
  await modalGone(page);
  assert((await totals(page)).answers === 0 && (await page.evaluate(() => PQ.Progress.box('septimo'))) === 0, 'reset from mobile');
  assert((await page.locator('.pg-trouble .pg-empty-inline').count()) === 1, 'empty state after reset');

  assert(errors.length === 0, 'console errors (mobile): ' + errors.join('\n'));
  await browser.close();
  console.log('PASS mobile');
}

(async () => {
  try {
    await desktop();
    await mobile();
    console.log('ALL PASSED — screenshots in ' + SHOTS);
  } catch (e) {
    console.error('FAILED: ' + (e && e.stack || e));
    process.exit(1);
  }
})();
