# Analiza logiki podziału sesji (Split Sessions)

## Status: wymaga poprawek

---

## 1. Obecny mechanizm ochrony przed ponownym podziałem

### Backend (sessions.rs)
- `load_split_source_session()` (linia 1265): sprawdza `split_source_session_id IS NOT NULL` — jeśli ustawione, zwraca błąd "Session has already been split and cannot be split again".
- Gdy sesja jest dzielona, **wszystkie** powstałe części dostają `split_source_session_id`:
  - Część 0 (UPDATE oryginału): `split_source_session_id = session_id` (self-reference)
  - Części 1..N (INSERT nowe): `split_source_session_id = original_session_id`
- Walidacja blokuje re-split na poziomie backendu.

### Frontend (Sessions.tsx)
- `isAlreadySplitSession()` (linia 138-142): sprawdza `typeof session.split_source_session_id === 'number'`
- `isSessionSplittable()` (linia 1281-1298): jeśli `isAlreadySplitSession()` → return false → ikona nożyczek nie pojawia się

### Migracja (db.rs)
- Backfill (linia 1328-1337): ustawia `split_source_session_id = id` dla starych sesji z komentarzem `LIKE '%Split %/%'`

---

## 2. Zidentyfikowane problemy

### Problem A: Komentarz narastający (zagnieżdżony format)
**Lokalizacja**: `sessions.rs` linia 1330-1334

```rust
let part_comment = source
    .comment
    .as_deref()
    .map(|c| format!("{} (Split {}/{})", c, i + 1, n))
    .unwrap_or_else(|| format!("Split {}/{}", i + 1, n));
```

Jeśli sesja miała już komentarz (np. użytkownik wpisał coś ręcznie, albo istnieje legacy komentarz "Split 1/2"), nowy komentarz staje się: `"Split 1/2 (Split 1/2)"` — brzydki, mylący.

**Rozwiązanie**: Przy podziale **zastąpić** istniejący komentarz czystym formatem `"Split {i}/{n}"`, a oryginalny komentarz zachować jako osobne pole lub dodać na początku:
```rust
let clean_comment = format!("Split {}/{}", i + 1, n);
let part_comment = source.comment
    .as_deref()
    .filter(|c| !c.contains("Split "))  // nie kopiuj starego markera
    .map(|c| format!("{} | {}", c, clean_comment))
    .unwrap_or(clean_comment);
```

### Problem B: Brak wizualnego oznaczenia sesji podzielonych
Sesje powstałe z podziału nie są w UI wyraźnie oznaczone jako "wynik podziału". Jedyne oznaczenie to tekst w komentarzu (`Split 1/2`). Brakuje:
- Dedykowanej ikony/badge'a na `SessionRow` wskazującego "ta sesja jest wynikiem podziału"
- Wizualnego grupowania sesji z tego samego podziału (np. wspólny `split_source_session_id`)
- Tooltipa informującego z jakiej oryginalnej sesji powstała dana część

### Problem C: Sesje podzielone powinny mieć ograniczone akcje
Sesje powstałe z podziału (`split_source_session_id IS NOT NULL`) mogą być:
- [x] NIE mogą być ponownie dzielone (backend + frontend blokują)
- [ ] MOGĄ być przypisywane do innych projektów (to jest OK)
- [ ] Brak jawnego komunikatu w UI, że sesja jest "zablokowana do podziału" (brak tooltipa/info)

### Problem D: Podział jako element nauki (feedback loop)
**Obecny stan**: `apply_split_side_effects()` (linia 1084-1218) rejestruje:
- `assignment_feedback` z `source = "manual_session_split_part_{i}"` — to jest OK
- Przenosi `file_activities` do odpowiednich segmentów (po midpoint)
- Inkrementuje `feedback_since_train` w `assignment_model_state`

**Brakuje**:
- Wyraźnego oznaczenia w UI, że podział jest "decyzją treningową" (np. krótki tekst pod modalem podziału)
- Informacji zwrotnej dla użytkownika, że jego decyzja wpłynie na przyszłe przypisania AI

---

## 3. Plan naprawczy (priorytet)

### P1: Oczyścić format komentarzy przy podziale
- Zmienić `execute_session_split()` aby komentarz split nie narastał
- Jeśli oryginalna sesja miała komentarz użytkownika → zachować go, dodać marker split jako suffix/prefix
- Jeśli oryginalna sesja miała komentarz split (legacy) → zastąpić nowym czystym markerem

### P2: Wizualne oznaczenie sesji podzielonych w UI
- Dodać ikonę/badge na `SessionRow` gdy `split_source_session_id IS NOT NULL`
- Tooltip z informacją: "Ta sesja powstała w wyniku podziału. Nie może być ponownie podzielona."
- Rozważyć grupowanie wizualne sesji z tego samego `split_source_session_id`

### P3: Komunikat o nauce w modalu podziału
- Dodać krótką informację w `MultiSplitSessionModal`: "Twoja decyzja o podziale pomoże AI w przyszłych przypisaniach"
- Opcjonalnie: po podziale pokazać toast z potwierdzeniem + info o nauce

### P4: Blokada UI dla sesji podzielonych
- Ukryć ikonę nożyczek (już zrobione ✓)
- W menu kontekstowym: jeśli sesja jest podzielona → nie pokazywać "Podziel sesję" (weryfikacja potrzebna)
- Dodać tooltip na zablokowanej ikonie: "Sesja już podzielona"

---

## 4. Pliki do modyfikacji

| Plik | Zmiana |
|------|--------|
| `dashboard/src-tauri/src/commands/sessions.rs` | P1: logika komentarza w `execute_session_split()` |
| `dashboard/src/components/sessions/SessionRow.tsx` | P2: badge/ikona dla sesji podzielonych |
| `dashboard/src/components/sessions/MultiSplitSessionModal.tsx` | P3: komunikat o nauce |
| `dashboard/src/pages/Sessions.tsx` | P4: menu kontekstowe — warunek split |
| `dashboard/src/locales/{en,pl}/common.json` | P2-P4: tłumaczenia nowych tekstów |

---

## 5. Kluczowe reguły (podsumowanie wymagań)

1. **Sesja może być podzielona TYLKO RAZ** — backend blokuje (✓), frontend ukrywa ikonę (✓)
2. **Sesje z podziału muszą być wyraźnie oznaczone** — brakuje ikony/badge'a (TODO)
3. **Sesje z podziału mogą być tylko przypisywane do projektów** — nożyczki ukryte (✓), ale brak komunikatu (TODO)
4. **Podział = element nauki AI** — feedback zapisywany (✓), ale brak komunikatu UX (TODO)
5. **Komentarze nie mogą się zagnieżdżać** — "Split 2/2 (Split 1/2)" jest niedopuszczalne (BUG do naprawy)
