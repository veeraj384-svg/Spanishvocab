/* ============================================================
   SPANISH VOCAB — Spell Forge  (game id: 'spell')
   The core typing drill: see the English, type the Spanish with
   every accent in place.

   Modes
     quick     10 questions, weighted toward weak words
     weak      the 10 weakest words, weakest first
     category  every word of one category
     marathon  endless until 3 misses (accent slips count)
     retry     the words missed in the previous round (end screen); always typed

   Scoring
     correct  (100 + speed bonus ≤ 50) × streak multiplier
              multiplier: ×1 → ×2 at a streak of 3 → ×3 at 6
     accent   20 consolation points (letters right, accents wrong)
     wrong    0 · a hint halves the question's points
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, Quiz, QuizUI, UI, Sound, Speech, Store } = PQ;
  const h = UI.h;

  const ID = 'spell';
  const PREF_KEY = 'pq.spell.v1';   // remembered start-screen options (mix toggle)
  const BASE_POINTS = 100;
  const SPEED_BONUS = 50;           // extra points for an instant answer, fading to 0 over SPEED_WINDOW
  const SPEED_WINDOW = 10;          // seconds
  const ACCENT_POINTS = 20;
  const MARATHON_LIVES = 3;
  const STREAK_X2 = 3;
  const STREAK_X3 = 6;
  const QUICK_COUNT = 10;
  const WEAK_COUNT = 10;
  // Mixed rounds: typed stays the backbone, choice/accent are sprinkled in.
  const MIX_KINDS = ['typed', 'typed', 'choice', 'accent'];

  const MODES = {
    quick:    { id: 'quick',    name: 'Quick 10',     icon: '⚡', accent: 'var(--c-mint)',  key: '1', desc: 'Ten words, weighted toward the ones you keep missing.' },
    weak:     { id: 'weak',     name: 'Weak words',   icon: '🎯', accent: 'var(--c-lav)',   key: '2', desc: 'Your ten weakest words.' },
    marathon: { id: 'marathon', name: 'Marathon',     icon: '♾️', accent: 'var(--c-rose)',  key: '3', desc: 'Keep going until you miss three. Accent slips count.' },
    category: { id: 'category', name: 'By category',  icon: '🗂️', accent: 'var(--c-amber)', key: '4', desc: 'One whole group from the sheet, every word once.' },
    retry:    { id: 'retry',    name: 'Retry missed', icon: '🔁', accent: 'var(--c-sky)',   key: '',  desc: 'Only the words you just missed, typed out in full.' },
  };
  // Short category labels for chips (the sheet titles are long sentences).
  const CAT_SHORT = { school: 'School day', question: 'Question words', adjective: 'Adjectives', ordinal: 'Ordinals', useful: 'Useful words' };

  /* ------------------------------------------------------------
     Module state
     `view`  everything tied to the mounted DOM (root, timers, listeners)
     `state` the current screen / round
     `ctl`   the live QuizUI controller (one question at a time)
     ------------------------------------------------------------ */
  let view = null;
  let state = null;
  let ctl = null;
  let els = {};

  /* ---------- tiny helpers ---------- */
  function prefs() { return Object.assign({ mix: false }, Store.get(PREF_KEY, {})); }
  function savePref(key, value) { const p = prefs(); p[key] = value; Store.set(PREF_KEY, p); }
  function multFor(streak) { return streak >= STREAK_X3 ? 3 : streak >= STREAK_X2 ? 2 : 1; }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function modeBests() { return Progress.gameStats(ID).bests || {}; }
  function catLabel(id) { const c = Vocab.category(id); return CAT_SHORT[id] || (c ? c.en : id); }
  function stat(val, label) { return h('div.stat', null, h('div.stat-val', null, val), h('div.stat-label', null, label)); }
  function uniqById(entries) { const seen = new Set(); return entries.filter((e) => !seen.has(e.id) && seen.add(e.id)); }
  const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function numWord(n) { return NUM_WORDS[n] || String(n); }
  /** Length of a Quick / Weak round under the learner's category filter (the copy must never promise more words than are in play). */
  function roundSize(modeId) { return Math.min(modeId === 'weak' ? WEAK_COUNT : QUICK_COUNT, Vocab.active().length); }
  /** Display name of a mode: "Quick 10" reads "Quick 4" when the filter leaves only four words. `n` = the round length when known. */
  function modeName(modeId, n) {
    if (modeId === 'quick') return 'Quick ' + (n == null || n === Infinity ? roundSize('quick') : n);
    return MODES[modeId] ? MODES[modeId].name : modeId;
  }
  function modeDesc(modeId) {
    const n = roundSize(modeId);
    if (modeId === 'quick') return Text.cap(numWord(n)) + (n === 1 ? ' word' : ' words') + ', weighted toward the ones you keep missing.';
    if (modeId === 'weak') return 'Your ' + numWord(n) + (n === 1 ? ' weakest word.' : ' weakest words.');
    return MODES[modeId].desc;
  }
  /** Label of a round for the mode chip / end screen: the category name, "Quick 4" under a filter, else the mode name. */
  function roundLabel(r) { return r.mode === 'category' ? catLabel(r.cat) : modeName(r.mode, r.total); }

  /** setTimeout that is cancelled on unmount. */
  function later(fn, ms) {
    const id = setTimeout(() => { if (!view) return; view.timeouts.delete(id); fn(); }, ms);
    view.timeouts.add(id);
    return id;
  }
  /** Eased RAF tween; `step(k)` gets 0..1. Returns a cancel function. Cancelled on unmount. */
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
    return () => { cancelAnimationFrame(id); view.rafs.delete(id); };
  }
  function onDoc(type, fn) { document.addEventListener(type, fn); view.docListeners.push([type, fn]); }
  function replayClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
  }

  function destroyCtl() { if (ctl) { try { ctl.destroy(); } catch (e) { /* already gone */ } ctl = null; } }
  function closeModal() { if (view && view.modal) { const m = view.modal; view.modal = null; m.close(); } }
  /** Drop every pending timer / tween of the screen being left (end-screen count-up, confetti, toasts, floats, focus). */
  function cancelPending() {
    if (!view) return;
    view.timeouts.forEach(clearTimeout); view.timeouts.clear();
    view.rafs.forEach(cancelAnimationFrame); view.rafs.clear();
    els.scoreTween = els.endTween = null;
  }
  /**
   * Put the keyboard back on the live question after a dialog closes: the answer input while the
   * question is open, the Continue button once it is graded. UI.modal gives focus back to whatever
   * opened the dialog, which is the Quit button on a touch screen and, because the clicked dialog
   * button is removed in the same tick, occasionally nothing at all; the game therefore refocuses
   * its own question, right away and again on the next tick.
   */
  function refocusQuestion() {
    if (!view || !state || state.screen !== 'round' || view.modal || !els.mount) return;
    const target = ctl && !ctl.answered ? els.mount.querySelector('input:not(:disabled)') : els.mount.querySelector('.quiz-actions .btn-primary');
    if (target && document.activeElement !== target) { try { target.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function stopTimer() { if (view && view.timerId) { clearInterval(view.timerId); view.timerId = null; } }
  function startTimer() { stopTimer(); view.timerId = setInterval(updateTimer, 500); updateTimer(); }

  /** Seconds elapsed in the round, excluding time spent in a hidden tab. */
  function elapsedSec() {
    if (!state || !state.t0) return 0;
    const now = state.pausedAt == null ? performance.now() : state.pausedAt;
    return Math.max(0, (now - state.t0 - state.paused) / 1000);
  }
  function updateTimer() { if (els.time) els.time.textContent = UI.fmtTime(elapsedSec()); }
  function onVisibility() {
    if (!state || state.screen !== 'round') return;
    if (document.hidden) { if (state.pausedAt == null) state.pausedAt = performance.now(); }
    else if (state.pausedAt != null) { state.paused += performance.now() - state.pausedAt; state.pausedAt = null; }
  }

  /** Keyboard shortcuts: 1-4 pick a mode on the start screen, Esc asks to leave a round. */
  function onDocKey(e) {
    if (!state || view.modal || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (state.screen === 'start' && !typing) {
      const mode = { 1: 'quick', 2: 'weak', 3: 'marathon' }[e.key];
      if (mode) { e.preventDefault(); startRound(mode, { mix: prefs().mix }); }
      else if (e.key === '4') { e.preventDefault(); const chip = view.root.querySelector('.g-spell-cats .chip'); if (chip) chip.focus(); }
    } else if (state.screen === 'round' && e.key === 'Escape') {
      e.preventDefault();
      confirmQuit();
    }
  }

  /* ------------------------------------------------------------
     Round construction
     ------------------------------------------------------------ */
  function buildRound(modeId, opts) {
    opts = opts || {};
    const active = Vocab.active();
    const round = { mode: modeId, mix: !!opts.mix, cat: opts.cat || null, pool: active, queue: null, total: 0, lives: Infinity };
    switch (modeId) {
      case 'quick':
        round.total = Math.min(QUICK_COUNT, active.length);
        break;
      case 'weak': {
        const n = Math.min(WEAK_COUNT, active.length);
        let list = Progress.weakest(n, { pool: active, includeUnseen: true });
        if (list.length < n) list = list.concat(Progress.pick(n - list.length, { pool: active, exclude: list.map((e) => e.id) }));
        round.queue = uniqById(list);
        round.total = round.queue.length;
        break;
      }
      case 'category': {
        // Prefer the learner's active filter; if it excludes this category, use the whole category (still sheet vocab).
        let pool = active.filter((e) => e.cat === round.cat);
        if (!pool.length) pool = Vocab.byCategory(round.cat);
        if (!pool.length) pool = active;
        round.pool = pool;
        round.total = pool.length;
        break;
      }
      case 'marathon':
        round.total = Infinity;
        round.lives = MARATHON_LIVES;
        break;
      case 'retry': {
        const list = uniqById((opts.entries || []).map((e) => (typeof e === 'string' ? Vocab.byId(e) : e)).filter(Boolean));
        if (!list.length) return buildRound('quick', opts);
        round.queue = list;
        round.pool = list;
        round.total = list.length;
        round.mix = false; // a retry re-tests the spelling: a word missed in a typed question must be typed again, not picked from a list
        break;
      }
      default:
        return buildRound('quick', opts);
    }
    return round;
  }

  function startRound(modeId, opts) {
    if (!view) return;
    closeModal(); destroyCtl(); stopTimer(); cancelPending();
    const round = buildRound(MODES[modeId] ? modeId : 'quick', opts);
    state = {
      screen: 'round', round, mode: round.mode, opts: Object.assign({}, opts || {}),
      index: 0, used: new Set(), answers: [], current: null,
      score: 0, streak: 0, bestStreak: 0, mult: 1, lives: round.lives, accentSlips: 0, xp: 0,
      t0: performance.now(), paused: 0, pausedAt: null,
      token: {}, // identity token: QuizUI callbacks from an older round are ignored
    };
    renderRound();
    startTimer();
    askNext();
  }

  /** Pick the next word (never repeating within the round) or end the round. */
  function askNext() {
    const r = state.round;
    let entry = null;
    if (r.queue) {
      entry = r.queue[state.index] || null;
    } else if (state.index < r.total) {
      const remaining = r.pool.filter((e) => !state.used.has(e.id));
      if (remaining.length) entry = Progress.pick(1, { pool: r.pool, exclude: Array.from(state.used) })[0] || null;
    }
    if (!entry) { endRound(r.mode === 'marathon' ? 'swept' : 'complete'); return; }
    state.index++;
    state.used.add(entry.id);
    askQuestion(entry, null);
  }

  function askQuestion(entry, kind) {
    destroyCtl();
    const q = kind && Quiz[kind] ? Quiz[kind](entry) : (state.round.mix ? Quiz.any(entry, MIX_KINDS) : Quiz.typed(entry));
    const token = state.token;
    state.current = { entry, q };
    ctl = QuizUI.ask(q, {
      mount: els.mount,
      allowHint: true,
      allowSkip: true,
      focus: true,
      bonus: (state.mult - 1) * 3, // a hot streak also earns a little extra XP
      onAnswer: (res) => { if (state && state.token === token) onAnswer(res); },
      onResult: () => { if (state && state.token === token) onResult(); },
    });
    updateProgress();
  }

  /* ------------------------------------------------------------
     Answer handling
     ------------------------------------------------------------ */
  function pointsFor(res, mult) {
    let pts = 0;
    if (res.status === 'correct') {
      const speed = Math.round(SPEED_BONUS * (1 - Math.min(res.elapsed || 0, SPEED_WINDOW) / SPEED_WINDOW));
      pts = (BASE_POINTS + Math.max(0, speed)) * mult;
    } else if (res.status === 'accent') {
      pts = ACCENT_POINTS;
    }
    if (res.usedHint) pts = Math.floor(pts / 2);
    return pts;
  }

  /** Fires the moment the widget grades the answer (feedback is on screen). */
  function onAnswer(res) {
    const cur = state.current;
    if (!cur) return;
    const multUsed = state.mult;
    const pts = pointsFor(res, multUsed);
    state.answers.push({
      id: cur.entry.id, entry: cur.entry, kind: res.question.kind, status: res.status, points: pts,
      usedHint: !!res.usedHint, skipped: !!res.skipped, input: res.input, expected: res.expected || res.question.canonical,
      xp: res.xp || 0, elapsed: res.elapsed || 0,
    });
    state.xp += res.xp || 0;
    state.score += pts;

    let milestone = false;
    if (res.status === 'correct') {
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      const m = multFor(state.streak);
      milestone = m > state.mult;
      state.mult = m;
      later(() => Sound.play('coin'), 180);
    } else {
      state.streak = 0;
      state.mult = 1;
      if (res.status === 'accent') state.accentSlips++;
      if (state.round.mode === 'marathon') loseLife(res.status);
    }
    if (milestone) { later(() => Sound.play('gate'), 340); replayClass(els.mult, 'is-pop'); replayClass(els.flame, 'is-pop'); }
    spawnFloat(res.status, pts, multUsed);
    updateHud();
    updateProgress();
  }

  /** Fires when the learner continues past the feedback. */
  function onResult() {
    if (state.round.mode === 'marathon' && state.lives <= 0) { endRound('lives'); return; }
    askNext();
  }

  function loseLife(status) {
    state.lives = Math.max(0, state.lives - 1);
    later(() => Sound.play('hurt'), 260);
    const left = state.lives;
    const lives = left === 1 ? '1 life left' : left + ' lives left';
    UI.toast(status === 'accent' ? 'Accent slip. ' + (left ? lives : 'That was the last life.') : '✗ Missed. ' + (left ? lives : 'That was the last life.'), status === 'accent' ? 'warn' : 'bad');
  }

  /** "+N" float over the stage + score bump / count-up. */
  function spawnFloat(status, pts, mult) {
    if (!els.stage) return;
    const cls = status === 'correct' ? 'is-ok' : status === 'accent' ? 'is-accent' : 'is-bad';
    const el = h('div.g-spell-float.' + cls, { 'aria-hidden': 'true' },
      status === 'wrong' ? 'miss' : '+' + pts,
      status === 'correct' && mult > 1 ? h('span.x', null, '×' + mult) : null);
    els.stage.querySelectorAll('.g-spell-float').forEach((old) => old.remove()); // never stack two floats
    els.stage.appendChild(el);
    later(() => el.remove(), 1200);
    if (!pts) return;
    replayClass(els.scoreWrap, 'g-spell-bump');
    if (els.scoreTween) els.scoreTween();
    const from = state.score - pts, to = state.score;
    els.scoreTween = tween(520, (k) => { if (els.score) els.score.textContent = fmt(Math.round(from + (to - from) * k)); });
  }

  /* ------------------------------------------------------------
     Round end
     ------------------------------------------------------------ */
  /** The reason this round would end with on Continue, or null while questions remain. */
  function naturalEnd() {
    const s = state, r = s.round;
    if (r.mode === 'marathon') return s.lives <= 0 ? 'lives' : s.answers.length >= r.pool.length ? 'swept' : null;
    return s.answers.length >= r.total ? 'complete' : null;
  }

  function endRound(reason) {
    destroyCtl(); stopTimer(); closeModal(); cancelPending();
    const s = state;
    s.screen = 'end';
    s.reason = reason === 'quit' ? (naturalEnd() || 'quit') : reason; // quitting after the last answer is a finished round, not an early exit
    s.time = elapsedSec();
    const answered = s.answers.length;
    const correct = s.answers.filter((a) => a.status === 'correct').length;
    s.accuracy = answered ? correct / answered : 0;
    s.missed = s.answers.filter((a) => a.status !== 'correct');

    // Completion bonus XP (on top of the per-answer XP the widget already recorded).
    s.bonusXp = !answered ? 0 : s.accuracy >= 1 ? 30 : s.accuracy >= 0.8 ? 15 : 0;
    if (s.bonusXp) { Progress.addXp(s.bonusXp); s.xp += s.bonusXp; }

    // High scores: per mode (kept in the game's stats blob) + overall.
    const bests = Object.assign({}, modeBests());
    s.newModeBest = s.mode !== 'retry' && answered > 0 && s.score > (bests[s.mode] || 0);
    if (s.newModeBest) bests[s.mode] = s.score;
    s.newBest = Progress.setBest(ID, s.score, { mode: s.mode, bests, lastScore: s.score });
    Progress.noteStreak(s.bestStreak);

    renderEnd();
    const win = answered > 0 && s.accuracy >= 0.8;
    later(() => Sound.play(win ? 'win' : answered ? 'lose' : 'click'), 120);
    if (win) later(() => UI.confetti({ count: s.accuracy >= 1 ? 190 : 130 }), 260);
    if (s.newBest && answered) later(() => UI.toast('New best score', 'ok'), 700);
  }

  function confirmQuit() {
    if (!state || state.screen !== 'round' || view.modal) return;
    const answered = state.answers.length;
    const done = naturalEnd(); // every question is already answered: only the results are left, nothing to discard
    const content = h('div.stack', null,
      h('p.text-2', { style: { margin: 0 } }, done
        ? 'Every answer is in: ' + fmt(state.score) + ' points. See the results?'
        : answered
          ? 'Finish now with ' + fmt(state.score) + ' points, or leave? Your answers are already saved.'
          : 'Leave this round?'),
      h('div.row', null,
        done ? h('button.btn.btn-mint', { type: 'button', onclick: () => { closeModal(); endRound(done); } }, '🏁 See results')
          : answered ? h('button.btn.btn-mint', { type: 'button', onclick: () => { closeModal(); endRound('quit'); } }, 'Finish now') : null,
        done ? null : h('button.btn.btn-outline', { type: 'button', onclick: () => { closeModal(); showStart(); } }, 'Back to start'),
        h('button.btn.btn-ghost', { type: 'button', onclick: closeModal }, done ? 'Not yet' : 'Keep playing')));
    view.modal = UI.modal({
      title: done ? 'All done' : 'Leave this round?', content, closable: true,
      onClose: () => { if (!view) return; view.modal = null; refocusQuestion(); later(refocusQuestion, 40); },
    });
  }

  /* ------------------------------------------------------------
     Screens
     ------------------------------------------------------------ */
  function topbar(right, modeChip) {
    return h('div.game-topbar', null,
      h('div.game-title', null, h('span.icon', null, '✍️'), 'Spell Forge', modeChip || null),
      right || null);
  }

  function showStart() {
    destroyCtl(); stopTimer(); closeModal(); cancelPending();
    state = { screen: 'start' };
    els = {};
    const p = prefs();
    const stats = Progress.gameStats(ID);
    const bests = modeBests();
    const active = Vocab.active();
    const all = Vocab.all();
    const needWork = active.filter((e) => Progress.box(e.id) < 3).length;

    UI.clear(view.root);
    const shell = h('div.game-shell.g-spell.g-spell-start');
    shell.appendChild(topbar(h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← Home')));

    // Hero
    shell.appendChild(h('div.card.card-glass.g-spell-hero', null,
      h('div.g-spell-hero-text', null,
        h('div.eyebrow', null, 'Typing drill'),
        h('h2', null, 'See the English, ', h('span.grad-text', null, 'type the Spanish')),
        h('p.text-2', null, 'Accents included. Streaks multiply your points, hints halve them, and the words you miss come back.')),
      h('div.g-spell-hero-stats', null,
        stat(fmt(stats.best), 'Best'),
        stat(fmt(stats.plays), stats.plays === 1 ? 'Round' : 'Rounds'),
        stat(String(needWork), 'Need work'))));

    // Modes: three quick-start cards in a row, the category picker spans the full width below.
    const modes = h('div.g-spell-modes', { role: 'group', 'aria-label': 'Game modes' });
    ['quick', 'weak', 'marathon', 'category'].forEach((id) => {
      const m = MODES[id];
      const best = bests[id] || 0;
      const isCat = id === 'category';
      const name = modeName(id), desc = modeDesc(id);
      const card = h((isCat ? 'div' : 'button') + '.g-spell-mode' + (isCat ? '.is-cats' : ''), { type: isCat ? null : 'button', dataset: { mode: id }, 'aria-label': isCat ? name : name + (best ? ', best ' + best : '') },
        h('span.g-spell-mode-icon', null, m.icon),
        h('span.g-spell-mode-body', null,
          h('span.g-spell-mode-name', null, name, h('span.g-spell-key', { 'aria-hidden': 'true' }, m.key)),
          h('span.g-spell-mode-desc', null, desc),
          isCat ? catChips() : null),
        h('span.g-spell-mode-best' + (best ? '.has-best' : ''), null, best ? h('b', null, fmt(best)) : '', best ? ' best' : (isCat ? 'pick one' : 'Play →')));
      card.style.setProperty('--accent', m.accent);
      if (!isCat) card.addEventListener('click', () => { Sound.play('click'); startRound(id, { mix: prefs().mix }); });
      modes.appendChild(card);
    });
    shell.appendChild(modes);

    // Options row
    const mixInput = h('input', { type: 'checkbox', checked: !!p.mix, onchange: (e) => { savePref('mix', !!e.target.checked); Sound.play('click'); } });
    shell.appendChild(h('div.g-spell-options', null,
      h('label.toggle.g-spell-toggle', null, mixInput, h('span.track'), h('span', null, 'Mix in accent & multiple-choice questions')),
      h('div.small.muted.g-spell-note', null,
        active.length < all.length ? 'Practising ' + active.length + ' of ' + all.length + ' words (category filter on Home). ' : 'All ' + all.length + ' words in play. ',
        h('span', { html: 'Tip: type a vowel or <b>n</b>, then press <span class="kbd">`</span> for its accent.' }))));

    view.root.appendChild(shell);
  }

  function catChips() {
    const wrap = h('span.chip-group.g-spell-cats', { role: 'group', 'aria-label': 'Categories' });
    Vocab.categories().forEach((c) => {
      const n = Vocab.byCategory(c.id).length;
      const chip = h('button.chip', { type: 'button', dataset: { cat: c.id }, title: c.es }, c.icon + ' ' + catLabel(c.id) + ' · ' + n);
      chip.style.setProperty('--cat', c.color);
      chip.addEventListener('click', () => { Sound.play('click'); startRound('category', { cat: c.id, mix: prefs().mix }); });
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function heart(alive) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'g-spell-heart' + (alive ? '' : ' is-lost'));
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 21s-6.7-4.4-9.3-8.2C.6 9.6 2 5 6 5c2.1 0 3.4 1.2 4 2.3C10.6 6.2 11.9 5 14 5c4 0 5.4 4.6 3.3 7.8C18.7 16.6 12 21 12 21z');
    svg.appendChild(path);
    return svg;
  }

  function renderRound() {
    const s = state, r = s.round, m = MODES[r.mode];
    UI.clear(view.root);
    els = {};
    const shell = h('div.game-shell.g-spell.g-spell-round');
    shell.style.setProperty('--accent', m.accent);
    const chip = h('span.g-spell-modechip', null, m.icon + ' ' + roundLabel(r));
    shell.appendChild(topbar(h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Leave this round (Esc)', onclick: confirmQuit }, '✕ Quit'), chip));

    // Progress bar
    els.progLabel = h('span.g-spell-progress-label');
    els.progRight = h('span.muted');
    els.bar = h('div.bar-fill');
    els.barWrap = h('div.bar.bar-mint', { role: 'progressbar', 'aria-label': 'Round progress', 'aria-valuemin': '0' }, els.bar);
    shell.appendChild(h('div.g-spell-progress', null,
      h('div.g-spell-progress-head.small', null, els.progLabel, els.progRight),
      els.barWrap));

    // HUD
    els.streak = h('b', null, '0');
    els.flame = h('span.streak-flame.g-spell-flame', { title: 'Streak' }, '🔥 ', els.streak);
    els.mult = h('span.g-spell-mult', { title: 'Score multiplier' }, '×1');
    els.score = h('span.val', null, '0');
    els.scoreWrap = h('div.hud-item.g-spell-scorewrap', null, h('span.label', null, 'Score'), els.score);
    els.time = h('span.val.mono', null, '0:00');
    els.lives = h('span.g-spell-lives', { 'aria-label': 'Lives' });
    els.tipCount = h('b', null, '0');
    els.tipLabel = h('span', null, ' accent slips');
    els.tip = h('span.g-spell-tip.hidden', { title: 'Letters right, accents wrong. Tip: type the vowel, then press ` to add its accent.' },
      h('span.g-spell-tip-mark', { 'aria-hidden': 'true' }, '´'), els.tipCount, els.tipLabel);
    shell.appendChild(h('div.hud.g-spell-hud', null,
      h('div.hud-item', null, els.flame, els.mult),
      els.scoreWrap,
      h('div.hud-item', null, h('span.label', null, 'Time'), els.time),
      r.mode === 'marathon' ? h('div.hud-item', null, h('span.label', null, 'Lives'), els.lives) : null,
      h('div.hud-spacer'),
      els.tip));

    // Stage (the QuizUI widget mounts inside)
    els.mount = h('div.g-spell-mount');
    // Keyboard-first: clicking Hint / an empty Check must not strand focus on a (now disabled) button.
    els.mount.addEventListener('click', () => {
      if (!ctl || ctl.answered) return;
      const input = els.mount.querySelector('input:not(:disabled)');
      if (input && document.activeElement !== input) { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    });
    els.stage = h('div.card.card-glass.g-spell-stage', null, els.mount);
    shell.appendChild(els.stage);
    view.root.appendChild(shell);
    updateHud();
  }

  function updateHud() {
    const s = state;
    if (!els.flame || s.screen !== 'round') return;
    els.streak.textContent = String(s.streak);
    els.mult.textContent = '×' + s.mult;
    els.mult.classList.toggle('is-on', s.mult > 1);
    els.flame.classList.toggle('is-hot', s.streak >= STREAK_X2);
    els.flame.classList.toggle('is-blazing', s.streak >= STREAK_X3);
    if (s.round.mode === 'marathon') {
      UI.clear(els.lives);
      for (let i = 0; i < MARATHON_LIVES; i++) els.lives.appendChild(heart(i < s.lives));
    }
    if (s.accentSlips) {
      els.tip.classList.remove('hidden');
      els.tipCount.textContent = String(s.accentSlips);
      els.tipLabel.textContent = s.accentSlips === 1 ? ' accent slip' : ' accent slips';
      replayClass(els.tip, 'anim-pop');
    }
    updateTimer();
  }

  function updateProgress() {
    const s = state, r = s.round;
    if (!els.bar) return;
    const done = s.answers.length;
    const max = r.total === Infinity ? r.pool.length : r.total;
    if (r.total === Infinity) {
      const left = r.pool.length - s.used.size;
      els.progLabel.textContent = 'Question ' + s.index;
      els.progRight.textContent = left ? left + ' words left in the deck' : 'last word';
    } else {
      const left = r.total - s.index;
      els.progLabel.textContent = 'Question ' + Math.min(s.index, r.total) + ' of ' + r.total;
      els.progRight.textContent = left > 0 ? left + ' to go' : 'last one';
    }
    els.bar.style.width = Math.round(100 * done / max) + '%';
    els.barWrap.setAttribute('aria-valuemax', String(max));
    els.barWrap.setAttribute('aria-valuenow', String(done));
    els.barWrap.setAttribute('aria-valuetext', done + ' of ' + max + ' answered');
  }

  function renderEnd() {
    const s = state;
    UI.clear(view.root);
    els = {};
    const answered = s.answers.length;
    const correct = answered - s.missed.length;
    const pct = Math.round(s.accuracy * 100);
    const headline = !answered ? 'No answers this time.'
      : s.accuracy >= 1 ? 'Every word right.'
      : s.accuracy >= 0.8 ? 'Nearly all of them.'
      : s.accuracy >= 0.5 ? 'More than half.'
      : 'A hard round. Those words will come back.';
    const reason = { lives: 'Out of lives', swept: 'Whole deck done', quit: 'Finished early', complete: roundLabel(s.round) + ' · complete' }[s.reason] || 'Round complete';

    const shell = h('div.game-shell.g-spell.g-spell-endwrap');
    shell.style.setProperty('--accent', MODES[s.mode].accent);
    shell.appendChild(topbar(h('a.btn.btn-ghost.btn-sm', { href: '#/' }, '← Home')));

    const panel = h('div.card.card-glass.g-spell-end');
    panel.appendChild(h('div.eyebrow', null, reason));
    panel.appendChild(h('h2', null, headline));

    els.score = h('div.g-spell-bigscore', null, '0');
    const badge = s.newBest && answered ? h('span.chip.chip-mint.g-spell-newbest', null, '🏆 New best score')
      : s.newModeBest ? h('span.chip.chip-mint.g-spell-newbest', null, '🏆 New ' + modeName(s.mode, s.round.total) + ' best') : null;
    panel.appendChild(h('div.g-spell-end-top', null,
      h('div.g-spell-end-score', null, els.score, h('div.small.muted', null, 'points'), badge),
      h('div.g-spell-end-ring', null, UI.ring(s.accuracy, pct + '%', 128), h('div.small.muted.center', null, 'accuracy'))));

    panel.appendChild(h('div.stat-grid', null,
      stat(correct + ' / ' + answered, 'Correct'),
      stat('+' + fmt(s.xp), 'XP earned'),
      stat(UI.fmtTime(s.time), 'Time'),
      stat(String(s.bestStreak), 'Best streak'),
      s.accentSlips ? stat(String(s.accentSlips), s.accentSlips === 1 ? 'Accent slip' : 'Accent slips') : null));

    if (s.missed.length) {
      panel.appendChild(h('div.g-spell-missed-head', null, h('h3', null, 'Words to revisit'), h('span.small.muted', null, 'accents highlighted')));
      const list = h('div.g-spell-missed');
      s.missed.forEach((a) => {
        const typed = typeof a.input === 'string' && a.input && !a.skipped ? a.input : '';
        const verb = a.kind === 'choice' ? 'you picked ' : 'you typed ';
        list.appendChild(h('div.g-spell-miss', { dataset: { status: a.status, id: a.id } },
          h('div.g-spell-miss-main', null,
            h('div.g-spell-miss-es', { html: Text.highlightAccents(a.expected) }),
            h('div.g-spell-miss-en.small.text-2', null, a.entry.en + (a.entry.note ? ' · ' + a.entry.note : ''))),
          h('div.g-spell-miss-side', null,
            typed ? h('span.g-spell-miss-typed.small.muted', null, verb, h('s', null, typed)) : null,
            h('span.g-spell-miss-tag', null, a.skipped ? 'skipped' : a.status === 'accent' ? 'accent slip' : 'wrong'),
            Speech.available() ? h('button.btn.btn-ghost.btn-sm.btn-icon.g-spell-say', { type: 'button', title: 'Hear it', 'aria-label': 'Hear ' + a.entry.base, onclick: () => { Speech.say(a.entry.base); } }, '🔊') : null)));
      });
      panel.appendChild(list);
    } else if (answered) {
      panel.appendChild(h('p.g-spell-clean', null, '✨ Nothing to revisit — every word was spot on.'));
    }

    els.again = h('button.btn' + (s.missed.length ? '.btn-outline' : '.btn-primary') + '.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); startRound(s.mode, s.opts); } }, '▶ Play again');
    panel.appendChild(h('div.g-spell-actions', null,
      s.missed.length ? h('button.btn.btn-primary.btn-lg.g-spell-retry', { type: 'button', onclick: () => { Sound.play('click'); startRound('retry', { entries: s.missed.map((a) => a.entry) }); } }, '🔁 Retry missed words') : null,
      els.again,
      h('button.btn.btn-ghost.btn-lg', { type: 'button', onclick: () => view.ctx.navigate('/') }, 'Home')));
    shell.appendChild(panel);
    view.root.appendChild(shell);

    els.endTween = tween(900, (k) => { if (els.score) els.score.textContent = fmt(Math.round(s.score * k)); });
    // Focus "Play again" a beat later so a held Enter from the last question cannot restart instantly.
    later(() => { try { els.again.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 600);
  }

  /* ------------------------------------------------------------
     Module registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Spell Forge',
    tagline: 'See the English, type the Spanish.',
    icon: '✍️',
    accent: 'var(--c-mint)',
    order: 2,
    mount(root, ctx) {
      view = { root, ctx, timeouts: new Set(), rafs: new Set(), docListeners: [], modal: null, timerId: null };
      onDoc('keydown', onDocKey);
      onDoc('visibilitychange', onVisibility);
      showStart();
    },
    unmount() {
      destroyCtl(); stopTimer(); closeModal();
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
    get controller() { return ctl; },
    get els() { return els; },
    get mounted() { return !!view; },
    start(mode, opts) { startRound(mode, opts || {}); return state; },
    /** Replace the current question with a specific word / kind (counts as this question). */
    force(id, kind) {
      if (!state || state.screen !== 'round') return null;
      const entry = Vocab.byId(id);
      if (!entry) return null;
      state.used.add(entry.id);
      askQuestion(entry, kind || 'typed');
      return ctl;
    },
    setStreak(n) { if (state && state.screen === 'round') { state.streak = n | 0; state.bestStreak = Math.max(state.bestStreak, state.streak); state.mult = multFor(state.streak); updateHud(); } },
    setLives(n) { if (state && state.screen === 'round') { state.lives = n | 0; updateHud(); } },
    end(reason) { if (state && state.screen === 'round') endRound(reason || 'quit'); },
    showStart() { if (view) showStart(); },
    points: pointsFor,
    elapsed: elapsedSec,
  };
})();
