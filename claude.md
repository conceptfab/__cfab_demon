# TIMEFLOW — instrukcje projektu (CLAUDE.md)

## 1) Język i styl pracy
- Komunikuj się po polsku.
- Pisz zwięźle i precyzyjnie (bez długich wstępów).
- Gdy zmiana dotyka >2 plików lub niesie ryzyko regresji: najpierw plan w max 5 punktach, potem implementacja.
- Jeśli brakuje kluczowych danych (ścieżki, API, wymagania): zadaj maks. 3 pytania doprecyzowujące i wstrzymaj implementację.

## 2) Zasady produktu i brandingu
- Nazwa produktu w UI, komunikatach, tytułach, logach aplikacji: zawsze `TIMEFLOW` (wielkie litery).
- Nie refaktoruj identyfikatorów w kodzie tylko po to, by wymusić `TIMEFLOW` (zmienne/pliki trzymają się konwencji repo).
- Terminologia: używaj spójnych nazw funkcji/pojęć w całej aplikacji (UI + Help + komunikaty).

## 3) Dokumentacja: panel pomocy (Help.tsx) — obowiązkowe
Definicja „nowej funkcji” (wymaga aktualizacji Help.tsx):
- Nowy ekran / nowa sekcja UI.
- Nowa opcja/ustawienie lub nowy tryb działania.
- Nowy endpoint / nowy background job / nowy typ danych, który użytkownik odczuwa.
- Zmiana zachowania istniejącej funkcji (nawet bez zmiany UI), jeśli wpływa na użytkownika.

Zasady aktualizacji Help.tsx:
- Aktualizuj Help.tsx w tym samym PR/commicie co funkcję.
- Teksty mają być: krótkie, konkretne, zorientowane na użytkownika końcowego (bez żargonu implementacyjnego).
- Opis powinien zawierać: „co to robi”, „kiedy użyć”, „jakie ma ograniczenia/konsekwencje” (jeśli dotyczy).
- Utrzymuj spójny format i kolejność sekcji (nie mieszaj stylów).
- Jeśli funkcja ma parametry/ustawienia: opisz je listą z krótkim wyjaśnieniem.

Checklist (przed zakończeniem zadania z nową funkcją):
- [ ] Implementacja działa.
- [ ] Help.tsx zaktualizowany.
- [ ] Terminologia spójna (UI/Help/logi).
- [ ] Brak zbędnych zmian stylistycznych w niepowiązanych plikach.

## 4) Standardy zmian w kodzie
- Minimalizuj zakres: nie rób „przy okazji” refaktorów bez uzasadnienia.
- Zachowuj kompatybilność wstecz, chyba że jawnie poproszono o breaking change.
- Preferuj małe, czytelne kroki i jasne nazwy.
- Nie dodawaj zależności bez powodu; jeśli dodajesz, uzasadnij (1 zdanie) i upewnij się, że jest używana.
- Nie wprowadzaj sekretów/kluczy do repo (żadnych tokenów, haseł, URL-i z kredencjałami).
- Jeśli dotykasz UI: dbaj o stany (loading/empty/error) tam gdzie ma to sens.
- Jeśli dotykasz logiki: dodaj/aktualizuj testy lub chociaż opisz scenariusze manualne (gdy testów brak).

## 5) Uruchamianie, testy i komendy (uzupełnij w repo)
Wklej tutaj realne komendy dla projektu (Claude ma je wykonywać/zakładać):

- Instalacja: `<npm|pnpm|bun> install`
- Dev: `<...>`
- Build: `<...>`
- Test: `<...>`
- Lint/format: `<...>`

Zasada:
- Przed zakończeniem zadania: uruchom (lub załóż uruchomienie) linta i testy, jeśli są skonfigurowane.
- Gdy nie da się uruchomić komend w środowisku: wypisz dokładnie, co należy uruchomić lokalnie i jakiego wyniku oczekujesz.

## Format odpowiedzi (gdy prosisz o zmianę w kodzie)
- 1–2 zdania: co zmieniasz i dlaczego.
- Lista plików, które zmieniasz (jeśli >1).
- Kroki testu: jak sprawdzić (manualnie lub testami).