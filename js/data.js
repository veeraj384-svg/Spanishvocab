/* ============================================================
   VOCABULARY DATA — Subject pronouns and more
   Transcribed exactly from the class vocab sheet (accents matter!).

   Entry shape:
     id       unique slug
     es       display form exactly as on the sheet
     base     the single canonical spelling used for accent games / hints
     en       English meaning as on the sheet
     cat      category id (see VOCAB_CATEGORIES)
     answers  every accepted spelling (lowercase, no ¿?¡! punctuation)
              answers[0] is the canonical one shown after a mistake
     forms    optional { m, f } gendered forms
     note     optional usage note
   ============================================================ */
(function () {
  'use strict';

  const CATEGORIES = [
    { id: 'pronoun-s', es: 'Sujeto personal singular', en: 'Subject pronouns (singular)', icon: '👤', color: '#ff8a2b' },
    { id: 'pronoun-p', es: 'Sujeto personal plural',   en: 'Subject pronouns (plural)',   icon: '👥', color: '#4da3ff' },
    { id: 'question',  es: 'Haciendo preguntas',       en: 'Asking questions',             icon: '❓', color: '#ffd23f' },
    { id: 'random',    es: 'Palabras aleatorias',      en: 'Random words',                 icon: '💬', color: '#ef3b4d' },
  ];

  const V = [
    /* ---------- Sujeto personal singular ---------- */
    { id: 'yo',    es: 'yo',    base: 'yo',    en: 'I',              cat: 'pronoun-s', answers: ['yo'] },
    { id: 'tu',    es: 'tú',    base: 'tú',    en: 'you (informal)', cat: 'pronoun-s', answers: ['tú'],  note: 'With the accent it means you; without it, tu means your.' },
    { id: 'el',    es: 'él',    base: 'él',    en: 'he',             cat: 'pronoun-s', answers: ['él'],  note: 'With the accent it means he; without it, el means the.' },
    { id: 'ella',  es: 'ella',  base: 'ella',  en: 'she',            cat: 'pronoun-s', answers: ['ella'] },
    { id: 'usted', es: 'usted', base: 'usted', en: 'you (formal)',   cat: 'pronoun-s', answers: ['usted'] },

    /* ---------- Sujeto personal plural ---------- */
    { id: 'nosotros', es: 'nosotros', base: 'nosotros', en: 'we (masculine)',             cat: 'pronoun-p', answers: ['nosotros'] },
    { id: 'nosotras', es: 'nosotras', base: 'nosotras', en: 'we (feminine)',              cat: 'pronoun-p', answers: ['nosotras'] },
    { id: 'vosotros', es: 'vosotros', base: 'vosotros', en: 'you (informal, masculine)',  cat: 'pronoun-p', answers: ['vosotros'] },
    { id: 'vosotras', es: 'vosotras', base: 'vosotras', en: 'you (informal, feminine)',   cat: 'pronoun-p', answers: ['vosotras'] },
    { id: 'ellos',    es: 'ellos',    base: 'ellos',    en: 'they (masculine)',           cat: 'pronoun-p', answers: ['ellos'] },
    { id: 'ellas',    es: 'ellas',    base: 'ellas',    en: 'they (feminine)',            cat: 'pronoun-p', answers: ['ellas'] },
    { id: 'ustedes',  es: 'ustedes',  base: 'ustedes',  en: 'you (two or more people)',   cat: 'pronoun-p', answers: ['ustedes'] },

    /* ---------- Haciendo preguntas ---------- */
    { id: 'cual',     es: '¿Cuál?',             base: 'cuál',     en: 'Which? / What?', cat: 'question', answers: ['cuál'] },
    { id: 'porque',   es: '¿Por qué?',          base: 'por qué',  en: 'Why?',           cat: 'question', answers: ['por qué'] },
    { id: 'cuantos',  es: '¿Cuántos, cuántas?', base: 'cuántos',  en: 'How many?',      cat: 'question', answers: ['cuántos', 'cuántas', 'cuántos cuántas'], forms: { m: 'cuántos', f: 'cuántas' } },
    { id: 'que',      es: '¿Qué?',              base: 'qué',      en: 'What?',          cat: 'question', answers: ['qué'] },
    { id: 'como',     es: '¿Cómo?',             base: 'cómo',     en: 'How?',           cat: 'question', answers: ['cómo'] },
    { id: 'donde',    es: '¿Dónde?',            base: 'dónde',    en: 'Where?',         cat: 'question', answers: ['dónde'] },
    { id: 'de-donde', es: '¿De dónde?',         base: 'de dónde', en: 'From where?',    cat: 'question', answers: ['de dónde'] },
    { id: 'quien',    es: '¿Quién?',            base: 'quién',    en: 'Who?',           cat: 'question', answers: ['quién'] },
    { id: 'cuando',   es: '¿Cuándo?',           base: 'cuándo',   en: 'When?',          cat: 'question', answers: ['cuándo'] },
    { id: 'alguna-pregunta', es: '¿Alguna pregunta?', base: 'alguna pregunta', en: 'Any questions?', cat: 'question', answers: ['alguna pregunta'] },

    /* ---------- Palabras aleatorias ---------- */
    { id: 'hay',          es: 'hay',                 base: 'hay',                en: 'there is, there are', cat: 'random', answers: ['hay'] },
    { id: 'no-se',        es: 'no sé',               base: 'no sé',              en: "I don't know",        cat: 'random', answers: ['no sé'], note: 'sé (I know) has an accent; se without it is a different word.' },
    { id: 'termine',      es: 'terminé',             base: 'terminé',            en: "I'm done",            cat: 'random', answers: ['terminé'] },
    { id: 'que-deberia',  es: '¿Qué debería hacer?', base: 'qué debería hacer',  en: 'What should I do?',   cat: 'random', answers: ['qué debería hacer'] },
    { id: 'quizas',       es: 'quizás',              base: 'quizás',             en: 'maybe',               cat: 'random', answers: ['quizás'] },
    { id: 'mayuscula',    es: 'mayúscula',           base: 'mayúscula',          en: 'capital letter',      cat: 'random', answers: ['mayúscula'] },
    { id: 'despues',      es: 'después',             base: 'después',            en: 'after',               cat: 'random', answers: ['después'] },
    { id: 'de-nada',      es: 'De nada',             base: 'de nada',            en: "You're welcome",      cat: 'random', answers: ['de nada'] },
    { id: 'quien-falta',  es: '¿Quién falta?',       base: 'quién falta',        en: 'Who is missing?',     cat: 'random', answers: ['quién falta'] },
  ];

  // Freeze to catch accidental mutation by games.
  V.forEach(Object.freeze);
  window.VOCAB = Object.freeze(V);
  window.VOCAB_CATEGORIES = Object.freeze(CATEGORIES.map(Object.freeze));
  window.VOCAB_META = Object.freeze({
    unit: 'Subject pronouns and more',
    list: 'Subject pronouns, question words and everyday phrases',
    footnote: 'tú (you) and él (he) carry an accent; tu (your) and el (the) do not.',
  });
})();
