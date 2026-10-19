// Zapis danych w localStorage. Wszystko zostaje na urządzeniu.

const KEY = 'konwergencja.v1';

export const DEFAULTS = {
  durationSec: 180,               // długość sesji: 3 minuty
  tempoSec: 4,                    // jeden pełny cykl (przybliżenie + cofnięcie)
  sound: true,
  vibrate: true,
  disclaimerAccepted: false,
  trainingDays: [1, 2, 4, 5],     // dni treningowe: 0 = niedziela ... 6 = sobota
  sessionsPerDay: 2,              // 1 lub 2 sesje dziennie (wyznacza godziny przypomnień)
  approachSpeed: 'szybki',        // tempo przybliżania w trybie „Ołówek na telefonie”: wolny, normalny, szybki
  askMeasurement: false,          // pytać o odległość po „Widzę podwójnie” (domyślnie nie)
};

function emptyData() {
  return {
    version: 1,
    settings: { ...DEFAULTS, trainingDays: [...DEFAULTS.trainingDays] },
    sessions: [],
    measurements: [],
  };
}

export function isValidSession(s) {
  return (
    s &&
    typeof s.id === 'string' &&
    typeof s.startedAt === 'string' &&
    !Number.isNaN(Date.parse(s.startedAt)) &&
    Number.isFinite(s.reps) && s.reps >= 0 &&
    Number.isFinite(s.durationSec) && s.durationSec >= 0
  );
}

// Pomiar punktu bliży zbieżności z linijki RAF (w cm).
export function isValidMeasurement(m) {
  return (
    m &&
    typeof m.id === 'string' &&
    typeof m.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(m.date) &&
    Number.isFinite(m.npcCm) && m.npcCm > 0 && m.npcCm <= 100
  );
}

function sanitizeSettings(raw) {
  const s = { ...DEFAULTS, ...raw };
  const days = Array.isArray(s.trainingDays)
    ? [...new Set(s.trainingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [];
  s.trainingDays = days.length ? days : [...DEFAULTS.trainingDays];
  s.sessionsPerDay = [1, 2].includes(s.sessionsPerDay) ? s.sessionsPerDay : DEFAULTS.sessionsPerDay;
  return s;
}

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      settings: sanitizeSettings(parsed.settings || {}),
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isValidSession) : [],
      measurements: Array.isArray(parsed.measurements)
        ? parsed.measurements.filter(isValidMeasurement)
        : [],
    };
  } catch {
    return emptyData();
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // np. zapełniona pamięć lub tryb prywatny
  }
}

export function addSession(data, session) {
  data.sessions.push(session);
  saveData(data);
}

export function deleteSession(data, id) {
  data.sessions = data.sessions.filter((s) => s.id !== id);
  saveData(data);
}

export function addMeasurement(data, measurement) {
  data.measurements.push(measurement);
  saveData(data);
}

export function deleteMeasurement(data, id) {
  data.measurements = data.measurements.filter((m) => m.id !== id);
  saveData(data);
}

// Dołącza sesje i pomiary z pliku JSON (bez duplikatów po id).
export function importData(data, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, added: 0 };
  }
  if (!parsed || !Array.isArray(parsed.sessions)) return { ok: false, added: 0 };

  let added = 0;

  const knownSessions = new Set(data.sessions.map((s) => s.id));
  for (const s of parsed.sessions) {
    if (isValidSession(s) && !knownSessions.has(s.id)) {
      data.sessions.push(s);
      knownSessions.add(s.id);
      added++;
    }
  }

  const knownMeasurements = new Set(data.measurements.map((m) => m.id));
  for (const m of Array.isArray(parsed.measurements) ? parsed.measurements : []) {
    if (isValidMeasurement(m) && !knownMeasurements.has(m.id)) {
      data.measurements.push(m);
      knownMeasurements.add(m.id);
      added++;
    }
  }

  saveData(data);
  return { ok: true, added };
}
