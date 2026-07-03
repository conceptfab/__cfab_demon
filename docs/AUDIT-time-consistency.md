# AUDYT — spójność zliczania, zaokrąglania i prezentacji czasu

> Data: 2026-07-03 · Zakres: dashboard (React/TS) + backend dashboardu (Rust/Tauri) + demon (odczyt)
> Metoda: mapowanie wszystkich ścieżek agregacji i prezentacji, następnie adwersaryjna weryfikacja
> każdego znaleziska (niezależny agent-recenzent próbował je obalić). Werdykt: **6/6 CONFIRMED**.

## TL;DR

Zasada „jedno źródło prawdy" jest **złamana w trzech miejscach**. Najpoważniejsze: sekcja
**timeline w raporcie projektu sumuje surowe czasy sesji, a nagłówek tego samego raportu używa
algorytmu wall-clock z deduplikacją** — przy nakładających się sesjach (np. Cursor + Claude
równolegle) suma dni timeline **nie zgodzi się z totalem raportu nawet przy wyłączonym
zaokrąglaniu**. Dodatkowo, przy włączonym zaokrąglaniu, każda wartość w timeline/liście sesji
jest zaokrąglana niezależnie, więc wpisy nie sumują się do dnia, a dni do totalu.

| # | Znalezisko | Waga | Widoczne dla użytkownika |
|---|---|---|---|
| F1 | Timeline raportu: surowa suma vs wall-clock dedup w nagłówku | **Krytyczna** | Tak — rozjazd godzin w jednym dokumencie |
| F2 | Filtr `min_duration` tnie listę sesji/timeline, ale nie total | **Wysoka** | Tak — timeline < total (domyślnie próg 10 s) |
| F3 | Zaokrąglanie każdej wartości niezależnie (wpis/dzień/total) | **Wysoka** | Tak — wpisy ≠ suma dnia ≠ total |
| F4 | Tryb `per_session` nigdzie nie działa per sesja | **Wysoka** | Tak — ustawienie nie robi tego, co obiecuje |
| F5 | Dwie konwencje sumowania zaokrągleń: Estimates vs Dashboard | Średnia | Częściowo — dotyczy tylko wartości „≈" |
| F6 | Trzecia implementacja unii czasu na stronie Sessions | Średnia | Tak — suma grupy ≠ karta projektu przy nakładkach |

---

## Architektura liczenia czasu (stan zastany)

Kanoniczne źródło prawdy istnieje i jest dobre: backend dashboardu liczy czas jednym silnikiem —
`compute_project_activity_unique` → `WallClockStrategy`
([time_algorithm.rs:402](../dashboard/src-tauri/src/commands/time_algorithm.rs#L402),
sweep-line [time_algorithm.rs:788](../dashboard/src-tauri/src/commands/time_algorithm.rs#L788)):
nakładające się interwały liczone raz (wall-clock), czas współbieżny **dzielony równo między
projekty**, sesje manualne włączone. Z niego czerpią: Dashboard, lista/karta projektu, karta
klienta, estymacje ($), nagłówek raportu projektu. Rozbicie per-app jest do niego skalowane
(`distribute_app_seconds`, [time_algorithm.rs:135](../dashboard/src-tauri/src/commands/time_algorithm.rs#L135)) — wzorcowo.

Zaokrąglanie jest scentralizowane w [rounding.ts](../dashboard/src/lib/rounding.ts) (zawsze ceil,
tylko przy prezentacji, surowe dane nietykane) — zgodnie z założeniami z
[PLAN-rounding-clients.md](./PLAN-rounding-clients.md).

Problem: **obok kanonu istnieją dwie niezależne implementacje sumowania** (F1, F6) oraz
formatter, który zaokrągla wartości bez wiedzy o kontekście sumy (F3).

---

## F1 (KRYTYCZNE) — timeline raportu liczy z innego źródła niż total raportu

**Objaw:** w jednym wydruku raportu suma godzin dni timeline ≠ „Total time" w sekcji Stats /
Financials. Dokładnie scenariusz, który podważa wiarygodność aplikacji.

**Mechanizm:** jedno wywołanie `get_project_report_data`
([report.rs:113](../dashboard/src-tauri/src/commands/report.rs#L113)) zwraca dwa niezgodne zbiory:

- `project.total_seconds` / `daily_seconds` — kanon wall-clock z dedupem i podziałem czasu
  współbieżnego ([projects.rs:633-655](../dashboard/src-tauri/src/commands/projects.rs#L633-L655)),
- surową listę `sessions` + `manual_sessions` z pełnymi `duration_seconds`.

Timeline (`buildTimelineDays`, [report-timeline.ts:57](../dashboard/src/lib/report-timeline.ts#L57))
sumuje surowe `duration_seconds` — **bez dedupu, bez podziału między projekty, bez skalowania**.

**Przykład liczbowy:** Cursor 10:00–11:00 + Claude 10:30–11:00 (ten sam projekt):
timeline dnia = 1 h 30 m, total raportu = 1 h 00 m. Jeśli druga sesja należy do innego projektu,
total tego projektu dostaje 45 m (split), a timeline nadal pokaże 1 h.

**Kierunek naprawy:** timeline musi konsumować ten sam kanon — np. backend powinien zwracać
per-sesyjne `effective_seconds` (udział sesji po dedupie/splicie, analogicznie do
`distribute_app_seconds`), które frontend tylko grupuje po dniach; alternatywnie dzienne nagłówki
timeline brać wprost z `daily_seconds`, a przy wpisach zaznaczać, że to czas surowy sesji.

## F2 (WYSOKIE) — `min_duration` filtruje listę sesji, ale nie total

Lista sesji raportu odrzuca `duration_seconds < min_duration`
([report.rs:75](../dashboard/src-tauri/src/commands/report.rs#L75), domyślnie **10 s** —
[session_settings.rs](../shared/session_settings.rs)), ale total liczony jest z
`min_session_duration: None`
([projects.rs:637](../dashboard/src-tauri/src/commands/projects.rs#L637) →
`unwrap_or(0)` w [time_algorithm.rs:545](../dashboard/src-tauri/src/commands/time_algorithm.rs#L545)).
Demon **zapisuje** krótkie sesje do DB (write-path nie zna progu), więc rozjazd jest praktyczny:
sesje < progu są w totalu, ale znikają z timeline i listy sesji. Im wyższy próg użytkownika, tym
większy rozjazd. **Naprawa:** jeden próg dla obu ścieżek (przekazać `min_duration` do
`compute_project_activity_unique` w kontekście raportu albo nie filtrować listy).

## F3 (WYSOKIE) — formatter raportu zaokrągla każdą wartość niezależnie

`createReportDurationFormatter` wykonuje `roundSeconds(...)` na **każdej przekazanej liczbie**
([report-view-formatting.ts:67-74](../dashboard/src/lib/report-view-formatting.ts#L67-L74)).
Konsumenci: wpisy timeline i sumy dni
([ReportViewTimelineSection.tsx:67,93](../dashboard/src/pages/report-view/ReportViewTimelineSection.tsx#L67)),
wiersze sesji ([ReportViewSessionsSection.tsx:54](../dashboard/src/pages/report-view/ReportViewSessionsSection.tsx#L54)),
sesje manualne ([ReportViewManualSessionsSection.tsx:59](../dashboard/src/pages/report-view/ReportViewManualSessionsSection.tsx#L59)).

**Przykład (tryb per_total, interwał 15 min, 2 sesje po 5 min tego samego dnia):**
wpisy pokazują `15m` + `15m`, suma dnia tuż nad nimi `15m`, total raportu `15m`.
Użytkownik widzi 30 m we wpisach i 15 m w sumie — w tym samym bloku.

**Kierunek naprawy:** zaokrąglanie powinno mieć jedną „kotwicę" zgodną z trybem: w `per_total`
wiersze pokazują czas surowy (zaokrąglony jest tylko total), w `per_session` total = Σ zaokrąglonych
sesji (patrz F4), w `per_day` dni zaokrąglone i total = Σ dni; wpisy w dniu — surowe.

## F4 (WYSOKIE) — tryb `per_session` nie jest realizowany

Zamierzona semantyka (wg [PLAN-rounding-clients.md](./PLAN-rounding-clients.md) i opisu w UI):
„zaokrąglij każdą sesję, potem sumuj". Stan faktyczny:

- `computeReportDisplayValues` dla `per_session` zaokrągla **jeden zagregowany total**, identycznie
  jak `per_total` ([report-view-formatting.ts:23-28](../dashboard/src/lib/report-view-formatting.ts#L23-L28));
- `roundAggregate` (Dashboard, karty) — to samo ([rounding.ts:131-137](../dashboard/src/lib/rounding.ts#L131-L137));
- jedyna gałąź per-sesyjna (`roundDurations`, [rounding.ts:96-100](../dashboard/src/lib/rounding.ts#L96-L100))
  jest wywoływana wyłącznie z `roundDailyTotals`, gdzie „sesją" jest **dzień**
  ([rounding.ts:110,123](../dashboard/src/lib/rounding.ts#L110)).

Efekt: totale nigdzie nie są sumą zaokrąglonych sesji, a wiersze sesji w raporcie SĄ zaokrąglane
per sesja (przez F3) — czyli dokładnie odwrotnie niż spójnie. Semantyka trybu dryfuje też między
widokami (raz „dzień", raz „całość"). **Naprawa:** przepchnąć listy czasów sesji do miejsc
liczących totale (backend już je zwraca w raporcie) albo uczciwie przemianować/uprościć tryb.

## F5 (ŚREDNIE) — dwie konwencje sumowania zaokrągleń między widokami

- Estimates (karty i raport estymacji): **Σ po zaokrągleniu per projekt**
  ([estimate-report.ts:117-118,148-152](../dashboard/src/lib/estimate-report.ts#L117-L118));
  dodatkowo dni projektu zaokrąglane osobno nie sumują się do totalu wiersza poza trybem
  `per_day` — przyznaje to sam docstring ([estimate-report.ts:69](../dashboard/src/lib/estimate-report.ts#L69)).
- Dashboard/karty: **round(Σ)** — jeden total
  ([RoundedDuration.tsx:44-49](../dashboard/src/components/ui/RoundedDuration.tsx#L44-L49)).

**Przykład (per_total, 15 min, dwa projekty po 20 min):** Estimates „≈ 1 h 00 m",
Dashboard „≈ 45 m". Łagodzi to fakt, że obie liczby to dopisek „≈" obok czasu surowego (surowe
liczby są spójne — potwierdzone). Mimo to dwie różne „prawdy zaokrąglone" dla tego samego zbioru
danych wymagają decyzji: jedna konwencja per tryb, wszędzie ta sama.

## F6 (ŚREDNIE) — trzecia implementacja unii czasu (strona Sessions)

`wallClockSeconds` ([session-utils.ts:35-66](../dashboard/src/lib/session-utils.ts#L35-L66))
reimplementuje w TS unię interwałów: dedupuje nakładki **wewnątrz grupy**, ale **nie dzieli czasu
między współbieżne projekty** i nie zna multiplikatorów. Użycie:
[sessions-grouping.ts:69](../dashboard/src/lib/sessions-grouping.ts#L69) → suma grupy projektu na
stronie Sessions. Gdy sesje dwóch projektów się nakładają: Sessions pokaże pełną unię dla każdego
projektu, karta projektu — tylko jego udział po splicie. Komentarz „mirrors the backend" w
[session-utils.ts:29-32](../dashboard/src/lib/session-utils.ts#L29-L32) jest nieścisły.
**Naprawa:** sumy grup liczyć z danych kanonu (backend) albo jawnie opisać w UI/Help, że to inna
miara (unia per projekt).

---

## Co działa dobrze (nie ruszać)

- Jeden silnik wall-clock w backendzie + skalowanie per-app do totalu (`distribute_app_seconds`).
- Zaokrąglanie tylko przy prezentacji; surowe dane i baza nigdy nie są modyfikowane.
- Scentralizowany moduł [rounding.ts](../dashboard/src/lib/rounding.ts) z testami; kierunek ceil spójny.
- Baza skalowania wartości $ (`value_base_seconds` / `hours*3600`) świadomie omija szum groszowy —
  spójna co do efektu w obu raportach.
- Formatowanie kwot i liczb — jeden `formatMoney`/`formatDecimal` dla całej aplikacji.

## Rekomendowana kolejność napraw

1. **F1 + F2 (dane):** backend zwraca per-sesyjne `effective_seconds` po dedupie/splicie i jeden
   próg `min_duration` dla listy i totalu — timeline i suma raportu liczą się z tych samych liczb.
2. **F3 + F4 (zaokrąglanie):** jedna funkcja „rozłóż zaokrąglenie na strukturę raportu"
   (wpisy → dni → total) zamiast zaokrąglania w formatterze; tryb per_session realnie per sesja
   albo usunięty/przemianowany.
3. **F5 + F6 (ujednolicenie):** jedna konwencja sumowania zaokrągleń; strona Sessions na danych
   kanonu; korekta mylącego komentarza w `session-utils.ts`.
4. Po zmianach: aktualizacja `Help.tsx` (opis trybów zaokrąglania i miar czasu) + testy
   integracyjne asercji „suma wierszy = suma dnia = total" dla każdego trybu.

## Scenariusze testowe (manualne / do automatyzacji)

1. Dwie nakładające się sesje w jednym projekcie → raport: suma dni timeline = Total time.
2. Nakładka między dwoma projektami → karta projektu A + B = Dashboard total; Sessions zgodne.
3. Sesja 5 s przy progu 10 s → total = suma timeline (obie z sesją albo obie bez).
4. Zaokrąglanie per_total 15 min, sesje 2×5 min → wpisy sumują się do dnia i totalu.
5. per_session 15 min, sesje 7 min + 20 min → total = 15 m + 30 m = 45 m we wszystkich widokach.
6. per_day, sesje w 2 dniach po 50 min → total = 2 h wszędzie (Dashboard, karta, raport, Estimates).
