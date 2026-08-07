# Raport estymacji per klient — projekt (design)

Data: 2026-06-17
Status: zaakceptowany (kierunek), do przeglądu spec

## 1. Cel

W panelu **Estymacje** umożliwić:
1. Wybór, których klientów projekty są brane pod uwagę (multi-select + opcja „bez klienta").
2. Wygenerowanie z tego ekranu uproszczonego raportu w dwóch wariantach:
   - **Uproszczony**: projekty + łączny czas (i wartość).
   - **Plus**: projekty + rozbicie na dni z godzinami (i wartością) poświęconymi na dany projekt.
3. Obsługę zaokrągleń tak jak na innych ekranach (`rounding.ts`).
4. Szablony tych raportów dostępne w edytorze szablonów raportów jako dodatkowa opcja.

## 2. Decyzje (potwierdzone z użytkownikiem)

- Raport zawiera **czas + wartość ($)**.
- Filtr klientów: **multi-select + „bez klienta"** (projekty nieprzypisane). Domyślnie wszystko zaznaczone.
- Generowanie: **istniejący mechanizm `window.print()` → PDF** (widok + CSS print).
- Szablony: **nowy typ szablonu** w edytorze raportów, obok obecnego per-projekt.

## 3. Założenia

- Wartość liczona **tą samą logiką co panel estymacji** (stawka projektu `projects.hourly_rate` lub `global_hourly_rate`), nie `clients.default_hourly_rate`.
- Filtr klientów filtruje również metryki i listę projektów na samym ekranie Estymacje (nie tylko zakres raportu).
- Brak zmian w backendzie Rust: reużycie `get_clients_summary(dateRange)`, które już zwraca `ClientSummary[]` z `projects[]` mającymi `seconds`, `value` oraz `daily_seconds[]`. Jeśli `daily_seconds`/`value` nie pokryje wariantu „plus" 1:1 (np. wartość per dzień), dołożone zostanie minimalne pole w istniejącym RPC.

## 4. Architektura i przepływ danych

```
Estimates panel (EstimatesView.tsx)
  ├─ filtr klientów (multi-select + "bez klienta")   ← nowy stan UI
  ├─ dateRange (istniejący)
  └─ [Generuj raport ▾]  → wybór wariantu (uproszczony / plus)
        → nawigacja do nowego widoku raportu estymacji
             → dane z get_clients_summary(dateRange) przefiltrowane po wybranych klientach
             → rounding.ts (wartość skalowana przez scaleValueToRounded)
             → window.print() → PDF (jak obecnie)
```

Źródło danych: `useClientsPageController.getClientsSummary(dateRange)` (już istnieje).
Filtrowanie po klientach i mapowanie do struktury raportu odbywa się po stronie frontu — cienka warstwa agregacji, bez nowego RPC.

## 5. Komponenty (UI)

### 5.1 Filtr klientów (panel Estymacje)
- Lokalizacja: `dashboard/src/pages/EstimatesView.tsx` (+ ewent. mały komponent `components/estimates/EstimatesClientFilter.tsx`).
- Multi-select z listy `clientsList()` + syntetyczna pozycja „Bez klienta" (projekty z pustym `client_name`).
- Domyślnie wszyscy/wszystko zaznaczone.
- Stan filtra przefiltrowuje metryki ekranu (total_hours, value, active_projects) oraz listę projektów (`EstimatesProjectsSection`).
- Powiązanie projekt→klient po `projects.client_name` (link by name — zgodnie z modelem).

### 5.2 Przycisk „Generuj raport"
- Dropdown z wyborem wariantu: **Uproszczony** / **Plus**.
- Reużycie wzorca toolbara z `pages/report-view/ReportViewToolbar.tsx`.
- Przekazuje: wybrany wariant, dateRange, listę zaznaczonych klientów (+ flaga „bez klienta"), wybrany szablon estymacji.

### 5.3 Nowy widok raportu
- Plik: `dashboard/src/pages/report-view/EstimateReportView.tsx` (analogicznie do `ReportViewPage.tsx`).
- Kontroler: `dashboard/src/hooks/useEstimateReportController.ts` (analogicznie do `useReportViewController.ts`; print przez `window.print()`, obsługa „View Full / View Rounded").
- Sekcje:
  - **Nagłówek**: TIMEFLOW, zakres dat, lista wybranych klientów, logo (wg `showLogo` szablonu).
  - **Wariant Uproszczony**: tabela `Projekt | Czas | Wartość` + wiersz sumy całkowitej.
  - **Wariant Plus**: per projekt rozbicie `Data (dzień) | Godziny | Wartość`, podsuma projektu, suma całkowita.
  - **Stopka**: jak w istniejących raportach.
- CSS print (`@media print` / klasy `print:*`) jak w obecnych sekcjach raportów.

## 6. Zaokrąglenia

Reużycie współdzielonych ustawień zaokrągleń (te same co raporty), z `dashboard/src/lib/rounding.ts`:

- **Uproszczony**: czas projektu przez `roundDurations`/`roundAggregate`; wartość przez `scaleValueToRounded(value, realSeconds, roundedSeconds)`.
- **Plus**: czas per dzień przez `roundDailyTotals` (tryb `per_day` → pełna godzina); wartość skalowana proporcjonalnie tym samym mechanizmem.
- Toggle „pełny / zaokrąglony (interwał)" jak w `ReportViewToolbar.tsx`.
- Formatowanie czasu przez `createReportDurationFormatter()` z `lib/report-view-formatting.ts`.

## 7. Szablony (edytor szablonów raportów)

- Typ szablonu: `ReportTemplate` w `dashboard/src/lib/report-templates.ts` dostaje pole `kind: 'project' | 'estimate'`.
  - Back-compat: brak pola = `'project'` (istniejące szablony nietknięte).
- Dla `kind === 'estimate'` lista dostępnych sekcji jest zredukowana, np.:
  - `header`, `summary-table` (wariant uproszczony) / `per-day` (wariant plus), `footer`.
  - `showLogo` działa jak dotychczas.
- Storage bez zmian (localStorage: `timeflow_report_templates`, `timeflow_report_selected_template`).
- Edytor: `pages/reports/ReportsTemplateEditor.tsx` + `ReportsSectionsPanel.tsx` + `reports-page-sections.tsx` rozszerzone o sekcje estymacji warunkowo zależnie od `kind`.
- Wybór wariantu na ekranie estymacji mapuje się na zapisany szablon estymacji (lub wbudowane domyślne, jeśli brak własnych).

## 8. Help.tsx + i18n (wymagane przez CLAUDE.md)

- Nowa sekcja w `Help.tsx`: filtr klientów w estymacjach, dwa warianty raportu (co robią, kiedy użyć, ograniczenia), zaokrąglenia, szablony estymacji.
- Klucze i18n dla wszystkich nowych etykiet UI (filtr, przycisk, warianty, nagłówki tabel, sekcje szablonu).
- Terminologia spójna (UI / Help / logi), nazwa produktu `TIMEFLOW`.

## 9. Zakres plików (szacunkowo)

Frontend:
- `dashboard/src/pages/EstimatesView.tsx` — filtr klientów + przycisk raportu.
- `dashboard/src/components/estimates/EstimatesClientFilter.tsx` — nowy (opcjonalnie).
- `dashboard/src/hooks/useEstimatesPageController.ts` — stan filtra, integracja danych klientów.
- `dashboard/src/pages/report-view/EstimateReportView.tsx` — nowy widok raportu.
- `dashboard/src/hooks/useEstimateReportController.ts` — nowy kontroler raportu.
- `dashboard/src/lib/report-templates.ts` — pole `kind`.
- `dashboard/src/pages/reports/*` — obsługa typu `estimate` w edytorze.
- routing (dodanie ścieżki widoku raportu estymacji).
- `Help.tsx` + pliki i18n.

Backend (warunkowo):
- `dashboard/src-tauri/src/commands/clients.rs` — tylko jeśli trzeba dołożyć wartość per dzień do `get_clients_summary`.

## 10. Testy / weryfikacja

- Jednostkowe: filtrowanie projektów po klientach (w tym „bez klienta"), mapowanie danych summary → struktura raportu, poprawność zaokrągleń (uproszczony vs plus) i skalowania wartości.
- Manualne:
  - Filtr klientów zmienia metryki i listę projektów.
  - Raport uproszczony: sumy zgadzają się z panelem.
  - Raport plus: rozbicie dzienne sumuje się do sumy projektu; per_day zaokrągla do pełnych godzin.
  - Toggle pełny/zaokrąglony.
  - Print → PDF (tytuł, layout, logo wg szablonu).
  - Szablon estymacji zapisywany/odczytywany; istniejące szablony per-projekt działają bez zmian (back-compat).
- React Doctor: 100/100 (uruchamiać z roota repo).

## 11. Poza zakresem (YAGNI)

- Dedykowany eksport CSV / własny generator PDF (zostajemy przy `window.print()`).
- Synchronizacja klientów cross-machine (model klientów obecnie nie uczestniczy w sync).
- Wartość liczona ze stawki klienta (`default_hourly_rate`) — używamy logiki estymacji.
