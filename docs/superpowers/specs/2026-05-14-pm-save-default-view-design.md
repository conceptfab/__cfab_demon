# Spec: Zapis domyślnego widoku na ekranie PM

Data: 2026-05-14
Status: zatwierdzony do implementacji

## Problem

Ekran PM (`dashboard/src/components/pm/PmProjectsList.tsx`) obecnie **auto-zapisuje**
filtry i sortowanie po cichu przez `usePersistedState` — każda zmiana jest natychmiast
utrwalana. Inne ekrany (Projects) mają zamiast tego **jawny przycisk dyskietki**
„zapisz widok jako domyślny" z potwierdzeniem (toast). Użytkownik chce tej samej,
spójnej kontroli na ekranie PM.

## Cel

Zastąpić auto-zapis na ekranie PM modelem jawnego zapisu, jak na ekranie Projects:

1. Zmiany filtrów/sortowania **nie są** utrwalane automatycznie — żyją tylko w pamięci.
2. Przycisk dyskietki w toolbarze listy PM zapisuje bieżący widok jako domyślny.
3. Po kliknięciu pojawia się toast potwierdzający (3 s).
4. Przy ponownym otwarciu ekranu przywracany jest ostatnio **zapisany** widok.

## Decyzje projektowe

- **Podejście A** (lustrzane do ekranu Projects) — logika lokalna w obrębie listy PM,
  bez uogólniania na inne ekrany (YAGNI).
- **Zakres zapisywanego widoku:** rok, klient, status, pole sortowania, kierunek
  sortowania. Pole „Szukaj" pozostaje ulotne — nigdy nie zapisywane.
- **Reużycie istniejących kluczy localStorage** (`timeflow-pm-filter-year`,
  `timeflow-pm-filter-client`, `timeflow-pm-filter-status`, `timeflow-pm-sort-field`,
  `timeflow-pm-sort-dir`) — ostatni auto-zapisany stan staje się początkowym widokiem
  domyślnym (płynna migracja, brak utraty stanu dla istniejących użytkowników).
- **„Wyczyść filtry"** — zachowanie bez zmian: czyści filtry w pamięci, **nie** rusza
  zapisanego domyślnego widoku ani nie zapisuje niczego.
- Brak nowych zależności. Ikona `Save` z `lucide-react` (już używana w repo).

## Architektura

### Nowy moduł: `dashboard/src/components/pm/pm-view-defaults.ts`

Wydziela trwałość widoku z komponentu — testowalna, jeden cel.

- Stałe 5 kluczy localStorage (przeniesione z `PmProjectsList.tsx`):
  `timeflow-pm-filter-year`, `timeflow-pm-filter-client`, `timeflow-pm-filter-status`,
  `timeflow-pm-sort-field`, `timeflow-pm-sort-dir`.
- Typ `PmViewDefaults`:
  `{ filterYear: string; filterClient: string; filterStatus: string;
     sortField: PmSortField; sortDir: SortDir }`.
- `loadPmViewDefaults(): PmViewDefaults` — odczyt 5 kluczy z `localStorage`.
  - Fallbacki: `filterYear=''`, `filterClient=''`, `filterStatus=''`,
    `sortField='number'`, `sortDir='desc'` (obecne wartości domyślne).
  - Walidacja: `sortField` musi być jedną z dozwolonych wartości `PmSortField`,
    `sortDir` jedną z `SortDir`; nieznana wartość → fallback.
  - `try/catch` wokół dostępu do `localStorage`; przy wyjątku → pełen zestaw
    fallbacków.
- `savePmViewDefaults(view: PmViewDefaults): void` — zapis 5 kluczy.
  - `try/catch`; przy wyjątku po cichu ignoruje (spójne z dotychczasowym
    `usePersistedState`).

### Modyfikacja: `dashboard/src/components/pm/PmProjectsList.tsx`

- Usunięcie importu `usePersistedState` oraz lokalnych stałych `STORAGE_KEY_*`
  (przeniesione do `pm-view-defaults.ts`).
- 5 hooków stanu (`filterYear`, `filterClient`, `filterStatus`, `sortField`,
  `sortDir`) → zwykłe `useState`, inicjalizowane z jednorazowego wywołania
  `loadPmViewDefaults()` (lazy initializer).
- Lokalny stan transientnego komunikatu (`savedMsg`) + ref na timeout, wzorzec
  z ekranu Projects (`setFolderInfo` + 3 s `setTimeout`).
- `handleSaveView()` — buduje `PmViewDefaults` z bieżących 5 wartości, woła
  `savePmViewDefaults(...)`, ustawia `savedMsg` na `t('pm.messages.view_settings_saved')`,
  czyści po 3 s.
- Przycisk zapisu w toolbarze listy: `Button` (`variant="ghost"`, `size="icon"`)
  z ikoną `Save`, owinięty `AppTooltip` z `t('pm.save_view_as_default')` i
  `aria-label`. Umieszczony na końcu toolbara, **zawsze widoczny** (w odróżnieniu od
  „Wyczyść filtry", które pozostaje warunkowe i stoi przed przyciskiem zapisu).
- Render `savedMsg` przy toolbarze jako mały tekst (wzorzec z Projects).

### i18n: `dashboard/src/locales/pl/common.json` i `en/common.json`

Nowe klucze (PL + EN, parzystość wymagana przez lint `lint:locales`):
- `pm.save_view_as_default` — tooltip / `aria-label` przycisku.
- `pm.messages.view_settings_saved` — treść toasta (nowy blok `pm.messages`,
  jeśli nie istnieje).
- `help_page.pm_feature_save_view` — wpis do panelu pomocy.

### Dokumentacja: `dashboard/src/components/help/sections/HelpSimpleSections.tsx`

CLAUDE.md wymaga aktualizacji Help przy nowej opcji odczuwalnej przez użytkownika.
Dopisanie `t18n('help_page.pm_feature_save_view')` do tablicy `features` w
`HelpPmSection`. Tekst: dyskietka w toolbarze listy PM zapisuje bieżące filtry i
sortowanie jako domyślny widok; bez kliknięcia zmiany nie są pamiętane.

## Przepływ danych

1. Otwarcie ekranu PM → `PmProjectsList` inicjalizuje 5 wartości z
   `loadPmViewDefaults()`.
2. Użytkownik zmienia rok/klienta/status/sortowanie → zmiana tylko w `useState`,
   localStorage nietknięty.
3. Klik dyskietki → `handleSaveView()` → `savePmViewDefaults({...})` zapisuje 5
   kluczy → toast na 3 s.
4. Następne otwarcie ekranu → `loadPmViewDefaults()` zwraca zapisany widok.
5. „Wyczyść filtry" → zeruje filtry w pamięci; localStorage nietknięty.

## Obsługa błędów i przypadki brzegowe

- Brak zapisanego widoku (pierwszy raz / wyczyszczony localStorage) →
  `loadPmViewDefaults()` zwraca wartości domyślne (`''`, `''`, `''`, `'number'`,
  `'desc'`).
- Niepoprawna/uszkodzona wartość w kluczu (`sortField`/`sortDir` spoza dozwolonych)
  → walidacja podmienia na fallback, reszta kluczy bez zmian.
- `localStorage` rzuca wyjątek (tryb prywatny, brak dostępu) → odczyt zwraca pełne
  fallbacki, zapis po cichu ignoruje wyjątek; UI się nie wywraca.
- Istniejący użytkownik z auto-zapisanym stanem → ten stan jest poprawnym
  `PmViewDefaults` i staje się początkowym widokiem domyślnym.

## Testy

vitest — `dashboard/src/components/pm/pm-view-defaults.test.ts`:
- `loadPmViewDefaults` zwraca komplet wartości domyślnych przy pustym localStorage.
- Round-trip: `savePmViewDefaults(view)` → `loadPmViewDefaults()` zwraca ten sam `view`.
- Niepoprawny `sortField`/`sortDir` w localStorage → fallback (`'number'` / `'desc'`),
  pozostałe pola bez zmian.
- `localStorage` rzuca wyjątek → `loadPmViewDefaults` zwraca fallbacki,
  `savePmViewDefaults` nie rzuca.

Manualnie:
- Zmiana filtrów bez zapisu → reload → wraca ostatnio *zapisany* widok (nie
  niezapisana zmiana).
- Klik dyskietki → toast 3 s → reload → przywrócony nowo zapisany widok.
- „Wyczyść filtry" → reload → nadal zapisany domyślny widok (Clear nic nie zapisał).
- Wyszukiwanie nigdy nie jest przywracane po reloadzie.

## Zakres plików

- `dashboard/src/components/pm/pm-view-defaults.ts` (nowy)
- `dashboard/src/components/pm/pm-view-defaults.test.ts` (nowy)
- `dashboard/src/components/pm/PmProjectsList.tsx`
- `dashboard/src/locales/pl/common.json`
- `dashboard/src/locales/en/common.json`
- `dashboard/src/components/help/sections/HelpSimpleSections.tsx`

## Poza zakresem

- Uogólnienie wzorca w reużywalny hook i refaktor ekranów Projects/Timeline.
- Dodanie trybu wyświetlania (Detailed/Compact) na liście PM — lista PM jest tabelą
  i nie ma takiego trybu.
- Zapisywanie pola wyszukiwania.
- Zmiana zachowania przycisku „Wyczyść filtry".
