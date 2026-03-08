# Remaining Work

Data aktualizacji: 2026-03-08

Ten dokument zbiera tylko to, co realnie zostało jeszcze do zrobienia po wdrożeniach opisanych w `raport.md`.

## Otwarte tematy

### 1. Dalsze wygaszanie `inline.*`

Warstwa `inline.*` została już mocno ograniczona, ale nadal występuje w największych widokach:

- `dashboard/src/pages/Projects.tsx`
- `dashboard/src/pages/ProjectPage.tsx`
- `dashboard/src/components/dashboard/ProjectDayTimeline.tsx`
- `dashboard/src/pages/Settings.tsx`
- `dashboard/src/pages/AI.tsx`
- `dashboard/src/pages/ReportView.tsx`
- `dashboard/src/pages/Help.tsx`
- `dashboard/src/components/data/DatabaseManagement.tsx`

Zakres dalszej pracy:

- przenoszenie tekstów z `createInlineTranslator(...)` na jawne klucze `i18next`
- grupowanie nowych kluczy per domena ekranu zamiast dalszego rozrostu `inline.*`
- ponowne uruchamianie `npm run sync:inline-i18n`, aby usuwać wpisy legacy po każdej turze

Najtrudniejsze technicznie miejsca:

- `ProjectDayTimeline.tsx`
- `ProjectPage.tsx`
- `Projects.tsx`

Najłatwiejsze do kolejnej tury:

- `DatabaseManagement.tsx`
- `AI.tsx`
- `ReportView.tsx`

### 2. Testy komponentów i e2e

Frontend ma już podstawowe testy jednostkowe (`Vitest`), ale nadal brakuje:

- testów komponentów dla kluczowych ekranów i dialogów
- testów integracyjnych dla głównych flow użytkownika
- testów e2e dla regresji po zmianach w synchronizacji, imporcie i przypisaniach sesji

Minimalny sensowny zakres:

- `Data`:
  - import pliku
  - eksport danych
  - historia / archiwum
- `Projects`:
  - wejście do karty projektu
  - podstawowe akcje na projekcie
- `Sessions` / timeline:
  - przypisanie sesji
  - komentarz
  - mnożnik
- `Settings`:
  - zapis ustawień
  - przełączanie demo mode

Rekomendowane narzędzia:

- `Vitest` + testy komponentów tam, gdzie da się łatwo izolować UI
- `Playwright` dla przepływów end-to-end

## Rekomendowana kolejność

1. `DatabaseManagement.tsx`, `AI.tsx`, `ReportView.tsx`
2. `Settings.tsx`
3. `Projects.tsx`
4. `ProjectPage.tsx`
5. `ProjectDayTimeline.tsx`
6. testy komponentów
7. testy e2e

## Kryterium zakończenia

Temat można uznać za domknięty, gdy:

- w `dashboard/src` nie zostaną już użycia `createInlineTranslator(...)` poza ewentualnym helperem technicznym
- `npm run sync:inline-i18n` nie będzie już utrzymywał dużej sekcji legacy
- istnieć będzie co najmniej podstawowy zestaw testów komponentów i e2e dla głównych flow
