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
t('31 entries', w.VOCAB.length === 31);
t('unique ids', new Set(w.VOCAB.map((e) => e.id)).size === 31);
t('4 categories', w.VOCAB_CATEGORIES.length === 4);
w.VOCAB.forEach((e) => {
  t('category exists ' + e.id, !!Vocab.category(e.cat));
  t('answers normalized ' + e.id, e.answers.every((a) => a === Text.normalize(a)));
  t('base accepted ' + e.id, e.answers.includes(Text.normalize(e.base)));
  if (e.forms) t('forms accepted ' + e.id, e.answers.includes(e.forms.m) && e.answers.includes(e.forms.f));
});
// Sheet spot checks (accents exactly as printed)
['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'nosotras', 'vosotros', 'vosotras', 'ellos', 'ellas', 'ustedes', '¿Cuál?', '¿Por qué?', '¿Cuántos, cuántas?', '¿Qué?', '¿Cómo?', '¿Dónde?', '¿De dónde?', '¿Quién?', '¿Cuándo?', '¿Alguna pregunta?', 'hay', 'no sé', 'terminé', '¿Qué debería hacer?', 'quizás', 'mayúscula', 'después', 'De nada', '¿Quién falta?']
  .forEach((es) => t('sheet word present: ' + es, w.VOCAB.some((e) => e.es === es)));

// --- Text ---
t('normalize ¿Cuál?', Text.normalize('¿Cuál?') === 'cuál');
t('normalize NFD', Text.normalize('cuál') === 'cuál');
t('normalize dots', Text.normalize('la clase de ...') === 'la clase de');
t('normalize spaces', Text.normalize('  Educación   Física ') === 'educación física');
t('strip', Text.stripAccents('señor único Ñ') === 'senor unico N');
t('positions', Text.accentPositions('después').join() === '5');
t('toggle', Text.toggleAccent('a') === 'á' && Text.toggleAccent('á') === 'a' && Text.toggleAccent('n') === 'ñ' && Text.toggleAccent('x') === 'x');
t('esc', Text.esc('<b>&"') === '&lt;b&gt;&amp;&quot;');
t('diff accent', Text.diffHtml('despues', 'después').includes('d-accent'));
t('diff missing', Text.diffHtml('despus', 'después').includes('d-fix'));

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
t('tú accent', Text.check('no se', Vocab.byId('no-se').answers).status === 'accent');
t('por que accent', Text.check('¿Por que?', Vocab.byId('porque').answers).status === 'accent');
t('tu vs tú', Text.check('tu', Vocab.byId('tu').answers).status === 'accent' && Text.check('Tú', Vocab.byId('tu').answers).status === 'correct');
t('el vs él', Text.check('el', Vocab.byId('el').answers).status === 'accent');
t('any() never accent for no-accent word', Array.from({ length: 30 }, () => Quiz.any(Vocab.byId('ella')).kind).every((k) => k !== 'accent'));
t('variants exclude the word', !Text.accentVariants('después').includes('después'));

// --- Progress ---
Progress.reset();
const r1 = Progress.record('quizas', 'correct'); t('xp on correct', r1.xp > 0 && r1.box === 1);
Progress.record('quizas', 'accent'); t('box down on accent', Progress.box('quizas') === 0 && Progress.word('quizas').acc === 1);
Progress.record('quizas', 'wrong'); t('box floor 0', Progress.box('quizas') === 0);
for (let i = 0; i < 10; i++) Progress.record('termine', 'correct');
t('box cap 5', Progress.box('termine') === 5 && Progress.mastery('termine') === 1);
const picks = Progress.pick(10); t('pick 10 unique', picks.length === 10 && new Set(picks.map((p) => p.id)).size === 10);
t('pick exclude', !Progress.pick(5, { exclude: picks.map((p) => p.id) }).some((p) => picks.includes(p)));
t('pick all', Progress.pick(100).length === 31);
t('pick pool', Progress.pick(3, { pool: Vocab.byCategory('pronoun-s') }).every((p) => p.cat === 'pronoun-s'));
t('pick 0', Progress.pick(0).length === 0);
t('weight favors weak', Progress.weight(Vocab.byId('quizas')) > Progress.weight(Vocab.byId('termine')));
t('weakest first', Progress.weakest(1)[0].id === 'quizas');
t('due includes unseen', Progress.due().length >= 29);
t('level curve', Progress.xpForLevel(1) === 0 && Progress.xpForLevel(2) === 100 && Progress.xpForLevel(3) === 300);
t('setBest', Progress.setBest('x', 10) === true && Progress.setBest('x', 5) === false && Progress.best('x') === 10 && Progress.gameStats('x').plays === 2);
Progress.setBest('y', 100, { mode: 'a' }, { wave: 3 }); Progress.setBest('y', 20, { mode: 'b' }, { wave: 1 });
t('touchBest updates best without a play', Progress.touchBest('z', 50, { lvl: 2 }) === true && Progress.gameStats('z').best === 50 && Progress.gameStats('z').plays === 0 && Progress.gameStats('z').lvl === 2 && Progress.touchBest('z', 10) === false);
t('setGameMeta merges without a play', (Progress.setGameMeta('m', { maxLevel: 3 }), Progress.gameStats('m').maxLevel === 3 && Progress.gameStats('m').plays === 0));
t('music pieces compose for every game and the home page', ['home', 'site', 'platformer', 'spell', 'accent', 'blaster', 'flash'].every((id) => { const sg = w.PQ.Music.compose(id); return sg && sg.bars === 40 && sg.steps.length === 640 && sg.steps.some((x) => x.lead) && sg.steps.some((x) => x.pad) && sg.steps.some((x) => x.kick) && sg.bpm <= 90; }));
t('home track is the recorded file', w.PQ.Music.STYLES.home.file === 'assets/music/pufino-vibing.mp3' && /Pufino/.test(w.PQ.Music.STYLES.home.credit));
t('every other page plays the Downtown recording', ['site', 'platformer', 'spell', 'accent', 'blaster', 'flash'].every((id) => w.PQ.Music.STYLES[id].file === 'assets/music/moavii-downtown.mp3' && /Moavii/.test(w.PQ.Music.STYLES[id].credit)));
t('composer is deterministic', JSON.stringify(w.PQ.Music.compose('spell').steps.slice(0, 64)) === JSON.stringify(w.PQ.Music.compose('spell').steps.slice(0, 64)));
t('sound gain follows the volume settings', (w.PQ.Settings.set('volMaster', 0.5), w.PQ.Settings.set('volSfx', 0.5), Math.abs(w.PQ.Sound.gainFactor() - 0.25) < 1e-9 && (w.PQ.Settings.set('volMaster', 0.8), w.PQ.Settings.set('volSfx', 0.9), true)));
t('setBest onBest kept from the best run', Progress.gameStats('y').wave === 3 && Progress.gameStats('y').mode === 'b' && Progress.gameStats('y').lastScore === 20 && Progress.gameStats('y').best === 100);
const sum = Progress.summary(); t('summary', sum.total === 31 && sum.mastered === 1 && sum.boxes.reduce((a, b) => a + b, 0) === 31);
w.PQ.Settings.set('cats', ['pronoun-s']); t('active respects filter', Vocab.active().length === 5 && Vocab.active().every((e) => e.cat === 'pronoun-s'));
w.PQ.Settings.set('cats', ['nope']); t('active falls back', Vocab.active().length === 31);
w.PQ.Settings.set('cats', null);
t('withAccents', Vocab.withAccents().every((e) => Text.hasAccent(e.base)) && Vocab.withAccents().length >= 18);
Progress.reset();
const wk1 = Progress.weakest(10, { includeUnseen: true }).map((e) => e.id).join(), wk2 = Progress.weakest(10, { includeUnseen: true }).map((e) => e.id).join();
t('weakest breaks ties randomly', wk1 !== wk2 || Progress.weakest(10, { includeUnseen: true }).map((e) => e.id).join() !== wk1);
t('weakest still ranks weak words first', (Progress.record('quizas', 'wrong'), Progress.record('quizas', 'wrong'), Progress.weakest(1)[0].id === 'quizas'));

console.log(count - fails + '/' + count + ' passed');
process.exit(fails ? 1 : 0);
