/* ============================================================
   PALABRA QUEST — Accent Hunter  (game id: 'accent')
   Fast, arcade-style accent placement. The word appears with its
   accents stripped; tap the letters that need an accent / ñ, or
   call "No accents needed".

   Modes
     blitz   60 seconds, as many words as possible, +2s per correct
     zen     untimed, 15 words
     spot    "Spot the spelling": multiple choice among accent traps,
             12 questions, number keys 1-4 (handled by QuizUI)

   Scoring
     +100 × multiplier per correct answer
     multiplier: ×1 → ×2 at a combo of 3 → ×3 at 6 → ×4 at 10
     any miss (accent slip or wrong pick) resets the combo

   Word pool
     Progress.pick over Vocab.active(). Blitz / Zen draw ~75% words
     that carry an accent and ~25% that do not, so "No accents
     needed" is a real decision. A word never repeats back to back,
     and each group is cycled through before any word comes again.
     With a small focus filter (e.g. only ordinals, where séptimo is
     the single accented word) the share adapts so that no word has
     to come back within fewer than MIN_GAP picks.

   Keyboard (accent questions)
     ← →  move the highlight over the letter tiles
     Space toggles the accent on the highlighted tile
     Enter confirms (QuizUI)      N = "No accents needed"
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, Quiz, QuizUI, UI, Sound, Speech, Rand } = PQ;
  const h = UI.h;

  const ID = 'accent';
  const BLITZ_SECONDS = 60;
  const BLITZ_BONUS = 2;          // seconds added per correct answer in Blitz
  const LOW_TIME = 10;            // seconds left: the timer turns red and ticks
  const ZEN_COUNT = 15;
  const SPOT_COUNT = 12;
  const ACCENT_SHARE = 0.75;      // target share of accent-bearing words in Blitz / Zen
  const MIN_GAP = 4;              // a word should not be expected back within fewer picks than this (shrinks the share for tiny groups)
  const KEY_GRACE_MS = 350;       // answer keys are ignored this long after a question appears (the Enter that started the round must not answer it)
  const BASE_POINTS = 100;
  const COMBO_X2 = 3, COMBO_X3 = 6, COMBO_X4 = 10;
  const MAX_FX = 40;              // cap on live particle elements

  const MODES = {
    blitz: { id: 'blitz', name: 'Blitz 60s',          icon: '⚡', key: '1', accent: 'var(--c-amber)', desc: 'Sixty seconds on the clock. Every correct answer adds +2s.' },
    zen:   { id: 'zen',   name: 'Zen',                icon: '🧘', key: '2', accent: 'var(--c-mint)',  desc: 'No timer. Fifteen words.' },
    spot:  { id: 'spot',  name: 'Spot the spelling',  icon: '🔍', key: '3', accent: 'var(--c-lav)',   desc: 'Pick the right spelling out of four. Twelve words.' },
  };
  const QUESTION_LABEL = { blitz: 'Words', zen: 'Word', spot: 'Question' };

  /* ------------------------------------------------------------
     Module state
     `view`  everything tied to the mounted DOM (root, timers, listeners)
     `state` the current screen / round
     `ctl`   the live QuizUI controller (one question at a time)
     `els`   named DOM nodes of the current screen
     ------------------------------------------------------------ */
  let view = null;
  let state = null;
  let ctl = null;
  let els = {};

  /* ---------- tiny helpers ---------- */
  function multFor(combo) { return combo >= COMBO_X4 ? 4 : combo >= COMBO_X3 ? 3 : combo >= COMBO_X2 ? 2 : 1; }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function modeBests() { return Progress.gameStats(ID).bests || {}; }
  function stat(val, label) { return h('div.stat', null, h('div.stat-val', null, val), h('div.stat-label', null, label)); }
  function kbd(txt) { return h('span.kbd', null, txt); }
  function isTyping(el) { return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); }
  function hasTouch() { return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window; }
  /** Bring a new screen into view (the learner may have tapped near the bottom of the previous one). */
  function scrollTop() { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); } }
  /** The screen container: .game-shell with the game prefix, the mode colour and a touch flag for the hint row. */
  function shellEl(mode) {
    const el = h('div.game-shell.g-accent' + (hasTouch() ? '.is-touch' : ''));
    if (mode) el.style.setProperty('--accent', mode.accent);
    return el;
  }

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
  /** Restart a CSS animation class on an element. */
  function replayClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function destroyCtl() { if (ctl) { try { ctl.destroy(); } catch (e) { /* already gone */ } ctl = null; } if (view) { view.tiles = []; } }
  function closeModal() { if (view && view.modal) { const m = view.modal; view.modal = null; m.close(); } }
  function stopLoop() { if (view && view.rafId) { cancelAnimationFrame(view.rafId); view.rafId = 0; } }
  function startLoop() { stopLoop(); view.last = performance.now(); view.rafId = requestAnimationFrame(loop); }

  /** Seconds elapsed in the round, excluding time spent in a hidden tab. */
  function elapsedSec() {
    if (!state || !state.t0) return 0;
    const now = state.pausedAt == null ? performance.now() : state.pausedAt;
    return Math.max(0, (now - state.t0 - state.pausedMs) / 1000);
  }

  /* ------------------------------------------------------------
     Sound: a combo chime whose pitch climbs with the streak.
     Sound.play() only knows named effects, so the pitched chime
     uses the synth's tone primitive when it is available.
     ------------------------------------------------------------ */
  function comboChime(combo) {
    if (!Sound.enabled() || typeof Sound._tone !== 'function') return;
    const step = Math.min(combo, 12);                 // one semitone per combo step, capped an octave up
    const f = 660 * Math.pow(2, step / 12);
    try {
      Sound._tone(f, 0.09, 'triangle', 0.07, 0.28);
      Sound._tone(f * 1.5, 0.16, 'triangle', 0.06, 0.36);
    } catch (e) { /* audio not available */ }
  }

  /* ------------------------------------------------------------
     Word selection
     ------------------------------------------------------------ */
  /**
   * Share of accent-bearing words for a pool with nA accented / nP plain entries.
   * ACCENT_SHARE when both groups are big enough; otherwise squeezed so that a group drawn with
   * probability p and cycled before repeating brings each of its n words back only every n/p picks,
   * never more often than every MIN_GAP picks. When both constraints collide (two tiny groups)
   * the natural proportion is used. Examples: all 44 words → 0.75, ordinals (1 / 7) → 0.25,
   * useful words (2 / 2) → 0.5, question words (8 / 0) → 1.
   */
  function accentShare(nA, nP) {
    if (!nA) return 0;
    if (!nP) return 1;
    const lo = Math.max(0, 1 - nP / MIN_GAP), hi = Math.min(1, nA / MIN_GAP);
    if (lo > hi) return nA / (nA + nP);
    return Math.min(hi, Math.max(lo, ACCENT_SHARE));
  }

  /** Entries of `group` not yet seen this cycle; when the cycle is complete, start a new one. */
  function cycleCandidates(r, group) {
    let list = group.filter((e) => !r.used.has(e.id));
    if (!list.length && group.length) { group.forEach((e) => r.used.delete(e.id)); list = group; }
    return list;
  }

  function pickEntry() {
    const r = state.round;
    let group;
    if (state.mode === 'spot') group = r.pool;
    else group = Rand.chance(r.share) ? r.accented : r.plain;
    const inGroup = cycleCandidates(r, group);
    // Never the same word twice in a row. When this group has nothing else to offer (a single-word
    // group such as "séptimo" among the ordinals) draw from the other group instead of repeating.
    let fresh = inGroup.filter((e) => e.id !== r.lastId);
    if (!fresh.length && state.mode !== 'spot') {
      const other = group === r.accented ? r.plain : r.accented;
      fresh = cycleCandidates(r, other).filter((e) => e.id !== r.lastId);
    }
    const entry = Progress.pickOne({ pool: fresh.length ? fresh : inGroup });   // weighted: weak words come first within a cycle
    r.used.add(entry.id);
    r.lastId = entry.id;
    return entry;
  }

  /* ------------------------------------------------------------
     Round flow
     ------------------------------------------------------------ */
  function startRound(modeId) {
    const mode = MODES[modeId] || MODES.blitz;
    destroyCtl(); stopLoop(); closeModal();
    const pool = Vocab.active();
    const accented = pool.filter((e) => Text.hasAccent(e.base));
    const plain = pool.filter((e) => !Text.hasAccent(e.base));
    state = {
      screen: 'round', mode: mode.id,
      round: {
        pool, accented, plain,
        share: accentShare(accented.length, plain.length),
        used: new Set(), lastId: null,
        total: mode.id === 'zen' ? ZEN_COUNT : mode.id === 'spot' ? SPOT_COUNT : Infinity,
      },
      index: 0, answered: 0, correct: 0, accentSlips: 0, wrong: 0,
      score: 0, combo: 0, maxCombo: 0, mult: 1,
      timeLeft: mode.id === 'blitz' ? BLITZ_SECONDS : 0, timeBonus: 0, lowTime: false, lastSec: -1,
      paused: false, t0: performance.now(), pausedAt: null, pausedMs: 0, askedAt: 0,
      answers: [], missed: [],
    };
    renderRound();
    if (mode.id === 'blitz') { startLoop(); paintTimer(); }
    nextQuestion();
    floatText(mode.id === 'zen' ? 'Take your time' : 'Go', 'is-go');
  }

  function nextQuestion() {
    if (!state || state.screen !== 'round') return;
    state.index = state.answered + 1;
    askEntry(pickEntry());
  }

  /** Show a question for `entry` in the current mode (replaces any live widget). */
  function askEntry(entry) {
    const q = state.mode === 'spot' ? Quiz.choice(entry) : Quiz.accent(entry);
    ctl = QuizUI.ask(q, { mount: els.mount, autoContinue: true, allowHint: false, onAnswer, onResult });
    state.askedAt = performance.now();   // answer keys within KEY_GRACE_MS of this are swallowed (see onDocKey)
    view.tiles = Array.prototype.slice.call(ctl.el.querySelectorAll('button.quiz-letter'));
    view.cursor = 0;
    paintCursor();
    // A mouse / touch tap on a tile also moves the keyboard highlight there, and shows the learner is
    // answering on purpose: the key grace ends so an Enter right after the tap confirms as expected.
    ctl.el.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('button.quiz-letter') : null;
      const i = t ? view.tiles.indexOf(t) : -1;
      if (i >= 0) { view.cursor = i; paintCursor(); if (state) state.askedAt = 0; }
    });
    updateHud();
  }

  function onAnswer(r) {
    if (!state || state.screen !== 'round') return;
    const q = r.question;
    const entry = q.entry;
    state.answered++;
    let points = 0;
    if (r.status === 'correct') {
      state.correct++;
      state.combo++;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      Progress.noteStreak(state.combo);
      const mult = multFor(state.combo);
      points = BASE_POINTS * mult;
      state.score += points;
      if (mult !== state.mult) { state.mult = mult; later(() => hudFloat('Combo ×' + mult + '!', 'is-combo', els.comboWrap), 150); }   // beside the badge, never over the feedback card
      if (state.mode === 'blitz') {
        state.timeLeft += BLITZ_BONUS;
        state.timeBonus += BLITZ_BONUS;
        paintTimer();
        hudFloat('+' + BLITZ_BONUS + 's', 'is-time', els.timeWrap);   // inside the HUD: the stage layer would clip it
        replayClass(els.time, 'is-bonus');
      }
      comboChime(state.combo);
      floatText('+' + fmt(points), 'is-ok');
      burst(6 + mult * 2);
      replayClass(els.scoreWrap, 'is-bump');
      replayClass(els.combo, 'is-pop');
    } else {
      if (r.status === 'accent') state.accentSlips++; else state.wrong++;
      state.combo = 0;
      state.mult = 1;
      replayClass(els.stage, 'is-shake');
      floatText(r.status === 'accent' ? 'accent' : 'miss', 'is-bad');
      state.missed.push({ id: entry.id, entry, status: r.status, expected: r.expected || q.canonical, input: describeInput(q, r.input) });
    }
    state.answers.push({ id: entry.id, entry, kind: q.kind, status: r.status, points, input: r.input, expected: r.expected || q.canonical });
    updateHud();
  }

  /** Human-readable form of what the learner answered (for the end-screen list). */
  function describeInput(q, input) {
    if (q.kind === 'accent' && Array.isArray(input)) return q.letters.map((ch, i) => (input.includes(i) ? Text.toggleAccent(ch) : ch)).join('');
    return typeof input === 'string' ? input : '';
  }

  function onResult() {
    if (!state || state.screen !== 'round') return;
    if (state.answered >= state.round.total) endRound('done');
    else nextQuestion();
  }

  function endRound(reason) {
    if (!state || state.screen !== 'round') return;
    stopLoop(); destroyCtl(); closeModal();
    const s = state;
    s.elapsed = elapsedSec();
    if (!s.answered) {
      // Nothing to score (the clock ran out on the first word, or the learner left): no play is
      // counted and there is no "Flawless" end screen for an empty round.
      if (reason === 'time') { UI.toast('Time’s up — nothing answered this round', 'warn'); Sound.play('lose'); }
      showStart();
      return;
    }
    s.screen = 'end';
    s.reason = reason;
    s.accuracy = s.answered ? s.correct / s.answered : 0;
    const bests = Object.assign({}, modeBests());
    const prev = bests[s.mode] || 0;
    s.newBest = s.score > prev;
    bests[s.mode] = Math.max(prev, s.score);
    Progress.setBest(ID, s.score, { mode: s.mode, bests });
    renderEnd();
    Sound.play(s.newBest ? 'win' : 'gate');
    if (s.newBest) UI.confetti({ count: 170 });
  }

  /* ------------------------------------------------------------
     Blitz timer (RAF loop, dt clamped, paused while hidden / modal)
     ------------------------------------------------------------ */
  function loop(t) {
    if (!view || !state || state.screen !== 'round') { if (view) view.rafId = 0; return; }
    view.rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (t - view.last) / 1000));
    view.last = t;
    if (state.paused || view.modal) return;
    state.timeLeft = Math.max(0, state.timeLeft - dt);
    paintTimer();
    if (state.timeLeft <= 0) endRound('time');
  }

  function paintTimer() {
    if (!els.timerFill || state.mode !== 'blitz') return;
    const frac = Math.max(0, Math.min(1, state.timeLeft / BLITZ_SECONDS));
    els.timerFill.style.transform = 'scaleX(' + frac.toFixed(4) + ')';
    els.timer.setAttribute('aria-valuenow', String(Math.round(state.timeLeft)));
    const low = state.timeLeft <= LOW_TIME;
    if (low !== state.lowTime) {
      state.lowTime = low;
      els.timer.classList.toggle('is-low', low);
      els.time.classList.toggle('is-low', low);
    }
    const sec = Math.ceil(state.timeLeft);
    if (sec !== state.lastSec) {
      const falling = sec < state.lastSec;
      state.lastSec = sec;
      els.time.textContent = sec + 's';
      if (low && falling && sec > 0) { Sound.play('tick'); replayClass(els.time, 'is-tick'); }
    }
  }

  function onVisibility() {
    if (!state || state.screen !== 'round') return;
    if (document.hidden) {
      if (state.pausedAt == null) { state.pausedAt = performance.now(); state.paused = true; }
    } else if (state.pausedAt != null) {
      state.pausedMs += performance.now() - state.pausedAt;
      state.pausedAt = null;
      state.paused = false;
      if (view) view.last = performance.now();
    }
  }

  /* ------------------------------------------------------------
     Keyboard
     Registered on mount (before any QuizUI / modal listener), so it
     can stop Enter from reaching the question while the quit dialog
     is open.
     ------------------------------------------------------------ */
  function onDocKey(e) {
    if (!state || !view || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (view.modal) {
      if (e.key !== 'Enter') return;                       // Esc is handled by the modal itself
      e.stopImmediatePropagation();                        // never confirm the question behind the dialog
      const ae = document.activeElement;
      if (ae && ae.tagName === 'BUTTON' && view.modal.el.contains(ae)) return;   // let that button activate
      e.preventDefault();
      closeModal();                                        // Enter = "keep playing"
      return;
    }
    if (state.screen === 'start') {
      const mode = Object.keys(MODES).find((k) => MODES[k].key === e.key);
      if (mode) { e.preventDefault(); Sound.play('click'); startRound(mode); }
      return;
    }
    if (state.screen !== 'round') return;
    if (e.key === 'Escape') { e.preventDefault(); confirmQuit(); return; }
    if (isAnswerKey(e.key) && (e.repeat || performance.now() - state.askedAt < KEY_GRACE_MS)) {
      // A held key, or the Enter / digit that started the round (or was mashed during feedback)
      // arriving on a question that only just appeared: it must not answer it. This listener was
      // registered before QuizUI's, so stopping propagation here keeps the keystroke from it.
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (state.mode !== 'spot') onTileKey(e);
  }
  /** Keys that answer a question outright (Enter / N on accent questions, 1–4 on multiple choice). */
  function isAnswerKey(key) { return key === 'Enter' || key === 'n' || key === 'N' || (key.length === 1 && key >= '1' && key <= '4'); }

  /** ← → move the highlight, Space toggles the highlighted tile, N = "No accents needed". */
  function onTileKey(e) {
    if (!ctl || ctl.answered || !view.tiles.length) return;
    const ae = document.activeElement;
    const focusedTile = ae ? view.tiles.indexOf(ae) : -1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (focusedTile >= 0) { view.cursor = focusedTile; ae.blur(); }
      moveCursor(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === ' ' || e.key === 'Spacebar') {
      if (ae && ae.tagName === 'BUTTON' && focusedTile < 0) return;   // Confirm / No accents / other buttons keep native Space
      e.preventDefault();                                             // also stops the page from scrolling
      if (e.repeat) return;                                           // a held Space toggles once, not on every auto-repeat
      if (focusedTile >= 0) view.cursor = focusedTile;
      view.kbd = true;
      paintCursor();
      view.tiles[view.cursor].click();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const b = noAccentButton();
      if (b) b.click();
    }
  }
  /** A focused tile would also receive a native click on Space keyup (Firefox); we already toggled it on keydown. */
  function onDocKeyUp(e) {
    if ((e.key === ' ' || e.key === 'Spacebar') && view && view.tiles && view.tiles.indexOf(e.target) >= 0) e.preventDefault();
  }
  function noAccentButton() {
    if (!ctl) return null;
    return Array.prototype.slice.call(ctl.el.querySelectorAll('.quiz-actions button')).find((b) => /no accents/i.test(b.textContent)) || null;
  }
  function moveCursor(dir) {
    const n = view.tiles.length;
    view.cursor = ((view.cursor + dir) % n + n) % n;
    view.kbd = true;
    paintCursor();
    Sound.play('tick');
  }
  function paintCursor() {
    if (!view) return;
    view.tiles.forEach((t, k) => t.classList.toggle('g-accent-cursor', !!view.kbd && k === view.cursor));
  }

  /* ------------------------------------------------------------
     Quit dialog
     ------------------------------------------------------------ */
  function confirmQuit() {
    if (!view || view.modal || !state || state.screen !== 'round') return;
    const content = h('div.stack', null,
      h('p.text-2', null, state.answered ? 'Finish now and see your score, or keep hunting?' : 'Nothing answered yet — head back to the modes?'),
      h('div.row', null,
        h('button.btn.btn-primary', { type: 'button', onclick: () => { closeModal(); endRound('quit'); } }, state.answered ? 'Finish now' : 'Back to modes'),
        h('button.btn.btn-outline', { type: 'button', onclick: closeModal }, 'Keep playing')));
    view.modal = UI.modal({ title: 'Leave this round?', content, closable: true, onClose: () => { if (view) { view.modal = null; view.last = performance.now(); } } });
  }

  /* ------------------------------------------------------------
     Particles: floating "+N" texts and sparkle bursts over the stage
     ------------------------------------------------------------ */
  /** The word being quizzed (the big stripped word, or the English prompt in Spot mode). */
  function wordEl() {
    const prompt = els.mount && els.mount.querySelector('.quiz-prompt');
    if (!prompt) return els.stage;
    const word = prompt.querySelector(':scope > span:first-child:not(.sub)');
    return word || prompt;
  }
  /**
   * Layout box of an element relative to the stage, ignoring CSS transforms — the word is still
   * scaling in (g-accent-wordpop) and the stage may be shaking when a float is created, and
   * getBoundingClientRect() would report that transient geometry.
   */
  function layoutBox(el) {
    let top = 0, left = 0, node = el;
    while (node && node !== els.stage) { top += node.offsetTop; left += node.offsetLeft; node = node.offsetParent; }
    return { top, left, width: el.offsetWidth, height: el.offsetHeight };
  }
  /** Centre of the word, in stage coordinates (sparks burst from here). */
  function wordCentre() {
    const b = layoutBox(wordEl());
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }
  /**
   * Anchor for floating texts: centred just ABOVE the word, so a "+300" or "accent!" never sits on
   * the word or on its English meaning (the two things the learner is reading during feedback).
   * Floats are positioned by their bottom edge (translateY(-100%)) and rise from here.
   */
  function floatPoint() {
    const b = layoutBox(wordEl());
    return { x: b.left + b.width / 2, y: Math.max(28, b.top - 6) };
  }
  function trimFx() { while (els.fx.children.length > MAX_FX) els.fx.removeChild(els.fx.firstChild); }
  function floatText(text, cls) {
    if (!els.fx || !els.stage) return;
    els.fx.querySelectorAll('.g-accent-float').forEach((old) => old.remove());   // one text float at a time: a new answer retires "¡Vamos!" or the previous reward
    const p = floatPoint();
    const el = h('div.g-accent-float' + (cls ? '.' + cls : ''), { style: { left: p.x + 'px', top: p.y + 'px' } }, text);
    els.fx.appendChild(el);
    trimFx();
    later(() => el.remove(), 1400);
  }
  /** A small float that rises out of a HUD item (time bonus, combo step) — the stage layer would clip it. */
  function hudFloat(text, cls, host) {
    if (!host || !host.isConnected) return;
    host.querySelectorAll('.g-accent-hudfloat').forEach((old) => old.remove());
    const el = h('div.g-accent-hudfloat' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' }, text);
    host.appendChild(el);
    later(() => el.remove(), 1300);
  }
  function burst(n) {
    if (!els.fx || !els.stage) return;
    const p = wordCentre();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
      const dot = h('i.g-accent-spark', { style: { left: p.x + 'px', top: p.y + 'px' } });
      dot.style.setProperty('--dx', Math.cos(a) * d + 'px');
      dot.style.setProperty('--dy', Math.sin(a) * d - 30 + 'px');
      dot.style.setProperty('--hue', String(Math.round(Math.random() * 60 + 20)));
      els.fx.appendChild(dot);
    }
    trimFx();
    later(() => { if (els.fx) els.fx.querySelectorAll('.g-accent-spark').forEach((d) => d.remove()); }, 900);
  }

  /* ------------------------------------------------------------
     Screens
     ------------------------------------------------------------ */
  function topbar(mode, right) {
    return h('div.game-topbar', null,
      h('div.game-title', null,
        h('span.icon', null, '🎯'),
        h('span.g-accent-title-text', null, 'Accent Hunter'),
        mode ? h('span.g-accent-modechip', null, mode.icon + ' ' + mode.name) : null),
      right || null);
  }

  function showStart() {
    destroyCtl(); stopLoop(); closeModal();
    state = { screen: 'start' };
    UI.clear(view.root); els = {};
    const gs = Progress.gameStats(ID);
    const bests = modeBests();
    const active = Vocab.active();
    const nAccent = Vocab.withAccents(active).length;

    const shell = shellEl();
    shell.appendChild(topbar(null, h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← All games')));

    shell.appendChild(h('div.card.card-glass.g-accent-hero', null,
      h('div.g-accent-hero-text', null,
        h('div.eyebrow', null, 'Accent Hunter'),
        h('h2', null, 'Where does the ', h('span.grad-text', null, 'accent'), ' go?'),
        h('p.text-2', null, 'Each word appears without its accents. Tap the letters that need one (or ñ), or say no accents are needed. Correct answers in a row raise your multiplier.')),
      h('div.g-accent-hero-stats', null,
        stat(fmt(gs.best), 'Best score'),
        stat(String(gs.plays || 0), gs.plays === 1 ? 'Round played' : 'Rounds played'),
        stat(nAccent + ' / ' + active.length, 'Words with accents'))));

    const modes = h('div.g-accent-modes', { role: 'group', 'aria-label': 'Game modes' });
    Object.keys(MODES).forEach((k) => {
      const m = MODES[k];
      const best = bests[m.id] || 0;
      const card = h('button.g-accent-mode', { type: 'button', dataset: { mode: m.id }, onclick: () => { Sound.play('click'); startRound(m.id); } },
        h('div.g-accent-mode-icon', null, m.icon),
        h('div.g-accent-mode-body', null,
          h('div.g-accent-mode-name', null, m.name, h('span.g-accent-key', null, m.key)),
          h('div.g-accent-mode-desc', null, m.desc)),
        h('div.g-accent-mode-best', null, best ? ['Best ', h('b', null, fmt(best))] : 'Unplayed'));
      card.style.setProperty('--accent', m.accent);
      modes.appendChild(card);
    });
    shell.appendChild(modes);

    shell.appendChild(h('div.g-accent-keys.small.muted', null,
      h('span', null, kbd('1'), ' ', kbd('2'), ' ', kbd('3'), ' pick a mode'),
      h('span', null, kbd('←'), ' ', kbd('→'), ' move · ', kbd('Space'), ' toggle · ', kbd('Enter'), ' confirm · ', kbd('N'), ' no accents'),
      h('span.g-accent-touchhint', null, 'Tap a mode to start')));
    view.root.appendChild(shell);
    scrollTop();
  }

  function renderRound() {
    UI.clear(view.root); els = {};
    const mode = MODES[state.mode];
    const blitz = state.mode === 'blitz';
    const shell = shellEl(mode);
    shell.appendChild(topbar(mode, h('button.btn.btn-ghost.btn-sm.g-accent-quit', { type: 'button', title: 'End the round (Esc)', onclick: confirmQuit }, '✕ End round')));

    // HUD
    els.score = h('span.val', null, '0');
    els.scoreWrap = h('div.hud-item.g-accent-scorewrap', null, h('span.label', null, 'Score'), els.score);
    els.combo = h('span.g-accent-combo', { 'aria-live': 'polite' }, h('b', null, '×1'), h('span.g-accent-combo-n', null, '0'));
    els.acc = h('span.val', null, '—');
    els.prog = h('span.val', null, '');
    els.time = h('span.val.g-accent-time', null, blitz ? BLITZ_SECONDS + 's' : '');
    els.comboWrap = h('div.hud-item.g-accent-combowrap', null, h('span.label', null, 'Combo'), els.combo);
    els.timeWrap = blitz ? h('div.hud-item.g-accent-timewrap', null, h('span.label', null, 'Time'), els.time) : null;
    const hud = h('div.hud.g-accent-hud', null,
      els.scoreWrap,
      els.comboWrap,
      h('div.hud-item.g-accent-accwrap', null, h('span.label', null, 'Accuracy'), els.acc),
      h('div.hud-spacer'),
      h('div.hud-item.g-accent-progwrap', null, h('span.label', null, QUESTION_LABEL[state.mode]), els.prog),
      els.timeWrap);
    shell.appendChild(hud);

    // Timer bar (blitz) or progress bar (zen / spot)
    if (blitz) {
      els.timerFill = h('div.g-accent-timer-fill');
      els.timer = h('div.g-accent-timer', { role: 'progressbar', 'aria-label': 'Time left', 'aria-valuemin': '0', 'aria-valuemax': String(BLITZ_SECONDS), 'aria-valuenow': String(BLITZ_SECONDS) }, els.timerFill);
      shell.appendChild(els.timer);
    } else {
      els.progFill = h('div.bar-fill', { style: { width: '0%' } });
      shell.appendChild(h('div.bar.bar-lav.g-accent-progress', { role: 'progressbar', 'aria-label': 'Round progress' }, els.progFill));
    }

    // Stage: the QuizUI widget mounts inside; particles float above it
    els.mount = h('div.g-accent-mount');
    els.fx = h('div.g-accent-fx', { 'aria-hidden': 'true' });
    els.stage = h('div.card.card-glass.g-accent-stage', null, els.mount, els.fx);
    shell.appendChild(els.stage);

    shell.appendChild(h('div.g-accent-keys.small.muted', null,
      state.mode === 'spot'
        ? h('span', null, kbd('1'), '–', kbd('4'), ' pick an answer · ', kbd('Esc'), ' end round')
        : h('span', null, kbd('←'), ' ', kbd('→'), ' move · ', kbd('Space'), ' toggle · ', kbd('Enter'), ' confirm · ', kbd('N'), ' no accents · ', kbd('Esc'), ' end'),
      h('span.g-accent-touchhint', null, state.mode === 'spot' ? 'Tap the correct spelling' : 'Tap the letters, then Confirm')));
    view.root.appendChild(shell);
    scrollTop();
  }

  function updateHud() {
    if (!state || state.screen !== 'round' || !els.score) return;
    els.score.textContent = fmt(state.score);
    els.combo.firstChild.textContent = '×' + state.mult;
    els.combo.lastChild.textContent = String(state.combo);
    els.combo.classList.toggle('is-on', state.mult > 1);
    [2, 3, 4].forEach((m) => els.combo.classList.toggle('is-x' + m, state.mult === m));
    els.acc.textContent = state.answered ? Math.round(state.correct / state.answered * 100) + '%' : '—';
    const total = state.round.total;
    els.prog.textContent = total === Infinity ? String(state.answered) : state.index + ' / ' + total;
    if (els.progFill && total !== Infinity) els.progFill.style.width = Math.round(state.answered / total * 100) + '%';
  }

  function renderEnd() {
    const s = state;
    const mode = MODES[s.mode];
    UI.clear(view.root); els = {};
    const shell = shellEl(mode);
    shell.appendChild(topbar(mode, h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← All games')));

    const title = s.reason === 'time' ? 'Time is up' : s.reason === 'quit' ? 'Round ended' : 'Round complete';
    const pct = Math.round(s.accuracy * 100) + '%';
    const panel = h('div.card.card-glass.g-accent-end', null,
      h('div.eyebrow', null, mode.icon + ' ' + mode.name),
      h('h2', null, title),
      h('div.g-accent-final', null, els.score = h('div.g-accent-final-score', null, '0'), h('div.g-accent-final-label', null, 'points')),
      s.newBest
        ? h('div.g-accent-newbest.anim-pop', null, 'New best for ' + mode.name)
        : h('div.small.muted.g-accent-prevbest', null, 'Best in this mode: ' + fmt(modeBests()[s.mode] || 0)),
      h('div.stat-grid', null,
        stat(fmt(Progress.best(ID)), 'Best overall'),
        stat(pct, 'Accuracy'),
        stat('×' + multFor(s.maxCombo) + ' · ' + s.maxCombo, 'Max combo'),
        stat(String(s.answered), 'Answered'),
        s.mode === 'blitz' ? stat('+' + s.timeBonus + 's', 'Time earned') : stat(UI.fmtTime(s.elapsed), 'Time')));

    if (s.missed.length) {
      panel.appendChild(h('div.g-accent-missed-head', null, h('h3', null, 'Words to revisit'), h('span.small.muted', null, 'accents highlighted')));
      const list = h('div.g-accent-missed');
      const canSay = Speech.enabled();   // same gate as QuizUI's "Hear it": no dead 🔊 when speech is switched off
      s.missed.forEach((a) => {
        list.appendChild(h('div.g-accent-miss', { dataset: { status: a.status, id: a.id } },
          h('div.g-accent-miss-main', null,
            h('div.g-accent-miss-es', { html: Text.highlightAccents(a.expected) }),
            h('div.g-accent-miss-en.small.text-2', null, a.entry.en + (a.entry.note ? ' · ' + a.entry.note : ''))),
          h('div.g-accent-miss-side', null,
            a.input && Text.normalize(a.input) !== Text.normalize(a.expected) ? h('span.g-accent-miss-typed.small.muted', null, 'you had ', h('s', null, a.input)) : null,
            h('span.g-accent-miss-tag', null, a.status === 'accent' ? 'accent slip' : 'wrong')),
          canSay ? h('button.btn.btn-ghost.btn-icon.g-accent-say', { type: 'button', title: 'Hear it', 'aria-label': 'Hear ' + a.entry.base, onclick: () => { Speech.say(a.entry.base); } }, '🔊') : null));
      });
      panel.appendChild(list);
    } else {
      panel.appendChild(h('p.g-accent-clean', null, '✨ Flawless — every accent landed where it belongs.'));
    }

    els.again = h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); startRound(s.mode); } }, '▶ Play again');
    panel.appendChild(h('div.g-accent-actions', null,
      els.again,
      h('button.btn.btn-outline.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); showStart(); } }, 'Change mode'),
      h('button.btn.btn-ghost.btn-lg', { type: 'button', onclick: () => view.ctx.navigate('/') }, 'Home')));
    shell.appendChild(panel);
    view.root.appendChild(shell);
    scrollTop();

    tween(900, (k) => { if (els.score) els.score.textContent = fmt(Math.round(s.score * k)); });
    // Focus "Play again" a beat later so a held Enter from the last question cannot restart instantly.
    later(() => { try { els.again.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 600);
  }

  /* ------------------------------------------------------------
     Module registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Accent Hunter',
    tagline: 'Tap where the accents go.',
    icon: '🎯',
    accent: 'var(--c-lav)',
    order: 3,
    mount(root, ctx) {
      view = { root, ctx, timeouts: new Set(), rafs: new Set(), docListeners: [], modal: null, rafId: 0, last: 0, tiles: [], cursor: 0, kbd: false };
      onDoc('keydown', onDocKey);
      onDoc('keyup', onDocKeyUp);
      onDoc('visibilitychange', onVisibility);
      showStart();
    },
    unmount() {
      destroyCtl(); stopLoop(); closeModal();
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
    MODES,
    get state() { return state; },
    get ctl() { return ctl; },
    get els() { return els; },
    get mounted() { return !!view; },
    get cursor() { return view ? view.cursor : -1; },
    get tiles() { return view ? view.tiles.length : 0; },
    /** Start a round programmatically (answerable at once: no gesture started it, so no key grace). */
    start(mode) { if (view) { startRound(mode); state.askedAt = 0; } return state; },
    endRound(reason) { endRound(reason || 'quit'); return state; },
    showStart() { if (view) showStart(); },
    /** Replace the current (unanswered) question with a specific word (answerable at once: no key grace). */
    force(id) {
      if (!state || state.screen !== 'round') return null;
      const entry = Vocab.byId(id);
      if (!entry) return null;
      state.round.used.add(entry.id);
      state.round.lastId = entry.id;
      askEntry(entry);
      state.askedAt = 0;
      return ctl;
    },
    accentShare,
    KEY_GRACE_MS,
    setTime(sec) { if (state && state.screen === 'round' && state.mode === 'blitz') { state.timeLeft = Math.max(0, Number(sec) || 0); paintTimer(); } },
    setCombo(n) { if (state && state.screen === 'round') { state.combo = Math.max(0, n | 0); state.maxCombo = Math.max(state.maxCombo, state.combo); state.mult = multFor(state.combo); updateHud(); } },
    pick: () => (state && state.screen === 'round' ? pickEntry() : null),
    multFor,
    elapsed: elapsedSec,
  };
})();
