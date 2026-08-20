# TIMEFLOW — poprawki serwera MCP (kompatybilność z Claude Desktop / Cowork)

Data: 2026-08-20
Podstawa: log `[timeflow]` z Claude Desktop, 2026-08-20T10:12:26–34Z

---

## 0. Diagnoza — co dokładnie się stało

Z logu wynika jednoznacznie, że **warstwa transportowa i autoryzacja działają poprawnie**:

| Etap | Status | Dowód z logu |
|---|---|---|
| Start procesu klienta | OK | `Server started and connected successfully` |
| Podstawienie tokenu | OK | `Replacing ${TIMEFLOW_TOKEN} with environment value in header 'Authorization'` |
| Wybór transportu | OK | `Using transport strategy: http-only` |
| Discovery OAuth | OK (404 → pominięte) | `Discovering OAuth server configuration...` |
| Połączenie HTTP | OK | `Connecting to remote server: http://127.0.0.1:47892/mcp` |
| `initialize` | **BŁĄD** | `MCP error -32603: backup_failed: Backup failed: output file already exists` |

Serwer TIMEFLOW **sam odrzucił** handshake. Nie jest to problem Claude, `mcp-remote` ani konfiguracji.

Przyczyna źródłowa: w logu widać **dwa równoległe procesy** o tym samym PID-prefiksie (`[5048]` powtórzone dla `Using transport strategy` i `Connecting to remote server`), a Claude Desktop dodatkowo raportuje osobną pulę:

```
Couldn't start this server for Cowork and Code sessions (they run their own copy of it)
```

Czyli: **Claude Desktop uruchamia ten sam wpis MCP wielokrotnie** (aplikacja główna + pula dla Cowork/Code). Kilka `initialize` trafia do TIMEFLOW w tej samej sekundzie → backup generuje tę samą nazwę pliku → drugi zapis pada na „output file already exists" → cała sesja jest odrzucana.

To potwierdza też licznik z UI: **„Aktywne sesje: 2"** przy jednym skonfigurowanym kliencie.

---

## 1. Zmiana krytyczna — backup nie może blokować startu sesji

### 1.1. Plik: `mcp_backup.py`, funkcja `create_backup()` — unikalna nazwa pliku

**Problem:** nazwa backupu budowana z timestampu o rozdzielczości sekundy jest kolizyjna przy równoległych sesjach; kolizja podnosi wyjątek.

**Kod obecny (odtworzony z komunikatu błędu):**

```python
def create_backup(db_path: Path, backup_dir: Path) -> Path:
    dst = backup_dir / f"timeflow_{datetime.now():%Y%m%d_%H%M%S}.db"
    if dst.exists():
        raise BackupError("Backup failed: output file already exists")
    shutil.copy2(db_path, dst)
    return dst
```

**Kod proponowany:**

```python
def _unique_backup_path(backup_dir: Path, now: datetime) -> Path:
    """Zwraca ścieżkę, która na pewno nie istnieje. Nigdy nie podnosi wyjątku."""
    base = f"timeflow_{now:%Y%m%d_%H%M%S_%f}_{os.getpid()}"
    dst = backup_dir / f"{base}.db"
    counter = 1
    while dst.exists():
        dst = backup_dir / f"{base}_{counter}.db"
        counter += 1
    return dst
```

Kluczowe: mikrosekundy (`%f`) **oraz** PID **oraz** licznik kolizji. Sam timestamp nie wystarczy — dwa procesy potrafią wystartować w tej samej mikrosekundzie na różnych rdzeniach.

### 1.2. Plik: `mcp_backup.py`, nowa funkcja `ensure_recent_backup()` — deduplikacja

**Problem:** trzy równoległe sesje agenta tworzą trzy identyczne kopie tej samej, niezmienionej bazy. To marnuje miejsce i wypycha z rotacji 20 kopii realnie przydatne, starsze snapshoty.

**Kod proponowany:**

```python
BACKUP_REUSE_WINDOW_S = 120

def ensure_recent_backup(db_path: Path, backup_dir: Path) -> Path:
    """
    Jeśli istnieje backup młodszy niż BACKUP_REUSE_WINDOW_S i baza nie zmieniła
    się od jego powstania — zwróć go zamiast robić nowy.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now()

    existing = sorted(
        backup_dir.glob("timeflow_*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if existing:
        newest = existing[0]
        age_s = now.timestamp() - newest.stat().st_mtime
        db_mtime = db_path.stat().st_mtime
        if age_s < BACKUP_REUSE_WINDOW_S and db_mtime <= newest.stat().st_mtime:
            logger.info("Reusing backup %s (age %.1fs)", newest.name, age_s)
            return newest

    return create_backup(db_path, backup_dir)
```

### 1.3. Plik: `mcp_backup.py`, funkcja `create_backup()` — lock międzyprocesowy

**Problem:** `ensure_recent_backup()` ma okno wyścigu między sprawdzeniem a zapisem. Przy równoległym starcie z Claude Desktop to okno jest trafiane regularnie.

**Kod proponowany** (owinięcie całej operacji, wymaga `portalocker` lub `filelock`):

```python
from filelock import FileLock, Timeout

def create_backup(db_path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(backup_dir / ".backup.lock"), timeout=30)
    try:
        with lock:
            dst = _unique_backup_path(backup_dir, datetime.now())
            tmp = dst.with_suffix(".db.part")
            # sqlite3 backup API zamiast shutil.copy2 — bezpieczne przy otwartej bazie
            with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as src, \
                 sqlite3.connect(tmp) as out:
                src.backup(out)
            tmp.replace(dst)          # atomowa publikacja
            _rotate_backups(backup_dir, keep=20)
            return dst
    except Timeout:
        raise BackupError("Backup lock busy for 30s")
```

Dwie dodatkowe poprawki wewnątrz:

- **`shutil.copy2` → `sqlite3.Connection.backup()`.** Kopiowanie pliku SQLite podczas gdy aplikacja ma otwarte połączenie (i pliki `-wal` / `-shm`) daje kopię potencjalnie niespójną. Natywne API robi to poprawnie.
- **Zapis do `.part` + `replace()`.** Przerwany backup zostawia teraz plik docelowy, który przy kolejnym starcie jest „already exists" — czyli to samo, co masz w logu. Plik częściowy nigdy nie może nosić docelowej nazwy.

### 1.4. Plik: `mcp_server.py`, handler `initialize` — degradacja zamiast odmowy

**Problem:** obecna polityka „sesja nie wystartuje, jeśli backup się nie powiedzie" jest zbyt ostra. Efekt: **cała integracja jest niedostępna**, użytkownik widzi tylko `Server disconnected`, a przyczyną jest kosmetyczna kolizja nazw pliku.

**Kod obecny (odtworzony):**

```python
async def handle_initialize(self, params):
    create_backup(self.db_path, self.backup_dir)   # wyjątek → -32603 → koniec
    return self._server_info()
```

**Kod proponowany:**

```python
async def handle_initialize(self, params):
    self._backup_ok = True
    self._backup_error = None

    if self.write_enabled:
        try:
            ensure_recent_backup(self.db_path, self.backup_dir)
        except BackupError as e:
            # Sesja wstaje, ale w trybie tylko-do-odczytu.
            self._backup_ok = False
            self._backup_error = str(e)
            logger.error("Backup failed, session degraded to read-only: %s", e)

    return self._server_info(
        instructions=(
            None if self._backup_ok else
            f"UWAGA: backup bazy nie powiódł się ({self._backup_error}). "
            "Sesja działa w trybie tylko-do-odczytu; narzędzia zapisu są zablokowane."
        )
    )
```

…a blokada przenosi się do miejsca, gdzie faktycznie coś ryzykuje:

```python
async def handle_tool_call(self, name, arguments):
    if name in WRITE_TOOLS and not self._backup_ok:
        raise McpError(-32603, f"write_blocked: backup unavailable ({self._backup_error})")
    ...
```

Efekt: `list_projects`, `list_sessions`, raporty — działają zawsze. `create_manual_session` i reszta zapisów — tylko z ważnym backupem. Bezpieczeństwo danych bez utraty całej integracji.

### 1.5. Plik: `mcp_server.py` — backup leniwy zamiast przy `initialize`

**To jest zmiana, która eliminuje problem u źródła.** Backup przy każdym `initialize` jest robiony „na zapas": większość sesji agenta niczego nie zapisuje, a przy wyłączonym przełączniku **„Zezwól na zapis"** *żadna* sesja nie może niczego zapisać — a backupy i tak powstają.

**Kod proponowany:**

```python
WRITE_TOOLS = {
    "create_manual_session", "update_manual_session", "delete_manual_session",
    "set_manual_session_time", "set_manual_session_title",
    "create_project", "update_project", "assign_session_to_project",
    "create_client", "update_client",
}

async def handle_tool_call(self, name, arguments):
    if name in WRITE_TOOLS:
        if not self.write_enabled:
            raise McpError(-32602, "write_disabled: włącz 'Zezwól na zapis' w ustawieniach")
        if not self._session_backup_done:
            ensure_recent_backup(self.db_path, self.backup_dir)   # tu wyjątek ma prawo zablokować
            self._session_backup_done = True
    return await self._dispatch(name, arguments)
```

Zysk: zero backupów przy sesjach czytających, backup dokładnie wtedy, gdy ma sens, brak wyścigu przy równoległym starcie (pierwszy zapis rzadko następuje w tej samej milisekundzie w dwóch sesjach), i `initialize` staje się operacją, która nie może paść.

---

## 2. Rotacja kopii — też wyścig

### Plik: `mcp_backup.py`, funkcja `_rotate_backups()`

**Problem:** przy rotacji „20 najnowszych" dwa procesy potrafią wybrać ten sam plik do usunięcia; drugi dostaje `FileNotFoundError` / `PermissionError` (Windows trzyma uchwyty dłużej) i — jeśli rotacja jest w tym samym `try` co backup — wywraca sesję.

**Kod proponowany:**

```python
def _rotate_backups(backup_dir: Path, keep: int = 20) -> None:
    files = sorted(backup_dir.glob("timeflow_*.db"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[keep:]:
        try:
            old.unlink()
        except OSError as e:            # nigdy nie eskaluj — to sprzątanie, nie operacja krytyczna
            logger.warning("Could not remove old backup %s: %s", old.name, e)
```

Dodatkowo: posprzątaj osierocone `*.db.part` starsze niż godzina.

---

## 3. Komunikaty błędów — obecnie bezużyteczne

### Plik: `mcp_backup.py` / `mcp_server.py`

`Backup failed: output file already exists` nie mówi **który** plik, **gdzie** ani **dlaczego**. Diagnoza wymagała czytania logu Claude Desktop.

**Kod proponowany:**

```python
raise BackupError(
    f"Backup failed: target already exists: {dst} "
    f"(backup_dir={backup_dir}, pid={os.getpid()}, existing={len(list(backup_dir.glob('*.db')))})"
)
```

Oraz w kodzie MCP: zamiast generycznego `-32603` używaj ustrukturyzowanego `data`:

```python
raise McpError(-32603, "backup_failed", data={
    "reason": "target_exists",
    "path": str(dst),
    "backup_dir": str(backup_dir),
    "hint": "Wyczyść folder mcp_backups lub włącz backup leniwy",
})
```

---

## 4. Dostosowanie do Claude Desktop / Cowork

### 4.1. Założenie „jeden klient = jedna sesja" jest fałszywe

Claude Desktop uruchamia ten sam wpis MCP w **kilku niezależnych kopiach**: aplikacja główna, pula dla sesji Cowork, sesje Claude Code. Każda robi własny `initialize` — praktycznie równocześnie, w ciągu kilkuset milisekund.

**Konsekwencje do wdrożenia w `mcp_server.py`:**

- każdy stan „per sesja" trzymaj pod kluczem `Mcp-Session-Id`, nigdy globalnie ani per proces;
- nic, co jest efektem ubocznym `initialize` (backup, migracje, czyszczenie), nie może zakładać wyłączności — patrz sekcje 1.2–1.3;
- operacje na SQLite z kilku sesji naraz: włącz `PRAGMA journal_mode=WAL` i `PRAGMA busy_timeout=5000`, inaczej dostaniesz `database is locked` przy zbiegu zapisu z odczytem.

### 4.2. Wyciek sesji

Licznik pokazuje **„Aktywne sesje: 2"** mimo że obie próby połączenia zakończyły się błędem i klient się rozłączył. Sesje nie są sprzątane.

**Kod proponowany (`mcp_server.py`, `SessionRegistry`):**

```python
SESSION_IDLE_TIMEOUT_S = 900

def gc_sessions(self) -> None:
    now = time.monotonic()
    dead = [sid for sid, s in self._sessions.items()
            if now - s.last_seen > SESSION_IDLE_TIMEOUT_S]
    for sid in dead:
        logger.info("Reaping idle session %s", sid)
        self._sessions.pop(sid, None)
```

Wołaj z każdego requestu (tanio) albo z timera co 60 s. Dodatkowo obsłuż `DELETE /mcp` z nagłówkiem `Mcp-Session-Id` — to standardowy sposób, w jaki klient MCP zamyka sesję.

### 4.3. Konfiguracja bez `mcp-remote`

TIMEFLOW mówi natywnym streamable HTTP, więc pośrednik `npx mcp-remote` jest zbędny — dokłada proces Node, warstwę OAuth discovery i własne tryby transportu, w których łatwo o pomyłkę (`http-only` vs `http-first`).

**Zmiana w `claude_desktop_config.json` (użytkownika):**

```json
{
  "mcpServers": {
    "timeflow": {
      "type": "http",
      "url": "http://127.0.0.1:47892/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN_Z_USTAWIEN_TIMEFLOW>"
      }
    }
  }
}
```

**Zmiana w UI TIMEFLOW (zakładka MCP):** obok gotowca dla Claude Code i Codex dodaj trzeci blok — **„Claude Desktop / Cowork — wpis w `claude_desktop_config.json`"** — z powyższym JSON-em i przyciskiem kopiowania. To najczęstsza ścieżka instalacji, a obecnie jej brakuje, więc użytkownicy sami sklejają wariant z `mcp-remote`.

### 4.4. Endpoint zdrowia

Dodaj `GET /health` (bez autoryzacji, tylko localhost) zwracający `{"ok": true, "version": ..., "write_enabled": ..., "sessions": N, "last_backup": "..."}`. Pozwala odróżnić „TIMEFLOW nie działa" od „TIMEFLOW odmawia" bez czytania logów Claude.

### 4.5. Skrót `instructions` w `initialize`

W odpowiedzi `initialize` zwracaj `instructions` z krótkim opisem reguł (weryfikacja projektu przed zapisem, wymóg `limit` przy `list_sessions`, format czasu). Agent dostaje je automatycznie i nie musisz tego utrzymywać wyłącznie w skillu.

---

## 5. Kolejność wdrożenia

| # | Zmiana | Sekcja | Priorytet | Efekt |
|---|---|---|---|---|
| 1 | Unikalna nazwa backupu + `.part` + `sqlite3.backup()` | 1.1, 1.3 | **Krytyczny** | Znika `output file already exists` |
| 2 | `initialize` nigdy nie pada; degradacja do read-only | 1.4 | **Krytyczny** | Integracja działa nawet przy awarii backupu |
| 3 | Backup leniwy — przy pierwszym zapisie | 1.5 | Wysoki | Usuwa wyścig u źródła, mniej śmieci |
| 4 | Rotacja odporna na błędy + sprzątanie `.part` | 2 | Wysoki | Brak wtórnych awarii |
| 5 | GC sesji + `DELETE /mcp` | 4.2 | Średni | Poprawny licznik, brak wycieku |
| 6 | WAL + `busy_timeout` | 4.1 | Średni | Brak `database is locked` |
| 7 | Blok konfiguracyjny dla Claude Desktop w UI | 4.3 | Średni | Mniej błędnych instalacji |
| 8 | Czytelne błędy + `/health` | 3, 4.4 | Niski | Szybsza diagnoza |

---

## 6. Testy do dopisania

```python
def test_backup_concurrent_initialize(tmp_path):
    """Osiem równoległych initialize nie może wywrócić żadnej sesji."""
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(lambda _: ensure_recent_backup(db, tmp_path), range(8)))
    assert all(p.exists() for p in results)

def test_backup_partial_file_does_not_block(tmp_path):
    """Osierocony .part po crashu nie blokuje kolejnego backupu."""
    (tmp_path / "timeflow_20260820_101226_000000_5048.db.part").write_bytes(b"junk")
    assert ensure_recent_backup(db, tmp_path).exists()

def test_initialize_survives_backup_failure(monkeypatch):
    """Awaria backupu = sesja read-only, nie odmowa połączenia."""
    monkeypatch.setattr(mcp_backup, "ensure_recent_backup", boom)
    resp = server.handle_initialize({})
    assert resp["serverInfo"]
    with pytest.raises(McpError, match="write_blocked"):
        server.handle_tool_call("create_manual_session", {...})

def test_rotation_keeps_20_and_survives_missing_file(tmp_path):
    ...
```

---

## 7. Obejście na teraz (zanim wejdą poprawki)

1. Zamknij Claude Desktop.
2. Opróżnij folder `mcp_backups` (albo przenieś zawartość w inne miejsce — nie kasuj bezpowrotnie, dopóki nie masz świeżej kopii bazy).
3. Usuń wpis `timeflow` używający `npx mcp-remote` i zastąp go wpisem `"type": "http"` z sekcji 4.3.
4. **Zregeneruj token dostępu** — obecny (`8c6f0108…`) był na zrzutach ekranu wysłanych do rozmowy.
5. Uruchom Claude Desktop.

Punkt 2 rozwiązuje objaw, ale kolizja wróci przy następnym równoległym starcie sesji — dopóki nie wejdzie zmiana nr 1 z tabeli.
