# Problemy do naprawienia

## 1. Dashboard nie pokazuje sesji Unassigned
**Opis:**
Dashboard nie pokazuje żadnej sesji Unassigned, a demon pokazuje np. 2.

**Kroki do reprodukcji:**
1. Zamykam oba programy (Dashboard i Demon).
2. Usuwam plik `assignment_attention.txt`.
3. Uruchamiam Dashboard -> tworzony jest plik `assignment_attention.txt` z zawartością `0`.
4. Uruchamiam demona -> automatycznie w pliku `assignment_attention.txt` zostaje zapisana wartość `2`.
5. Dashboard nadal nie pokazuje sesji Unassigned!

### Analiza problemu

**Stan faktyczny:** Demon poprawnie zapisuje `2` do pliku sygnałowego, ponieważ w JSONie widzi dwie nowe aktywności. Dashboard jednak uparcie pokazuje `0` na liście sesji.

**Kluczowe znaleziska (Przyczyny):**
1.  **Niespójne liczenie (Licznik vs Lista):** 
    *   Komenda Rust `query_unassigned_counts` (używana do sygnału w Sidebarze) robi surowe `SELECT COUNT(*) FROM sessions WHERE project_id IS NULL`. Liczy **wszystko**, nawet sekundowe "śmieci".
    *   Widok **Sessions** oraz Sidebar w JS stosują filtr `minSessionDurationSeconds`. 
    *   **Rezultat:** Krótkie sesje (np. 15s) są liczone przez sygnał (stąd `2` w trayu), ale ukrywane na liście (stąd pusta lista w dashboardzie).
2.  **Ciche Auto-Przypisywanie (Shadow Assign):**
    *   Dashboard zaraz po imporcie JSONa automatycznie odpala `AutoAiAssignment` i `DeterministicAssignment`.
    *   Jeśli sesja pasuje do reguły, zostaje przypisana w ułamku sekundy od importu. Użytkownik widzi przez moment badge, który znika, zanim zdąży wejść w sesje.
3.  **Filtracja "Monitored Apps":**
    *   Logika `upsert_daily_data` pomija aplikacje spoza listy monitorowanych. Jeśli aktywność jest "unassigned" ale dotyczy aplikacji spoza listy, nie zostanie nawet zaimportowana do SQLite.

**Kierunek naprawy:**
1.  **Ujednolicenie filtrów:** Komenda `get_unassigned_counts` w Rust musi przyjmować parametr `min_duration` i ignorować sesje krótsze niż próg ustawiony przez użytkownika. Dzięki temu licznik w trayu przestanie "kłamać".
2.  **Naprawa logiki Importu:** Sesje nieprzypisane powinny być importowane **zawsze**, niezależnie od listy monitorowanych aplikacji. Użytkownik musi widzieć, że czas ucieka, by móc podjąć decyzję o dodaniu aplikacji do monitorowanych lub jej zignorowaniu.
### Szkice techniczne poprawek

#### 1. Ujednolicenie licznika (Rust)
W pliku `dashboard\src-tauri\src\commands\daemon.rs` zmodyfikujemy funkcje tak, by przyjmowały próg czasu:

```rust
// query_unassigned_counts(app, min_duration_sec)
conn.query_row(
    "SELECT COUNT(*) FROM sessions s 
     WHERE (s.is_hidden IS NULL OR s.is_hidden = 0) 
     AND s.project_id IS NULL 
     AND s.duration_seconds >= ?1",
    [min_duration_sec],
    // ...
)
```

#### 2. Naprawa logiki Importu (Rust)
W pliku `dashboard\src-tauri\src\commands\import.rs` (lub `import_data.rs`):
Zmieniamy warunek pomijania aplikacji. Zamiast:
`if !monitored.contains(exe) { continue; }`
Robimy:
`if !monitored.contains(exe) && session.project_id.is_some() { continue; }`
*(Dzięki temu sesje nieprzypisane wchodzą zawsze, by użytkownik mógł je zobaczyć).*

#### 3. Frontend - Synchronizacja (JS/TS)
W `Sidebar.tsx` przy wywołaniu `getDaemonStatus()` przesyłamy próg z ustawień:
```typescript
const settings = loadSessionSettings();
getDaemonStatus({ minDuration: settings.minSessionDurationSeconds })
```

#### 4. Ochrona przed nadpisywaniem sygnału
W `daemon.rs` zmieniamy logikę `get_daemon_status`:
* Dashboard powinien pisać do `assignment_attention.txt` **tylko** jeśli liczba sesji spadła do 0.
## 2. Duplikacja funkcjonalności odmrażania i błędne użycie ikony płomienia

**Opis:**
W widoku projektów (Projects.tsx), gdy projekt jest zamrożony, pojawiają się dwie metody jego odmrożenia:
1.  Kliknięcie w badge "Frozen" z ikoną płatka śniegu (`Snowflake`).
2.  Kliknięcie w dedykowany przycisk akcji z ikoną płomienia (`Flame`).
Jest to zbędna duplikacja. Dodatkowo ikona płomienia powinna mieć zupełnie inne znaczenie.

### Analiza problemu
*   Ikona płomienia (`Flame`) jest obecnie używana technicznie jako przeciwieństwo płatka śniegu, co jest mylące i duplikuje funkcjonalność badge'a.
*   Brak wizualnego wyróżnienia projektów, na które użytkownik poświęca najwięcej czasu ("hot projects").

### Kierunek naprawy
1.  **Usunięcie przycisku Flame z akcji projektu:** Przycisk akcji dla zamrożonego projektu powinien zostać zmieniony lub usunięty na rzecz spójnego używania ikony `Snowflake` (np. niebieski Snowflake dla zamrożonego, szary dla aktywnego).
2.  **Nowe przeznaczenie Flame:** Ikona płomienia ma służyć do oznaczania "najgorętszych" projektów.
    *   Kolor: czerwony.
    *   Zasada: Wyświetlana przy nazwie projektu dla **TOP 5** projektów z największą ilością czasu (total_seconds).
    *   Widoki: Zarówno w trybie `detailed` jak i `compact`.

### Szkice techniczne poprawek (Projects.tsx)
*   Wyliczenie TOP 5 projektów: `const hotProjectIds = useMemo(() => projects.slice(0, 5).map(p => p.id), [projects]);` (zakładając że projekty są już posortowane po czasie).
*   Dodanie ikony w renderowaniu:
    ```tsx
    {hotProjectIds.includes(p.id) && <Flame className="h-4 w-4 text-red-500 fill-red-500" title="Hot project" />}
    ```
