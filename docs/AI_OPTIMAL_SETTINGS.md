# TIMEFLOW — optymalne ustawienia modelu AI (przypisywanie projektów)

> Stan: 2026-06-11. Wartości zastosowane na maszynie macOS (micz) bezpośrednio w `assignment_model_state`.
> Kontekst: audyt precyzji z 2026-06-10 wykazał, że pamięć modelu (wyuczone wagi) przegłosowuje fakty
> (ścieżki plików w folderach projektów). Plan naprawy architektury:
> [`docs/superpowers/plans/2026-06-10-ai-assignment-precision.md`](./superpowers/plans/2026-06-10-ai-assignment-precision.md).

## Zalecane wartości

| Parametr | Klucz w `assignment_model_state` | Wartość | Dlaczego |
|---|---|---|---|
| Tryb pracy modelu | `mode` | `suggest`, po ~tygodniu weryfikacji → `auto_safe` | najpierw kontrola jakości sugestii, dopiero potem automat |
| Min. pewność sugestii | `min_confidence_suggest` | `0.50` | niski próg = więcej podpowiedzi; ryzyko zerowe (nic nie przypisuje samo) |
| Min. pewność auto-safe | `min_confidence_auto` | `0.85` | przy 0.88+ czysty fakt ścieżkowy (~0.855 po wdrożeniu planu) nigdy nie przejdzie progu |
| Min. dowody auto-safe | `min_evidence_auto` | `3` | fakt ścieżkowy daje po wdrożeniu planu evidence 4 — próg 3 go przepuszcza, a odsiewa zgadywanie z samej pamięci |
| **Waga feedbacku** | `feedback_weight` | **`3.0`** | **najważniejsze**: przy 5–7 kilkanaście ręcznych korekt buduje pamięć app→projekt, która przebija dowód ze ścieżki pliku |
| Horyzont treningu | `training_horizon_days` | `365` | 2 lata historii (default 730) cementują stare nawyki przypisań |
| Half-life wygaszania | `decay_half_life_days` | `60` | szybsze zapominanie nieaktualnych wzorców pracy |
| Blacklista folderów treningu | `training_folder_blacklist` | `["/users/micz/downloads","/users/micz/desktop"]` | pliki spoza struktury projektów to szum treningowy (ścieżki znormalizowane: lowercase, separator `/`) |
| Blacklista aplikacji treningu | `training_app_blacklist` | wg potrzeb (np. przeglądarki, komunikatory) | aplikacje wieloprojektowe zaśmiecają warstwę app-memory |

## Gdzie to ustawić

- **UI:** strona **AI** w dashboardzie → karta „Tryb i progi" (`AiSettingsForm`) — wszystko poza blacklistami.
- **Blacklisty:** brak UI (stan na 2026-06-11) — komenda backendowa `set_training_blacklists` istnieje,
  ale żaden komponent jej nie wywołuje. Ustawienie ręczne:

```bash
sqlite3 "$HOME/Library/Application Support/TimeFlow/timeflow_dashboard.db" "
INSERT INTO assignment_model_state (key, value, updated_at) VALUES
  ('feedback_weight', '3.0', datetime('now')),
  ('min_confidence_auto', '0.8500', datetime('now')),
  ('min_evidence_auto', '3', datetime('now')),
  ('training_horizon_days', '365', datetime('now')),
  ('decay_half_life_days', '60', datetime('now')),
  ('training_folder_blacklist', '[\"/users/micz/downloads\",\"/users/micz/desktop\"]', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;"
```

(Windows: baza w `%APPDATA%\TimeFlow\timeflow_dashboard.db`, ścieżki blacklisty np. `c:/users/<user>/downloads`.)

## Po zmianie ustawień — obowiązkowa kolejność

1. **AI → Trenuj teraz** — nowa waga feedbacku działa dopiero po przebudowie wag modelu.
2. **AI → odśwież skan folderów projektów** — aktualizuje statyczną wiedzę o zawartości projektów (warstwa L3b).
3. Po wdrożeniu planu naprawczego (jednorazowo): **Reset wiedzy AI (soft) → Trenuj teraz** —
   usuwa wagi wytrenowane na etykietach zatrutych przez stare auto-przypisania.

## Czego ustawienia NIE naprawią

Same parametry łagodzą objawy. Architektura scoringu wymaga zmian z planu naprawczego:

- sufit 0.80 na faktach ścieżkowych (L0) przy nieograniczonych warstwach pamięci (L1/L3),
- samouczenie: trening tokenów i L0 czytają auto-przypisania modelu jak fakty,
- brak IDF — tokeny wszechobecne (`users`, nazwa użytkownika, nazwy aplikacji) napędzają największe projekty,
- nazwa aplikacji w tytule okna liczy pamięć appki podwójnie,
- brak normalizacji polskich diakrytyków w tokenizacji.
