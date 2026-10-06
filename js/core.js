/* ============================================================
   PALABRA QUEST — Core engine
   Shared by every game. Exposes window.PQ = {
     Vocab, Text, Progress, Settings, Quiz, QuizUI, UI, Sound,
     Speech, Games, Router, App, Rand
   }
   Plain script (no modules) so the site works from file:// and
   on any static host (Cloudflare Pages, GitHub Pages, ...).
   ============================================================ */
(function () {
  'use strict';

  const PQ = {};
  window.PQ = PQ;

  /* ------------------------------------------------------------
     Rand — seedable RNG (mulberry32) + helpers
     ------------------------------------------------------------ */
  const Rand = {
    seeded(seed) {
      let a = (seed >>> 0) || 1;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    int(min, max, rng) { const r = rng ? rng() : Math.random(); return Math.floor(r * (max - min + 1)) + min; },
    pick(arr, rng) { if (!arr || !arr.length) return undefined; return arr[Rand.int(0, arr.length - 1, rng)]; },
    shuffle(arr, rng) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Rand.int(0, i, rng);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    chance(p, rng) { return (rng ? rng() : Math.random()) < p; },
  };
  PQ.Rand = Rand;

  /* ------------------------------------------------------------
     Text — Spanish string helpers
     ------------------------------------------------------------ */
  const ACCENT_MAP = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', n: 'ñ', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', N: 'Ñ' };
  const UNACCENT_MAP = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n', 'ü': 'u', 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ñ': 'N', 'Ü': 'U' };
  const SPECIAL_CHARS = 'áéíóúñü';

  const Text = {
    ACCENT_MAP,
    SPECIAL_CHARS,
    /** Canonical comparison form: NFC, lowercase, no ¿?¡! punctuation, no "...", single spaces. */
    normalize(s) {
      return String(s == null ? '' : s)
        .normalize('NFC')
        .toLowerCase()
        .replace(/[¿¡?!.,;:"'`´]/g, ' ')
        .replace(/…/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
    /** Remove accent marks (á→a, ñ→n, ü→u). */
    stripAccents(s) {
      return String(s == null ? '' : s).normalize('NFC').replace(/[áéíóúñüÁÉÍÓÚÑÜ]/g, (c) => UNACCENT_MAP[c] || c);
    },
    isSpecial(ch) { return SPECIAL_CHARS.indexOf(String(ch).toLowerCase()) >= 0; },
    /** Indices of accented / special characters in s. */
    accentPositions(s) {
      const out = [];
      const str = String(s).normalize('NFC');
      for (let i = 0; i < str.length; i++) if (Text.isSpecial(str[i])) out.push(i);
      return out;
    },
    hasAccent(s) { return Text.accentPositions(s).length > 0; },
    /** Toggle the accent on a single character (a↔á, n↔ñ). Returns the same char if not applicable. */
    toggleAccent(ch) {
      if (ACCENT_MAP[ch]) return ACCENT_MAP[ch];
      if (UNACCENT_MAP[ch]) return UNACCENT_MAP[ch];
      return ch;
    },
    /** Title-case first letter only. */
    cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); },
    /** Escape for innerHTML. */
    esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    /** Wrap accented chars in <span class="accent-char"> for display. */
    highlightAccents(s) {
      return String(s).normalize('NFC').split('').map((c) => (Text.isSpecial(c) ? '<span class="accent-char">' + Text.esc(c) + '</span>' : Text.esc(c))).join('');
    },
    /**
     * Check a typed answer against a list of accepted normalized answers.
     * Returns { status: 'correct' | 'accent' | 'wrong' | 'empty', input, expected }
     *   'accent' = letters right but accents/ñ wrong (teachable moment).
     */
    check(input, accepted, canonical) {
      const n = Text.normalize(input);
      const list = (accepted || []).map(Text.normalize);
      const expected = canonical || list[0] || '';
      if (!n) return { status: 'empty', input: n, expected };
      if (list.includes(n)) return { status: 'correct', input: n, expected: n };
      const ns = Text.stripAccents(n);
      const near = list.find((a) => Text.stripAccents(a) === ns);
      if (near) return { status: 'accent', input: n, expected: near };
      return { status: 'wrong', input: n, expected };
    },
    /**
     * Character-level diff (LCS) between what was typed and what was expected.
     * Returns HTML: kept chars as .d-ok, typed-extra chars as .d-bad, missing/expected chars as .d-fix
     * (or .d-accent when the fix is only an accent on the same base letter).
     */
    diffHtml(typed, expected) {
      const a = String(typed || '').normalize('NFC').split('');
      const b = String(expected || '').normalize('NFC').split('');
      const n = a.length, m = b.length;
      // LCS table
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      const ops = [];
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push(['ok', a[i]]); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['del', a[i]]); i++; }
        else { ops.push(['ins', b[j]]); j++; }
      }
      while (i < n) ops.push(['del', a[i++]]);
      while (j < m) ops.push(['ins', b[j++]]);
      // Merge del+ins of same base letter into an accent fix
      const html = [];
      for (let k = 0; k < ops.length; k++) {
        const [op, ch] = ops[k];
        const nxt = ops[k + 1];
        if (op === 'del' && nxt && nxt[0] === 'ins' && Text.stripAccents(ch) === Text.stripAccents(nxt[1])) {
          html.push('<span class="d-accent">' + Text.esc(nxt[1]) + '</span>');
          k++;
          continue;
        }
        if (op === 'ok') html.push('<span class="d-ok">' + Text.esc(ch) + '</span>');
        else if (op === 'del') html.push('<span class="d-bad">' + Text.esc(ch === ' ' ? '␣' : ch) + '</span>');
        else html.push('<span class="d-fix">' + Text.esc(ch === ' ' ? '␣' : ch) + '</span>');
      }
      return '<span class="diff">' + html.join('') + '</span>';
    },
    /**
     * Plausible wrong spellings of a word, for multiple-choice distractors.
     * Produces: accent removed, accent moved to another vowel, ñ↔n, and (if still short) vowel swaps.
     */
    accentVariants(word, max) {
      max = max || 6;
      const w = String(word).normalize('NFC');
      const set = new Set();
      const add = (v) => { if (v && v !== w && Text.normalize(v) !== Text.normalize(w)) set.add(v); };
      const chars = w.split('');
      const stripped = Text.stripAccents(w);
      add(stripped);
      const accentIdx = Text.accentPositions(w).filter((i) => 'áéíóú'.indexOf(chars[i]) >= 0);
      // Move accent to a different vowel (keep ñ)
      const base = chars.map((c) => ('áéíóú'.indexOf(c) >= 0 ? UNACCENT_MAP[c] : c));
      for (let i = 0; i < base.length; i++) {
        if ('aeiou'.indexOf(base[i]) < 0) continue;
        if (accentIdx.includes(i)) continue;
        const v = base.slice(); v[i] = ACCENT_MAP[v[i]];
        add(v.join(''));
      }
      // Double accents (keep original + add another)
      if (accentIdx.length) {
        for (let i = 0; i < chars.length; i++) {
          if ('aeiou'.indexOf(chars[i]) < 0) continue;
          const v = chars.slice(); v[i] = ACCENT_MAP[v[i]];
          add(v.join(''));
        }
      }
      // ñ ↔ n
      if (w.indexOf('ñ') >= 0) add(w.replace(/ñ/g, 'n'));
      else if (/n/.test(w) && set.size < max) {
        const idx = w.indexOf('n'); add(w.slice(0, idx) + 'ñ' + w.slice(idx + 1));
      }
      // Common letter confusions: c↔s, b↔v, y↔ll, missing h — only if still short on variants
      if (set.size < max) {
        const swaps = [['c', 's'], ['s', 'c'], ['b', 'v'], ['v', 'b'], ['z', 's'], ['qu', 'k'], ['ll', 'y']];
        for (const [from, to] of swaps) {
          const idx = w.indexOf(from);
          if (idx >= 0) add(w.slice(0, idx) + to + w.slice(idx + from.length));
          if (set.size >= max) break;
        }
      }
      return Array.from(set).slice(0, max);
    },
  };
  PQ.Text = Text;

  /* ------------------------------------------------------------
     Storage helpers
     ------------------------------------------------------------ */
  const Store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
  PQ.Store = Store;

  /* ------------------------------------------------------------
     Settings
     ------------------------------------------------------------ */
  const SETTINGS_KEY = 'pq.settings.v1';
  const DEFAULT_SETTINGS = { cats: null /* null = all */, sound: true, speech: true, strictArticles: false };
  const Settings = {
    _s: Object.assign({}, DEFAULT_SETTINGS, Store.get(SETTINGS_KEY, {})),
    get(k) { return Settings._s[k]; },
    set(k, v) { Settings._s[k] = v; Store.set(SETTINGS_KEY, Settings._s); window.dispatchEvent(new CustomEvent('pq:settings', { detail: { key: k, value: v } })); },
    all() { return Object.assign({}, Settings._s); },
  };
  PQ.Settings = Settings;

  /* ------------------------------------------------------------
     Vocab — access to the word list
     ------------------------------------------------------------ */
  const Vocab = {
    all() { return window.VOCAB.slice(); },
    categories() { return window.VOCAB_CATEGORIES.slice(); },
    category(id) { return window.VOCAB_CATEGORIES.find((c) => c.id === id) || null; },
    byId(id) { return window.VOCAB.find((e) => e.id === id) || null; },
    byCategory(cat) { return window.VOCAB.filter((e) => e.cat === cat); },
    /** Words enabled by the user's category filter (never empty: falls back to all). */
    active() {
      const cats = Settings.get('cats');
      if (!Array.isArray(cats) || !cats.length) return Vocab.all();
      const list = window.VOCAB.filter((e) => cats.includes(e.cat));
      return list.length ? list : Vocab.all();
    },
    /** Words that contain at least one accent / ñ (great for accent drills). */
    withAccents(list) { return (list || Vocab.active()).filter((e) => Text.hasAccent(e.base)); },
    meta() { return window.VOCAB_META; },
  };
  PQ.Vocab = Vocab;

  /* ------------------------------------------------------------
     Progress — per-word mastery (Leitner boxes) + XP, persisted
     ------------------------------------------------------------ */
  const PROGRESS_KEY = 'pq.progress.v1';
  const MAX_BOX = 5;
  const Progress = {
    _d: Store.get(PROGRESS_KEY, { words: {}, xp: 0, sessions: 0, games: {}, bestStreak: 0, totalAnswers: 0, totalCorrect: 0 }),
    _save() { Store.set(PROGRESS_KEY, Progress._d); window.dispatchEvent(new CustomEvent('pq:progress')); },
    _w(id) {
      const w = Progress._d.words[id] || (Progress._d.words[id] = { n: 0, ok: 0, acc: 0, wrong: 0, streak: 0, best: 0, box: 0, last: 0, due: 0, ease: 2.5, interval: 0 });
      return w;
    },
    word(id) { return Object.assign({ n: 0, ok: 0, acc: 0, wrong: 0, streak: 0, best: 0, box: 0, last: 0, due: 0, ease: 2.5, interval: 0 }, Progress._d.words[id] || {}); },
    box(id) { return Progress.word(id).box; },
    /** 0..1 mastery fraction for a word. */
    mastery(id) { return Progress.box(id) / MAX_BOX; },
    /**
     * Record an answer. status: 'correct' | 'accent' | 'wrong'.
     * Returns { xp, box, levelUp }.
     */
    record(id, status, opts) {
      opts = opts || {};
      const w = Progress._w(id);
      const now = Date.now();
      w.n++; w.last = now;
      Progress._d.totalAnswers++;
      let xp = 0;
      if (status === 'correct') {
        w.ok++; w.streak++; w.best = Math.max(w.best, w.streak);
        w.box = Math.min(MAX_BOX, w.box + 1);
        Progress._d.totalCorrect++;
        // SM-2 style scheduling
        w.interval = w.interval === 0 ? 1 : w.interval === 1 ? 3 : Math.round(w.interval * w.ease);
        w.ease = Math.min(3.0, w.ease + 0.08);
        xp = 10 + w.box * 2 + (opts.bonus || 0);
      } else if (status === 'accent') {
        w.acc++; w.streak = 0;
        w.box = Math.max(0, w.box - 1);
        w.interval = 1; w.ease = Math.max(1.3, w.ease - 0.15);
        xp = 2;
      } else {
        w.wrong++; w.streak = 0;
        w.box = Math.max(0, w.box - 1);
        w.interval = 0; w.ease = Math.max(1.3, w.ease - 0.25);
        xp = 0;
      }
      w.due = now + w.interval * 24 * 3600 * 1000;
      const before = Progress.level();
      Progress._d.xp += xp;
      const levelUp = Progress.level() > before;
      Progress._save();
      return { xp, box: w.box, levelUp, level: Progress.level() };
    },
    addXp(n) { const before = Progress.level(); Progress._d.xp += Math.max(0, n | 0); Progress._save(); return Progress.level() > before; },
    xp() { return Progress._d.xp; },
    /** Level curve: level n requires 100 * n * (n+1) / 2 xp cumulative. */
    level() { let lvl = 1; while (Progress._d.xp >= Progress.xpForLevel(lvl + 1)) lvl++; return lvl; },
    xpForLevel(lvl) { return 100 * (lvl - 1) * lvl / 2; },
    levelProgress() {
      const lvl = Progress.level();
      const cur = Progress.xpForLevel(lvl), next = Progress.xpForLevel(lvl + 1);
      return { level: lvl, xp: Progress._d.xp, cur, next, frac: Math.min(1, (Progress._d.xp - cur) / (next - cur)) };
    },
    /** Game high scores: Progress.best('platformer') / Progress.setBest('platformer', 1200, extra). */
    best(gameId) { return (Progress._d.games[gameId] || {}).best || 0; },
    gameStats(gameId) { return Object.assign({ best: 0, plays: 0 }, Progress._d.games[gameId] || {}); },
    setBest(gameId, score, extra) {
      const g = Progress._d.games[gameId] || (Progress._d.games[gameId] = { best: 0, plays: 0 });
      g.plays++;
      const isNew = score > g.best;
      if (isNew) g.best = score;
      if (extra) Object.assign(g, extra);
      Progress._save();
      return isNew;
    },
    noteStreak(n) { if (n > Progress._d.bestStreak) { Progress._d.bestStreak = n; Progress._save(); } },
    bestStreak() { return Progress._d.bestStreak; },
    totals() { return { answers: Progress._d.totalAnswers, correct: Progress._d.totalCorrect, xp: Progress._d.xp }; },
    /** Weighted pick weight: weak / unseen / overdue words come up more. */
    weight(entry) {
      const w = Progress.word(entry.id);
      let s = Math.pow(MAX_BOX + 1 - w.box, 2); // 36 (box0) .. 1 (box5)
      if (w.n === 0) s += 20;
      if (w.acc > w.ok) s += 10; // accent trouble
      if (w.due && w.due < Date.now()) s += 8;
      if (w.last && Date.now() - w.last < 60 * 1000) s *= 0.35; // just seen
      return Math.max(0.5, s);
    },
    /**
     * Pick `count` entries from `pool` (default Vocab.active()), weighted toward weak words,
     * avoiding ids in `exclude` where possible. Never returns duplicates.
     */
    pick(count, opts) {
      opts = opts || {};
      const pool = (opts.pool || Vocab.active()).slice();
      const exclude = new Set(opts.exclude || []);
      count = Math.max(0, Math.min(count || 1, pool.length));
      let candidates = pool.filter((e) => !exclude.has(e.id));
      if (candidates.length < count) candidates = pool;
      const out = [];
      const rng = opts.rng;
      while (out.length < count && candidates.length) {
        const weights = candidates.map((e) => (opts.uniform ? 1 : Progress.weight(e)));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = (rng ? rng() : Math.random()) * total;
        let idx = 0;
        for (; idx < candidates.length - 1; idx++) { r -= weights[idx]; if (r <= 0) break; }
        out.push(candidates[idx]);
        candidates.splice(idx, 1);
      }
      return out;
    },
    pickOne(opts) { return Progress.pick(1, opts)[0]; },
    /** Weakest n entries (lowest box, then most accent errors), only among seen words unless includeUnseen. */
    weakest(n, opts) {
      opts = opts || {};
      const list = (opts.pool || Vocab.all()).filter((e) => opts.includeUnseen || Progress.word(e.id).n > 0);
      return list
        .map((e) => ({ e, w: Progress.word(e.id) }))
        .sort((x, y) => (x.w.box - y.w.box) || ((y.w.acc + y.w.wrong) - (x.w.acc + x.w.wrong)) || (x.w.ok - y.w.ok))
        .slice(0, n || 5)
        .map((x) => x.e);
    },
    /** Entries due for review (SRS), soonest first. */
    due(pool) {
      const now = Date.now();
      return (pool || Vocab.active()).filter((e) => { const w = Progress.word(e.id); return w.n === 0 || w.due <= now; })
        .sort((a, b) => Progress.word(a.id).due - Progress.word(b.id).due);
    },
    summary(pool) {
      pool = pool || Vocab.all();
      const boxes = [0, 0, 0, 0, 0, 0];
      let seen = 0, mastered = 0, sum = 0;
      pool.forEach((e) => { const w = Progress.word(e.id); boxes[w.box]++; if (w.n) seen++; if (w.box >= MAX_BOX) mastered++; sum += w.box; });
      return { total: pool.length, seen, mastered, boxes, avg: pool.length ? sum / (pool.length * MAX_BOX) : 0 };
    },
    reset() { Progress._d = { words: {}, xp: 0, sessions: 0, games: {}, bestStreak: 0, totalAnswers: 0, totalCorrect: 0 }; Progress._save(); },
    MAX_BOX,
  };
  PQ.Progress = Progress;

  /* ------------------------------------------------------------
     Quiz — question generators
     Every question: { kind, entry, prompt, sub, canonical, accepted }
     ------------------------------------------------------------ */
  const Quiz = {
    /** Typed-answer question: show English, type Spanish. gender: 'm' | 'f' | undefined */
    typed(entry, opts) {
      opts = opts || {};
      let gender = opts.gender;
      if (entry.forms && gender === undefined && Rand.chance(0.5)) gender = Rand.pick(['m', 'f']);
      let accepted = entry.answers.slice();
      let canonical = entry.answers[0];
      let sub = '';
      if (entry.forms && gender) {
        canonical = entry.forms[gender];
        accepted = [canonical];
        if (gender === 'm' && entry.answers.includes('primer')) accepted.push('primer');
        if (gender === 'm' && entry.answers.includes('tercer')) accepted.push('tercer');
        sub = gender === 'm' ? 'masculine form' : 'feminine form';
      } else if (entry.forms) {
        sub = 'either form is fine';
      }
      if (entry.cat === 'question') sub = sub || 'question word';
      return { kind: 'typed', entry, prompt: entry.en, sub, canonical, accepted, hint: Quiz.hint(entry, canonical) };
    },
    /** Multiple-choice: show English, choose the correctly spelled Spanish among accent traps. */
    choice(entry, opts) {
      opts = opts || {};
      const n = opts.options || 4;
      const correct = entry.base;
      const variants = Rand.shuffle(Text.accentVariants(correct, 8));
      const distract = variants.slice(0, n - 1);
      if (distract.length < n - 1) {
        const pool = Rand.shuffle(Vocab.all().filter((e) => e.id !== entry.id && e.cat === entry.cat));
        for (const e of pool) { if (distract.length >= n - 1) break; if (!distract.includes(e.base)) distract.push(e.base); }
      }
      const options = Rand.shuffle([{ text: correct, correct: true }].concat(distract.map((t) => ({ text: t, correct: false }))));
      return { kind: 'choice', entry, prompt: entry.en, sub: 'pick the correct spelling', canonical: correct, accepted: [correct], options };
    },
    /** Reverse choice: show Spanish, choose the English meaning. */
    meaning(entry, opts) {
      opts = opts || {};
      const n = opts.options || 4;
      const pool = Rand.shuffle(Vocab.all().filter((e) => e.id !== entry.id && e.en !== entry.en));
      const same = pool.filter((e) => e.cat === entry.cat), other = pool.filter((e) => e.cat !== entry.cat);
      const distract = same.concat(other).slice(0, n - 1).map((e) => ({ text: e.en, correct: false }));
      const options = Rand.shuffle([{ text: entry.en, correct: true }].concat(distract));
      return { kind: 'meaning', entry, prompt: entry.es, sub: 'what does it mean?', canonical: entry.en, accepted: [entry.en], options };
    },
    /** Accent placement: show the word without accents; user clicks the letters that need one (or "no accent"). */
    accent(entry) {
      const word = entry.base.normalize('NFC');
      const shown = Text.stripAccents(word);
      const needs = Text.accentPositions(word);
      return { kind: 'accent', entry, prompt: shown, sub: entry.en, canonical: word, accepted: [word], shown, needs, letters: shown.split('') };
    },
    /** Random kind. kinds default ['typed','choice','accent'] (accent only if word has accents). */
    any(entry, kinds) {
      kinds = (kinds || ['typed', 'choice', 'accent']).filter((k) => k !== 'accent' || Text.hasAccent(entry.base));
      const k = Rand.pick(kinds) || 'typed';
      return Quiz[k](entry);
    },
    /** Short hint for a word: first letter + accent note. */
    hint(entry, canonical) {
      const w = (canonical || entry.base).normalize('NFC');
      const acc = Text.accentPositions(w).map((i) => w[i]);
      const first = w.charAt(0);
      const parts = ['Starts with "' + first + '"', w.replace(/\s/g, '').length + ' letters'];
      if (acc.length) parts.push('has ' + acc.join(' '));
      else parts.push('no accents');
      return parts.join(' · ');
    },
    /** Grade any question. For typed: input string. For choice/meaning: option object. For accent: array of selected indexes. */
    grade(q, answer) {
      if (q.kind === 'typed') return Text.check(answer, q.accepted, q.canonical);
      if (q.kind === 'choice' || q.kind === 'meaning') {
        const opt = answer;
        if (!opt) return { status: 'empty', expected: q.canonical };
        if (opt.correct) return { status: 'correct', input: opt.text, expected: q.canonical };
        if (q.kind === 'choice' && Text.stripAccents(opt.text) === Text.stripAccents(q.canonical)) return { status: 'accent', input: opt.text, expected: q.canonical };
        return { status: 'wrong', input: opt.text, expected: q.canonical };
      }
      if (q.kind === 'accent') {
        const sel = (answer || []).slice().sort((a, b) => a - b);
        const need = q.needs.slice().sort((a, b) => a - b);
        const same = sel.length === need.length && sel.every((v, i) => v === need[i]);
        return { status: same ? 'correct' : 'accent', input: sel, expected: q.canonical };
      }
      return { status: 'wrong', expected: q.canonical };
    },
  };
  PQ.Quiz = Quiz;

  /* ------------------------------------------------------------
     UI — element builder, toasts, modal, accent bar, confetti
     ------------------------------------------------------------ */
  const UI = {
    /** h('div.card', {onclick}, 'text', child, ...) */
    h(tag, props) {
      const children = Array.prototype.slice.call(arguments, 2);
      const parts = tag.split('.');
      const el = document.createElement(parts[0] || 'div');
      if (parts.length > 1) el.className = parts.slice(1).join(' ');
      if (props) {
        for (const k in props) {
          const v = props[k];
          if (v == null) continue;
          if (k === 'class' || k === 'className') el.className += (el.className ? ' ' : '') + v;
          else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
          else if (k === 'html') el.innerHTML = v;
          else if (k === 'dataset') Object.assign(el.dataset, v);
          else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
          else if (k in el && k !== 'list' && k !== 'form') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
          else el.setAttribute(k, v);
        }
      }
      const append = (c) => {
        if (c == null || c === false) return;
        if (Array.isArray(c)) c.forEach(append);
        else if (c instanceof Node) el.appendChild(c);
        else el.appendChild(document.createTextNode(String(c)));
      };
      children.forEach(append);
      return el;
    },
    clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; },
    toast(msg, kind, ms) {
      let stack = document.querySelector('.toast-stack');
      if (!stack) { stack = UI.h('div.toast-stack'); document.body.appendChild(stack); }
      const t = UI.h('div.toast' + (kind ? '.' + kind : ''), { role: 'status' }, msg);
      stack.appendChild(t);
      while (stack.children.length > 3) stack.removeChild(stack.firstChild);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms || 2200);
      return t;
    },
    /** modal({title, content: Node|string, closable: true, onClose, large}) → { el, close } */
    modal(opts) {
      opts = opts || {};
      const content = typeof opts.content === 'string' ? UI.h('div', { html: opts.content }) : opts.content;
      const box = UI.h('div.modal' + (opts.large ? '.modal-lg' : ''), { role: 'dialog', 'aria-modal': 'true' });
      const backdrop = UI.h('div.modal-backdrop', null, box);
      let closed = false;
      const close = () => {
        if (closed) return; closed = true;
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        if (opts.onClose) opts.onClose();
      };
      const onKey = (e) => { if (e.key === 'Escape' && opts.closable !== false) { e.preventDefault(); close(); } };
      if (opts.title || opts.closable !== false) {
        box.appendChild(UI.h('div.modal-head', null,
          UI.h('h3', null, opts.title || ''),
          opts.closable !== false ? UI.h('button.modal-close', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕') : null));
      }
      if (content) box.appendChild(content);
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && opts.closable !== false) close(); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(backdrop);
      return { el: box, backdrop, close };
    },
    /** Insert text at the caret of an input (keeps focus). */
    insertAtCaret(input, text) {
      const start = input.selectionStart == null ? input.value.length : input.selectionStart;
      const end = input.selectionEnd == null ? start : input.selectionEnd;
      const v = input.value;
      input.value = v.slice(0, start) + text + v.slice(end);
      const pos = start + text.length;
      try { input.setSelectionRange(pos, pos); } catch (e) { /* not supported for this type */ }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    },
    /**
     * Attach Spanish typing helpers to an <input>:
     *  - an on-screen accent bar (á é í ó ú ñ ü ¿ ¡)
     *  - backtick ( ` ) toggles the accent on the character before the caret (a→á, n→ñ)
     * Returns the bar element (already inserted after the input unless opts.mount is given).
     */
    accentBar(input, opts) {
      opts = opts || {};
      const keys = opts.keys || ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'];
      const bar = UI.h('div.accent-bar', { role: 'toolbar', 'aria-label': 'Spanish characters' });
      keys.forEach((k) => {
        const b = UI.h('button.accent-key', { type: 'button', tabindex: '-1', 'aria-label': 'insert ' + k }, k);
        b.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focus
        b.addEventListener('click', () => UI.insertAtCaret(input, k));
        bar.appendChild(b);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === '`' || e.key === '´' || e.key === 'Dead') {
          const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
          if (pos > 0 && input.selectionStart === input.selectionEnd) {
            const ch = input.value[pos - 1];
            const t = Text.toggleAccent(ch);
            if (t !== ch) {
              e.preventDefault();
              input.value = input.value.slice(0, pos - 1) + t + input.value.slice(pos);
              try { input.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return;
            }
          }
          if (e.key === '`') e.preventDefault(); // never type a stray backtick
        }
      });
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('lang', 'es');
      const hint = opts.hint === false ? null : UI.h('div.accent-hint', { html: 'Tip: type a vowel or <b>n</b> then press <span class="kbd">`</span> to add its accent' });
      if (opts.mount) { opts.mount.appendChild(bar); if (hint) opts.mount.appendChild(hint); }
      else { input.insertAdjacentElement('afterend', bar); if (hint) bar.insertAdjacentElement('afterend', hint); }
      return bar;
    },
    /** Celebration particles. */
    confetti(opts) {
      opts = opts || {};
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const canvas = UI.h('canvas.confetti-canvas');
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
      ctx.scale(dpr, dpr);
      const colors = ['#f6c453', '#f28d35', '#38d9c4', '#a78bfa', '#ff5c7a', '#a3e635', '#60a5fa'];
      const n = opts.count || 120;
      const ox = opts.x == null ? window.innerWidth / 2 : opts.x, oy = opts.y == null ? window.innerHeight * 0.4 : opts.y;
      const ps = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 9;
        return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, r: 3 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, life: 1 };
      });
      let t0 = performance.now();
      const step = (t) => {
        const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = 0;
        ps.forEach((p) => {
          if (p.life <= 0) return; alive++;
          p.vy += 18 * dt; p.vx *= 0.99; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.rot += p.vr; p.life -= dt * 0.6;
          ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore();
        });
        if (alive) requestAnimationFrame(step); else canvas.remove();
      };
      requestAnimationFrame(step);
    },
    /** Mastery dots element for a word id. */
    masteryDots(id) {
      const box = Progress.box(id);
      const el = UI.h('span.mastery' + (box >= MAX_BOX ? '.m-max' : ''), { title: 'Mastery ' + box + '/' + MAX_BOX, 'aria-label': 'Mastery ' + box + ' of ' + MAX_BOX });
      for (let i = 0; i < MAX_BOX; i++) el.appendChild(UI.h('i' + (i < box ? '.on' : '')));
      return el;
    },
    /** Progress ring element. frac 0..1, label text. */
    ring(frac, label, size) {
      size = size || 120;
      const r = 50, c = 2 * Math.PI * r;
      const el = UI.h('div.ring', { style: { width: size + 'px', height: size + 'px' } });
      el.innerHTML = '<svg viewBox="0 0 120 120"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6c453"/><stop offset="1" stop-color="#38d9c4"/></linearGradient></defs>' +
        '<circle class="ring-bg" cx="60" cy="60" r="' + r + '"/><circle class="ring-fg" cx="60" cy="60" r="' + r + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + (c * (1 - Math.max(0, Math.min(1, frac)))) + '"/></svg>' +
        '<div class="ring-label">' + Text.esc(label == null ? Math.round(frac * 100) + '%' : label) + '</div>';
      return el;
    },
    fmtTime(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); },
  };
  PQ.UI = UI;

  /* ------------------------------------------------------------
     Sound — tiny WebAudio synth (no assets needed)
     ------------------------------------------------------------ */
  const Sound = {
    _ctx: null,
    _unlocked: false,
    ctx() {
      if (!Sound._ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { Sound._ctx = new AC(); } catch (e) { return null; }
      }
      if (Sound._ctx.state === 'suspended') Sound._ctx.resume().catch(() => {});
      return Sound._ctx;
    },
    enabled() { return Settings.get('sound') !== false; },
    toggle() { Settings.set('sound', !Sound.enabled()); return Sound.enabled(); },
    _tone(freq, dur, type, vol, when, slide) {
      const ctx = Sound.ctx(); if (!ctx) return;
      const t = ctx.currentTime + (when || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    play(name) {
      if (!Sound.enabled()) return;
      try {
        switch (name) {
          case 'correct': Sound._tone(660, 0.12, 'triangle', 0.14); Sound._tone(880, 0.16, 'triangle', 0.14, 0.09); Sound._tone(1320, 0.22, 'triangle', 0.12, 0.18); break;
          case 'wrong': Sound._tone(220, 0.22, 'sawtooth', 0.08, 0, 140); Sound._tone(170, 0.28, 'square', 0.05, 0.08, 90); break;
          case 'accent': Sound._tone(520, 0.1, 'triangle', 0.1); Sound._tone(440, 0.18, 'triangle', 0.1, 0.1); break;
          case 'jump': Sound._tone(300, 0.14, 'square', 0.05, 0, 620); break;
          case 'coin': Sound._tone(1200, 0.08, 'square', 0.06); Sound._tone(1600, 0.14, 'square', 0.06, 0.07); break;
          case 'energy': Sound._tone(400, 0.1, 'sine', 0.1, 0, 800); Sound._tone(800, 0.2, 'sine', 0.1, 0.1, 1200); break;
          case 'gate': Sound._tone(500, 0.1, 'triangle', 0.1); Sound._tone(750, 0.1, 'triangle', 0.1, 0.1); Sound._tone(1000, 0.2, 'triangle', 0.1, 0.2); break;
          case 'hurt': Sound._tone(180, 0.2, 'sawtooth', 0.1, 0, 60); break;
          case 'win': [523, 659, 784, 1047].forEach((f, i) => Sound._tone(f, 0.25, 'triangle', 0.12, i * 0.12)); Sound._tone(1319, 0.5, 'triangle', 0.12, 0.5); break;
          case 'lose': [400, 350, 300, 200].forEach((f, i) => Sound._tone(f, 0.25, 'sawtooth', 0.07, i * 0.15)); break;
          case 'tick': Sound._tone(900, 0.04, 'square', 0.04); break;
          case 'click': Sound._tone(700, 0.05, 'triangle', 0.05); break;
          case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => Sound._tone(f, 0.18, 'sine', 0.12, i * 0.08)); break;
          case 'shoot': Sound._tone(900, 0.08, 'square', 0.05, 0, 300); break;
          case 'explode': Sound._tone(120, 0.3, 'sawtooth', 0.1, 0, 40); break;
          default: Sound._tone(600, 0.08, 'sine', 0.06);
        }
      } catch (e) { /* audio not available */ }
    },
  };
  PQ.Sound = Sound;
  // Unlock audio on first user gesture (browser autoplay policy)
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, function unlock() { Sound._unlocked = true; if (Sound.enabled()) Sound.ctx(); }, { once: true, passive: true }));

  /* ------------------------------------------------------------
     Speech — pronounce Spanish with the Web Speech API
     ------------------------------------------------------------ */
  const Speech = {
    _voice: undefined,
    available() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; },
    enabled() { return Speech.available() && Settings.get('speech') !== false; },
    voice() {
      if (!Speech.available()) return null;
      const voices = window.speechSynthesis.getVoices() || [];
      const es = voices.filter((v) => /^es([-_]|$)/i.test(v.lang));
      const pref = es.find((v) => /es[-_]ES/i.test(v.lang)) || es.find((v) => /es[-_]MX|es[-_]US/i.test(v.lang)) || es[0];
      return pref || null;
    },
    say(text) {
      if (!Speech.enabled()) return false;
      try {
        const u = new SpeechSynthesisUtterance(String(text).replace(/…/g, ''));
        u.lang = 'es-ES'; u.rate = 0.9;
        const v = Speech.voice(); if (v) u.voice = v;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        return true;
      } catch (e) { return false; }
    },
  };
  PQ.Speech = Speech;
  if (Speech.available() && window.speechSynthesis.addEventListener) {
    try { window.speechSynthesis.addEventListener('voiceschanged', () => { Speech._voice = undefined; }); } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------
     QuizUI — the shared question widget
     QuizUI.ask(question, { mount, onResult, autoContinue, showContinue, allowHint, focus })
       → controller { el, destroy, submit }
     onResult(result) fires AFTER feedback is shown and the learner continues
       result = { status, xp, box, question, elapsed, usedHint }
     ------------------------------------------------------------ */
  const QuizUI = {
    ask(q, opts) {
      opts = opts || {};
      const root = UI.h('div.quiz', { 'data-kind': q.kind });
      let answered = false, usedHint = false, destroyed = false;
      const t0 = performance.now();
      const kindLabel = { typed: 'Spell it in Spanish', choice: 'Pick the correct spelling', meaning: 'What does it mean?', accent: 'Place the accents' }[q.kind] || 'Question';
      root.appendChild(UI.h('div.quiz-kind', null, kindLabel));
      const promptEl = UI.h('div.quiz-prompt', null,
        q.kind === 'accent' ? UI.h('span', { html: Text.esc(q.shown) }) : q.prompt,
        q.sub ? UI.h('span.sub', null, q.sub) : null);
      root.appendChild(promptEl);
      const body = UI.h('div.quiz-body');
      root.appendChild(body);
      const actions = UI.h('div.quiz-actions');
      root.appendChild(actions);
      const feedbackSlot = UI.h('div.quiz-feedback-slot');
      root.appendChild(feedbackSlot);

      let selected = []; // accent kind
      let input = null;

      const finish = (status, extra) => {
        if (answered || destroyed) return;
        answered = true;
        const rec = Progress.record(q.entry.id, status, { bonus: opts.bonus });
        const elapsed = (performance.now() - t0) / 1000;
        const result = Object.assign({ status, xp: rec.xp, box: rec.box, levelUp: rec.levelUp, question: q, elapsed, usedHint }, extra || {});
        Sound.play(status === 'correct' ? 'correct' : status === 'accent' ? 'accent' : 'wrong');
        if (rec.levelUp) setTimeout(() => { Sound.play('levelup'); UI.toast('Level up! You are now level ' + rec.level, 'ok'); }, 350);
        showFeedback(result);
        if (opts.onAnswer) opts.onAnswer(result);
        const cont = () => { if (!destroyed && opts.onResult) opts.onResult(result); };
        if (opts.autoContinue) setTimeout(cont, typeof opts.autoContinue === 'number' ? opts.autoContinue : (status === 'correct' ? 900 : 2200));
        else {
          const btn = UI.h('button.btn.btn-primary', { type: 'button', onclick: cont }, status === 'correct' ? 'Continue →' : 'Got it →');
          actions.appendChild(btn);
          setTimeout(() => { try { btn.focus(); } catch (e) { /* ignore */ } }, 30);
          const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.removeEventListener('keydown', onKey); cont(); } };
          document.addEventListener('keydown', onKey);
          root._cleanup.push(() => document.removeEventListener('keydown', onKey));
        }
      };
      root._cleanup = [];

      const showFeedback = (r) => {
        UI.clear(feedbackSlot);
        const canon = q.kind === 'meaning' ? q.canonical : q.canonical;
        let fb;
        if (r.status === 'correct') {
          fb = UI.h('div.quiz-feedback.ok', null,
            UI.h('div.fb-title', null, Rand.pick(['¡Perfecto!', '¡Excelente!', '¡Muy bien!', '¡Genial!', '¡Correcto!']) + '  +' + r.xp + ' XP'),
            UI.h('div.fb-answer', { html: Text.highlightAccents(q.kind === 'meaning' ? q.entry.es : canon) }),
            q.kind !== 'meaning' ? UI.h('div.fb-note', null, q.entry.en + (q.entry.note ? ' · ' + q.entry.note : '')) : UI.h('div.fb-note', null, q.entry.en));
        } else if (r.status === 'accent') {
          const typed = q.kind === 'accent' ? null : (r.input || '');
          fb = UI.h('div.quiz-feedback.accent', null,
            UI.h('div.fb-title', null, 'So close — check the accents!'),
            typed != null ? UI.h('div', { html: Text.diffHtml(typed, r.expected || canon) }) : UI.h('div.fb-answer', { html: Text.highlightAccents(canon) }),
            UI.h('div.fb-note', { html: 'Correct spelling: <b>' + Text.highlightAccents(r.expected || canon) + '</b>' + (q.entry.note ? ' · ' + Text.esc(q.entry.note) : '') }));
        } else {
          const typed = (q.kind === 'typed') ? (r.input || '') : null;
          fb = UI.h('div.quiz-feedback.bad', null,
            UI.h('div.fb-title', null, 'Not quite.'),
            typed ? UI.h('div', { html: Text.diffHtml(typed, r.expected || canon) }) : null,
            UI.h('div.fb-answer', { html: Text.highlightAccents(q.kind === 'meaning' ? q.entry.es + '  =  ' + q.entry.en : canon) }),
            UI.h('div.fb-note', null, (q.kind === 'meaning' ? '' : q.entry.en) + (q.entry.note ? ' · ' + q.entry.note : '')));
        }
        if (Speech.enabled() && q.kind !== 'meaning') {
          const sp = UI.h('button.btn.btn-ghost.btn-sm', { type: 'button', title: 'Hear it', onclick: () => Speech.say(q.entry.base) }, '🔊 Hear it');
          fb.appendChild(UI.h('div', { style: { marginTop: '8px' } }, sp));
        }
        feedbackSlot.appendChild(fb);
      };

      // ---- Build body by kind ----
      if (q.kind === 'typed') {
        input = UI.h('input.input.input-lg', { type: 'text', placeholder: 'Type in Spanish…', 'aria-label': 'Your answer', enterkeyhint: 'done' });
        const wrap = UI.h('div');
        wrap.appendChild(input);
        body.appendChild(wrap);
        UI.accentBar(input, { mount: wrap });
        const submit = () => {
          if (answered) return;
          const r = Text.check(input.value, q.accepted, q.canonical);
          if (r.status === 'empty') { input.classList.add('is-wrong'); setTimeout(() => input.classList.remove('is-wrong'), 500); return; }
          input.classList.add(r.status === 'correct' ? 'is-correct' : r.status === 'accent' ? 'is-accent' : 'is-wrong');
          input.disabled = true;
          finish(r.status, { input: r.input, expected: r.expected });
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        const submitBtn = UI.h('button.btn.btn-primary', { type: 'button', onclick: submit }, 'Check');
        actions.appendChild(submitBtn);
        if (opts.allowHint !== false) {
          const hintBtn = UI.h('button.btn.btn-ghost', { type: 'button', onclick: () => {
            if (answered) return; usedHint = true; hintBtn.disabled = true;
            body.appendChild(UI.h('div.small.muted.anim-pop', { style: { marginTop: '8px', textAlign: 'center' } }, '💡 ' + q.hint));
          } }, 'Hint');
          actions.appendChild(hintBtn);
        }
        if (opts.allowSkip) actions.appendChild(UI.h('button.btn.btn-ghost', { type: 'button', onclick: () => { if (!answered) { input.disabled = true; finish('wrong', { input: '', expected: q.canonical, skipped: true }); } } }, "Don't know"));
        root._submit = submit;
        if (opts.focus !== false) setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
      } else if (q.kind === 'choice' || q.kind === 'meaning') {
        const grid = UI.h('div.quiz-options', { role: 'group' });
        const btns = q.options.map((opt, i) => {
          const b = UI.h('button.quiz-option', { type: 'button', dataset: { idx: String(i) } }, UI.h('span.key', null, String(i + 1)), UI.h('span', { html: q.kind === 'choice' ? Text.esc(opt.text) : Text.esc(opt.text) }));
          b.addEventListener('click', () => choose(i));
          grid.appendChild(b);
          return b;
        });
        const choose = (i) => {
          if (answered) return;
          const opt = q.options[i];
          const r = Quiz.grade(q, opt);
          btns.forEach((b, k) => { b.disabled = true; if (q.options[k].correct) b.classList.add('is-correct'); });
          if (!opt.correct) btns[i].classList.add('is-wrong');
          finish(r.status, { input: opt.text, expected: q.canonical });
        };
        body.appendChild(grid);
        const onKey = (e) => {
          if (answered) return;
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= q.options.length && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); choose(n - 1); }
        };
        document.addEventListener('keydown', onKey);
        root._cleanup.push(() => document.removeEventListener('keydown', onKey));
        if (opts.allowSkip) actions.appendChild(UI.h('button.btn.btn-ghost', { type: 'button', onclick: () => { if (!answered) { btns.forEach((b, k) => { b.disabled = true; if (q.options[k].correct) b.classList.add('is-correct'); }); finish('wrong', { input: '', expected: q.canonical, skipped: true }); } } }, "Don't know"));
      } else if (q.kind === 'accent') {
        body.appendChild(UI.h('div.small.text-2.center', null, 'Tap every letter that needs an accent or tilde (ñ). Then confirm.'));
        const row = UI.h('div.quiz-letters', { role: 'group', 'aria-label': 'letters' });
        const tiles = q.letters.map((ch, i) => {
          if (ch === ' ') { const sp = UI.h('span.quiz-letter.is-space'); row.appendChild(sp); return sp; }
          const canAccent = 'aeioun'.indexOf(ch.toLowerCase()) >= 0;
          const t = UI.h('button.quiz-letter', { type: 'button', dataset: { idx: String(i) }, 'aria-pressed': 'false', title: canAccent ? 'Toggle accent' : 'This letter cannot take an accent' }, ch);
          t.addEventListener('click', () => {
            if (answered) return;
            if (!canAccent) { t.classList.add('anim-shake'); setTimeout(() => t.classList.remove('anim-shake'), 500); Sound.play('tick'); return; }
            const k = selected.indexOf(i);
            if (k >= 0) { selected.splice(k, 1); t.textContent = ch; t.setAttribute('aria-pressed', 'false'); t.classList.remove('is-on'); }
            else { selected.push(i); t.textContent = Text.toggleAccent(ch); t.setAttribute('aria-pressed', 'true'); t.classList.add('is-on'); }
            Sound.play('click');
          });
          row.appendChild(t);
          return t;
        });
        body.appendChild(row);
        const confirm = () => {
          if (answered) return;
          const r = Quiz.grade(q, selected);
          tiles.forEach((t, i) => {
            if (!(t instanceof HTMLButtonElement)) return;
            t.disabled = true;
            const need = q.needs.includes(i), sel = selected.includes(i);
            if (need && sel) t.classList.add('is-correct');
            else if (need && !sel) { t.classList.add('is-missed'); t.textContent = q.canonical[i]; }
            else if (!need && sel) t.classList.add('is-wrong');
          });
          finish(r.status, { input: selected.slice(), expected: q.canonical });
        };
        actions.appendChild(UI.h('button.btn.btn-primary', { type: 'button', onclick: confirm }, 'Confirm'));
        actions.appendChild(UI.h('button.btn.btn-outline', { type: 'button', onclick: () => { if (answered) return; selected = []; tiles.forEach((t, i) => { if (t instanceof HTMLButtonElement) { t.textContent = q.letters[i]; t.setAttribute('aria-pressed', 'false'); t.classList.remove('is-on'); } }); confirm(); } }, 'No accents needed'));
        const onKey = (e) => { if (!answered && e.key === 'Enter') { e.preventDefault(); confirm(); } };
        document.addEventListener('keydown', onKey);
        root._cleanup.push(() => document.removeEventListener('keydown', onKey));
        root._submit = confirm;
      }

      if (opts.mount) { UI.clear(opts.mount).appendChild(root); }

      return {
        el: root,
        question: q,
        get answered() { return answered; },
        submit() { if (root._submit) root._submit(); },
        destroy() { destroyed = true; root._cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); root._cleanup = []; root.remove(); },
      };
    },
  };
  PQ.QuizUI = QuizUI;

  /* ------------------------------------------------------------
     Games registry + Router
     ------------------------------------------------------------ */
  const Games = {
    _list: [],
    register(def) {
      if (!def || !def.id || typeof def.mount !== 'function') throw new Error('Games.register: id and mount() are required');
      const i = Games._list.findIndex((g) => g.id === def.id);
      if (i >= 0) Games._list[i] = def; else Games._list.push(def);
      Games._list.sort((a, b) => (a.order || 99) - (b.order || 99));
      return def;
    },
    all() { return Games._list.slice(); },
    get(id) { return Games._list.find((g) => g.id === id) || null; },
  };
  PQ.Games = Games;

  const Pages = { _list: {}, register(id, fn) { Pages._list[id] = fn; }, get(id) { return Pages._list[id]; } };
  PQ.Pages = Pages;

  const Router = {
    _current: null, // { game, root }
    _root: null,
    parse() {
      const h = (location.hash || '#/').replace(/^#/, '');
      const parts = h.split('/').filter(Boolean);
      return { path: '/' + parts.join('/'), parts, page: parts[0] || 'home', param: parts[1] || '' };
    },
    go(path) { location.hash = '#' + (path.charAt(0) === '/' ? path : '/' + path); },
    ctx() { return { Vocab, Text, Progress, Settings, Quiz, QuizUI, UI, Sound, Speech, Rand, navigate: Router.go, vocab: Vocab, quiz: Quiz, progress: Progress, ui: UI, sound: Sound }; },
    _unmountCurrent() {
      const cur = Router._current;
      Router._current = null;
      if (cur && cur.game && typeof cur.game.unmount === 'function') { try { cur.game.unmount(); } catch (e) { console.error('unmount failed', e); } }
      document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
      document.body.classList.remove('in-game');
    },
    render() {
      const r = Router.parse();
      Router._unmountCurrent();
      const root = Router._root;
      UI.clear(root);
      window.scrollTo(0, 0);
      document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + (r.page === 'home' ? '' : r.page)));
      if (r.page === 'play' && r.param) {
        const game = Games.get(r.param);
        if (!game) { root.appendChild(UI.h('div.page.container', null, UI.h('h2', null, 'Game not found'), UI.h('a.btn', { href: '#/' }, '← Back home'))); return; }
        document.body.classList.add('in-game');
        document.title = game.name + ' · Palabra Quest';
        const page = UI.h('div.page.container.game-page');
        const mountEl = UI.h('div.game-mount');
        page.appendChild(mountEl);
        root.appendChild(page);
        Router._current = { game, root: mountEl };
        try { game.mount(mountEl, Router.ctx()); }
        catch (e) { console.error('Game mount failed', e); mountEl.appendChild(UI.h('div.card', null, UI.h('h3', null, 'This game hit an error'), UI.h('p.muted', null, String(e && e.message || e)), UI.h('a.btn', { href: '#/' }, '← Back home'))); }
        return;
      }
      const pageFn = Pages.get(r.page) || Pages.get('home');
      document.title = (r.page === 'home' ? 'Palabra Quest' : Text.cap(r.page) + ' · Palabra Quest');
      try { pageFn(root, Router.ctx(), r); }
      catch (e) { console.error('Page render failed', e); root.appendChild(UI.h('div.page.container', null, UI.h('h2', null, 'Something went wrong'), UI.h('p.muted', null, String(e && e.message || e)))); }
    },
    start(rootEl) {
      Router._root = rootEl;
      window.addEventListener('hashchange', Router.render);
      Router.render();
    },
  };
  PQ.Router = Router;

  /* ------------------------------------------------------------
     Home page (built-in)
     ------------------------------------------------------------ */
  Pages.register('home', function (root) {
    const page = UI.h('div.page.container');
    const summary = Progress.summary();
    const lp = Progress.levelProgress();
    const weakest = Progress.weakest(5);

    // Hero
    const hero = UI.h('section.hero', null,
      UI.h('div.hero-text', null,
        UI.h('div.eyebrow', null, Vocab.meta().list),
        UI.h('h1', null, 'Master every ', UI.h('span.grad-text', null, 'accent'), ' in Unidad 1.'),
        UI.h('p.text-2', null, 'Spelling and accent drills disguised as games. Weak words come back more often until they stick.'),
        UI.h('div.row', { style: { marginTop: '18px' } },
          UI.h('a.btn.btn-primary.btn-lg', { href: '#/play/' + (Games.all()[0] ? Games.all()[0].id : 'spell') }, '▶ Start playing'),
          UI.h('a.btn.btn-outline.btn-lg', { href: '#/words' }, 'Browse the ' + Vocab.all().length + ' words'))),
      UI.h('div.hero-stats.card.card-glass', null,
        UI.h('div.row-between', null,
          UI.ring(summary.avg, Math.round(summary.avg * 100) + '%', 110),
          UI.h('div.stack', { style: { gap: '6px', flex: '1', minWidth: '140px' } },
            UI.h('div.small.muted', null, 'Overall mastery'),
            UI.h('div', null, UI.h('b', null, summary.mastered), ' / ' + summary.total + ' words mastered'),
            UI.h('div.small.text-2', null, summary.seen + ' words practiced'),
            UI.h('div.small.text-2', null, 'Best streak: ' + Progress.bestStreak()))),
        UI.h('div', { style: { marginTop: '14px' } },
          UI.h('div.row-between.small', null, UI.h('span', null, 'Level ' + lp.level), UI.h('span.muted', null, (lp.xp - lp.cur) + ' / ' + (lp.next - lp.cur) + ' XP')),
          UI.h('div.bar', { style: { marginTop: '6px' } }, UI.h('div.bar-fill', { style: { width: Math.round(lp.frac * 100) + '%' } })))));
    page.appendChild(hero);

    // Games grid
    page.appendChild(UI.h('div.page-head', { style: { marginTop: '40px' } }, UI.h('div', null, UI.h('div.eyebrow', null, 'Play'), UI.h('h2', null, 'Choose your game'))));
    const grid = UI.h('div.grid.grid-3');
    const games = Games.all();
    if (!games.length) grid.appendChild(UI.h('div.card', null, 'No games loaded yet.'));
    games.forEach((g) => {
      const best = Progress.best(g.id);
      grid.appendChild(UI.h('a.card.card-hover.game-card', { href: '#/play/' + g.id, style: { '--accent': g.accent || 'var(--c-amber)' } },
        UI.h('div.icon', null, g.icon || '🎮'),
        UI.h('div', null, UI.h('div.game-name', null, g.name), UI.h('div.game-tag', null, g.tagline || '')),
        UI.h('div.game-cta', null, UI.h('span', null, best ? 'Best: ' + best : 'Play now'), UI.h('span.arrow', null, '→'))));
    });
    page.appendChild(grid);

    // Weak words + category filter
    const lower = UI.h('div.grid.grid-2', { style: { marginTop: '32px' } });
    const weakCard = UI.h('div.card', null, UI.h('div.eyebrow', null, 'Needs work'), UI.h('h3', null, 'Your trickiest words'));
    if (!weakest.length) weakCard.appendChild(UI.h('p.muted', null, 'Play a round and your weakest words will show up here.'));
    else weakest.forEach((e) => weakCard.appendChild(UI.h('div.word-row', { style: { marginBottom: '8px' } }, UI.h('span.es', { html: Text.highlightAccents(e.es) }), UI.h('span.en', null, e.en), UI.masteryDots(e.id))));
    lower.appendChild(weakCard);

    const catCard = UI.h('div.card', null, UI.h('div.eyebrow', null, 'Focus'), UI.h('h3', null, 'Which word groups to practice'), UI.h('p.small.muted', null, 'Applies to every game. Deselect all to practice everything.'));
    const chips = UI.h('div.chip-group');
    const cur = Settings.get('cats') || [];
    Vocab.categories().forEach((c) => {
      const on = cur.includes(c.id);
      const chip = UI.h('button.chip', { type: 'button', 'aria-pressed': on ? 'true' : 'false' }, c.icon + ' ' + c.en + ' (' + Vocab.byCategory(c.id).length + ')');
      chip.addEventListener('click', () => {
        const list = (Settings.get('cats') || []).slice();
        const i = list.indexOf(c.id);
        if (i >= 0) list.splice(i, 1); else list.push(c.id);
        Settings.set('cats', list.length ? list : null);
        chip.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
        Sound.play('click');
      });
      chips.appendChild(chip);
    });
    catCard.appendChild(chips);
    lower.appendChild(catCard);
    page.appendChild(lower);
    root.appendChild(page);
  });

  /* ------------------------------------------------------------
     App boot
     ------------------------------------------------------------ */
  const App = {
    start() {
      const root = document.getElementById('app');
      // Header XP pill + sound toggle
      const refreshXp = () => {
        const pill = document.getElementById('xpPill'); if (!pill) return;
        const lp = Progress.levelProgress();
        pill.innerHTML = '<span class="lvl">' + lp.level + '</span><span>' + lp.xp + ' XP</span>';
        pill.title = 'Level ' + lp.level + ' · ' + Math.round(lp.frac * 100) + '% to next level';
      };
      window.addEventListener('pq:progress', refreshXp);
      refreshXp();
      const sb = document.getElementById('soundBtn');
      if (sb) {
        const paint = () => { sb.textContent = Sound.enabled() ? '🔊' : '🔇'; sb.setAttribute('aria-pressed', Sound.enabled() ? 'true' : 'false'); sb.title = Sound.enabled() ? 'Mute sounds' : 'Unmute sounds'; };
        sb.addEventListener('click', () => { Sound.toggle(); paint(); if (Sound.enabled()) Sound.play('click'); });
        paint();
      }
      Router.start(root);
    },
  };
  PQ.App = App;
})();
