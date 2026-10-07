/* Playwright test for Word Rain (blaster).
   Run: node tests/blaster.test.js */
const { launch, assert, SITE } = require('./helpers');
const path = require('path');

const SHOTS = process.env.PQ_SHOTS || '/tmp/claude-0/-home-user-Spanishvocab/a02e9093-c152-5782-8ad7-edac27261f74/scratchpad';
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }).catch(() => {}); };

const dbg = (page, fn, arg) => page.evaluate(fn, arg);
const mode = (page) => dbg(page, () => PQ.debug.blaster.state && PQ.debug.blaster.state.mode);
const meteors = (page) => dbg(page, () => PQ.debug.blaster.listMeteors());
const word = (page, id) => dbg(page, (i) => PQ.Progress.word(i), id);
const inputFocused = (page) => dbg(page, () => document.activeElement === PQ.debug.blaster.dom.input);
const noOverflow = (page) => dbg(page, () => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Type an answer into the focused game input and press Enter (real keystrokes). */
async function typeAnswer(page, text) {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(60);
}

/** Spawn a specific vocab entry (by id) and return its meteor info. */
async function spawn(page, id) {
  const m = await dbg(page, (i) => PQ.debug.blaster.spawn(i), id);
  assert(m && m.entryId === id, 'spawned meteor for ' + id);
  return m;
}

let VOCAB = [];
const entry = (id) => VOCAB.find((e) => e.id === id);

(async () => {
  // ================= DESKTOP 1280px =================
  {
    const { browser, page, errors } = await launch({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(SITE + '#/play/blaster');
      await page.waitForSelector('.g-blaster canvas');
      VOCAB = await page.evaluate(() => window.VOCAB.map((e) => ({ id: e.id, en: e.en, base: e.base, answers: e.answers, cat: e.cat })));
      await page.evaluate(() => { PQ.Progress.reset(); });

      // ---- registration ----
      const reg = await page.evaluate(() => { const g = PQ.Games.get('blaster'); return { name: g.name, icon: g.icon, order: g.order, accent: g.accent }; });
      assert(reg.name === 'Word Rain' && reg.icon === '☄️' && reg.order === 4 && reg.accent === 'var(--c-rose)', 'registration fields: ' + JSON.stringify(reg));

      // ---- intro ----
      assert(await mode(page) === 'intro', 'starts in intro mode');
      assert(await page.$('.g-blaster .game-overlay .panel') != null, 'intro overlay visible');
      assert(await noOverflow(page), 'no horizontal overflow on desktop');
      const cs = await page.$eval('.g-blaster canvas', (c) => ({ w: c.clientWidth, h: c.clientHeight, bw: c.width, bh: c.height }));
      assert(cs.h >= 400 && cs.h <= 470 && cs.w > 900 && cs.bw === cs.w && cs.bh === cs.h, 'desktop canvas sized and dpr-aware: ' + JSON.stringify(cs));
      await shot(page, 'blaster-intro.png');

      // Start with the mouse; the typing input must take focus
      await page.click('.g-blaster .game-overlay button.btn-primary');
      assert(await mode(page) === 'play', 'Start begins play');
      assert(await page.$('.g-blaster .game-overlay') == null, 'intro overlay removed');
      await page.waitForTimeout(100);
      assert(await inputFocused(page), 'input focused after start');
      const st0 = await dbg(page, () => { const s = PQ.debug.blaster.state; return { wave: s.wave, lives: s.lives, total: s.waveTotal, queue: s.queue.length }; });
      assert(st0.wave === 1 && st0.lives === 3 && st0.total === 4 && st0.queue === 4, 'wave 1 has 4 meteors queued: ' + JSON.stringify(st0));
      const queueIds = await dbg(page, () => PQ.debug.blaster.state.queue.map((e) => e.id));
      assert(queueIds.every((id) => !!entry(id)) && new Set(queueIds).size === queueIds.length, 'queue only holds unique sheet words');

      // Freeze the fall so the test controls every impact, and keep one meteor on screen
      // so the wave cannot clear itself before the explicit wave-clear step below.
      await dbg(page, () => PQ.debug.blaster.freeze(true));
      const blocker = await spawn(page, 'arte');

      // ---- accent-only mistake, then the fix ----
      const fr = await spawn(page, 'frances');
      const w0 = await word(page, 'frances');
      await typeAnswer(page, 'frances');
      let list = await meteors(page);
      let m = list.find((x) => x.id === fr.id);
      assert(m && m.cracked && m.reveal === 'francés', 'accent slip cracks the meteor and reveals the spelling: ' + JSON.stringify(m));
      const w1 = await word(page, 'frances');
      assert(w1.acc === w0.acc + 1 && w1.n === w0.n + 1, 'accent slip recorded once');
      const sm = await dbg(page, (id) => PQ.debug.blaster.state.meteors.find((x) => x.id === id).speedMult, fr.id);
      assert(sm === 0.5, 'cracked meteor slowed 50%');
      assert(await page.$eval('.g-blaster-input', (el) => el.classList.contains('is-accent')), 'input shakes amber on an accent slip');
      assert(await page.$eval('.g-blaster-input', (el) => el.value === ''), 'input cleared after submit');
      assert(await inputFocused(page), 'input still focused after submit');
      await shot(page, 'blaster-cracked.png');
      // a second slip on the same meteor must not record again
      await typeAnswer(page, 'frances');
      const w1b = await word(page, 'frances');
      assert(w1b.n === w1.n, 'same meteor is never recorded twice (second slip)');
      const score0 = await dbg(page, () => PQ.debug.blaster.state.score);
      await typeAnswer(page, 'francés');
      list = await meteors(page);
      assert(!list.find((x) => x.id === fr.id), 'correct spelling destroys the cracked meteor');
      const w2 = await word(page, 'frances');
      assert(w2.n === w1.n && w2.ok === w1.ok, 'destroying an already-recorded meteor does not record again');
      const score1 = await dbg(page, () => PQ.debug.blaster.state.score);
      assert(score1 > score0, 'destroy scores points: ' + score0 + ' → ' + score1);

      // ---- wrong answer ----
      const cu = await spawn(page, 'cual');
      await dbg(page, () => { PQ.debug.blaster.state.combo = 5; });
      const wrongBefore = await word(page, 'cual');
      await typeAnswer(page, 'zzzz');
      assert(await page.$eval('.g-blaster-input', (el) => el.classList.contains('is-wrong')), 'input shakes red on a wrong answer');
      const comboAfterWrong = await dbg(page, () => PQ.debug.blaster.state.combo);
      assert(comboAfterWrong === 3, 'wrong answer takes a small combo penalty: ' + comboAfterWrong);
      const wrongAfter = await word(page, 'cual');
      assert(wrongAfter.n === wrongBefore.n, 'a non-matching answer records nothing');
      list = await meteors(page);
      assert(list.find((x) => x.id === cu.id && !x.cracked), 'wrong answer leaves the meteor intact');
      // punctuation and case are ignored, accents are not
      await typeAnswer(page, '¿Cuál?');
      list = await meteors(page);
      assert(!list.find((x) => x.id === cu.id), '¿Cuál? destroys the meteor');

      // ---- correct answer (fresh meteor) with the backtick accent trick ----
      const es = await spawn(page, 'espanol');
      const e0 = await word(page, 'espanol');
      const sc0 = await dbg(page, () => PQ.debug.blaster.state.score);
      await page.keyboard.type('espan');
      await page.keyboard.press('`');
      await page.keyboard.type('ol');
      assert(await page.$eval('.g-blaster-input', (el) => el.value === 'español'), 'backtick accent trick works in the input');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(60);
      list = await meteors(page);
      assert(!list.find((x) => x.id === es.id), 'correct answer destroys the meteor');
      const e1 = await word(page, 'espanol');
      assert(e1.ok === e0.ok + 1 && e1.n === e0.n + 1, 'correct recorded once');
      const sc1 = await dbg(page, () => PQ.debug.blaster.state.score);
      assert(sc1 - sc0 >= 100, 'full points for a fresh meteor: +' + (sc1 - sc0));
      assert(await page.$eval('.g-blaster-input', (el) => el.classList.contains('is-correct')), 'input flashes green');
      assert(await dbg(page, () => PQ.debug.blaster.state.lasers.length + PQ.debug.blaster.state.particles.length) > 0, 'laser + explosion effects spawned');

      // gendered entries accept either form
      const fav = await spawn(page, 'favorito');
      await typeAnswer(page, 'favorita');
      list = await meteors(page);
      assert(!list.find((x) => x.id === fav.id), 'feminine form accepted');

      // Enter on an empty input is harmless
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
      assert(await mode(page) === 'play', 'empty submit ignored');

      // ---- a meteor reaching the city ----
      const di = await spawn(page, 'dificil');
      const d0 = await word(page, 'dificil');
      await dbg(page, (id) => PQ.debug.blaster.drop(id), di.id);
      await page.waitForTimeout(150);
      const after = await dbg(page, () => { const s = PQ.debug.blaster.state; return { lives: s.lives, combo: s.combo, missed: s.missed.map((e) => e.id), flash: s.flash }; });
      assert(after.lives === 2, 'city hit costs a life: ' + JSON.stringify(after));
      assert(after.combo === 0 && after.missed.includes('dificil'), 'combo reset and word listed as missed');
      assert(after.flash > 0, 'screen flash on a city hit');
      const d1 = await word(page, 'dificil');
      assert(d1.wrong === d0.wrong + 1 && d1.n === d0.n + 1, 'city hit recorded as wrong');
      const msg = await page.$eval('.g-blaster-hudmsg', (el) => ({ on: el.classList.contains('is-on'), es: el.querySelector('.g-blaster-hudmsg-es').textContent, en: el.querySelector('.g-blaster-hudmsg-en').textContent, speak: !!el.querySelector('.g-blaster-hudmsg-speak') }));
      assert(msg.on && msg.es === 'difícil' && msg.en === 'difficult' && msg.speak, 'HUD shows the correct spelling with a speaker: ' + JSON.stringify(msg));
      const hearts = await page.$$eval('.g-blaster-heart', (els) => els.map((e) => e.classList.contains('is-off')));
      assert(JSON.stringify(hearts) === '[false,false,true]', 'hearts show 2 lives');
      await shot(page, 'blaster-hit.png');
      await page.click('.g-blaster-hudmsg-speak');
      assert(await inputFocused(page), 'speaker button keeps the input focused');
      await page.waitForTimeout(2600);
      assert(await page.$eval('.g-blaster-hudmsg', (el) => !el.classList.contains('is-on')), 'HUD message disappears after 2.5s');

      // ---- clear wave 1 by playing through the remaining meteors (the blocker included) ----
      assert((await meteors(page)).some((x) => x.id === blocker.id), 'blocker still on screen, wave 1 not cleared early');
      for (let guard = 0; guard < 40; guard++) {
        const st = await dbg(page, () => { const s = PQ.debug.blaster.state; return { phase: s.phase, spawned: s.spawned, total: s.waveTotal, wave: s.wave }; });
        if (st.wave !== 1 || st.phase === 'banner') break;
        let ms = await meteors(page);
        if (!ms.length) {
          if (st.spawned < st.total) { await dbg(page, () => PQ.debug.blaster.spawn()); ms = await meteors(page); }
          else { await page.waitForTimeout(100); continue; }
        }
        assert(new Set(ms.map((x) => x.entryId)).size === ms.length, 'never the same word on screen twice');
        assert(ms.length <= 4, 'at most 4 meteors on screen');
        const target = ms[0];
        const r = await dbg(page, (t) => PQ.debug.blaster.submit(t), entry(target.entryId).answers[0]);
        assert(r.status === 'correct', 'submit canonical destroys ' + target.entryId + ': ' + JSON.stringify(r));
        await page.waitForTimeout(40);
      }
      await page.waitForFunction(() => PQ.debug.blaster.state.phase === 'banner' && PQ.debug.blaster.state.wave === 1, null, { timeout: 4000 });
      const banner = await page.$eval('.g-blaster-banner', (el) => ({ on: el.classList.contains('is-on'), title: el.querySelector('.g-blaster-banner-title').textContent, list: Array.from(el.querySelectorAll('.g-blaster-banner-list span')).map((s) => s.textContent) }));
      assert(banner.on && banner.title === 'Wave 1 cleared', 'wave cleared banner: ' + JSON.stringify(banner));
      assert(banner.list.some((t) => t.includes('difficult') && t.includes('difícil')), 'banner lists the missed word with its spelling');
      await shot(page, 'blaster-wave-cleared.png');
      await page.waitForFunction(() => PQ.debug.blaster.state.wave === 2, null, { timeout: 6000 });
      const w2st = await dbg(page, () => { const s = PQ.debug.blaster.state; return { total: s.waveTotal, spawned: s.spawned, lives: s.lives }; });
      assert(w2st.total === 5 && w2st.spawned === 0 && w2st.lives === 2, 'wave 2 queued with 5 meteors: ' + JSON.stringify(w2st));
      // wave 2 falls faster
      await page.waitForFunction(() => PQ.debug.blaster.listMeteors().length > 0, null, { timeout: 5000 });
      const vy2 = await dbg(page, () => PQ.debug.blaster.state.meteors[0].vy);
      assert(vy2 >= (1 / 13.9) * 0.88 - 1e-6, 'wave 2 meteors use the faster wave-2 fall time: ' + vy2);
      // Bring a few meteors into view (frozen) for the visual check, one of them cracked
      await spawn(page, 'cuantos');
      await spawn(page, 'septimo');
      await dbg(page, () => PQ.debug.blaster.submit('septimo'));
      await dbg(page, () => { PQ.debug.blaster.state.meteors.forEach((m, i) => { m.fy = 0.2 + i * 0.22; }); });
      await page.waitForTimeout(120);
      await shot(page, 'blaster-play.png');

      // ---- pause: Esc while typing, P when the input is not focused, button, resume ----
      await page.keyboard.type('pr');
      assert(await page.$eval('.g-blaster-input', (el) => el.value === 'pr'), 'p types into the focused input instead of pausing');
      await page.keyboard.press('Escape');
      assert(await mode(page) === 'pause', 'Esc pauses while the input is focused');
      assert(await page.$('.g-blaster .game-overlay') != null, 'pause overlay shown');
      const tPaused = await dbg(page, () => PQ.debug.blaster.state.t);
      await page.waitForTimeout(250);
      assert(await dbg(page, () => PQ.debug.blaster.state.t) === tPaused, 'game clock frozen while paused');
      await shot(page, 'blaster-pause.png');
      await page.keyboard.press('Escape');
      assert(await mode(page) === 'play', 'Esc resumes');
      await page.waitForTimeout(80);
      assert(await inputFocused(page), 'input refocused after resume');
      assert(await page.$eval('.g-blaster-input', (el) => el.value === 'pr'), 'draft kept across pause');
      await page.evaluate(() => { PQ.debug.blaster.dom.input.value = ''; PQ.debug.blaster.dom.input.blur(); });
      await page.keyboard.press('p');
      assert(await mode(page) === 'pause', 'P pauses when the input is not focused');
      await page.click('.g-blaster .game-overlay button.btn-primary');
      assert(await mode(page) === 'play', 'Resume button resumes');
      await page.click('.g-blaster-pausebtn');
      assert(await mode(page) === 'pause', 'pause button pauses');
      await page.keyboard.press('Escape');
      assert(await mode(page) === 'play', 'resume again');
      // typing with focus elsewhere lands in the input; clicking the canvas refocuses it
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.type('x');
      assert(await inputFocused(page) && await page.$eval('.g-blaster-input', (el) => el.value === 'x'), 'stray keystrokes are routed into the input');
      await page.evaluate(() => { PQ.debug.blaster.dom.input.value = ''; document.activeElement.blur(); });
      await page.click('.g-blaster canvas', { position: { x: 100, y: 100 } });
      assert(await inputFocused(page), 'clicking the canvas refocuses the input');
      // hidden tab pauses
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      assert(await mode(page) === 'pause', 'visibilitychange pauses');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
      await page.keyboard.press('Escape');
      assert(await mode(page) === 'play', 'resumed after tab visible');

      // ---- game over ----
      await dbg(page, () => PQ.debug.blaster.setLives(1));
      const scoreFinal = await dbg(page, () => PQ.debug.blaster.state.score);
      const ut = await spawn(page, 'util');
      await dbg(page, (id) => PQ.debug.blaster.drop(id), ut.id);
      await page.waitForTimeout(120);
      assert(await mode(page) === 'ending', 'last life → ending');
      await page.waitForSelector('.g-blaster-over', { timeout: 3000 });
      assert(await mode(page) === 'over', 'game over mode');
      const over = await page.$eval('.g-blaster-over', (el) => ({
        big: el.querySelector('.big').textContent,
        stats: Array.from(el.querySelectorAll('.stat')).map((s) => s.querySelector('.stat-label').textContent + '=' + s.querySelector('.stat-val').textContent),
        missed: Array.from(el.querySelectorAll('.g-blaster-missed-row')).map((r) => r.querySelector('.en').textContent + '|' + r.querySelector('.es').textContent),
        newBest: !!el.querySelector('.g-blaster-newbest'),
        retry: !!el.querySelector('button.btn-primary'),
        home: !!el.querySelector('a[href="#/"]'),
      }));
      assert(over.big.replace(/,/g, '') === String(scoreFinal), 'final score shown: ' + over.big);
      assert(over.stats.some((s) => s.startsWith('Wave=2')) && over.stats.some((s) => s.startsWith('Destroyed=')) && over.stats.some((s) => /^Accuracy=\d+%$/.test(s)), 'stats grid: ' + over.stats.join(', '));
      assert(over.missed.includes('difficult|difícil') && over.missed.includes('useful|útil'), 'missed list with correct spellings: ' + over.missed.join(', '));
      assert(over.newBest && over.retry && over.home, 'new best + retry/home buttons');
      const best = await dbg(page, () => PQ.Progress.gameStats('blaster'));
      assert(best.best === scoreFinal && best.wave === 2 && best.plays === 1, 'best saved with wave: ' + JSON.stringify(best));
      assert(await page.$eval('.g-blaster-best', (el) => el.textContent.includes('wave 2')), 'topbar best pill updated');
      await shot(page, 'blaster-gameover.png');
      const fitDesk = await page.evaluate(() => {
        const s = document.querySelector('.g-blaster-stage').getBoundingClientRect();
        const b = document.querySelector('.g-blaster-over a[href="#/"]').getBoundingClientRect();
        return { ok: b.top >= s.top && b.bottom <= s.bottom, stage: [s.top, s.bottom], btn: [b.top, b.bottom] };
      });
      assert(fitDesk.ok, 'game over buttons fully inside the stage on desktop: ' + JSON.stringify(fitDesk));
      await page.click('.g-blaster-over button.btn-primary');
      const again = await dbg(page, () => { const s = PQ.debug.blaster.state; return { mode: s.mode, lives: s.lives, score: s.score, wave: s.wave, meteors: s.meteors.length }; });
      assert(again.mode === 'play' && again.lives === 3 && again.score === 0 && again.wave === 1 && again.meteors === 0, 'Retry starts a fresh run: ' + JSON.stringify(again));
      assert(await page.$('.g-blaster-over') == null, 'game over overlay removed');
      await page.waitForTimeout(80);
      assert(await inputFocused(page), 'input focused after retry');

      // ---- navigate away: everything must stop; then come back ----
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(200);
      const gone = await dbg(page, () => ({ state: PQ.debug.blaster.state, dom: PQ.debug.blaster.dom, running: PQ.debug.blaster.running, els: document.querySelectorAll('.g-blaster, .game-overlay, .g-blaster-banner').length }));
      assert(gone.state === null && gone.dom === null && gone.running === false && gone.els === 0, 'unmount leaves nothing behind: ' + JSON.stringify(gone));
      await page.keyboard.press('Escape');
      await page.keyboard.press('p');
      await page.evaluate(() => { window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('visibilitychange')); });
      await page.evaluate(() => { location.hash = '#/play/blaster'; });
      await page.waitForSelector('.g-blaster canvas');
      assert(await mode(page) === 'intro', 'remount starts fresh in intro');
      await page.keyboard.press('Enter');
      assert(await mode(page) === 'play', 'Enter on the intro starts the game');
      await page.waitForTimeout(1300);
      await page.waitForFunction(() => PQ.debug.blaster.listMeteors().length > 0, null, { timeout: 5000 });
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(150);
      await page.evaluate(() => { location.hash = '#/play/blaster'; });
      await page.waitForSelector('.g-blaster canvas');
      assert(await mode(page) === 'intro', 'second remount ok');

      assert(errors.length === 0, 'console errors (desktop): ' + errors.join('\n'));
      console.log('desktop: OK');
    } finally {
      await browser.close();
    }
  }

  // ================= MOBILE 390px, touch =================
  {
    const { browser, page, errors } = await launch({ viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    try {
      await page.goto(SITE + '#/play/blaster');
      await page.waitForSelector('.g-blaster canvas');
      await page.evaluate(() => { PQ.Progress.reset(); });
      assert(await noOverflow(page), 'no horizontal overflow at 390px');
      const cs = await page.$eval('.g-blaster canvas', (c) => ({ w: c.clientWidth, h: c.clientHeight }));
      assert(cs.w <= 390 && cs.w > 300 && cs.h >= 300 && cs.h <= 360, 'canvas sized for mobile: ' + JSON.stringify(cs));
      const hintHidden = await page.$eval('.g-blaster .accent-hint', (el) => getComputedStyle(el).display === 'none');
      assert(hintHidden, 'backtick tip hidden on touch devices');
      await shot(page, 'blaster-mobile-intro.png');
      const sb = await (await page.$('.g-blaster .game-overlay button.btn-primary')).boundingBox();
      await page.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2);
      assert(await mode(page) === 'play', 'touch tap starts the game');
      await dbg(page, () => PQ.debug.blaster.freeze(true));
      assert(await noOverflow(page), 'no horizontal overflow while playing');

      // tap the canvas → input focused; accent bar inserts characters
      const cb = await (await page.$('.g-blaster canvas')).boundingBox();
      await page.touchscreen.tap(cb.x + 60, cb.y + 60);
      await page.waitForTimeout(80);
      assert(await inputFocused(page), 'tapping the sky focuses the input');
      const key = await (await page.$('.g-blaster .accent-key[aria-label="insert ñ"]')).boundingBox();
      await page.touchscreen.tap(key.x + key.width / 2, key.y + key.height / 2);
      assert(await page.$eval('.g-blaster-input', (el) => el.value === 'ñ'), 'accent bar inserts ñ');
      await page.evaluate(() => { PQ.debug.blaster.dom.input.value = ''; });

      // type an answer with the keyboard and fire with the touch button
      const ing = await spawn(page, 'ingles');
      await page.keyboard.type('ingles');
      const fb = await (await page.$('.g-blaster-fire')).boundingBox();
      await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await page.waitForTimeout(60);
      let ms = await meteors(page);
      let mm = ms.find((x) => x.id === ing.id);
      assert(mm && mm.cracked && mm.reveal === 'inglés', 'mobile accent slip cracks the meteor');
      await shot(page, 'blaster-mobile-play.png');
      await page.keyboard.type('inglés');
      await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await page.waitForTimeout(60);
      ms = await meteors(page);
      assert(!ms.find((x) => x.id === ing.id), 'mobile fire button destroys the meteor');
      // label pills stay inside the canvas on narrow screens
      const widest = await spawn(page, 'hora-de');
      assert(widest, 'long label meteor spawned');
      await page.waitForTimeout(100);
      await shot(page, 'blaster-mobile-long-label.png');
      const wrongR = await dbg(page, () => PQ.debug.blaster.submit('nope'));
      assert(wrongR.status === 'wrong', 'mobile wrong answer');

      // game over panel must fit inside the stage on mobile
      await dbg(page, () => PQ.debug.blaster.setLives(1));
      await dbg(page, (id) => PQ.debug.blaster.drop(id), widest.id);
      await page.waitForSelector('.g-blaster-over', { timeout: 3000 });
      await shot(page, 'blaster-mobile-gameover.png');
      const fit = await page.evaluate(() => {
        const s = document.querySelector('.g-blaster-stage').getBoundingClientRect();
        const b = document.querySelector('.g-blaster-over button.btn-primary').getBoundingClientRect();
        return { ok: b.top >= s.top && b.bottom <= s.bottom && b.left >= s.left && b.right <= s.right, stage: [s.top, s.bottom], btn: [b.top, b.bottom] };
      });
      assert(fit.ok, 'Retry button fully inside the stage on mobile: ' + JSON.stringify(fit));
      assert(await noOverflow(page), 'no overflow with the game over panel');
      const rb = await (await page.$('.g-blaster-over button.btn-primary')).boundingBox();
      await page.touchscreen.tap(rb.x + rb.width / 2, rb.y + rb.height / 2);
      assert(await mode(page) === 'play', 'touch Retry restarts');

      // unmount / remount on mobile
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForTimeout(150);
      assert(await dbg(page, () => PQ.debug.blaster.state === null && !PQ.debug.blaster.running), 'mobile unmount clean');
      await page.evaluate(() => { location.hash = '#/play/blaster'; });
      await page.waitForSelector('.g-blaster canvas');
      assert(await mode(page) === 'intro', 'mobile remount ok');
      assert(errors.length === 0, 'console errors (mobile): ' + errors.join('\n'));
      console.log('mobile: OK');
    } finally {
      await browser.close();
    }
  }
  console.log('ALL BLASTER TESTS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
