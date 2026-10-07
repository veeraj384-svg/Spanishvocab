/* ============================================================
   PALABRA QUEST — Pages: Words (#/words) and Progress (#/stats)

   Registers both pages with PQ.Pages as { mount, unmount }. The router
   calls unmount() before rendering the next route; this module keeps a
   single "live" record for whichever page it mounted and tears it down
   there (and, defensively, on `hashchange` and whenever one of our
   pages is mounted again).
   Every listener / timer / RAF / modal a page creates is pushed onto
   live.cleanups so mount → unmount → mount leaves nothing behind.
   ============================================================ */
(function () {
  'use strict';

  const PQ = window.PQ;
  const { Vocab, Text, Progress, Settings, Quiz, QuizUI, UI, Sound, Speech, Games, Pages } = PQ;

  const TYPING_TIP = 'Typing tip: type a vowel or <b>n</b>, then press <span class="kbd">`</span> to add its accent (a → á, n → ñ). Every typing game also has an on-screen accent bar.';
  const BOX_COLORS = ['#ff5c7a', '#ff8a5c', '#f6c453', '#a3e635', '#38d9c4', '#60a5fa'];
  const LEVEL_TITLES = ['Novato', 'Aprendiz', 'Estudiante', 'Explorador', 'Experto', 'Maestro', 'Leyenda'];
  const ALL_CAT = 'all';
  // Short chip labels keep the sticky toolbar to one row of chips; the full sheet title is in the chip's title / aria-label.
  const SHORT_CAT = { school: 'School day', question: 'Question words', adjective: 'Adjectives', ordinal: 'Ordinals', useful: 'Useful words' };

  /* ------------------------------------------------------------
     Page lifecycle
     ------------------------------------------------------------ */
  let live = null; // { id, page, cleanups: [], practice, confirm, rows: Map, filter, api, rerender }

  function mountPage(id, root) {
    teardown();
    const page = UI.h('div.page.container.pg.pg-' + id);
    live = { id, page, cleanups: [], practice: null, confirm: null, rows: new Map(), filter: null, api: null, rerender: null, dirty: false, raf: 0 };
    const l = live;
    l.cleanups.push(() => cancelAnimationFrame(l.raf));
    root.appendChild(page);
    return page;
  }

  /** addEventListener that is undone on teardown. */
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    live.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }
  /** setTimeout that is cancelled on teardown. */
  function later(fn, ms) {
    const t = setTimeout(fn, ms);
    live.cleanups.push(() => clearTimeout(t));
    return t;
  }
  /** requestAnimationFrame that is cancelled on teardown. */
  function frame(fn) {
    const id = requestAnimationFrame(fn);
    live.cleanups.push(() => cancelAnimationFrame(id));
    return id;
  }

  function teardown() {
    if (!live) return;
    const l = live;
    closePractice();
    if (l.confirm) { try { l.confirm.close(); } catch (e) { /* ignore */ } l.confirm = null; }
    l.cleanups.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
    l.cleanups = [];
    live = null;
  }
  window.addEventListener('hashchange', teardown);

  /* ------------------------------------------------------------
     Shared widgets
     ------------------------------------------------------------ */
  function catIcon(c, extra) {
    return UI.h('div.pg-cat-icon' + (extra || ''), { style: { '--cat': c.color }, 'aria-hidden': 'true' }, c.icon);
  }

  /** 🔊 button: pronounce entry.base (or explain why it cannot). */
  function sayButton(entry) {
    const btn = UI.h('button.btn.btn-icon.btn-ghost.pg-say', { type: 'button', title: 'Hear it', 'aria-label': 'Hear ' + entry.base }, '🔊');
    btn.addEventListener('click', () => {
      if (Speech.say(entry.base)) {
        btn.classList.remove('is-speaking'); void btn.offsetWidth; // restart the pulse animation
        btn.classList.add('is-speaking');
        return;
      }
      UI.toast(Speech.available() ? 'Speech is off — turn it on in Progress → Settings' : 'Speech is not supported in this browser', 'warn');
    });
    return btn;
  }

  /** Practice button → opens the practice modal for the entry. */
  function practiceButton(entry, onAnswer, onClose) {
    return UI.h('button.btn.btn-sm.pg-practice-btn', { type: 'button', 'aria-label': 'Practice ' + entry.en, onclick: () => openPractice(entry, { onAnswer, onClose }) }, UI.h('span', { 'aria-hidden': 'true' }, '✍️'), ' Practice');
  }

  /** Replace the mastery dots inside a .pg-row with fresh ones. */
  function refreshRowDots(row, id) {
    if (!row || !row.isConnected) return;
    const slot = row.querySelector('.pg-row-mastery');
    if (!slot) return;
    const box = Progress.box(id);
    UI.clear(slot).appendChild(UI.masteryDots(id));
    row.classList.toggle('is-mastered', box >= Progress.MAX_BOX);
  }

  /** Brief colored flash on a row after an answer. */
  function flashRow(row, status) {
    if (!row || !row.isConnected) return;
    row.classList.remove('flash-ok', 'flash-accent', 'flash-bad');
    void row.offsetWidth;
    row.classList.add(status === 'correct' ? 'flash-ok' : status === 'accent' ? 'flash-accent' : 'flash-bad');
  }

  /* ------------------------------------------------------------
     Practice modal — one question about one word, via QuizUI
     opts: { kind?: 'typed'|'choice'|'accent'|'meaning', onAnswer?, onClose? }
     ------------------------------------------------------------ */
  function openPractice(entry, opts) {
    if (!live) return null;
    opts = opts || {};
    closePractice();
    let kind = opts.kind;
    if (kind === 'accent' && !Text.hasAccent(entry.base)) kind = 'typed';
    const q = kind && typeof Quiz[kind] === 'function' ? Quiz[kind](entry) : Quiz.any(entry);
    const cat = Vocab.category(entry.cat);
    const rec = { entry, modal: null, ctl: null, result: null };

    rec.ctl = QuizUI.ask(q, {
      autoContinue: false,
      onAnswer(r) {
        rec.result = r;
        celebrate(r, entry, rec);
        if (opts.onAnswer) opts.onAnswer(r);
      },
      onResult() { if (rec.modal) rec.modal.close(); },
    });

    const body = UI.h('div.pg-practice', null,
      UI.h('div.pg-practice-cat', { style: { '--cat': cat.color } }, UI.h('span', { 'aria-hidden': 'true' }, cat.icon), UI.h('span', null, cat.en)),
      rec.ctl.el);
    rec.modal = UI.modal({
      title: 'Practice',
      content: body,
      onClose() {
        rec.ctl.destroy();
        if (live && live.practice === rec) live.practice = null;
        if (opts.onClose) opts.onClose(rec.result);
        // the Progress page postpones its full re-render until the dialog is gone (keeps the row flash + focus target alive)
        if (live && live.dirty && live.rerender) { live.dirty = false; live.rerender(); }
      },
    });
    live.practice = rec;
    Sound.play('click');
    return rec;
  }

  function closePractice() {
    if (!live || !live.practice) return;
    const rec = live.practice;
    live.practice = null;
    try { rec.modal.close(); } catch (e) { /* ignore */ }
  }

  /** Confetti for a correct answer, a fanfare when the word reaches the top box. */
  function celebrate(r, entry, rec) {
    if (r.status !== 'correct') return;
    const box = rec.modal && rec.modal.el ? rec.modal.el.getBoundingClientRect() : null;
    UI.confetti(box ? { x: box.left + box.width / 2, y: box.top + Math.min(box.height * 0.35, 220), count: 70 } : { count: 70 });
    if (r.box >= Progress.MAX_BOX) {
      later(() => { Sound.play('win'); UI.toast('¡Dominado! "' + entry.base + '" is mastered', 'ok', 2600); }, 650);
    }
  }

  /* ------------------------------------------------------------
     Category focus chips (same behaviour as the home page: Settings 'cats')
     ------------------------------------------------------------ */
  function focusChips() {
    const group = UI.h('div.chip-group.pg-focus');
    const paint = () => {
      const cur = Settings.get('cats') || [];
      group.querySelectorAll('.chip').forEach((chip) => chip.setAttribute('aria-pressed', cur.includes(chip.dataset.cat) ? 'true' : 'false'));
    };
    Vocab.categories().forEach((c) => {
      const chip = UI.h('button.chip', { type: 'button', dataset: { cat: c.id } }, c.icon + ' ' + c.en + ' (' + Vocab.byCategory(c.id).length + ')');
      chip.addEventListener('click', () => {
        const list = (Settings.get('cats') || []).slice();
        const i = list.indexOf(c.id);
        if (i >= 0) list.splice(i, 1); else list.push(c.id);
        Settings.set('cats', list.length ? list : null);
        paint();
        Sound.play('click');
      });
      group.appendChild(chip);
    });
    paint();
    group._paint = paint;
    return group;
  }

  /* ============================================================
     WORDS PAGE  (#/words)
     ============================================================ */
  Pages.register('words', { unmount: teardown, mount(root) {
    const page = mountPage('words', root);
    const meta = Vocab.meta();
    const all = Vocab.all();
    const cats = Vocab.categories();
    const state = live.filter = { q: '', cat: ALL_CAT, accents: false };
    const rows = live.rows;
    // Accent-insensitive search key per word (Spanish display form, canonical base, English).
    const keys = new Map(all.map((e) => [e.id, Text.stripAccents(Text.normalize(e.es + ' ' + e.base + ' ' + e.en))]));
    const accentTotal = Vocab.withAccents(all).length;

    /* ---- Header ---- */
    const masteredPill = UI.h('span.pg-pill.pg-pill-mint');
    page.appendChild(UI.h('div.page-head.pg-head', null,
      UI.h('div.pg-head-text', null,
        UI.h('div.eyebrow', null, 'Vocabulary'),
        UI.h('h2', null, meta.unit),
        UI.h('p', null, meta.list)),
      UI.h('div.pg-pills', null,
        UI.h('span.pg-pill', null, UI.h('b', null, all.length), ' words'),
        UI.h('span.pg-pill.pg-pill-amber', null, UI.h('b', null, accentTotal), ' with accents'),
        masteredPill)));

    /* ---- Toolbar: search, category chips, accents toggle, count ---- */
    const search = UI.h('input.input.pg-search-input', { type: 'text', placeholder: 'Search Spanish or English…', 'aria-label': 'Search words', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const clearBtn = UI.h('button.pg-search-clear', { type: 'button', 'aria-label': 'Clear search' }, '✕');
    const searchWrap = UI.h('div.pg-search', null,
      UI.h('span.pg-search-icon', { 'aria-hidden': 'true' }, '⌕'),
      search, clearBtn,
      UI.h('span.kbd.pg-search-kbd', { 'aria-hidden': 'true', title: 'Press / to search' }, '/'));

    const chips = UI.h('div.chip-group.pg-chips', { role: 'group', 'aria-label': 'Category' });
    const chipOf = {};
    const makeChip = (id, icon, label, color, full) => {
      const chip = UI.h('button.chip.pg-chip', { type: 'button', dataset: { cat: id }, style: color ? { '--cat': color } : null, title: full || null, 'aria-label': full || null },
        UI.h('span.pg-chip-icon', { 'aria-hidden': 'true' }, icon), UI.h('span', null, label), UI.h('span.pg-chip-count'));
      chip.addEventListener('click', () => { setCat(id); Sound.play('click'); });
      chipOf[id] = chip;
      chips.appendChild(chip);
    };
    makeChip(ALL_CAT, '✦', 'All');
    cats.forEach((c) => makeChip(c.id, c.icon, SHORT_CAT[c.id] || c.en, c.color, c.en));

    const accInput = UI.h('input', { type: 'checkbox' });
    const accToggle = UI.h('label.toggle.pg-toggle.pg-toggle-accents', null, accInput, UI.h('span.track'),
      UI.h('span.pg-toggle-long', null, 'Show accents only'), UI.h('span.pg-toggle-short', null, 'Accents only'));
    const countEl = UI.h('div.pg-count', { 'aria-live': 'polite' });
    // Grid areas (css/pages.css) lay these out as search+toggle / chips / count on desktop and
    // search / toggle+count / one-line scrollable chip strip on phones, keeping the sticky bar short.
    page.appendChild(UI.h('div.pg-toolbar.card', null, searchWrap, accToggle, chips, countEl));

    /* ---- One section per category ---- */
    const sections = {};
    const list = UI.h('div.pg-sections');
    cats.forEach((c) => {
      const words = all.filter((e) => e.cat === c.id);
      const count = UI.h('span.pg-cat-count');
      const fill = UI.h('div.bar-fill');
      const sec = UI.h('section.pg-cat', { dataset: { cat: c.id }, style: { '--cat': c.color }, 'aria-label': c.en },
        UI.h('div.pg-cat-head', null,
          catIcon(c),
          UI.h('div.pg-cat-titles', null, UI.h('h3', { lang: 'es' }, c.es), UI.h('div.pg-cat-en', null, c.en)),
          UI.h('div.pg-cat-meta', null, count, UI.h('div.bar.pg-cat-bar', { title: 'Category mastery' }, fill))));
      const rowsEl = UI.h('div.pg-rows');
      words.forEach((e, i) => { const row = buildRow(e, i); rows.set(e.id, row); rowsEl.appendChild(row); });
      sec.appendChild(rowsEl);
      sections[c.id] = { el: sec, count, fill, total: words.length };
      list.appendChild(sec);
    });
    page.appendChild(list);

    const emptyEl = UI.h('div.pg-empty.card.hidden', null,
      UI.h('div.pg-empty-icon', { 'aria-hidden': 'true' }, '🔎'),
      UI.h('h3', null, 'No words match'),
      UI.h('p.muted', null, 'Try another spelling — accents are ignored while searching.'),
      UI.h('button.btn.btn-outline', { type: 'button', onclick: () => { resetFilters(); search.focus(); } }, 'Clear filters'));
    page.appendChild(emptyEl);

    /* ---- Footnote ---- */
    page.appendChild(UI.h('div.pg-footnote.card', null,
      UI.h('div.pg-footnote-item', null, UI.h('span.pg-footnote-icon', { 'aria-hidden': 'true' }, '📌'), UI.h('div', null, UI.h('b', null, 'Ordinals: '), meta.footnote)),
      UI.h('div.pg-footnote-item', null, UI.h('span.pg-footnote-icon', { 'aria-hidden': 'true' }, '⌨️'), UI.h('div', { html: TYPING_TIP }))));

    function buildRow(e, i) {
      const row = UI.h('div.word-row.pg-row', { dataset: { id: e.id }, style: { '--i': Math.min(i, 14) } },
        UI.h('div.es', { lang: 'es', html: Text.highlightAccents(e.es) }),
        UI.h('div.pg-row-text', null, UI.h('div.en', null, e.en), e.note ? UI.h('div.note.small.muted', null, e.note) : null),
        UI.h('div.pg-row-mastery', null, UI.masteryDots(e.id)),
        UI.h('div.pg-row-actions', null,
          sayButton(e),
          practiceButton(e, (r) => flashRow(row, r.status), () => refreshRowDots(row, e.id))));
      row.classList.toggle('is-mastered', Progress.box(e.id) >= Progress.MAX_BOX);
      return row;
    }

    /* ---- Filtering ---- */
    function apply() {
      const q = Text.stripAccents(Text.normalize(state.q));
      const perCat = {};
      let visible = 0, matching = 0;
      all.forEach((e) => {
        const base = (!q || keys.get(e.id).indexOf(q) >= 0) && (!state.accents || Text.hasAccent(e.base));
        if (base) { matching++; perCat[e.cat] = (perCat[e.cat] || 0) + 1; }
        const show = base && (state.cat === ALL_CAT || e.cat === state.cat);
        rows.get(e.id).classList.toggle('hidden', !show);
        if (show) visible++;
      });
      cats.forEach((c) => {
        const s = sections[c.id];
        const n = state.cat === ALL_CAT || state.cat === c.id ? (perCat[c.id] || 0) : 0;
        s.el.classList.toggle('hidden', n === 0);
        s.count.textContent = n === s.total ? s.total + ' words' : n + ' of ' + s.total;
      });
      Object.keys(chipOf).forEach((id) => {
        const chip = chipOf[id];
        chip.setAttribute('aria-pressed', state.cat === id ? 'true' : 'false');
        chip.querySelector('.pg-chip-count').textContent = id === ALL_CAT ? matching : (perCat[id] || 0);
      });
      const filtered = !!q || state.accents || state.cat !== ALL_CAT;
      countEl.textContent = filtered ? 'Showing ' + visible + ' of ' + all.length + ' words' : all.length + ' words';
      emptyEl.classList.toggle('hidden', visible > 0);
      list.classList.toggle('hidden', visible === 0);
      searchWrap.classList.toggle('has-value', !!state.q);
      accInput.checked = state.accents;
      state.visible = visible;
    }
    /** After a filter change the first result must be visible, not above the fold / under the sticky toolbar. */
    function keepListInView() {
      const toolbar = page.querySelector('.pg-toolbar');
      const first = list.classList.contains('hidden') ? emptyEl : list;
      // gap between the sticky toolbar's bottom edge and the first result; negative = hidden under it
      const gap = first.getBoundingClientRect().top - ((toolbar ? toolbar.getBoundingClientRect().bottom : 0) + 16);
      if (gap < 0) window.scrollBy(0, gap);
    }
    function setSearch(q) { state.q = q; if (search.value !== q) search.value = q; apply(); keepListInView(); }
    function setCat(id) { state.cat = chipOf[id] ? id : ALL_CAT; apply(); keepListInView(); }
    function setAccents(b) { state.accents = !!b; apply(); keepListInView(); }
    function resetFilters() { state.q = ''; search.value = ''; state.cat = ALL_CAT; state.accents = false; apply(); keepListInView(); }

    search.addEventListener('input', () => setSearch(search.value));
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (search.value) setSearch(''); else search.blur();
    });
    clearBtn.addEventListener('click', () => { setSearch(''); search.focus(); });
    accInput.addEventListener('change', () => { setAccents(accInput.checked); Sound.play('click'); });

    // "/" focuses the search (ignored while typing elsewhere or while a modal is open).
    on(document, 'keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      search.focus(); search.select();
    });

    /* ---- Mastery (dots, category bars, header pill) ---- */
    function refreshMastery() {
      rows.forEach((row, id) => refreshRowDots(row, id));
      cats.forEach((c) => { sections[c.id].fill.style.width = Math.round(Progress.summary(Vocab.byCategory(c.id)).avg * 100) + '%'; });
      const s = Progress.summary(all);
      UI.clear(masteredPill).append(UI.h('b', null, s.mastered), ' mastered');
      masteredPill.classList.toggle('hidden', s.mastered === 0);
    }
    on(window, 'pq:progress', () => { if (live && live.page === page && page.isConnected) refreshMastery(); });

    apply();
    refreshMastery();
    live.api = { setSearch, setCat, setAccents, resetFilters, refreshMastery };
  } });

  /* ============================================================
     PROGRESS PAGE  (#/stats)
     ============================================================ */
  Pages.register('stats', { unmount: teardown, mount(root) {
    const page = mountPage('stats', root);
    const cats = Vocab.categories();
    const all = Vocab.all();

    page.appendChild(UI.h('div.page-head.pg-head', null,
      UI.h('div.pg-head-text', null,
        UI.h('div.eyebrow', null, 'Progress'),
        UI.h('h2', null, 'Your journey so far'),
        UI.h('p', null, 'Every word climbs through six boxes. Box 5 means it is mastered — slips send it back down.'))));

    const data = UI.h('div.pg-data');
    page.appendChild(data);
    page.appendChild(buildSettings());

    function render() {
      UI.clear(data);
      const summary = Progress.summary(all);
      const lp = Progress.levelProgress();
      const totals = Progress.totals();
      data.appendChild(buildOverview(summary, lp, totals));
      data.appendChild(UI.h('div.grid.grid-2.pg-grid', null, buildCategoryMastery(), buildBoxChart(summary)));
      data.appendChild(UI.h('div.grid.grid-2.pg-grid', null, buildAccentTrouble(), buildGameRecords()));
      // Bars start at zero and animate to their value once laid out (one pending frame per page; cancelled on teardown).
      cancelAnimationFrame(live.raf);
      live.raf = requestAnimationFrame(() => {
        void data.offsetWidth; // flush the zero-width layout so the transition runs
        data.querySelectorAll('.pg-fill[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; });
        data.querySelectorAll('.pg-box-fill[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
      });
    }

    function stat(label, value, cls) {
      return UI.h('div.stat' + (cls ? '.' + cls : ''), null, UI.h('div.stat-val', null, value), UI.h('div.stat-label', null, label));
    }

    function buildOverview(summary, lp, totals) {
      const pct = Math.round(summary.avg * 100);
      const accuracy = totals.answers ? Math.round(100 * totals.correct / totals.answers) + '%' : '—';
      const title = LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, lp.level - 1)];
      return UI.h('section.card.card-glass.pg-overview', { 'aria-label': 'Overview' },
        UI.h('div.pg-overview-ring', null,
          UI.ring(summary.avg, pct + '%', 150),
          UI.h('div.small.muted.center', null, 'Overall mastery'),
          UI.h('div.small.text-2.center', null, summary.mastered + ' / ' + summary.total + ' words mastered')),
        UI.h('div.pg-overview-body', null,
          UI.h('div.pg-level', null,
            UI.h('div.pg-level-badge', null, lp.level),
            UI.h('div', null, UI.h('div.eyebrow', null, 'Level ' + lp.level), UI.h('div.pg-level-title', null, title))),
          UI.h('div.row-between.small.pg-xp-row', null,
            UI.h('span', null, UI.h('b', null, lp.xp - lp.cur), ' / ' + (lp.next - lp.cur) + ' XP'),
            UI.h('span.muted', null, (lp.next - lp.xp) + ' XP to level ' + (lp.level + 1))),
          UI.h('div.bar.bar-lg.pg-xp-bar', null, UI.h('div.bar-fill.pg-fill', { dataset: { w: Math.round(lp.frac * 100) } })),
          UI.h('div.stat-grid.pg-stats-grid', null,
            stat('Answers', totals.answers, 'pg-stat-answers'),
            stat('Accuracy', accuracy, 'pg-stat-accuracy'),
            stat('Best streak', Progress.bestStreak(), 'pg-stat-streak'),
            stat('Practiced', summary.seen + '/' + summary.total, 'pg-stat-seen'),
            stat('Total XP', totals.xp, 'pg-stat-xp'))));
    }

    function buildCategoryMastery() {
      const card = UI.h('section.card.pg-catmastery', { 'aria-label': 'Mastery by category' }, UI.h('div.eyebrow', null, 'By category'), UI.h('h3', null, 'Mastery by category'));
      cats.forEach((c) => {
        const s = Progress.summary(Vocab.byCategory(c.id));
        const pct = Math.round(s.avg * 100);
        card.appendChild(UI.h('div.pg-catbar', { style: { '--cat': c.color } },
          catIcon(c, '.sm'),
          UI.h('div.pg-catbar-body', null,
            UI.h('div.row-between', null, UI.h('span.pg-catbar-name', null, c.en), UI.h('span.pg-catbar-pct', null, pct + '%')),
            UI.h('div.bar.pg-bar', { role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': c.en + ' mastery' }, UI.h('div.bar-fill.pg-fill', { dataset: { w: pct } })),
            UI.h('div.tiny.muted', null, s.mastered + ' of ' + s.total + ' mastered · ' + s.seen + ' practiced'))));
      });
      return card;
    }

    function buildBoxChart(summary) {
      const boxes = summary.boxes;
      const max = Math.max(1, Math.max.apply(null, boxes));
      const chart = UI.h('div.pg-boxes', { role: 'img', 'aria-label': 'Box distribution: ' + boxes.map((n, i) => 'box ' + i + ' ' + n).join(', ') });
      boxes.forEach((n, i) => {
        chart.appendChild(UI.h('div.pg-box-col', { style: { '--col': BOX_COLORS[i] }, dataset: { box: i } },
          UI.h('div.pg-box-count', null, n),
          UI.h('div.pg-box-track', null, UI.h('div.pg-box-fill', { dataset: { h: Math.max(2, Math.round(100 * n / max)) } })),
          UI.h('div.pg-box-label', null, UI.h('b', null, i), i === 0 ? 'new' : i === Progress.MAX_BOX ? 'mastered' : '')));
      });
      return UI.h('section.card.pg-boxcard', { 'aria-label': 'Box distribution' },
        UI.h('div.eyebrow', null, 'Leitner boxes'), UI.h('h3', null, 'Box distribution'),
        chart,
        UI.h('div.tiny.muted', null, 'A correct answer moves a word up one box; a slip moves it down. Weak boxes come up more often in every game.'));
    }

    function buildAccentTrouble() {
      const card = UI.h('section.card.pg-trouble', { 'aria-label': 'Accent trouble' }, UI.h('div.eyebrow', null, 'Accent trouble'), UI.h('h3', null, 'Words where the accents slip'));
      const trouble = all.map((e) => ({ e, w: Progress.word(e.id) })).filter((x) => x.w.acc > 0)
        .sort((a, b) => (b.w.acc - a.w.acc) || (a.w.box - b.w.box) || a.e.es.localeCompare(b.e.es));
      if (!trouble.length) {
        card.appendChild(UI.h('div.pg-empty-inline', null, UI.h('span.pg-empty-icon', { 'aria-hidden': 'true' }, '🎯'), UI.h('div', null, UI.h('b', null, 'No accent slips recorded yet.'), UI.h('div.small.muted', null, 'When a word is spelled right but an accent is off, it shows up here with the correct spelling.'))));
        return card;
      }
      const listEl = UI.h('div.pg-rows');
      trouble.forEach(({ e, w }) => {
        const row = UI.h('div.word-row.pg-row.pg-trouble-row', { dataset: { id: e.id } },
          UI.h('div.es', { lang: 'es', html: Text.highlightAccents(e.base) }),
          UI.h('div.pg-row-text', null, UI.h('div.en', null, e.en), UI.h('div.note.small.pg-slips', null, w.acc + (w.acc === 1 ? ' accent slip' : ' accent slips'))),
          UI.h('div.pg-row-mastery', null, UI.masteryDots(e.id)),
          UI.h('div.pg-row-actions', null, sayButton(e), practiceButton(e, (r) => flashRow(row, r.status))));
        listEl.appendChild(row);
      });
      card.appendChild(listEl);
      return card;
    }

    function buildGameRecords() {
      const games = Games.all();
      const card = UI.h('section.card.pg-records', { 'aria-label': 'Game records' }, UI.h('div.eyebrow', null, 'High scores'), UI.h('h3', null, 'Game records'));
      if (!games.length) { card.appendChild(UI.h('p.muted', null, 'No games loaded.')); return card; }
      const grid = UI.h('div.pg-games');
      games.forEach((g) => {
        const st = Progress.gameStats(g.id);
        grid.appendChild(UI.h('a.pg-game', { href: '#/play/' + g.id, style: { '--accent': g.accent || 'var(--c-amber)' }, dataset: { game: g.id } },
          UI.h('div.pg-game-icon', { 'aria-hidden': 'true' }, g.icon || '🎮'),
          UI.h('div.pg-game-name', null, g.name),
          UI.h('div.pg-game-stats', null,
            UI.h('div', null, UI.h('div.pg-game-val', null, st.best), UI.h('div.tiny.muted', null, 'best')),
            UI.h('div', null, UI.h('div.pg-game-val', null, st.plays), UI.h('div.tiny.muted', null, st.plays === 1 ? 'play' : 'plays'))),
          UI.h('div.pg-game-cta', null, st.plays ? 'Play again →' : 'Play now →')));
      });
      card.appendChild(grid);
      return card;
    }

    /* ---- Settings card (not re-rendered on pq:progress) ---- */
    function buildSettings() {
      const card = UI.h('section.card.pg-settings', { 'aria-label': 'Settings' }, UI.h('div.eyebrow', null, 'Settings'), UI.h('h3', null, 'Preferences'));

      const soundInput = UI.h('input', { type: 'checkbox', checked: Sound.enabled() });
      const speechInput = UI.h('input', { type: 'checkbox', checked: Speech.enabled(), disabled: !Speech.available() });
      const toggleRow = (cls, input, title, sub) => UI.h('label.toggle.pg-toggle.' + cls, null, input, UI.h('span.track'),
        UI.h('span.pg-toggle-text', null, UI.h('b', null, title), UI.h('span.small.muted', null, sub)));
      soundInput.addEventListener('change', () => { Sound.toggle(); if (Sound.enabled()) Sound.play('click'); });
      speechInput.addEventListener('change', () => { Settings.set('speech', speechInput.checked); if (speechInput.checked) Speech.say('¡Hola!'); Sound.play('click'); });
      card.appendChild(UI.h('div.pg-toggles', null,
        toggleRow('pg-toggle-sound', soundInput, 'Sound effects', 'Clicks, chimes and fanfares'),
        toggleRow('pg-toggle-speech', speechInput, 'Pronunciation', Speech.available() ? 'Hear words with the 🔊 buttons' : 'Not supported in this browser')));

      const chips = focusChips();
      card.appendChild(UI.h('div.pg-settings-block', null,
        UI.h('div.pg-settings-title', null, 'Which word groups to practice'),
        UI.h('p.small.muted', null, 'Applies to every game. Deselect all to practice everything.'),
        chips));

      card.appendChild(UI.h('div.pg-settings-block.pg-danger', null,
        UI.h('div.pg-settings-title', null, 'Danger zone'),
        UI.h('p.small.muted', null, 'Wipes mastery, XP, streaks and high scores on this device.'),
        UI.h('button.btn.btn-danger.pg-reset', { type: 'button', onclick: confirmReset }, '🗑 Reset all progress')));

      // Keep the toggles / chips in sync when settings change elsewhere (header sound button, home page),
      // and repaint the header's sound button when it changes here (it only repaints itself on its own click).
      const syncHeaderSound = () => {
        const sb = document.getElementById('soundBtn'); if (!sb) return;
        const onNow = Sound.enabled();
        sb.textContent = onNow ? '🔊' : '🔇'; sb.setAttribute('aria-pressed', onNow ? 'true' : 'false'); sb.title = onNow ? 'Mute sounds' : 'Unmute sounds';
      };
      on(window, 'pq:settings', (e) => {
        if (!live || live.page !== page) return;
        const key = e.detail && e.detail.key;
        if (key === 'sound') { soundInput.checked = Sound.enabled(); syncHeaderSound(); }
        else if (key === 'speech') speechInput.checked = Speech.enabled();
        else if (key === 'cats') chips._paint();
      });
      return card;
    }

    function confirmReset() {
      if (!live || live.confirm) return;
      closePractice();
      let modal = null;
      const cancel = UI.h('button.btn.btn-outline', { type: 'button', onclick: () => modal.close() }, 'Keep my progress');
      const ok = UI.h('button.btn.btn-danger.pg-reset-confirm', { type: 'button', onclick: () => {
        Progress.reset(); // fires pq:progress → render()
        modal.close();
        Sound.play('click');
        UI.toast('Progress reset — a fresh start!', 'warn');
      } }, 'Yes, reset everything');
      modal = UI.modal({
        title: 'Reset all progress?',
        content: UI.h('div.pg-confirm', null,
          UI.h('p', null, 'This clears every word’s mastery, your XP and level, streaks and all game high scores. It cannot be undone.'),
          UI.h('div.pg-confirm-actions', null, cancel, ok)),
        onClose() { if (live && live.confirm === modal) live.confirm = null; },
      });
      live.confirm = modal;
      later(() => { try { cancel.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
    }

    render();
    on(window, 'pq:progress', () => {
      if (!live || live.page !== page || !page.isConnected) return;
      if (live.practice) { live.dirty = true; return; } // answered inside the practice dialog: redraw once it closes
      render();
    });
    live.rerender = render;
  } });

  /* ------------------------------------------------------------
     Debug hooks for tests
     ------------------------------------------------------------ */
  PQ.debug = PQ.debug || {};
  PQ.debug.pages = {
    get live() { return live; },
    get state() {
      if (!live) return null;
      return { id: live.id, filter: live.filter ? Object.assign({}, live.filter) : null, practiceOpen: !!live.practice, confirmOpen: !!live.confirm, connected: live.page.isConnected };
    },
    /** ids of the rows currently shown on the Words page */
    visibleIds() { if (!live) return []; const out = []; live.rows.forEach((row, id) => { if (!row.classList.contains('hidden')) out.push(id); }); return out; },
    setSearch(q) { if (live && live.api) live.api.setSearch(q); },
    setCat(id) { if (live && live.api) live.api.setCat(id); },
    setAccents(b) { if (live && live.api) live.api.setAccents(b); },
    /** Open the practice modal for a word, optionally forcing the question kind. */
    practice(id, kind) {
      const entry = Vocab.byId(id);
      if (!entry || !live) return false;
      const row = live.rows.get(id);
      openPractice(entry, { kind, onAnswer: (r) => flashRow(row, r.status), onClose: () => refreshRowDots(row, id) });
      return true;
    },
    closePractice,
    get question() { return live && live.practice ? live.practice.ctl.question : null; },
    rerender() { if (live && live.rerender) live.rerender(); },
    teardown,
  };
})();
