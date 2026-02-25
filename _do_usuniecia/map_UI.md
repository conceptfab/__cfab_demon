# Mapa Interfejsu Użytkownika (UI Map)

Ten dokument opisuje strukturę widoków i elementów interfejsu aplikacji oraz przypisuje im odpowiednie pliki źródłowe.

## 1. Układ Główny (Core Layout)
Główny szkielet aplikacji, który pozostaje stały podczas nawigacji.
*   **Główny Kontener**: `src/components/layout/MainLayout.tsx`
*   **Pasek Boczny (Sidebar)**: `src/components/layout/Sidebar.tsx` – Główne menu nawigacyjne z listą zakładek.
*   **Pasek Górny (TopBar)**: `src/components/layout/TopBar.tsx` – Nagłówek z nazwą aplikacji i przyciskiem zgłaszania błędów.

## 2. Widoki (Strony / Zakładki)
Główne widoki aplikacji ładowane dynamicznie, zlokalizowane w `src/pages/`.

| Widok | Plik | Opis |
| :--- | :--- | :--- |
| **Panel Główny** | `Dashboard.tsx` | Statystyki ogólne, wykresy aktywności, oś czasu dnia. |
| **Projekty** | `Projects.tsx` | Lista projektów, dodawanie/edycja, przypisywanie kolorów i budżetów. |
| **Sesje** | `Sessions.tsx` | Szczegółowa lista zarejestrowanych bloków pracy (sesji). |
| **Analiza Czasu** | `TimeAnalysis.tsx` | Zaawansowane zestawienia czasu w ujęciu dziennym, tygodniowym i miesięcznym. |
| **Estymacje** | `Estimates.tsx` | Zarządzanie wycenami i śledzenie realizacji budżetów projektowych. |
| **Aplikacje** | `Applications.tsx` | Statystyki używanych programów i zarządzanie regułami automatycznego przypisywania. |
| **AI (Sztuczna Inteligencja)** | `AI.tsx` | Widok poświęcony automatyzacji i sugestiom AI. |
| **Ustawienia** | `Settings.tsx` | Konfiguracja aplikacji, interwały zapisu, integracje. |
| **Zarządzanie Danymi** | `Data.tsx` | Narzędzia do importu, eksportu i czyszczenia bazy danych. |
| **Pomoc** | `Help.tsx` | Centrum pomocy i dokumentacja użytkownika. |
| **Szybki Start** | `QuickStart.tsx` | Tutorial wprowadzający dla nowych użytkowników. |
| **Kontrola Demona** | `DaemonControl.tsx` | Monitoring stanu procesu tła zbierającego dane. |

## 3. Kluczowe Elementy i Komponenty UI

### Menu Kontekstowe (Context Menu)
Aplikacja wykorzystuje dedykowane menu kontekstowe (prawy przycisk myszy) w kluczowych miejscach:
*   **Lista Sesji**: `src/pages/Sessions.tsx` – Akcje: przypisz do projektu, boost (x2), dodaj komentarz, usuń.
*   **Oś Czasu (Timeline)**: `src/components/dashboard/ProjectDayTimeline.tsx` – Szybkie zarządzanie blokami czasu bezpośrednio na wykresie.

### Okna Dialogowe i Modale
*   **Uniwersalny Prompt**: `src/components/ui/prompt-modal.tsx` – Standaryzowane okno do wprowadzania tekstu/wartości.
*   **Dodawanie Sesji**: `src/components/ManualSessionDialog.tsx` – Formularz ręcznego wprowadzania czasu pracy.
*   **Zgłaszanie Błędów**: `src/components/layout/BugHunter.tsx` – Modal do wysyłania raportów technicznych.

### Komponenty Analityczne (Dashboard/Analiza)
*   **Wykresy**:
    *   `src/components/dashboard/TimelineChart.tsx`: Wykres słupkowy aktywności.
    *   `src/components/dashboard/AllProjectsChart.tsx`: Udział projektów w czasie.
    *   `src/components/dashboard/TopAppsChart.tsx`: Wykres najczęściej używanych aplikacji.
*   **Widoki Analizy**:
    *   `src/components/time-analysis/DailyView.tsx`, `WeeklyView.tsx`, `MonthlyView.tsx`.

### Atomy UI (Standardowe komponenty)
Zlokalizowane w `src/components/ui/`, oparte na systemie designu:
*   `button.tsx`, `badge.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `select.tsx`, `tabs.tsx`, `toast-notification.tsx`.

## 4. Wykaz wszystkich wymienionych plików
Poniżej znajduje się pełna lista plików wymienionych w dokumencie:

1.  `src/components/layout/MainLayout.tsx`
2.  `src/components/layout/Sidebar.tsx`
3.  `src/components/layout/TopBar.tsx`
4.  `src/pages/Dashboard.tsx`
5.  `src/pages/Projects.tsx`
6.  `src/pages/Sessions.tsx`
7.  `src/pages/TimeAnalysis.tsx`
8.  `src/pages/Estimates.tsx`
9.  `src/pages/Applications.tsx`
10. `src/pages/AI.tsx`
11. `src/pages/Settings.tsx`
12. `src/pages/Data.tsx`
13. `src/pages/Help.tsx`
14. `src/pages/QuickStart.tsx`
15. `src/pages/DaemonControl.tsx`
16. `src/components/dashboard/ProjectDayTimeline.tsx`
17. `src/components/ui/prompt-modal.tsx`
18. `src/components/ManualSessionDialog.tsx`
19. `src/components/layout/BugHunter.tsx`
20. `src/components/dashboard/TimelineChart.tsx`
21. `src/components/dashboard/AllProjectsChart.tsx`
22. `src/components/dashboard/TopAppsChart.tsx`
23. `src/components/time-analysis/DailyView.tsx`
24. `src/components/time-analysis/WeeklyView.tsx`
25. `src/components/time-analysis/MonthlyView.tsx`
26. `src/components/ui/button.tsx`
27. `src/components/ui/badge.tsx`
28. `src/components/ui/card.tsx`
29. `src/components/ui/dialog.tsx`
30. `src/components/ui/input.tsx`
31. `src/components/ui/select.tsx`
32. `src/components/ui/tabs.tsx`
33. `src/components/ui/toast-notification.tsx`

