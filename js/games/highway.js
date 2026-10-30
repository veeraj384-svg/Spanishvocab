/* ============================================================
   SPANISH VOCAB — Word Highway  (game id: 'highway')
   An open-world driving game drawn in 3D on a plain canvas (a
   perspective projection with near-plane clipping, no libraries).
   The world is endless and procedural: five biomes (plains, forest,
   desert, snow, badlands) in blocky Minecraft-like tiles, a grid of
   roads, villages around the intersections, coins, trees, rocks,
   cacti, lava pools. You control the car completely: gas, brake,
   reverse, steering, handbrake.

   Learning loop
     every intersection is a checkpoint (a blue beacon, four stop
     signs). Driving into one stops the car and asks a question about
     one of the words (typed spelling, accent placement or a choice).
       correct       checkpoint cleared (beacon turns orange), +fuel, points × streak
       accent slip   a little fuel, the checkpoint stays open to retry
       wrong         no fuel, retry later
     fuel drains while you drive; coins give a little; when it runs
     out the run ends. Discovering a new biome is worth points too.
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Progress, Quiz, QuizUI, UI, Sound, Rand } = PQ;
  const h = UI.h;

  const ID = 'highway';
  const TILE = 8;                             // world units per ground tile (also the road width)
  const ROAD_EVERY = 11;                      // tiles between roads (88 units)
  const BLOCK = ROAD_EVERY * TILE;
  const INTER_R = 7.5;                        // checkpoint trigger radius
  const NEAR = 0.9;                           // near clipping plane (camera space)
  const CAM_BACK = 7.8, CAM_H = 3.1;          // chase camera: behind and above the car
  const MAX_SPEED = 27, REV_SPEED = 8, ACCEL = 13, BRAKE = 26, DRAG = 0.5, ROLL = 2.0;
  const TURN = 2.2;                           // rad/s at full speed
  const FUEL_MAX = 100, FUEL_IDLE = 0.75, FUEL_PER_UNIT = 0.03;
  const FUEL_REWARD = { correct: 40, accent: 15, wrong: 0 };
  const COIN_FUEL = 6, COIN_PTS = 25, CHECK_PTS = 300, BIOME_PTS = 500;
  const ENDING = 1.4;
  const MAX_DT = 0.05;
  const TAU = Math.PI * 2;
  const FONT = "'Times New Roman', Times, 'Liberation Serif', serif";
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const C = { amber: '#4da3ff', amber2: '#2b7fe6', mint: '#ff8a2b', lav: '#ffb347', rose: '#ef3b4d', rose2: '#c92233', white: '#ffffff' };

  const BIOMES = {
    plains:   { name: 'Plains',   icon: '🌿', ground: ['#3f9a4a', '#47a654', '#3a8d44'], sky: '#0a1230', fog: [12, 20, 52],  grip: 1,    speed: 0.72 },
    forest:   { name: 'Forest',   icon: '🌲', ground: ['#2b6e3a', '#2f7a40', '#276435'], sky: '#07161c', fog: [8, 24, 30],   grip: 1,    speed: 0.6 },
    desert:   { name: 'Desert',   icon: '🏜️', ground: ['#d9b26a', '#e1bb77', '#cfa860'], sky: '#2a1a12', fog: [48, 30, 20],  grip: 0.9,  speed: 0.66 },
    snow:     { name: 'Snow',     icon: '❄️', ground: ['#e6edf6', '#f1f5fb', '#dbe4ee'], sky: '#1b2a4a', fog: [36, 52, 86],  grip: 0.5,  speed: 0.78 },
    badlands: { name: 'Badlands', icon: '🌋', ground: ['#5a2a24', '#64302a', '#4e241f'], sky: '#2a0c10', fog: [48, 14, 18],  grip: 0.95, speed: 0.62 },
  };
  const ROAD_COL = ['#2a3047', '#2e354f'];

  let S = null, D = null, rafId = 0, timers = [];

  function later(fn, ms) { const id = setTimeout(() => { timers = timers.filter((t) => t !== id); if (S && D) fn(); }, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const mod = (n, m) => ((n % m) + m) % m;
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const uniqById = (list) => { const seen = new Set(); return list.filter((e) => !seen.has(e.id) && seen.add(e.id)); };
  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgbStr(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; }
  /** Colour mixed toward the current fog by `fog` (0..1), optionally scaled by `k` (shading). */
  const colorCache = new Map();
  let colorCacheFog = '';
  function fogged(hex, fog, k, a) {
    k = k == null ? 1 : k;
    const fq = Math.round(fog * 12) / 12;                      // 13 fog steps are plenty; the cache stays small
    const key = hex + '|' + fq + '|' + k + '|' + (a == null ? 1 : a);
    let v = colorCache.get(key);
    if (v) return v;
    const c = hexRgb(hex), F = S.fogRGB;
    v = 'rgba(' + Math.round(lerp(clamp(c[0] * k, 0, 255), F[0], fq)) + ',' + Math.round(lerp(clamp(c[1] * k, 0, 255), F[1], fq)) + ',' + Math.round(lerp(clamp(c[2] * k, 0, 255), F[2], fq)) + ',' + (a == null ? 1 : a) + ')';
    if (colorCache.size > 4000) colorCache.clear();
    colorCache.set(key, v);
    return v;
  }
  function roundRect(ctx, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /* ------------------------------------------------------------
     Procedural world (deterministic per seed)
     ------------------------------------------------------------ */
  function hash(ix, iz, salt) {
    let n = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(salt | 0, 1274126177) + S.seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n ^ (n >>> 16)) >>> 0;
  }
  const h01 = (ix, iz, salt) => hash(ix, iz, salt) / 4294967296;
  function vnoise(x, z, salt) {
    const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    return lerp(lerp(h01(x0, z0, salt), h01(x0 + 1, z0, salt), sx), lerp(h01(x0, z0 + 1, salt), h01(x0 + 1, z0 + 1, salt), sx), sz);
  }
  function biomeAt(x, z) {
    const t = vnoise(x / 170, z / 170, 11) * 0.7 + vnoise(x / 60 + 7, z / 60 + 3, 12) * 0.3;
    const hm = vnoise(x / 150 + 37, z / 150 + 91, 13) * 0.7 + vnoise(x / 55 + 5, z / 55 + 9, 14) * 0.3;
    if (t < 0.37) return 'snow';
    if (t > 0.63) return hm < 0.5 ? 'desert' : 'badlands';
    return hm > 0.58 ? 'forest' : 'plains';
  }
  function roadInfo(tx, tz) { const ns = mod(tx, ROAD_EVERY) === 0, ew = mod(tz, ROAD_EVERY) === 0; return { road: ns || ew, ns, ew, inter: ns && ew }; }
  const HALF = TILE / 2;                      // intersection centres sit at (i·BLOCK + HALF, j·BLOCK + HALF)
  /** Intersection index (i, j) nearest to a world point, with its centre and distance. */
  function nearestInter(x, z) {
    const i = Math.round((x - HALF) / BLOCK), j = Math.round((z - HALF) / BLOCK);
    const cx = i * BLOCK + HALF, cz = j * BLOCK + HALF;
    return { i, j, cx, cz, key: i + ',' + j, d: Math.hypot(x - cx, z - cz) };
  }

  /** What sits on a tile (cached): null, a solid thing, a coin, or a lava pool. */
  function tileObj(tx, tz) {
    const key = tx + ',' + tz;
    const cached = S.tileCache.get(key);
    if (cached !== undefined) return cached;
    if (S.tileCache.size > 6000) S.tileCache.clear();
    const ri = roadInfo(tx, tz);
    const cx = tx * TILE + TILE / 2, cz = tz * TILE + TILE / 2;
    let obj = null;
    if (ri.road) {
      if (!ri.inter && h01(tx, tz, 22) < 0.05) obj = { type: 'coin', x: cx, z: cz, solid: false, r: 0.6 };
    } else {
      const b = biomeAt(cx, cz), r = h01(tx, tz, 21), v = h01(tx, tz, 23);
      const mx = mod(tx, ROAD_EVERY), mz = mod(tz, ROAD_EVERY);
      const shoulder = mx === 1 || mx === ROAD_EVERY - 1 || mz === 1 || mz === ROAD_EVERY - 1;   // kept clear next to roads
      const dx = Math.min(mx, ROAD_EVERY - mx), dz = Math.min(mz, ROAD_EVERY - mz);
      if (!shoulder) {
        if (dx <= 3 && dz <= 3 && r < 0.4 && b !== 'badlands') obj = { type: 'house', solid: true, r: 2.6, v, biome: b };
        else if (b === 'forest' && r < 0.22) obj = { type: 'tree', solid: true, r: 1.1, v };
        else if (b === 'plains' && r < 0.05) obj = { type: 'tree', solid: true, r: 1.1, v };
        else if (b === 'plains' && r < 0.09) obj = { type: 'bush', solid: false, r: 0.8, v };
        else if (b === 'desert' && r < 0.07) obj = { type: 'cactus', solid: true, r: 0.7, v };
        else if (b === 'desert' && r < 0.1) obj = { type: 'rock', solid: true, r: 1.0, v };
        else if (b === 'snow' && r < 0.12) obj = { type: 'pine', solid: true, r: 1.0, v };
        else if (b === 'snow' && r < 0.14) obj = { type: 'snowman', solid: true, r: 0.8, v };
        else if (b === 'badlands' && r < 0.1) obj = { type: 'rock', solid: true, r: 1.1, v, dark: true };
        else if (b === 'badlands' && r < 0.2) obj = { type: 'lava', solid: false, r: 0, v };
      }
      if (!obj && h01(tx, tz, 22) < 0.035) obj = { type: 'coin', solid: false, r: 0.6 };
      if (obj) { obj.x = cx; obj.z = cz; }
    }
    if (obj) obj.key = key;
    S.tileCache.set(key, obj);
    return obj;
  }
  const tileColor = (tx, tz, biome) => (roadInfo(tx, tz).road ? ROAD_COL[(tx + tz) & 1] : BIOMES[biome].ground[hash(tx, tz, 31) % 3]);

  /* ------------------------------------------------------------
     State
     ------------------------------------------------------------ */
  function pickSeed() {   // a seed whose start area is plains, so the first drive is friendly
    for (let i = 0; i < 40; i++) { const seed = (Math.random() * 0x7fffffff) | 0; S.seed = seed; if (biomeAt(0, 0) === 'plains' && biomeAt(4, -40) === 'plains') return seed; }
    return S.seed;
  }
  function newState(prev) {
    const st = {
      mode: 'intro',           // intro | play | question | pause | ending | over
      t: 0, anim: prev ? prev.anim : 0, lastT: prev ? prev.lastT : 0,
      view: prev ? prev.view : { w: 0, h: 0, dpr: 1, cw: 0 },
      seed: 1, tileCache: new Map(),
      car: { x: TILE / 2, z: -28, a: 0, v: 0, vx: 0, vz: 0, steerVis: 0 },
      cam: { x: TILE / 2, z: -28 - CAM_BACK, a: 0 },
      input: { gas: false, brake: false, left: false, right: false, hand: false },
      fuel: FUEL_MAX, score: 0, dist: 0, streak: 0, bestStreak: 0,
      checkpoints: 0, coins: 0, bumps: 0, asked: 0, correct: 0,
      cleared: new Set(), taken: new Set(), armed: null, extra: [],
      biome: 'plains', biomesSeen: new Set(['plains']), fogRGB: BIOMES.plains.fog.slice(), skyRGB: hexRgb(BIOMES.plains.sky),
      question: null, missed: [], recent: [],
      banner: null, particles: [], floats: [], shake: 0, flash: 0, flashColor: C.rose, endAt: 0, lowFuelWarned: false, bumpAt: -9,
      onRoad: true, lava: false, saved: false, isNewBest: false, uid: 0, hudCache: {}, mini: null,
    };
    return st;
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  function bestLabel() { const g = Progress.gameStats(ID); return g.best ? 'Best ' + fmt(g.best) + (g.checkpoints ? ' · ' + g.checkpoints + ' checkpoints' : '') : 'No best yet'; }

  function holdButton(btn, key) {
    const down = (e) => { e.preventDefault(); if (!S) return; S.input[key] = true; btn.classList.add('is-down'); };
    const up = () => { if (S) S.input[key] = false; btn.classList.remove('is-down'); };
    btn.addEventListener('pointerdown', down);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, up));
    return btn;
  }

  function buildDom(root) {
    const best = h('span.g-highway-best', null, bestLabel());
    const pauseBtn = h('button.btn.btn-outline.btn-sm.g-highway-pausebtn', { type: 'button', title: 'Pause (Esc)', onclick: () => { if (S && (S.mode === 'play' || S.mode === 'pause')) togglePause(); } }, '⏸ Pause');
    const topbar = h('div.game-topbar', null,
      h('div.game-title', null, h('span.icon', null, '🏎️'), h('span', null, 'Word Highway', h('span.g-highway-tag', null, 'Open-world driving · answer at the checkpoints'))),
      h('div.row', null, best, pauseBtn));

    const score = h('span.val', null, '0');
    const fuelFill = h('div.bar-fill');
    const fuelVal = h('span.val', null, '100');
    const fuelItem = h('div.hud-item.g-highway-fuel', null, h('span.label', null, 'Fuel'), h('div.bar.g-highway-fuelbar', null, fuelFill), fuelVal);
    const speed = h('span.val', null, '0');
    const checks = h('span.val', null, '0');
    const coins = h('span.val', null, '0');
    const biomeIcon = h('span.g-highway-biome-icon', null, '🌿');
    const biomeName = h('span.val', null, 'Plains');
    const streak = h('span.val', null, '0');
    const streakItem = h('div.hud-item.g-highway-streak', null, h('span.label', null, 'Streak'), streak);
    const hud = h('div.hud.g-highway-hud', null,
      h('div.hud-item', null, h('span.label', null, 'Score'), score),
      fuelItem,
      h('div.hud-item', null, h('span.label', null, 'Speed'), speed),
      h('div.hud-item', null, h('span.label', null, 'Checkpoints'), checks),
      h('div.hud-item', null, h('span.label', null, 'Coins'), coins),
      h('div.hud-item.g-highway-biome', null, biomeIcon, biomeName),
      streakItem,
      h('div.hud-spacer'));

    const canvas = h('canvas.g-highway-canvas', { 'aria-label': 'Word Highway: an open 3D world seen from behind the car' });
    const mini = h('canvas.g-highway-mini', { width: '132', height: '132', 'aria-label': 'Map' });
    const banner = h('div.g-highway-banner', { 'aria-live': 'polite' });
    const stage = h('div.game-stage.g-highway-stage', null, canvas, mini, banner);

    const btnL = holdButton(h('button.touch-btn', { type: 'button', 'aria-label': 'Steer left' }, '◀'), 'left');
    const btnR = holdButton(h('button.touch-btn', { type: 'button', 'aria-label': 'Steer right' }, '▶'), 'right');
    const btnB = holdButton(h('button.touch-btn.g-highway-brake', { type: 'button', 'aria-label': 'Brake / reverse' }, '▼'), 'brake');
    const btnG = holdButton(h('button.touch-btn.g-highway-gas', { type: 'button', 'aria-label': 'Gas' }, '▲'), 'gas');
    const btnP = h('button.touch-btn.g-highway-touch-pause', { type: 'button', 'aria-label': 'Pause', onclick: () => { if (S && (S.mode === 'play' || S.mode === 'pause')) togglePause(); } }, '⏸');
    const touch = h('div.touch-controls.g-highway-touch', null, h('div.tc-group', null, btnL, btnR), btnP, h('div.tc-group', null, btnB, btnG));
    const help = h('div.small.muted.g-highway-help', null, 'W / ↑ gas · S / ↓ brake and reverse · A D / ← → steer · Space handbrake · Esc pauses');

    const shell = h('div.game-shell.g-highway', null, topbar, hud, stage, touch, help);
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0) shell.classList.add('g-highway-is-touch');
    root.appendChild(shell);
    return { shell, stage, canvas, ctx: canvas.getContext('2d'), mini, mctx: mini.getContext('2d'), banner, best, pauseBtn, overlay: null,
      hud: { score, fuelFill, fuelVal, fuelItem, speed, checks, coins, biomeIcon, biomeName, streak, streakItem } };
  }

  /* ------------------------------------------------------------
     Overlays
     ------------------------------------------------------------ */
  function showOverlay(panel, cls) { hideOverlay(); D.overlay = h('div.game-overlay.g-highway-overlay' + (cls ? '.' + cls : ''), null, panel); D.stage.appendChild(D.overlay); }
  function hideOverlay() { if (D && D.overlay) { D.overlay.remove(); D.overlay = null; } }
  function focusLater(sel) { later(() => { const b = D.overlay && D.overlay.querySelector(sel); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, 40); }

  function introPanel() {
    const g = Progress.gameStats(ID);
    return h('div.panel.g-highway-intro', null,
      h('div.g-highway-intro-icon', { 'aria-hidden': 'true' }, '🏎️'),
      h('h2', null, 'Word Highway'),
      h('p.text-2', null, 'An endless world of roads and biomes. Drive anywhere. Every intersection is a checkpoint: answer a word question to clear it and refuel.'),
      h('div.g-highway-legend', null,
        h('div', null, h('b', null, 'W'), 'W / ↑ gas, S / ↓ brake, A D / ← → steer, Space handbrake'),
        h('div', null, h('b', null, '🛑'), 'Stop signs mark a checkpoint. Blue beacon = still to answer'),
        h('div', null, h('b', null, '⛽'), 'Fuel drains as you drive. Answers and coins refill it'),
        h('div', null, h('b', null, '🗺️'), 'Find all five biomes. Snow is slippery, lava burns fuel')),
      g.best ? h('div.small.muted.g-highway-intro-best', null, '🏆 ' + bestLabel()) : null,
      h('div.row.g-highway-actions', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '▶ Drive')));
  }
  function pausePanel() {
    return h('div.panel.g-highway-pause', null,
      h('div.eyebrow', null, 'Paused'), h('h2', null, 'Paused'),
      h('p.text-2', null, 'Score ' + fmt(S.score) + ' · ' + S.checkpoints + ' checkpoints · fuel ' + Math.round(S.fuel) + '%'),
      h('div.row.g-highway-actions', null,
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: resume }, '▶ Resume'),
        h('button.btn.btn-outline', { type: 'button', onclick: startGame }, '↻ New world'),
        h('a.btn.btn-ghost', { href: '#/' }, 'Home')));
  }
  const statEl = (label, val) => h('div.stat', null, h('div.stat-val', null, String(val)), h('div.stat-label', null, label));
  function overPanel() {
    const missed = uniqById(S.missed);
    const list = missed.length
      ? h('div.g-highway-missed', null, missed.map((e) => h('div.g-highway-missed-row', null, h('span.en', null, e.en), h('span.es', { html: PQ.Text.highlightAccents(e.answers[0]) }))))
      : h('p.small.muted', null, 'Every checkpoint you answered was right.');
    return h('div.panel.g-highway-over', null,
      h('div.eyebrow', null, 'Out of fuel'), h('h2', null, 'The road ends here'),
      h('div.big.grad-text', null, fmt(S.score)),
      S.isNewBest ? h('div.g-highway-newbest', null, 'New best score') : h('div.small.muted', null, bestLabel()),
      h('div.stat-grid', null, statEl('Distance', (S.dist / 1000).toFixed(1) + ' km'), statEl('Checkpoints', S.checkpoints), statEl('Biomes', S.biomesSeen.size + '/5'), statEl('Coins', S.coins)),
      h('div.row.g-highway-actions', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '↻ New world'), h('a.btn.btn-ghost', { href: '#/' }, 'Home')),
      missed.length ? h('div.g-highway-missed-title', null, missed.length + (missed.length === 1 ? ' word to review' : ' words to review')) : null,
      list);
  }

  /* ------------------------------------------------------------
     Run flow
     ------------------------------------------------------------ */
  function startGame() {
    if (!S || !D) return;
    closeQuestion();
    hideOverlay();
    S = newState(S);
    pickSeed();
    S.mode = 'play';
    S.mini = null;
    updateHud(true);
    showBanner('Drive', 'the blue beacon ahead is your first checkpoint', 2.2);
    Sound.play('gate');
  }
  function showBanner(title, sub, dur) {
    S.banner = { until: S.t + dur };
    const b = D.banner; UI.clear(b);
    b.appendChild(h('div.g-highway-banner-title', null, title));
    if (sub) b.appendChild(h('div.g-highway-banner-sub', null, sub));
    b.classList.remove('is-on'); void b.offsetWidth; b.classList.add('is-on');
  }
  function clearBanner() { if (S) S.banner = null; if (D) D.banner.classList.remove('is-on'); }

  function endRun() { S.mode = 'ending'; S.endAt = S.t + ENDING; S.input = { gas: false, brake: false, left: false, right: false, hand: false }; clearBanner(); Sound.play('lose'); }
  function saveBest() {
    if (S.saved) return;
    S.saved = true;
    S.isNewBest = Progress.setBest(ID, Math.round(S.score), null, { checkpoints: S.checkpoints, biomes: S.biomesSeen.size });
    D.best.textContent = bestLabel();
  }
  function gameOver() {
    S.mode = 'over';
    saveBest();
    showOverlay(overPanel(), 'g-highway-overlay-over');
    focusLater('button.btn-primary');
    if (S.isNewBest && S.score > 0) later(() => { UI.confetti({ count: 140 }); Sound.play('win'); }, 250);
  }
  function togglePause() { if (S.mode === 'play') pause(); else if (S.mode === 'pause') resume(); }
  function pause() { if (S.mode !== 'play') return; S.mode = 'pause'; showOverlay(pausePanel(), 'g-highway-overlay-pause'); Sound.play('click'); focusLater('button.btn-primary'); }
  function resume() { if (S.mode !== 'pause') return; S.mode = 'play'; S.lastT = 0; hideOverlay(); Sound.play('click'); }

  /* ------------------------------------------------------------
     Checkpoint questions
     ------------------------------------------------------------ */
  function pickEntry() {
    const all = Vocab.active();
    const recent = S.recent.slice(-Math.min(4, Math.max(0, all.length - 1)));
    const e = Progress.pick(1, { exclude: recent })[0] || Rand.pick(all);
    S.recent.push(e.id);
    return e;
  }
  function openQuestion(inter) {
    if (!S || S.question || S.mode !== 'play') return;
    S.mode = 'question';
    S.car.v = 0; S.car.vx = 0; S.car.vz = 0;
    S.input = { gas: false, brake: false, left: false, right: false, hand: false };
    const entry = pickEntry();
    const q = Quiz.any(entry, S.forceKind ? [S.forceKind] : ['typed', 'typed', 'choice', 'accent']);
    const ctl = QuizUI.ask(q, { bonus: Math.min(20, S.streak * 4), onResult: (res) => applyAnswer(inter, res) });
    const head = h('div.g-highway-qhead', null, h('span.g-highway-qicon', null, '🛑'), h('div', null, h('b', null, 'Checkpoint ' + (S.asked + 1)), h('span', null, 'Answer to clear it and refuel')));
    const modal = UI.modal({ closable: false, content: h('div.g-highway-q', null, head, ctl.el) });
    S.question = { ctl, modal, inter, entry };
    S.asked++;
    Sound.play('click');
  }
  function applyAnswer(inter, res) {
    if (!S || !S.question) return;
    const status = res.status === 'correct' ? 'correct' : res.status === 'accent' ? 'accent' : 'wrong';
    const gain = FUEL_REWARD[status];
    S.fuel = Math.min(FUEL_MAX, S.fuel + gain);
    if (status === 'correct') {
      S.correct++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
      Progress.noteStreak(S.streak);
      const mult = Math.min(4, 1 + Math.floor(S.streak / 2));
      const pts = CHECK_PTS * mult;
      S.score += pts;
      S.cleared.add(inter.key);
      S.checkpoints++;
      S.flash = 0.6; S.flashColor = C.amber;
      floatText(0.5, 0.45, '+' + pts, C.white);
      burst(0.5, 0.5, 30, [C.amber, C.white, C.mint]);
      showBanner('Checkpoint cleared', '+' + gain + ' fuel · +' + pts + ' points' + (mult > 1 ? ' (×' + mult + ')' : ''), 2.2);
      later(() => Sound.play('gate'), 120);
    } else {
      S.streak = 0;
      S.missed.push(S.question.entry);
      showBanner(status === 'accent' ? 'Check the accents' : 'Not quite', (gain ? '+' + gain + ' fuel · ' : '') + 'drive on and come back to retry', 2.4);
    }
    closeQuestion();
    S.mode = 'play';
    S.lastT = 0;
    updateHud(true);
  }
  function closeQuestion() {
    if (!S || !S.question) return;
    const q = S.question; S.question = null;
    try { q.ctl.destroy(); } catch (e) { /* ignore */ }
    try { q.modal.close(); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------
     Simulation
     ------------------------------------------------------------ */
  function tileAt(x, z) { return { tx: Math.floor(x / TILE), tz: Math.floor(z / TILE) }; }

  function updateCar(dt) {
    const car = S.car, inp = S.input;
    const { tx, tz } = tileAt(car.x, car.z);
    const ri = roadInfo(tx, tz);
    const biome = biomeAt(car.x, car.z);
    if (biome !== S.biome) {
      S.biome = biome;
      if (!S.biomesSeen.has(biome)) { S.biomesSeen.add(biome); S.score += BIOME_PTS; showBanner(BIOMES[biome].icon + ' ' + BIOMES[biome].name, 'new biome discovered · +' + BIOME_PTS, 2.4); Sound.play('levelup'); }
    }
    const here = tileObj(tx, tz);
    S.onRoad = ri.road; S.lava = !!(here && here.type === 'lava');
    const info = BIOMES[biome];
    const maxV = MAX_SPEED * (ri.road ? 1 : info.speed) * (S.lava ? 0.5 : 1);
    const throttle = (inp.gas ? 1 : 0) - (inp.brake ? 1 : 0);
    if (throttle > 0) { car.v += ACCEL * dt; if (car.v > maxV) car.v = Math.max(maxV, car.v - (car.v - maxV) * 3 * dt); }
    else if (throttle < 0) { if (car.v > 0.3) car.v = Math.max(0, car.v - BRAKE * dt); else car.v = Math.max(-REV_SPEED, car.v - ACCEL * 0.6 * dt); }
    else { const dec = Math.abs(car.v) * DRAG * dt + ROLL * dt; car.v = Math.abs(car.v) <= dec ? 0 : car.v - Math.sign(car.v) * dec; }
    if (inp.hand) car.v -= car.v * 2.2 * dt;
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    car.steerVis += (steer - car.steerVis) * Math.min(1, dt * 9);
    const turn = TURN * steer * clamp(Math.abs(car.v) / 9, 0, 1) * (inp.hand ? 1.5 : 1) * (car.v < 0 ? -1 : 1);
    car.a += turn * dt;
    // the velocity follows the heading with a lag that depends on grip: snow drifts
    const grip = (ri.road ? 1 : info.grip) * (inp.hand ? 0.45 : 1);
    const txv = Math.sin(car.a) * car.v, tzv = Math.cos(car.a) * car.v;
    const k = Math.min(1, dt * 11 * grip);
    car.vx += (txv - car.vx) * k; car.vz += (tzv - car.vz) * k;
    car.x += car.vx * dt; car.z += car.vz * dt;
    const moved = Math.hypot(car.vx, car.vz) * dt;
    S.dist += moved;
    S.score += moved * 0.1;
    // fuel
    const burn = (Math.abs(car.v) > 0.3 ? FUEL_IDLE + Math.abs(car.v) * FUEL_PER_UNIT : 0) * (S.lava ? 6 : 1) * dt;
    S.fuel = Math.max(0, S.fuel - burn);
    if (S.lava && Math.random() < dt * 30) S.particles.push({ x: 0.5 + (Math.random() - 0.5) * 0.2, y: 0.8, vx: (Math.random() - 0.5) * 0.3, vy: -0.5 - Math.random() * 0.4, g: 0.9, r: 2 + Math.random() * 2, c: Rand.pick([C.mint, C.lav, C.rose]), t: 0, max: 0.5 });
    if (S.fuel < 25 && !S.lowFuelWarned) { S.lowFuelWarned = true; showBanner('Low fuel', 'find a checkpoint (blue beacon) and answer to refuel', 2.6); Sound.play('wrong'); }
    if (S.fuel <= 0) { endRun(); return; }
    // dust off-road
    if (!ri.road && Math.abs(car.v) > 4 && Math.random() < dt * 25) S.particles.push({ x: 0.5 + (Math.random() - 0.5) * 0.16, y: 0.86, vx: (Math.random() - 0.5) * 0.25, vy: -0.15 - Math.random() * 0.2, g: 0.3, r: 2 + Math.random() * 3, c: biome === 'snow' ? '#ffffff' : biome === 'desert' ? '#e8c98a' : '#8a7a5a', t: 0, max: 0.5 });
    collide();
    collect();
    checkpoint();
  }

  /** Solid things push the car out and cost speed. */
  function collide() {
    const car = S.car;
    const { tx, tz } = tileAt(car.x, car.z);
    const things = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const o = tileObj(tx + dx, tz + dz); if (o && o.solid) things.push(o); }
    S.extra.forEach((o) => { if (o.solid && Math.abs(o.x - car.x) < 12 && Math.abs(o.z - car.z) < 12) things.push(o); });
    for (const o of things) {
      const dx = car.x - o.x, dz = car.z - o.z, d = Math.hypot(dx, dz), min = o.r + 1.1;
      if (d >= min) continue;
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      car.x = o.x + nx * min; car.z = o.z + nz * min;
      const hard = Math.abs(car.v) > 6;
      car.v = -car.v * 0.25; car.vx = nx * Math.abs(car.v); car.vz = nz * Math.abs(car.v);
      if (S.t - S.bumpAt > 0.4) { S.bumpAt = S.t; S.bumps++; S.shake = hard ? 0.8 : 0.3; Sound.play(hard ? 'hurt' : 'click'); burst(0.5, 0.75, hard ? 18 : 6, ['#c9c9c9', C.lav]); }
    }
  }
  function collect() {
    const car = S.car;
    const { tx, tz } = tileAt(car.x, car.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const o = tileObj(tx + dx, tz + dz);
      if (o && o.type === 'coin' && !S.taken.has(o.key) && Math.hypot(o.x - car.x, o.z - car.z) < 1.6) takeCoin(o);
    }
    S.extra.forEach((o) => { if (o.type === 'coin' && !o.taken && Math.hypot(o.x - car.x, o.z - car.z) < 1.6) { o.taken = true; takeCoin(o); } });
  }
  function takeCoin(o) {
    if (o.key) S.taken.add(o.key);
    S.coins++; S.score += COIN_PTS; S.fuel = Math.min(FUEL_MAX, S.fuel + COIN_FUEL);
    floatText(0.5, 0.62, '+' + COIN_PTS, C.lav);
    burst(0.5, 0.64, 10, [C.lav, C.mint]);
    Sound.play('coin');
  }
  function checkpoint() {
    const n = nearestInter(S.car.x, S.car.z);
    if (S.armed && S.armed !== n.key) S.armed = null;
    if (n.d > INTER_R + 6) { if (S.armed === n.key) S.armed = null; return; }
    if (n.d <= INTER_R && !S.cleared.has(n.key) && S.armed !== n.key) { S.armed = n.key; openQuestion(n); }
  }

  function updateFx(dt) {
    const car = S.car;
    // chase camera follows the heading smoothly
    let da = car.a - S.cam.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    S.cam.a += da * Math.min(1, dt * 5);
    S.cam.x = car.x - Math.sin(S.cam.a) * CAM_BACK; S.cam.z = car.z - Math.cos(S.cam.a) * CAM_BACK;
    // fog / sky drift toward the biome
    const tb = BIOMES[S.biome];
    const sk = hexRgb(tb.sky), kk = Math.min(1, dt * 1.5);
    for (let i = 0; i < 3; i++) { S.fogRGB[i] = lerp(S.fogRGB[i], tb.fog[i], kk); S.skyRGB[i] = lerp(S.skyRGB[i], sk[i], kk); }
    const fogKey = S.fogRGB.map((v) => Math.round(v / 6)).join(',');
    if (fogKey !== colorCacheFog) { colorCacheFog = fogKey; colorCache.clear(); }
    S.shake = Math.max(0, S.shake - dt * 2.6);
    S.flash = Math.max(0, S.flash - dt * 2.4);
    for (let i = S.particles.length - 1; i >= 0; i--) { const p = S.particles[i]; p.t += dt; if (p.t >= p.max) { S.particles.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    for (let i = S.floats.length - 1; i >= 0; i--) { const f = S.floats[i]; f.t += dt; if (f.t >= f.max) S.floats.splice(i, 1); }
    if (S.banner && S.t >= S.banner.until) clearBanner();
  }
  function burst(fx, fy, n, colors) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = 0.25 + Math.random() * 0.5; S.particles.push({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.2, g: 0.9, r: 1.5 + Math.random() * 3, c: colors[i % colors.length], t: 0, max: 0.5 + Math.random() * 0.5 }); }
    if (S.particles.length > 300) S.particles.splice(0, S.particles.length - 300);
  }
  function floatText(fx, fy, text, c) { S.floats.push({ fx, fy, text, c, t: 0, max: 0.9 }); }

  /* ------------------------------------------------------------
     Frame loop, sizing, HUD
     ------------------------------------------------------------ */
  function resizeCanvas() {
    if (!S || !D) return;
    const w = Math.max(240, Math.round(D.stage.clientWidth));
    const vh = window.innerHeight || 900;
    let hh = w < 640 ? Math.round(clamp(w * 1.0, 320, 440)) : Math.round(clamp(Math.min(w * 0.52, vh - 330), 320, 560));
    if (vh < 480 && navigator.maxTouchPoints > 0) hh = Math.max(200, Math.min(hh, vh - 180));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (D.canvas.width !== Math.round(w * dpr) || D.canvas.height !== Math.round(hh * dpr)) { D.canvas.width = Math.round(w * dpr); D.canvas.height = Math.round(hh * dpr); }
    D.canvas.style.height = hh + 'px';
    D.stage.style.height = hh + 'px';
    S.view = { w, h: hh, dpr, cw: w };
    VIEW = w < 640 ? 66 : 84;
  }
  function frame(now) {
    if (!S || !D) return;
    rafId = requestAnimationFrame(frame);
    if (D.stage.clientWidth !== S.view.cw) resizeCanvas();
    const dt = S.lastT ? Math.min(MAX_DT, (now - S.lastT) / 1000) : 0;
    S.lastT = now;
    if (S.mode !== 'pause') { S.anim += dt; updateFx(dt); }
    if (S.mode === 'play') { S.t += dt; if (!S.frozen) updateCar(dt); }
    else if (S.mode === 'ending') { S.t += dt; const c = S.car; c.v *= Math.max(0, 1 - dt * 2.5); c.vx *= Math.max(0, 1 - dt * 2.5); c.vz *= Math.max(0, 1 - dt * 2.5); c.x += c.vx * dt; c.z += c.vz * dt; if (S.t >= S.endAt) gameOver(); }
    else if (S.mode === 'intro' || S.mode === 'over') { S.t += dt; S.cam.a += dt * 0.12; S.cam.x = S.car.x - Math.sin(S.cam.a) * CAM_BACK; S.cam.z = S.car.z - Math.cos(S.cam.a) * CAM_BACK; }   // the camera circles the car under the menu
    updateHud(false);
    render();
    drawMini();
  }
  function updateHud(force) {
    const c = S.hudCache;
    const set = (k, v, fn) => { if (force || c[k] !== v) { c[k] = v; fn(v); } };
    set('mode', S.mode, (v) => { D.shell.classList.toggle('is-playing', v === 'play' || v === 'question'); D.shell.dataset.mode = v; });
    set('score', Math.round(S.score), (v) => { D.hud.score.textContent = fmt(v); });
    set('fuel', Math.round(S.fuel), (v) => { D.hud.fuelVal.textContent = String(v); D.hud.fuelFill.style.width = v + '%'; D.hud.fuelItem.classList.toggle('is-low', v < 25); });
    set('speed', Math.round(Math.abs(S.car.v) * 6), (v) => { D.hud.speed.textContent = v + ' km/h'; });
    set('checks', S.checkpoints, (v) => { D.hud.checks.textContent = String(v); });
    set('coins', S.coins, (v) => { D.hud.coins.textContent = String(v); });
    set('biome', S.biome, (v) => { D.hud.biomeIcon.textContent = BIOMES[v].icon; D.hud.biomeName.textContent = BIOMES[v].name; });
    set('streak', S.streak, (v) => { D.hud.streak.textContent = v >= 2 ? '🔥 ' + v : String(v); D.hud.streakItem.classList.toggle('is-hot', v >= 2); });
  }

  /* ------------------------------------------------------------
     3D rendering
       camera space: f = depth along the view, r = right, y = up
       screen: sx = CX + r·F/f, sy = HY + (CAM_H − y)·F/f
     ------------------------------------------------------------ */
  let F = 400, HY = 160, CX = 320, SINA = 0, COSA = 1, RATIO = 1, VIEW = 84;   // VIEW = draw distance in world units (shorter on phones)
  function cs(x, y, z) { const dx = x - S.cam.x, dz = z - S.cam.z; return { f: dx * SINA + dz * COSA, r: dx * COSA - dz * SINA, y }; }
  function sp(p) { const s = F / p.f; return { x: CX + p.r * s, y: HY + (CAM_H - p.y) * s, s }; }
  const fogOf = (f) => Math.pow(clamp((f - 22) / (VIEW - 22), 0, 1), 1.3);
  /** Clip a camera-space polygon against the near plane (Sutherland–Hodgman on f ≥ NEAR). */
  function clipNear(poly) {
    let allIn = true, allOut = true;
    for (const p of poly) { if (p.f < NEAR) allIn = false; else allOut = false; }
    if (allIn) return poly;
    if (allOut) return null;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = a.f >= NEAR, bin = b.f >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) { const t = (NEAR - a.f) / (b.f - a.f); out.push({ f: NEAR, r: a.r + (b.r - a.r) * t, y: a.y + (b.y - a.y) * t }); }
    }
    return out.length >= 3 ? out : null;
  }
  function fillPoly(ctx, poly, fill) {
    const c = clipNear(poly); if (!c) return false;
    ctx.beginPath();
    for (let i = 0; i < c.length; i++) { const q = sp(c[i]); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    return true;
  }
  /** A box with its own yaw: 6 faces, the ones facing the camera drawn back to front, shaded by orientation. */
  function drawBox(ctx, cx, cz, yaw, hw, hl, y0, y1, colors, fog, glow) {
    const sa = Math.sin(yaw), ca = Math.cos(yaw);
    const W = (u, w, y) => ({ x: cx + u * ca + w * sa, y, z: cz - u * sa + w * ca });
    const P = [W(-hw, -hl, y0), W(hw, -hl, y0), W(hw, hl, y0), W(-hw, hl, y0), W(-hw, -hl, y1), W(hw, -hl, y1), W(hw, hl, y1), W(-hw, hl, y1)];
    const faces = [
      { i: [4, 5, 6, 7], n: [0, 1, 0], c: colors.top || colors.side, k: 1.22 },
      { i: [0, 1, 5, 4], n: [-sa, 0, -ca], c: colors.back || colors.side, k: 0.86 },   // -w: faces the camera when the box points away
      { i: [3, 2, 6, 7], n: [sa, 0, ca], c: colors.front || colors.side, k: 0.95 },
      { i: [0, 3, 7, 4], n: [-ca, 0, sa], c: colors.side, k: 0.72 },
      { i: [1, 2, 6, 5], n: [ca, 0, -sa], c: colors.side, k: 0.8 },
    ];
    const vis = [];
    for (const fc of faces) {
      const m = fc.i.reduce((acc, j) => ({ x: acc.x + P[j].x / 4, y: acc.y + P[j].y / 4, z: acc.z + P[j].z / 4 }), { x: 0, y: 0, z: 0 });
      const dot = fc.n[0] * (m.x - S.cam.x) + fc.n[1] * (m.y - CAM_H) + fc.n[2] * (m.z - S.cam.z);
      if (dot < 0) { const c = cs(m.x, m.y, m.z); vis.push({ fc, depth: c.f }); }
    }
    vis.sort((a, b) => b.depth - a.depth);
    for (const v of vis) {
      const poly = v.fc.i.map((j) => cs(P[j].x, P[j].y, P[j].z));
      fillPoly(ctx, poly, fogged(v.fc.c, fog, v.fc.k));
    }
  }
  const aabox = (ctx, x0, x1, y0, y1, z0, z1, colors, fog, glow) => drawBox(ctx, (x0 + x1) / 2, (z0 + z1) / 2, 0, (x1 - x0) / 2, (z1 - z0) / 2, y0, y1, typeof colors === 'string' ? { side: colors } : colors, fog, glow);

  function drawSky(ctx) {
    const { w, h: hh } = S.view;
    ctx.fillStyle = rgbStr(S.skyRGB.map(Math.round)); ctx.fillRect(0, 0, w, HY + 1);
    // stars (fixed to the view direction)
    const base = -S.cam.a / TAU * w * 2.2;
    for (let i = 0; i < 70; i++) {
      const fx = mod(h01(i, 3, 41) * w * 2.2 + base, w * 2.2) - w * 0.6, fy = h01(i, 4, 42) * HY * 0.7;
      if (fx < -2 || fx > w + 2) continue;
      ctx.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(S.anim * (0.8 + h01(i, 5, 43) * 2) + i));
      ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    // a low sun to the east (fixed in the world: it slides as you turn)
    let rel = Math.atan2(Math.sin(0.9 - S.cam.a), Math.cos(0.9 - S.cam.a));
    if (Math.abs(rel) < 1.1) {
      const r = Math.min(w, hh) * 0.14, sx = CX + Math.tan(rel) * F, sy = HY - r * 0.2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, HY); ctx.clip();
      ctx.fillStyle = C.mint; ctx.shadowColor = C.mint; ctx.shadowBlur = 40; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = rgbStr(S.skyRGB.map(Math.round)); for (let i = 0; i < 4; i++) ctx.fillRect(sx - r, sy + r * (0.15 + i * 0.2), r * 2, r * (0.03 + i * 0.03));
      ctx.restore();
    }
    // far mountains (two parallax layers, a function of view direction)
    const fogc = rgbStr(S.fogRGB.map(Math.round));
    [[0.5, 0.11, 61, 0.45], [1, 0.16, 62, 0.7]].forEach(([par, amp, salt, dark]) => {
      ctx.beginPath(); ctx.moveTo(0, HY + 2);
      for (let x = 0; x <= w; x += 16) {
        const az = (S.cam.a * par + (x - CX) / F) * 3.5;
        const hgt = (vnoise(az, 0, salt) * 0.7 + vnoise(az * 3, 1, salt) * 0.3) * amp * hh;
        ctx.lineTo(x, HY - hgt);
      }
      ctx.lineTo(w, HY + 2); ctx.closePath();
      const c = S.fogRGB.map((v) => Math.round(v * dark));
      ctx.fillStyle = rgbStr(c); ctx.fill();
    });
    ctx.fillStyle = fogc; ctx.fillRect(0, HY - 1, w, hh - HY + 1);
  }

  function drawWorld(ctx) {
    const R = Math.ceil(VIEW / TILE);
    const ctx0 = Math.floor(S.cam.x / TILE), ctz0 = Math.floor(S.cam.z / TILE);
    // camera-space corners of the lattice, computed once
    const n = 2 * R + 2, corners = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) corners[j * n + i] = cs((ctx0 - R + i) * TILE, 0, (ctz0 - R + j) * TILE);
    const tiles = [], objs = [];
    const biomeCache = new Map();
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = corners[j * n + i], b = corners[j * n + i + 1], c = corners[(j + 1) * n + i + 1], d = corners[(j + 1) * n + i];
      const fmax = Math.max(a.f, b.f, c.f, d.f);
      if (fmax < NEAR) continue;
      const lim = fmax * RATIO + TILE * 1.5;
      if (Math.min(a.r, b.r, c.r, d.r) > lim || Math.max(a.r, b.r, c.r, d.r) < -lim) continue;
      const favg = (a.f + b.f + c.f + d.f) / 4;
      if (favg > VIEW) continue;
      const tx = ctx0 - R + i, tz = ctz0 - R + j;
      tiles.push({ f: favg, tx, tz, poly: [a, b, c, d] });
    }
    tiles.sort((p, q) => q.f - p.f);
    for (const t of tiles) {
      const bx = Math.floor(t.tx / 3), bz = Math.floor(t.tz / 3), bk = bx + ',' + bz;
      let biome = biomeCache.get(bk);
      if (!biome) { biome = biomeAt(t.tx * TILE + TILE / 2, t.tz * TILE + TILE / 2); biomeCache.set(bk, biome); }
      const fog = fogOf(t.f);
      const o = tileObj(t.tx, t.tz);
      let col = tileColor(t.tx, t.tz, biome);
      if (o && o.type === 'lava') col = (hash(t.tx, t.tz, 5) & 1) ? '#ff7a1a' : '#ff9a2a';
      fillPoly(ctx, t.poly, fogged(col, fog, 1));
      if (o && o.type === 'lava' && fog < 0.9) { ctx.globalAlpha = 0.35 + 0.25 * Math.sin(S.anim * 3 + t.tx); fillPoly(ctx, t.poly, fogged('#ffd060', fog)); ctx.globalAlpha = 1; }
      if (o && o.type !== 'lava' && !(o.type === 'coin' && S.taken.has(o.key))) objs.push({ f: t.f, o, biome });
    }
    drawRoadMarks(ctx);
    // things with height, intersections' beacons, extras, the car — all sorted far to near
    const items = objs.map((it) => ({ f: it.f, draw: () => drawObject(ctx, it.o, fogOf(it.f), it.biome) }));
    S.extra.forEach((o) => { if (o.taken) return; const c = cs(o.x, 0, o.z); if (c.f > NEAR - 2 && c.f < VIEW) items.push({ f: c.f, draw: () => drawObject(ctx, o, fogOf(c.f), 'plains') }); });
    // intersections in view
    const i0 = Math.floor((S.cam.x - VIEW) / BLOCK), i1 = Math.ceil((S.cam.x + VIEW) / BLOCK), j0 = Math.floor((S.cam.z - VIEW) / BLOCK), j1 = Math.ceil((S.cam.z + VIEW) / BLOCK);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i * BLOCK + HALF, cz = j * BLOCK + HALF, c = cs(cx, 0, cz);
      if (c.f < NEAR - 8 || c.f > VIEW + 8) continue;
      items.push({ f: c.f, draw: () => drawIntersection(ctx, i, j, cx, cz, fogOf(Math.max(0, c.f))) });
    }
    const carC = cs(S.car.x, 0, S.car.z);
    items.push({ f: carC.f, draw: () => drawCar(ctx) });
    items.sort((p, q) => q.f - p.f).forEach((it) => it.draw());
  }

  function drawRoadMarks(ctx) {
    const dashP = 6, dashL = 2.6, hwid = 0.14;
    const col = (f) => fogged('#d6def2', fogOf(f), 1, 0.8);
    // north-south roads in view: centre line x = k·BLOCK + TILE
    for (let k = Math.floor((S.cam.x - VIEW) / BLOCK); k <= Math.ceil((S.cam.x + VIEW) / BLOCK); k++) {
      const x = k * BLOCK + HALF;
      for (let m = Math.floor((S.cam.z - VIEW) / dashP); m <= Math.ceil((S.cam.z + VIEW) / dashP); m++) {
        const z0 = m * dashP, z1 = z0 + dashL;
        if (mod(Math.floor(z0 / TILE), ROAD_EVERY) === 0 || mod(Math.floor(z1 / TILE), ROAD_EVERY) === 0) continue;   // not through intersections
        const c = cs(x, 0.02, z0); if (c.f > VIEW || c.f < -dashL) continue;
        if (Math.abs(c.r) > c.f * RATIO + 4) continue;
        fillPoly(ctx, [cs(x - hwid, 0.02, z0), cs(x + hwid, 0.02, z0), cs(x + hwid, 0.02, z1), cs(x - hwid, 0.02, z1)], col(c.f));
      }
      // edge lines
      [x - HALF, x + HALF].forEach((ex) => {
        for (let m = Math.floor((S.cam.z - VIEW) / 12); m <= Math.ceil((S.cam.z + VIEW) / 12); m++) {
          const z0 = m * 12, z1 = z0 + 12, c = cs(ex, 0.02, z0 + 6); if (c.f > VIEW + 6 || c.f < -8) continue;
          fillPoly(ctx, [cs(ex - 0.1, 0.02, z0), cs(ex + 0.1, 0.02, z0), cs(ex + 0.1, 0.02, z1), cs(ex - 0.1, 0.02, z1)], fogged(C.amber, fogOf(Math.max(0, c.f)), 1, 0.55));
        }
      });
    }
    // east-west roads: centre line z = k·BLOCK + TILE
    for (let k = Math.floor((S.cam.z - VIEW) / BLOCK); k <= Math.ceil((S.cam.z + VIEW) / BLOCK); k++) {
      const z = k * BLOCK + HALF;
      for (let m = Math.floor((S.cam.x - VIEW) / dashP); m <= Math.ceil((S.cam.x + VIEW) / dashP); m++) {
        const x0 = m * dashP, x1 = x0 + dashL;
        if (mod(Math.floor(x0 / TILE), ROAD_EVERY) === 0 || mod(Math.floor(x1 / TILE), ROAD_EVERY) === 0) continue;
        const c = cs(x0, 0.02, z); if (c.f > VIEW || c.f < -dashL) continue;
        if (Math.abs(c.r) > c.f * RATIO + 4) continue;
        fillPoly(ctx, [cs(x0, 0.02, z - hwid), cs(x1, 0.02, z - hwid), cs(x1, 0.02, z + hwid), cs(x0, 0.02, z + hwid)], col(c.f));
      }
      [z - HALF, z + HALF].forEach((ez) => {
        for (let m = Math.floor((S.cam.x - VIEW) / 12); m <= Math.ceil((S.cam.x + VIEW) / 12); m++) {
          const x0 = m * 12, x1 = x0 + 12, c = cs(x0 + 6, 0.02, ez); if (c.f > VIEW + 6 || c.f < -8) continue;
          fillPoly(ctx, [cs(x0, 0.02, ez - 0.1), cs(x1, 0.02, ez - 0.1), cs(x1, 0.02, ez + 0.1), cs(x0, 0.02, ez + 0.1)], fogged(C.amber, fogOf(Math.max(0, c.f)), 1, 0.55));
        }
      });
    }
  }

  function drawObject(ctx, o, fog, biome) {
    const x = o.x, z = o.z, v = o.v || 0.5;
    const far = fog > 0.45;
    if (far && (o.type === 'bush' || o.type === 'coin' || o.type === 'snowman')) return;
    switch (o.type) {
      case 'tree': {
        const hgt = 1.4 + v * 0.8, leaf = biome === 'snow' ? { side: '#2f6b3c', top: '#f4f8ff' } : { side: v < 0.5 ? '#2f8a3f' : '#3a9a48', top: '#5cc06a' };
        if (far) { aabox(ctx, x - 1.2, x + 1.2, 0, hgt + 2.2, z - 1.2, z + 1.2, leaf, fog); break; }
        aabox(ctx, x - 0.3, x + 0.3, 0, hgt, z - 0.3, z + 0.3, { side: '#6b4426', top: '#8a5a33' }, fog);
        aabox(ctx, x - 1.2, x + 1.2, hgt, hgt + 2.2, z - 1.2, z + 1.2, leaf, fog);
        if (v > 0.6) aabox(ctx, x - 0.7, x + 0.7, hgt + 2.2, hgt + 3.1, z - 0.7, z + 0.7, leaf, fog);
        break;
      }
      case 'pine': {
        if (far) { aabox(ctx, x - 1.0, x + 1.0, 0, 4.0, z - 1.0, z + 1.0, { side: '#245a35', top: '#f3f7ff' }, fog); break; }
        aabox(ctx, x - 0.25, x + 0.25, 0, 1.2, z - 0.25, z + 0.25, { side: '#5a3a22', top: '#7a5230' }, fog);
        aabox(ctx, x - 1.3, x + 1.3, 1.2, 2.3, z - 1.3, z + 1.3, { side: '#245a35', top: '#f3f7ff' }, fog);
        aabox(ctx, x - 0.9, x + 0.9, 2.3, 3.3, z - 0.9, z + 0.9, { side: '#2a6a3c', top: '#f3f7ff' }, fog);
        aabox(ctx, x - 0.45, x + 0.45, 3.3, 4.3, z - 0.45, z + 0.45, { side: '#2f7a44', top: '#ffffff' }, fog);
        break;
      }
      case 'bush': aabox(ctx, x - 0.8, x + 0.8, 0, 0.9, z - 0.7, z + 0.7, { side: '#2f8a3f', top: v < 0.5 ? '#ff8a2b' : '#5cc06a' }, fog); break;
      case 'cactus': {
        aabox(ctx, x - 0.35, x + 0.35, 0, 2.6 + v, z - 0.35, z + 0.35, { side: '#2f8f4a', top: '#4fb86a' }, fog);
        if (far) break;
        aabox(ctx, x - 1.1, x - 0.35, 1.2, 1.6, z - 0.25, z + 0.25, { side: '#2f8f4a', top: '#4fb86a' }, fog);
        aabox(ctx, x - 1.1, x - 0.75, 1.2, 2.4, z - 0.25, z + 0.25, { side: '#2f8f4a', top: '#4fb86a' }, fog);
        aabox(ctx, x + 0.35, x + 1.0, 1.6, 2.0, z - 0.25, z + 0.25, { side: '#2f8f4a', top: '#4fb86a' }, fog);
        aabox(ctx, x + 0.65, x + 1.0, 1.6, 2.6, z - 0.25, z + 0.25, { side: '#2f8f4a', top: '#4fb86a' }, fog);
        break;
      }
      case 'rock': aabox(ctx, x - 0.9 - v * 0.3, x + 0.9, 0, 0.9 + v * 0.6, z - 0.8, z + 0.8 + v * 0.3, o.dark ? { side: '#3a2a2a', top: '#5a3a36' } : { side: '#8a8f9a', top: '#b4b9c4' }, fog); break;
      case 'snowman': {
        aabox(ctx, x - 0.75, x + 0.75, 0, 1.3, z - 0.75, z + 0.75, { side: '#e9eef6', top: '#ffffff' }, fog);
        aabox(ctx, x - 0.5, x + 0.5, 1.3, 2.2, z - 0.5, z + 0.5, { side: '#eef2f8', top: '#ffffff' }, fog);
        aabox(ctx, x - 0.08, x + 0.08, 1.75, 1.9, z - 0.9, z - 0.5, { side: C.mint, top: C.lav }, fog);
        aabox(ctx, x - 0.45, x + 0.45, 2.2, 2.75, z - 0.45, z + 0.45, { side: '#1b1f2e', top: '#2a3044' }, fog);
        break;
      }
      case 'house': {
        const wall = v < 0.33 ? { side: '#c9a77a', top: '#d9b98c' } : v < 0.66 ? { side: '#b4582e', top: '#c56a3f' } : { side: '#9aa7c2', top: '#b5c0d8' };
        const roof = biome === 'snow' ? { side: '#eef3fb', top: '#ffffff' } : { side: '#7a2d2d', top: '#a03a3a' };
        aabox(ctx, x - 2.1, x + 2.1, 0, 2.6, z - 2.1, z + 2.1, wall, fog);
        aabox(ctx, x - 2.4, x + 2.4, 2.6, 3.2, z - 2.4, z + 2.4, roof, fog);
        if (far) break;
        aabox(ctx, x - 1.4, x + 1.4, 3.2, 3.9, z - 1.4, z + 1.4, roof, fog);
        // a lit window on the side facing the road
        const c = cs(x, 1.3, z - 2.11); if (c.f > NEAR) { const q = sp(c); ctx.fillStyle = fogged(C.lav, fog, 1, 0.9); ctx.fillRect(q.x - 0.35 * q.s, q.y - 0.3 * q.s, 0.7 * q.s, 0.6 * q.s); }
        break;
      }
      case 'coin': {
        const c = cs(x, 0.9, z); if (c.f < NEAR) return;
        const q = sp(c), r = 0.45 * q.s, wob = Math.abs(Math.cos(S.anim * 4 + x));
        const sh = sp(cs(x, 0, z)); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sh.x, sh.y, r * 0.9, r * 0.22, 0, 0, TAU); ctx.fill();
        ctx.save(); ctx.translate(q.x, q.y); ctx.scale(Math.max(0.15, wob), 1);
        ctx.fillStyle = fogged(C.lav, fog); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.fillStyle = fogged('#fff2cc', fog, 1, 0.85); ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.fill();
        ctx.restore();
        break;
      }
      default: break;
    }
  }

  function drawIntersection(ctx, i, j, cx, cz, fog) {
    const key = i + ',' + j, cleared = S.cleared.has(key);
    // four stop signs on the corners, just off the asphalt
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const px = cx + sx * (HALF + 1.0), pz = cz + sz * (HALF + 1.0);
      const base = cs(px, 0, pz); if (base.f < NEAR + 0.5 || base.f > VIEW) return;
      const top = cs(px, 2.6, pz), b = sp(base), t = sp(top);
      ctx.strokeStyle = fogged('#9aa3b8', fog); ctx.lineWidth = Math.max(1, 0.12 * t.s); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      const r = Math.max(2, 0.62 * t.s);
      ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; const px2 = t.x + Math.cos(a) * r, py2 = t.y - r * 0.1 + Math.sin(a) * r; if (k) ctx.lineTo(px2, py2); else ctx.moveTo(px2, py2); } ctx.closePath();
      ctx.fillStyle = fogged(cleared ? '#8a2a35' : C.rose, fog); ctx.fill(); ctx.strokeStyle = fogged('#ffffff', fog, 1, 0.9); ctx.lineWidth = Math.max(1, r * 0.1); ctx.stroke();
      if (r > 9) { ctx.fillStyle = fogged('#ffffff', fog); ctx.font = '800 ' + Math.round(r * 0.62) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', t.x, t.y - r * 0.1); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; }
    });
    // the beacon: a tall translucent pillar of light (blue until cleared, then orange)
    const c0 = cs(cx, 0, cz); if (c0.f < NEAR + 0.5) return;
    const col = cleared ? C.mint : C.amber;
    const pulse = cleared ? 0.35 : 0.45 + 0.2 * Math.sin(S.anim * 3);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse * (1 - fog * 0.7);
    aabox(ctx, cx - 0.6, cx + 0.6, 0, 14, cz - 0.6, cz + 0.6, { side: col, top: '#ffffff' }, fog);
    ctx.globalAlpha = 1; ctx.restore();
    const g = sp(c0); ctx.strokeStyle = fogged(col, fog, 1, 0.8); ctx.lineWidth = Math.max(1, 0.08 * g.s); ctx.beginPath(); ctx.ellipse(g.x, g.y, 3.2 * g.s, 3.2 * g.s * 0.32, 0, 0, TAU); ctx.stroke();
  }

  function drawCar(ctx) {
    const car = S.car, a = car.a, x = car.x, z = car.z;
    const sa = Math.sin(a), ca = Math.cos(a);
    const W = (u, w) => ({ x: x + u * ca + w * sa, z: z - u * sa + w * ca });
    // shadow + underglow
    const sh = cs(x, 0.01, z); if (sh.f > NEAR) { const q = sp(sh); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.5 * q.s, 0.55 * q.s, 0, 0, TAU); ctx.fill(); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(77,163,255,0.22)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.3 * q.s, 0.45 * q.s, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    const tyre = { side: '#14181f', top: '#2a3040' };
    const steerA = car.steerVis * 0.45;
    // headlights first: seen from behind they are the farthest part of the car
    [[-0.55, 2.2], [0.55, 2.2]].forEach(([u, w]) => { const p = W(u, w); drawBox(ctx, p.x, p.z, a, 0.18, 0.05, 0.42, 0.56, { side: '#fff3c4', top: '#fff8dc' }, 0); });
    [[-0.95, 1.25, steerA], [0.95, 1.25, steerA], [-0.95, -1.25, 0], [0.95, -1.25, 0]].forEach(([u, w, s]) => { const p = W(u, w); drawBox(ctx, p.x, p.z, a + s, 0.22, 0.42, 0, 0.62, tyre, 0); });
    const body = { side: '#1d4fd3', top: '#3c78ff', front: '#2a62ea', back: '#153f9f' };
    drawBox(ctx, x, z, a, 0.92, 1.95, 0.3, 0.82, body, 0, C.amber);
    const nose = W(0, 1.95); drawBox(ctx, nose.x, nose.z, a, 0.8, 0.28, 0.3, 0.6, { side: '#1d4fd3', top: '#3c78ff', front: '#2a62ea', back: '#1d4fd3' }, 0);
    const cab = W(0, -0.15); drawBox(ctx, cab.x, cab.z, a, 0.72, 0.95, 0.82, 1.42, { side: '#7cc4ff', top: '#1b3f9a', front: '#a8e0ff', back: '#8fd0ff' }, 0);
    const sp1 = W(-0.7, -1.75), sp2 = W(0.7, -1.75);
    drawBox(ctx, sp1.x, sp1.z, a, 0.07, 0.12, 0.82, 1.2, { side: '#111622', top: '#2a3044' }, 0); drawBox(ctx, sp2.x, sp2.z, a, 0.07, 0.12, 0.82, 1.2, { side: '#111622', top: '#2a3044' }, 0);
    const wing = W(0, -1.78); drawBox(ctx, wing.x, wing.z, a, 1.0, 0.16, 1.2, 1.32, { side: C.rose2, top: C.rose }, 0);
    // lights: tail (red) and head (warm), as small glowing boxes
    [[-0.62, -1.96], [0.62, -1.96]].forEach(([u, w]) => { const p = W(u, w); drawBox(ctx, p.x, p.z, a, 0.2, 0.05, 0.5, 0.66, { side: C.rose, top: '#ff8090' }, 0, C.rose); });
    // exhaust glow, brighter when accelerating
    const ex = cs(W(0, -2.0).x, 0.42, W(0, -2.0).z);
    if (ex.f > NEAR) { const q = sp(ex); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = 'rgba(77,163,255,' + (0.35 + (S.input.gas ? 0.4 : 0)) + ')'; ctx.shadowColor = C.amber; ctx.shadowBlur = 18; ctx.beginPath(); ctx.ellipse(q.x, q.y, 0.42 * q.s, 0.12 * q.s, 0, 0, TAU); ctx.fill(); ctx.restore(); }
  }

  function drawFx(ctx) {
    const { w, h: hh } = S.view;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    S.particles.forEach((p) => { const k = 1 - p.t / p.max; ctx.fillStyle = p.c; ctx.globalAlpha = k * 0.9; ctx.beginPath(); ctx.arc(p.x * w, p.y * hh, p.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill(); });
    ctx.restore(); ctx.globalAlpha = 1;
    S.floats.forEach((f) => { const k = f.t / f.max; ctx.globalAlpha = 1 - k; ctx.font = '800 22px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6; ctx.fillStyle = f.c; ctx.fillText(f.text, f.fx * w, f.fy * hh - 50 * k); ctx.shadowBlur = 0; });
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    // compass + nearest checkpoint hint
    if (S.mode === 'play' || S.mode === 'question') {
      const n = nearestInter(S.car.x, S.car.z);
      let target = n;
      if (S.cleared.has(n.key)) {   // nearest open one among the neighbours
        let best = null;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const key = (n.i + di) + ',' + (n.j + dj); if (S.cleared.has(key)) continue; const cx = (n.i + di) * BLOCK + HALF, cz = (n.j + dj) * BLOCK + HALF, d = Math.hypot(cx - S.car.x, cz - S.car.z); if (!best || d < best.d) best = { cx, cz, d, key }; }
        target = best || n;
      }
      const ang = Math.atan2(target.cx - S.car.x, target.cz - S.car.z) - S.cam.a;
      const cxp = 54, cyp = hh - 54;
      ctx.fillStyle = 'rgba(6,10,22,0.6)'; ctx.beginPath(); ctx.arc(cxp, cyp, 26, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.translate(cxp, cyp); ctx.rotate(ang); ctx.fillStyle = S.cleared.has(target.key) ? C.mint : C.amber; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(7, 6); ctx.lineTo(0, 1); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.font = '700 11px ' + FONT; ctx.fillStyle = '#eef3ff'; ctx.textAlign = 'center'; ctx.fillText(Math.round(target.d) + ' m', cxp, cyp + 40); ctx.textAlign = 'left';
    }
  }

  function render() {
    const ctx = D.ctx;
    const { w, h: hh, dpr } = S.view;
    F = hh * 0.95; HY = Math.round(hh * 0.42); CX = w / 2; SINA = Math.sin(S.cam.a); COSA = Math.cos(S.cam.a); RATIO = (w / 2) / F + 0.05;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    if (S.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 12 * S.shake, (Math.random() - 0.5) * 8 * S.shake);
    drawSky(ctx);
    drawWorld(ctx);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFx(ctx);
    if (S.flash > 0) { ctx.fillStyle = fogged(S.flashColor, 0, 1, 0.3 * S.flash); ctx.fillRect(0, 0, w, hh); }
  }

  /** Minimap: biome tint, roads, checkpoints, the car. The biome layer is re-sampled only when the car has moved. */
  function drawMini() {
    const m = D.mctx, size = 132, scale = 0.55;   // px per world unit → ~240 units across
    const car = S.car;
    if (!S.mini || Math.hypot(S.mini.x - car.x, S.mini.z - car.z) > 10) {
      const off = S.mini && S.mini.c ? S.mini.c : document.createElement('canvas'); off.width = size; off.height = size;
      const o = off.getContext('2d'), step = 6;
      for (let py = 0; py < size; py += step) for (let px = 0; px < size; px += step) {
        const wx = car.x + (px + step / 2 - size / 2) / scale, wz = car.z - (py + step / 2 - size / 2) / scale;
        o.fillStyle = BIOMES[biomeAt(wx, wz)].ground[0]; o.fillRect(px, py, step, step);
      }
      S.mini = { x: car.x, z: car.z, c: off };
    }
    m.clearRect(0, 0, size, size);
    m.save(); m.beginPath(); m.arc(size / 2, size / 2, size / 2 - 1, 0, TAU); m.clip();
    m.globalAlpha = 0.85; m.drawImage(S.mini.c, 0, 0); m.globalAlpha = 1;
    const toPx = (wx, wz) => ({ x: size / 2 + (wx - car.x) * scale, y: size / 2 - (wz - car.z) * scale });
    m.strokeStyle = 'rgba(40,46,70,0.95)'; m.lineWidth = 3;
    for (let k = Math.floor((car.x - 140) / BLOCK); k <= Math.ceil((car.x + 140) / BLOCK); k++) { const p = toPx(k * BLOCK + HALF, 0); m.beginPath(); m.moveTo(p.x, 0); m.lineTo(p.x, size); m.stroke(); }
    for (let k = Math.floor((car.z - 140) / BLOCK); k <= Math.ceil((car.z + 140) / BLOCK); k++) { const p = toPx(0, k * BLOCK + HALF); m.beginPath(); m.moveTo(0, p.y); m.lineTo(size, p.y); m.stroke(); }
    for (let j = Math.floor((car.z - 140) / BLOCK); j <= Math.ceil((car.z + 140) / BLOCK); j++) for (let i = Math.floor((car.x - 140) / BLOCK); i <= Math.ceil((car.x + 140) / BLOCK); i++) {
      const p = toPx(i * BLOCK + HALF, j * BLOCK + HALF); m.fillStyle = S.cleared.has(i + ',' + j) ? C.mint : C.amber; m.beginPath(); m.arc(p.x, p.y, 3.2, 0, TAU); m.fill();
    }
    m.save(); m.translate(size / 2, size / 2); m.rotate(car.a); m.fillStyle = '#fff'; m.beginPath(); m.moveTo(0, -6); m.lineTo(4.5, 5); m.lineTo(0, 2.5); m.lineTo(-4.5, 5); m.closePath(); m.fill(); m.restore();
    m.restore();
    m.strokeStyle = 'rgba(255,255,255,0.35)'; m.lineWidth = 1.5; m.beginPath(); m.arc(size / 2, size / 2, size / 2 - 1, 0, TAU); m.stroke();
  }

  /* ------------------------------------------------------------
     Global listeners
     ------------------------------------------------------------ */
  const KEYS = { ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'hand' };
  function onKeyDown(e) {
    if (!S || !D) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A');
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (S.mode === 'play' || S.mode === 'pause') { e.preventDefault(); togglePause(); } return; }
    const k = KEYS[e.key];
    if (k && S.mode === 'play') { e.preventDefault(); S.input[k] = true; return; }
    if ((S.mode === 'intro' || S.mode === 'over') && e.key === 'Enter' && !onControl) { e.preventDefault(); startGame(); }
  }
  function onKeyUp(e) { if (!S) return; const k = KEYS[e.key]; if (k) S.input[k] = false; }
  function onBlur() { if (S) S.input = { gas: false, brake: false, left: false, right: false, hand: false }; }
  function onVisibility() { if (document.hidden && S && S.mode === 'play') pause(); }
  function onResize() { resizeCanvas(); }

  /* ------------------------------------------------------------
     Mount / unmount + registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Word Highway',
    tagline: 'Open-world 3D driving. Explore the biomes, answer at the checkpoints.',
    icon: '🏎️',
    accent: 'var(--c-amber)',
    accent2: '#ef3b4d',
    order: 6,
    mount(root) {
      S = newState(null);
      pickSeed();
      D = buildDom(root);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize);
      resizeCanvas();
      updateHud(true);
      showOverlay(introPanel(), 'g-highway-overlay-intro');
      focusLater('button.btn-primary');
      render(); drawMini();
      rafId = requestAnimationFrame(frame);
    },
    unmount() {
      cancelAnimationFrame(rafId); rafId = 0;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      clearTimers();
      closeQuestion();
      if (S && D && !S.saved && S.asked > 0) saveBest();   // leaving mid-run counts once a checkpoint has been reached
      hideOverlay();
      if (D && D.shell) D.shell.remove();
      S = null; D = null;
    },
  });

  /* ------------------------------------------------------------
     Debug hooks for tests
     ------------------------------------------------------------ */
  window.PQ.debug = window.PQ.debug || {};
  window.PQ.debug[ID] = {
    get state() { return S; },
    get dom() { return D; },
    get running() { return rafId !== 0; },
    start() { startGame(); },
    setInput(o) { if (S) Object.assign(S.input, o || {}); },
    teleport(x, z, a) { if (!S) return; S.car.x = x; S.car.z = z; if (a != null) S.car.a = a; S.car.v = 0; S.car.vx = 0; S.car.vz = 0; S.cam.a = S.car.a; S.cam.x = x - Math.sin(S.cam.a) * CAM_BACK; S.cam.z = z - Math.cos(S.cam.a) * CAM_BACK; S.armed = null; },
    car() { return S ? Object.assign({}, S.car) : null; },
    biomeAt(x, z) { return S ? biomeAt(x, z) : null; },
    /** Scan outward from the start for the nearest tile centre of a biome. */
    findBiome(name) { if (!S) return null; for (let r = 1; r < 120; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; const x = i * 16 + 4, z = j * 16 + 4; if (biomeAt(x, z) === name) return { x, z }; } return null; },
    nearestInter(x, z) { return S ? nearestInter(x == null ? S.car.x : x, z == null ? S.car.z : z) : null; },
    /** Add an ad-hoc coin or solid rock at a world position (tests). */
    spawn(type, x, z) { if (!S) return null; const o = { type, x, z, solid: type !== 'coin', r: type === 'coin' ? 0.6 : 1.0, v: 0.5, taken: false, id: ++S.uid }; S.extra.push(o); return o.id; },
    setFuel(n) { if (S) { S.fuel = clamp(Number(n) || 0, 0, FUEL_MAX); updateHud(false); } },
    forceKind(k) { if (S) S.forceKind = k || null; },
    /** Close an open checkpoint question without answering (the checkpoint stays open). */
    dismiss() { if (!S || !S.question) return false; closeQuestion(); S.mode = 'play'; S.lastT = 0; return true; },
    freeze(on) { if (S) S.frozen = on !== false; },
    tileObj(tx, tz) { return S ? tileObj(tx, tz) : null; },
    pause() { if (S) pause(); },
    resume() { if (S) resume(); },
  };
})();
