# TIMEFLOW — Architecture Map

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph "Windows OS"
        subgraph "Rust Daemon (src/)"
            MAIN[main.rs<br/>Entry & Orchestrator]
            TRACKER[tracker.rs<br/>Activity Loop]
            MONITOR[monitor.rs<br/>WinAPI Process]
            FGHOOK[foreground_hook.rs<br/>SetWinEventHook]
            STORAGE[storage.rs<br/>SQLite Daily Store]
            CONFIG[config.rs<br/>Config Loader]
            TRAY[tray.rs<br/>System Tray UI]
            FIREWALL[firewall.rs<br/>UDP/TCP Rules]
            SINGLE[single_instance.rs<br/>Mutex Guard]
            I18N[i18n.rs<br/>PL/EN Tray Strings]
        end

        subgraph "Tauri Dashboard (dashboard/src/)"
            APP[App.tsx<br/>Router + Layout]
            STORES[(Zustand Stores)]
            TAURI_API[lib/tauri/*<br/>14 API Modules]
            BG[BackgroundServices.tsx<br/>Job Pool]
            PAGES[16 Pages]
        end
    end

    subgraph "Network"
        LAN_PEER[LAN Peer<br/>Port 47891/47892]
        ONLINE_SRV[Online Sync Server<br/>SFTP + REST API]
    end

    subgraph "Storage (%APPDATA%/TimeFlow)"
        DAILY_DB[(daily_store.db)]
        DASH_DB[(timeflow_dashboard.db)]
        JSON_CFG[JSON Config Files]
        LOGS[Logs]
    end

    MAIN --> TRACKER
    MAIN --> FGHOOK
    MAIN --> TRAY
    MAIN --> FIREWALL
    MAIN --> SINGLE

    TRACKER --> MONITOR
    TRACKER --> STORAGE
    TRACKER --> CONFIG
    FGHOOK -.->|wake signal| TRACKER

    STORAGE --> DAILY_DB
    CONFIG --> JSON_CFG
    CONFIG --> DASH_DB

    APP --> PAGES
    PAGES --> STORES
    PAGES --> TAURI_API
    TAURI_API -->|invoke| DASH_DB
    TAURI_API -->|read| DAILY_DB
    BG --> TAURI_API

    MAIN -.->|LAN Discovery<br/>UDP 47892| LAN_PEER
    MAIN -.->|LAN Sync<br/>TCP 47891| LAN_PEER
    MAIN -.->|Online Sync<br/>SFTP + HTTPS| ONLINE_SRV

    TRAY --> I18N

    style MAIN fill:#4a9eff,color:#fff
    style APP fill:#4a9eff,color:#fff
    style DAILY_DB fill:#f59e0b,color:#000
    style DASH_DB fill:#f59e0b,color:#000
```

## 2. Daemon Thread Architecture

```mermaid
graph LR
    subgraph "Main Thread"
        INIT[Init & Config]
        SPAWN[Spawn Threads]
        TRAY_LOOP[Tray Event Loop<br/>blocks main]
    end

    subgraph "Tracker Thread"
        POLL[Poll Loop 10s]
        FG[Foreground Track]
        BG_CPU[Background CPU]
        SAVE[Save to SQLite 5min]
        CFG_RELOAD[Config Reload 30s]
    end

    subgraph "Foreground Hook Thread"
        HOOK[SetWinEventHook]
        MSG_PUMP[Win Message Pump]
    end

    subgraph "LAN Discovery Thread"
        BEACON[UDP Beacon 30s<br/>Port 47892]
        LISTEN[Listen for Peers]
        CACHE[lan_peers.json]
    end

    subgraph "LAN Server Thread"
        HTTP[TCP Listener<br/>Port 47891]
        ENDPOINTS[Sync Endpoints]
    end

    subgraph "Sync Threads (on-demand)"
        LAN_ORCH[LAN Orchestrator<br/>13-step FSM]
        ONLINE[Online Sync<br/>13-step + SFTP]
    end

    INIT --> SPAWN
    SPAWN --> POLL
    SPAWN --> HOOK
    SPAWN --> BEACON
    SPAWN --> HTTP
    SPAWN --> TRAY_LOOP

    HOOK -.->|wake signal| POLL
    POLL --> FG
    POLL --> BG_CPU
    POLL --> SAVE
    POLL --> CFG_RELOAD

    BEACON --> CACHE
    LISTEN --> CACHE

    TRAY_LOOP -.->|manual trigger| LAN_ORCH
    TRAY_LOOP -.->|manual trigger| ONLINE
    BEACON -.->|auto trigger| LAN_ORCH

    style TRAY_LOOP fill:#ef4444,color:#fff
    style POLL fill:#22c55e,color:#fff
    style LAN_ORCH fill:#a855f7,color:#fff
    style ONLINE fill:#a855f7,color:#fff
```

## 3. Daemon Data Flow (Monitor → Tracker → Storage)

```mermaid
flowchart TD
    subgraph "Input (WinAPI)"
        GFW[GetForegroundWindow]
        SNAP[CreateToolhelp32Snapshot]
        WMI[WMI CommandLine Query]
        IDLE[GetLastInputInfo<br/>Idle Detection]
    end

    subgraph "Processing (tracker.rs)"
        FG_INFO[get_foreground_info<br/>exe + title + path]
        PID_CACHE[(PidCache<br/>exe→metadata)]
        CPU_MEASURE[measure_cpu_for_app<br/>delta CPU time]
        RECORD[record_app_activity<br/>update DailyData]
        SESSION_GAP{Idle > 5min?}
    end

    subgraph "Storage"
        DAILY_DATA[DailyData in-memory]
        SQLITE[(daily_store.db<br/>daily_snapshots)]
        HB[heartbeat.txt]
    end

    GFW --> FG_INFO
    WMI --> PID_CACHE
    SNAP --> CPU_MEASURE

    FG_INFO --> PID_CACHE
    PID_CACHE --> RECORD
    CPU_MEASURE -->|CPU > 5%| RECORD
    IDLE --> SESSION_GAP
    SESSION_GAP -->|Yes| RECORD
    SESSION_GAP -->|No| RECORD

    RECORD --> DAILY_DATA
    DAILY_DATA -->|every 5min| SQLITE
    DAILY_DATA --> HB

    style SQLITE fill:#f59e0b,color:#000
    style DAILY_DATA fill:#22c55e,color:#fff
```

## 4. Dashboard Pages & Routing

```mermaid
graph TD
    subgraph "App.tsx (PageRouter)"
        ROUTER{currentPage<br/>switch}
    end

    subgraph "Core Pages"
        DASH[Dashboard<br/>Overview + Timeline]
        PROJ[Projects<br/>CRUD + Discovery]
        SESS[Sessions<br/>Virtual List + Filters]
        EST[Estimates<br/>Rates + Revenue]
        APPS[Applications<br/>Monitored Apps]
        TIME[TimeAnalysis<br/>Daily/Weekly/Monthly]
    end

    subgraph "AI & Control"
        AI[AI<br/>Model + Auto-assign]
        DAEMON[DaemonControl<br/>Start/Stop + Logs]
    end

    subgraph "Data & Settings"
        DATA[Data<br/>Import/Export + DB]
        IMPORT[ImportPage<br/>JSON Import]
        SETTINGS[Settings<br/>12 Cards]
        REPORTS[Reports<br/>Templates]
        REPORT_VIEW[ReportView<br/>Print-friendly]
    end

    subgraph "Info"
        HELP[Help<br/>Bilingual Tabs]
        QUICK[QuickStart<br/>Onboarding]
    end

    subgraph "Detail Views"
        PROJ_PAGE[ProjectPage<br/>Single Project Detail]
    end

    ROUTER --> DASH
    ROUTER --> PROJ
    ROUTER --> SESS
    ROUTER --> EST
    ROUTER --> APPS
    ROUTER --> TIME
    ROUTER --> AI
    ROUTER --> DAEMON
    ROUTER --> DATA
    ROUTER --> IMPORT
    ROUTER --> SETTINGS
    ROUTER --> REPORTS
    ROUTER --> REPORT_VIEW
    ROUTER --> HELP
    ROUTER --> QUICK
    ROUTER --> PROJ_PAGE

    PROJ -.->|projectPageId| PROJ_PAGE
    REPORTS -.->|templateId| REPORT_VIEW

    style ROUTER fill:#4a9eff,color:#fff
    style DASH fill:#22c55e,color:#fff
    style PROJ fill:#22c55e,color:#fff
    style SESS fill:#22c55e,color:#fff
```

## 5. Dashboard State Management & Data Flow

```mermaid
flowchart TD
    subgraph "Zustand Stores"
        UI[useUIStore<br/>currentPage, focus states<br/>firstRun, pageGuard]
        DATA_S[useDataStore<br/>dateRange, timePreset<br/>refreshKey, autoImport]
        SETTINGS_S[useSettingsStore<br/>language, currency<br/>workingHours, animations]
        BG_STATUS[useBackgroundStatusStore<br/>daemonStatus, aiStatus<br/>unassigned counts]
        PROJ_CACHE[useProjectsCacheStore<br/>allTimeProjects<br/>lazy + invalidation]
    end

    subgraph "Custom Events"
        LOCAL_CHG["LOCAL_DATA_CHANGED<br/>(invokeMutation)"]
        APP_REF["APP_REFRESH<br/>(triggerRefresh)"]
        AI_DONE["AI_ASSIGNMENT_DONE"]
        SYNC_DONE["ONLINE/LAN_SYNC_DONE"]
        PROJ_INV["PROJECTS_ALL_TIME<br/>_INVALIDATED"]
    end

    subgraph "Tauri API Layer (14 modules)"
        T_PROJ[projectsApi]
        T_SESS[sessionsApi]
        T_DASH[dashboardApi]
        T_DAEMON[daemonApi]
        T_AI[aiApi]
        T_APPS[applicationsApi]
        T_MANUAL[manualSessionsApi]
        T_DATA[dataApi]
        T_DB[databaseApi]
        T_SET[settingsApi]
        T_LAN[lanSyncApi]
        T_ONLINE[daemonOnlineSyncApi]
        T_LOG[logManagementApi]
    end

    subgraph "Tauri Backend"
        BACKEND["Tauri Commands<br/>(Rust)"]
    end

    T_PROJ & T_SESS & T_DASH & T_DAEMON & T_AI & T_APPS & T_MANUAL & T_DATA & T_DB & T_SET & T_LAN & T_ONLINE & T_LOG -->|invoke / invokeMutation| BACKEND

    BACKEND -->|result| T_PROJ & T_SESS & T_DASH

    LOCAL_CHG --> PROJ_CACHE
    LOCAL_CHG --> BG_STATUS
    APP_REF --> PROJ_CACHE
    PROJ_INV --> PROJ_CACHE
    AI_DONE -.->|toast| UI
    SYNC_DONE -.->|toast| UI

    DATA_S -->|triggerRefresh| APP_REF

    style UI fill:#818cf8,color:#fff
    style DATA_S fill:#818cf8,color:#fff
    style SETTINGS_S fill:#818cf8,color:#fff
    style BG_STATUS fill:#818cf8,color:#fff
    style PROJ_CACHE fill:#818cf8,color:#fff
    style BACKEND fill:#4a9eff,color:#fff
```

## 6. Background Services Job Pool

```mermaid
flowchart TD
    TICK["setInterval 1s tick"] --> CHECK{Which jobs due?}

    CHECK -->|30s| DIAG[Daemon Diagnostics<br/>getDaemonStatus]
    CHECK -->|60s| REFRESH[Refresh Today<br/>getSessions + getTimeline]
    CHECK -->|30s| FILESIG[File Signature Check<br/>getTodayFileSignature]
    CHECK -->|varies| AUTOSPLIT[Auto-split Analysis<br/>analyzeSessionsSplittable]
    CHECK -->|N hours| ONLINE_SYNC[Online Sync Interval<br/>runOnlineSyncOnce]
    CHECK -->|N hours| LAN_SYNC[LAN Sync Interval<br/>runLanSyncInterval]
    CHECK -->|on error| SSE_RECONNECT[SSE Reconnect<br/>exponential backoff]

    subgraph "Event Triggers"
        VIS[visibility change<br/>500ms debounce]
        LOCAL[LOCAL_DATA_CHANGED<br/>120ms refresh<br/>1.5s sync]
        STARTUP[App Mount<br/>autoImport + AI]
    end

    VIS --> CHECK
    LOCAL --> CHECK
    STARTUP -->|once| AUTOIMPORT[autoImportFromDataDir]
    STARTUP -->|once| AI_RUN[autoRunIfNeeded<br/>+ deterministic assign]

    DIAG --> BG_STATUS[(useBackgroundStatusStore)]
    REFRESH --> DATA_S[(useDataStore.triggerRefresh)]

    style TICK fill:#ef4444,color:#fff
    style BG_STATUS fill:#818cf8,color:#fff
    style DATA_S fill:#818cf8,color:#fff
```

## 7. Sync Architecture

### 7a. LAN Sync

```mermaid
sequenceDiagram
    participant D as Discovery<br/>UDP 47892
    participant A as Device A<br/>(Master)
    participant B as Device B<br/>(Slave)
    participant DB_A as daily_store.db<br/>(A)
    participant DB_B as daily_store.db<br/>(B)

    loop Every 30s
        D->>D: Broadcast beacon
        D->>A: Peer found
    end

    Note over A,B: 13-Step Sync State Machine

    A->>B: POST /sync/negotiate (role, hashes)
    B->>A: Accept (role confirmed)

    A->>DB_A: Freeze DB (AtomicBool)
    B->>DB_B: Freeze DB

    A->>A: Build table hashes (FNV-1a)
    B->>B: Build table hashes
    A->>B: POST /sync/hashes
    B->>A: Hash comparison result

    alt Hashes differ
        A->>A: Export delta (DEFLATE compressed)
        A->>B: POST /sync/upload (delta)
        B->>B: Apply delta to DB
        B->>B: Export delta
        B->>A: POST /sync/download (delta)
        A->>A: Apply delta to DB
    end

    A->>A: Insert sync marker
    B->>B: Insert sync marker
    A->>DB_A: Unfreeze DB
    B->>DB_B: Unfreeze DB

    Note over A,B: Emit LAN_SYNC_DONE event
```

### 7b. Online Sync

```mermaid
sequenceDiagram
    participant DASH as Dashboard
    participant SSE as SSE Connection
    participant SRV as Sync Server<br/>(REST + SFTP)
    participant DAEMON as Daemon

    DASH->>SSE: Connect EventSource<br/>/api/sync/events
    
    SRV->>SSE: sync_available event
    SSE->>DASH: Trigger pull

    DASH->>SRV: POST /api/sync/session/create
    SRV->>DASH: Session + SFTP credentials<br/>(AES-256-GCM encrypted)

    DASH->>DASH: Decrypt credentials
    DASH->>DASH: Build delta archive

    DASH->>SRV: SFTP upload (delta)
    Note over DASH,SRV: Progress callbacks

    SRV->>DASH: SFTP download (merged delta)
    DASH->>DASH: Apply delta to dashboard.db

    DASH->>DASH: Emit PROJECTS_ALL_TIME_INVALIDATED
    DASH->>DASH: Emit ONLINE_SYNC_DONE

    par Daemon async sync
        DASH->>DAEMON: triggerDaemonOnlineSync
        DAEMON->>SRV: SFTP upload/download<br/>(daily_store delta)
    end
```

## 8. File & Storage Map

```mermaid
graph TD
    subgraph "%APPDATA%/TimeFlow/"
        subgraph "Databases"
            DASH_DB[(timeflow_dashboard.db<br/>Projects, Apps, Sessions<br/>Manual Sessions, Settings)]
            DAILY_DB[(data/daily_store.db<br/>daily_snapshots JSON<br/>sync_markers)]
        end

        subgraph "Config (JSON) — Dashboard writes, Daemon reads"
            MON_APPS[monitored_apps.json]
            LAN_SET[lan_sync_settings.json]
            ONLINE_SET[online_sync_settings.json]
            LOG_SET[log_settings.json]
            LANG[language.json]
        end

        subgraph "State Files"
            DEVICE[device_id.txt<br/>generated once]
            HB[heartbeat.txt<br/>every 10s]
            PEERS[lan_peers.json<br/>every 30s]
        end

        subgraph "Logs"
            DAEMON_LOG[logs/daemon.log]
            LAN_LOG[logs/lan_sync.log]
        end

        subgraph "Backup & Archive"
            BACKUP[sync_backups/<br/>max 5 .db files]
            ARCHIVE[archive/<br/>daily snapshots]
            IMPORT_DIR[import/<br/>temp import files]
        end
    end

    subgraph "Writers"
        D[Daemon]
        DASH[Dashboard]
    end

    D -->|RW| DAILY_DB
    D -->|R| DASH_DB
    D -->|R| MON_APPS & LAN_SET & ONLINE_SET & LOG_SET & LANG
    D -->|W| HB & PEERS & DEVICE
    D -->|W| DAEMON_LOG & LAN_LOG
    D -->|W| BACKUP

    DASH -->|RW| DASH_DB
    DASH -->|R| DAILY_DB
    DASH -->|W| MON_APPS & LAN_SET & ONLINE_SET & LOG_SET & LANG
    DASH -->|R| PEERS
    DASH -->|RW| ARCHIVE & IMPORT_DIR

    style DASH_DB fill:#f59e0b,color:#000
    style DAILY_DB fill:#f59e0b,color:#000
    style D fill:#ef4444,color:#fff
    style DASH fill:#4a9eff,color:#fff
```

## 9. Component Hierarchy (Dashboard)

```mermaid
graph TD
    subgraph "Root"
        ERR[ErrorBoundary]
        TOAST[ToastProvider]
        TT[TooltipProvider]
    end

    subgraph "App Shell"
        SPLASH[SplashScreen<br/>until autoImportDone]
        BG_SVC[BackgroundServices<br/>hidden, job pool]
        MAIN_LAYOUT[MainLayout]
    end

    subgraph "MainLayout"
        TOPBAR[TopBar]
        SIDEBAR[Sidebar<br/>Navigation + Shortcuts]
        ROUTER[PageRouter<br/>Lazy Suspense]
    end

    subgraph "Shared UI (16 components)"
        BTN[button] 
        CARD[card]
        DLG[dialog / confirm-dialog]
        DRNG[DateRangeToolbar]
        BADGE[badge]
        PROG[progress]
        INP[input / select / switch]
    end

    subgraph "Domain Components"
        direction LR
        DASH_C[Dashboard 6<br/>MetricCard, TimelineChart<br/>AllProjectsChart...]
        PROJ_C[Projects 12<br/>ProjectCard, CreateDialog<br/>DiscoveryPanel...]
        SESS_C[Sessions 9<br/>VirtualList, SessionRow<br/>SplitModal, Toolbar...]
        AI_C[AI 6<br/>StatusCard, Metrics<br/>BatchActions...]
        SET_C[Settings 12<br/>OnlineSyncCard<br/>LanSyncCard...]
        SYNC_C[Sync 4<br/>SyncOverlay<br/>PeerNotification...]
        DATA_C[Data 5<br/>ImportPanel<br/>ExportPanel...]
        TIME_C[TimeAnalysis 3<br/>Daily/Weekly/Monthly]
    end

    ERR --> TOAST --> TT --> SPLASH
    TT --> BG_SVC
    TT --> MAIN_LAYOUT
    MAIN_LAYOUT --> TOPBAR
    MAIN_LAYOUT --> SIDEBAR
    MAIN_LAYOUT --> ROUTER

    ROUTER --> DASH_C & PROJ_C & SESS_C & AI_C & SET_C & DATA_C & TIME_C
    SET_C --> SYNC_C

    style ERR fill:#ef4444,color:#fff
    style ROUTER fill:#4a9eff,color:#fff
    style BG_SVC fill:#22c55e,color:#fff
```

## 10. Hooks & Data Fetching

```mermaid
graph LR
    subgraph "Data Hooks"
        H_PROJ[useProjectsData<br/>projects + estimates]
        H_SESS[useSessionsData<br/>sessions + pagination]
        H_FILT[useSessionsFilters<br/>date/project/app/text]
    end

    subgraph "Action Hooks"
        H_ACT[useSessionActions<br/>assign, delete, update]
        H_BULK[useSessionBulkActions<br/>batch ops]
        H_CTX[useSessionContextMenu<br/>right-click]
    end

    subgraph "Analysis Hooks"
        H_SCORE[useSessionScoreBreakdown]
        H_SPLIT[useSessionSplitAnalysis]
    end

    subgraph "Settings Hooks"
        H_FORM[useSettingsFormState]
        H_DEMO[useSettingsDemoMode]
    end

    subgraph "Event Hooks"
        H_REFRESH[usePageRefreshListener<br/>APP_REFRESH_EVENT]
    end

    subgraph "Stores"
        S_DATA[useDataStore]
        S_UI[useUIStore]
    end

    H_FILT --> H_SESS
    H_SESS --> S_DATA
    H_PROJ --> S_DATA
    H_REFRESH --> S_DATA
    H_ACT -->|invokeMutation| LOCAL_CHG[LOCAL_DATA_CHANGED]
    H_BULK -->|invokeMutation| LOCAL_CHG
    LOCAL_CHG --> S_DATA

    style S_DATA fill:#818cf8,color:#fff
    style S_UI fill:#818cf8,color:#fff
```
