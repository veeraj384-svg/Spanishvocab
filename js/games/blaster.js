/* ============================================================
   PALABRA QUEST — Word Rain  (game id: 'blaster')
   Arcade typing defense. English meanings fall from the sky as
   meteors; type the Spanish spelling — accents included — and
   press Enter to blast them before they reach the city.

   Rules
     correct spelling   the laser destroys the meteor, points × wave
     accent-only slip   the meteor cracks, slows 50% and shows the
                        correct spelling for 2 s (it must still be typed)
     no match           the input shakes red, the combo takes a small hit
     meteor lands       −1 life, the correct spelling is shown big in the HUD
     0 lives            game over (score, wave, accuracy, missed words)

   Waves: wave n drops n + 3 meteors, faster and more often each
   wave, at most 4 on screen, never the same word twice at once.
   Words come from Progress.pick on Vocab.active(), weakest first.
   Every meteor records at most one Progress result.
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, UI, Sound, Speech, Rand } = PQ;
  const h = UI.h;

  const ID = 'blaster';
  const LIVES = 3;
  const MAX_ON_SCREEN = 4;
  const MAX_DT = 0.05;          // clamp wall-clock dt (tab switches, hiccups)
  const GROUND = 30;            // px from the canvas bottom to the impact line
  const SPAWN_FIRST = 1.0;      // s between a wave starting and its first meteor
  const BANNER_CLEARED = 3.0;   // s the "Wave n cleared" banner stays up
  const BANNER_START = 1.3;     // s the "Wave n" banner stays up
  const REVEAL = 2.0;           // s a cracked meteor shows its correct spelling
  const HUD_MSG = 2.5;          // s the correct spelling stays in the HUD after a hit
  const ENDING = 1.1;           // s between the last life and the game-over panel
  const BASE_POINTS = 100;
  const HEIGHT_BONUS = 50;      // extra points for a meteor destroyed near the top
  const COMBO_STEP = 4;         // every 4 combo adds +25% to each destroy
  const WRONG_COMBO_PENALTY = 2;
  const TAU = Math.PI * 2;
  const FONT = "'Outfit', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Theme colours (mirrors css/styles.css tokens; the canvas can't read CSS vars cheaply)
  const C = {
    amber: '#f6c453', amber2: '#f28d35', mint: '#38d9c4', mint2: '#1fb8a6',
    lav2: '#7c5cf0', rose: '#ff5c7a', rose2: '#e0335a', white: '#ffffff',
  };
  const CAT_ICON = {};
  Vocab.categories().forEach((c) => { CAT_ICON[c.id] = c.icon; });

  // Wave tuning: how many meteors, how long one takes to fall, how often they spawn.
  const waveSize = (n) => n + 3;
  const fallSeconds = (n) => Math.max(5.5, 15 - (n - 1) * 1.1);
  const spawnEvery = (n) => Math.max(1.3, 3.4 - (n - 1) * 0.25);

  /* ------------------------------------------------------------
     Module state
       S      everything the current mount owns (null when unmounted)
       D      DOM refs (null when unmounted)
       rafId  the frame loop handle
     ------------------------------------------------------------ */
  let S = null;
  let D = null;
  let rafId = 0;
  let timers = [];

  /** setTimeout that is cancelled on unmount and skipped if the game is gone. */
  function later(fn, ms) {
    const id = setTimeout(() => { timers = timers.filter((t) => t !== id); if (S && D) fn(); }, ms);
    timers.push(id);
    return id;
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const uniqById = (list) => { const seen = new Set(); return list.filter((e) => !seen.has(e.id) && seen.add(e.id)); };
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function roundRect(ctx, x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hh, r);
    ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Static scenery: a starfield and a city skyline, stored as fractions so resizing is free. */
  function makeScene() {
    const rng = Rand.seeded((Date.now() & 0xffff) + 7);
    const stars = [];
    for (let i = 0; i < 120; i++) {
      stars.push({ fx: rng(), fy: rng() * 0.85, s: 0.6 + rng() * 1.5, p: rng() * TAU, k: 0.8 + rng() * 2.2, c: rng() < 0.75 ? C.white : (rng() < 0.5 ? C.amber : C.mint) });
    }
    const buildings = [];
    let fx = 0.004;
    while (fx < 0.99) {
      const fw = 0.03 + rng() * 0.045;
      if (Math.abs(fx + fw / 2 - 0.5) > 0.08) { // leave the centre to the turret
        const cols = Math.max(2, Math.round(fw * 100));
        const windows = [];
        for (let k = 0; k < cols * 7; k++) windows.push(rng() < 0.62);
        buildings.push({ fx, fw, fh: 0.25 + rng() * 0.75, cols, windows, hp: 2, antenna: rng() < 0.3 });
      }
      fx += fw + 0.006 + rng() * 0.01;
    }
    return { stars, buildings };
  }

  function newState(prev) {
    const scene = prev ? prev.scene : makeScene();
    scene.buildings.forEach((b) => { b.hp = 2; });
    return {
      mode: 'intro',          // intro | play | pause | ending | over
      t: 0,                   // game clock (s), frozen while paused
      anim: prev ? prev.anim : 0, // ambient clock for stars / idle turret
      lastT: prev ? prev.lastT : 0,
      view: prev ? prev.view : { w: 0, h: 0, dpr: 1, cw: 0 },
      bg: prev ? prev.bg : null,
      scene,
      score: 0, wave: 0, lives: LIVES, combo: 0, bestCombo: 0,
      attempts: 0, hits: 0, accents: 0, wrongs: 0,
      missed: [],             // entries that reached the city (whole run)
      waveMissed: [],         // ... during the current wave
      waveUsed: [],           // ids spawned this wave (avoid repeats when the pool allows)
      phase: 'idle',          // idle | banner | wave
      spawned: 0, waveTotal: 0, queue: [], spawnTimer: 0,
      banner: null,           // { until, after }
      hudMsg: null,           // { key, en, es, base, until }
      meteors: [], lasers: [], particles: [], rings: [], floats: [],
      flash: 0, shake: 0, endAt: 0,
      turret: { angle: -Math.PI / 2, recoil: 0 },
      frozen: false,          // debug: meteors stop falling (spawns continue)
      saved: false, isNewBest: false,
      flashToken: 0, uid: 0, hudCache: {},
    };
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  function bestLabel() {
    const g = Progress.gameStats(ID);
    return g.best ? 'Best ' + fmt(g.best) + (g.wave ? ' · wave ' + g.wave : '') : 'No best yet';
  }

  function buildDom(root) {
    const best = h('span.g-blaster-best', null, bestLabel());
    const pauseBtn = h('button.btn.btn-outline.btn-sm.g-blaster-pausebtn', { type: 'button', title: 'Pause (Esc)', onclick: () => { if (S && (S.mode === 'play' || S.mode === 'pause')) togglePause(); } }, '⏸ Pause');
    const topbar = h('div.game-topbar', null,
      h('div.game-title', null,
        h('span.icon', null, '☄️'),
        h('span', null, 'Word Rain', h('span.g-blaster-tag', null, 'Type the Spanish to defend the city'))),
      h('div.row', null, best, pauseBtn));

    const hearts = [];
    for (let i = 0; i < LIVES; i++) hearts.push(h('span.g-blaster-heart', { 'aria-hidden': 'true' }, '♥'));
    const score = h('span.val', null, '0');
    const wave = h('span.val', null, '1');
    const combo = h('span.val', null, '0');
    const comboItem = h('div.hud-item.g-blaster-combo', null, h('span.label', null, 'Combo'), combo);
    const msgEn = h('span.g-blaster-hudmsg-en');
    const msgEs = h('b.g-blaster-hudmsg-es');
    const speak = h('button.g-blaster-hudmsg-speak', { type: 'button', title: 'Hear it', 'aria-label': 'Hear the word', onmousedown: (e) => e.preventDefault(), onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); if (S && S.hudMsg) Speech.say(S.hudMsg.base); } }, '🔊');
    const msg = h('div.g-blaster-hudmsg', { role: 'status' },
      h('span.g-blaster-hudmsg-icon', null, '💥'),
      h('span.g-blaster-hudmsg-text', null, msgEn, h('span.g-blaster-hudmsg-arrow', null, '→'), msgEs),
      speak);
    const hud = h('div.hud.g-blaster-hud', null,
      h('div.hud-item', null, h('span.label', null, 'Score'), score),
      h('div.hud-item', null, h('span.label', null, 'Wave'), wave),
      h('div.hud-item', null, h('span.label', null, 'Lives'), h('span.g-blaster-hearts', { 'aria-label': 'lives' }, hearts)),
      comboItem,
      h('div.hud-spacer'));

    const canvas = h('canvas.g-blaster-canvas', { 'aria-label': 'Word Rain play field' });
    const banner = h('div.g-blaster-banner', { 'aria-live': 'polite' });
    // The teaching message floats over the bottom of the play field, so the HUD, canvas and typing box never move.
    const stage = h('div.game-stage.g-blaster-stage', null, canvas, banner, msg);
    // Clicking / tapping the sky brings the keyboard back to the input.
    stage.addEventListener('pointerdown', (e) => { if (S && S.mode === 'play') { e.preventDefault(); focusInput(); } });
    stage.addEventListener('click', () => { if (S && S.mode === 'play') focusInput(); });

    const input = h('input.input.input-lg.g-blaster-input', { type: 'text', placeholder: 'Type the Spanish… then Enter', 'aria-label': 'Spanish spelling', enterkeyhint: 'send', inputmode: 'text' });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!S) return;
      if (S.mode === 'intro' || S.mode === 'over') startGame();   // Enter in the box starts a run too
      else if (S.mode === 'pause') resume();
      else submitAnswer();
    });
    const fire = h('button.btn.btn-danger.g-blaster-fire', { type: 'button', title: 'Fire (Enter)', onmousedown: (e) => e.preventDefault(), onclick: () => submitAnswer() }, '💥 Fire');
    const barWrap = h('div.g-blaster-bar');
    const consoleEl = h('div.card.card-glass.g-blaster-console', null, h('div.g-blaster-console-row', null, input, fire), barWrap);
    UI.accentBar(input, { mount: barWrap });

    const shell = h('div.game-shell.g-blaster', null, topbar, hud, stage, consoleEl);
    root.appendChild(shell);
    return {
      shell, stage, canvas, ctx: canvas.getContext('2d'), banner, input, fire, best, pauseBtn, consoleEl, overlay: null,
      hud: { score, wave, hearts, combo, comboItem, msg, msgEn, msgEs },
    };
  }

  function focusInput() {
    if (!D) return;
    try { D.input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  /**
   * Make sure the typing box is fully on screen. If its bottom edge hangs below the viewport,
   * Chromium centres the caret on the first keystroke and scrolls the play field under the
   * sticky header; a small nudge now (nothing on tall windows) prevents that.
   */
  function revealConsole() {
    if (!D) return;
    const r = D.consoleEl.getBoundingClientRect();
    const room = Math.max(0, document.documentElement.scrollHeight - window.innerHeight - (window.scrollY || 0));
    let over = Math.min(Math.ceil(r.bottom - window.innerHeight + 8), room);    // how far the box hangs below the fold
    // ...but the top bar (title, Best, Pause) must stay below the sticky header
    const header = document.querySelector('.site-header');
    const topbar = D.shell.querySelector('.game-topbar');
    if (header && topbar) over = Math.min(over, Math.floor(topbar.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 6));
    if (over <= 2) return;                                                        // tall window: nothing to do
    try { window.scrollBy({ top: over, left: 0, behavior: 'smooth' }); } catch (e) { window.scrollBy(0, over); }
  }

  /** The Fire button recoils on every shot (keyboard or tap). */
  function kickFire() {
    const b = D.fire;
    b.classList.remove('is-firing');
    void b.offsetWidth;
    b.classList.add('is-firing');
    later(() => b.classList.remove('is-firing'), 300);
  }

  function flashInput(cls) {
    const el = D.input;
    el.classList.remove('is-correct', 'is-wrong', 'is-accent');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add(cls);
    const token = ++S.flashToken;
    later(() => { if (S.flashToken === token) el.classList.remove(cls); }, 520);
  }

  /* ------------------------------------------------------------
     Overlays (intro / pause / game over) inside the stage
     ------------------------------------------------------------ */
  function showOverlay(panel, cls) {
    hideOverlay();
    D.overlay = h('div.game-overlay.g-blaster-overlay' + (cls ? '.' + cls : ''), null, panel);
    D.stage.appendChild(D.overlay);
  }
  function hideOverlay() { if (D && D.overlay) { D.overlay.remove(); D.overlay = null; } }
  function focusLater(sel) { later(() => { const b = D.overlay && D.overlay.querySelector(sel); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, 40); }

  function introPanel() {
    const g = Progress.gameStats(ID);
    return h('div.panel.g-blaster-intro', null,
      h('div.g-blaster-intro-icon', { 'aria-hidden': 'true' }, '☄️'),
      h('h2', null, 'Word Rain'),
      h('p.text-2', null, 'English words fall from the sky. Type the Spanish, accents included, then press Enter or tap Fire.'),
      (window.innerHeight < 480 && (navigator.maxTouchPoints > 0)) ? h('div.small.muted', null, '📱 Rotate your phone upright for the best view') : null,
      h('div.g-blaster-legend', null,
        h('div', null, h('b', null, '⌨️'), 'Type the Spanish word, then Enter'),
        h('div', null, h('b', null, 'á'), 'A missing accent only cracks the meteor'),
        h('div', null, h('b', null, '♥'), '3 lives · a meteor that lands costs one'),
        h('div', null, h('b', null, '🔥'), 'Chain hits to multiply your points')),
      g.best ? h('div.small.muted.g-blaster-intro-best', null, '🏆 ' + bestLabel()) : null,
      h('div.row.g-blaster-actions', null,
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '▶ Start')));
  }

  function pausePanel() {
    return h('div.panel.g-blaster-pause', null,
      h('div.eyebrow', null, 'Paused'),
      h('h2', null, 'Paused'),
      h('p.text-2', null, 'Score ' + fmt(S.score) + ' · wave ' + S.wave + ' · ' + S.lives + (S.lives === 1 ? ' life' : ' lives') + ' left'),
      h('div.row.g-blaster-actions', null,
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: resume }, '▶ Resume'),
        h('button.btn.btn-outline', { type: 'button', onclick: startGame }, '↻ Restart'),
        h('a.btn.btn-ghost', { href: '#/' }, 'Home')));
  }

  function statEl(label, val) { return h('div.stat', null, h('div.stat-val', null, String(val)), h('div.stat-label', null, label)); }

  function overPanel() {
    const accuracy = S.attempts ? Math.round(S.hits / S.attempts * 100) : 100;
    const missed = uniqById(S.missed);
    const list = missed.length
      ? h('div.g-blaster-missed', null, missed.map((e) => h('div.g-blaster-missed-row', null,
          h('span.en', null, e.en),
          h('span.es', { html: Text.highlightAccents(e.answers[0]) }),
          Speech.enabled() ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Hear it', onclick: () => Speech.say(e.base) }, '🔊') : null)))
      : h('p.small.muted', null, 'Nothing reached the city.');
    return h('div.panel.g-blaster-over', null,
      h('div.eyebrow', null, 'Game over'),
      h('h2', null, 'Out of lives'),
      h('div.big.grad-text', null, fmt(S.score)),
      S.isNewBest ? h('div.g-blaster-newbest', null, 'New best score') : h('div.small.muted', null, bestLabel()),
      h('div.stat-grid', null,
        statEl('Wave', S.wave),
        statEl('Destroyed', S.hits),
        statEl('Accuracy', accuracy + '%'),
        statEl('Best combo', S.bestCombo)),
      h('div.row.g-blaster-actions', null,
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '↻ Retry'),
        h('a.btn.btn-ghost', { href: '#/' }, 'Home')),
      // the review list comes after the buttons: Retry / Home stay in view, the list scrolls as long as it needs
      missed.length ? h('div.g-blaster-missed-title', null, missed.length + (missed.length === 1 ? ' word to review' : ' words to review')) : null,
      list);
  }

  /* ------------------------------------------------------------
     Run / wave flow
     ------------------------------------------------------------ */
  function startGame() {
    if (!S || !D) return;
    hideOverlay();
    clearBanner();
    S = newState(S);
    S.mode = 'play';
    D.input.value = '';
    D.input.classList.remove('is-correct', 'is-wrong', 'is-accent');
    D.stage.classList.remove('is-hit');
    beginWave(1);
    updateHud(true);
    Sound.play('gate');
    focusInput();
    revealConsole();
  }

  /** Pick a whole wave up front: Progress.pick is weak-weighted, then weakest first. */
  function pickWave(n) {
    const picked = Progress.pick(waveSize(n));
    picked.sort((a, b) => Progress.weight(b) - Progress.weight(a));
    return picked;
  }

  function beginWave(n) {
    S.wave = n;
    S.spawned = 0;
    S.waveTotal = waveSize(n);
    S.queue = pickWave(n);
    S.waveUsed = [];
    S.waveMissed = [];
    S.spawnTimer = SPAWN_FIRST;
    showBanner({
      title: 'Wave ' + n,
      sub: n === 1 ? 'Type the Spanish, then Enter' : waveSize(n) + ' words',
      dur: BANNER_START,
    });
  }

  function waveCleared() {
    const bonus = 100 * S.wave;
    S.score += bonus;
    const { w, h: hh } = S.view;
    floatText(w / 2, hh * 0.72, 'Wave bonus +' + bonus, C.mint);
    Sound.play('win');
    if (D.stage) { const r = D.stage.getBoundingClientRect(); UI.confetti({ x: r.left + r.width / 2, y: r.top + r.height * 0.4, count: 70 }); }
    const missed = uniqById(S.waveMissed);
    showBanner({
      title: 'Wave ' + S.wave + ' cleared',
      sub: missed.length ? 'Words to review' : '+' + bonus + ' bonus',
      missed,
      dur: BANNER_CLEARED,
      after: () => beginWave(S.wave + 1),
    });
  }

  /** Big label at the top of the stage. While it is up the wave is paused (phase 'banner'). */
  function showBanner(o) {
    S.phase = 'banner';
    S.banner = { until: S.t + o.dur, after: o.after || null };
    const b = D.banner;
    UI.clear(b);
    b.appendChild(h('div.g-blaster-banner-title', null, o.title));
    if (o.sub) b.appendChild(h('div.g-blaster-banner-sub', null, o.sub));
    if (o.missed && o.missed.length) {
      b.appendChild(h('div.g-blaster-banner-list', null, o.missed.map((e) => h('span', null, e.en + ' → ', h('b', { html: Text.highlightAccents(e.answers[0]) })))));
    }
    b.classList.remove('is-on');
    void b.offsetWidth; // restart the pop animation
    b.classList.add('is-on');
  }
  function clearBanner() {
    if (S) S.banner = null;
    if (D) D.banner.classList.remove('is-on');
  }

  /** Next word for the spawner: never one that is already on screen. */
  function nextEntry() {
    const onScreen = new Set(S.meteors.map((m) => m.entry.id));
    while (S.queue.length) {
      const e = S.queue.shift();
      if (!onScreen.has(e.id)) return e;
    }
    // Queue ran dry (debug spawns, tiny category pool): refill, avoiding this wave's words where possible —
    // and never the word that just spawned / was destroyed, even when the pool is tiny.
    const need = Math.max(1, S.waveTotal - S.spawned);
    const all = Vocab.active();
    const fresh = all.filter((e) => e.id !== S.lastEntryId && !onScreen.has(e.id));
    const picked = Progress.pick(need, { pool: fresh.length ? fresh : all, exclude: S.waveUsed });
    picked.sort((a, b) => Progress.weight(b) - Progress.weight(a));
    S.queue = picked.filter((e) => !onScreen.has(e.id));
    return S.queue.shift() || null;
  }

  function trySpawn(dt) {
    S.spawnTimer -= dt;
    if (S.spawnTimer > 0 || S.spawned >= S.waveTotal || S.meteors.length >= MAX_ON_SCREEN) return;
    const entry = nextEntry();
    if (!entry) { S.spawnTimer = 0.5; return; }
    spawnMeteor(entry);
    S.spawnTimer = spawnEvery(S.wave) * (0.85 + Math.random() * 0.3);
  }

  /** Irregular rock outline + craters, generated once per meteor. */
  function makeRock() {
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU; const k = 0.78 + Math.random() * 0.3; pts.push([Math.cos(a) * k, Math.sin(a) * k]); }
    const craters = [[0.3, -0.2, 0.2], [-0.35, 0.22, 0.15], [0.05, 0.4, 0.11]].map(([x, y, r]) => [x + (Math.random() - 0.5) * 0.1, y + (Math.random() - 0.5) * 0.1, r]);
    return { pts, craters, cracks: [] };
  }
  function makeCracks() {
    const cracks = [];
    for (let c = 0; c < 3; c++) {
      const a = Math.random() * TAU, pts = [[0, 0]];
      for (let i = 1; i <= 3; i++) { const d = i / 3; pts.push([Math.cos(a + (Math.random() - 0.5) * 0.9) * d, Math.sin(a + (Math.random() - 0.5) * 0.9) * d]); }
      cracks.push(pts);
    }
    return cracks;
  }

  function spawnMeteor(entry) {
    const { w } = S.view;
    // choose the lane farthest from the other meteors
    let fx = 0.5, bestD = -1;
    for (let i = 0; i < 6; i++) {
      const cand = 0.12 + Math.random() * 0.76;
      const d = S.meteors.reduce((min, m) => Math.min(min, Math.abs(m.fx - cand)), 1);
      if (d > bestD) { bestD = d; fx = cand; }
    }
    const m = {
      id: ++S.uid, entry,
      fx, fy: -0.08,                                   // fractions of the play area (0 = top, 1 = impact line)
      vx: (Math.random() - 0.5) * 0.02,                // slight horizontal drift (fraction / s)
      vy: (1 / fallSeconds(S.wave)) * (0.88 + Math.random() * 0.24),
      speedMult: 1,
      r: (w < 480 ? 15 : 18) + Math.random() * 5,
      rot: Math.random() * TAU, rotV: (Math.random() - 0.5) * 1.2,
      rock: makeRock(),
      cracked: false, crackAt: -1, revealUntil: 0, revealText: '',
      recorded: false,
    };
    S.meteors.push(m);
    S.spawned++;
    S.waveUsed.push(entry.id);
    S.lastEntryId = entry.id;
    if (S.spawned > S.waveTotal) S.waveTotal = S.spawned; // extra (debug) meteors still count toward the wave
    return m;
  }

  /* ------------------------------------------------------------
     Answers
     ------------------------------------------------------------ */
  function submitAnswer(raw) {
    if (!S || !D || S.mode !== 'play') return { status: 'ignored' };
    const text = raw == null ? D.input.value : String(raw);
    if (!Text.normalize(text)) { Sound.play('tick'); focusInput(); return { status: 'empty' }; }        // nothing typed: no red shake
    if (!S.meteors.length) { D.input.value = ''; Sound.play('tick'); focusInput(); return { status: 'nothing' }; } // empty sky: not a miss
    S.attempts++;
    kickFire();
    // Lowest meteor first: the one closest to the city is the natural target.
    const falling = S.meteors.slice().sort((a, b) => b.fy - a.fy);
    let hit = null, crack = null;
    for (const m of falling) {
      const r = Text.check(text, m.entry.answers, m.entry.answers[0]);
      if (r.status === 'correct') { hit = m; break; }
      if (r.status === 'accent' && !crack) crack = { m, expected: r.expected };
    }
    let result;
    if (hit) { destroyMeteor(hit); result = { status: 'correct', entryId: hit.entry.id, meteorId: hit.id }; }
    else if (crack) { crackMeteor(crack.m, crack.expected); result = { status: 'accent', entryId: crack.m.entry.id, meteorId: crack.m.id }; }
    else { missTyped(); result = { status: 'wrong' }; }
    D.input.value = '';
    focusInput();
    return result;
  }

  function meteorPos(m) { return { x: m.fx * S.view.w, y: m.fy * (S.view.h - GROUND) }; }

  function destroyMeteor(m) {
    const i = S.meteors.indexOf(m);
    if (i >= 0) S.meteors.splice(i, 1);
    const { x, y } = meteorPos(m);
    fireLaser(x, y);
    burst(x, y, 28, [C.amber, C.rose, C.white, C.mint], 190);
    ring(x, y, m.cracked ? C.amber : C.rose);
    S.combo++;
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    const heightBonus = Math.round(HEIGHT_BONUS * clamp(1 - m.fy, 0, 1));
    let pts = (BASE_POINTS + heightBonus) * S.wave;
    if (m.cracked) pts = Math.round(pts / 2);              // it was already given away
    pts = Math.round(pts * (1 + Math.floor(S.combo / COMBO_STEP) * 0.25));
    S.score += pts;
    S.hits++;
    floatText(x, y - m.r, '+' + pts, m.cracked ? C.amber : C.white);
    if (!m.recorded) {
      m.recorded = true;
      const rec = Progress.record(m.entry.id, 'correct');
      if (rec.levelUp) later(() => { Sound.play('levelup'); UI.toast('Level ' + rec.level + ' reached', 'ok'); }, 350);
    }
    Progress.noteStreak(S.combo);
    Sound.play('shoot');
    later(() => Sound.play('explode'), 70);
    flashInput('is-correct');
  }

  function crackMeteor(m, expected) {
    const { x, y } = meteorPos(m);
    if (!m.cracked) { m.cracked = true; m.speedMult = 0.5; m.rock.cracks = makeCracks(); }
    m.crackAt = S.t;                // every slip re-triggers the crack flash
    m.revealUntil = S.t + REVEAL;
    m.revealText = expected;
    burst(x, y, 10, [C.amber, C.amber2], 110);
    S.accents++;
    if (!m.recorded) { m.recorded = true; Progress.record(m.entry.id, 'accent'); }
    Sound.play('accent');
    flashInput('is-accent');
    floatText(x, y - m.r, 'accents', C.amber);
  }

  function missTyped() {
    S.wrongs++;
    S.combo = Math.max(0, S.combo - WRONG_COMBO_PENALTY);
    Sound.play('wrong');
    flashInput('is-wrong');
  }

  function cityHit(m) {
    const { w, h: hh } = S.view;
    const x = m.fx * w, y = hh - GROUND;
    burst(x, y, 36, [C.rose, C.amber, C.white], 230);
    ring(x, y, C.rose);
    S.flash = 1;
    S.shake = 1;
    damageCity(m.fx);
    if (!m.recorded) { m.recorded = true; Progress.record(m.entry.id, 'wrong'); }
    S.combo = 0;
    S.missed.push(m.entry);
    S.waveMissed.push(m.entry);
    S.hudMsg = { key: m.id, en: m.entry.en, es: m.entry.answers[0], base: m.entry.base, until: S.t + HUD_MSG };
    Speech.say(m.entry.base);
    Sound.play('hurt');
    later(() => Sound.play('explode'), 60);
    D.stage.classList.add('is-hit');
    later(() => D.stage.classList.remove('is-hit'), 520);
    S.lives--;
    const heart = D.hud.hearts[S.lives];
    if (heart) { heart.classList.add('is-lost'); later(() => heart.classList.remove('is-lost'), 700); }
    if (S.lives <= 0) endRun();
  }

  function damageCity(fx) {
    const b = S.scene.buildings.reduce((best, bb) => {
      const d = Math.abs(bb.fx + bb.fw / 2 - fx);
      return !best || d < best.d ? { d, b: bb } : best;
    }, null);
    if (b && b.b.hp > 0) b.b.hp--;
  }

  function endRun() {
    S.mode = 'ending';
    S.endAt = S.t + ENDING;
    clearBanner();
    Sound.play('lose');
  }

  function saveBest() {
    if (S.saved) return;
    S.saved = true;
    S.isNewBest = Progress.setBest(ID, S.score, null, { wave: S.wave });   // the wave belongs to the best run only
    D.best.textContent = bestLabel();
  }

  function gameOver() {
    S.mode = 'over';
    saveBest();
    S.hudMsg = null;
    showOverlay(overPanel(), 'g-blaster-overlay-over');
    focusLater('button.btn-primary');
    if (S.isNewBest && S.score > 0) { later(() => { UI.confetti({ count: 140 }); Sound.play('win'); }, 250); }
  }

  /* ------------------------------------------------------------
     Pause
     ------------------------------------------------------------ */
  function togglePause() { if (S.mode === 'play') pause(); else if (S.mode === 'pause') resume(); }
  function pause() {
    if (S.mode !== 'play') return;
    S.mode = 'pause';
    showOverlay(pausePanel(), 'g-blaster-overlay-pause');
    Sound.play('click');
    focusLater('button.btn-primary');
  }
  function resume() {
    if (S.mode !== 'pause') return;
    S.mode = 'play';
    hideOverlay();
    Sound.play('click');
    focusInput();
    revealConsole();
  }

  /* ------------------------------------------------------------
     Simulation
     ------------------------------------------------------------ */
  function updatePlay(dt) {
    if (S.phase === 'banner') {
      if (S.banner && S.t >= S.banner.until) {
        const after = S.banner.after;
        clearBanner();
        S.phase = 'wave';
        if (after) after();
      }
    } else if (S.phase === 'wave') {
      trySpawn(dt);
    }
    updateMeteors(dt, false);
    if (S.mode === 'play' && S.phase === 'wave' && S.spawned >= S.waveTotal && !S.meteors.length) waveCleared();
  }

  function updateMeteors(dt, harmless) {
    const PH = S.view.h - GROUND;
    for (let i = S.meteors.length - 1; i >= 0; i--) {
      const m = S.meteors[i];
      if (!S.frozen) {
        m.fy += m.vy * m.speedMult * dt;
        m.fx += m.vx * dt;
        if (m.fx < 0.08 || m.fx > 0.92) { m.vx = -m.vx; m.fx = clamp(m.fx, 0.08, 0.92); }
        m.rot += m.rotV * dt;
      }
      // embers trailing off the rock
      if (Math.random() < dt * 10) {
        const x = m.fx * S.view.w, y = m.fy * PH;
        S.particles.push({ x: x + (Math.random() - 0.5) * m.r, y: y - m.r * 0.5, vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 40, g: -10, r: 1 + Math.random() * 1.6, c: m.cracked ? C.amber : C.amber2, t: 0, max: 0.35 + Math.random() * 0.3 });
      }
      if (m.fy >= 1) {
        S.meteors.splice(i, 1);
        if (harmless || S.mode !== 'play') burst(m.fx * S.view.w, PH, 14, [C.rose, C.amber], 120);
        else cityHit(m);
      }
    }
  }

  function updateTurret(dt) {
    const T = S.turret;
    const { w, h: hh } = S.view;
    let target = null;
    S.meteors.forEach((m) => { if (!target || m.fy > target.fy) target = m; });
    let desired;
    if (target && (S.mode === 'play' || S.mode === 'ending')) {
      const { x, y } = meteorPos(target);
      desired = Math.atan2(y - (hh - GROUND), x - w / 2);
    } else {
      desired = -Math.PI / 2 + Math.sin(S.anim * 0.7) * 0.45; // idle sweep
    }
    // keep the barrel above the horizon
    desired = clamp(desired, -Math.PI + 0.25, -0.25);
    T.angle += (desired - T.angle) * Math.min(1, dt * 9);
    T.recoil = Math.max(0, T.recoil - dt * 5);
  }

  function updateFx(dt) {
    const step = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt; if (arr[i].t >= arr[i].max) arr.splice(i, 1); } };
    step(S.lasers); step(S.rings); step(S.floats);
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.t += dt;
      if (p.t >= p.max) { S.particles.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= 0.985;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    S.flash = Math.max(0, S.flash - dt * 2.2);
    S.shake = Math.max(0, S.shake - dt * 2.8);
  }

  function burst(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = speed * (0.3 + Math.random());
      S.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, g: 260, r: 1.5 + Math.random() * 3, c: colors[i % colors.length], t: 0, max: 0.5 + Math.random() * 0.5 });
    }
    if (S.particles.length > 320) S.particles.splice(0, S.particles.length - 320);
  }
  function ring(x, y, c) { S.rings.push({ x, y, c, t: 0, max: 0.45 }); }
  function floatText(x, y, text, c) { S.floats.push({ x, y, text, c, t: 0, max: 0.9 }); }
  function fireLaser(x, y) {
    const { w, h: hh } = S.view;
    const T = S.turret;
    T.angle = Math.atan2(y - (hh - GROUND), x - w / 2);
    T.recoil = 1;
    const ox = w / 2 + Math.cos(T.angle) * 28, oy = hh - GROUND + 10 + Math.sin(T.angle) * 28;
    S.lasers.push({ x1: ox, y1: oy, x2: x, y2: y, t: 0, max: 0.22 });
  }

  /* ------------------------------------------------------------
     Frame loop + canvas sizing
     ------------------------------------------------------------ */
  function resizeCanvas() {
    if (!S || !D) return;
    const w = Math.max(240, Math.round(D.stage.clientWidth));
    const vh = window.innerHeight || 900;
    let hh = w < 640
      ? Math.round(Math.min(360, Math.max(300, w * 1.05)))
      : Math.round(clamp(Math.min(w * 0.42, vh - 420), 280, 460)); // 460 on roomy windows, ~380 at 800px tall, 300 at 720
    if (vh < 480 && navigator.maxTouchPoints > 0) hh = Math.max(180, Math.min(hh, vh - 250));  // landscape phone: keep the sky in sight
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (D.canvas.width !== Math.round(w * dpr) || D.canvas.height !== Math.round(hh * dpr)) {
      D.canvas.width = Math.round(w * dpr);
      D.canvas.height = Math.round(hh * dpr);
    }
    D.canvas.style.height = hh + 'px';
    D.stage.style.height = hh + 'px';
    S.view = { w, h: hh, dpr, cw: w };
    S.bg = null; // the sky is cached per size
    D.input.placeholder = w < 480 ? 'Type the Spanish…' : 'Type the Spanish… then Enter';
  }

  function frame(now) {
    if (!S || !D) return;
    rafId = requestAnimationFrame(frame);
    if (D.stage.clientWidth !== S.view.cw) resizeCanvas();
    const dt = S.lastT ? Math.min(MAX_DT, (now - S.lastT) / 1000) : 0;
    S.lastT = now;
    if (S.mode !== 'pause') {
      S.anim += dt;
      updateFx(dt);
      updateTurret(dt);
    }
    if (S.mode === 'play') { S.t += dt; updatePlay(dt); }
    else if (S.mode === 'ending') { S.t += dt; updateMeteors(dt, true); if (S.t >= S.endAt) gameOver(); }
    updateHud(false);
    render();
  }

  function updateHud(force) {
    const c = S.hudCache;
    const set = (k, v, fn) => { if (force || c[k] !== v) { c[k] = v; fn(v); } };
    set('mode', S.mode, (v) => { D.shell.classList.toggle('is-playing', v === 'play'); D.shell.dataset.mode = v; });
    set('score', S.score, (v) => { D.hud.score.textContent = fmt(v); });
    set('wave', Math.max(1, S.wave), (v) => { D.hud.wave.textContent = String(v); });
    set('lives', S.lives, (v) => D.hud.hearts.forEach((el, i) => el.classList.toggle('is-off', i >= v)));
    set('combo', S.combo, (v) => { D.hud.combo.textContent = v >= 3 ? '🔥 ' + v : String(v); D.hud.comboItem.classList.toggle('is-hot', v >= 3); });
    const msgOn = S.hudMsg && S.t < S.hudMsg.until && (S.mode === 'play' || S.mode === 'ending');
    set('msg', msgOn ? S.hudMsg.key : 0, (v) => {
      if (!v) { D.hud.msg.classList.remove('is-on'); return; }
      D.hud.msgEn.textContent = S.hudMsg.en;
      D.hud.msgEs.innerHTML = Text.highlightAccents(S.hudMsg.es);
      D.hud.msg.classList.remove('is-on');
      void D.hud.msg.offsetWidth;
      D.hud.msg.classList.add('is-on');
    });
  }

  /* ------------------------------------------------------------
     Rendering — everything is drawn with canvas primitives
     ------------------------------------------------------------ */
  function skyCache() {
    const { w, h: hh, dpr } = S.view;
    if (S.bg && S.bg.w === w && S.bg.h === hh) return S.bg.c;
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr);
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, '#04061a'); g.addColorStop(0.6, '#0c1130'); g.addColorStop(1, '#1b1240');
    x.fillStyle = g; x.fillRect(0, 0, w, hh);
    const nebula = (fx, fy, fr, col, a) => {
      const r = x.createRadialGradient(fx * w, fy * hh, 0, fx * w, fy * hh, fr * w);
      r.addColorStop(0, rgba(col, a)); r.addColorStop(1, rgba(col, 0));
      x.fillStyle = r; x.fillRect(0, 0, w, hh);
    };
    nebula(0.18, 0.08, 0.5, C.lav2, 0.28);
    nebula(0.88, 0.42, 0.42, C.rose2, 0.18);
    nebula(0.5, 0.95, 0.5, C.mint2, 0.12);
    // moon
    const mx = w * 0.84, my = hh * 0.2;
    x.shadowColor = 'rgba(255,255,255,0.55)'; x.shadowBlur = 30;
    x.fillStyle = '#e9ecff'; x.beginPath(); x.arc(mx, my, 16, 0, TAU); x.fill();
    x.shadowBlur = 0;
    x.fillStyle = 'rgba(0,0,0,0.08)';
    [[-5, -3, 4], [4, 5, 3], [6, -6, 2.5]].forEach(([a, b, r]) => { x.beginPath(); x.arc(mx + a, my + b, r, 0, TAU); x.fill(); });
    S.bg = { w, h: hh, c };
    return c;
  }

  function drawStars(ctx) {
    const { w, h: hh } = S.view;
    S.scene.stars.forEach((s) => {
      ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(S.anim * s.k + s.p));
      ctx.fillStyle = s.c;
      ctx.fillRect(s.fx * w - s.s / 2, s.fy * hh - s.s / 2, s.s, s.s);
    });
    ctx.globalAlpha = 1;
  }

  function drawCity(ctx) {
    const { w, h: hh } = S.view;
    const gy = hh - GROUND + 10; // ground top
    const hg = ctx.createLinearGradient(0, gy - 80, 0, gy);
    hg.addColorStop(0, 'rgba(255,92,122,0)'); hg.addColorStop(1, 'rgba(255,92,122,0.12)');
    ctx.fillStyle = hg; ctx.fillRect(0, gy - 80, w, 80);
    S.scene.buildings.forEach((b) => {
      const bx = b.fx * w, bw = Math.max(6, b.fw * w);
      const bh = (18 + b.fh * 58) * (b.hp <= 0 ? 0.5 : 1), by = gy - bh;
      ctx.fillStyle = b.hp <= 0 ? '#1a0f1c' : b.hp === 1 ? '#120f28' : '#0e1330';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(bx, by, bw, 2);
      if (b.antenna && b.hp > 0) {
        ctx.fillStyle = '#2a3160'; ctx.fillRect(bx + bw / 2 - 1, by - 10, 2, 10);
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(S.anim * 3 + b.fx * 10);
        ctx.fillStyle = C.rose; ctx.fillRect(bx + bw / 2 - 1.5, by - 12, 3, 3);
        ctx.globalAlpha = 1;
      }
      if (b.hp > 0) {
        const cols = b.cols, rows = Math.floor((bh - 6) / 9), cw = (bw - 4) / cols;
        for (let r = 0; r < rows; r++) {
          for (let cc = 0; cc < cols; cc++) {
            if (!b.windows[(r * cols + cc) % b.windows.length]) continue;
            if (b.hp === 1 && (r + cc) % 2) continue; // half the lights are out
            ctx.fillStyle = (r + cc) % 5 === 0 ? 'rgba(56,217,196,0.7)' : 'rgba(246,196,83,0.75)';
            ctx.fillRect(bx + 3 + cc * cw, by + 5 + r * 9, Math.max(2, cw - 2), 5);
          }
        }
      } else {
        ctx.fillStyle = 'rgba(255,92,122,' + (0.12 + 0.08 * Math.sin(S.anim * 4 + b.fx * 20)) + ')';
        ctx.fillRect(bx, by, bw, bh);
      }
    });
    const gg = ctx.createLinearGradient(0, gy, 0, hh);
    gg.addColorStop(0, '#1b2250'); gg.addColorStop(1, '#070a14');
    ctx.fillStyle = gg; ctx.fillRect(0, gy, w, hh - gy);
    ctx.fillStyle = 'rgba(56,217,196,0.55)'; ctx.fillRect(0, gy, w, 1.5);
  }

  function drawTurret(ctx) {
    const { w, h: hh } = S.view;
    const tx = w / 2, ty = hh - GROUND + 10;
    const T = S.turret;
    roundRect(ctx, tx - 30, ty - 8, 60, 14, 6);
    ctx.fillStyle = '#1c2452'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.save();
    ctx.translate(tx, ty - 10);
    ctx.rotate(T.angle);
    const len = 28 - T.recoil * 8;
    roundRect(ctx, 0, -4, len, 8, 3);
    ctx.fillStyle = '#2b3570'; ctx.fill();
    ctx.strokeStyle = 'rgba(56,217,196,0.5)'; ctx.stroke();
    ctx.fillStyle = C.mint; ctx.fillRect(len - 6, -2.5, 5, 5);
    if (T.recoil > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(len, 0, 0, len, 0, 18);
      g.addColorStop(0, rgba(C.mint, 0.9 * T.recoil)); g.addColorStop(1, rgba(C.mint, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(len, 0, 18, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    const dg = ctx.createRadialGradient(tx - 5, ty - 16, 2, tx, ty - 10, 18);
    dg.addColorStop(0, '#3a467f'); dg.addColorStop(1, '#141a3d');
    ctx.beginPath(); ctx.arc(tx, ty - 8, 16, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = dg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
    ctx.fillStyle = C.rose; ctx.shadowColor = C.rose; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(tx, ty - 15, 3, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawMeteor(ctx, m) {
    const { w, h: hh } = S.view;
    const PH = hh - GROUND;
    const x = m.fx * w, y = m.fy * PH, r = m.r;
    const vxp = m.vx * w, vyp = m.vy * m.speedMult * PH;
    const len = Math.hypot(vxp, vyp) || 1;
    const ux = -vxp / len, uy = -vyp / len; // tail direction (opposite of travel)
    ctx.save();
    ctx.translate(x, y);
    // tail
    const tail = r * (m.cracked ? 2.2 : 3.6);
    const tg = ctx.createLinearGradient(0, 0, ux * tail, uy * tail);
    tg.addColorStop(0, rgba(m.cracked ? C.amber : C.amber2, 0.6));
    tg.addColorStop(0.5, rgba(C.rose, 0.22));
    tg.addColorStop(1, rgba(C.rose, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(-uy * r * 0.8, ux * r * 0.8);
    ctx.lineTo(ux * tail, uy * tail);
    ctx.lineTo(uy * r * 0.8, -ux * r * 0.8);
    ctx.closePath();
    ctx.fillStyle = tg; ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // rock
    ctx.shadowColor = m.cracked ? C.amber : C.rose;
    ctx.shadowBlur = 16 + 6 * Math.sin(S.anim * 6 + m.id);
    const ck = m.cracked ? clamp(1 - (S.t - m.crackAt) / 0.45, 0, 1) : 0; // crack flash: 1 right after the slip → 0
    ctx.save();
    ctx.rotate(m.rot);
    if (ck > 0 && !REDUCED) { const sc = 1 + 0.3 * Math.sin(ck * Math.PI); ctx.scale(sc, sc); }
    ctx.beginPath();
    m.rock.pts.forEach(([a, b], i) => { if (i) ctx.lineTo(a * r, b * r); else ctx.moveTo(a * r, b * r); });
    ctx.closePath();
    const rg = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    rg.addColorStop(0, '#ffd27a'); rg.addColorStop(0.45, '#c2552f'); rg.addColorStop(1, '#3a1420');
    ctx.fillStyle = rg; ctx.fill();
    if (ck > 0) { ctx.shadowBlur = 30 * ck; ctx.fillStyle = rgba(C.white, 0.8 * ck); ctx.fill(); }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,170,120,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    m.rock.craters.forEach(([cx, cy, cr]) => { ctx.beginPath(); ctx.arc(cx * r, cy * r, cr * r, 0, TAU); ctx.fill(); });
    if (m.cracked) {
      ctx.strokeStyle = 'rgba(255,232,170,0.95)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      m.rock.cracks.forEach((pts) => { ctx.beginPath(); pts.forEach(([a, b], i) => { if (i) ctx.lineTo(a * r, b * r); else ctx.moveTo(a * r, b * r); }); ctx.stroke(); });
    }
    ctx.restore();
    ctx.restore();
    drawLabel(ctx, m, x, y);
  }

  /** The English shown on a meteor. Narrow canvases drop parenthetical notes so two pills can still sit side by side. */
  function labelFor(entry) {
    if (!S || S.view.w >= 480) return entry.en;
    const short = entry.en.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    return short || entry.en;
  }

  /** The English meaning (and, after an accent slip, the correct spelling) on a glass pill under the rock. */
  function drawLabel(ctx, m, x, y) {
    const { w, h: hh } = S.view;
    const fs = w < 480 ? 13 : 14;
    const icon = CAT_ICON[m.entry.cat] || '';
    const label = labelFor(m.entry);
    const padX = 10, iconW = icon ? 22 : 0;
    ctx.font = '700 ' + fs + 'px ' + FONT;
    const tw = ctx.measureText(label).width;
    let pw = tw + padX * 2 + iconW;
    let ph = fs + 14;
    const reveal = m.cracked && S.t < m.revealUntil ? m.revealText : null;
    const revealK = reveal ? clamp((m.revealUntil - S.t) / 0.4, 0, 1) : 0; // fade-out near the end
    if (reveal) {
      ctx.font = '800 ' + (fs + 2) + 'px ' + FONT;
      pw = Math.max(pw, ctx.measureText(reveal).width + padX * 2);
      ph += fs + 8;
    }
    const lx = clamp(x, pw / 2 + 4, w - pw / 2 - 4);
    let ly = y + m.r + 8;
    if (ly + ph > hh - 4) ly = y - m.r - 8 - ph; // near the ground: label above the rock
    roundRect(ctx, lx - pw / 2, ly, pw, ph, 10);
    ctx.fillStyle = 'rgba(7,10,20,0.84)'; ctx.fill();
    ctx.strokeStyle = m.cracked ? rgba(C.amber, 0.45 + 0.35 * revealK) : 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let tx = lx - pw / 2 + padX;
    const ty = ly + 7 + fs / 2;
    if (icon) { ctx.font = (fs - 1) + 'px ' + FONT; ctx.fillStyle = '#fff'; ctx.fillText(icon, tx, ty + 1); tx += iconW; }
    ctx.font = '700 ' + fs + 'px ' + FONT;
    ctx.fillStyle = '#eef1ff';
    ctx.fillText(label, tx, ty);
    if (reveal) {
      const age = S.t - m.crackAt;
      const pop = REDUCED ? 1 : Math.min(1, age / 0.18);                 // quick pop-in
      ctx.save();
      ctx.globalAlpha = revealK * pop;
      ctx.translate(lx, ty + fs + 8);
      ctx.scale(0.7 + 0.3 * pop, 0.7 + 0.3 * pop);
      ctx.font = '800 ' + (fs + 2) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillStyle = C.amber;
      ctx.shadowColor = C.amber; ctx.shadowBlur = 10 + 6 * Math.sin(S.anim * 7); // breathing glow
      ctx.fillText(reveal, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawFx(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    S.lasers.forEach((l) => {
      const k = 1 - l.t / l.max;
      ctx.strokeStyle = rgba(C.mint, 0.55 * k); ctx.lineWidth = 7 * k;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.strokeStyle = rgba(C.white, 0.95 * k); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
    });
    S.rings.forEach((rg) => {
      const k = rg.t / rg.max;
      ctx.strokeStyle = rgba(rg.c, 0.8 * (1 - k)); ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(rg.x, rg.y, 8 + k * 70, 0, TAU); ctx.stroke();
    });
    S.particles.forEach((p) => {
      const k = 1 - p.t / p.max;
      ctx.fillStyle = rgba(p.c, k);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill();
    });
    ctx.restore();
    S.floats.forEach((f) => {
      const k = f.t / f.max;
      ctx.globalAlpha = 1 - k;
      ctx.font = '800 18px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6;
      ctx.fillStyle = f.c; ctx.fillText(f.text, f.x, f.y - 44 * k);
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function render() {
    const ctx = D.ctx;
    const { w, h: hh, dpr } = S.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    ctx.drawImage(skyCache(), 0, 0, w, hh);
    drawStars(ctx);
    if (S.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 10 * S.shake, (Math.random() - 0.5) * 10 * S.shake);
    drawCity(ctx);
    S.meteors.slice().sort((a, b) => a.fy - b.fy).forEach((m) => drawMeteor(ctx, m)); // lowest meteor drawn last: its label stays on top
    drawTurret(ctx);
    drawFx(ctx);
    if (S.flash > 0) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,92,122,' + (0.5 * S.flash) + ')'; ctx.fillRect(0, 0, w, hh);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.25 * S.flash) + ')'; ctx.fillRect(0, 0, w, hh);
    }
  }

  /* ------------------------------------------------------------
     Global listeners
     ------------------------------------------------------------ */
  function onKeyDown(e) {
    if (!S || !D) return;
    const ae = document.activeElement;
    const inOurInput = ae === D.input;
    const inOtherField = !inOurInput && ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (inOtherField) return;
    // Esc pauses / resumes even while typing.
    if (e.key === 'Escape') {
      if (S.mode === 'play' || S.mode === 'pause') { e.preventDefault(); togglePause(); }
      return;
    }
    if (inOurInput) return; // every other key types into the input (Enter is handled there)
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A');
    if ((e.key === 'p' || e.key === 'P') && (S.mode === 'play' || S.mode === 'pause')) { e.preventDefault(); togglePause(); return; }
    if (S.mode === 'play' && e.key.length === 1 && e.key !== ' ') { focusInput(); return; } // the keystroke lands in the input
    if ((S.mode === 'intro' || S.mode === 'over') && e.key === 'Enter' && !onControl) { e.preventDefault(); startGame(); }
  }
  function onVisibility() { if (document.hidden && S && S.mode === 'play') pause(); }
  function onResize() { resizeCanvas(); }

  /* ------------------------------------------------------------
     Mount / unmount + registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Word Rain',
    tagline: 'Type the Spanish before the words hit the ground.',
    icon: '☄️',
    accent: 'var(--c-rose)',
    order: 4,
    mount(root) {
      S = newState(null);
      D = buildDom(root);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize);
      resizeCanvas();
      updateHud(true);
      showOverlay(introPanel(), 'g-blaster-overlay-intro');
      focusLater('button.btn-primary');
      render();
      rafId = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(rafId); rafId = 0;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      clearTimers();
      // leaving mid-run counts as a play once the learner has actually fired or lost a life
      if (S && D && !S.saved && S.wave > 0 && (S.attempts > 0 || S.missed.length > 0)) saveBest();
      hideOverlay();
      if (D && D.shell) D.shell.remove();
      S = null; D = null;
    },
  });

  /* ------------------------------------------------------------
     Debug hooks for tests
     ------------------------------------------------------------ */
  const meteorInfo = (m) => ({ id: m.id, entryId: m.entry.id, en: m.entry.en, label: labelFor(m.entry), fy: Math.round(m.fy * 1000) / 1000, cracked: m.cracked, crackAge: m.cracked ? Math.round((S.t - m.crackAt) * 1000) / 1000 : null, reveal: S.t < m.revealUntil ? m.revealText : '', recorded: m.recorded });
  window.PQ.debug = window.PQ.debug || {};
  window.PQ.debug[ID] = {
    get state() { return S; },
    get dom() { return D; },
    get running() { return rafId !== 0; },
    start() { startGame(); },
    /** Spawn `entry` (object or id) now; null if it is already on screen. No entry → the next queued word. */
    spawn(entry) {
      if (!S || S.mode !== 'play') return null;
      if (typeof entry === 'string') entry = Vocab.byId(entry);
      if (entry && S.meteors.some((m) => m.entry.id === entry.id)) return null;
      const e = entry || nextEntry();
      return e ? meteorInfo(spawnMeteor(e)) : null;
    },
    listMeteors() { return S ? S.meteors.map(meteorInfo) : []; },
    submit(text) { return submitAnswer(text); },
    setLives(n) { if (S) { S.lives = clamp(n | 0, 0, LIVES); updateHud(false); } },
    freeze(on) { if (S) S.frozen = on !== false; },
    /** Make a meteor hit the city on the next frame. */
    drop(id) { const m = S && S.meteors.find((x) => x.id === id); if (m) m.fy = 1; return !!m; },
    pause() { if (S) pause(); },
    resume() { if (S) resume(); },
  };
})();
