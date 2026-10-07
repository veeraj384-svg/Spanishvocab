/* ============================================================
   PALABRA QUEST — Energy Run (platformer)
   A canvas side-scroller where ENERGY is the core mechanic:
   running drains it, answering spelling questions recharges it.
   Word gates block the path every ~900px and ask a question.
   Plain script, registers itself with PQ.Games.register(...).
   ============================================================ */
(function () {
  'use strict';
  const { Vocab, Progress, Quiz, QuizUI, UI, Sound, Rand } = window.PQ;

  const ID = 'platformer';

  /* ------------------------------------------------------------
     Tunables — world units are "logical pixels" at VIEW_H height;
     the canvas scales the world to fit its own size.
     ------------------------------------------------------------ */
  const VIEW_H = 420;            // logical world view height
  const VIEW_W_MIN = 520;        // never show less than this much world width
  const GROUND_Y = 350;          // top of the ground platforms
  const GROUND_H = 90;
  const FIXED_DT = 1 / 120;      // physics step
  const MAX_FRAME_DT = 0.05;     // clamp wall-clock dt (tab switches, hiccups)
  const GRAVITY = 1500;
  const MAX_FALL = 900;
  const RUN_SPEED = 240;
  const RUN_ACCEL = 2200;
  const AIR_ACCEL = 1400;
  const FRICTION = 2600;
  const JUMP_V = -600;           // jump height ≈ v²/2g = 120px
  const JUMP_CUT_V = -170;       // releasing the key early caps upward speed
  const COYOTE = 0.09;
  const JUMP_BUFFER = 0.12;
  const PLAYER_W = 30, PLAYER_H = 40;
  const ENERGY_MAX = 100;
  const ENERGY_DRAIN = 7;        // per second while moving
  const ENERGY_JUMP = 3;
  const ENERGY_ORB = 4;
  const ENERGY_LOW = 25;
  const ENERGY_REWARD = { correct: 60, accent: 30, wrong: 15 };
  const HEARTS = 3;
  const INVULN = 1.6;
  const DEATH_DELAY = 0.9;
  const GATE_W = 26;
  const START_X = 60;            // spawn x; distance is measured from here
  const ORB_LETTERS = ['á', 'é', 'í', 'ó', 'ú', 'ñ'];

  // Theme colors (mirrors css/styles.css tokens; canvas can't read CSS vars cheaply)
  const C = {
    bg0: '#070a14', bg1: '#0b1020', bg2: '#111733', bg3: '#182043',
    amber: '#f6c453', amber2: '#f28d35', mint: '#38d9c4', mint2: '#1fb8a6',
    lav: '#a78bfa', lav2: '#7c5cf0', rose: '#ff5c7a', rose2: '#e0335a',
    sky: '#60a5fa', lime: '#a3e635', text: '#eef1ff', text2: '#b7bdd9',
  };

  /* ------------------------------------------------------------
     Level generation — fully deterministic from the level number.
     Produces ground segments with pits between them, floating
     platforms, spikes, orbs, word gates and a finish flag.
     ------------------------------------------------------------ */
  function generateLevel(level) {
    const rng = Rand.seeded(level * 7919 + 13);
    const r = (a, b) => a + rng() * (b - a);
    const ri = (a, b) => Rand.int(a, b, rng);
    const L = { level, platforms: [], spikes: [], orbs: [], gates: [], flag: null, width: 0 };
    const length = 2400 + level * 650;              // where the flag section starts
    const maxGap = Math.min(180, 95 + level * 14);   // pits grow with the level (jump covers ~190)
    const gateEvery = 900;
    let x = 0;
    let orbIdx = 0;
    const orbAt = (ox, oy) => { L.orbs.push({ x: ox, y: oy, letter: ORB_LETTERS[orbIdx++ % ORB_LETTERS.length], taken: false, t: rng() * 6 }); };

    // Safe start pad (no hazards, a few orbs to teach pickups)
    L.platforms.push({ x: 0, y: GROUND_Y, w: 420, h: GROUND_H, ground: true });
    for (let i = 0; i < 3; i++) orbAt(230 + i * 44, GROUND_Y - 46);
    x = 420;

    let sinceFloat = 0;
    while (x < length) {
      // --- pit before this segment (never two pits in a row, never near the start) ---
      const gap = Math.round(r(80, maxGap));
      const pitStart = x;
      // orbs in an arc across the pit
      const n = 3;
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / (n + 1);
        orbAt(pitStart + gap * f, GROUND_Y - 60 - Math.sin(f * Math.PI) * 50);
      }
      x += gap;

      // --- ground segment ---
      const segW = ri(240, 440);
      const seg = { x, y: GROUND_Y, w: segW, h: GROUND_H, ground: true };
      L.platforms.push(seg);

      // spikes: not at the edges, size grows with level
      if (segW >= 300 && rng() < Math.min(0.8, 0.45 + level * 0.08)) {
        const sw = ri(32, Math.min(80, 32 + level * 10));
        const sx = x + ri(90, segW - 90 - sw);
        L.spikes.push({ x: sx, y: GROUND_Y - 22, w: sw, h: 22 });
        // a helper platform above the spikes so there is always a graceful route
        if (rng() < 0.5) L.platforms.push({ x: sx - 30, y: GROUND_Y - ri(95, 108), w: sw + 70, h: 18, ground: false });
      }
      // floating platform with orbs on it
      if (segW >= 260 && (rng() < 0.55 || sinceFloat >= 2)) {
        sinceFloat = 0;
        const pw = ri(90, 170);
        const px = x + ri(40, Math.max(41, segW - pw - 40));
        const py = GROUND_Y - ri(80, 108);   // jump apex is ~117px: keep every platform landable
        // avoid stacking on top of a spike helper platform
        const clash = L.platforms.some((p) => !p.ground && Math.abs(p.y - py) < 40 && px < p.x + p.w + 20 && px + pw > p.x - 20);
        if (!clash) {
          L.platforms.push({ x: px, y: py, w: pw, h: 18, ground: false });
          const cnt = Math.max(1, Math.floor(pw / 48));
          for (let i = 0; i < cnt; i++) orbAt(px + 24 + i * 44, py - 34);
        }
      } else sinceFloat++;
      // ground orbs: a small row somewhere on the segment
      if (rng() < 0.6) {
        const cnt = ri(2, 3);
        const ox = x + ri(60, Math.max(61, segW - 60 - cnt * 40));
        for (let i = 0; i < cnt; i++) orbAt(ox + i * 40, GROUND_Y - 44);
      }
      x += segW;
    }

    // --- finish section ---
    L.platforms.push({ x, y: GROUND_Y, w: 380, h: GROUND_H, ground: true });
    L.flag = { x: x + 260, y: GROUND_Y, reached: false, t: 0 };
    L.width = x + 380;

    // --- word gates every ~900px, always standing on ground, away from spikes/orbs ---
    const grounds = L.platforms.filter((p) => p.ground);
    const gateCount = Math.max(1, Math.floor((L.flag.x - 300) / gateEvery));
    for (let g = 1; g <= gateCount; g++) {
      const want = g * gateEvery + Math.round(r(-60, 60));
      if (want > L.flag.x - 250) break;
      // nearest ground segment that contains `want` (or the nearest one after it)
      let seg = grounds.find((p) => want >= p.x + 60 && want <= p.x + p.w - 60);
      if (!seg) seg = grounds.find((p) => p.x + 60 > want) || grounds[grounds.length - 2];
      const gx = Math.max(seg.x + 60, Math.min(seg.x + seg.w - 60 - GATE_W, want));
      L.gates.push({ x: gx, y: 0, w: GATE_W, h: GROUND_Y, open: false, cooldown: 0, burst: 0, glow: rng() * 6 });
      // clear hazards, floating platforms (and their orbs) that would sit inside the gate
      L.spikes = L.spikes.filter((s) => s.x + s.w < gx - 40 || s.x > gx + GATE_W + 40);
      const removed = L.platforms.filter((p) => !p.ground && p.x + p.w >= gx - 10 && p.x <= gx + GATE_W + 10);
      L.platforms = L.platforms.filter((p) => !removed.includes(p));
      L.orbs = L.orbs.filter((o) => (o.x < gx - 24 || o.x > gx + GATE_W + 24) && !removed.some((p) => o.x >= p.x && o.x <= p.x + p.w && o.y < p.y));
    }
    L.platforms.sort((a, b) => a.x - b.x);
    return L;
  }

  /* ------------------------------------------------------------
     State
     ------------------------------------------------------------ */
  let S = null;   // game state; null when unmounted
  let D = null;   // DOM refs; null when unmounted
  let rafId = 0;
  let carryRecent = [];                                   // last quizzed ids, kept across restarts / remounts
  const held = { left: false, right: false, jump: false }; // physical key state, independent of game mode

  function freshPlayer(x, y) {
    return { x, y, w: PLAYER_W, h: PLAYER_H, vx: 0, vy: 0, dir: 1, onGround: false, wasOnGround: false,
      coyote: 0, buffer: 0, jumpHeld: false, jumping: false, sx: 1, sy: 1, run: 0, blink: 0, invuln: 0, prevVy: 0 };
  }

  function newRun(level) {
    const L = generateLevel(level);
    const st = {
      mode: 'intro',             // intro | play | question | pause | dead | over | complete
      level: L,
      player: freshPlayer(START_X, GROUND_Y - PLAYER_H),
      checkpoint: { x: START_X, y: GROUND_Y - PLAYER_H },
      cam: { x: 0 },
      energy: ENERGY_MAX,
      hearts: HEARTS,
      orbs: 0, questionPts: 0, maxX: START_X,
      streak: 0, asked: 0, correct: 0,
      recent: carryRecent.slice(), // ids of the last few quizzed words (never repeat back-to-back, even across restarts)
      particles: [], banner: null, shake: 0, lowPulse: 0,
      deathTimer: 0, time: 0, best: Progress.best(ID), distBase: 0, stars: makeStars(),
      input: { left: false, right: false, jump: false },
      question: null,            // { ctl, modal, reason, gate }
      saved: false,
    };
    return st;
  }

  /* ------------------------------------------------------------
     DOM — shell, HUD, stage, overlays, touch controls
     ------------------------------------------------------------ */
  function heartsHtml(n) {
    let s = '';
    for (let i = 0; i < HEARTS; i++) s += '<span class="g-platformer-heart' + (i < n ? '' : ' is-off') + '">♥</span>';
    return s;
  }

  function buildDom(root) {
    const d = {};
    d.shell = UI.h('div.game-shell.g-platformer');
    // Top bar
    d.bestEl = UI.h('span.g-platformer-best', null, 'Best ' + Progress.best(ID));
    d.pauseBtn = UI.h('button.btn.btn-sm.btn-outline', { type: 'button', title: 'Pause (P)', onclick: () => { Sound.play('click'); togglePause(); } }, '⏸ Pause');
    d.shell.appendChild(UI.h('div.game-topbar', null,
      UI.h('div.game-title', null, UI.h('span.icon', null, '⚡'), UI.h('span', null, 'Energy Run', UI.h('span.g-platformer-tag', null, 'run · jump · spell to recharge'))),
      UI.h('div.row', null, d.bestEl, d.pauseBtn, UI.h('a.btn.btn-sm.btn-ghost', { href: '#/' }, '← Home'))));
    // HUD
    d.energyFill = UI.h('div.bar-fill', { style: { width: '100%' } });
    d.energyBar = UI.h('div.energy-bar.g-platformer-ebar', null, d.energyFill);
    d.energyVal = UI.h('span.val', null, '100');
    d.hearts = UI.h('span.g-platformer-hearts', { html: heartsHtml(HEARTS), 'aria-label': 'hearts' });
    d.heartEls = Array.prototype.slice.call(d.hearts.children);
    d.lastHearts = HEARTS;
    d.score = UI.h('span.val', null, '0');
    d.level = UI.h('span.val', null, '1');
    d.dist = UI.h('span.val', null, '0m');
    d.streak = UI.h('span.streak-flame.g-platformer-streak.is-hidden', null, '🔥 ', UI.h('b', null, '0'));
    d.streakVal = d.streak.querySelector('b');
    d.hud = UI.h('div.hud.g-platformer-hud', null,
      UI.h('div.hud-item.g-platformer-energy', null, UI.h('span.label', null, '⚡ Energy'), d.energyBar, d.energyVal),
      UI.h('div.hud-item', null, d.hearts),
      UI.h('div.hud-spacer'),
      UI.h('div.hud-item', null, UI.h('span.label', null, 'Score'), d.score),
      UI.h('div.hud-item', null, UI.h('span.label', null, 'Level'), d.level),
      UI.h('div.hud-item', null, UI.h('span.label', null, 'Dist'), d.dist),
      d.streak);
    d.shell.appendChild(d.hud);
    // Stage
    d.canvas = UI.h('canvas.g-platformer-canvas', { 'aria-label': 'Energy Run game', role: 'img' });
    d.stage = UI.h('div.game-stage.g-platformer-stage', null, d.canvas);
    d.shell.appendChild(d.stage);
    d.overlay = null;
    // Touch controls
    d.btnL = UI.h('button.touch-btn', { type: 'button', 'aria-label': 'Move left' }, '◀');
    d.btnR = UI.h('button.touch-btn', { type: 'button', 'aria-label': 'Move right' }, '▶');
    d.btnJ = UI.h('button.touch-btn.g-platformer-jump', { type: 'button', 'aria-label': 'Jump' }, '⤒');
    d.touch = UI.h('div.touch-controls.g-platformer-touch', null, UI.h('div.tc-group', null, d.btnL, d.btnR), UI.h('div.tc-group', null, d.btnJ));
    d.shell.appendChild(d.touch);
    d.shell.appendChild(UI.h('div.g-platformer-help.small.muted', { html: '<span class="kbd">←</span> <span class="kbd">→</span> run &nbsp;·&nbsp; <span class="kbd">Space</span> jump &nbsp;·&nbsp; <span class="kbd">P</span> pause &nbsp;·&nbsp; moving drains ⚡, spelling recharges it' }));
    root.appendChild(d.shell);
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0) d.shell.classList.add('g-platformer-is-touch');
    d.ctx2d = d.canvas.getContext('2d');
    return d;
  }

  function setText(el, v) { if (el.textContent !== v) el.textContent = v; }
  function updateHud() {
    if (!S || !D) return;
    const e = Math.max(0, Math.min(ENERGY_MAX, S.energy));
    const w = (e / ENERGY_MAX * 100).toFixed(1) + '%';
    if (D.energyFill.style.width !== w) D.energyFill.style.width = w;
    setText(D.energyVal, String(Math.round(e)));
    D.energyBar.classList.toggle('is-low', e < ENERGY_LOW);
    D.energyBar.setAttribute('aria-valuenow', String(Math.round(e)));
    if (D.lastHearts !== S.hearts) {           // only touch the hearts when they change, so CSS animations can run
      D.heartEls.forEach((el, i) => el.classList.toggle('is-off', i >= S.hearts));
      D.lastHearts = S.hearts;
    }
    setText(D.score, String(computeScore()));
    setText(D.level, String(S.level.level));
    setText(D.dist, distance() + 'm');
    D.streak.classList.toggle('is-hidden', !(S.streak > 1));
    setText(D.streakVal, String(S.streak));
  }
  function refreshBest() { if (S && D) setText(D.bestEl, 'Best ' + S.best); }

  /** Distance in metres from the spawn point, accumulated across levels of the same run. */
  function distance() { return Math.max(0, Math.floor((S.distBase + S.maxX - START_X) / 10)); }
  function computeScore() { return distance() + S.orbs * 25 + S.questionPts; }

  /* ---- Overlays (intro / pause / game over / level complete) ---- */
  function showOverlay(panel) {
    hideOverlay();
    D.overlay = UI.h('div.game-overlay.g-platformer-overlay', null, panel);
    D.stage.appendChild(D.overlay);
  }
  function hideOverlay() { if (D && D.overlay) { D.overlay.remove(); D.overlay = null; } }

  function introPanel() {
    const start = UI.h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); startPlay(); } }, '▶ Start');
    setTimeout(() => { try { start.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
    return UI.h('div.panel.g-platformer-intro', null,
      UI.h('div.eyebrow', null, 'Energy Run · Level ' + S.level.level),
      UI.h('h2', null, 'Run on ', UI.h('span.grad-text', null, 'word power')),
      UI.h('p.text-2', null, 'Running and jumping drain your ⚡ energy. When it hits zero you freeze — spell a word correctly to recharge. Glowing word gates block the road: answer to pass.'),
      UI.h('div.g-platformer-legend', null,
        UI.h('div', null, UI.h('b', null, '← → / A D'), ' run'),
        UI.h('div', null, UI.h('b', null, 'Space / ↑ / W'), ' jump (hold = higher)'),
        UI.h('div', null, UI.h('b', null, 'P / Esc'), ' pause'),
        UI.h('div', null, UI.h('b', null, 'á é í ó ú ñ'), ' orbs = points + a sip of energy')),
      UI.h('div.row', { style: { justifyContent: 'center', marginTop: '18px' } }, start));
  }

  function pausePanel() {
    return UI.h('div.panel', null,
      UI.h('div.eyebrow', null, 'Paused'),
      UI.h('h2', null, 'Catch your breath'),
      UI.h('p.text-2', null, 'Score ' + computeScore() + ' · ' + distance() + 'm · ⚡ ' + Math.round(S.energy)),
      UI.h('div.row', { style: { justifyContent: 'center' } },
        UI.h('button.btn.btn-primary', { type: 'button', onclick: () => { Sound.play('click'); togglePause(); } }, '▶ Resume'),
        UI.h('button.btn.btn-outline', { type: 'button', onclick: () => { Sound.play('click'); restartRun(1); } }, '↻ Restart'),
        UI.h('a.btn.btn-ghost', { href: '#/' }, 'Home')));
  }

  function statsGrid(extra) {
    const acc = S.asked ? Math.round(S.correct / S.asked * 100) + '%' : '—';
    return UI.h('div.stat-grid', null,
      UI.h('div.stat', null, UI.h('div.stat-val', null, distance() + 'm'), UI.h('div.stat-label', null, 'Distance')),
      UI.h('div.stat', null, UI.h('div.stat-val', null, String(S.asked)), UI.h('div.stat-label', null, 'Words')),
      UI.h('div.stat', null, UI.h('div.stat-val', null, acc), UI.h('div.stat-label', null, 'Accuracy')),
      UI.h('div.stat', null, UI.h('div.stat-val', null, String(extra.best)), UI.h('div.stat-label', null, 'Best')));
  }

  function gameOverPanel(isNew) {
    return UI.h('div.panel', null,
      UI.h('div.eyebrow', null, isNew ? '🏆 New best!' : 'Game over'),
      UI.h('h2', null, 'Out of hearts'),
      UI.h('div.big.grad-text', null, String(computeScore())),
      statsGrid({ best: S.best }),
      UI.h('div.row', { style: { justifyContent: 'center' } },
        UI.h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); restartRun(1); } }, '↻ Retry'),
        UI.h('a.btn.btn-outline.btn-lg', { href: '#/' }, 'Home')));
  }

  function completePanel() {
    return UI.h('div.panel', null,
      UI.h('div.eyebrow', null, 'Level ' + S.level.level + ' complete'),
      UI.h('h2', null, '¡Meta! 🏁'),
      UI.h('div.big.grad-text', null, String(computeScore())),
      statsGrid({ best: S.best }),
      UI.h('div.row', { style: { justifyContent: 'center' } },
        UI.h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: () => { Sound.play('click'); nextLevel(); } }, 'Next level →'),
        UI.h('a.btn.btn-outline.btn-lg', { href: '#/' }, 'Home')));
  }

  /* ------------------------------------------------------------
     Run flow
     ------------------------------------------------------------ */
  function startPlay() {
    if (!S || S.mode !== 'intro') return;
    hideOverlay();
    S.mode = 'play';
    banner('Level ' + S.level.level + ' — ¡Vamos!', 1.6);
    reapplyHeld();
  }

  function togglePause() {
    if (!S) return;
    if (S.mode === 'play') { S.mode = 'pause'; clearInput(); showOverlay(pausePanel()); }
    else if (S.mode === 'pause') { S.mode = 'play'; hideOverlay(); S.lastT = 0; reapplyHeld(); }
  }

  /** A run is over (restart / leaving): persist it once if the learner actually played. */
  function endRun() {
    if (!S || S.saved || S.mode === 'intro') return;
    if (S.maxX <= START_X && S.asked === 0) return;   // never moved, never answered: nothing to record
    saveBest();
  }

  function restartRun(level) {
    closeQuestion();
    hideOverlay();
    endRun();
    S = Object.assign(newRun(level), { lastT: 0 });
    resizeCanvas();
    updateHud();
    refreshBest();
    S.mode = 'play';
    banner('Level ' + level + ' — ¡Vamos!', 1.6);
    reapplyHeld();
  }

  function nextLevel() {
    if (!S || S.mode !== 'complete') return;
    const keep = { orbs: S.orbs, questionPts: S.questionPts, asked: S.asked, correct: S.correct, streak: S.streak, hearts: Math.min(HEARTS, S.hearts + 1), recent: S.recent, distBase: S.distBase + S.maxX - START_X, best: S.best };
    const lvl = S.level.level + 1;
    hideOverlay();
    S = Object.assign(newRun(lvl), keep, { lastT: 0 });
    resizeCanvas();
    updateHud();
    refreshBest();
    S.mode = 'play';
    banner('Level ' + lvl + ' — longer road, more gates', 2);
    reapplyHeld();
  }

  function saveBest() {
    if (!S || S.saved) return;
    S.saved = true;
    const score = computeScore();
    const isNew = Progress.setBest(ID, score, { lastLevel: S.level.level });
    S.best = Progress.best(ID);
    refreshBest();
    return isNew;
  }

  function gameOver() {
    S.mode = 'over';
    clearInput();
    const isNew = saveBest();
    Sound.play('lose');
    showOverlay(gameOverPanel(isNew));
  }

  function levelComplete() {
    S.mode = 'complete';
    clearInput();
    S.level.flag.reached = true;
    Sound.play('win');
    burst(S.level.flag.x, GROUND_Y - 60, 40, [C.amber, C.mint, C.lav, C.rose]);
    const r = D.stage.getBoundingClientRect();
    UI.confetti({ x: r.left + r.width / 2, y: r.top + r.height * 0.35, count: 140 });
    // The run continues on "Next level"; the score is persisted at game over or on unmount.
    S.best = Math.max(Progress.best(ID), computeScore());
    refreshBest();
    setTimeout(() => { if (S && S.mode === 'complete') showOverlay(completePanel()); }, 600);
  }

  /* ------------------------------------------------------------
     Questions — the only way to recharge energy / open a gate
     ------------------------------------------------------------ */
  function pickEntry() {
    const entry = Progress.pickOne({ pool: Vocab.active(), exclude: S.recent });
    S.recent.push(entry.id);
    if (S.recent.length > 3) S.recent.shift();
    carryRecent = S.recent.slice();
    return entry;
  }

  function openQuestion(reason, gate) {
    if (!S || S.question || S.mode === 'over' || S.mode === 'complete') return;
    S.mode = 'question';
    clearInput();
    const entry = pickEntry();
    const q = Quiz.any(entry, ['typed', 'typed', 'choice', 'accent']);
    const ctl = QuizUI.ask(q, {
      bonus: Math.min(20, S.streak * 4),
      onResult: (res) => applyAnswer(reason, gate, res),
    });
    const head = reason === 'gate'
      ? UI.h('div.g-platformer-qhead.is-gate', null, UI.h('span.g-platformer-qicon', null, '🔮'), UI.h('div', null, UI.h('b', null, 'Word gate'), UI.h('span', null, 'Spell it right to open the way')))
      : UI.h('div.g-platformer-qhead.is-energy', null, UI.h('span.g-platformer-qicon', null, '⚡'), UI.h('div', null, UI.h('b', null, 'Out of energy!'), UI.h('span', null, 'Answer to recharge and keep running')));
    const content = UI.h('div.g-platformer-q', null, head, ctl.el);
    const modal = UI.modal({ closable: false, content });
    S.question = { ctl, modal, reason, gate, entry };
    S.asked++;
  }

  function applyAnswer(reason, gate, res) {
    if (!S || !S.question) return;
    const status = res.status === 'correct' ? 'correct' : res.status === 'accent' ? 'accent' : 'wrong';
    const gain = ENERGY_REWARD[status];
    S.energy = Math.min(ENERGY_MAX, S.energy + gain);
    const p = S.player;
    if (status === 'correct') {
      S.correct++;
      S.streak++;
      Progress.noteStreak(S.streak);
      const mult = Math.min(4, S.streak);
      S.questionPts += 50 * mult;
      Sound.play('energy');
      burst(p.x + p.w / 2, p.y + p.h / 2, 26, [C.mint, C.lime, C.amber]);
      if (gate) {
        gate.open = true; gate.burst = 1;
        S.checkpoint = { x: gate.x + gate.w + 20, y: GROUND_Y - PLAYER_H };
        setTimeout(() => Sound.play('gate'), 150);
        burst(gate.x + gate.w / 2, GROUND_Y - 120, 50, [C.lav, C.mint, C.text]);
        banner('Gate open! +' + gain + ' ⚡ · +' + (50 * mult) + ' pts' + (mult > 1 ? ' (×' + mult + ')' : ''), 2);
      } else banner('Recharged +' + gain + ' ⚡', 1.6);
    } else {
      S.streak = 0;
      burst(p.x + p.w / 2, p.y + p.h / 2, 12, [C.amber2, C.text2]);
      if (gate) {
        gate.cooldown = 1.2;
        p.x = gate.x - p.w - 10; p.vx = 0;
        banner((status === 'accent' ? 'Almost — mind the accents. ' : 'Not this time. ') + 'Gate still locked, +' + gain + ' ⚡', 2.4);
      } else banner('+' + gain + ' ⚡ — keep going, you can do it', 2);
    }
    closeQuestion();
    S.mode = 'play';
    S.lastT = 0;
    updateHud();
    reapplyHeld();
  }

  function closeQuestion() {
    if (!S || !S.question) return;
    const q = S.question;
    S.question = null;
    try { q.ctl.destroy(); } catch (e) { /* ignore */ }
    try { q.modal.close(); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------
     Hazards — lose a heart, respawn at the last checkpoint
     ------------------------------------------------------------ */
  function die() {
    if (!S || S.mode !== 'play') return;
    const p = S.player;
    S.mode = 'dead';
    S.deathTimer = DEATH_DELAY;
    S.shake = 0.5;
    clearInput();
    Sound.play('hurt');
    burst(p.x + p.w / 2, Math.min(p.y + p.h / 2, GROUND_Y + 10), 30, [C.rose, C.amber, C.text]);
    S.hearts = Math.max(0, S.hearts - 1);
    updateHud();
  }

  function respawn() {
    const cp = S.checkpoint;
    S.player = freshPlayer(cp.x, cp.y);
    S.player.invuln = INVULN;
    S.energy = Math.max(S.energy, 25);
    S.cam.x = Math.max(0, cp.x - 200);
    S.mode = 'play';
    banner('Back to the checkpoint', 1.4);
    updateHud();
    reapplyHeld();
  }

  /* ------------------------------------------------------------
     Effects
     ------------------------------------------------------------ */
  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 220;
      S.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.5 + Math.random() * 0.6, max: 1, size: 2 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0], g: 500 });
    }
    if (S.particles.length > 400) S.particles.splice(0, S.particles.length - 400);
  }
  function dust(x, y, n, dir) {
    for (let i = 0; i < n; i++) S.particles.push({ x: x + (Math.random() - 0.5) * 16, y, vx: (Math.random() * 60 + 20) * (dir || (Math.random() < 0.5 ? -1 : 1)), vy: -Math.random() * 60, life: 0.3 + Math.random() * 0.25, max: 1, size: 2 + Math.random() * 3, c: 'rgba(238,241,255,0.7)', g: 200 });
  }
  function banner(text, secs) { S.banner = { text, t: secs, max: secs }; }

  /* ------------------------------------------------------------
     Input — keyboard (document) + on-screen touch buttons
     ------------------------------------------------------------ */
  function clearInput() {
    if (S) { S.input.left = S.input.right = S.input.jump = false; S.player.jumpHeld = false; S.player.buffer = 0; }
    for (const b of [D && D.btnL, D && D.btnR, D && D.btnJ]) if (b) b.classList.remove('is-down');
  }
  /** Keys / touch buttons that are still physically held when play resumes keep working without a re-press. */
  function reapplyHeld() {
    if (!S || S.mode !== 'play') return;
    for (const act of ['left', 'right']) {
      const btn = act === 'left' ? D && D.btnL : D && D.btnR;
      const touchDown = !!(btn && btn._active && btn._active.size);
      if (held[act] || touchDown) { press(act, true); if (touchDown) btn.classList.add('is-down'); }
    }
    const jumpTouch = !!(D && D.btnJ && D.btnJ._active && D.btnJ._active.size);
    if (held.jump || jumpTouch) { S.player.jumpHeld = true; if (jumpTouch) D.btnJ.classList.add('is-down'); } // held, but no new jump is buffered
  }

  function typingTarget() {
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable));
  }

  function keyAction(e) {
    switch (e.code || e.key) {
      case 'ArrowLeft': case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'Space': case 'ArrowUp': case 'KeyW': return 'jump';
      case 'KeyP': case 'Escape': return 'pause';
      default: return null;
    }
  }

  function onKeyDown(e) {
    if (!S || S.question || typingTarget() || document.querySelector('.modal-backdrop')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const act = keyAction(e);
    if (!act) return;
    e.preventDefault();                       // game keys never scroll the page, whatever the mode
    if (act !== 'pause' && !e.repeat) held[act] = true;
    if (act === 'pause') {
      if (S.mode === 'play' || S.mode === 'pause') togglePause();
      return;
    }
    if (e.repeat) return;
    switch (S.mode) {
      case 'intro': if (act === 'jump' || act === 'right') startPlay(); return;
      case 'pause': if (act === 'jump') togglePause(); return;
      case 'over': if (act === 'jump') restartRun(1); return;
      case 'complete': if (act === 'jump') nextLevel(); return;
      case 'play': press(act, true); return;
      default: return;
    }
  }
  function onKeyUp(e) {
    const act = keyAction(e);
    if (!act || act === 'pause') return;
    held[act] = false;
    if (S) press(act, false);
  }
  /** Shared by keyboard and touch. Jump presses are buffered so a slightly early press still jumps. */
  function press(act, down) {
    if (!S) return;
    if (act === 'left' || act === 'right') S.input[act] = down;
    else if (act === 'jump') {
      S.input.jump = down;
      S.player.jumpHeld = down;
      if (down) S.player.buffer = JUMP_BUFFER;
    }
  }

  function bindTouch(btn, act) {
    const active = new Set();
    btn._active = active;
    const down = (e) => {
      e.preventDefault();
      if (!S) return;
      active.add(e.pointerId);
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      btn.classList.add('is-down');
      if (S.mode === 'intro') startPlay();
      if (S.mode === 'play') press(act, true);
    };
    const up = (e) => {
      if (!active.has(e.pointerId)) return;
      active.delete(e.pointerId);
      if (active.size) return;
      btn.classList.remove('is-down');
      press(act, false);
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* ------------------------------------------------------------
     Physics — fixed timestep, AABB vs platforms (and closed gates)
     ------------------------------------------------------------ */
  function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  function solids() {
    // Closed gates act as walls so the player can never squeeze past without answering
    const list = S.level.platforms.slice();
    for (const g of S.level.gates) if (!g.open) list.push(g);
    return list;
  }

  function stepPhysics(dt) {
    const p = S.player, inp = S.input, L = S.level;
    const canMove = S.energy > 0;
    const move = canMove ? ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) : 0;

    // --- timers ---
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - dt);
    p.buffer = Math.max(0, p.buffer - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    for (const g of L.gates) g.cooldown = Math.max(0, g.cooldown - dt);

    // --- horizontal ---
    const accel = p.onGround ? RUN_ACCEL : AIR_ACCEL;
    if (move) {
      p.vx += move * accel * dt;
      p.vx = Math.max(-RUN_SPEED, Math.min(RUN_SPEED, p.vx));
      p.dir = move;
      p.run += dt * Math.abs(p.vx) / 28;
    } else {
      const f = (p.onGround ? FRICTION : FRICTION * 0.35) * dt;
      if (Math.abs(p.vx) <= f) p.vx = 0; else p.vx -= Math.sign(p.vx) * f;
    }

    // --- jump (coyote time + input buffer + variable height) ---
    if (p.buffer > 0 && p.coyote > 0 && canMove) {
      p.buffer = 0; p.coyote = 0;
      p.vy = JUMP_V; p.jumping = true; p.onGround = false;
      p.sx = 0.78; p.sy = 1.25;                     // stretch
      S.energy = Math.max(0, S.energy - ENERGY_JUMP);
      dust(p.x + p.w / 2, p.y + p.h, 6);
      Sound.play('jump');
    }
    if (p.jumping && !p.jumpHeld && p.vy < JUMP_CUT_V) p.vy = JUMP_CUT_V;
    if (p.vy >= 0) p.jumping = false;

    // --- gravity ---
    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);

    // --- move X and resolve ---
    const walls = solids();
    const x0 = p.x;
    p.x += p.vx * dt;
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    for (const s of walls) {
      if (!overlaps(p, s)) continue;
      if (p.vx > 0) p.x = s.x - p.w; else if (p.vx < 0) p.x = s.x + s.w; else p.x = (p.x + p.w / 2 < s.x + s.w / 2) ? s.x - p.w : s.x + s.w;
      p.vx = 0;
    }
    // energy drains only while the hero actually moves (not while pushing a wall or a locked gate)
    if (move && Math.abs(p.x - x0) > 0.01) S.energy = Math.max(0, S.energy - ENERGY_DRAIN * dt);
    // --- move Y and resolve ---
    p.wasOnGround = p.onGround;
    p.prevVy = p.vy;
    p.y += p.vy * dt;
    p.onGround = false;
    for (const s of walls) {
      if (!overlaps(p, s)) continue;
      if (p.vy > 0) { p.y = s.y - p.h; p.vy = 0; p.onGround = true; }
      else if (p.vy < 0) { p.y = s.y + s.h; p.vy = 0; p.jumping = false; }
    }
    if (p.onGround && !p.wasOnGround && p.prevVy > 250) {       // landing squash
      p.sx = 1.3; p.sy = 0.7;
      dust(p.x + p.w / 2, p.y + p.h, p.prevVy > 600 ? 10 : 5);
    }
    // squash / stretch relax
    p.sx += (1 - p.sx) * Math.min(1, dt * 14);
    p.sy += (1 - p.sy) * Math.min(1, dt * 14);
    p.blink = p.blink > 0 ? p.blink - dt : (Math.random() < dt * 0.4 ? 0.14 : 0);

    // --- progress / score ---
    if (p.x > S.maxX) S.maxX = p.x;

    // --- orbs ---
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (const o of L.orbs) {
      if (o.taken) continue;
      const dx = o.x - cx, dy = o.y - cy;
      if (dx * dx + dy * dy < 28 * 28) {
        o.taken = true; S.orbs++;
        S.energy = Math.min(ENERGY_MAX, S.energy + ENERGY_ORB);
        burst(o.x, o.y, 10, [C.amber, C.lime, C.text]);
        Sound.play('coin');
      }
    }
    // --- gates: touching a closed gate asks a question ---
    for (const g of L.gates) {
      if (g.open || g.cooldown > 0) continue;
      const zone = { x: g.x - 8, y: g.y, w: g.w + 16, h: g.h };
      if (overlaps(p, zone)) { openQuestion('gate', g); return; }
    }
    // --- hazards ---
    if (p.y > VIEW_H + 60) { die(); return; }
    if (p.invuln <= 0) {
      const hb = { x: p.x + 6, y: p.y + 8, w: p.w - 12, h: p.h - 10 };
      for (const s of L.spikes) if (overlaps(hb, { x: s.x + 4, y: s.y + 6, w: s.w - 8, h: s.h - 6 })) { die(); return; }
    }
    // --- flag ---
    const f = L.flag;
    if (!f.reached && p.x + p.w > f.x - 6 && p.x < f.x + 30 && p.y + p.h > f.y - 120) { levelComplete(); return; }
    // --- energy empty: recharge question ---
    if (S.energy <= 0 && p.onGround) { openQuestion('energy', null); }
  }

  function updateCamera(dt) {
    const vw = S.view.w;
    const target = S.player.x + S.player.w / 2 - vw * 0.38;
    const maxX = Math.max(0, S.level.width - vw);
    const t = 1 - Math.exp(-7 * dt);
    S.cam.x += (target - S.cam.x) * t;
    S.cam.x = Math.max(0, Math.min(maxX, S.cam.x));
  }

  function updateFx(dt) {
    const ps = S.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i];
      q.life -= dt; if (q.life <= 0) { ps.splice(i, 1); continue; }
      q.vy += q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.98;
    }
    for (const o of S.level.orbs) o.t += dt;
    for (const g of S.level.gates) { g.glow += dt; if (g.burst > 0) g.burst = Math.max(0, g.burst - dt * 1.4); }
    S.level.flag.t += dt;
    if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
    S.shake = Math.max(0, S.shake - dt);
    S.lowPulse += dt;
    S.time += dt;
  }

  /* ------------------------------------------------------------
     Frame loop + canvas sizing
     ------------------------------------------------------------ */
  function resizeCanvas() {
    if (!S || !D) return;
    const w = Math.max(200, Math.round(D.stage.clientWidth));
    const h = w < 640 ? Math.round(Math.max(300, Math.min(380, w * 0.92))) : Math.round(Math.max(300, Math.min(480, w * 0.5625)));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (D.canvas.width !== w * dpr || D.canvas.height !== h * dpr) {
      D.canvas.width = Math.round(w * dpr); D.canvas.height = Math.round(h * dpr);
    }
    D.canvas.style.height = h + 'px';
    D.stage.style.height = h + 'px';
    const scale = Math.min(h / VIEW_H, w / VIEW_W_MIN);
    S.view = { w: w / scale, h: h / scale, scale, cw: w, ch: h, dpr };
  }

  function frame(now) {
    if (!S || !D) return;
    rafId = requestAnimationFrame(frame);
    if (D.stage.clientWidth !== S.view.cw) resizeCanvas();
    const dt = S.lastT ? Math.min(MAX_FRAME_DT, (now - S.lastT) / 1000) : 0;
    S.lastT = now;
    if (S.mode === 'play') {
      S.acc = (S.acc || 0) + dt;
      let guard = 0;
      while (S.acc >= FIXED_DT && S.mode === 'play' && guard++ < 8) { S.acc -= FIXED_DT; stepPhysics(FIXED_DT); }
      if (S.mode !== 'play') S.acc = 0;
    } else if (S.mode === 'dead') {
      S.deathTimer -= dt;
      if (S.deathTimer <= 0) { if (S.hearts <= 0) gameOver(); else respawn(); }
    }
    if (S.mode !== 'pause' && S.mode !== 'question') { updateCamera(dt); updateFx(dt); }
    if (S.mode === 'play' || S.mode === 'dead') updateHud();
    render();
  }

  /* ------------------------------------------------------------
     Rendering — everything is drawn with canvas primitives
     ------------------------------------------------------------ */
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function makeStars() {
    const rng = Rand.seeded(4242);
    const out = [];
    for (let i = 0; i < 90; i++) out.push({ x: rng() * 1600, y: rng() * 260, r: 0.6 + rng() * 1.6, tw: rng() * 6.28, sp: 0.5 + rng() });
    return out;
  }
  function hillY(x, base, amp, k) { return base - Math.abs(Math.sin(x * k) * amp + Math.sin(x * k * 2.7 + 1.3) * amp * 0.35); }

  function drawBackground(g, vw, vh, oy) {
    const cam = S.cam.x, t = S.time;
    // sky
    const sky = g.createLinearGradient(0, 0, 0, vh);
    sky.addColorStop(0, '#0a0e22'); sky.addColorStop(0.55, '#111a3d'); sky.addColorStop(1, '#1b1f4a');
    g.fillStyle = sky; g.fillRect(0, 0, vw, vh);
    // aurora haze
    const haze = g.createRadialGradient(vw * 0.25, 40, 10, vw * 0.25, 40, vw * 0.6);
    haze.addColorStop(0, 'rgba(124,92,240,0.22)'); haze.addColorStop(1, 'rgba(124,92,240,0)');
    g.fillStyle = haze; g.fillRect(0, 0, vw, vh);
    // stars
    const W = 1600, off = cam * 0.08;
    for (const s of S.stars) {
      const sx = ((s.x - off) % W + W) % W;
      if (sx > vw + 4) continue;
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.sp + s.tw));
      g.globalAlpha = a; g.fillStyle = s.r > 1.6 ? C.amber : C.text;
      g.beginPath(); g.arc(sx, s.y + oy * 0.3, s.r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    // moon
    const mx = vw * 0.8 - cam * 0.03, my = 68 + oy * 0.3;
    const mg = g.createRadialGradient(mx, my, 10, mx, my, 90);
    mg.addColorStop(0, 'rgba(246,196,83,0.35)'); mg.addColorStop(1, 'rgba(246,196,83,0)');
    g.fillStyle = mg; g.fillRect(mx - 90, my - 90, 180, 180);
    g.fillStyle = '#fbe7a6'; g.beginPath(); g.arc(mx, my, 22, 0, 6.283); g.fill();
    g.fillStyle = '#0f1430'; g.globalAlpha = 0.9; g.beginPath(); g.arc(mx - 9, my - 6, 19, 0, 6.283); g.fill(); g.globalAlpha = 1;
    // hills (two parallax layers)
    const layers = [
      { par: 0.22, base: GROUND_Y + oy - 60, amp: 70, k: 0.004, col: '#1a1f4f' },
      { par: 0.45, base: GROUND_Y + oy - 18, amp: 46, k: 0.007, col: '#0f2740' },
    ];
    for (const L of layers) {
      g.fillStyle = L.col; g.beginPath(); g.moveTo(0, vh);
      for (let x = 0; x <= vw + 16; x += 16) g.lineTo(x, hillY(x + cam * L.par, L.base, L.amp, L.k));
      g.lineTo(vw + 16, vh); g.closePath(); g.fill();
    }
    // ground fog
    const fog = g.createLinearGradient(0, GROUND_Y + oy - 80, 0, GROUND_Y + oy + 20);
    fog.addColorStop(0, 'rgba(56,217,196,0)'); fog.addColorStop(1, 'rgba(56,217,196,0.10)');
    g.fillStyle = fog; g.fillRect(0, GROUND_Y + oy - 80, vw, 100);
  }

  function drawPlatform(g, p) {
    if (p.ground) {
      const grad = g.createLinearGradient(0, p.y, 0, p.y + p.h);
      grad.addColorStop(0, '#223066'); grad.addColorStop(0.35, '#161e45'); grad.addColorStop(1, '#0b1024');
      g.fillStyle = grad; rr(g, p.x, p.y, p.w, p.h + 60, 14); g.fill();
      g.fillStyle = 'rgba(56,217,196,0.75)'; rr(g, p.x + 4, p.y, p.w - 8, 4, 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.05)'; rr(g, p.x + 10, p.y + 12, p.w - 20, 10, 5); g.fill();
    } else {
      g.fillStyle = 'rgba(167,139,250,0.14)'; rr(g, p.x - 4, p.y - 3, p.w + 8, p.h + 8, 11); g.fill();   // soft halo
      const grad = g.createLinearGradient(0, p.y, 0, p.y + p.h);
      grad.addColorStop(0, '#3a3f7a'); grad.addColorStop(1, '#1d2250');
      g.fillStyle = grad; rr(g, p.x, p.y, p.w, p.h, 9); g.fill();
      g.fillStyle = 'rgba(167,139,250,0.85)'; rr(g, p.x + 4, p.y, p.w - 8, 3, 2); g.fill();
    }
  }

  function drawSpikes(g, s) {
    const n = Math.max(1, Math.round(s.w / 16)), w = s.w / n;
    const grad = g.createLinearGradient(0, s.y, 0, s.y + s.h);
    grad.addColorStop(0, '#ff8aa0'); grad.addColorStop(1, C.rose2);
    g.fillStyle = grad; g.beginPath();
    for (let i = 0; i < n; i++) { const x = s.x + i * w; g.moveTo(x, s.y + s.h); g.lineTo(x + w / 2, s.y); g.lineTo(x + w, s.y + s.h); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,92,122,0.18)'; g.beginPath(); g.ellipse(s.x + s.w / 2, s.y + s.h, s.w / 2 + 8, 8, 0, 0, 6.283); g.fill();
  }

  function drawGate(g, gate) {
    const cx = gate.x + gate.w / 2, t = gate.glow;
    // posts
    for (const px of [gate.x - 6, gate.x + gate.w - 2]) {
      g.fillStyle = '#242a5e'; rr(g, px, GROUND_Y - 54, 8, 54, 3); g.fill();
      g.fillStyle = gate.open ? C.mint : C.lav; rr(g, px - 2, GROUND_Y - 60, 12, 8, 3); g.fill();
    }
    if (!gate.open) {
      const beam = g.createLinearGradient(gate.x, 0, gate.x + gate.w, 0);
      const pulse = 0.55 + 0.25 * Math.sin(t * 3);
      beam.addColorStop(0, 'rgba(167,139,250,0)'); beam.addColorStop(0.5, 'rgba(167,139,250,' + pulse + ')'); beam.addColorStop(1, 'rgba(167,139,250,0)');
      g.fillStyle = beam; g.fillRect(gate.x - 10, 0, gate.w + 20, GROUND_Y - 50);
      g.fillStyle = 'rgba(238,241,255,0.9)';
      for (let i = 0; i < 6; i++) { const y = ((t * 60 + i * 55) % (GROUND_Y - 60)); g.fillRect(cx - 5 + Math.sin(t * 2 + i) * 3, y, 10, 2); }
      // glowing question glyph
      const qy = GROUND_Y - 150 + Math.sin(t * 2) * 6;
      const glow = g.createRadialGradient(cx, qy, 4, cx, qy, 40);
      glow.addColorStop(0, 'rgba(246,196,83,0.5)'); glow.addColorStop(1, 'rgba(246,196,83,0)');
      g.fillStyle = glow; g.fillRect(cx - 40, qy - 40, 80, 80);
      g.fillStyle = C.amber; g.font = '900 30px Outfit, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('¿?', cx, qy);
    } else if (gate.burst > 0) {
      const r = (1 - gate.burst) * 140 + 10;
      g.strokeStyle = 'rgba(56,217,196,' + gate.burst.toFixed(2) + ')'; g.lineWidth = 4;
      g.beginPath(); g.arc(cx, GROUND_Y - 80, r, 0, 6.283); g.stroke();
    }
  }

  function drawFlag(g, f) {
    g.fillStyle = C.text2; rr(g, f.x, f.y - 130, 6, 130, 3); g.fill();
    g.fillStyle = C.amber; g.beginPath(); g.arc(f.x + 3, f.y - 132, 6, 0, 6.283); g.fill();
    const grad = g.createLinearGradient(f.x, 0, f.x + 60, 0);
    grad.addColorStop(0, C.amber); grad.addColorStop(1, C.amber2);
    g.fillStyle = grad; g.beginPath(); g.moveTo(f.x + 6, f.y - 126);
    for (let i = 0; i <= 10; i++) { const u = i / 10; g.lineTo(f.x + 6 + u * 58, f.y - 126 + Math.sin(f.t * 5 + u * 4) * 4 * u); }
    for (let i = 10; i >= 0; i--) { const u = i / 10; g.lineTo(f.x + 6 + u * 58, f.y - 90 + Math.sin(f.t * 5 + u * 4) * 4 * u); }
    g.closePath(); g.fill();
    g.fillStyle = '#1a1200'; g.font = '800 15px Outfit, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('META', f.x + 34, f.y - 108);
    g.fillStyle = 'rgba(246,196,83,0.15)'; g.beginPath(); g.ellipse(f.x + 3, f.y, 40, 10, 0, 0, 6.283); g.fill();
  }

  function drawOrb(g, o) {
    const y = o.y + Math.sin(o.t * 3) * 4;
    const glow = g.createRadialGradient(o.x, y, 2, o.x, y, 26);
    glow.addColorStop(0, 'rgba(246,196,83,0.55)'); glow.addColorStop(1, 'rgba(246,196,83,0)');
    g.fillStyle = glow; g.fillRect(o.x - 26, y - 26, 52, 52);
    const body = g.createRadialGradient(o.x - 4, y - 5, 2, o.x, y, 14);
    body.addColorStop(0, '#fff3c4'); body.addColorStop(0.6, C.amber); body.addColorStop(1, C.amber2);
    g.fillStyle = body; g.beginPath(); g.arc(o.x, y, 13, 0, 6.283); g.fill();
    g.fillStyle = '#1a1200'; g.font = '900 17px Outfit, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(o.letter, o.x, y + 1);
  }

  function drawPlayer(g, p) {
    const tired = S.energy <= 0;
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0) g.globalAlpha = 0.35;
    const fx = p.x + p.w / 2, fy = p.y + p.h;
    g.save();
    g.translate(fx, fy);
    g.scale(p.sx * p.dir, p.sy);
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(0, 1, 16, 4, 0, 0, 6.283); g.fill();
    // legs
    const moving = p.onGround && Math.abs(p.vx) > 20;
    const swing = moving ? Math.sin(p.run * 3) * 7 : 0;
    g.fillStyle = '#2a1e05';
    rr(g, -10 + (moving ? swing : 0), -12, 8, 12, 3); g.fill();
    rr(g, 2 - (moving ? swing : 0), -12, 8, 12, 3); g.fill();
    if (!p.onGround) { g.fillStyle = '#2a1e05'; rr(g, -11, -14, 8, 8, 3); g.fill(); rr(g, 3, -16, 8, 8, 3); g.fill(); }
    // backpack (behind, towards the back)
    g.fillStyle = C.mint2; rr(g, -22, -34, 12, 20, 5); g.fill();
    g.fillStyle = C.mint; rr(g, -20, -31, 8, 5, 2); g.fill();
    // body
    const body = g.createLinearGradient(0, -p.h, 0, 0);
    body.addColorStop(0, '#ffd978'); body.addColorStop(1, C.amber2);
    g.fillStyle = body; rr(g, -p.w / 2, -p.h + 2, p.w, p.h - 8, 12); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; rr(g, -p.w / 2 + 4, -p.h + 6, 8, 10, 4); g.fill();
    // strap
    g.fillStyle = 'rgba(31,184,166,0.8)'; rr(g, -6, -p.h + 4, 4, 22, 2); g.fill();
    // face
    const eyeY = -p.h + 15, blink = p.blink > 0 || tired;
    for (const ex of [2, 11]) {
      if (blink) { g.fillStyle = '#1a1200'; rr(g, ex - 1, eyeY + 2, 6, 2, 1); g.fill(); continue; }
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex + 2, eyeY, 4, 5, 0, 0, 6.283); g.fill();
      g.fillStyle = '#1a1200'; g.beginPath(); g.arc(ex + 3.3, eyeY + 0.5, 2.2, 0, 6.283); g.fill();
    }
    g.strokeStyle = '#1a1200'; g.lineWidth = 1.6; g.beginPath();
    if (tired) { g.moveTo(5, eyeY + 12); g.lineTo(12, eyeY + 12); } else g.arc(8, eyeY + 9, 3.5, 0.15, Math.PI - 0.15);
    g.stroke();
    // cheeks
    g.fillStyle = 'rgba(255,92,122,0.35)'; g.beginPath(); g.arc(0, eyeY + 7, 2.2, 0, 6.283); g.arc(14, eyeY + 7, 2.2, 0, 6.283); g.fill();
    g.restore();
    g.globalAlpha = 1;
    if (tired && S.mode === 'play') {
      g.fillStyle = C.rose; g.font = '800 14px Outfit, Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⚡ 0', fx, p.y - 12 + Math.sin(S.time * 6) * 2);
    }
  }

  function render() {
    const g = D.ctx2d, v = S.view;
    const vw = v.w, vh = v.h, oy = Math.max(0, vh - VIEW_H);
    g.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, 0, 0);
    drawBackground(g, vw, vh, oy);
    // world
    g.save();
    let shx = 0, shy = 0;
    if (S.shake > 0) { shx = (Math.random() - 0.5) * 8 * S.shake; shy = (Math.random() - 0.5) * 8 * S.shake; }
    g.translate(-S.cam.x + shx, oy + shy);
    const x0 = S.cam.x - 120, x1 = S.cam.x + vw + 120;
    const vis = (o) => o.x + (o.w || 40) > x0 && o.x - 40 < x1;
    for (const p of S.level.platforms) if (vis(p)) drawPlatform(g, p);
    for (const s of S.level.spikes) if (vis(s)) drawSpikes(g, s);
    for (const gt of S.level.gates) if (vis(gt)) drawGate(g, gt);
    if (vis(S.level.flag)) drawFlag(g, S.level.flag);
    for (const o of S.level.orbs) if (!o.taken && vis(o)) drawOrb(g, o);
    if (S.mode !== 'dead') drawPlayer(g, S.player);
    for (const q of S.particles) {
      g.globalAlpha = Math.max(0, Math.min(1, q.life / 0.5));
      g.fillStyle = q.c; rr(g, q.x - q.size / 2, q.y - q.size / 2, q.size, q.size, q.size / 3); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    // screen-space effects
    if (S.energy < ENERGY_LOW && (S.mode === 'play' || S.mode === 'question')) {
      const a = (S.energy <= 0 ? 0.35 : 0.22) * (0.6 + 0.4 * Math.sin(S.lowPulse * 5));
      const vg = g.createRadialGradient(vw / 2, vh / 2, vh * 0.35, vw / 2, vh / 2, vh * 0.9);
      vg.addColorStop(0, 'rgba(255,92,122,0)'); vg.addColorStop(1, 'rgba(255,92,122,' + a.toFixed(3) + ')');
      g.fillStyle = vg; g.fillRect(0, 0, vw, vh);
    }
    if (S.mode === 'dead') { g.fillStyle = 'rgba(255,92,122,' + (0.25 * S.deathTimer / DEATH_DELAY).toFixed(3) + ')'; g.fillRect(0, 0, vw, vh); }
    if (S.banner) {
      const b = S.banner, a = Math.min(1, b.t / 0.3, (b.max - b.t) / 0.2 + 0.2);
      g.globalAlpha = Math.max(0, Math.min(1, a));
      g.font = '700 15px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = Math.min(vw - 24, g.measureText(b.text).width + 32);
      g.fillStyle = 'rgba(7,10,20,0.75)'; rr(g, vw / 2 - tw / 2, 14, tw, 34, 17); g.fill();
      g.strokeStyle = 'rgba(246,196,83,0.5)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = C.text; g.fillText(b.text, vw / 2, 31, vw - 56);
      g.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------
     Mount / unmount + registration
     ------------------------------------------------------------ */
  function onVisibility() { if (document.hidden && S && S.mode === 'play') togglePause(); }
  function onResize() { resizeCanvas(); }
  function onBlur() { held.left = held.right = held.jump = false; clearInput(); }

  const GAME = {
    id: ID,
    name: 'Energy Run',
    tagline: 'Run, jump and spell to keep your energy up. Word gates block the way!',
    icon: '⚡',
    accent: 'var(--c-amber)',
    order: 1,
    mount(root) {
      if (S || D) GAME.unmount();           // idempotent: a second mount never leaves a loop running
      held.left = held.right = held.jump = false;
      S = Object.assign(newRun(1), { lastT: 0 });
      D = buildDom(root);
      bindTouch(D.btnL, 'left');
      bindTouch(D.btnR, 'right');
      bindTouch(D.btnJ, 'jump');
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize);
      window.addEventListener('blur', onBlur);
      resizeCanvas();
      updateHud();
      showOverlay(introPanel());
      render();
      rafId = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(rafId); rafId = 0;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      closeQuestion();
      endRun();                              // leaving mid-run (even mid-question) still counts
      hideOverlay();
      if (D && D.shell) D.shell.remove();
      S = null; D = null;
    },
  };
  PQ.Games.register(GAME);

  /* ------------------------------------------------------------
     Debug hooks for tests
     ------------------------------------------------------------ */
  window.PQ.debug = window.PQ.debug || {};
  window.PQ.debug[ID] = {
    get state() { return S; },
    get dom() { return D; },
    start() { startPlay(); },
    setEnergy(n) { if (S) { S.energy = Math.max(0, Math.min(ENERGY_MAX, n)); updateHud(); } },
    openQuestion(reason) { openQuestion(reason || 'energy', null); },
    teleportToGate(i) {
      if (!S) return null;
      const gates = S.level.gates.filter((g) => !g.open);
      const g = gates[i || 0] || S.level.gates[0];
      if (!g) return null;
      S.player.x = g.x - S.player.w - 40; S.player.y = GROUND_Y - S.player.h; S.player.vx = 0; S.player.vy = 0;
      S.cam.x = Math.max(0, S.player.x - 200);
      return g;
    },
    teleportToFlag() {
      if (!S) return;
      S.player.x = S.level.flag.x - 120; S.player.y = GROUND_Y - S.player.h; S.player.vx = 0; S.player.vy = 0;
      S.cam.x = Math.max(0, S.player.x - 200);
    },
    kill() { if (S && S.mode === 'play') die(); },
    get held() { return held; },
    press(act, down) { press(act, down); },
    score() { return S ? computeScore() : 0; },
    generate(level) { return generateLevel(level); },
  };
})();
