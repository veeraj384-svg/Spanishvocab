/* Memory Deck — Playwright test.   Run: node tests/flash.test.js
   Screenshots go to $PQ_SHOTS (defaults to the OS temp dir). */
const os = require('os');
const path = require('path');
const { launch, assert, SITE } = require('./helpers');

const SHOTS = process.env.PQ_SHOTS || os.tmpdir();
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'flash-' + name + '.png'), fullPage: true });

/* ---------- helpers that talk to PQ.debug.flash ---------- */
const snap = (page) => page.evaluate(() => {
  const s = PQ.debug.flash.state;
  if (!s) return null;
  return {
    screen: s.screen, deck: s.deck ? s.deck.id : null, cat: s.cat || null, dir: s.dir, recall: s.recall, autoSay: s.autoSay,
    index: s.index, n: s.cards ? s.cards.length : 0, cards: s.cards ? s.cards.map((e) => e.id) : [], animating: !!s.animating,
    current: s.current ? { id: s.current.entry.id, flipped: s.current.flipped, revealed: s.current.revealed, rated: s.current.rated, attempt: s.current.attempt } : null,
    ratings: (s.ratings || []).map((r) => ({ id: r.id, rating: r.rating, status: r.status, xp: r.xp, box: r.box })),
    counts: s.counts, xp: s.xp, reviewed: s.reviewed, again: (s.again || []).map((r) => r.id), newBest: s.newBest, reason: s.reason,
  };
});
const word = (page, id) => page.evaluate((id) => Object.assign({}, PQ.Progress.word(id)), id);
const entry = (page, id) => page.evaluate((id) => { const e = PQ.Vocab.byId(id); return { id: e.id, es: e.es, en: e.en, base: e.base, cat: e.cat, stripped: PQ.Text.stripAccents(e.base) }; }, id);
/** Put a specific (not yet rated) word on the current card. */
const force = (page, candidates) => page.evaluate((ids) => {
  const s = PQ.debug.flash.state;
  const seen = new Set(s.ratings.map((r) => r.id));
  const id = ids.find((x) => !seen.has(x));
  if (!id) throw new Error('no unrated candidate among ' + ids.join(','));
  PQ.debug.flash.force(id);
  return id;
}, candidates);
/** Wait until the card transition is over and card `index` is showing (or the session ended). */
const settled = (page, index) => page.waitForFunction((i) => {
  const s = PQ.debug.flash.state;
  return !!s && !s.animating && (s.screen === 'end' || (s.screen === 'session' && s.index === i && s.current && !s.current.revealed));
}, index, { timeout: 4000 });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Type a recall attempt into the (auto-focused) input and flip with Enter. */
async function attempt(page, text) {
  await page.waitForSelector('.g-flash-input:not(:disabled)');
  await page.waitForFunction(() => !!document.activeElement && document.activeElement.matches('.g-flash-input'), undefined, { timeout: 2000 })
    .catch((e) => { throw new Error('ASSERT: recall input should be auto-focused (' + e.message.split('\n')[0] + ')'); });
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-flash-card.is-flipped');
}

async function desktop() {
  const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
  await page.goto(SITE + '#/play/flash');
  await page.waitForSelector('.g-flash-start');

  // ---- Registration + start screen ----
  const registered = await page.evaluate(() => { const g = PQ.Games.get('flash'); return g && g.name + '|' + g.icon + '|' + g.order + '|' + g.accent; });
  assert(registered === 'Memory Deck|🃏|5|var(--c-sky)', 'registration: ' + registered);
  assert((await page.locator('.g-flash-deck').count()) === 4, 'four deck cards (due, weak, all, category)');
  assert((await page.locator('.g-flash-cats .chip').count()) === 5, 'one chip per category');
  assert((await page.locator('.g-flash-seg button[data-dir="en-es"]').getAttribute('aria-pressed')) === 'true', 'English → Spanish is the default direction');
  assert(!(await page.locator('.g-flash-start .g-flash-recall-toggle input').isChecked()), 'active recall defaults to off');
  assert((await page.locator('.g-flash-deck[data-deck="due"] .g-flash-deck-count').textContent()).includes('20 cards'), 'fresh profile: 20 due cards');
  assert(await noOverflow(page), 'no horizontal overflow on the start screen');
  await shot(page, 'desktop-start');

  // ---- Due today via click ----
  await page.click('.g-flash-deck[data-deck="due"]');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  let s = await snap(page);
  assert(s.screen === 'session' && s.deck === 'due' && s.n === 20 && s.index === 0 && s.dir === 'en-es', 'session started: ' + JSON.stringify(s));
  assert(new Set(s.cards).size === 20, 'no duplicate cards in the deck');
  const allDue = await page.evaluate(() => PQ.Progress.due().map((e) => e.id));
  assert(s.cards.every((id) => allDue.includes(id)), 'every card comes from Progress.due()');
  assert((await page.locator('.g-flash-progress-label').textContent()) === 'Card 1 of 20', 'progress label');
  assert((await page.locator('.g-flash-rate-btn:disabled').count()) === 4, 'ratings disabled before the flip');
  assert((await page.locator('.g-flash-input').count()) === 0, 'no recall input while active recall is off');
  const front = await page.locator('.g-flash-front .g-flash-prompt').textContent();
  const e1 = await entry(page, s.current.id);
  assert(front === e1.en, 'front shows the English prompt: ' + front);
  assert((await page.locator('.g-flash-front .g-flash-cat').textContent()).length > 2, 'category pill on the front');

  // Card 1: Space flips, 3 = Good
  await page.keyboard.press('1'); // rating before the flip is ignored
  s = await snap(page);
  assert(s.ratings.length === 0 && !s.current.revealed, 'cannot rate before flipping');
  await page.keyboard.press('Space');
  await page.waitForSelector('.g-flash-card.is-flipped');
  s = await snap(page);
  assert(s.current.flipped && s.current.revealed, 'Space flips the card');
  assert((await page.locator('.g-flash-back .g-flash-es').textContent()) === e1.es, 'back shows the Spanish');
  assert((await page.locator('.g-flash-back .g-flash-en').textContent()) === e1.en, 'back shows the English');
  assert((await page.locator('.g-flash-rate.is-ready').count()) === 1 && (await page.locator('.g-flash-rate-btn:disabled').count()) === 0, 'ratings enabled after the flip');
  assert((await page.locator('.g-flash-back .mastery').count()) === 1, 'mastery dots on the back');
  assert(await page.evaluate(() => { const f = document.querySelector('.g-flash-front'); return f.hasAttribute('inert') && f.getAttribute('aria-hidden') === 'true'; }), 'hidden face is inert');
  await page.waitForTimeout(600); // let the 500ms flip finish before the screenshot
  await shot(page, 'desktop-back');
  await page.keyboard.press('3');
  s = await snap(page);
  assert(s.ratings.length === 1 && s.ratings[0].rating === 'good' && s.ratings[0].status === 'correct' && s.ratings[0].id === e1.id, 'Good → correct: ' + JSON.stringify(s.ratings));
  let w = await word(page, e1.id);
  assert(w.n === 1 && w.ok === 1 && w.box === 1, 'progress recorded exactly once: ' + JSON.stringify(w));
  assert(s.counts.good === 1 && s.xp === s.ratings[0].xp && s.ratings[0].xp === 10 + 2, 'counter + XP (10 + box*2)');
  assert((await page.locator('.g-flash-count[data-rating="good"] b').textContent()) === '1', 'good counter shows 1');
  assert((await page.locator('.g-flash-rate-btn[data-rating="good"].is-picked').count()) === 1, 'pressed rating highlighted');
  assert((await page.locator('.g-flash-float').count()) === 1, 'XP float shown');
  assert((await page.locator('.g-flash-back .mastery i.on').count()) === 1, 'mastery dots updated on the card');
  await page.keyboard.press('4'); // a second rating of the same card must be ignored
  assert((await snap(page)).ratings.length === 1, 'a card can only be rated once');
  await settled(page, 1);
  assert((await page.locator('.g-flash-progress-label').textContent()) === 'Card 2 of 20', 'advanced to card 2');

  // Card 2: click flips, click Again
  await page.click('.g-flash-front .g-flash-prompt');
  await page.waitForSelector('.g-flash-card.is-flipped');
  const e2 = await entry(page, (await snap(page)).current.id);
  await page.click('.g-flash-rate-btn[data-rating="again"]');
  s = await snap(page);
  assert(s.ratings[1].rating === 'again' && s.ratings[1].status === 'wrong' && s.ratings[1].xp === 0, 'Again → wrong');
  w = await word(page, e2.id);
  assert(w.n === 1 && w.wrong === 1, 'wrong recorded once: ' + JSON.stringify(w));
  await settled(page, 2);

  // ---- Active recall: accent-only mistake → Hard suggested, Enter takes it ----
  await page.click('.g-flash-session .g-flash-recall-toggle');
  s = await snap(page);
  assert(s.recall === true && (await page.locator('.g-flash-input').count()) === 1, 'recall toggle adds the input to the current card');
  assert((await page.locator('.g-flash-recall .accent-key').count()) >= 7, 'accent bar on the card');
  const accentId = await force(page, ['frances', 'ingles', 'espanol', 'dificil', 'tecnologia']);
  const ea = await entry(page, accentId);
  await shot(page, 'desktop-recall-front');
  await attempt(page, ea.stripped);
  s = await snap(page);
  assert(s.current.revealed && s.current.attempt && s.current.attempt.status === 'accent', 'accent-only attempt graded: ' + JSON.stringify(s.current.attempt));
  assert((await page.locator('.g-flash-attempt.is-accent .diff .d-accent').count()) >= 1, 'letter diff marks the missing accent');
  assert((await page.locator('.g-flash-back .g-flash-es').textContent()) === ea.es, 'correct spelling shown on the back');
  assert((await page.locator('.g-flash-back .g-flash-es .accent-char').count()) >= 1, 'accents highlighted');
  assert((await page.locator('.g-flash-rate-btn[data-rating="hard"].is-suggested').count()) === 1, 'Hard suggested after an accent slip');
  assert((await page.locator('.g-flash-input.is-accent').count()) === 1, 'input styled as accent mistake');
  assert(await noOverflow(page), 'no overflow with the attempt shown');
  await page.waitForTimeout(600); // flip finished; Enter is also guarded right after the reveal
  await shot(page, 'desktop-accent');
  await page.keyboard.press('Enter');
  s = await snap(page);
  assert(s.ratings[2].rating === 'hard' && s.ratings[2].status === 'accent' && s.ratings[2].xp === 2, 'Enter applied the suggested Hard: ' + JSON.stringify(s.ratings[2]));
  w = await word(page, accentId);
  assert(w.n === 1 && w.acc === 1 && w.ok === 0, 'accent recorded once (not by the attempt): ' + JSON.stringify(w));
  await settled(page, 3);

  // ---- Correct attempt → Good suggested, 4 = Easy (+5 bonus) ----
  const okId = await force(page, ['ingles', 'frances', 'espanol', 'matematicas']);
  const eo = await entry(page, okId);
  await attempt(page, eo.base);
  s = await snap(page);
  assert(s.current.attempt.status === 'correct' && (await page.locator('.g-flash-attempt.is-correct').count()) === 1, 'correct attempt graded');
  assert((await page.locator('.g-flash-rate-btn[data-rating="good"].is-suggested').count()) === 1, 'Good suggested');
  await page.keyboard.press('4');
  s = await snap(page);
  const easy = s.ratings[3];
  assert(easy.rating === 'easy' && easy.status === 'correct' && easy.xp === 10 + easy.box * 2 + 5, 'Easy = correct + 5 bonus XP: ' + JSON.stringify(easy));
  await settled(page, 4);

  // ---- Wrong attempt → Again suggested; speaker button; override with Good ----
  const badId = await force(page, ['facil', 'horario', 'arte', 'cuando']);
  await attempt(page, 'zzzz');
  s = await snap(page);
  assert(s.current.attempt.status === 'wrong' && (await page.locator('.g-flash-attempt.is-wrong .diff .d-bad').count()) >= 1, 'wrong attempt diffed');
  assert((await page.locator('.g-flash-rate-btn[data-rating="again"].is-suggested').count()) === 1, 'Again suggested');
  if (await page.evaluate(() => PQ.Speech.available())) await page.click('.g-flash-back .g-flash-say');
  await page.click('.g-flash-rate-btn[data-rating="good"]'); // the learner can override the suggestion
  s = await snap(page);
  assert(s.ratings[4].id === badId && s.ratings[4].rating === 'good', 'suggestion overridden by a click');
  await settled(page, 5);

  // ---- Empty attempt: flip by click, Enter flips back (no suggestion), Space flips again, 2 = Hard ----
  await page.click('.g-flash-front .g-flash-prompt');
  await page.waitForSelector('.g-flash-card.is-flipped');
  s = await snap(page);
  assert(s.current.attempt.status === 'empty' && (await page.locator('.g-flash-attempt.is-empty').count()) === 1, 'empty attempt noted');
  assert((await page.locator('.g-flash-rate-btn.is-suggested').count()) === 0, 'no suggestion without an attempt');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-flash-card:not(.is-flipped)');
  assert(!(await snap(page)).current.rated, 'Enter without a suggestion just flips back');
  await page.keyboard.press('Space');
  await page.waitForSelector('.g-flash-card.is-flipped');
  await page.keyboard.press('2');
  s = await snap(page);
  assert(s.ratings.length === 6 && s.ratings[5].rating === 'hard', 'rated Hard on the second flip');
  await settled(page, 6);
  assert((await page.evaluate(() => Math.round(document.querySelector('.g-flash-progress .bar-fill').style.width.replace('%', '')))) === 30, 'progress bar at 6/20');

  // ---- Esc → quit dialog → Finish now → end screen ----
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal');
  await page.keyboard.press('Space'); // must not flip while the dialog is open
  assert(!(await snap(page)).current.revealed, 'keys ignored while the modal is open');
  await page.click('.modal button:has-text("Finish now")');
  await page.waitForSelector('.g-flash-end');
  s = await snap(page);
  assert(s.screen === 'end' && s.reason === 'quit' && s.reviewed === 6, 'ended early with 6 reviewed: ' + JSON.stringify(s));
  assert(s.again.length === 1 && s.again[0] === e2.id, 'one Again card');
  assert((await page.locator('.g-flash-again-row').count()) === 1 && (await page.locator('.g-flash-again-row .accent-char, .g-flash-again-row .g-flash-again-es').count()) >= 1, 'Again list rendered');
  assert((await page.locator('.g-flash-review').count()) === 1, 'Review again button');
  assert((await page.locator('.ring').count()) === 1, 'recall ring');
  const stats = await page.evaluate(() => PQ.Progress.gameStats('flash'));
  assert(stats.plays === 1 && stats.best === 6 && s.newBest === true, 'best = cards reviewed: ' + JSON.stringify(stats));
  await page.waitForTimeout(900);
  assert((await page.locator('.g-flash-bigcount').textContent()) === '6', 'big count shows 6');
  assert((await page.locator('.modal-backdrop').count()) === 0, 'modal closed');
  await shot(page, 'desktop-end');

  // ---- Review again: exactly the Again cards; clean run → confetti ----
  await page.click('.g-flash-review');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  s = await snap(page);
  assert(s.deck === 'review' && s.n === 1 && s.cards[0] === e2.id && s.recall === true, 'review deck holds the Again card: ' + JSON.stringify(s));
  await attempt(page, e2.base);
  await page.keyboard.press('3');
  await settled(page, 1);
  await page.waitForSelector('.g-flash-end');
  s = await snap(page);
  assert(s.reason === 'complete' && s.reviewed === 1 && s.again.length === 0 && s.newBest === false, 'review complete: ' + JSON.stringify(s));
  await page.waitForTimeout(450);
  assert((await page.locator('.confetti-canvas').count()) >= 1, 'confetti when nothing was rated Again');
  assert((await page.locator('.g-flash-clean').count()) === 1 && (await page.locator('.g-flash-review').count()) === 0, 'clean message, no review button');

  // ---- Unmount / remount ----
  await page.evaluate(() => PQ.Router.go('/'));
  await page.waitForSelector('.hero');
  assert((await page.locator('.g-flash').count()) === 0, 'game DOM removed on unmount');
  assert(await page.evaluate(() => PQ.debug.flash.state === null && !PQ.debug.flash.mounted), 'state cleared on unmount');
  assert((await page.locator('.game-card:has-text("Memory Deck")').textContent()).includes('Best: 6'), 'home card shows the best');
  await page.keyboard.press('Space'); await page.keyboard.press('1'); await page.keyboard.press('Enter'); // stale handlers would throw / act
  await page.waitForTimeout(150);
  assert((await page.locator('.g-flash').count()) === 0 && (await page.locator('.modal-backdrop').count()) === 0, 'stale shortcuts do nothing after unmount');
  await page.evaluate(() => PQ.Router.go('/play/flash'));
  await page.waitForSelector('.g-flash-start');
  assert((await page.locator('.g-flash-hero-stats .stat-val').first().textContent()) === '6', 'start screen shows the best deck');
  assert(await page.locator('.g-flash-start .g-flash-recall-toggle input').isChecked(), 'recall preference remembered');

  // ---- Keyboard 2 = Weakest (12 cards from Progress.weakest) ----
  await page.keyboard.press('2');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  s = await snap(page);
  // Progress.weakest breaks ties at random, so check rank rather than identity: no dealt card is stronger than a word left out.
  const rank = await page.evaluate((ids) => { const box = (id) => PQ.Progress.box(id); const inDeck = new Set(ids); const out = PQ.Vocab.active().filter((e) => !inDeck.has(e.id)); return { maxIn: Math.max.apply(null, ids.map(box)), minOut: out.length ? Math.min.apply(null, out.map((e) => box(e.id))) : 99, allActive: ids.every((id) => PQ.Vocab.active().some((e) => e.id === id)) }; }, s.cards);
  assert(s.deck === 'weak' && s.n === 12 && rank.allActive && rank.maxIn <= rank.minOut, 'weakest deck holds the lowest boxes: ' + JSON.stringify(rank) + ' ' + JSON.stringify(s.cards));
  assert((await page.locator('.g-flash-input').count()) === 1, 'recall input present (remembered preference)');
  // Pause accounting while hidden
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const tHidden = await page.evaluate(() => PQ.debug.flash.elapsed());
  await page.waitForTimeout(250);
  assert((await page.evaluate(() => PQ.debug.flash.elapsed())) === tHidden, 'session clock paused while hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(80);
  assert((await page.evaluate(() => PQ.debug.flash.elapsed())) > tHidden, 'clock resumed');
  // Quit without rating → "Back to decks"
  await page.click('.g-flash-session button:has-text("Quit")');
  await page.waitForSelector('.modal');
  assert((await page.locator('.modal button:has-text("Finish now")').count()) === 0, 'no "Finish now" before any rating');
  await page.click('.modal button:has-text("Back to decks")');
  await page.waitForSelector('.g-flash-start');

  // ---- Spanish → English direction (persisted), disables active recall ----
  await page.click('.g-flash-seg button[data-dir="es-en"]');
  assert((await page.locator('.g-flash-seg button[data-dir="es-en"]').getAttribute('aria-pressed')) === 'true', 'direction switched');
  assert(await page.locator('.g-flash-start .g-flash-recall-toggle input').isDisabled(), 'recall needs English → Spanish');
  await page.click('.g-flash-deck[data-deck="all"]');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  s = await snap(page);
  assert(s.deck === 'all' && s.n === 20 && s.dir === 'es-en' && s.recall === false, 'All words, Spanish first: ' + JSON.stringify(s));
  const es1 = await entry(page, s.current.id);
  assert((await page.locator('.g-flash-front .g-flash-prompt').textContent()) === es1.es, 'front shows the Spanish');
  assert((await page.locator('.g-flash-input').count()) === 0 && (await page.locator('.g-flash-session .g-flash-recall-toggle input').isDisabled()), 'no recall input in ES → EN');
  assert((await page.locator('.g-flash-deckchip').textContent()).includes('ES → EN'), 'deck chip shows the direction');
  await page.keyboard.press('Space');
  await page.waitForSelector('.g-flash-card.is-flipped');
  await page.keyboard.press('3');
  await settled(page, 1);
  await page.reload();
  await page.waitForSelector('.g-flash-start');
  assert((await page.locator('.g-flash-seg button[data-dir="es-en"]').getAttribute('aria-pressed')) === 'true', 'direction remembered after reload');
  await page.click('.g-flash-seg button[data-dir="en-es"]');

  // ---- Category deck ----
  await page.click('.g-flash-cats .chip[data-cat="question"]');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  s = await snap(page);
  assert(s.deck === 'category' && s.cat === 'question' && s.n === 8, 'question deck has all 8 words: ' + JSON.stringify(s));
  const cats = await page.evaluate((ids) => ids.map((id) => PQ.Vocab.byId(id).cat), s.cards);
  assert(cats.every((c) => c === 'question'), 'every card from the chosen category');
  assert((await page.locator('.g-flash-deckchip').textContent()).includes('Question words'), 'deck chip names the category');
  await page.evaluate(() => PQ.debug.flash.start('all', { dir: 'en-es', recall: false, autoSay: false }));
  s = await snap(page);
  assert(s.deck === 'all' && s.recall === false && s.autoSay === false, 'debug start with options');

  // ---- Due deck when nothing is due ----
  await page.evaluate(() => { PQ.Vocab.all().forEach((e) => PQ.Progress.record(e.id, 'correct')); PQ.debug.flash.showStart(); });
  await page.waitForSelector('.g-flash-start');
  assert(await page.locator('.g-flash-deck[data-deck="due"]').isDisabled(), 'Due deck disabled when nothing is due');
  assert((await page.locator('.g-flash-deck[data-deck="due"] .g-flash-deck-count').textContent()).includes('caught up'), 'caught-up label');
  await page.keyboard.press('1');
  await page.waitForTimeout(150);
  assert((await snap(page)).screen === 'start' && (await page.locator('.toast').count()) >= 1, 'key 1 stays on the start screen with a toast');
  await page.evaluate(() => PQ.Progress.reset());

  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  await browser.close();
  console.log('desktop ok');
}

async function mobile() {
  const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  await page.goto(SITE + '#/play/flash');
  await page.waitForSelector('.g-flash-start');
  assert(await noOverflow(page), 'no horizontal overflow on the start screen');
  await shot(page, 'mobile-start');

  await page.tap('.g-flash-deck[data-deck="due"]');
  await page.waitForSelector('.g-flash-session .g-flash-card');
  assert(await noOverflow(page), 'no horizontal overflow in a session');
  await shot(page, 'mobile-front');

  // Tap flips, tap Good
  await page.tap('.g-flash-front .g-flash-prompt');
  await page.waitForSelector('.g-flash-card.is-flipped');
  assert(await noOverflow(page), 'no horizontal overflow on the back');
  await page.waitForTimeout(600);
  await shot(page, 'mobile-back');
  await page.tap('.g-flash-rate-btn[data-rating="good"]');
  let s = await snap(page);
  assert(s.ratings.length === 1 && s.ratings[0].rating === 'good', 'rated by touch');
  await settled(page, 1);

  // Active recall by touch: type the stem, tap the accent key, Enter flips
  await page.tap('.g-flash-session .g-flash-recall-toggle');
  s = await snap(page);
  assert(s.recall === true, 'recall toggled by touch');
  const id = await force(page, ['frances', 'ingles']);
  await page.waitForSelector('.g-flash-input:not(:disabled)');
  await page.tap('.g-flash-input');
  await page.keyboard.type(id === 'frances' ? 'franc' : 'ingl');
  await page.tap('.g-flash-recall .accent-key:has-text("é")');
  await page.keyboard.type('s');
  const val = await page.inputValue('.g-flash-input');
  assert(val === (id === 'frances' ? 'francés' : 'inglés'), 'accent key inserted at the caret: ' + val);
  await shot(page, 'mobile-recall-front');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.g-flash-card.is-flipped');
  s = await snap(page);
  assert(s.current.attempt && s.current.attempt.status === 'correct', 'touch attempt graded correct');
  assert(await noOverflow(page), 'no horizontal overflow with the attempt shown');
  await page.waitForTimeout(600);
  await shot(page, 'mobile-recall');
  await page.tap('.g-flash-rate-btn[data-rating="easy"]');
  await settled(page, 2);
  s = await snap(page);
  assert(s.ratings.length === 2 && s.ratings[1].rating === 'easy', 'Easy by touch');

  // Quit → finish → end screen → new session
  await page.tap('.g-flash-session button:has-text("Quit")');
  await page.waitForSelector('.modal');
  await page.tap('.modal button:has-text("Finish now")');
  await page.waitForSelector('.g-flash-end');
  assert(await noOverflow(page), 'no horizontal overflow on the end screen');
  await page.waitForTimeout(900);
  await shot(page, 'mobile-end');
  await page.tap('.g-flash-newsession');
  await page.waitForSelector('.g-flash-start');

  assert(errors.length === 0, 'console errors (mobile): ' + errors.join('\n'));
  await browser.close();
  console.log('mobile ok');
}

(async () => {
  await desktop();
  await mobile();
  console.log('ALL PASS: tests/flash.test.js');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
