/* ============================================================
   VOCABULARY DATA — Unidad 1: La educación y la escuela
   Lista de vocabulario – Las asignaturas escolares
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
    { id: 'school',    es: 'Para hablar de tu día escolar',                     en: 'To talk about your school day',                 icon: '🏫', color: '#38d9c4' },
    { id: 'question',  es: 'Palabras interrogativas',                           en: 'Interrogative words',                          icon: '❓', color: '#a78bfa' },
    { id: 'adjective', es: 'Adjetivos para describir tus clases y tus profesores', en: 'Adjectives to describe your classes and your teachers', icon: '✨', color: '#f6c453' },
    { id: 'ordinal',   es: 'Para hablar del orden de las cosas',                en: 'To talk about order of things',                icon: '🔢', color: '#ff7a9a' },
    { id: 'useful',    es: 'Palabras útiles',                                   en: 'Useful words',                                 icon: '💬', color: '#60a5fa' },
  ];

  const V = [
    /* ---------- Para hablar de tu día escolar ---------- */
    { id: 'almuerzo',    es: 'el almuerzo',        base: 'el almuerzo',        en: 'lunch',                 cat: 'school', answers: ['el almuerzo', 'almuerzo'] },
    { id: 'clase',       es: 'la clase',           base: 'la clase',           en: 'class',                 cat: 'school', answers: ['la clase', 'clase'] },
    { id: 'clase-de',    es: 'la clase de …',      base: 'la clase de',        en: '… class',               cat: 'school', answers: ['la clase de', 'clase de'], note: 'e.g. la clase de arte = art class' },
    { id: 'arte',        es: 'arte',               base: 'arte',               en: 'art',                   cat: 'school', answers: ['arte', 'el arte'] },
    { id: 'edfisica',    es: 'educación física',   base: 'educación física',   en: 'physical education',    cat: 'school', answers: ['educación física', 'la educación física'] },
    { id: 'espanol',     es: 'español',            base: 'español',            en: 'Spanish',               cat: 'school', answers: ['español', 'el español'] },
    { id: 'frances',     es: 'francés',            base: 'francés',            en: 'French',                cat: 'school', answers: ['francés', 'el francés'] },
    { id: 'csociales',   es: 'ciencias sociales',  base: 'ciencias sociales',  en: 'social studies',        cat: 'school', answers: ['ciencias sociales', 'las ciencias sociales'] },
    { id: 'ingles',      es: 'inglés',             base: 'inglés',             en: 'English',               cat: 'school', answers: ['inglés', 'el inglés'] },
    { id: 'tecnologia',  es: 'tecnología',         base: 'tecnología',         en: 'technology / computers', cat: 'school', answers: ['tecnología', 'la tecnología'] },
    { id: 'matematicas', es: 'matemáticas',        base: 'matemáticas',        en: 'mathematics',           cat: 'school', answers: ['matemáticas', 'las matemáticas'] },
    { id: 'cnaturales',  es: 'ciencias naturales', base: 'ciencias naturales', en: 'science',               cat: 'school', answers: ['ciencias naturales', 'las ciencias naturales'] },
    { id: 'horario',     es: 'el horario',         base: 'el horario',         en: 'schedule',              cat: 'school', answers: ['el horario', 'horario'] },
    { id: 'hora-de',     es: 'en la hora de …',    base: 'en la hora de',      en: 'in the … (class period) hour', cat: 'school', answers: ['en la hora de'], note: 'e.g. en la hora de inglés' },

    /* ---------- Palabras interrogativas ---------- */
    { id: 'cual',    es: '¿Cuál?',             base: 'cuál',    en: 'Which? / What?', cat: 'question', answers: ['cuál'] },
    { id: 'porque',  es: '¿Por qué?',          base: 'por qué', en: 'Why?',           cat: 'question', answers: ['por qué'] },
    { id: 'cuantos', es: '¿Cuántos, cuántas?', base: 'cuántos', en: 'How many?',      cat: 'question', answers: ['cuántos', 'cuántas', 'cuántos cuántas'], forms: { m: 'cuántos', f: 'cuántas' } },
    { id: 'quien',   es: '¿Quién?',            base: 'quién',   en: 'Who?',           cat: 'question', answers: ['quién'] },
    { id: 'que',     es: '¿Qué?',              base: 'qué',     en: 'What?',          cat: 'question', answers: ['qué'] },
    { id: 'como',    es: '¿Cómo?',             base: 'cómo',    en: 'How?',           cat: 'question', answers: ['cómo'] },
    { id: 'donde',   es: '¿Dónde?',            base: 'dónde',   en: 'Where?',         cat: 'question', answers: ['dónde'] },
    { id: 'cuando',  es: '¿Cuándo?',           base: 'cuándo',  en: 'When?',          cat: 'question', answers: ['cuándo'] },

    /* ---------- Adjetivos para describir tus clases y tus profesores ---------- */
    { id: 'aburrido',   es: 'aburrido, aburrida',   base: 'aburrido',   en: 'boring',          cat: 'adjective', answers: ['aburrido', 'aburrida', 'aburrido aburrida'],     forms: { m: 'aburrido',  f: 'aburrida' } },
    { id: 'dificil',    es: 'difícil',              base: 'difícil',    en: 'difficult',       cat: 'adjective', answers: ['difícil'] },
    { id: 'facil',      es: 'fácil',                base: 'fácil',      en: 'easy',            cat: 'adjective', answers: ['fácil'] },
    { id: 'divertido',  es: 'divertido, divertida', base: 'divertido',  en: 'fun',             cat: 'adjective', answers: ['divertido', 'divertida', 'divertido divertida'],  forms: { m: 'divertido', f: 'divertida' } },
    { id: 'util',       es: 'útil',                 base: 'útil',       en: 'useful',          cat: 'adjective', answers: ['útil'] },
    { id: 'interesante',es: 'interesante',          base: 'interesante',en: 'interesting',     cat: 'adjective', answers: ['interesante'] },
    { id: 'practico',   es: 'práctico, práctica',   base: 'práctico',   en: 'practical',       cat: 'adjective', answers: ['práctico', 'práctica', 'práctico práctica'],     forms: { m: 'práctico',  f: 'práctica' } },
    { id: 'favorito',   es: 'favorito, favorita',   base: 'favorito',   en: 'favorite',        cat: 'adjective', answers: ['favorito', 'favorita', 'favorito favorita'],     forms: { m: 'favorito',  f: 'favorita' } },
    { id: 'simpatico',  es: 'simpático, simpática', base: 'simpático',  en: 'nice / friendly', cat: 'adjective', answers: ['simpático', 'simpática', 'simpático simpática'], forms: { m: 'simpático', f: 'simpática' } },
    { id: 'estricto',   es: 'estricto, estricta',   base: 'estricto',   en: 'strict',          cat: 'adjective', answers: ['estricto', 'estricta', 'estricto estricta'],     forms: { m: 'estricto',  f: 'estricta' } },

    /* ---------- Para hablar del orden de las cosas ---------- */
    { id: 'primero', es: 'primero, primera', base: 'primero', en: 'first',   cat: 'ordinal', answers: ['primero', 'primera', 'primer', 'primero primera'], forms: { m: 'primero', f: 'primera' }, note: 'Changes to primer before a masculine noun (el primer día).' },
    { id: 'segundo', es: 'segundo, segunda', base: 'segundo', en: 'second',  cat: 'ordinal', answers: ['segundo', 'segunda', 'segundo segunda'], forms: { m: 'segundo', f: 'segunda' } },
    { id: 'tercero', es: 'tercero, tercera', base: 'tercero', en: 'third',   cat: 'ordinal', answers: ['tercero', 'tercera', 'tercer', 'tercero tercera'], forms: { m: 'tercero', f: 'tercera' }, note: 'Changes to tercer before a masculine noun (el tercer piso).' },
    { id: 'cuarto',  es: 'cuarto, cuarta',   base: 'cuarto',  en: 'fourth',  cat: 'ordinal', answers: ['cuarto', 'cuarta', 'cuarto cuarta'],   forms: { m: 'cuarto',  f: 'cuarta' } },
    { id: 'quinto',  es: 'quinto, quinta',   base: 'quinto',  en: 'fifth',   cat: 'ordinal', answers: ['quinto', 'quinta', 'quinto quinta'],   forms: { m: 'quinto',  f: 'quinta' } },
    { id: 'sexto',   es: 'sexto, sexta',     base: 'sexto',   en: 'sixth',   cat: 'ordinal', answers: ['sexto', 'sexta', 'sexto sexta'],       forms: { m: 'sexto',   f: 'sexta' } },
    { id: 'septimo', es: 'séptimo, séptima', base: 'séptimo', en: 'seventh', cat: 'ordinal', answers: ['séptimo', 'séptima', 'séptimo séptima'], forms: { m: 'séptimo', f: 'séptima' } },
    { id: 'octavo',  es: 'octavo, octava',   base: 'octavo',  en: 'eighth',  cat: 'ordinal', answers: ['octavo', 'octava', 'octavo octava'],   forms: { m: 'octavo',  f: 'octava' } },

    /* ---------- Useful words ---------- */
    { id: 'necesito',  es: 'Yo necesito',  base: 'yo necesito',  en: 'I need',    cat: 'useful', answers: ['yo necesito', 'necesito'] },
    { id: 'necesitas', es: 'Tú necesitas', base: 'tú necesitas', en: 'You need',  cat: 'useful', answers: ['tú necesitas', 'necesitas'] },
    { id: 'tengo',     es: 'Yo tengo',     base: 'yo tengo',     en: 'I have',    cat: 'useful', answers: ['yo tengo', 'tengo'] },
    { id: 'tienes',    es: 'Tú tienes',    base: 'tú tienes',    en: 'You have',  cat: 'useful', answers: ['tú tienes', 'tienes'] },
  ];

  // Freeze to catch accidental mutation by games.
  V.forEach(Object.freeze);
  window.VOCAB = Object.freeze(V);
  window.VOCAB_CATEGORIES = Object.freeze(CATEGORIES.map(Object.freeze));
  window.VOCAB_META = Object.freeze({
    unit: 'Unidad 1. Mi mundo y el mundo hispano: La educación y la escuela',
    list: 'Lista de vocabulario – Las asignaturas escolares',
    footnote: 'primero / tercero change to primer / tercer before a masculine noun.',
  });
})();
