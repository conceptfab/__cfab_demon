# Odzyskiwanie ukrytych sesji TIMEFLOW — instrukcja

Dotyczy: `scripts/recover_hidden_sessions.py`

## Co to naprawia

Historyczny bug gubił czas przy każdym restarcie dashboardu: rebuild scalał
sąsiednie sesje (scalone oznaczał `is_hidden=1`, czas doliczał do sesji-bazy),
a chwilę później odświeżanie importu **cofało doliczony czas**, podczas gdy
scalone sesje pozostawały ukryte. Efekt: czas "znikał" z widoków, choć fizycznie
nigdy nie był kasowany — siedzi w bazie jako ukryte sesje.

Bug naprawiony w buildzie z commita `198f662` (upsert extend-only). Skrypt
odkrywa ukryte sesje, żeby naprawiony rebuild mógł je ponownie scalić — tym
razem z trwale zachowanym czasem.

Skala (stan na 2026-06-10, baza Windows): ~627 ukrytych sesji, ~255 h.

## Wymagania

- **Build TIMEFLOW z commita `198f662` lub nowszy** — na KAŻDEJ maszynie,
  na której odzyskujesz. Bez tego pierwszy restart po odzyskaniu zgubi
  bieżący dzień ponownie (stary upsert znowu cofnie doliczony czas).
- Python 3.9+ (na macOS jest systemowy; na Windows: `python --version`
  w PowerShell — jeśli brak, zainstaluj ze sklepu Microsoft lub python.org).
- Zamknięty TIMEFLOW (dashboard **i** daemon).

## Procedura — krok po kroku

Wykonaj na każdej maszynie osobno (Windows i macOS mają własne bazy).

### 1. Wgraj nowy build

Zbuduj ze `stable` (>= `198f662`) i zainstaluj. Sprawdź wersję w aplikacji
przed dalszymi krokami.

### 2. Zamknij TIMEFLOW całkowicie

- Dashboard: zamknij okno.
- Daemon: ikona w tray → zakończ.
- Skrypt sam to zweryfikuje i odmówi działania, jeśli coś jeszcze chodzi.

### 3. Uruchom skrypt

**Windows (PowerShell):**
```powershell
python .\recover_hidden_sessions.py
```

**macOS (Terminal):**
```bash
python3 ./recover_hidden_sessions.py
```

Tylko jeden dzień zamiast całej historii:
```
python3 ./recover_hidden_sessions.py --date 2026-06-10
```

Skrypt automatycznie:
1. znajduje bazę (`%APPDATA%\TimeFlow\timeflow_dashboard.db` /
   `~/Library/Application Support/TimeFlow/timeflow_dashboard.db`),
2. robi **backup na Pulpit** (katalog `timeflow_backup_<data_godzina>`,
   pliki db + -wal + -shm),
3. odkrywa ukryte sesje i wypisuje ile odzyskał, np.:
   `Odkryto sesji: 627 (~255.7 h, filtr: cała historia)`.

Drugie uruchomienie wypisze `Brak ukrytych sesji` — to poprawne (idempotencja).

### 4. Uruchom TIMEFLOW

Rebuild przy starcie ponownie scali odkryte łańcuchy sesji i doliczy ich czas
na stałe. Jeśli tuż po starcie sumy na liście sesji wyglądają na chwilowo
zawyżone — to stan przejściowy do zakończenia pierwszego rebuildu; widoki
czasu (dzień/projekt) liczą unię interwałów i nie podwajają.

### 5. Zweryfikuj

- Dzień incydentu (2026-06-10): Metro_PAGE powinno pokazywać ~3:49 zamiast ~1:31.
- Miesiące historyczne wyraźnie w górę (np. maj 2026: +kilkadziesiąt godzin).
- Backup z Pulpitu trzymaj do czasu, aż uznasz dane za poprawne.

## Przywracanie z backupu (gdyby coś poszło nie tak)

1. Zamknij TIMEFLOW (dashboard + daemon).
2. Skopiuj WSZYSTKIE pliki z katalogu backupu z powrotem do katalogu bazy,
   nadpisując (`timeflow_dashboard.db`, `…-wal`, `…-shm` jeśli były).
3. Uruchom TIMEFLOW.

## Znane efekty uboczne / FAQ

**Wróciły sesje, które kiedyś skasowałem ręcznie w UI.**
Tak — ręczne kasowanie używa tego samego mechanizmu ukrywania (`is_hidden=1`)
i w danych nie da się go odróżnić od ukrycia przez bug. Skasuj je ponownie.

**Skrypt mówi "TIMEFLOW działa", choć zamknąłem okno.**
Daemon dalej chodzi w tle — zakończ go z ikony w tray (lub w ostateczności
Menedżer zadań / `pkill timeflow-demon`).

**Chcę przećwiczyć na kopii bazy.**
`python3 recover_hidden_sessions.py --db /sciezka/do/kopii.db` — przy jawnym
`--db` skrypt pomija kontrolę procesów i nie dotyka prawdziwej bazy.

**Czy to ruszy sesje podzielone (split) albo ręczne?**
Nie. Skrypt zmienia wyłącznie flagę `is_hidden` w tabeli `sessions`;
`manual_sessions` i mechanika splitów pozostają nietknięte.
