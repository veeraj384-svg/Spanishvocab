# Palabra Quest — architecture & game-module contract

Zero-build static site (plain scripts, no modules, no bundler). Must work from `file://` and on
Cloudflare Pages. Everything shared lives in `window.PQ` (see `js/core.js`).

## Files

```
index.html              shell: header, <main id="app">, loads every css/js file (already wired)
css/styles.css          design tokens + shared components (DO NOT edit from a game module)
css/pages.css           Words + Progress pages
css/games/<id>.css      one stylesheet per game, every selector prefixed with .g-<id>
js/data.js              window.VOCAB (44 entries), VOCAB_CATEGORIES, VOCAB_META  (never edit)
js/core.js              engine: Text, Vocab, Progress, Settings, Quiz, QuizUI, UI, Sound, Speech, Games, Pages, Router
js/pages.js             registers the 'words' and 'stats' pages
js/games/<id>.js        one game per file; registers itself with PQ.Games.register(...)
tests/helpers.js        Playwright launcher (collects console errors), SITE = file:// url of index.html
tests/<id>.test.js      one test per module, run with `node tests/<id>.test.js`
tests/browser.test.js   whole-site test (every route, every game, churn, leaks, overflow)
tests/run-all.js        runs every test file in order
```

## Vocabulary entries (`window.VOCAB`)

```js
{ id, es, base, en, cat, answers: [canonical, ...alternates], forms?: {m, f}, note? }
```
* `es` – display form exactly as on the sheet (e.g. `"¿Cuál?"`, `"aburrido, aburrida"`).
* `base` – single canonical spelling used by accent games (`"cuál"`, `"aburrido"`).
* `answers` – accepted normalized spellings (lowercase, no ¿?¡!).
* Categories: `school`, `question`, `adjective`, `ordinal`, `useful` (see `PQ.Vocab.categories()`).

**Only ever quiz words from this list. Never invent vocabulary.**

## The engine (`window.PQ`)

| API | Purpose |
| --- | --- |
| `Vocab.active()` | words enabled by the user's category filter (never empty) — use this as your pool |
| `Vocab.withAccents(list?)` | subset containing accents/ñ |
| `Vocab.byId(id)`, `Vocab.byCategory(cat)`, `Vocab.categories()` | lookups |
| `Progress.pick(n, {pool?, exclude?: ids, uniform?})` | weighted random pick (weak/unseen words come up more); unique entries |
| `Progress.pickOne(opts)` | same, single entry |
| `Progress.weakest(n, {includeUnseen?})`, `Progress.due(pool?)` | SRS helpers |
| `Progress.record(id, 'correct'│'accent'│'wrong', {bonus?})` | records an answer → `{xp, box, levelUp, level}`. **QuizUI.ask already calls this – don't double-record.** |
| `Progress.setBest(gameId, score, extra?)` → bool isNewBest | high score (also counts a play) |
| `Progress.best(gameId)`, `Progress.gameStats(gameId)`, `Progress.noteStreak(n)` | stats |
| `Text.check(input, accepted, canonical)` | → `{status: 'correct'│'accent'│'wrong'│'empty', input, expected}` |
| `Text.normalize`, `Text.stripAccents`, `Text.hasAccent`, `Text.accentPositions`, `Text.toggleAccent` | string helpers |
| `Text.esc(s)`, `Text.highlightAccents(s)` (HTML), `Text.diffHtml(typed, expected)` (HTML) | display |
| `Text.accentVariants(word, max)` | plausible misspellings for distractors |
| `Quiz.typed(entry, {gender?})`, `Quiz.choice(entry)`, `Quiz.meaning(entry)`, `Quiz.accent(entry)`, `Quiz.any(entry, kinds?)` | question objects `{kind, entry, prompt, sub, canonical, accepted, ...}` |
| `Quiz.grade(q, answer)` | grade without UI |
| `QuizUI.ask(q, opts)` | **the shared question widget** (see below) |
| `UI.h(tag, props, ...children)` | element builder: `UI.h('button.btn.btn-primary', {type:'button', onclick}, 'Go')` |
| `UI.modal({title, content, closable, onClose, large})` → `{el, close}` | modal; `closable:false` for forced questions |
| `UI.toast(msg, 'ok'│'bad'│'warn')`, `UI.confetti({x,y,count})`, `UI.ring(frac,label,size)`, `UI.masteryDots(id)`, `UI.fmtTime(sec)` | widgets |
| `UI.accentBar(input, {mount?, hint?})` | adds á é í ó ú ñ ü ¿ ¡ buttons + backtick accent trick to an input |
| `Sound.play(name)` | `correct wrong accent jump coin energy gate hurt win lose tick click levelup shoot explode` |
| `Sound.tone(freq, dur, type?, vol?, when?, slideTo?)` | one pitched tone (for combo pitch ramps); silent when muted |
| `Speech.say(text)`, `Speech.enabled()` | pronunciation (Web Speech API) |
| `Rand.pick(arr)`, `Rand.shuffle(arr)`, `Rand.int(a,b)`, `Rand.chance(p)`, `Rand.seeded(seed)` | randomness |
| `Settings.get/set` | `cats` (array│null), `sound`, `speech` |
| `Router.go('/play/spell')` / `ctx.navigate(path)` | hash navigation |

### `QuizUI.ask(question, opts)`

```js
const ctl = PQ.QuizUI.ask(PQ.Quiz.typed(entry), {
  mount: containerEl,          // optional: container is cleared and the widget inserted
  onAnswer(result) {},         // fires immediately when graded (before the learner continues)
  onResult(result) {},         // fires when the learner continues (after feedback). Move to the next question here.
  autoContinue: false,         // true | ms → continue automatically instead of a Continue button
  allowHint: true, allowSkip: false, focus: true, bonus: 0,
});
// result = { status, xp, box, levelUp, question, elapsed, usedHint, input, expected, skipped? }
ctl.el, ctl.answered, ctl.submit(), ctl.destroy()   // ALWAYS destroy() when leaving / unmounting
```
It renders typed / choice / meaning / accent questions, grades, shows feedback (letter diff for
accent mistakes), plays sounds and records progress. For a forced question (platformer energy),
put `ctl.el` inside `UI.modal({closable:false, content: ctl.el})`.

Details worth knowing:
* The Enter that submits a typed answer never also triggers Continue, and Continue fires once.
* Its document-level shortcuts (Enter to confirm/continue, 1–4 to choose) are ignored while a
  modal that does not contain the widget is on top (e.g. a game's quit dialog).
* Asking a new question into the same `mount` container destroys the previous widget.
* `UI.h(..., { style: { '--accent': '…' } })` sets CSS custom properties correctly.

## Game module contract

```js
(function () {
  'use strict';
  const { Vocab, Text, Progress, Quiz, QuizUI, UI, Sound, Rand } = window.PQ;
  let state = null;   // everything the game owns
  PQ.Games.register({
    id: 'spell', name: 'Spell Forge', tagline: 'one line', icon: '✍️', accent: 'var(--c-mint)', order: 2,
    mount(root, ctx) { /* build DOM inside root, start loops */ },
    unmount() { /* cancel RAF + timers, remove window/document listeners, destroy QuizUI, close modals */ },
  });
})();
```
Rules:
1. `mount` receives an **empty** `root` inside `.page.container`. Build everything inside it. Use the
   `.game-shell`, `.game-topbar`, `.game-title`, `.hud`, `.game-stage`, `.game-overlay .panel`,
   `.stat-grid`, `.touch-controls` classes from `css/styles.css` for a consistent look.
2. `unmount` must leave **nothing** running: `cancelAnimationFrame`, `clearInterval/Timeout`,
   remove every `window`/`document` listener you added, `destroy()` QuizUI controllers, `close()` modals.
   The router calls it on navigation; a second `mount` after `unmount` must work (fresh state).
3. Keyboard handlers on `document`/`window` must ignore events while a text input/textarea is
   focused or while a question modal is open (unless that is the intended input).
4. Mobile: everything must work at 390px width with touch. Action games need on-screen buttons
   (`.touch-controls` / `.touch-btn`) and canvases must resize (devicePixelRatio aware).
5. Pause when the tab is hidden (`visibilitychange`); clamp `dt` to ≤ 50ms per frame.
6. Game stylesheet: `css/games/<id>.css`, every selector starts with `.g-<id>`. Never edit
   `css/styles.css`, `js/core.js`, `js/data.js` or `index.html` from a module – report needed
   core changes instead.
7. Only vocab from `Vocab.active()` (via `Progress.pick`). Spelling checks must require accents —
   accent-only mistakes are `status === 'accent'` and are teachable moments (show the diff).
8. Save scores with `Progress.setBest(id, score)` at the end of a run.
9. Expose a tiny debug hook for tests: `window.PQ.debug = window.PQ.debug || {}; PQ.debug.<id> = { get state(){...}, ... }`.
10. No external libraries, no ES modules, no `fetch`, no build step.

## Pages contract (`js/pages.js`)

`PQ.Pages.register('words', (root, ctx, route) => { ... })` and `'stats'` the same way, or pass
`{ mount(root, ctx, route), unmount() }` to get a cleanup hook. `root` is `<main id="app">`,
already emptied. Wrap content in `UI.h('div.page.container')`. The router calls the page's
`unmount()` (and a game's) before rendering the next route and then dispatches a window
`pq:unmount` event, so page-owned listeners can be removed either way. Toggling sound anywhere
(`Sound.toggle()` / `Settings.set('sound', …)`) repaints the header button via `pq:settings`.

## Testing

```js
const { launch, assert, SITE } = require('./helpers');
const { browser, page, errors } = await launch({ viewport: {width: 1280, height: 800} });
await page.goto(SITE + '#/play/spell'); ...
assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
await browser.close();
```
Run with `node tests/<id>.test.js`. Google Fonts are blocked in tests (offline-safe).
