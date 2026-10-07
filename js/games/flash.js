/* ============================================================
   PALABRA QUEST — Memory Deck  (game id: 'flash')
   Spaced-repetition flashcards with pronunciation: build the
   memory of each word before the spelling games hammer it in.

   Decks
     due       Progress.due()            words scheduled for today (unseen count as due)
     weak      Progress.weakest(12)      the shakiest words, unseen included
     all       up to 20 cards from the whole active list
     category  every word of one category (max 20)
     review    the cards rated "Again" in the previous session

   A card is flipped (click / tap / Space), optionally after an
   "active recall" spelling attempt, then rated:
     Again → Progress.record(id, 'wrong')     Hard → 'accent'
     Good  → 'correct'                        Easy → 'correct' + 5 bonus XP
   Progress is recorded ONLY through the rating (never twice).
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, UI, Sound, Speech, Store } = PQ;
  const h = UI.h;

  const ID = 'flash';
  const PREF_KEY = 'pq.flash.v1';   // remembered options: direction, active recall, auto-pronounce
  const MAX_CARDS = 20;
  const WEAK_COUNT = 12;
  const EASY_BONUS = 5;
  const RATE_HOLD_MS = 420;         // time to watch the mastery dots update before the card leaves
  const OUT_MS = 320;               // slide-out duration (matches css)
  const ENTER_GUARD_MS = 300;       // Enter cannot rate a card this soon after it was revealed

  const RATINGS = [
    { id: 'again', n: 1, label: 'Again', status: 'wrong',   icon: '↺', hint: 'Blanked on it — see it again soon', sound: 'wrong',   color: 'var(--c-rose)' },
    { id: 'hard',  n: 2, label: 'Hard',  status: 'accent',  icon: '≈', hint: 'Shaky, or the accents were off',    sound: 'accent',  color: 'var(--c-amber)' },
    { id: 'good',  n: 3, label: 'Good',  status: 'correct', icon: '✓', hint: 'Got it with a little effort',       sound: 'correct', color: 'var(--c-mint)' },
    { id: 'easy',  n: 4, label: 'Easy',  status: 'correct', icon: '⚡', hint: 'Instant recall · +5 bonus XP',     sound: 'coin',    color: 'var(--c-sky)', bonus: EASY_BONUS },
  ];
  // Rating suggested after an active-recall attempt.
  const SUGGEST = { correct: 'good', accent: 'hard', wrong: 'again' };

  const DECKS = {
    due:      { id: 'due',      name: 'Due today',    icon: '📅', accent: 'var(--c-sky)',   key: '1', desc: 'What your schedule says to review today. Words you have never seen count as due.' },
    weak:     { id: 'weak',     name: 'Weakest',      icon: '🎯', accent: 'var(--c-rose)',  key: '2', desc: 'Your twelve shakiest words: lowest mastery, most accent slips.' },
    all:      { id: 'all',      name: 'All words',    icon: '🃏', accent: 'var(--c-amber)', key: '3', desc: 'Up to twenty cards from the whole sheet, weighted toward the weak ones.' },
    category: { id: 'category', name: 'By category', icon: '🗂️', accent: 'var(--c-lav)',   key: '',  desc: 'One group from the sheet, every word once.' },
    review:   { id: 'review',   name: 'Review again', icon: '🔁', accent: 'var(--c-mint)',  key: '',  desc: 'Only the cards you rated "Again".' },
  };
  // Short category labels for chips (the sheet titles are long sentences).
  const CAT_SHORT = { school: 'School day', question: 'Question words', adjective: 'Adjectives', ordinal: 'Ordinals', useful: 'Useful words' };

  /* ------------------------------------------------------------
     Module state
     `view`  everything tied to the mounted DOM (root, timers, listeners, modal)
     `state` the current screen / session
     `els`   live elements of the current screen
     ------------------------------------------------------------ */
  let view = null;
  let state = null;
  let els = {};

  /* ---------- tiny helpers ---------- */
  function prefs() { return Object.assign({ dir: 'en-es', recall: false, autoSay: true }, Store.get(PREF_KEY, {})); }
  function savePref(key, value) { const p = prefs(); p[key] = value; Store.set(PREF_KEY, p); }
  function catLabel(id) { const c = Vocab.category(id); return CAT_SHORT[id] || (c ? c.en : id); }
  function stat(val, label) { return h('div.stat', null, h('div.stat-val', null, String(val)), h('div.stat-label', null, label)); }
  function uniqById(entries) { const seen = new Set(); return entries.filter((e) => e && !seen.has(e.id) && seen.add(e.id)); }
  function ratingById(id) { return RATINGS.find((r) => r.id === id) || null; }
  function finePointer() { return !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  function deckLabel(s) { return s.deck.id === 'category' && s.cat ? catLabel(s.cat) : s.deck.name; }

  /** setTimeout that is cancelled on unmount. */
  function later(fn, ms) {
    const id = setTimeout(() => { if (!view) return; view.timeouts.delete(id); fn(); }, ms);
    view.timeouts.add(id);
    return id;
  }
  /** Eased RAF tween; `step(k)` gets 0..1. Cancelled on unmount. */
  function tween(ms, step) {
    const t0 = performance.now();
    let id = 0;
    const tick = (t) => {
      view.rafs.delete(id);
      const k = Math.min(1, (t - t0) / ms);
      step(1 - Math.pow(1 - k, 3));
      if (k < 1) { id = requestAnimationFrame(tick); view.rafs.add(id); }
    };
    id = requestAnimationFrame(tick); view.rafs.add(id);
  }
  function onDoc(type, fn) { document.addEventListener(type, fn); view.docListeners.push([type, fn]); }
  function replayClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }
  function focusEl(el) { if (el) { try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  function closeModal() { if (view && view.modal) { const m = view.modal; view.modal = null; m.close(); } }
  /** Drop a pending rate → next-card transition (quitting / ending mid-flip must never fire it later). */
  function cancelTransition() {
    if (!state) return;
    if (state.nextTimer) { clearTimeout(state.nextTimer); if (view) view.timeouts.delete(state.nextTimer); state.nextTimer = 0; }
    state.animating = false;
  }
  function stopSpeech() { try { if (Speech.available()) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }

  /** Seconds in the session, excluding time spent in a hidden tab. */
  function elapsedSec() {
    if (!state || !state.t0) return 0;
    const now = state.pausedAt == null ? performance.now() : state.pausedAt;
    return Math.max(0, (now - state.t0 - state.paused) / 1000);
  }
  function onVisibility() {
    if (!state || state.screen !== 'session') return;
    if (document.hidden) { if (state.pausedAt == null) state.pausedAt = performance.now(); }
    else if (state.pausedAt != null) { state.paused += performance.now() - state.pausedAt; state.pausedAt = null; }
  }

  /* ------------------------------------------------------------
     Keyboard
       start:    1 / 2 / 3 pick a deck
       session:  Space flips · Enter flips, or applies the suggested rating
                 1-4 rate · Esc asks to leave
     Ignored while typing, while a modal is open, and (Space / Enter)
     while a button has focus so the button keeps its own behaviour.
     ------------------------------------------------------------ */
  function onDocKey(e) {
    if (!state || !view || view.modal || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const t = e.target;
    const tag = t && t.tagName;
    // Esc leaves from anywhere in a session — even while typing a recall attempt
    if (e.key === 'Escape' && state.screen === 'session') { e.preventDefault(); confirmQuit(); return; }
    const textInput = tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) || (tag === 'INPUT' && !/^(checkbox|radio|button)$/i.test(t.type || 'text'));
    if (textInput) return;
    const onButton = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT';   // a focused checkbox keeps its native Space

    if (state.screen === 'start') {
      const deck = { 1: 'due', 2: 'weak', 3: 'all' }[e.key];
      if (deck) { e.preventDefault(); startSession(deck); }
      return;
    }
    if (state.screen !== 'session') return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      if (onButton) return;
      e.preventDefault(); flip();
      return;
    }
    if (e.key === 'Enter') {
      if (onButton) return;
      e.preventDefault();
      const cur = state.current;
      const sug = cur && cur.revealed && !cur.rated ? suggestedRating(cur) : null;
      if (sug) { if (performance.now() - cur.revealedAt > ENTER_GUARD_MS) rate(sug); return; } // inside the guard: ignore, never flip the grading away
      flip();
      return;
    }
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= RATINGS.length) {
      e.preventDefault();
      if (!rate(RATINGS[n - 1].id)) nudgeFlip();
    }
  }

  /* ------------------------------------------------------------
     Deck construction
     Every deck is a pool of sheet vocabulary (subset of Vocab.active())
     ordered by Progress.pick, so weak / unseen / overdue words come first
     and no card repeats within a session.
     ------------------------------------------------------------ */
  function buildDeck(deckId, opts) {
    opts = opts || {};
    const active = Vocab.active();
    let deck = DECKS[deckId] || DECKS.all;
    let pool = active;
    let cat = null;
    switch (deck.id) {
      case 'due':
        pool = Progress.due(active);
        break;
      case 'weak':
        pool = Progress.weakest(WEAK_COUNT, { includeUnseen: true, pool: active });
        break;
      case 'category':
        cat = opts.cat || null;
        // Only words the learner's category filter allows (Vocab.active); an excluded category falls back to the whole active list.
        pool = active.filter((e) => e.cat === cat);
        if (!pool.length) { UI.toast('That category is filtered out on Home — dealing from all active words instead.', 'warn'); deck = DECKS.all; cat = null; pool = active; }
        break;
      case 'review': {
        pool = uniqById((opts.entries || []).map((e) => (typeof e === 'string' ? Vocab.byId(e) : e)));
        if (!pool.length) return buildDeck('all', opts);
        break;
      }
      default:
        deck = DECKS.all;
    }
    const n = Math.min(opts.limit || MAX_CARDS, pool.length);
    return { deck, cat, cards: Progress.pick(n, { pool }) };
  }

  function startSession(deckId, opts) {
    if (!view) return null;
    opts = opts || {};
    closeModal(); stopSpeech();
    const p = prefs();
    const built = buildDeck(deckId, opts);
    if (!built.cards.length) {
      UI.toast(built.deck.id === 'due' ? '✓ Nothing due right now — try Weakest or All words.' : 'That deck has no cards right now.', 'warn');
      if (!state || state.screen !== 'start') showStart();
      return null;
    }
    const dir = opts.dir === 'es-en' || opts.dir === 'en-es' ? opts.dir : (p.dir === 'es-en' ? 'es-en' : 'en-es');
    const recallPref = opts.recall != null ? !!opts.recall : !!p.recall;
    state = {
      screen: 'session', deck: built.deck, cat: built.cat, cards: built.cards, index: 0,
      dir,
      recall: dir === 'en-es' && recallPref,       // a spelling attempt only makes sense when the Spanish is hidden
      autoSay: opts.autoSay != null ? !!opts.autoSay : p.autoSay !== false,
      ratings: [], counts: { again: 0, hard: 0, good: 0, easy: 0 }, xp: 0,
      current: null, animating: false,
      t0: performance.now(), paused: 0, pausedAt: null,
      opts: Object.assign({}, opts),
    };
    renderSession();
    showCard(true);
    return state;
  }

  /* ------------------------------------------------------------
     Cards
     ------------------------------------------------------------ */
  function showCard(animate) {
    const s = state;
    const entry = s.cards[s.index];
    s.current = { entry, flipped: false, revealed: false, revealedAt: 0, attempt: null, rated: false };
    UI.clear(els.stage);
    buildCard();
    if (animate) { els.card.classList.add('is-in'); later(() => { if (els.card) els.card.classList.remove('is-in'); }, 450); }
    els.stage.appendChild(els.card);
    setFaces();
    resetRateRow();
    updateProgress();
    // Keyboard-first on desktop: the recall input (if any) or the card itself takes focus.
    later(() => { if (els.input && finePointer()) focusEl(els.input); else focusEl(els.card); }, 40);
  }

  function buildCard() {
    const s = state, cur = s.current, e = cur.entry;
    const cat = Vocab.category(e.cat);
    const enFirst = s.dir === 'en-es';
    const catPill = () => h('span.g-flash-cat', { title: cat ? cat.es : '' }, h('span', { 'aria-hidden': 'true' }, cat ? cat.icon : '📘'), ' ', catLabel(e.cat));
    els.dotsFront = UI.masteryDots(e.id);
    els.dotsBack = UI.masteryDots(e.id);

    // ---- Front: the prompt (+ optional spelling attempt) ----
    const prompt = enFirst ? h('div.g-flash-prompt', null, e.en) : h('div.g-flash-prompt.is-es', { html: Text.highlightAccents(e.es) });
    els.input = null;
    let recallBox = null;
    if (s.recall) {
      els.input = h('input.input.g-flash-input', { type: 'text', placeholder: 'Type the Spanish…', 'aria-label': 'Your spelling attempt', enterkeyhint: 'go' });
      els.input.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault(); ev.stopPropagation();   // the document handler must not also see this Enter
        if (!cur.revealed) flip();
      });
      recallBox = h('div.g-flash-recall', null,
        h('div.g-flash-recall-label', null, '✍️ Active recall · type it, then ', h('span.kbd', null, 'Enter'), ' to flip'),
        els.input);
      UI.accentBar(els.input, { mount: recallBox, hint: false });
    }
    els.flipHint = h('div.g-flash-flip-hint', null, h('span.kbd', null, 'Space'), ' or tap to flip');
    els.front = h('div.g-flash-face.g-flash-front', null,
      h('div.g-flash-face-top', null, catPill(), els.dotsFront),
      h('div.g-flash-face-body', null,
        h('div.g-flash-kind', null, enFirst ? 'English' : 'Español'),
        prompt,
        h('div.g-flash-sub', null, enFirst ? 'How do you say it in Spanish?' : 'What does it mean?'),
        recallBox),
      els.flipHint);

    // ---- Back: the answer ----
    const say = Speech.available()
      ? h('button.btn.btn-ghost.btn-icon.g-flash-say', { type: 'button', title: 'Hear it', 'aria-label': 'Hear ' + e.base, onclick: () => { Speech.say(e.base); Sound.play('tick'); } }, '🔊')
      : null;
    els.attempt = h('div.g-flash-attempt.hidden');
    els.back = h('div.g-flash-face.g-flash-back', null,
      h('div.g-flash-face-top', null, catPill(), els.dotsBack),
      h('div.g-flash-face-body', null,
        h('div.g-flash-kind', null, 'Español'),
        h('div.g-flash-es-row', null, h('div.g-flash-es', { html: Text.highlightAccents(e.es) }), say),
        h('div.g-flash-en', null, e.en),
        e.note ? h('div.g-flash-note', null, e.note) : null,
        els.attempt),
      h('div.g-flash-flip-hint', null, 'Rate it below · ', h('span.kbd', null, '1'), '–', h('span.kbd', null, '4')));

    els.inner = h('div.g-flash-card-inner', null, els.front, els.back);
    els.card = h('div.g-flash-card', {
      tabindex: '0', role: 'button', 'aria-pressed': 'false',
      'aria-label': 'Flashcard: ' + (enFirst ? e.en : e.es) + '. Press Space to flip.',
    }, els.inner);
    els.card.addEventListener('click', (ev) => {
      // Controls inside the card (input, accent keys, speaker) handle themselves.
      if (ev.target.closest('input, button, a, .accent-bar')) return;
      flip();
    });
  }

  /** Mark the hidden face inert so it cannot be focused or read while turned away. */
  function setFaces() {
    const cur = state && state.current;
    if (!cur || !els.front) return;
    const flipped = cur.flipped;
    els.front.toggleAttribute('inert', flipped);
    els.front.setAttribute('aria-hidden', flipped ? 'true' : 'false');
    els.back.toggleAttribute('inert', !flipped);
    els.back.setAttribute('aria-hidden', flipped ? 'false' : 'true');
    els.card.setAttribute('aria-pressed', flipped ? 'true' : 'false');
    els.card.classList.toggle('is-flipped', flipped);
  }

  /** Flip the card (first flip reveals the answer and grades the recall attempt). Returns the new flipped state. */
  function flip() {
    const cur = state && state.current;
    if (!cur || state.screen !== 'session' || state.animating || cur.rated) return false;
    if (!cur.revealed) {
      cur.revealed = true;
      cur.revealedAt = performance.now();
      if (els.input) evaluateAttempt();
      renderAttempt();
      els.rate.classList.add('is-ready');
      RATINGS.forEach((r) => { els.rateBtns[r.id].disabled = false; });
      els.rateHint.textContent = cur.attempt && SUGGEST[cur.attempt.status] ? 'Rate it — Enter takes the suggestion.' : 'How well did you know it?';
      if (state.autoSay) Speech.say(cur.entry.base);
    }
    cur.flipped = !cur.flipped;
    setFaces();
    Sound.play('click');
    return cur.flipped;
  }

  /** Grade the active-recall input with Text.check (accents required). */
  function evaluateAttempt() {
    const cur = state.current, e = cur.entry;
    const r = Text.check(els.input.value, e.answers, e.answers[0]);
    cur.attempt = { input: els.input.value, typed: r.input, status: r.status, expected: r.expected };
    els.input.disabled = true;
    if (r.status !== 'empty') els.input.classList.add(r.status === 'correct' ? 'is-correct' : r.status === 'accent' ? 'is-accent' : 'is-wrong');
    return cur.attempt;
  }
  function suggestedRating(cur) { return cur && cur.attempt ? (SUGGEST[cur.attempt.status] || null) : null; }

  function renderAttempt() {
    const cur = state.current, a = cur.attempt;
    if (!els.attempt) return;
    UI.clear(els.attempt);
    els.attempt.className = 'g-flash-attempt';
    if (!a) { els.attempt.classList.add('hidden'); markSuggested(null); return; }
    const titles = {
      correct: '✓ Spot on — you spelled it right',
      accent: '´ Letters right, accents off',
      wrong: '✗ Not quite — compare the letters',
      empty: 'No attempt typed — rate it honestly',
    };
    els.attempt.classList.add('is-' + a.status);
    els.attempt.appendChild(h('div.g-flash-attempt-title', null, titles[a.status] || titles.wrong));
    if (a.status === 'accent' || a.status === 'wrong') els.attempt.appendChild(h('div.g-flash-attempt-diff', { html: Text.diffHtml(a.typed, a.expected) }));
    const sug = suggestedRating(cur);
    if (sug) els.attempt.appendChild(h('div.g-flash-attempt-sug.small', null, 'Suggested: ', h('b', null, ratingById(sug).label), ' · press ', h('span.kbd', null, 'Enter')));
    markSuggested(sug);
  }
  function markSuggested(id) {
    RATINGS.forEach((r) => {
      const b = els.rateBtns[r.id];
      b.classList.toggle('is-suggested', r.id === id);
      b.querySelector('.g-flash-rate-tag').textContent = r.id === id ? 'suggested' : '';
    });
  }
  function resetRateRow() {
    els.rate.classList.remove('is-ready');
    RATINGS.forEach((r) => { const b = els.rateBtns[r.id]; b.disabled = true; b.classList.remove('is-suggested', 'is-picked'); b.querySelector('.g-flash-rate-tag').textContent = ''; });
    els.rateHint.textContent = 'Flip the card, then rate how well you knew it.';
  }
  function nudgeFlip() {
    if (!els.card || !state.current || state.current.revealed) return;
    replayClass(els.flipHint, 'anim-shake');
    Sound.play('tick');
  }

  /* ------------------------------------------------------------
     Rating — the ONLY place progress is recorded
     ------------------------------------------------------------ */
  function rate(ratingId) {
    const cur = state && state.current;
    const r = ratingById(ratingId);
    if (!cur || !r || state.screen !== 'session' || state.animating || !cur.revealed || cur.rated) return null;
    cur.rated = true;
    const rec = Progress.record(cur.entry.id, r.status, r.bonus ? { bonus: r.bonus } : undefined);
    const item = { id: cur.entry.id, entry: cur.entry, rating: r.id, status: r.status, xp: rec.xp, box: rec.box, attempt: cur.attempt };
    state.ratings.push(item);
    state.counts[r.id]++;
    state.xp += rec.xp;

    Sound.play(r.sound);
    if (rec.levelUp) later(() => { Sound.play('levelup'); UI.toast('Level up! You are now level ' + rec.level, 'ok'); }, 350);

    // Show the result on the card: fresh mastery dots (pop), the pressed button, an XP float.
    const freshBack = UI.masteryDots(cur.entry.id), freshFront = UI.masteryDots(cur.entry.id);
    els.dotsBack.replaceWith(freshBack); els.dotsFront.replaceWith(freshFront);
    els.dotsBack = freshBack; els.dotsFront = freshFront;
    freshBack.classList.add('anim-pop');
    const btn = els.rateBtns[r.id];
    btn.classList.add('is-picked');
    markSuggested(null);
    if (!cur.flipped) { cur.flipped = true; setFaces(); }   // leave on the answer side
    spawnFloat(r, rec.xp);
    updateCounts(r.id);
    updateProgress();

    state.animating = true;
    state.nextTimer = later(() => {
      if (els.card) els.card.classList.add('is-out');
      state.nextTimer = later(nextCard, OUT_MS);
    }, RATE_HOLD_MS);
    return item;
  }

  function nextCard() {
    if (!state || state.screen !== 'session') return;   // the session ended while the card was leaving
    state.nextTimer = 0;
    state.animating = false;
    state.index++;
    if (state.index >= state.cards.length) { endSession('complete'); return; }
    showCard(true);
  }

  function spawnFloat(r, xp) {
    if (!els.stage) return;
    const el = h('div.g-flash-float', { 'aria-hidden': 'true' }, xp ? '+' + xp + ' XP' : r.label.toLowerCase());
    el.style.setProperty('--rate', r.color);
    els.stage.querySelectorAll('.g-flash-float').forEach((old) => old.remove());
    els.stage.appendChild(el);
    if (els.card) {   // sit in the card's top-right corner, whatever the stage width
      el.style.right = 'auto';
      el.style.left = Math.max(0, els.card.offsetLeft + els.card.offsetWidth - el.offsetWidth - 16) + 'px';
      el.style.top = (els.card.offsetTop + 14) + 'px';
    }
    later(() => el.remove(), 1100);
  }

  /* ------------------------------------------------------------
     Session screen
     ------------------------------------------------------------ */
  function topbar(right, chip) {
    return h('div.game-topbar', null,
      h('div.game-title', null, h('span.icon', null, '🃏'), 'Memory Deck', chip || null),
      right || null);
  }

  function renderSession() {
    const s = state, d = s.deck;
    UI.clear(view.root);
    els = {};
    window.scrollTo(0, 0);
    const shell = h('div.game-shell.g-flash.g-flash-session');
    shell.style.setProperty('--accent', d.accent);
    const chip = h('span.g-flash-deckchip', null, d.icon + ' ' + deckLabel(s), h('span.g-flash-deckchip-dir', null, s.dir === 'en-es' ? 'EN → ES' : 'ES → EN'));
    shell.appendChild(topbar(h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Leave this session (Esc)', onclick: confirmQuit }, '✕ Quit'), chip));

    // Progress bar
    els.progLabel = h('span.g-flash-progress-label');
    els.progRight = h('span.muted');
    els.bar = h('div.bar-fill');
    shell.appendChild(h('div.g-flash-progress', null,
      h('div.g-flash-progress-head.small', null, els.progLabel, els.progRight),
      h('div.bar', { role: 'progressbar', 'aria-label': 'Session progress' }, els.bar)));

    // HUD: rating counters + XP
    els.counts = {}; els.countEls = {};
    const counts = h('div.g-flash-counts', { role: 'group', 'aria-label': 'Ratings so far' });
    RATINGS.forEach((r) => {
      const b = h('b', null, '0');
      const c = h('span.g-flash-count', { dataset: { rating: r.id }, title: r.label, 'aria-label': r.label }, h('i', { 'aria-hidden': 'true' }), b, h('span.g-flash-count-label', null, r.label), h('span.g-flash-count-short', { 'aria-hidden': 'true' }, r.label.charAt(0)));
      c.style.setProperty('--rate', r.color);
      els.counts[r.id] = b; els.countEls[r.id] = c;
      counts.appendChild(c);
    });
    els.xp = h('span.val', null, '+0');
    els.xpWrap = h('div.hud-item.g-flash-xp', null, h('span.label', null, 'XP'), els.xp);
    shell.appendChild(h('div.hud.g-flash-hud', null, counts, h('div.hud-spacer'), els.xpWrap));

    // Stage: the card lives here (and the XP floats)
    els.stage = h('div.g-flash-stage');
    shell.appendChild(els.stage);

    // Rating row
    els.rate = h('div.g-flash-rate', { role: 'group', 'aria-label': 'Rate this card' });
    els.rateBtns = {};
    RATINGS.forEach((r) => {
      const b = h('button.btn.g-flash-rate-btn', { type: 'button', disabled: true, dataset: { rating: r.id }, title: r.hint + ' (' + r.n + ')', 'aria-keyshortcuts': String(r.n) },
        h('span.g-flash-rate-key', { 'aria-hidden': 'true' }, String(r.n)),
        h('span.g-flash-rate-icon', { 'aria-hidden': 'true' }, r.icon),
        h('span.g-flash-rate-label', null, r.label),
        h('span.g-flash-rate-tag'));
      b.style.setProperty('--rate', r.color);
      b.addEventListener('click', () => { b.blur(); rate(r.id); });   // blur: a later Space must flip the next card, not re-press this button
      els.rateBtns[r.id] = b;
      els.rate.appendChild(b);
    });
    shell.appendChild(els.rate);
    els.rateHint = h('div.g-flash-rate-hint.small.muted.center', { 'aria-live': 'polite' });
    shell.appendChild(els.rateHint);

    // Options: active recall + auto-pronounce (remembered)
    const refocus = () => later(() => { if (state && state.screen === 'session') focusEl(els.input && !els.input.disabled && finePointer() ? els.input : els.card); }, 0);
    const recallInput = h('input', { type: 'checkbox', checked: s.recall, disabled: s.dir !== 'en-es', onchange: (e) => { e.target.blur(); setRecall(!!e.target.checked); Sound.play('click'); refocus(); } });
    const sayInput = h('input', { type: 'checkbox', checked: s.autoSay, onchange: (e) => { e.target.blur(); s.autoSay = !!e.target.checked; savePref('autoSay', s.autoSay); Sound.play('click'); refocus(); } });
    shell.appendChild(h('div.g-flash-options', null,
      h('label.toggle.g-flash-recall-toggle', { title: s.dir === 'en-es' ? 'Type the spelling before you flip' : 'Active recall needs English → Spanish' }, recallInput, h('span.track'), h('span', null, '✍️ Active recall')),
      Speech.available() ? h('label.toggle.g-flash-say-toggle', { title: 'Pronounce the word when the card flips' }, sayInput, h('span.track'), h('span', null, '🔊 Auto-pronounce')) : null,
      h('span.small.muted.g-flash-keys', { html: '<span class="kbd">Space</span> flip · <span class="kbd">1</span>–<span class="kbd">4</span> rate · <span class="kbd">Esc</span> leave' })));

    view.root.appendChild(shell);
    updateCounts(null);
  }

  /** Toggle active recall mid-session; an unrevealed card is rebuilt so the input appears / disappears at once. */
  function setRecall(on) {
    if (!state || state.screen !== 'session') return;
    state.recall = state.dir === 'en-es' && !!on;
    savePref('recall', !!on);
    if (state.current && !state.current.revealed && !state.animating) showCard(false);
  }

  function updateCounts(bumped) {
    const s = state;
    if (!els.counts) return;
    RATINGS.forEach((r) => { els.counts[r.id].textContent = String(s.counts[r.id]); });
    if (bumped) replayClass(els.countEls[bumped], 'is-bump');
    els.xp.textContent = '+' + s.xp;
    if (bumped) replayClass(els.xpWrap, 'is-bump');
  }

  function updateProgress() {
    const s = state;
    if (!els.bar) return;
    const n = s.cards.length, done = s.ratings.length, cur = Math.min(s.index + 1, n);
    const left = n - cur;
    els.progLabel.textContent = 'Card ' + cur + ' of ' + n;
    els.progRight.textContent = left > 0 ? left + ' to go' : 'last card!';
    els.bar.style.width = Math.round(100 * done / n) + '%';
  }

  function confirmQuit() {
    if (!state || state.screen !== 'session' || view.modal) return;
    const rated = state.ratings.length;
    const content = h('div.stack', null,
      h('p.text-2', { style: { margin: 0 } }, rated
        ? 'Finish now with ' + rated + (rated === 1 ? ' card' : ' cards') + ' reviewed, or leave this deck? Every rating is already saved to your word progress.'
        : 'Leave this deck? Nothing is lost.'),
      h('div.row', null,
        rated ? h('button.btn.btn-mint', { type: 'button', onclick: () => { closeModal(); endSession('quit'); } }, 'Finish now') : null,
        h('button.btn.btn-outline', { type: 'button', onclick: () => { closeModal(); cancelTransition(); showStart(); } }, 'Back to decks'),
        h('button.btn.btn-ghost', { type: 'button', onclick: closeModal }, 'Keep going')));
    view.modal = UI.modal({
      title: 'Put the deck down?', content, closable: true,
      onClose: () => {
        if (!view) return;
        view.modal = null;
        // "Keep going" / Esc: put the keyboard back on the card (or the recall input)
        later(() => { if (state && state.screen === 'session') focusEl(els.input && !els.input.disabled && finePointer() ? els.input : els.card); }, 40);
      },
    });
  }

  /* ------------------------------------------------------------
     Session end
     ------------------------------------------------------------ */
  function endSession(reason) {
    if (!state || state.screen !== 'session') return;   // idempotent: a late timer or a second click must not end it twice
    cancelTransition();
    closeModal(); stopSpeech();
    const s = state;
    s.screen = 'end';
    s.reason = reason;
    s.time = elapsedSec();
    s.reviewed = s.ratings.length;
    s.again = s.ratings.filter((r) => r.rating === 'again');
    const known = s.counts.good + s.counts.easy;
    s.recallRate = s.reviewed ? known / s.reviewed : 0;
    // Best = most cards reviewed in one session (also counts the play).
    s.newBest = Progress.setBest(ID, s.reviewed, {});

    renderEnd();
    const clean = s.reviewed > 0 && !s.again.length;
    later(() => Sound.play(clean ? 'win' : s.reviewed ? 'gate' : 'click'), 120);
    if (clean) later(() => UI.confetti({ count: s.counts.hard ? 130 : 190 }), 260);
    if (s.newBest && s.reviewed) later(() => UI.toast('🏆 New best: ' + s.reviewed + ' cards in one session', 'ok'), 700);
  }

  function renderEnd() {
    const s = state;
    UI.clear(view.root);
    els = {};
    window.scrollTo(0, 0);
    const n = s.reviewed;
    const pct = Math.round(s.recallRate * 100);
    const headline = !n ? 'No cards reviewed this time.'
      : !s.again.length && !s.counts.hard ? '¡Perfecto! Every card came straight back.'
      : !s.again.length ? '¡Muy bien! Nothing to re-learn.'
      : s.again.length <= n * 0.3 ? 'Solid session — a few cards to revisit.'
      : 'Tough deck — the cards you missed are queued up.';
    const reason = { complete: deckLabel(s) + ' · deck complete', quit: 'Finished early' }[s.reason] || 'Session complete';

    const shell = h('div.game-shell.g-flash.g-flash-endwrap');
    shell.style.setProperty('--accent', s.deck.accent);
    shell.appendChild(topbar(h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← Home')));

    const panel = h('div.card.card-glass.g-flash-end');
    panel.appendChild(h('div.eyebrow', null, reason));
    panel.appendChild(h('h2', null, headline));

    els.big = h('div.g-flash-bigcount', null, '0');
    panel.appendChild(h('div.g-flash-end-top', null,
      h('div.g-flash-end-count', null, els.big, h('div.small.muted', null, n === 1 ? 'card reviewed' : 'cards reviewed'),
        s.newBest && n ? h('span.chip.chip-mint.g-flash-newbest', null, '🏆 New best') : null),
      h('div.g-flash-end-ring', null, UI.ring(s.recallRate, pct + '%', 128), h('div.small.muted.center', null, 'recalled'))));

    const grid = h('div.stat-grid.g-flash-end-stats');
    RATINGS.forEach((r) => { const el = stat(s.counts[r.id], r.label); el.style.setProperty('--rate', r.color); el.classList.add('g-flash-end-stat'); grid.appendChild(el); });
    grid.appendChild(stat('+' + s.xp, 'XP earned'));
    grid.appendChild(stat(UI.fmtTime(s.time), 'Time'));
    panel.appendChild(grid);

    if (s.again.length) {
      panel.appendChild(h('div.g-flash-again-head', null, h('h3', null, 'Rated "Again"'), h('span.small.muted', null, 'these come back first')));
      const list = h('div.g-flash-again');
      s.again.forEach((a) => {
        list.appendChild(h('div.g-flash-again-row', { dataset: { id: a.id } },
          h('div.g-flash-again-main', null,
            h('div.g-flash-again-es', { html: Text.highlightAccents(a.entry.es) }),
            h('div.g-flash-again-en.small.text-2', null, a.entry.en + (a.entry.note ? ' · ' + a.entry.note : ''))),
          h('div.g-flash-again-side', null,
            UI.masteryDots(a.id),
            Speech.available() ? h('button.btn.btn-ghost.btn-sm.btn-icon.g-flash-say', { type: 'button', title: 'Hear it', 'aria-label': 'Hear ' + a.entry.base, onclick: () => Speech.say(a.entry.base) }, '🔊') : null)));
      });
      panel.appendChild(list);
    } else if (n) {
      panel.appendChild(h('p.g-flash-clean', null, '✨ Not a single "Again" — this deck is settling in.'));
    }

    els.again = h('button.btn' + (s.again.length ? '.btn-outline' : '.btn-primary') + '.btn-lg.g-flash-newsession', { type: 'button', onclick: () => { Sound.play('click'); showStart(); } }, '🃏 New session');
    panel.appendChild(h('div.g-flash-actions', null,
      s.again.length ? h('button.btn.btn-primary.btn-lg.g-flash-review', { type: 'button', onclick: () => { Sound.play('click'); startSession('review', { entries: s.again.map((a) => a.entry), dir: s.dir, recall: s.recall, autoSay: s.autoSay }); } }, '🔁 Review again (' + s.again.length + ')') : null,
      els.again,
      h('button.btn.btn-ghost.btn-lg', { type: 'button', onclick: () => view.ctx.navigate('/') }, 'Home')));
    shell.appendChild(panel);
    view.root.appendChild(shell);

    tween(800, (k) => { if (els.big) els.big.textContent = String(Math.round(n * k)); });
    // Focus the main action a beat later so a held Enter from the last rating cannot restart instantly.
    later(() => focusEl(view.root.querySelector('.g-flash-review') || els.again), 600);
  }

  /* ------------------------------------------------------------
     Start screen — deck picker
     ------------------------------------------------------------ */
  function showStart() {
    cancelTransition();
    closeModal(); stopSpeech();
    state = { screen: 'start' };
    els = {};
    const p = prefs();
    const stats = Progress.gameStats(ID);
    const active = Vocab.active();
    const all = Vocab.all();
    const due = Progress.due(active);
    const weak = Progress.weakest(WEAK_COUNT, { includeUnseen: true, pool: active });

    UI.clear(view.root);
    window.scrollTo(0, 0);
    const shell = h('div.game-shell.g-flash.g-flash-start');
    shell.appendChild(topbar(h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← Home')));

    // Hero
    shell.appendChild(h('div.card.card-glass.g-flash-hero', null,
      h('div.g-flash-hero-text', null,
        h('div.eyebrow', null, 'Spaced repetition · flashcards'),
        h('h2', null, 'Flip it. ', h('span.grad-text', null, 'Say it. Rate it.')),
        h('p.text-2', null, 'Build the memory before the spelling drills. Flip each card, hear the word, then rate how well you knew it — honest ratings bring the weak words back sooner.')),
      h('div.g-flash-hero-side', null,
        h('div.g-flash-fan', { 'aria-hidden': 'true' }, h('i', null, 'é'), h('i', null, 'ñ'), h('i', null, 'á')),
        h('div.g-flash-hero-stats', null,
          stat(stats.best, 'Best session'),
          stat(stats.plays, stats.plays === 1 ? 'Session' : 'Sessions'),
          stat(due.length, 'Due now')))));

    // Options: direction + active recall
    els.recallToggle = h('input', { type: 'checkbox', checked: !!p.recall, disabled: p.dir === 'es-en', onchange: (e) => { savePref('recall', !!e.target.checked); Sound.play('click'); } });
    els.seg = h('div.g-flash-seg', { role: 'group', 'aria-label': 'Card direction' });
    [['en-es', 'English → Spanish'], ['es-en', 'Spanish → English']].forEach(([dir, label]) => {
      const b = h('button', { type: 'button', dataset: { dir }, 'aria-pressed': p.dir === dir ? 'true' : 'false' }, label);
      b.addEventListener('click', () => { setDir(dir); Sound.play('click'); });
      els.seg.appendChild(b);
    });
    shell.appendChild(h('div.g-flash-settings', null,
      h('div.g-flash-setting', null, h('span.label', null, 'Direction'), els.seg),
      h('label.toggle.g-flash-recall-toggle', { title: 'Type the spelling before you flip — the card grades it and suggests a rating' },
        els.recallToggle, h('span.track'), h('span', null, '✍️ Active recall — type it before you flip'))));

    // Decks
    const decks = h('div.g-flash-decks', { role: 'group', 'aria-label': 'Decks' });
    const counts = {
      due: due.length ? Math.min(MAX_CARDS, due.length) + (due.length === 1 ? ' card' : ' cards') : 'All caught up ✓',
      weak: weak.length + ' cards',
      all: Math.min(MAX_CARDS, active.length) + ' of ' + active.length,
    };
    ['due', 'weak', 'all', 'category'].forEach((id) => {
      const d = DECKS[id];
      const isCat = id === 'category';
      const empty = id === 'due' && !due.length;
      const card = h((isCat ? 'div' : 'button') + '.g-flash-deck' + (isCat ? '.is-cats' : '') + (empty ? '.is-empty' : ''),
        { type: isCat ? null : 'button', disabled: empty ? true : null, dataset: { deck: id }, 'aria-label': isCat ? d.name : d.name + ', ' + counts[id], title: empty ? 'Nothing is due — come back tomorrow, or pick another deck' : null },
        h('span.g-flash-deck-icon', null, d.icon),
        h('span.g-flash-deck-body', null,
          h('span.g-flash-deck-name', null, d.name, d.key ? h('span.g-flash-key', { 'aria-hidden': 'true' }, d.key) : null),
          h('span.g-flash-deck-desc', null, d.desc),
          isCat ? catChips() : null),
        h('span.g-flash-deck-count', null, isCat ? 'pick one' : counts[id]));
      card.style.setProperty('--accent', d.accent);
      if (!isCat) card.addEventListener('click', () => { Sound.play('click'); startSession(id); });
      decks.appendChild(card);
    });
    shell.appendChild(decks);

    shell.appendChild(h('div.small.muted.g-flash-note', null,
      active.length < all.length ? 'Practising ' + active.length + ' of ' + all.length + ' words (category filter on Home). ' : 'All ' + all.length + ' words in play. ',
      'Decks hold up to ' + MAX_CARDS + ' cards; weak words come up first.'));
    view.root.appendChild(shell);
  }

  function setDir(dir) {
    savePref('dir', dir);
    if (!els.seg) return;
    els.seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.dir === dir ? 'true' : 'false'));
    els.recallToggle.disabled = dir !== 'en-es';
    els.recallToggle.closest('label').title = dir === 'en-es' ? 'Type the spelling before you flip — the card grades it and suggests a rating' : 'Active recall needs English → Spanish';
  }

  function catChips() {
    const wrap = h('span.chip-group.g-flash-cats', { role: 'group', 'aria-label': 'Categories' });
    const active = Vocab.active();
    Vocab.categories().forEach((c) => {
      const n = active.filter((e) => e.cat === c.id).length;   // respects the category filter chosen on Home
      const chip = h('button.chip', { type: 'button', dataset: { cat: c.id }, disabled: n ? null : true, title: n ? c.es : 'Filtered out on Home' }, c.icon + ' ' + catLabel(c.id) + ' · ' + n);
      chip.style.setProperty('--cat', c.color);
      if (n) chip.addEventListener('click', () => { Sound.play('click'); startSession('category', { cat: c.id }); });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  /* ------------------------------------------------------------
     Module registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Memory Deck',
    tagline: 'Flashcards with pronunciation — flip, rate, remember.',
    icon: '🃏',
    accent: 'var(--c-sky)',
    order: 5,
    mount(root, ctx) {
      view = { root, ctx, timeouts: new Set(), rafs: new Set(), docListeners: [], modal: null };
      onDoc('keydown', onDocKey);
      onDoc('visibilitychange', onVisibility);
      showStart();
    },
    unmount() {
      closeModal(); stopSpeech();
      if (view) {
        view.timeouts.forEach(clearTimeout);
        view.rafs.forEach(cancelAnimationFrame);
        view.docListeners.forEach(([type, fn]) => document.removeEventListener(type, fn));
        UI.clear(view.root);
      }
      view = null; state = null; els = {};
    },
  });

  /* ---------- Debug / test hooks ---------- */
  PQ.debug = PQ.debug || {};
  PQ.debug[ID] = {
    DECKS, RATINGS,
    get state() { return state; },
    get els() { return els; },
    get mounted() { return !!view; },
    prefs,
    start(deckId, opts) { return startSession(deckId, opts || {}); },
    flip() { return flip(); },
    /** rate(3) or rate('good') */
    rate(n) { const r = typeof n === 'number' ? RATINGS[n - 1] : ratingById(n); return r ? rate(r.id) : null; },
    /** Type an active-recall attempt and flip (requires the recall input). */
    attempt(text) { if (!els.input || !state.current || state.current.revealed) return null; els.input.value = text; flip(); return state.current.attempt; },
    /** Replace the current (unrated) card with a specific word; a later copy of it in the deck is swapped out. */
    force(id) {
      if (!state || state.screen !== 'session' || state.animating) return null;
      const entry = Vocab.byId(id);
      if (!entry) return null;
      const dup = state.cards.findIndex((e, i) => i > state.index && e.id === id);
      if (dup >= 0) state.cards[dup] = state.cards[state.index];
      state.cards[state.index] = entry;
      showCard(false);
      return state.current;
    },
    setRecall(on) { setRecall(on); return state && state.recall; },
    setDir(dir) { savePref('dir', dir); if (state && state.screen === 'start') setDir(dir); return prefs().dir; },
    end(reason) { if (state && state.screen === 'session') endSession(reason || 'quit'); return state; },
    showStart() { if (view) showStart(); },
    elapsed: elapsedSec,
  };
})();
