/* Browser tests for the shared QuizUI widget + accent bar. Run: node tests/quizui.test.js */
const { launch, assert, SITE } = require('./helpers');
(async () => {
  const { browser, page, errors } = await launch();
  await page.goto(SITE); await page.waitForTimeout(300);
  const ask = (id, kind, opts) => page.evaluate(([id, kind, opts]) => {
    const { Quiz, QuizUI, Vocab } = window.PQ;
    let mount = document.getElementById('m'); if (!mount) { mount = document.createElement('div'); mount.id = 'm'; document.body.appendChild(mount); }
    window.__r = []; window.__a = [];
    window.__c = QuizUI.ask(Quiz[kind](Vocab.byId(id)), Object.assign({ mount, onAnswer: (r) => window.__a.push(r.status), onResult: (r) => window.__r.push(r.status) }, opts || {}));
    return document.activeElement === mount.querySelector('input');
  }, [id, kind, opts || {}]);
  const results = () => page.evaluate(() => window.__r);

  // typed: Enter submits, feedback shown, second Enter continues exactly once
  assert(await ask('facil', 'typed'), 'input focused synchronously');
  await page.keyboard.type('fácil'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert((await results()).length === 0, 'submitting Enter must not also continue');
  assert(await page.$('#m .quiz-feedback.ok'), 'correct feedback shown');
  assert(!(await page.$('#m .quiz-actions button:has-text("Check")')), 'Check button removed after grading');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(JSON.stringify(await results()) === '["correct"]', 'continue fires exactly once');

  // typed accent-only mistake → diff + correct spelling
  await ask('dificil', 'typed');
  await page.keyboard.type('dificil'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(await page.$('#m .quiz-feedback.accent'), 'accent feedback');
  assert((await page.textContent('#m .quiz-feedback')).includes('difícil'), 'shows correct spelling');
  assert(await page.$('#m .diff .d-accent'), 'diff highlights the accent');
  await page.click('#m .quiz-actions .btn-primary'); await page.waitForTimeout(30);
  assert(JSON.stringify(await results()) === '["accent"]', 'button continue');

  // typed wrong
  await ask('horario', 'typed'); await page.keyboard.type('zzz'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(await page.$('#m .quiz-feedback.bad'), 'wrong feedback');
  assert((await page.textContent('#m .fb-answer')).includes('el horario'), 'shows canonical');

  // empty submit does nothing
  await ask('horario', 'typed'); await page.keyboard.press('Enter'); await page.waitForTimeout(30);
  assert(!(await page.$('#m .quiz-feedback')), 'empty submit ignored');

  // hint
  await page.click('#m .quiz-actions button:has-text("Hint")');
  assert((await page.textContent('#m')).includes('Starts with'), 'hint shown');

  // choice via number key
  await ask('ingles', 'choice');
  const correctIdx = await page.evaluate(() => window.__c.question.options.findIndex((o) => o.correct));
  await page.keyboard.press(String(correctIdx + 1)); await page.waitForTimeout(60);
  assert(await page.$('#m .quiz-option.is-correct'), 'choice correct');
  assert((await results()).length === 0, 'number key does not continue');
  await page.keyboard.press('Enter'); await page.waitForTimeout(30);
  assert(JSON.stringify(await results()) === '["correct"]', 'choice continue');

  // choice: accent trap counts as accent-only
  await ask('ingles', 'choice');
  const trapIdx = await page.evaluate(() => window.__c.question.options.findIndex((o) => !o.correct && window.PQ.Text.stripAccents(o.text) === 'ingles'));
  if (trapIdx >= 0) { await page.click(`#m .quiz-option[data-idx="${trapIdx}"]`); await page.waitForTimeout(30); assert(await page.$('#m .quiz-feedback.accent'), 'accent trap → accent status'); }

  // accent kind: toggle tiles, Enter confirms
  await ask('tecnologia', 'accent');
  const need = await page.evaluate(() => window.__c.question.needs);
  for (const i of need) await page.click(`#m .quiz-letter[data-idx="${i}"]`);
  assert((await page.textContent('#m .quiz-letters')).includes('í'), 'tile shows accented letter');
  await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(await page.$('#m .quiz-feedback.ok'), 'accent placement correct');
  await ask('arte', 'accent');
  await page.click('#m .quiz-actions button:has-text("No accents needed")'); await page.waitForTimeout(30);
  assert(await page.$('#m .quiz-feedback.ok'), 'no accents needed → correct');
  await ask('frances', 'accent');
  await page.click('#m .quiz-actions button:has-text("No accents needed")'); await page.waitForTimeout(30);
  assert(await page.$('#m .quiz-feedback.accent') && (await page.$('#m .quiz-letter.is-missed')), 'missed accent marked');

  // meaning kind
  await ask('cuando', 'meaning');
  const ci = await page.evaluate(() => window.__c.question.options.findIndex((o) => o.correct));
  await page.click(`#m .quiz-option[data-idx="${ci}"]`); await page.waitForTimeout(30);
  assert((await page.textContent('#m .fb-answer')).includes('¿Cuándo?'), 'meaning feedback shows Spanish');

  // autoContinue
  await ask('que', 'typed', { autoContinue: 200 }); await page.keyboard.type('qué'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
  assert(JSON.stringify(await results()) === '["correct"]', 'autoContinue');

  // re-ask in the same mount destroys the previous controller; destroy() removes listeners
  const destroyed = await page.evaluate(() => { const prev = window.__c; window.PQ.QuizUI.ask(window.PQ.Quiz.typed(window.PQ.Vocab.byId('util')), { mount: document.getElementById('m') }); return prev.destroyed; });
  assert(destroyed, 'previous widget destroyed on re-ask');
  await page.evaluate(() => { document.getElementById('m')._pqQuiz.destroy(); });
  assert(await page.evaluate(() => document.getElementById('m').children.length === 0), 'destroy removes widget');

  // accent bar: buttons insert at caret, backtick toggles
  await page.evaluate(() => { const i = document.createElement('input'); i.id = 'ab'; document.body.appendChild(i); window.PQ.UI.accentBar(i); i.focus(); });
  await page.keyboard.type('espanol'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('`');
  assert(await page.evaluate(() => document.getElementById('ab').value) === 'español', 'backtick after n → ñ');
  await page.keyboard.press('`');
  assert(await page.evaluate(() => document.getElementById('ab').value) === 'espanol', 'backtick toggles back');
  await page.keyboard.press('End'); await page.click('#ab + .accent-bar .accent-key:has-text("á")');
  assert(await page.evaluate(() => document.getElementById('ab').value === 'espanolá' && document.activeElement.id === 'ab'), 'accent key inserts and keeps focus');

  // progress recorded exactly once per answer
  const n = await page.evaluate(() => window.PQ.Progress.word('facil').n);
  assert(n === 1, 'facil recorded once, got ' + n);

  // the Enter keystroke that creates a question never confirms it; a fresh Enter does
  await page.evaluate(() => {
    window.__r = [];
    window.addEventListener('keydown', function once(e) { if (e.key === 'Enter') { window.removeEventListener('keydown', once, true); window.__c = window.PQ.QuizUI.ask(window.PQ.Quiz.accent(window.PQ.Vocab.byId('frances')), { mount: document.getElementById('m'), onAnswer: (r) => window.__r.push(r.status) }); } }, true);
  });
  await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__r.length === 0 && !document.querySelector('#m .quiz-feedback')), 'stale Enter ignored by a new question');
  await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  assert(await page.evaluate(() => window.__r.length === 1), 'fresh Enter confirms');

  // a dialog on top: focus moves into it (even if opened right after the question), nothing is graded behind it, focus comes back on close
  await page.evaluate(() => { window.__r = []; window.__c = window.PQ.QuizUI.ask(window.PQ.Quiz.typed(window.PQ.Vocab.byId('facil')), { mount: document.getElementById('m'), onAnswer: (r) => window.__r.push(r.status) }); window.__modal = window.PQ.UI.modal({ title: 'Quit?', content: window.PQ.UI.h('p', null, 'sure?') }); });
  await page.waitForTimeout(80);
  assert(await page.evaluate(() => document.querySelector('.modal-backdrop').contains(document.activeElement)), 'focus moved into the dialog');
  // (ASCII only: Playwright inserts non-keyboard characters like á through an IME path that ignores focus)
  await page.keyboard.type('facil'); await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(await page.evaluate(() => window.__r.length === 0 && document.querySelector('#m input').value === ''), 'keystrokes do not reach the question behind a dialog');
  assert(await page.evaluate(() => { document.querySelector('#m input').value = 'fácil'; window.__c.submit(); return window.__r.length === 0; }), 'submit() is blocked behind a dialog');
  await page.evaluate(() => window.__modal.close()); await page.waitForTimeout(40);
  assert(await page.evaluate(() => document.activeElement === document.querySelector('#m input')), 'focus restored to the input when the dialog closes');
  await page.keyboard.press('Enter'); await page.waitForTimeout(60);
  assert(await page.evaluate(() => JSON.stringify(window.__r) === '["correct"]'), 'graded normally after the dialog closed');
  // feedback sits above the Continue button
  assert(await page.evaluate(() => { const r = document.querySelector('#m .quiz'); const fb = r.querySelector('.quiz-feedback-slot'), ac = r.querySelector('.quiz-actions'); return !!(fb.compareDocumentPosition(ac) & Node.DOCUMENT_POSITION_FOLLOWING) && !!ac.querySelector('.btn-primary'); }), 'feedback renders above Continue');
  // a question inside a forced modal (platformer style) gets its input focused
  assert(await page.evaluate(() => { const c = window.PQ.QuizUI.ask(window.PQ.Quiz.typed(window.PQ.Vocab.byId('que'))); const md = window.PQ.UI.modal({ closable: false, content: c.el }); const ok = document.activeElement === c.el.querySelector('input'); md.close(); c.destroy(); return ok; }), 'typed question inside a modal is focused');
  // time in a hidden tab is not counted as thinking time
  const elapsed = await page.evaluate(async () => {
    const m = document.getElementById('m'); let res = null;
    const c = window.PQ.QuizUI.ask(window.PQ.Quiz.typed(window.PQ.Vocab.byId('util')), { mount: m, onAnswer: (r) => { res = r; } });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 350));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
    m.querySelector('input').value = 'útil'; c.submit(); delete document.hidden; return res.elapsed;
  });
  assert(elapsed < 0.25, 'hidden time excluded from elapsed, got ' + elapsed);

  assert(errors.length === 0, 'console errors: ' + errors.join('\n'));
  await browser.close();
  console.log('quizui.test.js: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
