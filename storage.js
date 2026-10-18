// Zapis danych w localStorage. Wszystko zostaje na urządzeniu.

const KEY = 'konwergencja.v1';

export const DEFAULTS = {
  durationSec: 180,        // długość sesji: 3 minuty
  tempoSec: 4,             // jeden pełny cykl (przybliżenie + cofnięcie)
  sound: true,
  vibrate: true,
  disclaimerAccepted: false,
};

function emptyData() {
  return { version: 1, settings: { ...DEFAULTS }, sessions: [] };
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

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      settings: { ...DEFAULTS, ...(parsed.settings || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter(isValidSession) : [],
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

// Dołącza sesje z pliku JSON (bez duplikatów po id). Zwraca liczbę dodanych.
export function importData(data, text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, added: 0 };
  }
  if (!parsed || !Array.isArray(parsed.sessions)) return { ok: false, added: 0 };

  const known = new Set(data.sessions.map((s) => s.id));
  let added = 0;
  for (const s of parsed.sessions) {
    if (isValidSession(s) && !known.has(s.id)) {
      data.sessions.push(s);
      known.add(s.id);
      added++;
    }
  }
  saveData(data);
  return { ok: true, added };
}
