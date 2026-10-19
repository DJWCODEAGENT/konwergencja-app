import {
  loadData, saveData, addSession, deleteSession, addMeasurement, deleteMeasurement,
  importData, DEFAULTS,
} from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const MIN_SAVED_SEC = 10; // krótsze sesje nie są zapisywane
const NS = 'http://www.w3.org/2000/svg';

let data = loadData();
let run = null;       // aktywna sesja treningowa
let timer = null;     // interwał: czas, dźwięk, koniec sesji
let frameId = null;   // pętla klatek: rozmiar kółka i podpis
let wakeLock = null;  // blokada wygaszania ekranu
let audioCtx = null;
let chosenExerciseId = null; // ćwiczenie wybrane na ekranie startowym

// ---------- pomocnicze ----------
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const fmtDate = (iso) =>
  new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Początek tygodnia (poniedziałek, 00:00) dla danej daty.
function weekStart(date) {
  const d = new Date(date);
  const offset = (d.getDay() + 6) % 7; // pn = 0 ... nd = 6
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offset);
  return d;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => (t.hidden = true), 2600);
}

function vibrate(pattern = 30) {
  if (data.settings.vibrate) navigator.vibrate?.(pattern);
}

// Przeglądarki wymagają gestu użytkownika, żeby odtworzyć dźwięk.
function unlockAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch { /* brak dźwięku nie blokuje treningu */ }
}

function beep() {
  if (!data.settings.sound || !audioCtx) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 660;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.12);
  } catch { /* ignorujemy */ }
}

function updateSetting(key, value) {
  data.settings[key] = value;
  saveData(data);
}

// SVG helper.
function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------- nawigacja ----------
function show(name) {
  if (run && name !== 'train') return; // podczas treningu nie wychodzimy
  $$('[data-screen]').forEach((s) => (s.hidden = s.dataset.screen !== name));
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  document.body.classList.toggle('training', name === 'train');
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSettings();
}

// ---------- plan tygodniowy ----------
function weeklyPlanned() {
  return data.settings.trainingDays.length * data.settings.sessionsPerDay;
}

function sessionsThisWeek() {
  const start = weekStart(Date.now()).getTime();
  return data.sessions.filter((s) => Date.parse(s.startedAt) >= start).length;
}

function sessionsToday() {
  const today = dayKey(Date.now());
  return data.sessions.filter((s) => dayKey(s.startedAt) === today).length;
}

function isTrainingDayToday() {
  return data.settings.trainingDays.includes(new Date().getDay());
}

// ---------- ćwiczenia i osiągnięcia ----------
// Ćwiczenia różnią się tempem i formą. Kolejne sesje rotują między nimi.
// Ikony w stylu linii, takie same jak w reszcie aplikacji.
const ico = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

// kind: 'focus' = ostry punkt na środku, 'circle' = kółko, 'pencil' = tylko rytm dźwiękiem.
const EXERCISES = [
  { id: 'focus', name: 'Ołówek na telefonie', kind: 'focus', tempo: 1, visual: true,
    icon: ico('<rect x="7" y="2" width="10" height="20" rx="2.5"/><circle cx="12" cy="12" r="2"/>'),
    desc: 'Patrz na ostry punkt na środku. Przybliżaj telefon do nosa, aż zobaczysz dwa.' },
  { id: 'circle', name: 'Kółko', kind: 'circle', tempo: 1, visual: true,
    icon: ico('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
    desc: 'Przybliżaj, gdy kółko rośnie, cofaj, gdy maleje.' },
  { id: 'fast', name: 'Szybkie cykle', kind: 'circle', tempo: 0.5, visual: true,
    icon: ico('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
    desc: 'Ten sam rytm, dwa razy szybciej.' },
  { id: 'slow', name: 'Wolne cykle', kind: 'circle', tempo: 1.5, visual: true,
    icon: ico('<path d="M6 3h12M6 21h12M7 3c0 4 10 5 10 9s-10 5-10 9M17 3c0 4-10 5-10 9s10 5 10 9"/>'),
    desc: 'Dłuższe cykle, pełne skupienie na każdym.' },
  { id: 'pencil', name: 'Ołówek w dłoni', kind: 'pencil', tempo: 1, visual: false,
    icon: ico('<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>'),
    desc: 'Ołówek w dłoni, telefon odmierza rytm dźwiękiem.' },
];

const DEFAULT_EXERCISE = 'focus';

// Mnożnik tempa przybliżania (tylko tryb „Ołówek na telefonie”): większy = wolniej.
const APPROACH = { wolny: 2, normalny: 1.5, szybki: 1 };

const BADGES = [
  { id: 'first', title: 'Pierwsza sesja', test: (c) => c.sessions >= 1 },
  { id: 'week', title: '7 dni z rzędu', test: (c) => c.longestStreak >= 7 },
  { id: 'month', title: '30 dni z rzędu', test: (c) => c.longestStreak >= 30 },
  { id: 'reps100', title: '100 powtórzeń łącznie', test: (c) => c.reps >= 100 },
  { id: 'reps1000', title: '1000 powtórzeń łącznie', test: (c) => c.reps >= 1000 },
  { id: 'variety', title: 'Wszystkie ćwiczenia', test: (c) => EXERCISES.every((e) => c.exercises.has(e.id)) },
];

// Sesje zapisane przed dodaniem ćwiczeń traktujemy jako „Kółko”.
const exerciseOf = (id) => EXERCISES.find((e) => e.id === (id ?? 'circle')) ?? EXERCISES[0];


// Seria: ile dni z rzędu z sesją, licząc od dziś (a gdy dziś jeszcze nie ćwiczono, od wczoraj).
function currentStreak() {
  const days = new Set(data.sessions.map((s) => dayKey(s.startedAt)));
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// Najdłuższa seria w historii (odznaki nie znikają po przerwie).
function longestStreak() {
  const keys = [...new Set(data.sessions.map((s) => dayKey(s.startedAt)))].sort();
  const utc = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  let best = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    run = prev !== null && utc(k) - utc(prev) === 24 * 60 * 60 * 1000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

function achievementStats() {
  return {
    sessions: data.sessions.length,
    reps: data.sessions.reduce((sum, s) => sum + s.reps, 0),
    longestStreak: longestStreak(),
    exercises: new Set(data.sessions.map((s) => exerciseOf(s.exerciseId).id)),
  };
}

function renderStreak() {
  const n = currentStreak();
  $('#streak-text').textContent = `${n} ${n === 1 ? 'dzień' : 'dni'}`;
}

function renderExercise() {
  const box = $('#exercise');
  if (!chosenExerciseId) chosenExerciseId = DEFAULT_EXERCISE;
  if (box.children.length === 0) {
    for (const e of EXERCISES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-btn';
      b.dataset.id = e.id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `${e.icon}<span>${e.name}</span>`;
      b.addEventListener('click', () => {
        chosenExerciseId = e.id;
        renderExercise();
      });
      box.append(b);
    }
  }
  for (const b of box.children) {
    const on = b.dataset.id === chosenExerciseId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  $('#exercise-desc').textContent = exerciseOf(chosenExerciseId).desc;

  // Tempo przybliżania pokazujemy tylko przy trybie z punktem.
  $('#approach').hidden = chosenExerciseId !== 'focus';
  for (const r of $$('input[name="approach"]')) {
    r.checked = r.value === data.settings.approachSpeed;
  }
}

function renderBadges() {
  const stats = achievementStats();
  const list = $('#badge-list');
  list.replaceChildren();
  for (const b of BADGES) {
    const earned = b.test(stats);
    const li = document.createElement('li');
    li.style.opacity = earned ? '1' : '0.5';
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = b.title;
    const meta = document.createElement('small');
    meta.textContent = earned ? 'Zdobyte' : 'Jeszcze nie';
    info.append(title, meta);
    li.append(info);
    list.append(li);
  }
}

// ---------- ekran startowy ----------
const RING_LENGTH = 2 * Math.PI * 100; // obwód pierścienia (r = 100 w SVG)

function renderHome() {
  const today = dayKey(Date.now());
  const todayReps = data.sessions
    .filter((s) => dayKey(s.startedAt) === today)
    .reduce((sum, s) => sum + s.reps, 0);
  $('#stat-today').textContent = todayReps;

  // Plan tygodniowy: pierścień wokół przycisku start
  const planned = weeklyPlanned();
  const done = sessionsThisWeek();
  $('#week-text').textContent = `${done} z ${planned} sesji w tym tygodniu`;
  $('#ring-fill').style.strokeDashoffset = (RING_LENGTH * (1 - Math.min(1, done / planned))).toFixed(1);

  const perDay = data.settings.sessionsPerDay;
  $('#today-text').textContent = isTrainingDayToday()
    ? `Dziś: ${sessionsToday()} z ${perDay} sesji`
    : 'Dziś dzień bez treningu';

  renderCheckup();
  renderStreak();
  renderExercise();
}

// ---------- wizyta kontrolna ----------
// W badaniu MobileS pomiary robiono w tygodniach 0, 4 i 8, więc przypomnienie co 4 tygodnie.
const CHECKUP_INTERVAL_DAYS = 28;

// Różnica w dniach między datą w formacie RRRR-MM-DD a dzisiaj.
function daysSinceDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - then) / (24 * 60 * 60 * 1000));
}

function renderCheckup() {
  const last = data.measurements.reduce((m, p) => (!m || p.date > m.date ? p : m), null);
  let text = null;

  if (!last) {
    text = 'Brak pomiaru punktu bliży zbieżności. Zmierz go linijką RAF i dodaj wynik.';
  } else {
    const days = daysSinceDateKey(last.date);
    if (days >= CHECKUP_INTERVAL_DAYS) {
      text = `Ostatni pomiar sprzed ${days} dni. Umów kontrolę u ortoptysty lub optometrysty.`;
    }
  }

  $('#checkup-card').hidden = text === null;
  if (text) $('#checkup-text').textContent = text;
}

// ---------- trening ----------
async function startTraining() {
  unlockAudio();
  const ex = exerciseOf(chosenExerciseId);
  run = {
    startedAt: Date.now(),
    durationMs: data.settings.durationSec * 1000,
    tempoMs: Math.round(
      data.settings.tempoSec * 1000 * ex.tempo
      * (ex.kind === 'focus' ? APPROACH[data.settings.approachSpeed] ?? 1 : 1)
    ),
    exercise: ex,
    reps: 0,
    lastCycle: -1,
    doubles: 0,    // ile razy naciśnięto „Widzę podwójnie”
  };

  const isFocus = ex.kind === 'focus';
  $('#train-count').textContent = '0';
  $('#stage').hidden = !ex.visual;
  $('#target').hidden = isFocus;
  $('#fixation').hidden = !isFocus;
  $('#btn-rep').hidden = isFocus;
  $('#btn-double').hidden = !isFocus;
  $('#train-hint').textContent = isFocus
    ? 'Patrz na środek. Przybliżaj na dźwięk, cofaj na kolejny.'
    : ex.visual
      ? 'Kółko rośnie: przybliżaj. Kółko maleje: cofaj.'
      : 'Rytm dźwięku: przybliżaj, potem cofaj.';
  $('#cue').textContent = 'Przybliżaj';
  show('train');

  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* opcjonalne */ }

  tick();
  timer = setInterval(tick, 200);
  if (ex.kind === 'circle') frameId = requestAnimationFrame(frame);
}

// Rozmiar kółka i podpis liczone z czasu, płynnie co klatkę.
// Faza 0..0.5 – kółko rośnie (przybliżaj), 0.5..1 – maleje (cofaj).
function frame() {
  if (!run) return;
  const tempoMs = run.tempoMs;
  const phase = ((Date.now() - run.startedAt) % tempoMs) / tempoMs;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2; // 0 → 1 → 0
  const size = 0.25 + 0.75 * t;

  $('#core').style.transform = `scale(${size.toFixed(3)})`;

  const cue = phase < 0.5 ? 'Przybliżaj' : 'Cofaj';
  const cueEl = $('#cue');
  if (cueEl.textContent !== cue) cueEl.textContent = cue;

  frameId = requestAnimationFrame(frame);
}

function tick() {
  if (!run) return;
  const elapsed = Date.now() - run.startedAt;
  const left = run.durationMs - elapsed;
  $('#train-time').textContent = fmtTime(Math.max(0, left));

  // Dźwięk na początku każdego cyklu (rytm dla telefonu i ołówka).
  const cycle = Math.floor(elapsed / run.tempoMs);
  if (cycle !== run.lastCycle) {
    run.lastCycle = cycle;
    beep();
    // Bez kółka podpis zmienia się wraz z rytmem dźwięku.
    if (run.exercise.kind !== 'circle') {
      $('#cue').textContent = cycle % 2 === 0 ? 'Przybliżaj' : 'Cofaj';
    }
    // W trybie z punktem licznik pokazuje, ile razy przybliżono telefon.
    if (run.exercise.kind === 'focus') {
      run.reps++;
      $('#train-count').textContent = run.reps;
    }
  }

  if (left <= 0) finishTraining();
}

function addRep() {
  if (!run) return;
  run.reps++;
  $('#train-count').textContent = run.reps;
  vibrate();
}

function finishTraining({ safety = false } = {}) {
  if (!run) return;
  holdCancel();
  const doubles = run.doubles || 0;
  clearInterval(timer);
  timer = null;
  cancelAnimationFrame(frameId);
  frameId = null;
  $('#core').style.transform = 'scale(0.25)';
  try { wakeLock?.release(); } catch { /* ignorujemy */ }
  wakeLock = null;

  const seconds = Math.round((Date.now() - run.startedAt) / 1000);
  const reps = run.reps;
  const saved = seconds >= MIN_SAVED_SEC;

  if (saved) {
    addSession(data, {
      id: newId(),
      startedAt: new Date(run.startedAt).toISOString(),
      durationSec: seconds,
      reps,
      tempoSec: run.tempoMs / 1000,
      exerciseId: run.exercise.id,
      stoppedForSafety: safety,
      doubleCount: doubles,
    });
  }

  run = null;
  chosenExerciseId = null; // po sesji na ekranie startowym wraca rotacja
  vibrate([80, 60, 80]);
  show('home');
  toast(saved ? `Zapisano: ${reps} powtórzeń` : 'Sesja za krótka, nie zapisano');

  // Po sesji z „Widzę podwójnie” można od razu zapisać odległość (jeśli opcja jest włączona).
  if (doubles > 0 && data.settings.askMeasurement) {
    $('#double-cm').value = '';
    $('#double').hidden = false;
    $('#double-cm').focus();
  }
}

// ---------- historia ----------
function renderHistory() {
  renderChart();
  renderNpcList();
  renderNpcChart();
  renderBadges();

  const list = $('#session-list');
  list.replaceChildren();
  const sorted = [...data.sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  $('#history-empty').hidden = sorted.length > 0;

  for (const s of sorted) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = fmtDate(s.startedAt);
    const meta = document.createElement('small');
    meta.textContent = `${exerciseOf(s.exerciseId).name} · ${s.reps} powt. · ${fmtTime(s.durationSec * 1000)}`
      + (s.stoppedForSafety ? ' · przerwano ze względów bezpieczeństwa' : '');
    info.append(title, meta);

    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = 'Usuń';
    del.addEventListener('click', () => {
      if (!confirm('Usunąć tę sesję?')) return;
      deleteSession(data, s.id);
      renderHistory();
    });

    li.append(info, del);
    list.append(li);
  }
}

function renderChart() {
  const box = $('#chart');
  box.replaceChildren();

  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dayKey(d));
  }
  const totals = Object.fromEntries(days.map((k) => [k, 0]));
  for (const s of data.sessions) {
    const k = dayKey(s.startedAt);
    if (k in totals) totals[k] += s.reps;
  }

  const max = Math.max(10, ...Object.values(totals));
  const W = 320, H = 140, pad = 12;
  const bw = (W - pad * 2) / days.length;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Wykres powtórzeń z ostatnich 14 dni' });

  days.forEach((k, i) => {
    const v = totals[k];
    const h = (v / max) * (H - 24);
    const r = svgEl('rect', {
      x: pad + i * bw + 2,
      width: bw - 4,
      y: H - 12 - h,
      height: Math.max(h, 0),
      rx: 3,
      class: 'bar',
    });
    r.appendChild(svgEl('title', {}, `${k}: ${v} powt.`));
    svg.appendChild(r);
  });

  box.appendChild(svg);
}

// Pomiary punktu bliży zbieżności (cm). Niższa wartość = punkt bliżej nosa = lepiej.
function renderNpcList() {
  const list = $('#npc-list');
  list.replaceChildren();
  const sorted = [...data.measurements].sort((a, b) => b.date.localeCompare(a.date));

  for (const m of sorted) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${m.npcCm} cm`;
    const meta = document.createElement('small');
    meta.textContent = m.date;
    info.append(title, meta);

    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = 'Usuń';
    del.addEventListener('click', () => {
      if (!confirm('Usunąć ten pomiar?')) return;
      deleteMeasurement(data, m.id);
      renderHistory();
    });

    li.append(info, del);
    list.append(li);
  }
}

function renderNpcChart() {
  const box = $('#npc-chart');
  box.replaceChildren();
  const pts = [...data.measurements].sort((a, b) => a.date.localeCompare(b.date));
  $('#npc-empty').hidden = pts.length >= 2;
  if (pts.length < 2) return;

  const W = 320, H = 180, padL = 36, padR = 12, padT = 12, padB = 28;
  const vals = pts.map((p) => p.npcCm);
  const lo = Math.floor(Math.min(...vals)) - 1;
  const hi = Math.ceil(Math.max(...vals)) + 1;
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Wykres punktu bliży zbieżności w czasie' });

  // Poziome linie pomocnicze: dolna, środkowa i górna granica.
  const mid = (lo + hi) / 2;
  for (const v of [lo, mid, hi]) {
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid' }));
    svg.appendChild(svgEl('text', { x: 4, y: y(v) + 4 }, v.toFixed(0)));
  }

  svg.appendChild(svgEl('polyline', {
    class: 'line',
    points: pts.map((p, i) => `${x(i)},${y(p.npcCm)}`).join(' '),
  }));

  pts.forEach((p, i) => {
    const c = svgEl('circle', { cx: x(i), cy: y(p.npcCm), r: 4, class: 'dot' });
    c.appendChild(svgEl('title', {}, `${p.date}: ${p.npcCm} cm`));
    svg.appendChild(c);
  });

  svg.appendChild(svgEl('text', { x: padL, y: H - 6 }, pts[0].date));
  svg.appendChild(svgEl('text', { x: W - padR, y: H - 6, 'text-anchor': 'end' }, pts[pts.length - 1].date));

  box.appendChild(svg);
}

// ---------- ustawienia ----------
function renderSettings() {
  const s = data.settings;
  $('#set-duration').value = s.durationSec / 60;
  $('#out-duration').textContent = s.durationSec / 60;
  $('#set-tempo').value = s.tempoSec;
  $('#out-tempo').textContent = s.tempoSec;
  $('#set-sound').checked = s.sound;
  $('#set-vibrate').checked = s.vibrate;
  $('#set-ask-measure').checked = !!s.askMeasurement;
  $('#set-fixation').value = s.fixationSize;
  $('#out-fixation').textContent = s.fixationSize;

  for (const cb of $$('[data-day]')) cb.checked = s.trainingDays.includes(Number(cb.dataset.day));
  for (const r of $$('input[name="sessions"]')) r.checked = Number(r.value) === s.sessionsPerDay;
}

// ---------- przypomnienia (plik .ics) ----------
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function icsLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function icsUtc(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Najbliższy termin o godzinie hh:mm w dniu treningowym, późniejszy niż "from".
function nextOccurrence(from, days, hh, mm) {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(hh, mm, 0, 0);
    if (d > from && days.includes(d.getDay())) return d;
  }
  return null;
}

function buildIcs() {
  const { trainingDays, sessionsPerDay, durationSec, tempoSec } = data.settings;
  const now = new Date();
  const byday = [1, 2, 3, 4, 5, 6, 0]
    .filter((d) => trainingDays.includes(d))
    .map((d) => ICS_DAYS[d])
    .join(',');
  const times = sessionsPerDay === 2 ? ['09:00', '19:00'] : ['09:00'];

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Konwergencja//PL', 'CALSCALE:GREGORIAN'];
  for (const time of times) {
    const [hh, mm] = time.split(':').map(Number);
    const start = nextOccurrence(now, trainingDays, hh, mm) ?? now;
    const end = new Date(start.getTime() + durationSec * 1000);
    lines.push(
      'BEGIN:VEVENT',
      `UID:konwergencja-${time.replace(':', '')}@konwergencja-app`,
      `DTSTAMP:${icsUtc(now)}`,
      `DTSTART:${icsLocal(start)}`,
      `DTEND:${icsLocal(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
      'SUMMARY:Ćwiczenie oka (konwergencja)',
      `DESCRIPTION:Sesja ${Math.round(durationSec / 60)} min, tempo ${tempoSec} s na cykl.`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Czas na ćwiczenie oka',
      'TRIGGER:-PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------- zdarzenia ----------
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => show(b.dataset.nav)));

$('#btn-start').addEventListener('click', startTraining);
$('#btn-rep').addEventListener('click', addRep);

// Widzę podwójnie: zapisz sesję i poproś o odległość w cm (ten wynik to punkt bliży zbieżności).
// „Widzę podwójnie” tylko zaznacza moment i nie kończy sesji.
$('#btn-double').addEventListener('click', () => {
  if (!run) return;
  run.doubles++;
  vibrate([40, 40, 40]);
  toast('Zaznaczono. Odsuń telefon, aż obraz się połączy.');
});

// Stop: trzeba przytrzymać przez chwilę, żeby nie zakończyć sesji przypadkiem.
const STOP_HOLD_MS = 1200;
let holdTimer = null;
const stopBtn = $('#btn-stop');

function holdCancel() {
  clearTimeout(holdTimer);
  holdTimer = null;
  stopBtn.classList.remove('holding');
}

stopBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  stopBtn.classList.add('holding');
  holdTimer = setTimeout(() => {
    holdCancel();
    finishTraining();
  }, STOP_HOLD_MS);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => stopBtn.addEventListener(ev, holdCancel));

$('#btn-back').addEventListener('click', () => finishTraining());
$('#double-skip').addEventListener('click', () => ($('#double').hidden = true));
$('#double-save').addEventListener('click', () => {
  const npcCm = Number($('#double-cm').value.replace(',', '.'));
  if (!Number.isFinite(npcCm) || npcCm <= 0 || npcCm > 100) {
    toast('Podaj wynik w cm (np. 12,5)');
    return;
  }
  addMeasurement(data, { id: newId(), date: dayKey(Date.now()), npcCm });
  $('#double').hidden = true;
  renderHome();
  toast('Zapisano pomiar');
});

$('#npc-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#npc-value').value.replace(',', '.');
  const npcCm = Number(raw);
  const date = $('#npc-date').value;
  if (!Number.isFinite(npcCm) || npcCm <= 0 || npcCm > 100) {
    toast('Podaj wynik w cm (np. 12,5)');
    return;
  }
  if (!date) {
    toast('Wybierz datę pomiaru');
    return;
  }
  addMeasurement(data, { id: newId(), date, npcCm });
  $('#npc-value').value = '';
  renderHistory();
  toast('Zapisano pomiar');
});

$('#set-duration').addEventListener('input', (e) => {
  const min = Number(e.target.value);
  $('#out-duration').textContent = min;
  updateSetting('durationSec', min * 60);
});
$('#set-tempo').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('#out-tempo').textContent = v;
  updateSetting('tempoSec', v);
});
$('#set-sound').addEventListener('change', (e) => updateSetting('sound', e.target.checked));
$('#set-vibrate').addEventListener('change', (e) => updateSetting('vibrate', e.target.checked));
$('#set-ask-measure').addEventListener('change', (e) => updateSetting('askMeasurement', e.target.checked));
$('#set-fixation').addEventListener('input', (e) => {
  const px = Number(e.target.value);
  $('#out-fixation').textContent = px;
  document.documentElement.style.setProperty('--fixation', `${px}px`);
  updateSetting('fixationSize', px);
});
// Rozmiar punktu z zapisanych ustawień (po wejściu do aplikacji).
document.documentElement.style.setProperty('--fixation', `${data.settings.fixationSize ?? 22}px`);
for (const r of $$('input[name="approach"]')) {
  r.addEventListener('change', (e) => {
    if (e.target.checked) updateSetting('approachSpeed', e.target.value);
  });
}

for (const cb of $$('[data-day]')) {
  cb.addEventListener('change', (e) => {
    const days = $$('[data-day]').filter((c) => c.checked).map((c) => Number(c.dataset.day));
    if (days.length === 0) {
      e.target.checked = true;
      toast('Wybierz co najmniej jeden dzień');
      return;
    }
    updateSetting('trainingDays', days.sort((a, b) => a - b));
  });
}

for (const r of $$('input[name="sessions"]')) {
  r.addEventListener('change', (e) => {
    if (e.target.checked) updateSetting('sessionsPerDay', Number(e.target.value));
  });
}

$('#btn-ics').addEventListener('click', () => {
  const blob = new Blob([buildIcs()], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'konwergencja-przypomnienia.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `konwergencja-${dayKey(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const result = importData(data, await file.text());
  e.target.value = '';
  toast(result.ok ? `Dodano nowych wpisów: ${result.added}` : 'Nie udało się zaimportować pliku');
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Usunąć wszystkie zapisane sesje? Pomiary i ustawienia zostaną zachowane.')) return;
  data.sessions = [];
  saveData(data);
  toast('Sesje usunięte');
});

$('#disclaimer-ok').addEventListener('click', () => {
  updateSetting('disclaimerAccepted', true);
  $('#disclaimer').hidden = true;
});
$('#btn-show-disclaimer').addEventListener('click', () => ($('#disclaimer').hidden = false));

// ---------- start ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (!data.settings.disclaimerAccepted) {
  $('#disclaimer').hidden = false;
}
show('home');
