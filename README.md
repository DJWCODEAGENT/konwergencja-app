# Trening konwergencji (PWA, Android)

Prosta aplikacja internetowa do ćwiczeń zbieżności oczu. Instaluje się na telefonie
z Androidem z poziomu Chrome, bez Google Play i bez Android Studio.

> Aplikacja nie jest wyrobem medycznym i nie diagnozuje ani nie leczy niedomogi
> konwergencji. Najpierw skonsultuj się z ortoptystą lub optometrystą.

## Co już działa (wersja 1)

- Sesja treningowa z kółkiem w rytmie (tempo do ustawienia).
- Licznik powtórzeń (przycisk „+1” po każdym pełnym przybliżeniu).
- Zapis sesji w przeglądarce (data, czas, liczba powtórzeń).
- Ekran historii: wykres z 14 dni i lista sesji z możliwością usunięcia.
- Ustawienia: długość sesji, tempo, dźwięk, wibracja.
- Eksport i import danych jako plik JSON.
- Działanie offline (service worker).

## Czego jeszcze nie ma

- Pomiar kamerą punktu bliży zbieżności. Miejsce na niego jest w `measure.js`.
- Ikony PNG (192 i 512 px). Na razie jest tylko ikona SVG.

## Pliki

| Plik | Rola |
|---|---|
| `index.html` | Struktura ekranów i informacja o bezpieczeństwie |
| `styles.css` | Wygląd, animacja kółka |
| `app.js` | Logika: trening, historia, ustawienia |
| `storage.js` | Zapis w localStorage, walidacja, import |
| `measure.js` | Stub pod przyszły pomiar kamerą |
| `sw.js` | Service worker (tryb offline) |
| `manifest.webmanifest` | Dane instalacyjne PWA |
| `icons/icon.svg` | Ikona aplikacji |

## Uruchomienie lokalne

Aplikacja wymaga `https://` albo `localhost` (service worker i blokada ekranu).
Najprościej na komputerze:

```bash
cd konwergencja-app
python3 -m http.server 8080
```

Potem otwórz `http://localhost:8080`.

## Instalacja na Androidzie

1. Wrzuć folder na hosting z HTTPS (np. GitHub Pages, Netlify) albo użyj tunelu.
2. Otwórz adres w Chrome na telefonie.
3. Menu (trzy kropki) → **Zainstaluj aplikację** (albo „Dodaj do ekranu głównego”).

## Zmiany w kodzie

- Po każdej zmianie plików podbij `CACHE` w `sw.js` (np. `konwergencja-v2`),
  inaczej telefon może pokazać starą wersję.
- Logika zapisu danych jest w `storage.js`. Nowe pola w sesji dodawaj tam
  i aktualizuj `isValidSession`.
