import { loadData, saveData, addSession, deleteSession, importData, DEFAULTS } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const MIN_SAVED_SEC = 10; // krótsze sesje nie są zapisywane

let data = loadData();
let run = null;       // aktywna sesja treningowa
let timer = null;     // interwał odświeżania ekranu treningu
let wakeLock = null;  // blokada wygaszania ekranu
let audioCtx = null;

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

// ---------- ekran startowy ----------
function renderHome() {
  const now = Date.now();
  const today = dayKey(now);
  const sessions = data.sessions;

  const todayReps = sessions
    .filter((s) => dayKey(s.startedAt) === today)
    .reduce((sum, s) => sum + s.reps, 0);
  const weekCount = sessions.filter(
    (s) => now - Date.parse(s.startedAt) < 7 * 24 * 60 * 60 * 1000
  ).length;
  const last = sessions.reduce((m, s) => (!m || s.startedAt > m.startedAt ? s : m), null);

  $('#stat-today').textContent = todayReps;
  $('#stat-week').textContent = weekCount;
  $('#stat-last').textContent = last
    ? `Ostatnia sesja: ${fmtDate(last.startedAt)}`
    : 'Jeszcze nie ćwiczyłeś. Zacznij od krótkiej sesji.';
}

// ---------- trening ----------
async function startTraining() {
  unlockAudio();
  run = {
    startedAt: Date.now(),
    durationMs: data.settings.durationSec * 1000,
    reps: 0,
    lastCycle: -1,
  };

  const target = $('#target');
  target.style.setProperty('--tempo', `${data.settings.tempoSec}s`);
  target.classList.add('animating');
  $('#train-count').textContent = '0';
  show('train');

  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* opcjonalne */ }

  tick();
  timer = setInterval(tick, 200);
}

function tick() {
  if (!run) return;
  const elapsed = Date.now() - run.startedAt;
  const left = run.durationMs - elapsed;
  $('#train-time').textContent = fmtTime(Math.max(0, left));

  // Dźwięk na początku każdego cyklu (rytm dla telefonu i ołówka).
  const cycle = Math.floor(elapsed / (data.settings.tempoSec * 1000));
  if (cycle !== run.lastCycle) {
    run.lastCycle = cycle;
    beep();
  }

  if (left <= 0) finishTraining();
}

function addRep() {
  if (!run) return;
  run.reps++;
  $('#train-count').textContent = run.reps;
  vibrate();
}

function finishTraining() {
  if (!run) return;
  clearInterval(timer);
  timer = null;
  try { wakeLock?.release(); } catch { /* ignorujemy */ }
  wakeLock = null;
  $('#target').classList.remove('animating');

  const seconds = Math.round((Date.now() - run.startedAt) / 1000);
  const reps = run.reps;
  const saved = seconds >= MIN_SAVED_SEC;

  if (saved) {
    addSession(data, {
      id: newId(),
      startedAt: new Date(run.startedAt).toISOString(),
      durationSec: seconds,
      reps,
      tempoSec: data.settings.tempoSec,
    });
  }

  run = null;
  vibrate([80, 60, 80]);
  show('home');
  toast(saved ? `Zapisano: ${reps} powtórzeń` : 'Sesja za krótka, nie zapisano');
}

// ---------- historia ----------
function renderHistory() {
  renderChart();

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
    meta.textContent = `${s.reps} powt. · ${fmtTime(s.durationSec * 1000)}`;
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
  const NS = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Wykres powtórzeń z ostatnich 14 dni');

  days.forEach((k, i) => {
    const v = totals[k];
    const h = (v / max) * (H - 24);
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', pad + i * bw + 2);
    r.setAttribute('width', bw - 4);
    r.setAttribute('y', H - 12 - h);
    r.setAttribute('height', Math.max(h, 0));
    r.setAttribute('rx', 3);
    r.setAttribute('class', 'bar');
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${k}: ${v} powt.`;
    r.appendChild(title);
    svg.appendChild(r);
  });

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
}

// ---------- zdarzenia ----------
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => show(b.dataset.nav)));

$('#btn-start').addEventListener('click', startTraining);
$('#btn-rep').addEventListener('click', addRep);
$('#btn-stop').addEventListener('click', finishTraining);

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
  toast(result.ok ? `Dodano nowych sesji: ${result.added}` : 'Nie udało się zaimportować pliku');
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Usunąć wszystkie zapisane sesje? Ustawienia zostaną zachowane.')) return;
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
