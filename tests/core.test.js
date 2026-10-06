/* Pure-logic tests for js/core.js (no browser). Run: node tests/core.test.js */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const w = {};
new Function('window', fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'))(w);
const stubDoc = { addEventListener() {}, createElement() { return {}; }, querySelector() { return null; }, getElementById() { return null; }, querySelectorAll() { return []; }, body: {} };
const store = { _s: {}, getItem(k) { return this._s[k] == null ? null : this._s[k]; }, setItem(k, v) { this._s[k] = String(v); }, removeItem(k) { delete this._s[k]; } };
const globals = {
  window: w, document: stubDoc, localStorage: store, performance: { now: () => Date.now() }, location: { hash: '' },
  CustomEvent: class { constructor(n, o) { this.type = n; this.detail = o && o.detail; } }, Event: class {}, Node: class {}, HTMLButtonElement: class {},
  requestAnimationFrame() {}, setTimeout, console,
};
w.addEventListener = () => {}; w.dispatchEvent = () => {}; w.matchMedia = () => ({ matches: false });
new Function(...Object.keys(globals), fs.readFileSync(path.join(root, 'js/core.js'), 'utf8'))(...Object.values(globals));
const { Text, Quiz, Progress, Vocab } = w.PQ;

let fails = 0, count = 0;
const t = (name, cond) => { count++; if (!cond) { fails++; console.log('FAIL', name); } };

// --- data integrity ---
t('44 entries', w.VOCAB.length === 44);
t('unique ids', new Set(w.VOCAB.map((e) => e.id)).size === 44);
t('5 categories', w.VOCAB_CATEGORIES.length === 5);
w.VOCAB.forEach((e) => {
  t('category exists ' + e.id, !!Vocab.category(e.cat));
  t('answers normalized ' + e.id, e.answers.every((a) => a === Text.normalize(a)));
  t('base accepted ' + e.id, e.answers.includes(Text.normalize(e.base)));
  if (e.forms) t('forms accepted ' + e.id, e.answers.includes(e.forms.m) && e.answers.includes(e.forms.f));
});
// Sheet spot checks (accents exactly as printed)
['educación física', 'francés', 'inglés', 'tecnología', 'matemáticas', '¿Cuál?', '¿Por qué?', '¿Cuántos, cuántas?', '¿Quién?', '¿Qué?', '¿Cómo?', '¿Dónde?', '¿Cuándo?', 'difícil', 'fácil', 'útil', 'práctico, práctica', 'simpático, simpática', 'séptimo, séptima', 'Tú necesitas', 'Tú tienes', 'el almuerzo', 'el horario', 'ciencias naturales', 'ciencias sociales', 'interesante']
  .forEach((es) => t('sheet word present: ' + es, w.VOCAB.some((e) => e.es === es)));

// --- Text ---
t('normalize ¿Cuál?', Text.normalize('¿Cuál?') === 'cuál');
t('normalize NFD', Text.normalize('cuál') === 'cuál');
t('normalize dots', Text.normalize('la clase de ...') === 'la clase de');
t('normalize spaces', Text.normalize('  Educación   Física ') === 'educación física');
t('strip', Text.stripAccents('señor único Ñ') === 'senor unico N');
t('positions', Text.accentPositions('difícil').join() === '3');
t('toggle', Text.toggleAccent('a') === 'á' && Text.toggleAccent('á') === 'a' && Text.toggleAccent('n') === 'ñ' && Text.toggleAccent('x') === 'x');
t('esc', Text.esc('<b>&"') === '&lt;b&gt;&amp;&quot;');
t('diff accent', Text.diffHtml('dificil', 'difícil').includes('d-accent'));
t('diff missing', Text.diffHtml('dificl', 'difícil').includes('d-fix'));

w.VOCAB.forEach((e) => {
  t('correct via es ' + e.id, Text.check(e.es, e.answers).status === 'correct');
  t('correct uppercase ' + e.id, Text.check(e.base.toUpperCase(), e.answers).status === 'correct');
  if (Text.hasAccent(e.base)) t('accent-only ' + e.id, Text.check(Text.stripAccents(e.base), e.answers).status === 'accent');
  t('wrong ' + e.id, Text.check('zzzz', e.answers).status === 'wrong');
  t('empty ' + e.id, Text.check('   ', e.answers).status === 'empty');
  const q = Quiz.choice(e);
  t('choice 4 unique options, 1 correct ' + e.id, q.options.length === 4 && q.options.filter((o) => o.correct).length === 1 && new Set(q.options.map((o) => o.text)).size === 4);
  t('choice correct is base ' + e.id, q.options.find((o) => o.correct).text === e.base);
  const qa = Quiz.accent(e);
  t('accent q grade ' + e.id, Quiz.grade(qa, qa.needs).status === 'correct' && (qa.needs.length === 0 || Quiz.grade(qa, []).status === 'accent'));
  t('accent q shown stripped ' + e.id, qa.shown === Text.stripAccents(e.base));
  const m = Quiz.meaning(e);
  t('meaning 4 options ' + e.id, m.options.length === 4 && m.options.filter((o) => o.correct).length === 1 && new Set(m.options.map((o) => o.text)).size === 4);
  if (e.forms) {
    const qf = Quiz.typed(e, { gender: 'f' });
    t('feminine prompt ' + e.id, Text.check(e.forms.f, qf.accepted).status === 'correct' && Text.check(e.forms.m, qf.accepted).status !== 'correct');
    const qm = Quiz.typed(e, { gender: 'm' });
    t('masculine prompt ' + e.id, Text.check(e.forms.m, qm.accepted).status === 'correct');
  }
  const qt = Quiz.typed(e);
  t('typed hint ' + e.id, typeof qt.hint === 'string' && qt.hint.length > 0);
});
t('primer accepted (m)', Text.check('primer', Quiz.typed(Vocab.byId('primero'), { gender: 'm' }).accepted).status === 'correct');
t('tercer accepted (m)', Text.check('tercer', Quiz.typed(Vocab.byId('tercero'), { gender: 'm' }).accepted).status === 'correct');
t('tú accent', Text.check('tu necesitas', Vocab.byId('necesitas').answers).status === 'accent');
t('por que accent', Text.check('¿Por que?', Vocab.byId('porque').answers).status === 'accent');
t('any() never accent for no-accent word', Array.from({ length: 30 }, () => Quiz.any(Vocab.byId('arte')).kind).every((k) => k !== 'accent'));
t('variants exclude the word', !Text.accentVariants('difícil').includes('difícil'));

// --- Progress ---
Progress.reset();
const r1 = Progress.record('facil', 'correct'); t('xp on correct', r1.xp > 0 && r1.box === 1);
Progress.record('facil', 'accent'); t('box down on accent', Progress.box('facil') === 0 && Progress.word('facil').acc === 1);
Progress.record('facil', 'wrong'); t('box floor 0', Progress.box('facil') === 0);
for (let i = 0; i < 10; i++) Progress.record('util', 'correct');
t('box cap 5', Progress.box('util') === 5 && Progress.mastery('util') === 1);
const picks = Progress.pick(10); t('pick 10 unique', picks.length === 10 && new Set(picks.map((p) => p.id)).size === 10);
t('pick exclude', !Progress.pick(5, { exclude: picks.map((p) => p.id) }).some((p) => picks.includes(p)));
t('pick all', Progress.pick(100).length === 44);
t('pick pool', Progress.pick(3, { pool: Vocab.byCategory('useful') }).every((p) => p.cat === 'useful'));
t('pick 0', Progress.pick(0).length === 0);
t('weight favors weak', Progress.weight(Vocab.byId('facil')) > Progress.weight(Vocab.byId('util')));
t('weakest first', Progress.weakest(1)[0].id === 'facil');
t('due includes unseen', Progress.due().length >= 42);
t('level curve', Progress.xpForLevel(1) === 0 && Progress.xpForLevel(2) === 100 && Progress.xpForLevel(3) === 300);
t('setBest', Progress.setBest('x', 10) === true && Progress.setBest('x', 5) === false && Progress.best('x') === 10 && Progress.gameStats('x').plays === 2);
const sum = Progress.summary(); t('summary', sum.total === 44 && sum.mastered === 1 && sum.boxes.reduce((a, b) => a + b, 0) === 44);
w.PQ.Settings.set('cats', ['useful']); t('active respects filter', Vocab.active().length === 4 && Vocab.active().every((e) => e.cat === 'useful'));
w.PQ.Settings.set('cats', ['nope']); t('active falls back', Vocab.active().length === 44);
w.PQ.Settings.set('cats', null);
t('withAccents', Vocab.withAccents().every((e) => Text.hasAccent(e.base)) && Vocab.withAccents().length > 20);

console.log(count - fails + '/' + count + ' passed');
process.exit(fails ? 1 : 0);
