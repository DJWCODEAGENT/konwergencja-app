// Miejsce na przyszły moduł pomiaru kamerą (punkt bliży zbieżności, NPC).
// Na razie nie jest używany. Wersja z kamerą będzie podłączona tutaj,
// bez zmian w reszcie aplikacji.

export const cameraMeasurementAvailable = false;

export async function measureNPC() {
  throw new Error('Pomiar kamerą nie jest jeszcze dostępny.');
}
