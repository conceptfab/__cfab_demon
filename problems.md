# Znane Problemy

- Projekty dodane do listy exclude nadal pojawiają się na liście projektów. (Dlaczego?)
  - **Wyjaśnienie**: Funkcje statystyczne używane na Dashboardzie (`compute_project_activity_unique` oraz `query_project_counts`) nie filtrowały projektów po kolumnie `excluded_at`. W rezultacie, o ile w głównym spisie projektów (sidebar) projekt znikał, o tyle w sekcjach "Top Projects" czy na wykresach nadal był widoczny, jeśli miał zarejestrowany czas.
