// Ruchy gałek: higiena oka. Nie jest to trening konwergencji.
// Ruch w 8 kierunków, każdy 4 razy: wyjście z centrum, mrugnięcie, powrót, mrugnięcie.

const $ = (sel) => document.querySelector(sel);

// Tryb szybki to dotychczasowe tempo, normalny i wolny są wolniejsze.
const BASE_MS = { move: 450, hold: 350, blink: 300 };
const MODE_FACTOR = { szybki: 1, normalny: 1.5, wolny: 2 };
let MOVE_MS = BASE_MS.move;   // czas ruchu gałki
let HOLD_MS = BASE_MS.hold;   // chwila zatrzymania w punkcie
let BLINK_MS = BASE_MS.blink; // mrugnięcie
let STEP_MS = MOVE_MS + HOLD_MS + BLINK_MS;

function setMode(mode) {
  const f = MODE_FACTOR[mode] ?? 1;
  MOVE_MS = Math.round(BASE_MS.move * f);
  HOLD_MS = Math.round(BASE_MS.hold * f);
  BLINK_MS = Math.round(BASE_MS.blink * f);
  STEP_MS = MOVE_MS + HOLD_MS + BLINK_MS;
}
const MAX_X = 70;      // maksymalne przesunięcie tęczówki w poziomie (px SVG)
const MAX_Y = 30;      // maksymalne przesunięcie tęczówki w pionie (px SVG)

const CENTER = [0, 0];
const DIRS = {
  right: [0.8, 0], left: [-0.8, 0], up: [0, -0.8], down: [0, 0.8],
  ul: [-0.6, -0.6], ur: [0.6, -0.6], dl: [-0.6, 0.6], dr: [0.6, 0.6],
};
const ORDER = ['right', 'left', 'up', 'down', 'ul', 'ur', 'dl', 'dr'];
const LABELS = {
  center: 'Środek',
  right: 'W prawo', left: 'W lewo', up: 'W górę', down: 'W dół',
  ul: 'W lewą górę', ur: 'W prawą górę', dl: 'W lewy dół', dr: 'W prawy dół',
};

// Jeden obieg: środek, kierunek, środek, kolejny kierunek... (każdy kierunek raz).
const SEQUENCE = [];
for (const dir of ORDER) {
  SEQUENCE.push({ dir: 'center', to: CENTER });
  SEQUENCE.push({ dir, to: DIRS[dir] });
}

let frameId = null;
let endAt = 0;          // koniec ćwiczenia (czas performance.now)
let idx = -1;           // indeks aktualnego kroku w sekwencji
let stepStart = -Infinity;
let from = CENTER;      // skąd gałka rusza w tym kroku
let pos = CENTER;       // aktualna pozycja gałki
let cycles = 0;         // ile pełnych obiegów sekwencji
let blinkBuzzed = false;
let minutes = 3;
let vibrateOn = true;
let wakeLock = null;

const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function vibrate(pattern) {
  if (vibrateOn) navigator.vibrate?.(pattern);
}

// Ustawia tęczówkę (kierunek patrzenia) i powieki (mrugnięcie: 0 = otwarte, 1 = zamknięte).
function draw(p, blink) {
  $('#gaze').setAttribute('transform', `translate(${(p[0] * MAX_X).toFixed(1)} ${(p[1] * MAX_Y).toFixed(1)})`);
  const h = 100 * blink;
  $('#lid-top').setAttribute('height', h.toFixed(1));
  $('#lid-bottom').setAttribute('y', (200 - h).toFixed(1));
  $('#lid-bottom').setAttribute('height', h.toFixed(1));
}

function startStep(step) {
  $('#r-cue').textContent = LABELS[step.dir];
  $('#r-step').textContent = `Krok ${idx + 1} z ${SEQUENCE.length}`;
  $('#r-info').textContent = `Obieg ${cycles + 1}`;
  vibrate(20); // krótki impuls na start ruchu
}

function frame(now) {
  if (now >= endAt) return finish(true);

  if (now - stepStart >= STEP_MS) {
    from = pos;
    idx = (idx + 1) % SEQUENCE.length;
    if (idx === 0 && stepStart !== -Infinity) cycles++;
    stepStart = now;
    blinkBuzzed = false;
    startStep(SEQUENCE[idx]);
  }

  const t = now - stepStart;
  const step = SEQUENCE[idx];
  const move = easeInOut(Math.min(1, t / MOVE_MS));
  pos = [
    from[0] + (step.to[0] - from[0]) * move,
    from[1] + (step.to[1] - from[1]) * move,
  ];

  let blink = 0;
  const blinkStart = MOVE_MS + HOLD_MS;
  if (t >= blinkStart) {
    blink = Math.sin(Math.PI * Math.min(1, (t - blinkStart) / BLINK_MS));
    if (!blinkBuzzed) {
      blinkBuzzed = true;
      vibrate(60); // mocniejszy impuls przy mrugnięciu
    }
  }

  draw(pos, blink);
  $('#r-time').textContent = fmt(endAt - now);
  frameId = requestAnimationFrame(frame);
}

async function start() {
  minutes = Number($('#set-minutes').value);
  vibrateOn = $('#set-vibrate').checked;
  setMode($('input[name="mode"]:checked').value);
  idx = -1;
  stepStart = -Infinity;
  from = CENTER;
  pos = CENTER;
  cycles = 0;
  endAt = performance.now() + minutes * 60000;

  $('#setup').hidden = true;
  $('#done').hidden = true;
  $('#run').hidden = false;
  $('#r-time').textContent = fmt(minutes * 60000);
  draw(CENTER, 0);

  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* opcjonalne */ }

  frameId = requestAnimationFrame(frame);
}

function finish(completed) {
  cancelAnimationFrame(frameId);
  frameId = null;
  try { wakeLock?.release(); } catch { /* ignorujemy */ }
  wakeLock = null;

  draw(CENTER, 0);
  $('#run').hidden = true;
  $('#setup').hidden = false;
  $('#done').hidden = false;
  $('#done').textContent = completed
    ? `Gotowe: ${minutes} min ćwiczenia ruchu gałek. Odpocznij chwilę i mrugaj swobodnie.`
    : 'Przerwano ćwiczenie.';
  vibrate(completed ? [200, 100, 200] : 40);
}

$('#set-minutes').addEventListener('input', (e) => {
  $('#out-minutes').textContent = e.target.value;
});
$('#btn-start').addEventListener('click', start);
$('#btn-stop').addEventListener('click', () => finish(false));

draw(CENTER, 0);
