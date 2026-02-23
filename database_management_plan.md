# Plan implementacji Zarządzania Bazą Danych (Zakładka DATA)

## 1. Warstwa Backendowa (Rust - Tauri)
Nowe funkcjonalności w silniku Tauri do bezpośredniej obsługi SQLite.

### Nowy moduł: `commands/database.rs`
- `get_db_info`: Zwraca ścieżkę do pliku `.db` oraz jego rozmiar na dysku.
- `vacuum_database`: Wykonuje komendę `VACUUM`.
- `get_database_settings`: Pobiera konfigurację z nowej tabeli `system_settings`.
- `update_database_settings`: Zapisuje konfigurację (auto-vacuum, backup path, interval).
- `perform_manual_backup`: Kopiuje plik bazy do wskazanego folderu (`backup_YYYY-MM-DD.db`).
- `restore_database`: Podmienia aktywny plik bazy (wymaga obsługi zamknięcia połączeń).

### Inicjalizacja (`db.rs`)
- Implementacja `VACUUM` podczas startupu, jeśli flaga w ustawieniach jest aktywna.
- Dodanie tabeli `system_settings` do schematu.

---

## 2. Warstwa Danych (SQLite)
Dodanie tabeli przechowującej stan systemu:
```sql
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```
Klucze do obsługi:
- `vacuum_on_startup` (bool)
- `backup_enabled` (bool)
- `backup_path` (text)
- `backup_interval_days` (int)
- `last_backup_at` (timestamp)

---

## 3. Warstwa Frontendowa (React / TS)

### Nowe Komponenty w `src/components/data/`:
- **DatabaseMaintenance.tsx**: 
  - Rozmiar bazy, ścieżka do pliku.
  - Przycisk "Open Folder" (używając `open` z `@tauri-apps/plugin-shell` lub systemowego explorer).
  - Sekcja VACUUM (checkbox + przycisk manualny).
- **BackupPanel.tsx**:
  - Konfiguracja automatycznego backupu (on/off, interval).
  - Wybór folderu docelowego (Tauri Dialog).
  - Informacje o dacie ostatniego i następnego backupu.
  - Przycisk "Backup Now".
- **DatabaseRestore.tsx**:
  - Przycisk do wyboru pliku `.db` i przywrócenia bazy.

---

## 4. Kroki wdrożenia
1. **Faza Rust 1**: Dodanie komend diagnostycznych (ścieżka, rozmiar, vacuum).
2. **Faza DB**: Rozszerzenie schematu o tabelę ustawień.
3. **Faza UI 1**: Implementacja panelu diagnostycznego w zakładce DATA.
4. **Faza Rust 2**: Logika backupu (kopiowanie plików, sprawdzanie interwałów).
5. **Faza UI 2**: Pełna konfiguracja backupu i przywracania.
