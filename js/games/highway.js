/* ============================================================
   SPANISH VOCAB — Word Highway  (game id: 'highway')
   An open-world driving game drawn in 3D on a plain canvas (a
   perspective projection with near-plane clipping, no libraries).
   The world is endless and procedural: five biomes (plains, forest,
   desert, snow, badlands) in blocky Minecraft-like tiles, a grid of
   roads, villages around the intersections, coins, trees, rocks,
   cacti, lava pools. You control the car completely: gas, brake,
   reverse, steering, handbrake and nitro.

   Districts and gates
     the world is cut into large districts by walls. Inside a district
     you can drive anywhere, on or off the road. The only way into the
     next district is a gate where a road crosses the wall: driving up
     to it stops the car and asks a question about one of the words
     (typed spelling, accent placement or a choice).
       correct       the barrier lifts, the beacon turns orange, +fuel, +nitro, points × streak
       accent slip   a little fuel, the barrier stays down, try again in a moment
       wrong         no fuel, try again in a moment
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
  const HALF = TILE / 2;
  const ROAD_EVERY = 11;                      // tiles between roads (88 units)
  const BLOCK = ROAD_EVERY * TILE;
  const DISTRICT = 3;                         // blocks per district side: a gate every 264 units along a road
  const DIST = DISTRICT * BLOCK;
  const WALL_OFF = HALF + BLOCK / 2;          // walls run mid-block, between two roads
  const GATE_R = 7.5;                         // question trigger distance from a gate
  const NEAR = 0.9;                           // near clipping plane (camera space)
  const CAM_BACK = 7.8, CAM_H = 3.1;          // chase camera: behind and above the car
  const MAX_SPEED = 34, REV_SPEED = 9, ACCEL = 16, BRAKE = 30, DRAG = 0.5, ROLL = 2.0;
  const KMH = 5;                              // display: km/h per world unit of speed
  const NITRO_SPEED = 1.5, NITRO_ACCEL = 2.0, NITRO_DRAIN = 28, NITRO_REFILL = 5;
  const TURN = 2.2;                           // rad/s at full speed
  const FUEL_MAX = 100, FUEL_IDLE = 0.45, FUEL_PER_UNIT = 0.018;
  const FUEL_REWARD = { correct: 55, accent: 20, wrong: 0 };
  const COIN_FUEL = 6, COIN_NITRO = 15, COIN_PTS = 25, GATE_PTS = 300, BIOME_PTS = 500;
  const ENDING = 1.4;
  const MAX_DT = 0.05;
  const TAU = Math.PI * 2;
  const FONT = "'Times New Roman', Times, 'Liberation Serif', serif";
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const C = { amber: '#4da3ff', amber2: '#2b7fe6', mint: '#ff8a2b', lav: '#ffb347', rose: '#ef3b4d', rose2: '#c92233', white: '#ffffff' };
  const CAR_COLORS = [
    { id: 'blue',   name: 'Blue',   hex: '#1d4fd3', stripe: '#ff8a2b' },
    { id: 'red',    name: 'Red',    hex: '#d92b3a', stripe: '#ffffff' },
    { id: 'orange', name: 'Orange', hex: '#ff7a1a', stripe: '#1d4fd3' },
    { id: 'green',  name: 'Green',  hex: '#1f9a4a', stripe: '#ffffff' },
    { id: 'white',  name: 'White',  hex: '#e8ecf5', stripe: '#1d4fd3' },
    { id: 'black',  name: 'Black',  hex: '#1b1f2b', stripe: '#ff8a2b' },
    { id: 'purple', name: 'Purple', hex: '#7c3aed', stripe: '#ffd27a' },
    { id: 'yellow', name: 'Yellow', hex: '#f5c518', stripe: '#1b1f2b' },
  ];
  const carColor = () => CAR_COLORS.find((c) => c.id === PQ.Settings.get('highwayCar')) || CAR_COLORS[0];

  const BIOMES = {
    plains:   { name: 'Plains',   icon: '🌿', ground: ['#3f9a4a', '#47a654', '#3a8d44'], sky: '#0a1230', fog: [12, 20, 52],  grip: 1,    speed: 0.72 },
    forest:   { name: 'Forest',   icon: '🌲', ground: ['#2b6e3a', '#2f7a40', '#276435'], sky: '#07161c', fog: [8, 24, 30],   grip: 1,    speed: 0.6 },
    desert:   { name: 'Desert',   icon: '🏜️', ground: ['#d9b26a', '#e1bb77', '#cfa860'], sky: '#2a1a12', fog: [48, 30, 20],  grip: 0.9,  speed: 0.66 },
    snow:     { name: 'Snow',     icon: '❄️', ground: ['#e6edf6', '#f1f5fb', '#dbe4ee'], sky: '#1b2a4a', fog: [36, 52, 86],  grip: 0.5,  speed: 0.78 },
    badlands: { name: 'Badlands', icon: '🌋', ground: ['#5a2a24', '#64302a', '#4e241f'], sky: '#2a0c10', fog: [48, 14, 18],  grip: 0.95, speed: 0.62 },
    city:     { name: 'City',     icon: '🏙️', ground: ['#3a3f52', '#40455a', '#363b4d'], sky: '#101a34', fog: [28, 36, 64],  grip: 1,    speed: 0.85 },
  };
  const ZONES = 6;
  const TOWER_COLS = {
    plains:   [{ side: '#5b6480', top: '#7d87a6' }, { side: '#6f7a9a', top: '#929dbd' }, { side: '#8a8470', top: '#aaa38c' }, { side: '#44506e', top: '#5f6c8c' }],
    forest:   [{ side: '#4f5a6e', top: '#6a7a8c' }, { side: '#5e6b80', top: '#7f8ea4' }, { side: '#6e6a5a', top: '#8c8774' }, { side: '#3e4a5e', top: '#55657c' }],
    desert:   [{ side: '#b89a6a', top: '#d4b885' }, { side: '#c9ad7a', top: '#e2c994' }, { side: '#a88a5c', top: '#c4a677' }, { side: '#8f7652', top: '#ad926c' }],
    snow:     [{ side: '#8f9bb3', top: '#f3f7ff' }, { side: '#a3aec4', top: '#ffffff' }, { side: '#7d8aa3', top: '#eef3fb' }, { side: '#6c7890', top: '#f6f9ff' }],
    badlands: [{ side: '#3a3038', top: '#54464e' }, { side: '#443842', top: '#5e4f58' }, { side: '#2f272d', top: '#473a40' }, { side: '#4a3a3a', top: '#64504e' }],
  };
  const PAVE = { plains: '#4b5168', forest: '#424a5c', desert: '#9a8a68', snow: '#c7cfdc', badlands: '#4a3a3a' };
  const WIN_LIT = { side: '#ffd27a', top: '#ffd27a' }, WIN_DARK = { side: '#20263a', top: '#20263a' };
  const ROAD_COL = ['#2a3047', '#2e354f'];
  const WALL = { side: '#6b7080', top: '#8b909f' }, WALL2 = { side: '#5a5f6e', top: '#7a7f8e' }, POST = { side: '#4a4f5e', top: '#9a9fae' };

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
  const colorCache = new Map();
  let colorCacheFog = '';
  /** Colour mixed toward the current fog by `fog` (0..1), optionally scaled by `k` (shading). Cached: thousands of polygons a frame. */
  function fogged(hex, fog, k, a) {
    k = k == null ? 1 : k;
    const fq = Math.round(fog * 12) / 12;
    const key = hex + '|' + fq + '|' + k + '|' + (a == null ? 1 : a);
    let v = colorCache.get(key);
    if (v) return v;
    const c = hexRgb(hex), F = S.fogRGB;
    v = 'rgba(' + Math.round(lerp(clamp(c[0] * k, 0, 255), F[0], fq)) + ',' + Math.round(lerp(clamp(c[1] * k, 0, 255), F[1], fq)) + ',' + Math.round(lerp(clamp(c[2] * k, 0, 255), F[2], fq)) + ',' + (a == null ? 1 : a) + ')';
    if (colorCache.size > 4000) colorCache.clear();
    colorCache.set(key, v);
    return v;
  }
  function shade(hex, k) { const c = hexRgb(hex).map((v) => clamp(Math.round(v * k), 0, 255)); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); }
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
  /** The natural biome: regions about a kilometre across. */
  function biomeAt(x, z) {
    const t = vnoise(x / 900, z / 900, 11) * 0.7 + vnoise(x / 260 + 7, z / 260 + 3, 12) * 0.3;
    const hm = vnoise(x / 900 + 37, z / 900 + 91, 13) * 0.7 + vnoise(x / 260 + 5, z / 260 + 9, 14) * 0.3;
    if (t < 0.37) return 'snow';
    if (t > 0.63) return hm < 0.5 ? 'desert' : 'badlands';
    return hm > 0.58 ? 'forest' : 'plains';
  }
  /** Cities are laid over whatever biome is there: a snow city, a desert city... */
  function cityAt(x, z) { return vnoise(x / 620 + 13, z / 620 + 29, 15) * 0.75 + vnoise(x / 170 + 3, z / 170 + 7, 16) * 0.25 > 0.66; }
  function roadInfo(tx, tz) { const ns = mod(tx, ROAD_EVERY) === 0, ew = mod(tz, ROAD_EVERY) === 0; return { road: ns || ew, ns, ew, inter: ns && ew }; }
  /** Does a district wall run along this tile's east (wx) or north (wz) edge, and is that stretch a gate (a road crossing)? */
  function wallInfo(tx, tz) {
    const ex = (tx + 1) * TILE, nz = (tz + 1) * TILE;                                   // the tile's east and north edges
    const wx = mod(ex - WALL_OFF, DIST) === 0, wz = mod(nz - WALL_OFF, DIST) === 0;
    const ri = roadInfo(tx, tz);
    return { wx, wz, gate: (wx && ri.ew) || (wz && ri.ns), lineX: ex, lineZ: nz };
  }
  function gateKey(axis, k, j) { return axis + ':' + k + ':' + j; }
  /** The nearest gate to a world point (open or cleared) and the nearest open one. Gates sit where a road crosses a wall. */
  function nearestGate(x, z) {
    let best = null, open = null;
    const consider = (axis, k, j) => {
      const gx = axis === 'x' ? k * DIST + WALL_OFF : j * BLOCK + HALF;
      const gz = axis === 'x' ? j * BLOCK + HALF : k * DIST + WALL_OFF;
      const g = { axis, k, j, key: gateKey(axis, k, j), x: gx, z: gz, d: Math.hypot(x - gx, z - gz) };
      if (!best || g.d < best.d) best = g;
      if (!S.cleared.has(g.key) && (!open || g.d < open.d)) open = g;
    };
    const kx = Math.round((x - WALL_OFF) / DIST), jz = Math.round((z - HALF) / BLOCK);
    const kz = Math.round((z - WALL_OFF) / DIST), jx = Math.round((x - HALF) / BLOCK);
    for (let dk = -1; dk <= 1; dk++) for (let dj = -2; dj <= 2; dj++) { consider('x', kx + dk, jz + dj); consider('z', kz + dk, jx + dj); }
    return { best, open };
  }

  /** What sits on a tile (cached): null, a solid thing, a coin, or a lava pool. */
  function tileObj(tx, tz) {
    const key = tx + ',' + tz;
    const cached = S.tileCache.get(key);
    if (cached !== undefined) return cached;
    if (S.tileCache.size > 6000) S.tileCache.clear();
    const ri = roadInfo(tx, tz), wi = wallInfo(tx, tz);
    const cx = tx * TILE + HALF, cz = tz * TILE + HALF;
    let obj = null;
    const byWall = wi.wx || wi.wz || wallInfo(tx - 1, tz).wx || wallInfo(tx, tz - 1).wz;
    if (byWall) obj = null;   // the tiles on both sides of a wall stay clear
    else if (ri.road) {
      const startZone = tx === 0 && tz >= -4 && tz <= -1;   // the car spawns here: no coin to grab before the first key press
      if (!ri.inter && !startZone && h01(tx, tz, 22) < 0.05) obj = { type: 'coin', solid: false, r: 0.6 };
    } else {
      const b = biomeAt(cx, cz), city = cityAt(cx, cz), r = h01(tx, tz, 21), v = h01(tx, tz, 23);
      const mx = mod(tx, ROAD_EVERY), mz = mod(tz, ROAD_EVERY);
      const shoulder = mx === 1 || mx === ROAD_EVERY - 1 || mz === 1 || mz === ROAD_EVERY - 1;   // kept clear next to roads
      const dx = Math.min(mx, ROAD_EVERY - mx), dz = Math.min(mz, ROAD_EVERY - mz);
      const nearWall = mod(cx - WALL_OFF, DIST) <= TILE || mod(cx - WALL_OFF, DIST) >= DIST - TILE || mod(cz - WALL_OFF, DIST) <= TILE || mod(cz - WALL_OFF, DIST) >= DIST - TILE;
      if (!shoulder && !nearWall) {
        if (city) { if (r < 0.6) obj = { type: 'tower', solid: true, r: 2.9, v, hgt: 6 + v * 16, c: hash(tx, tz, 24) % 4, lit: hash(tx, tz, 25) % 3, biome: b }; else if (r < 0.66) obj = { type: b === 'desert' ? 'cactus' : b === 'snow' ? 'pine' : 'tree', solid: true, r: 1.0, v }; }
        else if (dx <= 3 && dz <= 3 && r < 0.4 && b !== 'badlands') obj = { type: 'house', solid: true, r: 2.6, v, biome: b };
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
      if (!obj && !nearWall && h01(tx, tz, 22) < (city ? 0.06 : 0.035)) obj = { type: 'coin', solid: false, r: 0.6 };
    }
    if (obj) { obj.x = cx; obj.z = cz; obj.key = key; }
    S.tileCache.set(key, obj);
    return obj;
  }
  const tileColor = (tx, tz, biome, city) => {
    if (roadInfo(tx, tz).road) return ROAD_COL[(tx + tz) & 1];
    if (city) { const mx = mod(tx, ROAD_EVERY), mz = mod(tz, ROAD_EVERY); if (mx === 1 || mx === ROAD_EVERY - 1 || mz === 1 || mz === ROAD_EVERY - 1) return PAVE[biome]; }   // pavements in the biome's tone
    return BIOMES[biome].ground[hash(tx, tz, 31) % 3];
  };

  /* ------------------------------------------------------------
     State
     ------------------------------------------------------------ */
  function pickSeed() {   // a seed whose start area is plains, so the first drive is friendly
    for (let i = 0; i < 40; i++) { const seed = (Math.random() * 0x7fffffff) | 0; S.seed = seed; if (biomeAt(0, 0) === 'plains' && biomeAt(4, 40) === 'plains' && !cityAt(4, 0) && !cityAt(4, 60)) return seed; }
    return S.seed;
  }
  const noInput = () => ({ gas: false, brake: false, left: false, right: false, hand: false, nitro: false });
  function newState(prev) {
    return {
      mode: 'intro',           // intro | play | question | pause | ending | over
      t: 0, anim: prev ? prev.anim : 0, lastT: prev ? prev.lastT : 0,
      view: prev ? prev.view : { w: 0, h: 0, dpr: 1, cw: 0 },
      seed: 1, tileCache: new Map(),
      car: { x: HALF, z: -20, a: 0, v: 0, vx: 0, vz: 0, steerVis: 0, roll: 0, boosting: false, braking: false, color: carColor().id },
      cam: { x: HALF, z: -20 - CAM_BACK, a: 0 },
      input: noInput(),
      fuel: FUEL_MAX, nitro: 60, score: 0, dist: 0, streak: 0, bestStreak: 0, topSpeed: 0,
      gates: 0, coins: 0, bumps: 0, asked: 0, correct: 0,
      cleared: new Set(), taken: new Set(), armed: null, rearmAt: 0, extra: [],
      biome: 'plains', city: false, biomesSeen: new Set(['plains']), fogRGB: BIOMES.plains.fog.slice(), skyRGB: hexRgb(BIOMES.plains.sky),
      question: null, missed: [], recent: [],
      banner: null, particles: [], floats: [], shake: 0, flash: 0, flashColor: C.rose, endAt: 0, lowFuelWarned: false, bumpAt: -9, wallHintAt: -9,
      onRoad: true, lava: false, saved: false, isNewBest: false, uid: 0, hudCache: {}, mini: null, frameNo: 0,
    };
  }

  /* ------------------------------------------------------------
     DOM
     ------------------------------------------------------------ */
  function bestLabel() { const g = Progress.gameStats(ID); return g.best ? 'Best ' + fmt(g.best) + (g.gates ? ' · ' + g.gates + ' gates' : '') : 'No best yet'; }

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
      h('div.game-title', null, h('span.icon', null, '🏎️'), h('span', null, 'Word Highway', h('span.g-highway-tag', null, 'Open-world driving · answer at the gates'))),
      h('div.row', null, best, pauseBtn));

    const score = h('span.val', null, '0');
    const fuelFill = h('div.bar-fill');
    const fuelVal = h('span.val', null, '100');
    const fuelItem = h('div.hud-item.g-highway-fuel', null, h('span.label', null, 'Fuel'), h('div.bar.g-highway-fuelbar', null, fuelFill), fuelVal);
    const nitroFill = h('div.bar-fill');
    const nitroItem = h('div.hud-item.g-highway-nitro', null, h('span.label', null, 'Nitro'), h('div.bar.g-highway-nitrobar', null, nitroFill));
    const gates = h('span.val', null, '0');
    const coins = h('span.val', null, '0');
    const biomeIcon = h('span.g-highway-biome-icon', null, '🌿');
    const biomeName = h('span.val', null, 'Plains');
    const streak = h('span.val', null, '0');
    const streakItem = h('div.hud-item.g-highway-streak', null, h('span.label', null, 'Streak'), streak);
    const hud = h('div.hud.g-highway-hud', null,
      h('div.hud-item', null, h('span.label', null, 'Score'), score),
      fuelItem,
      nitroItem,
      h('div.hud-item', null, h('span.label', null, 'Gates'), gates),
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
    const btnN = holdButton(h('button.touch-btn.g-highway-nitrobtn', { type: 'button', 'aria-label': 'Nitro' }, 'N'), 'nitro');
    const btnP = h('button.touch-btn.g-highway-touch-pause', { type: 'button', 'aria-label': 'Pause', onclick: () => { if (S && (S.mode === 'play' || S.mode === 'pause')) togglePause(); } }, '⏸');
    const touch = h('div.touch-controls.g-highway-touch', null, h('div.tc-group', null, btnL, btnR), btnP, h('div.tc-group', null, btnN, btnB, btnG));
    const help = h('div.small.muted.g-highway-help', null, 'W / ↑ gas · S / ↓ brake and reverse · A D / ← → steer · Shift or N nitro · Space handbrake · Esc pauses');

    const shell = h('div.game-shell.g-highway', null, topbar, hud, stage, touch, help);
    if ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0) shell.classList.add('g-highway-is-touch');
    root.appendChild(shell);
    return { shell, stage, canvas, ctx: canvas.getContext('2d'), mini, mctx: mini.getContext('2d'), banner, best, pauseBtn, overlay: null,
      hud: { score, fuelFill, fuelVal, fuelItem, nitroFill, nitroItem, gates, coins, biomeIcon, biomeName, streak, streakItem } };
  }

  /* ------------------------------------------------------------
     Overlays
     ------------------------------------------------------------ */
  function showOverlay(panel, cls) { hideOverlay(); D.overlay = h('div.game-overlay.g-highway-overlay' + (cls ? '.' + cls : ''), null, panel); D.stage.appendChild(D.overlay); }
  function hideOverlay() { if (D && D.overlay) { D.overlay.remove(); D.overlay = null; } }
  function focusLater(sel) { later(() => { const b = D.overlay && D.overlay.querySelector(sel); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, 40); }

  /** Car colour swatches: the choice is saved and shows on the car right away. */
  function swatches() {
    const row = h('div.g-highway-swatches', { role: 'group', 'aria-label': 'Car colour' });
    const paint = () => { const cur = carColor().id; row.querySelectorAll('.g-highway-swatch').forEach((b) => b.setAttribute('aria-pressed', b.dataset.color === cur ? 'true' : 'false')); };
    CAR_COLORS.forEach((c) => row.appendChild(h('button.g-highway-swatch', { type: 'button', title: c.name, 'aria-label': c.name + ' car', dataset: { color: c.id }, style: { '--swatch': c.hex, '--stripe': c.stripe },
      onclick: () => { PQ.Settings.set('highwayCar', c.id); if (S) S.car.color = c.id; paint(); Sound.play('click'); } })));
    paint();
    return h('div.g-highway-colors', null, h('span.small.muted', null, 'Car colour'), row);
  }
  function introPanel() {
    const g = Progress.gameStats(ID);
    return h('div.panel.g-highway-intro', null,
      h('div.g-highway-intro-icon', { 'aria-hidden': 'true' }, '🏎️'),
      h('h2', null, 'Word Highway'),
      h('p.text-2', null, 'An endless world of roads and biomes, cut into districts by walls. Drive anywhere inside a district. The gates between districts open only when you answer a word question.'),
      h('div.g-highway-legend', null,
        h('div', null, h('b', null, 'W'), 'W / ↑ gas, S / ↓ brake, A D / ← → steer, Space handbrake'),
        h('div', null, h('b', null, 'N'), 'Shift or N for nitro: it refills over time and with coins'),
        h('div', null, h('b', null, '⛽'), 'Fuel drains as you drive. Gates and coins refill it'),
        h('div', null, h('b', null, '🗺️'), 'The compass points to the nearest open gate. Find every biome and the cities')),
      swatches(),
      g.best ? h('div.small.muted.g-highway-intro-best', null, '🏆 ' + bestLabel()) : null,
      h('div.row.g-highway-actions', null, h('button.btn.btn-primary.btn-lg', { type: 'button', onclick: startGame }, '▶ Drive')));
  }
  function pausePanel() {
    return h('div.panel.g-highway-pause', null,
      h('div.eyebrow', null, 'Paused'), h('h2', null, 'Paused'),
      h('p.text-2', null, 'Score ' + fmt(S.score) + ' · ' + S.gates + ' gates · fuel ' + Math.round(S.fuel) + '%'),
      swatches(),
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
      : h('p.small.muted', null, 'Every gate you answered was right.');
    return h('div.panel.g-highway-over', null,
      h('div.eyebrow', null, 'Out of fuel'), h('h2', null, 'The road ends here'),
      h('div.big.grad-text', null, fmt(S.score)),
      S.isNewBest ? h('div.g-highway-newbest', null, 'New best score') : h('div.small.muted', null, bestLabel()),
      h('div.stat-grid', null, statEl('Distance', (S.dist / 1000).toFixed(1) + ' km'), statEl('Gates', S.gates), statEl('Zones', S.biomesSeen.size + '/' + ZONES), statEl('Top speed', Math.round(S.topSpeed * KMH) + ' km/h')),
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
    showBanner('Drive', 'follow the compass to the first gate', 2.4);
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

  function endRun() { S.mode = 'ending'; S.endAt = S.t + ENDING; S.input = noInput(); clearBanner(); Sound.play('lose'); }
  function saveBest() {
    if (S.saved) return;
    S.saved = true;
    S.isNewBest = Progress.setBest(ID, Math.round(S.score), null, { gates: S.gates, biomes: S.biomesSeen.size });
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
     Gate questions
     ------------------------------------------------------------ */
  function pickEntry() {
    const all = Vocab.active();
    const recent = S.recent.slice(-Math.min(4, Math.max(0, all.length - 1)));
    const e = Progress.pick(1, { exclude: recent })[0] || Rand.pick(all);
    S.recent.push(e.id);
    return e;
  }
  function openQuestion(gate) {
    if (!S || S.question || S.mode !== 'play') return;
    S.mode = 'question';
    S.car.v = 0; S.car.vx = 0; S.car.vz = 0;
    S.input = noInput();
    const entry = pickEntry();
    const q = Quiz.any(entry, S.forceKind ? [S.forceKind] : ['typed', 'typed', 'choice', 'accent']);
    const ctl = QuizUI.ask(q, { bonus: Math.min(20, S.streak * 4), onResult: (res) => applyAnswer(gate, res) });
    const head = h('div.g-highway-qhead', null, h('span.g-highway-qicon', null, '🛑'), h('div', null, h('b', null, 'Gate ' + (S.asked + 1)), h('span', null, 'Answer to lift the barrier and refuel')));
    const modal = UI.modal({ closable: false, content: h('div.g-highway-q', null, head, ctl.el) });
    S.question = { ctl, modal, gate, entry };
    S.asked++;
    Sound.play('click');
  }
  function applyAnswer(gate, res) {
    if (!S || !S.question) return;
    const status = res.status === 'correct' ? 'correct' : res.status === 'accent' ? 'accent' : 'wrong';
    const gain = FUEL_REWARD[status];
    S.fuel = Math.min(FUEL_MAX, S.fuel + gain);
    if (status === 'correct') {
      S.correct++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
      Progress.noteStreak(S.streak);
      const mult = Math.min(4, 1 + Math.floor(S.streak / 2));
      const pts = GATE_PTS * mult;
      S.score += pts;
      S.cleared.add(gate.key);
      S.gates++;
      S.nitro = Math.min(100, S.nitro + 40);
      S.flash = 0.6; S.flashColor = C.amber;
      floatText(0.5, 0.45, '+' + pts, C.white);
      burst(0.5, 0.5, 30, [C.amber, C.white, C.mint]);
      showBanner('Gate open', '+' + gain + ' fuel · +40 nitro · +' + pts + ' points' + (mult > 1 ? ' (×' + mult + ')' : ''), 2.4);
      later(() => Sound.play('gate'), 120);
    } else {
      S.streak = 0;
      S.missed.push(S.question.entry);
      S.rearmAt = S.t + 2.5;
      showBanner(status === 'accent' ? 'Check the accents' : 'Not quite', (gain ? '+' + gain + ' fuel · ' : '') + 'the barrier stays down · you can try again in a moment', 2.6);
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
    const biome = biomeAt(car.x, car.z), city = cityAt(car.x, car.z);
    if (biome !== S.biome) {
      S.biome = biome;
      if (!S.biomesSeen.has(biome)) { S.biomesSeen.add(biome); S.score += BIOME_PTS; showBanner(BIOMES[biome].icon + ' ' + BIOMES[biome].name, 'new biome discovered · +' + BIOME_PTS, 2.4); Sound.play('levelup'); }
    }
    if (city !== S.city) {
      S.city = city;
      if (city && !S.biomesSeen.has('city')) { S.biomesSeen.add('city'); S.score += BIOME_PTS; showBanner('🏙️ City', 'a city in the ' + BIOMES[biome].name.toLowerCase() + ' · +' + BIOME_PTS, 2.4); Sound.play('levelup'); }
    }
    const here = tileObj(tx, tz);
    S.onRoad = ri.road; S.lava = !!(here && here.type === 'lava');
    const info = BIOMES[biome];
    // nitro
    const boosting = !!(inp.nitro && S.nitro > 0 && inp.gas && car.v > -0.1);
    car.boosting = boosting;
    if (boosting) S.nitro = Math.max(0, S.nitro - NITRO_DRAIN * dt);
    else if (Math.abs(car.v) > 2) S.nitro = Math.min(100, S.nitro + NITRO_REFILL * dt);
    const maxV = MAX_SPEED * (ri.road ? 1 : info.speed) * (S.lava ? 0.5 : 1) * (boosting ? NITRO_SPEED : 1);
    const throttle = (inp.gas ? 1 : 0) - (inp.brake ? 1 : 0);
    car.braking = inp.brake && car.v > 0.3;
    if (throttle > 0) { if (car.v < maxV) car.v = Math.min(maxV, car.v + ACCEL * (boosting ? NITRO_ACCEL : 1) * dt); else car.v = Math.max(maxV, car.v - (car.v - maxV) * 3 * dt); }
    else if (throttle < 0) { if (car.v > 0.3) car.v = Math.max(0, car.v - BRAKE * dt); else car.v = Math.max(-REV_SPEED, car.v - ACCEL * 0.6 * dt); }
    else { const dec = Math.abs(car.v) * DRAG * dt + ROLL * dt; car.v = Math.abs(car.v) <= dec ? 0 : car.v - Math.sign(car.v) * dec; }
    if (inp.hand) car.v -= car.v * 2.2 * dt;
    S.topSpeed = Math.max(S.topSpeed, car.v);
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    car.steerVis += (steer - car.steerVis) * Math.min(1, dt * 9);
    const turn = TURN * steer * clamp(Math.abs(car.v) / 9, 0, 1) * (inp.hand ? 1.5 : 1) * (car.v < 0 ? -1 : 1) * (boosting ? 0.85 : 1);
    car.a += turn * dt;
    car.roll += (-steer * clamp(Math.abs(car.v) / MAX_SPEED, 0, 1) - car.roll) * Math.min(1, dt * 6);
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
    const burn = (Math.abs(car.v) > 0.3 ? FUEL_IDLE + Math.abs(car.v) * FUEL_PER_UNIT : 0) * (S.lava ? 6 : 1) * (boosting ? 1.4 : 1) * dt;
    S.fuel = Math.max(0, S.fuel - burn);
    if (S.lava && Math.random() < dt * 30) S.particles.push({ x: 0.5 + (Math.random() - 0.5) * 0.2, y: 0.8, vx: (Math.random() - 0.5) * 0.3, vy: -0.5 - Math.random() * 0.4, g: 0.9, r: 2 + Math.random() * 2, c: Rand.pick([C.mint, C.lav, C.rose]), t: 0, max: 0.5 });
    if (S.fuel < 25 && !S.lowFuelWarned) { S.lowFuelWarned = true; showBanner('Low fuel', 'answer at a gate to refuel · the compass points to the nearest one', 2.6); Sound.play('wrong'); }
    if (S.fuel <= 0) { endRun(); return; }
    if (!ri.road && Math.abs(car.v) > 4 && Math.random() < dt * 25) S.particles.push({ x: 0.5 + (Math.random() - 0.5) * 0.16, y: 0.86, vx: (Math.random() - 0.5) * 0.25, vy: -0.15 - Math.random() * 0.2, g: 0.3, r: 2 + Math.random() * 3, c: biome === 'snow' ? '#ffffff' : biome === 'desert' ? '#e8c98a' : '#8a7a5a', t: 0, max: 0.5 });
    collide();
    walls();
    collect();
    checkpoint();
  }

  /** A knock: the car bounces back and loses speed; a hint banner for walls. */
  function bump(nx, nz, hard, msg) {
    const car = S.car;
    car.v = -car.v * 0.25; car.vx = nx * Math.abs(car.v); car.vz = nz * Math.abs(car.v);
    if (S.t - S.bumpAt > 0.4) { S.bumpAt = S.t; S.bumps++; S.shake = hard ? 0.8 : 0.3; Sound.play(hard ? 'hurt' : 'click'); burst(0.5, 0.75, hard ? 18 : 6, ['#c9c9c9', C.lav]); }
    if (msg && S.t - S.wallHintAt > 6) { S.wallHintAt = S.t; showBanner('District wall', msg, 2.6); }
  }
  /** Solid things push the car out. */
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
      bump(nx, nz, Math.abs(car.v) > 6, null);
    }
  }
  /** District walls: solid lines mid-block; the only openings are the gates on the roads, and a gate opens only once cleared. */
  function walls() {
    const car = S.car;
    const check = (axis) => {
      const p = axis === 'x' ? car.x : car.z, q = axis === 'x' ? car.z : car.x;   // p across the wall, q along it
      const k = Math.round((p - WALL_OFF) / DIST), wp = k * DIST + WALL_OFF;
      if (Math.abs(p - wp) >= 1.2) return;
      const j = Math.round((q - HALF) / BLOCK), gq = j * BLOCK + HALF;
      const inGate = Math.abs(q - gq) < HALF - 0.2;
      if (inGate && S.cleared.has(gateKey(axis, k, j))) return;
      const side = p < wp ? -1 : 1;
      const msg = inGate ? 'answer the question to lift the barrier' : 'the gates are on the roads · follow the compass';
      if (axis === 'x') { car.x = wp + side * 1.2; bump(side, 0, Math.abs(car.v) > 6, msg); }
      else { car.z = wp + side * 1.2; bump(0, side, Math.abs(car.v) > 6, msg); }
    };
    check('x'); check('z');
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
    S.coins++; S.score += COIN_PTS; S.fuel = Math.min(FUEL_MAX, S.fuel + COIN_FUEL); S.nitro = Math.min(100, S.nitro + COIN_NITRO);
    floatText(0.5, 0.62, '+' + COIN_PTS, C.lav);
    burst(0.5, 0.64, 10, [C.lav, C.mint]);
    Sound.play('coin');
  }
  /** Near an open gate: stop and ask. After a miss the same gate asks again a moment later (or at once when you come back). */
  function checkpoint() {
    const g = nearestGate(S.car.x, S.car.z).best;
    if (!g) return;
    if (S.armed && S.armed !== g.key) { S.armed = null; S.rearmAt = 0; }
    if (g.d > GATE_R + 6) { if (S.armed === g.key) { S.armed = null; S.rearmAt = 0; } return; }
    if (g.d > GATE_R || S.cleared.has(g.key)) return;
    if (S.armed === g.key && (!S.rearmAt || S.t < S.rearmAt)) return;
    S.armed = g.key; S.rearmAt = 0;
    openQuestion(g);
  }

  function updateFx(dt) {
    const car = S.car;
    let da = car.a - S.cam.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    S.cam.a += da * Math.min(1, dt * 5);
    const back = CAM_BACK + (car.boosting ? 1.2 : 0);
    S.cam.x = car.x - Math.sin(S.cam.a) * back; S.cam.z = car.z - Math.cos(S.cam.a) * back;
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
    VIEW = w < 640 ? 72 : 96;
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
    else if (S.mode === 'intro' || S.mode === 'over') { S.t += dt; S.cam.a += dt * 0.12; S.cam.x = S.car.x - Math.sin(S.cam.a) * CAM_BACK; S.cam.z = S.car.z - Math.cos(S.cam.a) * CAM_BACK; }
    updateHud(false);
    S.frameNo++;
    if (S.mode === 'question' && S.frameNo % 6) return;   // the world stands still under a question: spare the modal's blur
    render();
    drawMini();
  }
  function updateHud(force) {
    const c = S.hudCache;
    const set = (k, v, fn) => { if (force || c[k] !== v) { c[k] = v; fn(v); } };
    set('mode', S.mode, (v) => { D.shell.classList.toggle('is-playing', v === 'play' || v === 'question'); D.shell.dataset.mode = v; });
    set('score', Math.round(S.score), (v) => { D.hud.score.textContent = fmt(v); });
    set('fuel', Math.round(S.fuel), (v) => { D.hud.fuelVal.textContent = String(v); D.hud.fuelFill.style.width = v + '%'; D.hud.fuelItem.classList.toggle('is-low', v < 25); });
    set('nitro', Math.round(S.nitro / 2) * 2, (v) => { D.hud.nitroFill.style.width = v + '%'; });
    set('boost', S.car.boosting, (v) => D.hud.nitroItem.classList.toggle('is-on', v));
    set('gates', S.gates, (v) => { D.hud.gates.textContent = String(v); });
    set('coins', S.coins, (v) => { D.hud.coins.textContent = String(v); });
    set('biome', S.biome + (S.city ? '+city' : ''), () => { D.hud.biomeIcon.textContent = S.city ? '🏙️' : BIOMES[S.biome].icon; D.hud.biomeName.textContent = S.city ? 'City · ' + BIOMES[S.biome].name : BIOMES[S.biome].name; });
    set('streak', S.streak, (v) => { D.hud.streak.textContent = v >= 2 ? '🔥 ' + v : String(v); D.hud.streakItem.classList.toggle('is-hot', v >= 2); });
  }

  /* ------------------------------------------------------------
     3D rendering
       camera space: f = depth along the view, r = right, y = up
       screen: sx = CX + r·F/f, sy = HY + (CAM_H − y)·F/f
     ------------------------------------------------------------ */
  let F = 400, HY = 160, CX = 320, SINA = 0, COSA = 1, RATIO = 1, VIEW = 84;
  function cs(x, y, z) { const dx = x - S.cam.x, dz = z - S.cam.z; return { f: dx * SINA + dz * COSA, r: dx * COSA - dz * SINA, y }; }
  function sp(p) { const s = F / p.f; return { x: CX + p.r * s, y: HY + (CAM_H - p.y) * s, s }; }
  const fogOf = (f) => Math.pow(clamp((f - 30) / (VIEW - 30), 0, 1), 1.3);
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
  /**
   * A box with its own yaw (and optional roll about its long axis): the faces that face the camera, drawn back
   * to front, shaded by orientation. colors: { side, top, front, back }.
   */
  function drawBox(ctx, cx, cz, yaw, hw, hl, y0, y1, colors, fog, roll) {
    const sa = Math.sin(yaw), ca = Math.cos(yaw);
    const rs = roll ? Math.sin(roll) : 0, rc = roll ? Math.cos(roll) : 1;
    const ym = (y0 + y1) / 2;
    const W = (u, w, y) => { const yy = y - ym; const u2 = u * rc - yy * rs, y2 = ym + u * rs + yy * rc; return { x: cx + u2 * ca + w * sa, y: y2, z: cz - u2 * sa + w * ca }; };
    const P = [W(-hw, -hl, y0), W(hw, -hl, y0), W(hw, hl, y0), W(-hw, hl, y0), W(-hw, -hl, y1), W(hw, -hl, y1), W(hw, hl, y1), W(-hw, hl, y1)];
    const faces = [
      { i: [4, 5, 6, 7], c: colors.top || colors.side, k: 1.22 },
      { i: [0, 1, 5, 4], c: colors.back || colors.side, k: 0.86 },
      { i: [3, 2, 6, 7], c: colors.front || colors.side, k: 0.95 },
      { i: [0, 3, 7, 4], c: colors.side, k: 0.72 },
      { i: [1, 2, 6, 5], c: colors.side, k: 0.8 },
    ];
    const vis = [];
    for (const fc of faces) {
      const a = P[fc.i[0]], b = P[fc.i[1]], c = P[fc.i[2]];
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2, mz = (a.z + c.z) / 2;
      if (nx * (mx - cx) + ny * (my - ym) + nz * (mz - cz) < 0) { nx = -nx; ny = -ny; nz = -nz; }   // point away from the box centre
      const dot = nx * (mx - S.cam.x) + ny * (my - CAM_H) + nz * (mz - S.cam.z);
      if (dot < 0) vis.push({ fc, depth: cs(mx, my, mz).f });
    }
    vis.sort((a, b) => b.depth - a.depth);
    for (const v of vis) fillPoly(ctx, v.fc.i.map((j) => cs(P[j].x, P[j].y, P[j].z)), fogged(v.fc.c, fog, v.fc.k));
  }
  const aabox = (ctx, x0, x1, y0, y1, z0, z1, colors, fog) => drawBox(ctx, (x0 + x1) / 2, (z0 + z1) / 2, 0, (x1 - x0) / 2, (z1 - z0) / 2, y0, y1, typeof colors === 'string' ? { side: colors } : colors, fog, 0);

  function drawSky(ctx) {
    const { w, h: hh } = S.view;
    ctx.fillStyle = rgbStr(S.skyRGB.map(Math.round)); ctx.fillRect(0, 0, w, HY + 1);
    const base = -S.cam.a / TAU * w * 2.2;
    for (let i = 0; i < 70; i++) {
      const fx = mod(h01(i, 3, 41) * w * 2.2 + base, w * 2.2) - w * 0.6, fy = h01(i, 4, 42) * HY * 0.7;
      if (fx < -2 || fx > w + 2) continue;
      ctx.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(S.anim * (0.8 + h01(i, 5, 43) * 2) + i));
      ctx.fillStyle = '#fff'; ctx.fillRect(fx, fy, 1.4, 1.4);
    }
    ctx.globalAlpha = 1;
    const rel = Math.atan2(Math.sin(0.9 - S.cam.a), Math.cos(0.9 - S.cam.a));
    if (Math.abs(rel) < 1.1) {
      const r = Math.min(w, hh) * 0.14, sx = CX + Math.tan(rel) * F, sy = HY - r * 0.2;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, HY); ctx.clip();
      ctx.fillStyle = C.mint; ctx.shadowColor = C.mint; ctx.shadowBlur = 40; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = rgbStr(S.skyRGB.map(Math.round)); for (let i = 0; i < 4; i++) ctx.fillRect(sx - r, sy + r * (0.15 + i * 0.2), r * 2, r * (0.03 + i * 0.03));
      ctx.restore();
    }
    const fogc = rgbStr(S.fogRGB.map(Math.round));
    [[0.5, 0.11, 61, 0.45], [1, 0.16, 62, 0.7]].forEach(([par, amp, salt, dark]) => {
      ctx.beginPath(); ctx.moveTo(0, HY + 2);
      for (let x = 0; x <= w; x += 16) {
        const az = (S.cam.a * par + (x - CX) / F) * 3.5;
        const hgt = (vnoise(az, 0, salt) * 0.7 + vnoise(az * 3, 1, salt) * 0.3) * amp * hh;
        ctx.lineTo(x, HY - hgt);
      }
      ctx.lineTo(w, HY + 2); ctx.closePath();
      ctx.fillStyle = rgbStr(S.fogRGB.map((v) => Math.round(v * dark))); ctx.fill();
    });
    ctx.fillStyle = fogc; ctx.fillRect(0, HY - 1, w, hh - HY + 1);
  }

  function drawWorld(ctx) {
    if (S.prof) S.prof._t = performance.now();
    const R = Math.ceil(VIEW / TILE);
    const ctx0 = Math.floor(S.cam.x / TILE), ctz0 = Math.floor(S.cam.z / TILE);
    const n = 2 * R + 2, corners = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) corners[j * n + i] = cs((ctx0 - R + i) * TILE, 0, (ctz0 - R + j) * TILE);
    const tiles = [], objs = [], wallTiles = [];
    const biomeCache = new Map();
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = corners[j * n + i], b = corners[j * n + i + 1], c = corners[(j + 1) * n + i + 1], d = corners[(j + 1) * n + i];
      const fmax = Math.max(a.f, b.f, c.f, d.f);
      if (fmax < NEAR) continue;
      const lim = fmax * RATIO + TILE * 1.5;
      if (Math.min(a.r, b.r, c.r, d.r) > lim || Math.max(a.r, b.r, c.r, d.r) < -lim) continue;
      const favg = (a.f + b.f + c.f + d.f) / 4;
      if (favg > VIEW) continue;
      tiles.push({ f: favg, tx: ctx0 - R + i, tz: ctz0 - R + j, poly: [a, b, c, d] });
    }
    tiles.sort((p, q) => q.f - p.f);
    for (const t of tiles) {
      const bk = Math.floor(t.tx / 3) + ',' + Math.floor(t.tz / 3);
      let zone = biomeCache.get(bk);
      if (!zone) { const wx = t.tx * TILE + HALF, wz = t.tz * TILE + HALF; zone = { biome: biomeAt(wx, wz), city: cityAt(wx, wz) }; biomeCache.set(bk, zone); }
      const biome = zone.biome;
      const fog = fogOf(t.f);
      const o = tileObj(t.tx, t.tz);
      let col = tileColor(t.tx, t.tz, biome, zone.city);
      if (o && o.type === 'lava') col = (hash(t.tx, t.tz, 5) & 1) ? '#ff7a1a' : '#ff9a2a';
      fillPoly(ctx, t.poly, fogged(col, fog, 1));
      if (o && o.type === 'lava' && fog < 0.9) { ctx.globalAlpha = 0.35 + 0.25 * Math.sin(S.anim * 3 + t.tx); fillPoly(ctx, t.poly, fogged('#ffd060', fog)); ctx.globalAlpha = 1; }
      if (o && o.type !== 'lava' && !(o.type === 'coin' && S.taken.has(o.key))) objs.push({ f: t.f, o, biome });
      const wi = wallInfo(t.tx, t.tz);
      if ((wi.wx || wi.wz) && !wi.gate) wallTiles.push({ f: t.f, tx: t.tx, tz: t.tz, wi });
    }
    if (S.prof) { S.prof.tiles += performance.now() - S.prof._t; S.prof._t = performance.now(); S.prof.nTiles += tiles.length; S.prof.nObjs += objs.length; }
    drawRoadMarks(ctx);
    if (S.prof) { S.prof.marks += performance.now() - S.prof._t; S.prof._t = performance.now(); }
    const items = objs.map((it) => ({ f: it.f, draw: () => drawObject(ctx, it.o, fogOf(it.f), it.biome) }));
    wallTiles.forEach((wt) => items.push({ f: wt.f, draw: () => drawWallTile(ctx, wt.tx, wt.tz, wt.wi, fogOf(wt.f)) }));
    S.extra.forEach((o) => { if (o.taken) return; const c = cs(o.x, 0, o.z); if (c.f > NEAR - 2 && c.f < VIEW) items.push({ f: c.f, draw: () => drawObject(ctx, o, fogOf(c.f), 'plains') }); });
    // intersections (lamps) and gates in view
    const i0 = Math.floor((S.cam.x - VIEW) / BLOCK), i1 = Math.ceil((S.cam.x + VIEW) / BLOCK), j0 = Math.floor((S.cam.z - VIEW) / BLOCK), j1 = Math.ceil((S.cam.z + VIEW) / BLOCK);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = i * BLOCK + HALF, cz = j * BLOCK + HALF, c = cs(cx, 0, cz);
      if (c.f < NEAR - 8 || c.f > VIEW + 8) continue;
      items.push({ f: c.f, draw: () => drawIntersection(ctx, cx, cz, fogOf(Math.max(0, c.f))) });
    }
    const kx0 = Math.floor((S.cam.x - VIEW - WALL_OFF) / DIST), kx1 = Math.ceil((S.cam.x + VIEW - WALL_OFF) / DIST);
    const kz0 = Math.floor((S.cam.z - VIEW - WALL_OFF) / DIST), kz1 = Math.ceil((S.cam.z + VIEW - WALL_OFF) / DIST);
    for (let k = kx0; k <= kx1; k++) for (let j = j0; j <= j1; j++) { const gx = k * DIST + WALL_OFF, gz = j * BLOCK + HALF, c = cs(gx, 0, gz); if (c.f > NEAR - 8 && c.f < VIEW + 8) items.push({ f: c.f, draw: () => drawGate(ctx, 'x', k, j, gx, gz, fogOf(Math.max(0, c.f))) }); }
    for (let k = kz0; k <= kz1; k++) for (let i = i0; i <= i1; i++) { const gz = k * DIST + WALL_OFF, gx = i * BLOCK + HALF, c = cs(gx, 0, gz); if (c.f > NEAR - 8 && c.f < VIEW + 8) items.push({ f: c.f, draw: () => drawGate(ctx, 'z', k, i, gx, gz, fogOf(Math.max(0, c.f))) }); }
    const carC = cs(S.car.x, 0, S.car.z);
    items.push({ f: carC.f, draw: () => drawCar(ctx) });
    items.sort((p, q) => q.f - p.f).forEach((it) => it.draw());
    if (S.prof) { S.prof.items += performance.now() - S.prof._t; S.prof.nItems += items.length; }
  }

  function drawRoadMarks(ctx) {
    const dashP = 6, dashL = 2.6, hwid = 0.14;
    const col = (f) => fogged('#d6def2', fogOf(f), 1, 0.8);
    for (let k = Math.floor((S.cam.x - VIEW) / BLOCK); k <= Math.ceil((S.cam.x + VIEW) / BLOCK); k++) {
      const x = k * BLOCK + HALF;
      for (let m = Math.floor((S.cam.z - VIEW) / dashP); m <= Math.ceil((S.cam.z + VIEW) / dashP); m++) {
        const z0 = m * dashP, z1 = z0 + dashL;
        if (mod(Math.floor(z0 / TILE), ROAD_EVERY) === 0 || mod(Math.floor(z1 / TILE), ROAD_EVERY) === 0) continue;
        const c = cs(x, 0.02, z0); if (c.f > VIEW || c.f < -dashL) continue;
        if (Math.abs(c.r) > c.f * RATIO + 4) continue;
        fillPoly(ctx, [cs(x - hwid, 0.02, z0), cs(x + hwid, 0.02, z0), cs(x + hwid, 0.02, z1), cs(x - hwid, 0.02, z1)], col(c.f));
      }
      [x - HALF, x + HALF].forEach((ex) => {
        for (let m = Math.floor((S.cam.z - VIEW) / 12); m <= Math.ceil((S.cam.z + VIEW) / 12); m++) {
          const z0 = m * 12, z1 = z0 + 12, c = cs(ex, 0.02, z0 + 6); if (c.f > VIEW + 6 || c.f < -8) continue;
          fillPoly(ctx, [cs(ex - 0.1, 0.02, z0), cs(ex + 0.1, 0.02, z0), cs(ex + 0.1, 0.02, z1), cs(ex - 0.1, 0.02, z1)], fogged(C.amber, fogOf(Math.max(0, c.f)), 1, 0.55));
        }
      });
    }
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

  /** One stretch of district wall: a stone wall with a post, running along the tile's edge on the wall line. */
  function drawWallTile(ctx, tx, tz, wi, fog) {
    const col = (tx + tz) & 1 ? WALL : WALL2;
    if (wi.wx) { const x = wi.lineX; aabox(ctx, x - 0.3, x + 0.3, 0, 1.7, tz * TILE, tz * TILE + TILE, col, fog); if (fog < 0.7) aabox(ctx, x - 0.45, x + 0.45, 0, 2.3, tz * TILE - 0.3, tz * TILE + 0.3, POST, fog); }
    if (wi.wz) { const z = wi.lineZ; aabox(ctx, tx * TILE, tx * TILE + TILE, 0, 1.7, z - 0.3, z + 0.3, col, fog); if (fog < 0.7) aabox(ctx, tx * TILE - 0.3, tx * TILE + 0.3, 0, 2.3, z - 0.45, z + 0.45, POST, fog); }
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
        // lit windows set into each wall (real geometry, so they stay put as you drive around)
        aabox(ctx, x - 0.35, x + 0.35, 1.0, 1.6, z - 2.18, z - 2.0, WIN_LIT, fog);
        aabox(ctx, x - 0.35, x + 0.35, 1.0, 1.6, z + 2.0, z + 2.18, WIN_LIT, fog);
        aabox(ctx, x - 2.18, x - 2.0, 1.0, 1.6, z - 0.35, z + 0.35, WIN_LIT, fog);
        aabox(ctx, x + 2.0, x + 2.18, 1.0, 1.6, z - 0.35, z + 0.35, WIN_LIT, fog);
        break;
      }
      case 'tower': {
        const hw = 2.5, hgt = o.hgt, col = (TOWER_COLS[o.biome] || TOWER_COLS.plains)[o.c];
        aabox(ctx, x - hw, x + hw, 0, hgt, z - hw, z + hw, col, fog);
        if (far) break;
        for (let y = 1.8, k = 0; y < hgt - 1.2 && k < 7; y += 2.8, k++) aabox(ctx, x - hw - 0.06, x + hw + 0.06, y, y + 0.7, z - hw - 0.06, z + hw + 0.06, ((k + o.lit) % 3) ? WIN_LIT : WIN_DARK, fog);
        aabox(ctx, x - hw + 0.6, x + hw - 0.6, hgt, hgt + 0.5, z - hw + 0.6, z + hw - 0.6, { side: '#2a3044', top: '#3a4058' }, fog);
        if (v > 0.7) aabox(ctx, x - 0.1, x + 0.1, hgt + 0.5, hgt + 3, z - 0.1, z + 0.1, { side: '#2a3044', top: C.rose }, fog);
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

  /** Street lamps on the four corners of an intersection. */
  function drawIntersection(ctx, cx, cz, fog) {
    if (fog > 0.8) return;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const px = cx + sx * (HALF + 0.8), pz = cz + sz * (HALF + 0.8);
      aabox(ctx, px - 0.12, px + 0.12, 0, 3.6, pz - 0.12, pz + 0.12, { side: '#3a4258', top: '#5a6278' }, fog);
      aabox(ctx, px - 0.35, px + 0.35, 3.6, 3.95, pz - 0.35, pz + 0.35, { side: sx < 0 ? C.lav : C.amber, top: '#ffffff' }, fog);
    });
  }

  /** A gate: pillars, a beam, a barrier arm (down until cleared), stop signs on both approaches, a beacon. */
  function drawGate(ctx, axis, k, j, gx, gz, fog) {
    const key = gateKey(axis, k, j), cleared = S.cleared.has(key);
    const P = (a, b) => (axis === 'x' ? { x: gx + a, z: gz + b } : { x: gx + b, z: gz + a });   // a: across the wall, b: along the road
    const pillar = (b) => { const p = P(0, b); aabox(ctx, p.x - 0.5, p.x + 0.5, 0, 4.4, p.z - 0.5, p.z + 0.5, { side: '#56607a', top: '#8c96b0' }, fog); };
    pillar(-(HALF + 0.6)); pillar(HALF + 0.6);
    const beam = cleared ? { side: C.mint, top: '#ffd18a' } : { side: C.amber2, top: C.amber };
    if (axis === 'x') aabox(ctx, gx - 0.4, gx + 0.4, 3.9, 4.5, gz - HALF - 1.1, gz + HALF + 1.1, beam, fog);
    else aabox(ctx, gx - HALF - 1.1, gx + HALF + 1.1, 3.9, 4.5, gz - 0.4, gz + 0.4, beam, fog);
    // barrier arm: across the road when closed, raised beside a pillar when open
    if (!cleared) {
      if (axis === 'x') { aabox(ctx, gx - 0.12, gx + 0.12, 1.0, 1.3, gz - HALF, gz + HALF, { side: C.rose, top: '#ff8a96' }, fog); for (let s = -3; s <= 3; s += 2) aabox(ctx, gx - 0.13, gx + 0.13, 1.0, 1.3, gz + s * 0.9 - 0.4, gz + s * 0.9 + 0.4, { side: '#ffffff', top: '#ffffff' }, fog); }
      else { aabox(ctx, gx - HALF, gx + HALF, 1.0, 1.3, gz - 0.12, gz + 0.12, { side: C.rose, top: '#ff8a96' }, fog); for (let s = -3; s <= 3; s += 2) aabox(ctx, gx + s * 0.9 - 0.4, gx + s * 0.9 + 0.4, 1.0, 1.3, gz - 0.13, gz + 0.13, { side: '#ffffff', top: '#ffffff' }, fog); }
    } else { const p = P(0, -(HALF + 0.6)); aabox(ctx, p.x - 0.12, p.x + 0.12, 1.0, 4.0, p.z - 0.12, p.z + 0.12, { side: C.rose, top: '#ff8a96' }, fog); }
    // stop signs on both approaches
    if (fog < 0.8) [-1, 1].forEach((side) => { const p = P(side * 5.5, HALF + 1.2); drawSign(ctx, p.x, p.z, axis, fog, cleared); });
    // beacon: a tall translucent pillar of light over the gate (blue until cleared, then orange)
    const c0 = cs(gx, 0, gz); if (c0.f < NEAR + 0.5) return;
    const col = cleared ? C.mint : C.amber;
    const pulse = cleared ? 0.3 : 0.45 + 0.2 * Math.sin(S.anim * 3);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse * (1 - fog * 0.7);
    aabox(ctx, gx - 0.5, gx + 0.5, 4.5, 18, gz - 0.5, gz + 0.5, { side: col, top: '#ffffff' }, fog);
    ctx.restore();
  }

  /** Text painted on a world-space plate: centre c, `right` and `up` are unit vectors in world units, size is the letter height in world units. */
  function worldText(ctx, c, right, up, text, size, color) {
    const pc = cs(c.x, c.y, c.z), pr = cs(c.x + right.x, c.y + right.y, c.z + right.z), pu = cs(c.x + up.x, c.y + up.y, c.z + up.z);
    if (pc.f < NEAR + 0.3 || pr.f < NEAR + 0.3 || pu.f < NEAR + 0.3) return;
    const C0 = sp(pc), R = sp(pr), U = sp(pu);
    const ax = R.x - C0.x, ay = R.y - C0.y, bx = -(U.x - C0.x), by = -(U.y - C0.y);   // screen vectors for one world unit right / down on the plate
    if (Math.abs(ax * by - ay * bx) < 6) return;   // too small or edge-on
    const k = 1 / 40;
    ctx.save(); ctx.transform(ax * k, ay * k, bx * k, by * k, C0.x, C0.y);
    ctx.font = '800 ' + (size * 40) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  /** A stop sign: a post, a thin plate across the road direction, a red octagon and the word on the side facing the camera. */
  function drawSign(ctx, px, pz, axis, fog, cleared) {
    aabox(ctx, px - 0.07, px + 0.07, 0, 2.2, pz - 0.07, pz + 0.07, { side: '#9aa3b8', top: '#c5ccdb' }, fog);
    const r = 0.62, cy = 2.6, plate = { side: '#6a1b26', top: '#6a1b26' };
    if (axis === 'x') aabox(ctx, px - 0.04, px + 0.04, cy - r, cy + r, pz - r, pz + r, plate, fog);
    else aabox(ctx, px - r, px + r, cy - r, cy + r, pz - 0.04, pz + 0.04, plate, fog);
    if (fog > 0.6) return;
    const nx = axis === 'x' ? (S.cam.x < px ? -1 : 1) : 0, nz = axis === 'z' ? (S.cam.z < pz ? -1 : 1) : 0;   // the face toward the camera
    const ox = px + nx * 0.06, oz = pz + nz * 0.06;
    const pts = [];
    for (let q = 0; q < 8; q++) { const an = Math.PI / 8 + q * Math.PI / 4; const dy = Math.sin(an) * r, dl = Math.cos(an) * r; pts.push(cs(axis === 'x' ? ox : ox + dl, cy + dy, axis === 'x' ? oz + dl : oz)); }
    if (pts.some((p) => p.f < NEAR + 0.2)) return;
    fillPoly(ctx, pts, fogged(cleared ? '#8a2a35' : C.rose, fog));
    ctx.strokeStyle = fogged('#ffffff', fog, 1, 0.9); ctx.lineWidth = Math.max(1, 0.05 * sp(pts[0]).s); ctx.beginPath(); pts.forEach((p, i) => { const q = sp(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.closePath(); ctx.stroke();
    const right = axis === 'x' ? { x: 0, y: 0, z: nx > 0 ? 1 : -1 } : { x: nz > 0 ? -1 : 1, y: 0, z: 0 };   // reading direction as seen from that side
    worldText(ctx, { x: ox, y: cy, z: oz }, right, { x: 0, y: 1, z: 0 }, 'STOP', 0.4, fogged('#ffffff', fog));
  }

  /**
   * The car: a low body with a hood and trunk, a cabin with glass, side mirrors, a spoiler on end plates,
   * a front splitter and rear diffuser, twin exhausts, four steering wheels with hubs, head/tail/brake lights,
   * a racing stripe, a number plate, underglow and nitro flames. Every box rolls with the car when cornering.
   */
  function drawCar(ctx) {
    const car = S.car, a = car.a, x = car.x, z = car.z, roll = REDUCED ? 0 : car.roll * 0.09;
    const sa = Math.sin(a), ca = Math.cos(a);
    const W = (u, w) => ({ x: x + u * ca + w * sa, z: z - u * sa + w * ca });
    const B = (u, w, hw, hl, y0, y1, colors) => { const p = W(u, w); drawBox(ctx, p.x, p.z, a, hw, hl, y0, y1, colors, 0, roll); };
    // shadow + underglow
    const sh = cs(x, 0.01, z);
    if (sh.f > NEAR) { const q = sp(sh); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.55 * q.s, 0.6 * q.s, 0, 0, TAU); ctx.fill(); ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = car.boosting ? 'rgba(255,138,43,0.3)' : 'rgba(77,163,255,0.22)'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.35 * q.s, 0.48 * q.s, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    const cc = CAR_COLORS.find((c) => c.id === car.color) || CAR_COLORS[0];
    const paint = { side: cc.hex, top: shade(cc.hex, 1.28), front: shade(cc.hex, 1.1), back: shade(cc.hex, 0.74) };
    const bumper = { side: shade(cc.hex, 0.8), top: shade(cc.hex, 1.05) };
    const dark = { side: '#111622', top: '#232a3c', front: '#111622', back: '#111622' };
    const glass = { side: '#7cc4ff', top: '#1b3f9a', front: '#a8e0ff', back: '#8fd0ff' };
    const chrome = { side: '#aab2c4', top: '#e6ebf5' };
    // farthest first (seen from behind): headlights, the splitter
    B(-0.56, 2.26, 0.2, 0.05, 0.44, 0.58, { side: '#fff3c4', top: '#fff8dc' }); B(0.56, 2.26, 0.2, 0.05, 0.44, 0.58, { side: '#fff3c4', top: '#fff8dc' });
    B(0, 2.2, 0.95, 0.12, 0.2, 0.34, dark);
    // wheels with hubs, the front pair steering
    const steerA = car.steerVis * 0.45;
    [[-0.98, 1.3, steerA], [0.98, 1.3, steerA], [-0.98, -1.3, 0], [0.98, -1.3, 0]].forEach(([u, w, s]) => {
      const p = W(u, w); drawBox(ctx, p.x, p.z, a + s, 0.24, 0.44, 0, 0.64, { side: '#14181f', top: '#2a3040' }, 0, 0);
      const q = W(u * 1.02, w); drawBox(ctx, q.x, q.z, a + s, 0.26, 0.2, 0.18, 0.46, chrome, 0, 0);
    });
    // body: hood, main shell, trunk, side skirts
    B(0, 1.55, 0.86, 0.6, 0.3, 0.74, paint);
    B(0, 0, 0.94, 1.15, 0.3, 0.88, paint);
    B(0, -1.5, 0.9, 0.55, 0.3, 0.8, paint);
    B(-0.96, 0, 0.06, 1.6, 0.26, 0.4, dark); B(0.96, 0, 0.06, 1.6, 0.26, 0.4, dark);
    B(0, 0.35, 0.3, 1.5, 0.88, 0.93, { side: cc.stripe, top: shade(cc.stripe, 1.15) });   // racing stripe
    // cabin with glass, a roof plate, mirrors and an antenna
    B(0, -0.1, 0.74, 0.98, 0.88, 1.46, glass);
    B(0, -0.1, 0.62, 0.78, 1.46, 1.52, paint);
    B(-0.9, 0.45, 0.14, 0.1, 1.0, 1.12, paint); B(0.9, 0.45, 0.14, 0.1, 1.0, 1.12, paint);
    B(-0.98, 0.45, 0.06, 0.08, 1.0, 1.12, { side: '#dbe7ff', top: '#dbe7ff' }); B(0.98, 0.45, 0.06, 0.08, 1.0, 1.12, { side: '#dbe7ff', top: '#dbe7ff' });
    B(0, -0.55, 0.05, 0.05, 1.52, 1.78, dark);
    // spoiler: struts, wing, end plates
    B(-0.7, -1.85, 0.07, 0.12, 0.8, 1.22, dark); B(0.7, -1.85, 0.07, 0.12, 0.8, 1.22, dark);
    B(0, -1.88, 1.02, 0.17, 1.22, 1.34, { side: C.rose2, top: C.rose });
    B(-1.02, -1.88, 0.04, 0.26, 1.1, 1.46, { side: C.rose2, top: C.rose }); B(1.02, -1.88, 0.04, 0.26, 1.1, 1.46, { side: C.rose2, top: C.rose });
    // rear: bumper, diffuser, exhausts, tail and brake lights, number plate
    B(0, -2.1, 0.92, 0.12, 0.3, 0.6, bumper);
    B(0, -2.12, 0.7, 0.1, 0.2, 0.3, dark);
    B(-0.42, -2.2, 0.1, 0.1, 0.34, 0.5, chrome); B(0.42, -2.2, 0.1, 0.1, 0.34, 0.5, chrome);
    const tail = car.braking ? { side: '#ff2f44', top: '#ffb0b8' } : { side: C.rose2, top: '#ff8a96' };
    B(-0.64, -2.12, 0.22, 0.05, 0.62, 0.78, tail); B(0.64, -2.12, 0.22, 0.05, 0.62, 0.78, tail);
    B(0, -2.12, 0.28, 0.03, 0.46, 0.58, { side: '#e9eef8', top: '#e9eef8' });
    // exhaust glow / nitro flames (screen space)
    const ex = cs(W(0, -2.25).x, 0.42, W(0, -2.25).z);
    if (ex.f > NEAR) {
      const q = sp(ex);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      if (car.boosting) {
        const flick = 0.8 + 0.4 * Math.random();
        [[-0.42, C.amber], [0.42, C.mint]].forEach(([u, c]) => { const pp = W(u, -2.25); const p = sp(cs(pp.x, 0.42, pp.z)); ctx.fillStyle = c; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.moveTo(p.x - 0.14 * p.s, p.y); ctx.lineTo(p.x + 0.14 * p.s, p.y); ctx.lineTo(p.x, p.y + 0.9 * p.s * flick); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.moveTo(p.x - 0.07 * p.s, p.y); ctx.lineTo(p.x + 0.07 * p.s, p.y); ctx.lineTo(p.x, p.y + 0.45 * p.s * flick); ctx.closePath(); ctx.fill(); });
        if (Math.random() < 0.8) S.particles.push({ x: q.x / S.view.w + (Math.random() - 0.5) * 0.04, y: q.y / S.view.h + 0.03, vx: (Math.random() - 0.5) * 0.2, vy: 0.35 + Math.random() * 0.3, g: 0.2, r: 2 + Math.random() * 3, c: Math.random() < 0.5 ? C.mint : C.amber, t: 0, max: 0.35 });
      } else {
        ctx.fillStyle = 'rgba(77,163,255,' + (0.3 + (S.input.gas ? 0.35 : 0)) + ')'; ctx.beginPath(); ctx.ellipse(q.x, q.y, 0.5 * q.s, 0.12 * q.s, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** The speedometer: a dial with ticks, a coloured sweep, a needle, the km/h readout and the nitro ring. */
  function drawSpeedo(ctx) {
    const { h: hh } = S.view;
    const cx = 78, cy = hh - 78, r = 58, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, MAXK = 280;
    const kmh = Math.abs(S.car.v) * KMH, frac = clamp(kmh / MAXK, 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,22,0.78)'; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, r + 3, a0, a1); ctx.stroke();
    ctx.strokeStyle = S.car.boosting ? C.mint : 'rgba(255,138,43,0.75)'; ctx.beginPath(); ctx.arc(cx, cy, r + 3, a0, a0 + (a1 - a0) * (S.nitro / 100)); ctx.stroke();
    ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(cx, cy, r - 6, a0, a1); ctx.stroke();
    if (frac > 0) { ctx.strokeStyle = kmh < 140 ? C.amber : kmh < 200 ? C.mint : C.rose; ctx.beginPath(); ctx.arc(cx, cy, r - 6, a0, a0 + (a1 - a0) * frac); ctx.stroke(); }
    for (let k = 0; k <= MAXK; k += 20) {
      const t = a0 + (a1 - a0) * k / MAXK, big = k % 40 === 0;
      ctx.strokeStyle = big ? '#eef3ff' : 'rgba(238,243,255,0.5)'; ctx.lineWidth = big ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * (r - 14), cy + Math.sin(t) * (r - 14)); ctx.lineTo(cx + Math.cos(t) * (r - (big ? 22 : 18)), cy + Math.sin(t) * (r - (big ? 22 : 18))); ctx.stroke();
      if (big) { ctx.fillStyle = 'rgba(238,243,255,0.8)'; ctx.font = '700 9px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k), cx + Math.cos(t) * (r - 30), cy + Math.sin(t) * (r - 30)); }
    }
    const na = a0 + (a1 - a0) * frac;
    ctx.strokeStyle = C.rose; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * 8, cy - Math.sin(na) * 8); ctx.lineTo(cx + Math.cos(na) * (r - 16), cy + Math.sin(na) * (r - 16)); ctx.stroke();
    ctx.fillStyle = '#eef3ff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#eef3ff'; ctx.font = '800 20px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.round(kmh)), cx, cy + 22);
    ctx.fillStyle = 'rgba(238,243,255,0.65)'; ctx.font = '600 9px ' + FONT; ctx.fillText('KM/H', cx, cy + 36);
    if (S.car.boosting) { ctx.fillStyle = C.mint; ctx.font = '900 11px ' + FONT; ctx.fillText('NITRO', cx, cy - 20); }
    else if (S.nitro >= 20) { ctx.fillStyle = 'rgba(255,138,43,0.7)'; ctx.font = '700 9px ' + FONT; ctx.fillText('N · nitro', cx, cy - 20); }
    ctx.restore(); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function drawFx(ctx) {
    const { w, h: hh } = S.view;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    S.particles.forEach((p) => { const k = 1 - p.t / p.max; ctx.fillStyle = p.c; ctx.globalAlpha = k * 0.9; ctx.beginPath(); ctx.arc(p.x * w, p.y * hh, p.r * (0.4 + 0.6 * k), 0, TAU); ctx.fill(); });
    if (S.car.boosting && !REDUCED) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.globalAlpha = 1;
      for (let i = 0; i < 16; i++) { const an = (i / 16) * TAU + S.anim * 0.4; const r0 = Math.min(w, hh) * 0.4 + Math.random() * 30, r1 = r0 + 60; ctx.beginPath(); ctx.moveTo(CX + Math.cos(an) * r0, HY + 60 + Math.sin(an) * r0); ctx.lineTo(CX + Math.cos(an) * r1, HY + 60 + Math.sin(an) * r1); ctx.stroke(); }
    }
    ctx.restore(); ctx.globalAlpha = 1;
    S.floats.forEach((f) => { const k = f.t / f.max; ctx.globalAlpha = 1 - k; ctx.font = '800 22px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 6; ctx.fillStyle = f.c; ctx.fillText(f.text, f.fx * w, f.fy * hh - 50 * k); ctx.shadowBlur = 0; });
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (S.mode === 'play' || S.mode === 'question') {
      drawSpeedo(ctx);
      const g = nearestGate(S.car.x, S.car.z);
      const target = g.open || g.best;
      if (target) {
        const ang = Math.atan2(target.x - S.car.x, target.z - S.car.z) - S.cam.a;
        const cxp = w - 50, cyp = hh - 54;
        ctx.fillStyle = 'rgba(6,10,22,0.6)'; ctx.beginPath(); ctx.arc(cxp, cyp, 26, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.save(); ctx.translate(cxp, cyp); ctx.rotate(ang); ctx.fillStyle = g.open ? C.amber : C.mint; ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(7, 6); ctx.lineTo(0, 1); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill(); ctx.restore();
        ctx.font = '700 11px ' + FONT; ctx.fillStyle = '#eef3ff'; ctx.textAlign = 'center'; ctx.fillText(Math.round(target.d) + ' m', cxp, cyp + 40); ctx.fillStyle = 'rgba(238,243,255,0.6)'; ctx.font = '600 9px ' + FONT; ctx.fillText('GATE', cxp, cyp - 34); ctx.textAlign = 'left';
      }
    }
  }

  function render() {
    const ctx = D.ctx;
    const { w, h: hh, dpr } = S.view;
    F = hh * 0.95; HY = Math.round(hh * 0.42); CX = w / 2; SINA = Math.sin(S.cam.a); COSA = Math.cos(S.cam.a); RATIO = (w / 2) / F + 0.05;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    if (S.shake > 0 && !REDUCED) ctx.translate((Math.random() - 0.5) * 12 * S.shake, (Math.random() - 0.5) * 8 * S.shake);
    const P = S.prof, now = () => performance.now();
    let t0 = P ? now() : 0;
    drawSky(ctx);
    if (P) { P.sky += now() - t0; t0 = now(); }
    drawWorld(ctx);
    if (P) { P.world += now() - t0; t0 = now(); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFx(ctx);
    if (P) { P.fx += now() - t0; P.frames++; }
    if (S.flash > 0) { ctx.fillStyle = fogged(S.flashColor, 0, 1, 0.3 * S.flash); ctx.fillRect(0, 0, w, hh); }
  }

  /** Minimap: biome tint, roads, district walls, gates, the car. The biome layer is re-sampled only when the car has moved. */
  function drawMini() {
    const m = D.mctx, size = 132, scale = 0.42;   // px per world unit → ~310 units across
    const car = S.car;
    if (!S.mini || Math.hypot(S.mini.x - car.x, S.mini.z - car.z) > 10) {
      const off = S.mini && S.mini.c ? S.mini.c : document.createElement('canvas'); off.width = size; off.height = size;
      const o = off.getContext('2d'), step = 6;
      for (let py = 0; py < size; py += step) for (let px = 0; px < size; px += step) {
        const wx = car.x + (px + step / 2 - size / 2) / scale, wz = car.z - (py + step / 2 - size / 2) / scale;
        o.fillStyle = BIOMES[biomeAt(wx, wz)].ground[0]; o.fillRect(px, py, step, step);
        if (cityAt(wx, wz)) { o.fillStyle = 'rgba(40,46,70,0.55)'; o.fillRect(px, py, step, step); }
      }
      S.mini = { x: car.x, z: car.z, c: off };
    }
    m.clearRect(0, 0, size, size);
    m.save(); m.beginPath(); m.arc(size / 2, size / 2, size / 2 - 1, 0, TAU); m.clip();
    m.globalAlpha = 0.85; m.drawImage(S.mini.c, 0, 0); m.globalAlpha = 1;
    const toPx = (wx, wz) => ({ x: size / 2 + (wx - car.x) * scale, y: size / 2 - (wz - car.z) * scale });
    const span = size / scale / 2 + 20;
    m.strokeStyle = 'rgba(40,46,70,0.95)'; m.lineWidth = 2.5;
    for (let k = Math.floor((car.x - span) / BLOCK); k <= Math.ceil((car.x + span) / BLOCK); k++) { const p = toPx(k * BLOCK + HALF, 0); m.beginPath(); m.moveTo(p.x, 0); m.lineTo(p.x, size); m.stroke(); }
    for (let k = Math.floor((car.z - span) / BLOCK); k <= Math.ceil((car.z + span) / BLOCK); k++) { const p = toPx(0, k * BLOCK + HALF); m.beginPath(); m.moveTo(0, p.y); m.lineTo(size, p.y); m.stroke(); }
    m.strokeStyle = 'rgba(190,196,214,0.9)'; m.lineWidth = 2;
    for (let k = Math.floor((car.x - span - WALL_OFF) / DIST); k <= Math.ceil((car.x + span - WALL_OFF) / DIST); k++) { const p = toPx(k * DIST + WALL_OFF, 0); m.beginPath(); m.moveTo(p.x, 0); m.lineTo(p.x, size); m.stroke(); }
    for (let k = Math.floor((car.z - span - WALL_OFF) / DIST); k <= Math.ceil((car.z + span - WALL_OFF) / DIST); k++) { const p = toPx(0, k * DIST + WALL_OFF); m.beginPath(); m.moveTo(0, p.y); m.lineTo(size, p.y); m.stroke(); }
    for (let k = Math.floor((car.x - span - WALL_OFF) / DIST); k <= Math.ceil((car.x + span - WALL_OFF) / DIST); k++) for (let j = Math.floor((car.z - span) / BLOCK); j <= Math.ceil((car.z + span) / BLOCK); j++) { const p = toPx(k * DIST + WALL_OFF, j * BLOCK + HALF); m.fillStyle = S.cleared.has(gateKey('x', k, j)) ? C.mint : C.amber; m.beginPath(); m.arc(p.x, p.y, 3, 0, TAU); m.fill(); }
    for (let k = Math.floor((car.z - span - WALL_OFF) / DIST); k <= Math.ceil((car.z + span - WALL_OFF) / DIST); k++) for (let i = Math.floor((car.x - span) / BLOCK); i <= Math.ceil((car.x + span) / BLOCK); i++) { const p = toPx(i * BLOCK + HALF, k * DIST + WALL_OFF); m.fillStyle = S.cleared.has(gateKey('z', k, i)) ? C.mint : C.amber; m.beginPath(); m.arc(p.x, p.y, 3, 0, TAU); m.fill(); }
    m.save(); m.translate(size / 2, size / 2); m.rotate(car.a); m.fillStyle = '#fff'; m.beginPath(); m.moveTo(0, -6); m.lineTo(4.5, 5); m.lineTo(0, 2.5); m.lineTo(-4.5, 5); m.closePath(); m.fill(); m.restore();
    m.restore();
    m.strokeStyle = 'rgba(255,255,255,0.35)'; m.lineWidth = 1.5; m.beginPath(); m.arc(size / 2, size / 2, size / 2 - 1, 0, TAU); m.stroke();
  }

  /* ------------------------------------------------------------
     Global listeners
     ------------------------------------------------------------ */
  const KEYS = { ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ' ': 'hand', Shift: 'nitro', n: 'nitro', N: 'nitro' };
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
  function onBlur() { if (S) S.input = noInput(); }
  function onVisibility() { if (document.hidden && S && S.mode === 'play') pause(); }
  function onResize() { resizeCanvas(); }

  /* ------------------------------------------------------------
     Mount / unmount + registration
     ------------------------------------------------------------ */
  PQ.Games.register({
    id: ID,
    name: 'Word Highway',
    tagline: 'Open-world 3D driving. Explore the biomes, answer at the gates.',
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
      if (S && D && !S.saved && S.asked > 0) saveBest();   // leaving mid-run counts once a gate has been reached
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
    teleport(x, z, a) { if (!S) return; S.car.x = x; S.car.z = z; if (a != null) S.car.a = a; S.car.v = 0; S.car.vx = 0; S.car.vz = 0; S.cam.a = S.car.a; S.cam.x = x - Math.sin(S.cam.a) * CAM_BACK; S.cam.z = z - Math.cos(S.cam.a) * CAM_BACK; S.armed = null; S.rearmAt = 0; },
    car() { return S ? Object.assign({}, S.car) : null; },
    biomeAt(x, z) { return S ? biomeAt(x, z) : null; },
    /** Scan outward from the start for the nearest tile centre of a biome. */
    findBiome(name) { if (!S) return null; for (let r = 1; r < 220; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; const x = i * 32 + 4, z = j * 32 + 4; if (biomeAt(x, z) === name && !cityAt(x, z)) return { x, z }; } return null; },
    /** The nearest city tile centre, optionally in a given biome. */
    findCity(biome) { if (!S) return null; for (let r = 1; r < 220; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue; const x = i * 32 + 4, z = j * 32 + 4; if (cityAt(x, z) && (!biome || biomeAt(x, z) === biome)) return { x, z, biome: biomeAt(x, z) }; } return null; },
    cityAt(x, z) { return S ? cityAt(x, z) : null; },
    nearestGate(x, z) { return S ? nearestGate(x == null ? S.car.x : x, z == null ? S.car.z : z) : null; },
    layout() { return { TILE, BLOCK, DIST, WALL_OFF, HALF, GATE_R, MAX_SPEED, KMH, ZONES }; },
    colors() { return CAR_COLORS.map((c) => c.id); },
    /** Add an ad-hoc coin or solid rock at a world position (tests). */
    spawn(type, x, z) { if (!S) return null; const o = { type, x, z, solid: type !== 'coin', r: type === 'coin' ? 0.6 : 1.0, v: 0.5, taken: false, id: ++S.uid }; S.extra.push(o); return o.id; },
    setFuel(n) { if (S) { S.fuel = clamp(Number(n) || 0, 0, FUEL_MAX); updateHud(false); } },
    setNitro(n) { if (S) { S.nitro = clamp(Number(n) || 0, 0, 100); updateHud(false); } },
    forceKind(k) { if (S) S.forceKind = k || null; },
    dismiss() { if (!S || !S.question) return false; closeQuestion(); S.mode = 'play'; S.lastT = 0; S.rearmAt = S.t + 2.5; return true; },
    freeze(on) { if (S) S.frozen = on !== false; },
    tileObj(tx, tz) { return S ? tileObj(tx, tz) : null; },
    pause() { if (S) pause(); },
    resume() { if (S) resume(); },
    profile() {
      if (!S) return null;
      const P = S.prof, out = P && P.frames ? { frames: P.frames, sky: P.sky / P.frames, tiles: P.tiles / P.frames, marks: P.marks / P.frames, items: P.items / P.frames, fx: P.fx / P.frames, world: P.world / P.frames, tilesPerFrame: P.nTiles / P.frames, objsPerFrame: P.nObjs / P.frames, itemsPerFrame: P.nItems / P.frames } : null;
      S.prof = { frames: 0, sky: 0, world: 0, tiles: 0, marks: 0, items: 0, fx: 0, nTiles: 0, nObjs: 0, nItems: 0, _t: 0 };
      return out;
    },
  };
})();
