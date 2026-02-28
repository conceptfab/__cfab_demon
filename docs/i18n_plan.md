# Plan wdrożenia i18n w TIMEFLOW

Dokument opisuje plan i kolejność migracji UI do pełnego systemu tłumaczeń.

## 0. Ustalenia (2026-02-28)
- Globalny język aplikacji jest ustawiany wyłącznie w `Settings`.
- Ustawienie języka jest trwałe (`localStorage`: `timeflow.settings.language`).
- `Help` i `QuickStart` korzystają z języka globalnego, bez lokalnych przełączników.
- Obecny rollout i18n obejmuje fundament + `Help` + `QuickStart`; pozostałe widoki migrujemy etapowo.

## 1. Cel
- Ujednolicić tłumaczenia w całej aplikacji dashboard.
- Sterować językiem z jednego miejsca: `Settings`.
- Utrzymać spójność nazw i brandingu (`TIMEFLOW`).

## 2. Co jest już wdrożone
- Konfiguracja i18n oparta o `i18next` + `react-i18next`.
- Inicjalizacja w `dashboard/src/i18n.ts` oraz import w `dashboard/src/main.tsx`.
- Struktura locale:
  - `dashboard/src/locales/en/common.json`
  - `dashboard/src/locales/pl/common.json`
- Persist języka w ustawieniach użytkownika (`timeflow.settings.language`).
- Przełącznik języka dodany do strony `Settings`.
- Zakładki `Help` i `QuickStart` korzystają z globalnego języka ustawianego w `Settings`.

## 3. Docelowa architektura kluczy
- `layout.*`: Sidebar, TopBar, elementy wspólne.
- `dashboard.*`: dashboard i metryki.
- `sessions.*`: lista sesji i menu kontekstowe.
- `projects.*`: projekty, akcje i dialogi.
- `settings.*`: ustawienia (w tym język).
- `help.*`: zakładka pomocy.
- `quickstart.*`: onboarding i samouczek.
- `ui.*`: generyczne etykiety i przyciski.

## 4. Plan etapów

### Etap A: Fundament (zrealizowany)
1. Instalacja bibliotek i18n.
2. Dodanie plików locale oraz namespace `common`.
3. Dodanie ustawienia języka w `Settings` i zapis do `localStorage`.
4. Podłączenie `Help` i `QuickStart` pod globalny język.

### Etap B: Migracja krytycznych widoków
1. Migracja `Sidebar`, `TopBar`, `Dashboard`, `Sessions`.
2. Przeniesienie stringów z `docs/strings.md` do kluczy i18n.
3. Standaryzacja komunikatów alert/toast.

### Etap C: Migracja pozostałych modułów
1. `Projects`, `Estimates`, `Applications`, `Data`, `Daemon`, `AI`.
2. Dialogi i komponenty wspólne (`ManualSessionDialog`, `prompt-modal`, itp.).
3. Porządki kluczy i usunięcie hardcoded stringów.

### Etap D: Stabilizacja jakości
1. Audyt brakujących kluczy i fallbacków.
2. Przegląd długości tekstów (PL/EN) pod responsywność.
3. Testy manualne przepięcia języka bez restartu aplikacji.

## 5. Zasady implementacyjne
- Każdy nowy tekst UI ma powstawać od razu jako klucz i18n.
- Fallback języka: `en`.
- Przełącznik języka pozostaje wyłącznie w `Settings`.
- `Help.tsx` i `QuickStart.tsx` muszą być aktualizowane przy każdej zmianie UX onboardingu.
