# Spanish Vocab 🎮

A premium, zero-build website of games for memorizing the **spelling and accents** of the
Spanish vocabulary sheet (*Subject pronouns and more*: subject pronouns, question words and everyday phrases).

All 31 words from the sheet are in `js/data.js`. Progress, XP and per-word mastery are stored
in your browser (`localStorage`), and weak words are served more often until they stick.

## Games

| Game | What it trains |
| --- | --- |
| **Energy Run** (platformer) | Running drains energy; answering spelling questions recharges it. Word gates block the path, sliding platforms and lifts carry you across, and a level select lets you replay any level you have unlocked. |
| **Spell Forge** | Type the Spanish word from the English prompt. Accent-only mistakes are diffed letter by letter. |
| **Accent Hunter** | Timed rounds: tap the letters that need an accent or ñ. |
| **Memory Deck** | Spaced-repetition flashcards with pronunciation. |
| **Word Rain** | Arcade typing defense: destroy falling words by spelling them correctly. |

Typing tip: type a vowel or `n`, then press <kbd>`</kbd> to add its accent (a → á, n → ñ). There is
also an on-screen accent bar in every typing game.

The home page plays “Vibing” by Pufino (freetouse.com, trimmed to the musical part, in
`assets/music/`). Each game has its own generated lofi piece: a
40-bar loop (slow swung drums, warm seventh-chord pads, an electric-piano melody and a vinyl
crackle bed, all synthesized in the browser, no audio files). The 🔊 button at the top of every
page opens a quick panel with master, effects and music volume sliders plus music and mute
switches; the same controls sit in the game dock (with a fullscreen button) and under
Progress → Settings.

## Deploying on Cloudflare Pages

This is a static site with **no build step**.

1. Push this repo to GitHub.
2. In Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → pick the repo.
3. Build settings: **Framework preset:** None · **Build command:** *(leave empty)* · **Build output directory:** `/`
4. Deploy. Every push to the production branch redeploys.

Routing uses URL hashes (`#/play/platformer`), so no `_redirects` rules are needed.
`_headers` adds a few security headers.

## Local development

Just open `index.html`, or serve the folder:

```
npx http-server . -p 8080
```

## Tests

```
node tests/run-all.js            # everything below, in order
node tests/core.test.js          # pure logic tests (normalization, accent checks, SRS)
node tests/quizui.test.js        # the shared question widget in a real browser
node tests/<game>.test.js        # one Playwright test per game / page module
node tests/browser.test.js       # whole-site test: every route, every game, leaks, overflow
```

Browser tests use the globally installed Playwright (`npm i -g playwright` + Chromium).
