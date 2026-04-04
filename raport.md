# TIMEFLOW — Raport synchronizacji (obie maszyny)
**Data:** 2026-04-04  
**Logi:** `logs/` (MICZ_NX) + `system (V)/` (MICZ_)

---

## Podsumowanie

| Kanał | Maszyna | Sesje sync | Błędy (ERROR) | Ostrzeżenia (WARN) | Status |
|-------|---------|-----------|---------------|---------------------|--------|
| LAN   | MICZ_NX | 2         | 0             | 4 (firewall)        | OK     |
| LAN   | MICZ_   | 2         | 0             | 4 (firewall)        | OK     |
| Online| MICZ_NX | ~25       | 0             | 0                   | OK (idle) |
| Online| MICZ_   | ~15       | 0             | 0                   | OK (idle) |

**Żadnych błędów synchronizacji nie wykryto.** Wszystkie operacje na obu maszynach zakończyły się sukcesem. Poniżej szczegóły i uwagi optymalizacyjne.

---

## 1. Topologia sieci

| Maszyna | IP | Device ID | Rola LAN | Wersja |
|---------|-----|-----------|----------|--------|
| MICZ_NX | 192.168.1.73  | MICZ_NX-19d3ab46b2a | master (forced) | 0.1.514 |
| MICZ_   | 192.168.1.243 | MICZ_-19d3ab5b099   | slave (forced)  | 0.1.514 |

Obie maszyny mają wymuszony tryb roli w ustawieniach (FORCED). Serwer online: `cfabserver-production.up.railway.app`.

---

## 2. Synchronizacja LAN — pełna korelacja obu maszyn

### 2.1 Runda #1 — MICZ_NX jako master (trigger z dashboard NX)

| Krok | MICZ_NX (master) | MICZ_ (slave) |
|------|-----------------|---------------|
| Start | 19:26:11 — dashboard trigger | 19:26:09 — master rozpoczyna sync |
| Tryb | `full` (markery: `dc3011...` vs `e27491...`) | full (since=1970-01-01) |
| Pobranie danych | 5743 KB od slave | wysłano 5743 KB do mastera |
| Scalanie (master) | 76 proj, 14 app, 759 sesji, 31 manual, 39512 tombs | — (czeka) |
| Wysłanie scalonych | 5745 KB do slave | odebrano 5745 KB od mastera |
| Import (slave) | — | 76 proj, 14 app, 765 sesji, 31 manual, 39513 tombs |
| Weryfikacja | OK, nowy marker: `8480ced1ce26dff5` | OK |
| Koniec | 19:26:14 (3.5s) | 19:26:12 |

**Uwaga:** Slave widzi 39**513** tombstones (o 1 więcej niż master). Możliwa przyczyna: tombstone dodany po eksporcie mastera ale przed importem slave. Nie jest to błąd, ale warto zweryfikować czy rozbieżność nie narasta.

### 2.2 Runda #2 — obie strony inicjują sync jednocześnie

Po rundzie #1 nastąpiło zderzenie:
- **MICZ_** (slave) → o 19:26:25 dashboard trigger: sync z MICZ_NX jako **master** (tryb delta, markery zgodne: `8480ced1ce26dff5`)
- **MICZ_NX** (master) → o 19:26:28 przyjął sync jako **slave** od MICZ_ (tryb delta)

| Parametr | MICZ_ → MICZ_NX (runda 2a) | MICZ_NX jako slave (runda 2b) |
|----------|-----------------------------|-------------------------------|
| Czas | 19:26:25 → 19:26:27 (1.6s) | 19:26:28 → 19:26:29 (~1s) |
| Tryb | delta (since 2026-04-04 17:26:12) | delta (since 2026-04-04 17:26:12) |
| Dane peera | 76 proj, 14 app, 56 sesji, 0 manual, 0 tombs | 76 proj, 14 app, 765 sesji, 31 manual, 39512 tombs |
| Nowy marker | `8e6c31ec75cc42a7` | — |
| Wysłano/odebrano | pobrano 32.7 KB, wysłano 5744.7 KB | wysłano 32.7 KB, odebrano 5744.7 KB |

**Kluczowa obserwacja:** MICZ_ (jako master w rundzie 2a) widzi peera z tylko 56 sesjami i 0 tombstones — to delta od 17:26:12, więc zawiera tylko nowe dane MICZ_NX. Natomiast w rundzie 2b MICZ_NX importuje pełne 5744.7 KB od mastera — to zbędna powtórka, bo dane zostały już wymienione w rundzie 2a.

### 2.3 Ostrzeżenia firewalla (WARN) — obie maszyny

Identyczny problem na obu maszynach: 4x `netsh failed (exit code: 1)` przy starcie.  
**Wpływ:** brak — reguły istniały z wcześniejszego uruchomienia.  
**Zalecenie:** uruchomić demona raz jako admin na każdej maszynie.

---

## 3. Synchronizacja Online — obie maszyny

### 3.1 MICZ_NX (device: `d9f583d7...`)
- **Sesji:** ~25 w ~6 min (17:25:11 → 17:31:16)
- **Rewizja:** 644 (hash: `e1cf9214...`, zgodny z serwerem)
- **Wynik:** wszystkie `idle` (single_device, 0 online)
- **Pierwsza sesja:** skipped (startup sync disabled)

### 3.2 MICZ_ (device: `6f86ef78...`)
- **Sesji:** ~15 w ~7 min (17:25:25 → 17:32:52)
- **Rewizja:** 644 (hash: `e1cf9214...`, zgodny z serwerem)
- **Wynik:** wszystkie `idle` (single_device, 0 online)
- **Pierwsza sesja:** skipped (startup sync disabled)

### 3.3 Problem: obie maszyny online, ale serwer mówi "single_device"

Obie maszyny łączyły się z serwerem w tym samym oknie czasowym (17:25–17:32), ale serwer konsekwentnie odpowiadał `onlineDevices: 0` i `single_device` dla obu. To oznacza, że:
- Serwer nie widzi drugiego urządzenia jako online
- Prawdopodobnie heartbeat nie rejestruje obecności, lub sesje nie nakładają się czasowo (każda trwa ~70–150ms, przerwy 3–50s)
- **Efekt:** online sync nigdy nie wykona push/pull, nawet gdy oba urządzenia mają dane do zsynchronizowania

---

## 4. Uwagi i rekomendacje

### WYSOKI priorytet

| # | Problem | Szczegóły | Rekomendacja |
|---|---------|-----------|--------------|
| 1 | **Serwer nie widzi obu urządzeń jako online** | Mimo jednoczesnego łączenia się, serwer zawsze odpowiada `single_device`. Online sync jest de facto martwy. | Zbadać logikę `onlineDevices` na serwerze. Prawdopodobnie heartbeat nie persystuje obecności między requestami (stateless). Rozważyć: window obecności (np. "online = heartbeat < 60s temu") lub long-polling/WebSocket. |
| 2 | **Nadmierna częstotliwość online sync** | MICZ_NX: 25 sesji/6 min (~co 15s), MICZ_: 15 sesji/7 min (~co 30s). Każda kończy się `idle`. | Zwiększyć interwał do 30–60s. Wdrożyć exponential backoff: po N kolejnych `idle` → wydłużać interwał (np. 30s → 60s → 120s). |
| 3 | **39 512+ tombstones** | Przesyłane przy każdym full sync (~5.7 MB payload). Slave widzi 39513 (o 1 więcej). | Wdrożyć garbage collection tombstones starszych niż 30–90 dni. Dodać metrykę wzrostu tombstones w logu. |

### SREDNI priorytet

| # | Problem | Szczegóły | Rekomendacja |
|---|---------|-----------|--------------|
| 4 | **Podwójna synchronizacja LAN** | Po rundzie #1 (3.5s) obie maszyny natychmiast zainicjowały kolejne synce (runda 2a i 2b), przesyłając łącznie ~11.5 MB zbędnych danych. | Dodać cooldown: po zakończonym sync nie inicjować nowego przez min. 60s. Lub: po sync jako slave, nie inicjować własnego sync (markery są już zgodne). |
| 5 | **Full sync zamiast delta** | Runda #1 była `full` (since=1970-01-01) mimo istniejących markerów po obu stronach. | Różne markery = full. Jeśli to zamierzone, OK. Ale warto rozważyć delta od last-known-common-state zamiast epoch. |
| 6 | **Rozbieżność tombstones** | Master: 39512, slave: 39513 (po rundzie #1). | Sprawdzić, czy różnica nie narasta po kolejnych syncach. Jeśli tak — bug w logice tombstone export. |

### NISKI priorytet

| # | Problem | Szczegóły | Rekomendacja |
|---|---------|-----------|--------------|
| 7 | **Race condition w loggerze LAN** | `lan_sync.log` obu maszyn: linia 5/19 — podwójny timestamp, złamane brackety. Dwa wątki piszą jednocześnie. | Dodać mutex/lock na zapis do `lan_sync.log`. Problem występuje na obu maszynach — potwierdza, że to systemowy bug w loggerze. |
| 8 | **Scan 253 hostów co ~30s** | Discovery skanuje pełną podsieć /24 nawet gdy peer jest znany. MICZ_NX skanuje 3 interfejsy (253+) hostów. | Gdy peer jest odkryty — zmniejszyć częstotliwość full scan. Np. known-peer health check co 30s, full scan co 5 min. |

---

## 5. Timeline synchronizacji (obie maszyny)

```
MICZ_NX (192.168.1.73)                    MICZ_ (192.168.1.243)
─────────────────────                      ─────────────────────
19:20:09  Demon start                      
19:20:10  LAN discovery (master)           
                                           19:21:37  Demon start
                                           19:21:38  LAN discovery (slave)
                                           19:21:39  Odkryto MICZ_NX @ .73

17:25:11  Online sync #1 (skipped)         17:25:25  Online sync #1 (skipped)
17:25:12  Online sync #2 (idle)            17:25:27  Online sync #2 (idle)
  ...25 sesji, wszystkie idle...             ...15 sesji, wszystkie idle...
17:31:16  Online sync #25 (idle)           17:32:52  Online sync #15 (idle)

19:26:09                                   ← Master NX rozpoczyna sync
19:26:11  [SYNC #1] full sync START →      19:26:09  [SLAVE] przyjął full sync
19:26:14  [SYNC #1] 3.5s OK               19:26:12  [SLAVE] import OK

                                           19:26:25  [SYNC #2a] delta sync START →
19:26:28  ← [SLAVE] przyjął delta sync    19:26:27  [SYNC #2a] 1.6s OK
19:26:29  [SLAVE] import OK               
```

---

## 6. Statystyki

| Metryka | MICZ_NX | MICZ_ |
|---------|---------|-------|
| Online sync sesji | ~25 | ~15 |
| Online sync interwał | ~3–50s | ~5–65s |
| Online sync czas odpowiedzi | 60–318ms (śr. ~80ms) | 70–164ms (śr. ~100ms) |
| LAN sync sesji | 2 | 2 |
| LAN sync czas | 3.5s (full), ~1s (delta slave) | ~3s (slave), 1.6s (delta master) |
| Łącznie przesłano (LAN) | ~17 MB | ~17 MB |
| Tombstones | 39 512 | 39 513 |

---

## 7. Werdykt

Synchronizacja LAN działa poprawnie — dane wymieniane bez błędów, bazy zweryfikowane po scaleniu na obu maszynach. **Online sync jest de facto martwy** — serwer nigdy nie widzi obu urządzeń jako jednocześnie online, więc push/pull nie następuje. 

Główne obszary do poprawy:
1. **Naprawa detekcji online urządzeń na serwerze** (krytyczne — online sync nie działa)
2. **Eliminacja zbędnych podwójnych syncow LAN** (cooldown/dedup)
3. **Garbage collection tombstones** (payload rośnie)
