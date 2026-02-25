# UI Strings

Ten dokument zawiera listę tekstów (stringów) występujących w interfejsu użytkownika, pogrupowanych według plików.

## 1. Paski boczne i nagłówki (Layout)

### `src/components/layout/Sidebar.tsx`
- **Tytuł**: `TIMEFLOW`
- **Nawigacja**: `Dashboard`, `Sessions`, `Projects`, `Estimates`, `Applications`, `Time Analysis`, `AI & Model`, `Data`, `Daemon`
- **Statusy**: `Sync`, `AI Mode`, `Backup`, `Training`, `New Data`, `Safe`, `Running`, `Stopped`
- **Tooltipy**: `unassigned sessions today`, `unassigned sessions (all dates)`, `unassigned`, `new assignments since last training`, `Last backup:`, `BugHunter - report a bug`, `Quick Start`, `Help (F1)`, `Settings`
- **Wersja**: `v`, `VERSION INCOMPATIBILITY!`

### `src/components/layout/TopBar.tsx`
- **Aria-labels**: `Minimize window`, `Restore window`, `Maximize window`, `Close window`

## 2. Główne Widoki (Pages)

### `src/pages/Dashboard.tsx`
- **Przyciski**: `Refresh`, `Refreshing...`, `Today`, `Week`, `Month`, `All time`, `Open Sessions`
- **Banner Importu**: `Importing data from daemon...`, `Auto-import failed:`, `Auto-imported`, `file(s)`, `archived`, `already in database`, `error(s)`
- **Alert Sesji**: `sessions`, `are unassigned across`, `apps on`, `Please assign them manually.`
- **Karty Metryk**: `Total Tracked`, `Applications`, `Projects`, `active projects`, `Avg Daily`
- **Sekcje**: `Top 5 Projects`
- **Tooltipy**: `Previous period`, `Next period`

### `src/pages/Projects.tsx`
- **Akcje Projekty**: `Choose color`, `Change color`, `Hot project - top 5 by time`, `Imported`, `Reset time`, `Freeze project`, `Frozen since`, `Exclude project`, `Delete project permanently`
- **Dane Projektu**: `TOTAL TIME / VALUE`, `Boosted sessions:`, `Comments:`
- **Modale i Dialogi**: `Select Assigned Project Folder`, `Project name is required.`, `Project folder is required to identify tracked files.`, `Exclude this project? It can be restored later.`, `Delete project permanently?`, `Reset tracked time for this project? This cannot be undone.`, `Compact this project's data?`, `Please enter a folder path`, `Folder saved`, `Select Project Folder`, `Remove folder from project roots?`
- **Inne**: `D` (Duplicate marker), `Possible duplicate`, `Detailed`, `Compact`

### `src/pages/Sessions.tsx`
- **Nagłówki**: `sessions`, `projects`, `UNASSIGNED ONLY`
- **Filtry**: `Today`, `Week`, `Detailed`, `Compact`
- **Paginacja**: `Load older sessions...`
- **Status Sesji**: `No activity recorded for this period.`, `idle`, `No traceable activity`, `AI suggested:`, `Accept`, `Reject`
- **Menu Kontekstowe**: `Session actions`, `AI suggests:`, `Rate multiplier (default x2):`, `Boost x2`, `Custom...`, `Add comment`, `Edit comment`, `Assign to project`, `Unassigned`, `No projects available`

## 3. Komponenty UI i Modale

### `src/components/ui/prompt-modal.tsx`
- **Przyciski**: `Cancel`, `Confirm`

### `src/components/ManualSessionDialog.tsx`
- **Tytuł**: `Manual Session`, `Add Manual Session`, `Edit Manual Session`
- **Pola**: `Project`, `Start Time`, `End Time`, `Comment`
- **Status**: `Saving...`, `Save Session`

### `src/components/layout/BugHunter.tsx`
- **Tytuł**: `Report a Bug`
- **Pola**: `What happened?`, `Email (optional)`, `Send Report`, `Sending...`
- **Status**: `Bug report sent!`, `Failed to send report.`
