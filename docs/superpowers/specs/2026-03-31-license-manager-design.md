# TIMEFLOW License Manager — Design Spec

## 1. Kontekst

TIMEFLOW wymaga systemu licencji do serializacji klientów synchronizacji online (szczegoly w `online.md`, sekcja 14). Na tym etapie potrzebne jest narzedzie do recznego generowania i zarzadzania kluczami licencji. Docelowo generowanie bedzie automatyczne (po platnosci/rejestracji).

## 2. Architektura

Dwa komponenty:

1. **Admin API na serwerze** (`__server`) — endpointy CRUD licencji, grup, urzadzen
2. **Aplikacja desktopowa PyQt6** (`tools/license-manager/`) — UI do zarzadzania, laczy sie z serwerem przez Admin API

### Przeplow

```
PyQt6 App (lokalny komputer)  ──HTTPS──>  Serwer sync (online)
                                            │
                                            ├── Admin API (/api/admin/*)
                                            ├── License Store (data/license-store.json)
                                            └── Istniejace endpointy sync
```

## 3. Admin API — Serwer

### 3.1 Endpointy

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/admin/license` | POST | Tworzenie licencji (generowanie klucza) |
| `/api/admin/license` | GET | Lista wszystkich licencji |
| `/api/admin/license/[id]` | GET | Szczegoly licencji |
| `/api/admin/license/[id]` | PATCH | Edycja (plan, status, limity, expiresAt) |
| `/api/admin/license/[id]` | DELETE | Usuniecie licencji |
| `/api/admin/license/[id]/devices` | GET | Lista urzadzen przypisanych do licencji |
| `/api/admin/license/[id]/devices/[deviceId]` | DELETE | Odrejestrowanie urzadzenia |
| `/api/admin/group` | POST | Tworzenie grupy klientow |
| `/api/admin/group` | GET | Lista grup |
| `/api/admin/group/[id]` | PATCH | Edycja grupy |

### 3.2 Autoryzacja

Osobny `ADMIN_API_TOKEN` w `.env` serwera. Naglowek `Authorization: Bearer <admin_token>`. Middleware sprawdza token przed kazdym endpointem `/api/admin/*`.

### 3.3 Storage

Plik `data/license-store.json` z mutexem (analogicznie do istniejacego `sync-store.json`).

```typescript
interface LicenseStoreFile {
  version: 1;
  licenses: Record<string, License>;           // id -> License
  groups: Record<string, ClientGroup>;          // id -> ClientGroup
  devices: Record<string, DeviceRegistration>;  // deviceId -> DeviceRegistration
}
```

### 3.4 Modele danych

Z `online.md` sekcja 14.2:

```typescript
interface License {
  id: string;                        // UUID
  licenseKey: string;                // "TF-PRO-2026-XXXX-XXXX-XXXX"
  groupId: string;                   // grupa klientow
  plan: "free" | "starter" | "pro" | "enterprise";
  status: "active" | "trial" | "expired" | "suspended" | "revoked";
  createdAt: string;                 // ISO 8601
  expiresAt: string | null;          // null = bezterminowa
  maxDevices: number;
  activeDevices: string[];           // lista zarejestrowanych device_id
}

interface ClientGroup {
  id: string;                        // UUID
  name: string;                      // np. "Firma XYZ"
  ownerId: string;                   // userId wlasciciela
  licenseId: string;
  storageBackendId: string;          // przypisany backend storage
  fixedMasterDeviceId: string | null;
  syncPriority: Record<string, number>;
  maxSyncFrequencyHours: number | null;
  maxDatabaseSizeMb: number | null;
}

interface DeviceRegistration {
  deviceId: string;
  groupId: string;
  licenseId: string;
  deviceName: string;
  registeredAt: string;
  lastSeenAt: string;
  lastSyncAt: string | null;
  lastMarkerHash: string | null;
  isFixedMaster: boolean;
}
```

### 3.5 Generowanie klucza licencji

Format: `TF-{PLAN}-{ROK}-{XXXX}-{XXXX}-{XXXX}`
Przyklad: `TF-PRO-2026-A7K2-M9X4-R3J8`

- Segmenty XXXX: losowe znaki alfanumeryczne (A-Z, 0-9, bez mylacych: 0/O, 1/I/L)
- Ostatni segment: CRC16 reszty klucza (walidacja offline)
- Serwer generuje klucz przy POST /api/admin/license

### 3.6 Plany i domyslne limity

| Cecha | free | starter | pro | enterprise |
|-------|------|---------|-----|------------|
| Max urzadzen | 2 | 5 | 20 | bez limitu (9999) |
| Max rozmiar bazy | 50 MB | 200 MB | 1 GB | konfigurowalny |
| Min interwal sync | 24h | 8h | 1h | 15 min |

## 4. Aplikacja PyQt6 — License Manager

### 4.1 Glowne okno

Tabela licencji z kolumnami:
- Klucz licencji
- Plan
- Status
- Grupa
- Max urzadzen
- Aktywne urzadzenia (count)
- Data wygasniecia

Toolbar: Nowa licencja, Edytuj, Usun, Odswież.

### 4.2 Dialogi

- **Nowa licencja** — plan (combo), grupa (combo + "nowa"), max urzadzen, data wygasniecia. Przycisk "Generuj" -> POST -> wyswietla klucz + "Kopiuj do schowka".
- **Edycja licencji** — zmiana planu, statusu, limitow, daty wygasniecia.
- **Nowa grupa** — nazwa, ownerId, fixedMasterDeviceId (opcjonalne).
- **Szczegoly licencji** — lista urzadzen z mozliwoscia odrejestrowania.
- **Ustawienia** — URL serwera, admin token.

### 4.3 Konfiguracja polaczenia

Pierwsze uruchomienie: dialog z URL serwera + admin token.
Zapis: `~/.timeflow-admin/config.json`.
Zmiana: menu Ustawienia.

### 4.4 Struktura plikow

```
tools/license-manager/
├── main.py                  # Entry point
├── config.py                # Konfiguracja polaczenia
├── api_client.py            # Komunikacja z Admin API
├── models.py                # Dataclassy: License, ClientGroup, DeviceRegistration
├── main_window.py           # Glowne okno z tabela licencji
├── dialogs/
│   ├── license_dialog.py    # Tworzenie/edycja licencji
│   ├── group_dialog.py      # Tworzenie/edycja grupy
│   ├── device_list_dialog.py # Lista urzadzen
│   └── settings_dialog.py   # Konfiguracja polaczenia
└── requirements.txt         # PyQt6, requests
```

### 4.5 Obsluga bledow

- **Brak polaczenia** — komunikat "Nie mozna polaczyc z serwerem", przycisk "Ponow"
- **401 Unauthorized** — "Nieprawidlowy admin token", otwiera dialog ustawien
- **Blad walidacji (400)** — wyswietla szczegoly z odpowiedzi serwera
- **Timeout** — 10s na request, komunikat + ponow

## 5. Zakres v1.0

### W zakresie
- CRUD licencji (tworzenie, lista, edycja statusu/planu/limitow, usuwanie)
- CRUD grup
- Przegladanie i odrejestrowywanie urzadzen
- Generowanie kluczy z CRC16
- Kopiowanie klucza do schowka

### Poza zakresem (na pozniej)
- Automatyczne generowanie po platnosci
- Statystyki uzycia / historia sync
- Eksport/import CSV
- Multi-user admin z rolami
- Endpointy klienckie (/license/activate, /license/status) — osobna faza
