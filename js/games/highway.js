/* ============================================================
   SPANISH VOCAB — Word Highway  (game id: 'highway')
   A 3D lane runner, drawn with a perspective projection on a plain
   canvas (no libraries). You drive a hover car down a neon highway;
   every gate row shows an English meaning and three Spanish spellings,
   one per lane. Steer into the lane with the correct spelling.

   Rules
     correct gate        points × streak multiplier, a speed boost
     accent-only slip    −1 life, the correct spelling is shown and spoken
     wrong gate          −1 life, same reveal
     barrier             −1 life, you slow down (no word result)
     coin                bonus points
     0 lives             game over (score, gates, stage, missed words)

   Every gate row records exactly one Progress result for its word.
   Words come from Progress.pick on Vocab.active(), weakest first;
   the distractors are accent traps from Quiz.choice.
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, Quiz, UI, Sound, Speech, Rand } = PQ;
  const h = UI.h;

  const ID = 'highway';
  const LIVES = 3;
  const LANE_W = 2.6;                       // world units between lane centres
  const ROAD_HW = LANE_W * 1.5 + 0.6;       // half width of the asphalt
  const CAM_H = 2.2;                        // camera height above the road
  const PZ = 4.6;                           // the car's depth in front of the camera (keeps it above the option strip)
  const Z_FAR = 96;                         // draw / spawn distance
  const SPEED0 = 12, SPEED_MAX = 32;        // world units per second
  const SPEED_STEP = 1.0;                   // gained per correct gate
  const SLOW_HIT = 5;                       // lost on a barrier / wrong gate
  const FIRST_ROW_Z = 70;                   // the first row appears here
  const GATE_H = 2.5, PLATE_W = 2.3, PLATE_H = 0.8;
  const COIN_PTS = 25, GATE_PTS = 100, STAGE_ROWS = 5;
  const HUD_MSG = 2.8;                      // s the reveal stays in the HUD
  const ENDING = 1.2;                       // s between the last life and the game-over panel
  const MAX_DT = 0.05;
  const TAU = Math.PI * 2;
  const FONT = "'Times New Roman', Times, 'Liberation Serif', serif";
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const C = { amber: '#4da3ff', amber2: '#2b7fe6', mint: '#ff8a2b', lav: '#ffb347', rose: '#ef3b4d', rose2: '#c92233', white: '#ffffff' };
  const SKY = [5, 8, 24];                    // fog / sky colour (rgb)

  let S = null, D = null, rafId = 0, timers = [];

  function later(fn, ms) { const id = setTimeout(() => { timers = timers.filter((t) => t !== id); if (S && D) fn(); }, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const fmt = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const uniqById = (list) => { const seen = new Set(); return list.filter((e) => !seen.has(e.id) && seen.add(e.id)); };
  const laneX = (lane) => lane * LANE_W;
  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  /** Colour mixed toward the sky by `fog` (0 = none, 1 = gone), with alpha. */
  function fogged(hex, fog, a) { const c = hexRgb(hex); const r = Math.round(lerp(c[0], SKY[0], fog)), g = Math.round(lerp(c[1], SKY[1], fog)), b = Math.round(lerp(c[2], SKY[2], fog)); return 'rgba(' + r + ',' + g + ',' + b + ',' + (a == null ? 1 : a) + ')'; }
  function shade(hex, k) { const c = hexRgb(hex).map((v) => clamp(Math.round(v * k), 0, 255)); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }
  function roundRect(ctx, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /** Static scenery: stars and a distant skyline, as fractions so resizing is free. */
  function makeScene() {
    const rng = Rand.seeded((Date.now() & 0xffff) + 3);
    const stars = [];
    for (let i = 0; i < 90; i++) stars.push({ fx: rng(), fy: rng() * 0.36, s: 0.6 + rng() * 1.4, p: rng() * TAU, k: 0.8 + rng() * 2 });
    const towers = [];
    let fx = 0;
    while (fx < 1) { const fw = 0.02 + rng() * 0.05; towers.push({ fx, fw, fh: 0.03 + rng() * 0.11, lit: rng() < 0.7 }); fx += fw + 0.004; }
    return { stars, towers };
  }

  function newState(prev) {
    return {
      mode: 'intro',           // intro | play | pause | ending | over
      t: 0, anim: prev ? prev.anim : 0, lastT: prev ? prev.lastT : 0,
      view: prev ? prev.view : { w: 0, h: 0, dpr: 1, cw: 0 },
      scene: prev ? prev.scene : makeScene(),
      score: 0, lives: LIVES, streak: 0, bestStreak: 0, stage: 1,
      speed: SPEED0, boost: 0, dist: 0,
      lane: 0, px: 0, camX: 0, bank: 0,
      rows: [],                // gate rows: { id, z, entry, options:[{text, correct, lane}], result, recorded }
      objs: [],                // coins / barriers: { id, type, lane, z, taken }
      nextRowZ: FIRST_ROW_Z,
      gates: 0, correct: 0, slips: 0, wrongs: 0, coins: 0, crashes: 0,
      missed: [], recent: [],
      hudMsg: null, banner: null,
      particles: [], floats: [], shake: 0, flash: 0, flashColor: C.rose, endAt: 0,
      frozen: false, saved: false, isNewBest: false, uid: 0, hudCache: {},
    };
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  function bestLabel() { const g = Progress.gameStats(ID); return g.best ? 'Best ' + fmt(g.best) + (g.gates ? ' · ' + g.gates + ' gates' : '') : 'No best yet'; }

  function buildDom(root) {
    const best = h('span.g-highway-best', null, bestLabel());
    const pauseBtn = h('button.btn.btn-outline.btn-sm.g-highway-pausebtn', { type: 'button', title: 'Pause (Esc)', onclick: () => { if (S && (S.mode === 'play' || S.mode === 'pause')) togglePause(); } }, '⏸ Pause');
    const topbar = h('div.game-topbar', null,
      h('div.game-title', null, h('span.icon', null, '🏎️'), h('span', null, 'Word Highway', h('span.g-highway-tag', null, 'Steer into the gate with the right spelling'))),
      h('div.row', null, best, pauseBtn));

    const hearts = [];
    for (let i = 0; i < LIVES; i++) hearts.push(h('span.g-highway-heart', { 'aria-hidden': 'true' }, '♥'));
    const score = h('span.val', null, '0');
    const speed = h('span.val', null, '0');
    const stage = h('span.val', null, '1');
    const streak = h('span.val', null, '0');
    const streakItem = h('div.hud-item.g-highway-streak', null, h('span.label', null, 'Streak'), streak);
    const msgEn = h('span.g-highway-hudmsg-en');
    const msgEs = h('b.g-highway-hudmsg-es');
    const speak = h('button.g-highway-hudmsg-speak', { type: 'button', title: 'Hear it', 'aria-label': 'Hear the word', onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); if (S && S.hudMsg) Speech.say(S.hudMsg.base); } }, '🔊');
    const msg = h('div.g-highway-hudmsg', { role: 'status' }, h('span.g-highway-hudmsg-icon', null, '🚧'), h('span.g-highway-hudmsg-text', null, msgEn, h('span.g-highway-hudmsg-arrow', null, '→'), msgEs), speak);
    const hud = h('div.hud.g-highway-hud', null,
      h('div.hud-item', null, h('span.label', null, 'Score'), score),
      h('div.hud-item', null, h('span.label', null, 'Speed'), speed),
      h('div.hud-item', null, h('span.label', null, 'Stage'), stage),
      h('div.hud-item', null, h('span.label', null, 'Lives'), h('span.g-highway-hearts', { 'aria-label': 'lives' }, hearts)),
      streakItem,
      h('div.hud-spacer'));

    const canvas = h('canvas.g-highway-canvas', { 'aria-label': 'Word Highway: a three-lane road in perspective' });
    const banner = h('div.g-highway-banner', { 'aria-live': 'polite' });
    const stage3d = h('div.game-stage.g-highway-stage', null, canvas, banner, msg);
    stage3d.addEventListener('pointerdown', onStagePointer);

    const btnL = h('button.touch-btn', { type: 'button', 'aria-label': 'Steer left', onpointerdown: (e) => { e.preventDefault(); steer(-1); } }, '◀');
    const btnR = h('button.touch-btn', { type: 'button', 'aria-label': 'Steer right', onpointerdown: (e) => { e.preventDefault(); steer(1); } }, '▶');
    const touch = h('div.touch-controls.g-highway-touch', null, h('div.tc-group', null, btnL), h('div.small.muted.g-highway-touch-hint', null, 'tap a side of the road to change lane'), h('div.tc-group', null, btnR));
    const help = h('div.small.muted.g-highway-help', null, '← → or A / D to change lane · 1 2 3 jump to a lane · Esc pauses');

    const shell = h('div.game-shell.g-highway', null, topbar, hud, stage3d, touch, help);
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0) shell.classList.add('g-highway-is-touch');
    root.appendChild(shell);
    return { shell, stage: stage3d, canvas, ctx: canvas.getContext('2d'), banner, best, pauseBtn, overlay: null, hud: { score, speed, stage, hearts, streak, streakItem, msg, msgEn, msgEs } };
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
      h('p.text-2', null, 'Each gate row shows an English meaning and three Spanish spellings. Steer into the lane with the correct one.'),
      h('div.g-highway-legend', null,
        h('div', null, h('b', null, '⇆'), 'Arrow keys, A / D, or tap a side of the road'),
        h('div', null, h('b', null, 'á'), 'Only one spelling has its accents right'),
        h('div', null, h('b', null, '🚧'), 'Dodge barriers · 3 lives'),
        h('div', null, h('b', null, '◉'), 'Coins are bonus points · streaks multiply')),
      g.best ? h('div.small.muted.g-highway-intro-best', null, '🏆 ' + bestLabel()) : null,
      h('div.row.g-highway-actions', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '▶ Drive')));
  }

  function pausePanel() {
    return h('div.panel.g-highway-pause', null,
      h('div.eyebrow', null, 'Paused'), h('h2', null, 'Paused'),
      h('p.text-2', null, 'Score ' + fmt(S.score) + ' · stage ' + S.stage + ' · ' + S.lives + (S.lives === 1 ? ' life' : ' lives') + ' left'),
      h('div.row.g-highway-actions', null,
        h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: resume }, '▶ Resume'),
        h('button.btn.btn-outline', { type: 'button', onclick: startGame }, '↻ Restart'),
        h('a.btn.btn-ghost', { href: '#/' }, 'Home')));
  }

  const statEl = (label, val) => h('div.stat', null, h('div.stat-val', null, String(val)), h('div.stat-label', null, label));

  function overPanel() {
    const accuracy = S.gates ? Math.round(S.correct / S.gates * 100) : 100;
    const missed = uniqById(S.missed);
    const list = missed.length
      ? h('div.g-highway-missed', null, missed.map((e) => h('div.g-highway-missed-row', null, h('span.en', null, e.en), h('span.es', { html: Text.highlightAccents(e.answers[0]) }),
          Speech.enabled() ? h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Hear it', onclick: () => Speech.say(e.base) }, '🔊') : null)))
      : h('p.small.muted', null, 'Every gate you took was the right one.');
    return h('div.panel.g-highway-over', null,
      h('div.eyebrow', null, 'Game over'), h('h2', null, 'Out of lives'),
      h('div.big.grad-text', null, fmt(S.score)),
      S.isNewBest ? h('div.g-highway-newbest', null, 'New best score') : h('div.small.muted', null, bestLabel()),
      h('div.stat-grid', null, statEl('Gates', S.correct + '/' + S.gates), statEl('Stage', S.stage), statEl('Accuracy', accuracy + '%'), statEl('Best streak', S.bestStreak)),
      h('div.row.g-highway-actions', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '↻ Drive again'), h('a.btn.btn-ghost', { href: '#/' }, 'Home')),
      missed.length ? h('div.g-highway-missed-title', null, missed.length + (missed.length === 1 ? ' word to review' : ' words to review')) : null,
      list);
  }

  /* ------------------------------------------------------------
     Run flow
     ------------------------------------------------------------ */
  function startGame() {
    if (!S || !D) return;
    hideOverlay();
    S = newState(S);
    S.mode = 'play';
    D.stage.classList.remove('is-hit');
    updateHud(true);
    showBanner('Stage 1', 'steer into the right spelling', 1.6);
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

  /** Next word: weak-weighted, never one of the last few. */
  function nextEntry() {
    const all = Vocab.active();
    const recent = S.recent.slice(-Math.min(4, Math.max(0, all.length - 1)));
    const picked = Progress.pick(1, { exclude: recent })[0] || Rand.pick(all);
    S.recent.push(picked.id);
    return picked;
  }

  function spawnRow(z, entry) {
    entry = entry || nextEntry();
    const q = Quiz.choice(entry, { options: 3 });
    const options = q.options.slice(0, 3).map((o, i) => ({ text: o.text, correct: !!o.correct, lane: i - 1 }));
    const row = { id: ++S.uid, z, entry, options, result: null, recorded: false };
    S.rows.push(row);
    return row;
  }

  /** Coins and barriers between this row and the next; a barrier always leaves a free lane and never sits near a gate. */
  function spawnFillers(z0, gap) {
    const stage = S.stage;
    // a run of coins down one lane
    const coinLane = Rand.pick([-1, 0, 1]);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) S.objs.push({ id: ++S.uid, type: 'coin', lane: coinLane, z: z0 + 9 + i * 2.6, taken: false });
    // barriers in the middle of the gap: 1 from stage 1, 2 from stage 3 (always one lane free)
    const nb = stage >= 3 ? 2 : 1;
    if (gap > 26) {
      const lanes = Rand.shuffle([-1, 0, 1]).slice(0, nb);
      lanes.forEach((lane) => S.objs.push({ id: ++S.uid, type: 'barrier', lane, z: z0 + gap * 0.58 + (Math.random() - 0.5) * 3, taken: false }));
    }
  }

  function rowGap() { return Math.max(40, S.speed * 3.3); }

  function spawnAhead() {
    while (S.nextRowZ <= Z_FAR) {
      const gap = rowGap();
      spawnRow(S.nextRowZ);
      spawnFillers(S.nextRowZ, gap);
      S.nextRowZ += gap;
    }
  }

  /* ------------------------------------------------------------
     Steering
     ------------------------------------------------------------ */
  function steer(dir) {
    if (!S || S.mode !== 'play') return;
    const to = clamp(S.lane + dir, -1, 1);
    if (to === S.lane) return;
    S.lane = to;
    Sound.play('tick');
  }
  function setLane(lane) {
    if (!S || S.mode !== 'play') return;
    lane = clamp(lane | 0, -1, 1);
    if (lane !== S.lane) { S.lane = lane; Sound.play('tick'); }
  }
  function onStagePointer(e) {
    if (!S || S.mode !== 'play' || !D) return;
    if (e.target && e.target.closest && e.target.closest('button')) return;
    e.preventDefault();
    const r = D.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (fy > 0.82) setLane(fx < 1 / 3 ? -1 : fx < 2 / 3 ? 0 : 1);      // the option strip: pick that lane directly
    else steer(fx < 0.5 ? -1 : 1);
  }

  /* ------------------------------------------------------------
     Resolving gates, coins, barriers
     ------------------------------------------------------------ */
  function resolveRow(row) {
    const chosen = row.options.find((o) => o.lane === S.lane) || row.options[1];
    const entry = row.entry;
    S.gates++;
    row.result = { chosen: chosen.lane, correctLane: (row.options.find((o) => o.correct) || {}).lane };
    if (chosen.correct) {
      S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); S.correct++;
      const mult = 1 + Math.floor(S.streak / 3) * 0.5;
      const pts = Math.round(GATE_PTS * S.stage * mult);
      S.score += pts;
      S.speed = Math.min(SPEED_MAX, S.speed + SPEED_STEP);
      S.boost = 1;
      S.flash = 0.5; S.flashColor = C.amber;
      floatText(0.5, 0.42, '+' + pts, C.white);
      burst(0.5, 0.5, 26, [C.amber, C.white, C.mint]);
      if (!row.recorded) { row.recorded = true; const rec = Progress.record(entry.id, 'correct'); if (rec.levelUp) later(() => { Sound.play('levelup'); UI.toast('Level ' + rec.level + ' reached', 'ok'); }, 350); }
      Progress.noteStreak(S.streak);
      Sound.play(S.streak % 5 === 0 ? 'levelup' : 'correct');
      if (S.correct % STAGE_ROWS === 0) { S.stage++; S.score += 150 * S.stage; showBanner('Stage ' + S.stage, 'faster road · +' + (150 * S.stage) + ' bonus', 1.8); Sound.play('win'); }
    } else {
      const r = Text.check(chosen.text, entry.answers, entry.answers[0]);
      const status = r.status === 'accent' ? 'accent' : 'wrong';
      if (status === 'accent') S.slips++; else S.wrongs++;
      if (!row.recorded) { row.recorded = true; Progress.record(entry.id, status); }
      S.missed.push(entry);
      S.hudMsg = { key: row.id, en: entry.en, es: entry.answers[0], base: entry.base, until: S.t + HUD_MSG };
      Speech.say(entry.base);
      loseLife(status === 'accent' ? 'accent' : 'wrong');
    }
  }

  function loseLife(why) {
    S.streak = 0;
    S.speed = Math.max(SPEED0, S.speed - SLOW_HIT);
    S.shake = 1; S.flash = 1; S.flashColor = C.rose;
    Sound.play(why === 'accent' ? 'accent' : 'wrong');
    later(() => Sound.play('hurt'), 90);
    D.stage.classList.add('is-hit'); later(() => D.stage.classList.remove('is-hit'), 520);
    S.lives--;
    const heart = D.hud.hearts[S.lives];
    if (heart) { heart.classList.add('is-lost'); later(() => heart.classList.remove('is-lost'), 700); }
    if (S.lives <= 0) endRun();
  }

  function takeCoin(o) {
    o.taken = true; S.coins++;
    const pts = COIN_PTS * S.stage;
    S.score += pts;
    floatText(0.5 + o.lane * 0.12, 0.6, '+' + pts, C.lav);
    burst(0.5 + o.lane * 0.12, 0.62, 10, [C.lav, C.mint]);
    Sound.play('coin');
  }

  function hitBarrier(o) {
    o.taken = true; S.crashes++;
    burst(0.5, 0.62, 30, [C.rose, C.white, C.lav]);
    floatText(0.5, 0.5, 'crash', C.rose);
    Sound.play('explode');
    loseLife('crash');
  }

  function endRun() { S.mode = 'ending'; S.endAt = S.t + ENDING; clearBanner(); Sound.play('lose'); }
  function saveBest() {
    if (S.saved) return;
    S.saved = true;
    S.isNewBest = Progress.setBest(ID, S.score, null, { gates: S.correct, stage: S.stage });
    D.best.textContent = bestLabel();
  }
  function gameOver() {
    S.mode = 'over';
    saveBest();
    S.hudMsg = null;
    showOverlay(overPanel(), 'g-highway-overlay-over');
    focusLater('button.btn-primary');
    if (S.isNewBest && S.score > 0) later(() => { UI.confetti({ count: 140 }); Sound.play('win'); }, 250);
  }

  function togglePause() { if (S.mode === 'play') pause(); else if (S.mode === 'pause') resume(); }
  function pause() { if (S.mode !== 'play') return; S.mode = 'pause'; showOverlay(pausePanel(), 'g-highway-overlay-pause'); Sound.play('click'); focusLater('button.btn-primary'); }
  function resume() { if (S.mode !== 'pause') return; S.mode = 'play'; hideOverlay(); Sound.play('click'); }

  /* ------------------------------------------------------------
     Simulation
     ------------------------------------------------------------ */
  function updatePlay(dt, harmless) {
    const v = S.frozen ? 0 : S.speed * (1 + 0.35 * S.boost);
    S.dist += v * dt;
    S.nextRowZ -= v * dt;
    for (const r of S.rows) r.z -= v * dt;
    for (const o of S.objs) o.z -= v * dt;
    if (!harmless) spawnAhead();
    // crossings
    for (const r of S.rows) if (!r.result && r.z <= PZ) { if (harmless) r.result = { chosen: null, correctLane: null }; else resolveRow(r); }
    for (const o of S.objs) {
      if (o.taken || o.z > PZ + 0.6 || o.z < PZ - 0.9) continue;
      if (o.lane !== S.lane || Math.abs(S.px - laneX(S.lane)) > 1.1) continue;
      if (harmless) { o.taken = true; continue; }
      if (o.type === 'coin') takeCoin(o); else hitBarrier(o);
    }
    S.rows = S.rows.filter((r) => r.z > -2);
    S.objs = S.objs.filter((o) => o.z > -1);
    if (S.banner && S.t >= S.banner.until) clearBanner();
  }

  function updateMotion(dt) {
    const target = laneX(S.lane);
    const prev = S.px;
    S.px += (target - S.px) * Math.min(1, dt * 9);
    S.bank = clamp((S.px - prev) / Math.max(dt, 1e-3) * 0.06, -1, 1);
    S.camX += (S.px * 0.55 - S.camX) * Math.min(1, dt * 6);
    S.boost = Math.max(0, S.boost - dt * 1.2);
    S.shake = Math.max(0, S.shake - dt * 2.6);
    S.flash = Math.max(0, S.flash - dt * 2.4);
    for (let i = S.particles.length - 1; i >= 0; i--) { const p = S.particles[i]; p.t += dt; if (p.t >= p.max) { S.particles.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    for (let i = S.floats.length - 1; i >= 0; i--) { const f = S.floats[i]; f.t += dt; if (f.t >= f.max) S.floats.splice(i, 1); }
    // engine glow particles
    if (S.mode === 'play' && Math.random() < dt * 40) {
      const p = proj(S.px + (Math.random() - 0.5) * 0.9, 0.35, PZ + 0.9);
      S.particles.push({ x: p.x / S.view.w, y: p.y / S.view.h, vx: (Math.random() - 0.5) * 0.08, vy: 0.25 + Math.random() * 0.3, g: 0.2, r: 1.5 + Math.random() * 2, c: Math.random() < 0.7 ? C.amber : C.mint, t: 0, max: 0.3 + Math.random() * 0.3 });
    }
  }

  function burst(fx, fy, n, colors) {
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = 0.25 + Math.random() * 0.5; S.particles.push({ x: fx, y: fy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.2, g: 0.9, r: 1.5 + Math.random() * 3, c: colors[i % colors.length], t: 0, max: 0.5 + Math.random() * 0.5 }); }
    if (S.particles.length > 300) S.particles.splice(0, S.particles.length - 300);
  }
  function floatText(fx, fy, text, c) { S.floats.push({ fx, fy, text, c, t: 0, max: 0.9 }); }

  /* ------------------------------------------------------------
     Frame loop + canvas sizing
     ------------------------------------------------------------ */
  function resizeCanvas() {
    if (!S || !D) return;
    const w = Math.max(240, Math.round(D.stage.clientWidth));
    const vh = window.innerHeight || 900;
    let hh = w < 640 ? Math.round(clamp(w * 1.05, 320, 440)) : Math.round(clamp(Math.min(w * 0.5, vh - 330), 320, 540));
    if (vh < 480 && navigator.maxTouchPoints > 0) hh = Math.max(200, Math.min(hh, vh - 180));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (D.canvas.width !== Math.round(w * dpr) || D.canvas.height !== Math.round(hh * dpr)) { D.canvas.width = Math.round(w * dpr); D.canvas.height = Math.round(hh * dpr); }
    D.canvas.style.height = hh + 'px';
    D.stage.style.height = hh + 'px';
    S.view = { w, h: hh, dpr, cw: w };
  }

  function frame(now) {
    if (!S || !D) return;
    rafId = requestAnimationFrame(frame);
    if (D.stage.clientWidth !== S.view.cw) resizeCanvas();
    const dt = S.lastT ? Math.min(MAX_DT, (now - S.lastT) / 1000) : 0;
    S.lastT = now;
    if (S.mode !== 'pause') { S.anim += dt; updateMotion(dt); }
    if (S.mode === 'play') { S.t += dt; updatePlay(dt, false); }
    else if (S.mode === 'ending') { S.t += dt; S.speed = Math.max(0, S.speed - dt * 14); updatePlay(dt, true); if (S.t >= S.endAt) gameOver(); }
    else if (S.mode === 'intro' || S.mode === 'over') { S.dist += dt * 4; }   // the road keeps drifting under the menu
    updateHud(false);
    render();
  }

  function updateHud(force) {
    const c = S.hudCache;
    const set = (k, v, fn) => { if (force || c[k] !== v) { c[k] = v; fn(v); } };
    set('mode', S.mode, (v) => { D.shell.classList.toggle('is-playing', v === 'play'); D.shell.dataset.mode = v; });
    set('score', S.score, (v) => { D.hud.score.textContent = fmt(v); });
    set('speed', Math.round(S.speed * 7), (v) => { D.hud.speed.textContent = v + ' km/h'; });
    set('stage', S.stage, (v) => { D.hud.stage.textContent = String(v); });
    set('lives', S.lives, (v) => D.hud.hearts.forEach((el, i) => el.classList.toggle('is-off', i >= v)));
    set('streak', S.streak, (v) => { D.hud.streak.textContent = v >= 3 ? '🔥 ' + v : String(v); D.hud.streakItem.classList.toggle('is-hot', v >= 3); });
    const msgOn = S.hudMsg && S.t < S.hudMsg.until && (S.mode === 'play' || S.mode === 'ending');
    set('msg', msgOn ? S.hudMsg.key : 0, (v) => {
      if (!v) { D.hud.msg.classList.remove('is-on'); return; }
      D.hud.msgEn.textContent = S.hudMsg.en; D.hud.msgEs.innerHTML = Text.highlightAccents(S.hudMsg.es);
      D.hud.msg.classList.remove('is-on'); void D.hud.msg.offsetWidth; D.hud.msg.classList.add('is-on');
    });
  }

  /* ------------------------------------------------------------
     3D rendering — a perspective projection onto the canvas.
       world: x across the road, y up (road at 0), z depth from the camera
       proj(x, y, z) → screen pixels; F is the focal length, hy the horizon line
     ------------------------------------------------------------ */
  let F = 400, HY = 160, CX = 320;
  function proj(x, y, z) { const s = F / Math.max(0.05, z); return { x: CX + (x - S.camX) * s, y: HY + (CAM_H - y) * s, s }; }
  const fogOf = (z) => clamp((z - 18) / (Z_FAR - 18), 0, 1) * 0.92;

  function quad(ctx, a, b, c, d, fill) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }

  /** A shaded box: front face (nearest z), top face and the side that faces the camera. */
  function drawBox(ctx, x0, x1, y0, y1, z0, z1, hex, fog, glow) {
    const fF = fogged(hex, fog), fT = fogged(shade(hex, 1.25), fog), fS = fogged(shade(hex, 0.7), fog);
    const p = (x, y, z) => proj(x, y, z);
    // top
    quad(ctx, p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), fT);
    // visible side
    if (S.camX < x0) quad(ctx, p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), p(x0, y0, z0), fS);
    else if (S.camX > x1) quad(ctx, p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0), p(x1, y0, z0), fS);
    // front
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 12 * (1 - fog); }
    quad(ctx, p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), fF);
    ctx.shadowBlur = 0;
  }

  function drawSky(ctx) {
    const { w, h: hh } = S.view;
    ctx.fillStyle = '#05081a'; ctx.fillRect(0, 0, w, HY + 2);
    // stars
    S.scene.stars.forEach((s) => { ctx.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(S.anim * s.k + s.p)); ctx.fillStyle = '#fff'; ctx.fillRect(s.fx * w, s.fy * HY, s.s, s.s); });
    ctx.globalAlpha = 1;
    // a low neon sun behind the skyline, cut by dark bands
    const r = Math.min(w, hh) * 0.17, sx = CX - S.camX * 6, sy = HY - r * 0.25;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, HY); ctx.clip();
    ctx.fillStyle = C.mint; ctx.shadowColor = C.mint; ctx.shadowBlur = 40; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#05081a';
    for (let i = 0; i < 5; i++) { const y = sy + r * (0.1 + i * 0.2); ctx.fillRect(sx - r, y, r * 2, r * (0.03 + i * 0.025)); }
    ctx.restore();
    // skyline
    S.scene.towers.forEach((t) => { const tw = t.fw * w, th = t.fh * hh, tx = t.fx * w - S.camX * 10; ctx.fillStyle = '#0a1030'; ctx.fillRect(tx, HY - th, tw, th + 2); if (t.lit) { ctx.fillStyle = 'rgba(77,163,255,0.55)'; for (let y = HY - th + 4; y < HY - 4; y += 7) ctx.fillRect(tx + 2, y, Math.max(1, tw - 4), 2); } });
    // ground beyond the road
    ctx.fillStyle = '#070b1c'; ctx.fillRect(0, HY, w, hh - HY);
  }

  function drawRoad(ctx) {
    const SEG = 4, dashP = 6, dashL = 3;
    const base = S.dist;
    // asphalt in stripes, far to near
    let z = Z_FAR;
    const zStep = (z) => Math.max(0.6, z * 0.06);
    while (z > 0.4) {
      const z0 = Math.max(0.4, z - zStep(z)), z1 = z;
      const k = Math.floor((base + z0) / SEG) % 2;
      const fog = fogOf(z0);
      const col = fogged(k ? '#10172e' : '#0c1226', fog);
      quad(ctx, proj(-ROAD_HW, 0, z1), proj(ROAD_HW, 0, z1), proj(ROAD_HW, 0, z0), proj(-ROAD_HW, 0, z0), col);
      // shoulders
      quad(ctx, proj(-ROAD_HW - 1.6, 0, z1), proj(-ROAD_HW, 0, z1), proj(-ROAD_HW, 0, z0), proj(-ROAD_HW - 1.6, 0, z0), fogged('#0b1024', fog));
      quad(ctx, proj(ROAD_HW, 0, z1), proj(ROAD_HW + 1.6, 0, z1), proj(ROAD_HW + 1.6, 0, z0), proj(ROAD_HW, 0, z0), fogged('#0b1024', fog));
      z = z0;
    }
    // lane dashes
    [-LANE_W / 2, LANE_W / 2].forEach((x) => {
      let k = Math.floor((base + 0.4) / dashP);
      for (; ; k++) {
        const zs = k * dashP - base, ze = zs + dashL;
        if (zs > Z_FAR) break;
        if (ze < 0.4) continue;
        const z0 = Math.max(0.4, zs), z1 = Math.min(Z_FAR, ze);
        quad(ctx, proj(x - 0.06, 0.01, z1), proj(x + 0.06, 0.01, z1), proj(x + 0.06, 0.01, z0), proj(x - 0.06, 0.01, z0), fogged('#9fb3d9', fogOf(z0), 0.7));
      }
    });
    // glowing edge lines
    [-ROAD_HW, ROAD_HW].forEach((x) => {
      const a = proj(x, 0.01, Z_FAR), b = proj(x, 0.01, 0.4);
      ctx.strokeStyle = C.amber; ctx.lineWidth = 2.2; ctx.shadowColor = C.amber; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.shadowBlur = 0;
    });
    // lamp posts scrolling past on both sides
    const postP = 10;
    for (let k = Math.floor((base + 0.4) / postP); ; k++) {
      const z = k * postP - base;
      if (z > Z_FAR) break;
      if (z < 0.6) continue;
      const fog = fogOf(z);
      [-1, 1].forEach((side) => {
        const x = side * (ROAD_HW + 1.2);
        const a = proj(x, 0, z), b = proj(x, 3.4, z);
        ctx.strokeStyle = fogged('#2a3a6a', fog); ctx.lineWidth = Math.max(1, 3 * a.s / F * 2.2); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = fogged(side < 0 ? C.mint : C.amber, fog); ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(1.2, 0.18 * b.s), 0, TAU); ctx.fill();
      });
    }
  }

  function plateFont(px) { return '800 ' + px + 'px ' + FONT; }

  function drawGateRow(ctx, row) {
    const fog = fogOf(row.z);
    row.options.forEach((o) => {
      const lx = laneX(o.lane);
      let col = '#1c2a5a', glow = null, plate = 'rgba(8,12,28,0.9)', border = 'rgba(180,200,255,0.55)';
      if (row.result) {
        if (o.correct) { col = C.amber2; glow = C.amber; border = C.amber; }
        else if (row.result.chosen === o.lane) { col = C.rose2; glow = C.rose; border = C.rose; }
      }
      drawBox(ctx, lx - 1.05, lx - 0.85, 0, GATE_H, row.z, row.z + 0.35, col, fog, glow);
      drawBox(ctx, lx + 0.85, lx + 1.05, 0, GATE_H, row.z, row.z + 0.35, col, fog, glow);
      drawBox(ctx, lx - 1.05, lx + 1.05, GATE_H - 0.22, GATE_H, row.z, row.z + 0.35, col, fog, glow);
      // the word plate hangs from the bar (a billboard, kept readable with a minimum font size)
      const c = proj(lx, GATE_H * 0.62, row.z);
      const pw = Math.min(PLATE_W * c.s, 190), ph = Math.min(PLATE_H * c.s, 56);   // capped so a row right at the car does not fill the screen
      const fs = Math.min(30, 0.36 * c.s);
      ctx.globalAlpha = 1 - fog * 0.6;
      roundRect(ctx, c.x - pw / 2, c.y - ph / 2, pw, ph, Math.min(10, ph / 3));
      ctx.fillStyle = plate; ctx.fill();
      ctx.lineWidth = row.result && (o.correct || row.result.chosen === o.lane) ? 2 : 1; ctx.strokeStyle = border; ctx.stroke();
      if (fs >= 9) {   // far plates are just shapes; the strip at the bottom carries the words until they are close
        ctx.font = plateFont(fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = row.result && o.correct ? C.amber : row.result && row.result.chosen === o.lane ? C.rose : '#eef3ff';
        let text = o.text;
        while (ctx.measureText(text).width > pw - 10 && text.length > 3) text = text.slice(0, -2) + '…';
        ctx.fillText(text, c.x, c.y + 1);
      }
      ctx.globalAlpha = 1;
    });
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawCoin(ctx, o) {
    const fog = fogOf(o.z);
    const c = proj(laneX(o.lane), 0.75, o.z);
    const r = 0.36 * c.s, wobble = Math.abs(Math.cos(S.anim * 5 + o.id));
    ctx.save(); ctx.translate(c.x, c.y); ctx.scale(Math.max(0.15, wobble), 1);
    ctx.fillStyle = fogged(C.lav, fog); ctx.shadowColor = C.lav; ctx.shadowBlur = 14 * (1 - fog);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = fogged('#fff2cc', fog, 0.8); ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.fill();
    ctx.restore();
    // shadow on the road
    const s = proj(laneX(o.lane), 0, o.z);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, r * 0.9, r * 0.25, 0, 0, TAU); ctx.fill();
  }

  function drawBarrier(ctx, o) {
    const fog = fogOf(o.z), lx = laneX(o.lane);
    drawBox(ctx, lx - 1.0, lx + 1.0, 0, 0.95, o.z, o.z + 0.5, C.rose2, fog, C.rose);
    // white hazard bands on the front face
    for (let i = 0; i < 3; i++) {
      const x0 = lx - 0.85 + i * 0.62, x1 = x0 + 0.3;
      quad(ctx, proj(x0, 0.15, o.z), proj(x1, 0.15, o.z), proj(x1 - 0.1, 0.8, o.z), proj(x0 - 0.1, 0.8, o.z), fogged('#f3f4ff', fog, 0.9));
    }
    const a = proj(lx - 1.0, 1.05, o.z), b = proj(lx + 1.0, 1.05, o.z);
    ctx.fillStyle = fogged(C.rose, fog); [a, b].forEach((p) => { ctx.shadowColor = C.rose; ctx.shadowBlur = 10 * (1 - fog); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 0.1 * p.s), 0, TAU); ctx.fill(); });
    ctx.shadowBlur = 0;
  }

  function drawCar(ctx) {
    const x = S.px, bank = REDUCED ? 0 : S.bank;
    // shadow
    const s = proj(x, 0, PZ);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, 0.8 * s.s, 0.22 * s.s, 0, 0, TAU); ctx.fill();
    // body (a low wedge) + cabin, leaning into the turn
    const y0 = 0.28 + Math.abs(bank) * 0.03, lift = bank * 0.12;
    drawBox(ctx, x - 0.7, x + 0.7, y0, y0 + 0.42, PZ - 0.95, PZ + 0.95, '#1e4fd0', 0, C.amber);
    drawBox(ctx, x - 0.42 + lift, x + 0.42 + lift, y0 + 0.42, y0 + 0.78, PZ - 0.25, PZ + 0.75, '#102a70', 0, null);
    // tail lights + exhaust glow (the face toward the camera is the back of the car)
    const l1 = proj(x - 0.5, y0 + 0.24, PZ - 0.96), l2 = proj(x + 0.5, y0 + 0.24, PZ - 0.96);
    ctx.fillStyle = C.rose; ctx.shadowColor = C.rose; ctx.shadowBlur = 16;
    [l1, l2].forEach((p) => { roundRect(ctx, p.x - 0.14 * p.s, p.y - 0.05 * p.s, 0.28 * p.s, 0.1 * p.s, 3); ctx.fill(); });
    const ex = proj(x, y0 + 0.08, PZ - 0.96);
    ctx.fillStyle = C.amber; ctx.shadowColor = C.amber; ctx.shadowBlur = 22 + 14 * S.boost;
    roundRect(ctx, ex.x - 0.32 * ex.s, ex.y - 0.04 * ex.s, 0.64 * ex.s, 0.08 * ex.s, 3); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPrompt(ctx) {
    const { w } = S.view;
    const row = S.rows.find((r) => !r.result);
    if (!row || S.mode === 'intro' || S.mode === 'over') return;
    const fs = w < 480 ? 20 : 26;
    ctx.font = plateFont(fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = row.entry.en;
    const tw = ctx.measureText(label).width + 36;
    const pw = Math.min(w - 20, Math.max(tw, 160));
    roundRect(ctx, CX - pw / 2, 10, pw, fs + 34, 14);
    ctx.fillStyle = 'rgba(6,10,22,0.82)'; ctx.fill(); ctx.strokeStyle = 'rgba(77,163,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.font = '600 11px ' + FONT; ctx.fillStyle = C.amber; ctx.fillText('STEER INTO THE SPELLING OF', CX, 22);
    ctx.font = plateFont(fs); ctx.fillStyle = '#eef3ff';
    let text = label; while (ctx.measureText(text).width > pw - 24 && text.length > 4) text = text.slice(0, -2) + '…';
    ctx.fillText(text, CX, 24 + fs / 2 + 8);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /** The three options of the next row, lane by lane, at the bottom of the canvas (always readable, tappable). */
  function drawStrip(ctx) {
    const { w, h: hh } = S.view;
    const row = S.rows.find((r) => !r.result) || S.rows.find((r) => r.result && r.z > PZ - 2);
    if (!row || S.mode === 'intro' || S.mode === 'over') return;
    const pad = 8, cw = (w - pad * 4) / 3, chH = w < 480 ? 40 : 46, y = hh - chH - pad;
    const fs = w < 480 ? 14 : 17;
    row.options.forEach((o, i) => {
      const x = pad + i * (cw + pad);
      const mine = o.lane === S.lane;
      let fill = mine ? 'rgba(77,163,255,0.22)' : 'rgba(6,10,22,0.78)', stroke = mine ? C.amber : 'rgba(255,255,255,0.18)', color = '#eef3ff';
      if (row.result) { if (o.correct) { fill = 'rgba(77,163,255,0.3)'; stroke = C.amber; color = C.amber; } else if (row.result.chosen === o.lane) { fill = 'rgba(239,59,77,0.25)'; stroke = C.rose; color = C.rose; } }
      roundRect(ctx, x, y, cw, chH, 12); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = mine ? 2 : 1; ctx.strokeStyle = stroke; ctx.stroke();
      ctx.font = plateFont(fs); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
      let text = o.text; while (ctx.measureText(text).width > cw - 16 && text.length > 3) text = text.slice(0, -2) + '…';
      ctx.fillText(text, x + cw / 2, y + chH / 2 + 1);
    });
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawFx(ctx) {
    const { w, h: hh } = S.view;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    S.particles.forEach((p) => { const k = 1 - p.t / p.max; ctx.fillStyle = p.c; ctx.globalAlpha = k; ctx.beginPath(); ctx.arc(p.x * w, p.y * hh, p.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill(); });
    ctx.globalAlpha = 1;
    // speed lines while boosting
    if (S.boost > 0.05 && !REDUCED) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 * S.boost) + ')'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + S.anim * 0.3; const r0 = Math.min(w, hh) * 0.45, r1 = r0 + 80 * S.boost; ctx.beginPath(); ctx.moveTo(CX + Math.cos(a) * r0, HY + 40 + Math.sin(a) * r0); ctx.lineTo(CX + Math.cos(a) * r1, HY + 40 + Math.sin(a) * r1); ctx.stroke(); }
    }
    ctx.restore();
    S.floats.forEach((f) => { const k = f.t / f.max; ctx.globalAlpha = 1 - k; ctx.font = '800 22px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6; ctx.fillStyle = f.c; ctx.fillText(f.text, f.fx * w, f.fy * hh - 50 * k); ctx.shadowBlur = 0; });
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function render() {
    const ctx = D.ctx;
    const { w, h: hh, dpr } = S.view;
    F = hh * 0.95; HY = Math.round(hh * 0.40); CX = w / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    if (S.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 12 * S.shake, (Math.random() - 0.5) * 8 * S.shake);
    drawSky(ctx);
    drawRoad(ctx);
    // everything with depth, far to near; the car sits at PZ
    const items = [];
    S.rows.forEach((r) => items.push({ z: r.z, draw: () => drawGateRow(ctx, r) }));
    S.objs.forEach((o) => { if (!o.taken || o.type === 'barrier') items.push({ z: o.z, draw: () => (o.type === 'coin' ? drawCoin(ctx, o) : drawBarrier(ctx, o)) }); });
    items.push({ z: PZ, draw: () => drawCar(ctx) });
    items.sort((a, b) => b.z - a.z).forEach((it) => { if (it.z > 0.3) it.draw(); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFx(ctx);
    drawPrompt(ctx);
    drawStrip(ctx);
    if (S.flash > 0) { ctx.fillStyle = fogged(S.flashColor, 0, 0.35 * S.flash); ctx.fillRect(0, 0, w, hh); }
  }

  /* ------------------------------------------------------------
     Global listeners
     ------------------------------------------------------------ */
  function onKeyDown(e) {
    if (!S || !D) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A');
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { if (S.mode === 'play' || S.mode === 'pause') { e.preventDefault(); togglePause(); } return; }
    if (S.mode === 'play') {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { e.preventDefault(); steer(-1); }
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { e.preventDefault(); steer(1); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') { e.preventDefault(); setLane(Number(e.key) - 2); }
      return;
    }
    if ((S.mode === 'intro' || S.mode === 'over') && (e.key === 'Enter' || e.key === ' ') && !onControl) { e.preventDefault(); startGame(); }
  }
  function onVisibility() { if (document.hidden && S && S.mode === 'play') pause(); }
  function onResize() { resizeCanvas(); }

  /* ------------------------------------------------------------
     Mount / unmount + registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Word Highway',
    tagline: 'Drive a 3D highway and steer into the right spelling.',
    icon: '🏎️',
    accent: 'var(--c-amber)',
    accent2: '#ef3b4d',
    order: 6,
    mount(root) {
      S = newState(null);
      D = buildDom(root);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('resize', onResize);
      resizeCanvas();
      updateHud(true);
      showOverlay(introPanel(), 'g-highway-overlay-intro');
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
      if (S && D && !S.saved && S.gates > 0) saveBest();   // leaving mid-run counts once a gate has been taken
      hideOverlay();
      if (D && D.shell) D.shell.remove();
      S = null; D = null;
    },
  });

  /* ------------------------------------------------------------
     Debug hooks for tests
     ------------------------------------------------------------ */
  const rowInfo = (r) => ({ id: r.id, entryId: r.entry.id, en: r.entry.en, z: Math.round(r.z * 100) / 100, options: r.options.map((o) => ({ text: o.text, correct: o.correct, lane: o.lane })), result: r.result, recorded: r.recorded });
  window.PQ.debug = window.PQ.debug || {};
  window.PQ.debug[ID] = {
    get state() { return S; },
    get dom() { return D; },
    get running() { return rafId !== 0; },
    start() { startGame(); },
    steer(dir) { steer(dir); },
    setLane(l) { setLane(l); },
    /** The nearest unresolved gate row (what the player is driving toward). */
    nextRow() { const r = S && S.rows.find((x) => !x.result); return r ? rowInfo(r) : null; },
    listRows() { return S ? S.rows.map(rowInfo) : []; },
    listObjs() { return S ? S.objs.map((o) => ({ id: o.id, type: o.type, lane: o.lane, z: Math.round(o.z * 100) / 100, taken: o.taken })) : []; },
    /** Spawn a row for `entry` (object or id) at depth z (default 20) and return it. */
    spawnRow(entry, z) { if (!S || S.mode !== 'play') return null; if (typeof entry === 'string') entry = Vocab.byId(entry); const r = spawnRow(z == null ? 20 : z, entry); return rowInfo(r); },
    spawnObj(type, lane, z) { if (!S) return null; const o = { id: ++S.uid, type, lane: lane | 0, z: z == null ? 12 : z, taken: false }; S.objs.push(o); return o.id; },
    /** Move the whole world `dz` closer (negative pushes it away); crossings resolve on the next frame. */
    warp(dz) { if (!S) return; S.rows.forEach((r) => { r.z -= dz; }); S.objs.forEach((o) => { o.z -= dz; }); S.nextRowZ -= dz; },
    /** Drop every unresolved row and every coin / barrier, and hold off natural spawns (tests inject their own). */
    clearAhead() { if (!S) return; S.rows = S.rows.filter((r) => r.result); S.objs = []; S.nextRowZ = 500; },
    /** Snap the car onto its lane centre (so a crossing counts right away). */
    snap() { if (S) { S.px = laneX(S.lane); S.camX = S.px * 0.55; } },
    freeze(on) { if (S) S.frozen = on !== false; },
    setLives(n) { if (S) { S.lives = clamp(n | 0, 0, LIVES); updateHud(false); } },
    pause() { if (S) pause(); },
    resume() { if (S) resume(); },
  };
})();
