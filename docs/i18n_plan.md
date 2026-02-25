# Plan Implementacji Systemu Tłumaczeń (i18n)

Dokument opisuje strategię przejścia na wielojęzyczność w aplikacji TIMEFLOW.

## 1. Wybór Technologii
Zalecane rozwiązanie: **react-i18next** wraz z **i18next**.
- **Zalety**: Standard w ekosystemie React, obsługa leniwego ładowania (lazy loading), wsparcie dla języka rts, łatwa integracja z systemem budowania.

## 2. Struktura Plików
Tłumaczenia powinny być przechowywane w formacie JSON w dedykowanym folderze:
```
dashboard/src/locales/
├── en/
│   └── common.json
└── pl/
    └── common.json
```

## 3. Klucze i Grupowanie
Na bazie dokumentu `strings.md`, klucze powinny być pogrupowane modułowo:
- `layout.*`: Sidebar, TopBar, stopka.
- `dashboard.*`: Statystyki, wykresy, banery.
- `projects.*`: Akcje, dialogi, statusy projektów.
- `sessions.*`: Menu kontekstowe, filtry sesji.
- `ui.*`: Modale, przyciski ogólne (Cancel, Save).

Przykład `pl/common.json`:
```json
{
  "layout": {
    "sidebar": {
      "dashboard": "Panel Główny",
      "sessions": "Sesje",
      "projects": "Projekty"
    }
  },
  "ui": {
    "confirm": "Potwierdź",
    "cancel": "Anuluj"
  }
}
```

## 4. Etapy Implementacji

### Faza 1: Konfiguracja (Setup)
1. Instalacja bibliotek: `npm install i18next react-i18next i18next-browser-languagedetector`.
2. Utworzenie pliku `src/i18n.ts` z bazową konfiguracją.
3. Import `i18n.ts` w `main.tsx`.

### Faza 2: Abstrakcja Tekstów (Extraction)
1. Zamiana tekstów "na sztywno" na hook `useTranslation()`:
   - Zamiast: `<span>Dashboard</span>`
   - Używamy: `<span>{t('layout.sidebar.dashboard')}</span>`
2. Przeniesienie wszystkich tekstów z `strings.md` do plików JSON.

### Faza 3: Przełącznik Języka
1. Dodanie komponentu wyboru języka (np. w `Settings.tsx` lub `Sidebar.tsx`).
2. Integracja z lokalnym stanem (persist języka w `localStorage`).

## 5. Dobre Praktyki
- **Brak brakujących kluczy**: Użycie narzędzi typu `i18next-scanner` do automatycznego wykrywania nieprzetłumaczonych fraz.
- **Parametryzacja**: Używanie zmiennych w tłumaczeniach, np. `"found_sessions": "Znaleziono {{count}} sesji"`.
- **Obsługa dat**: Użycie istniejącej biblioteki `date-fns` z odpowiednim locale w połączeniu z i18next.
