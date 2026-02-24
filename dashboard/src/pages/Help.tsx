import {
  LayoutDashboard,
  List,
  FolderKanban,
  CircleDollarSign,
  AppWindow,
  BarChart3,
  Brain,
  Import,
  Cpu,
  Activity,
  Settings,
  Info,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Help() {
  return (
    <div className="flex h-full flex-col p-8 space-y-8 overflow-y-auto max-w-6xl mx-auto">
      <div className="space-y-2 border-b border-border/10 pb-6">
        <h1 className="text-3xl font-light tracking-[0.1em]">Witaj w <span className="font-semibold tracking-[0.2em]">TIMEFLOW</span></h1>
        <p className="text-muted-foreground">Twoje centrum przejrzystości i efektywności pracy.</p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            O oprogramowaniu
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            <strong>TIMEFLOW</strong> to zaawansowany ekosystem do monitorowania czasu pracy, który działa dyskretnie w tle, pozwalając Ci skupić się na tym, co naprawdę ważne. 
            W przeciwieństwie do tradycyjnych narzędzi, TIMEFLOW inteligentnie analizuje aktywność okien, procesów oraz plików, aby precyzyjnie przypisać Twój czas do odpowiednich projektów.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-500" /> Automatyczne śledzenie
              </h4>
              <p className="text-xs text-muted-foreground">Daemon TIMEFLOW monitoruje używane aplikacje i aktywne dokumenty bez Twojej ingerencji.</p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Brain className="h-4 w-4 text-purple-400" /> Inteligentna kategoryzacja
              </h4>
              <p className="text-xs text-muted-foreground">Wykorzystujemy uczenie maszynowe (AI) do nauki Twoich nawyków i automatycznego porządkowania sesji.</p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <CircleDollarSign className="h-4 w-4 text-amber-500" /> Analiza finansowa
              </h4>
              <p className="text-xs text-muted-foreground">Zyskaj natychmiastowy wgląd w faktyczną wartość Twojej pracy dzięki systemowi stawek i wycen.</p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Settings className="h-4 w-4 text-blue-400" /> Prywatność i lokalność
              </h4>
              <p className="text-xs text-muted-foreground">Twoje dane są Twoją własnością. Wszystko jest przechowywane lokalnie w bezpiecznej bazie danych SQLite.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 pt-4">
        <h2 className="text-2xl font-light mb-6">Przewodnik po sekcjach</h2>
        
        <Tabs defaultValue="dashboard" orientation="vertical" className="flex flex-col md:flex-row gap-8 items-start">
          <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 w-full md:w-56 shrink-0">
            <HelpTabTrigger value="dashboard" icon={<LayoutDashboard className="h-3.5 w-3.5" />} label="DASHBOARD" />
            <HelpTabTrigger value="sessions" icon={<List className="h-3.5 w-3.5" />} label="SESSIONS" />
            <HelpTabTrigger value="projects" icon={<FolderKanban className="h-3.5 w-3.5" />} label="PROJECTS" />
            <HelpTabTrigger value="estimates" icon={<CircleDollarSign className="h-3.5 w-3.5" />} label="ESTIMATES" />
            <HelpTabTrigger value="apps" icon={<AppWindow className="h-3.5 w-3.5" />} label="APPLICATIONS" />
            <HelpTabTrigger value="analysis" icon={<BarChart3 className="h-3.5 w-3.5" />} label="TIME ANALYSIS" />
            <HelpTabTrigger value="ai" icon={<Brain className="h-3.5 w-3.5" />} label="AI & MODEL" />
            <HelpTabTrigger value="data" icon={<Import className="h-3.5 w-3.5" />} label="DATA" />
            <HelpTabTrigger value="daemon" icon={<Cpu className="h-3.5 w-3.5" />} label="DAEMON" />
            <HelpTabTrigger value="settings" icon={<Settings className="h-3.5 w-3.5" />} label="SETTINGS" />
          </TabsList>

          <div className="flex-1 min-w-0 w-full">
            <TabsContent value="dashboard" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<LayoutDashboard className="h-6 w-6" />}
                title="DASHBOARD"
                description="Szybki podgląd Twojej bieżącej aktywności i najważniejszych wskaźników wydajności."
                features={[
                  "Zintegrowane karty metryk (łączny śledzony czas, liczba aplikacji, aktywne projekty).",
                  "Interaktywna oś czasu z widokiem godzinowym (dzisiaj) lub dziennym (dłuższe okresy).",
                  "Zestawienie 'Top 5 Projektów' oraz analiza najczęściej używanych aplikacji.",
                  "Szybkie przełączanie zakresów czasowych: Dzisiaj, Tydzień, Miesiąc, Cały okres.",
                  "Tryb wizualizacji Timeline – pokazuje Twoje zaangażowanie w czasie rzeczywistym.",
                  "Powiadomienia o statusie auto-importu i ewentualnych błędach odczytu danych.",
                  "Przycisk odświeżania synchronizujący dane bezpośrednio z pracującego Daemona."
                ]}
              />
            </TabsContent>

            <TabsContent value="sessions" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<List className="h-6 w-6" />}
                title="SESSIONS"
                description="Szczegółowa lista wszystkich zarejestrowanych bloków aktywności w systemie."
                features={[
                  "Dodawanie komentarzy i notatek – kliknij prawym przyciskiem myszy na sesję, aby stworzyć opis.",
                  "Mnożniki stawek (Multiplier) – definiuj stawki x1.5, x2, x3 lub własne dla pracy o wyższej wartości.",
                  "AI Suggestions – przeglądaj i zatwierdzaj (lub odrzucaj) sugestie projektów wygenerowane przez AI.",
                  "Ręczne dodawanie sesji (Add Session) – rejestruj spotkania, telefony lub pracę poza komputerem.",
                  "Masowe przypisywanie (Batch Assign) – zaznacz wiele sesji i przypisz je do projektu jednym kliknięciem.",
                  "Tryby widoku: Detailed (pełne logi plików) vs Compact (sama lista aplikacji i sesji).",
                  "Sortowanie i filtrowanie po aplikacji, projekcie, dacie oraz czasie trwania."
                ]}
              />
            </TabsContent>

            <TabsContent value="projects" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<FolderKanban className="h-6 w-6" />}
                title="PROJECTS"
                description="Zarządzanie strukturą Twoich zadań i inteligentną automatyzacją ich wykrywania."
                features={[
                  "Mrożenie (Freezing) – ukrywaj nieaktywne projekty, by nie przeszkadzały przy przypisywaniu sesji.",
                  "Automatyczne mrożenie – system sam 'zamraża' projekty nieużywane przez określoną liczbę dni.",
                  "Odmrażanie (Unfreeze) – ikona płomienia przywraca projekt do listy aktywnych zadań.",
                  "Synchronizacja folderów – TIMEFLOW skanuje ścieżki i automatycznie wykrywa nowe projekty.",
                  "Detekcja kandydatów – system sugeruje utworzenie projektów na podstawie aktywności w folderach.",
                  "Root folders – zarządzaj miejscami na dysku, które TIMEFLOW ma obserwować.",
                  "Wykluczanie (Exclude) – usuwaj projekty z widoku bez ich permanentnego skasowania z bazy."
                ]}
              />
            </TabsContent>

            <TabsContent value="estimates" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<CircleDollarSign className="h-6 w-6" />}
                title="ESTIMATES"
                description="Moduł biznesowy pozwalający na precyzyjne przeliczanie czasu na finanse."
                features={[
                  "Konfiguracja globalnej stawki godzinowej oraz stawek specyficznych dla wybranych projektów.",
                  "Uwzględnianie mnożników sesji (Multipliers) w końcowej wycenie projektu.",
                  "Wycena sesji manualnych – spotkania i telefony są doliczane do budżetu projektu.",
                  "Analiza dochodowości projektów w czasie (widok miesięczny i roczny).",
                  "Wizualny podział na zarobki dzienne i tygodniowe.",
                  "Możliwość porównywania wartości czasu poświęconego na różne grupy zadań."
                ]}
              />
            </TabsContent>

            <TabsContent value="apps" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<AppWindow className="h-6 w-6" />}
                title="APPLICATIONS"
                description="Zarządzanie listą wykrytego oprogramowania i procesów."
                features={[
                  "Pełna lista aplikacji, w których rejestrowana była aktywność.",
                  "Statystyki czasu spędzonego v poszczególnych programach.",
                  "Możliwość zmiany wyświetlanej nazwy aplikacji (aliasy).",
                  "Trwałe usuwanie danych powiązanych z konkretną aplikacją.",
                  "Resetowanie czasu śledzenia dla wybranej aplikacji.",
                  "Bezpośrednie przypisanie aplikacji do projektu z poziomu listy."
                ]}
              />
            </TabsContent>

            <TabsContent value="analysis" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<BarChart3 className="h-6 w-6" />}
                title="TIME ANALYSIS"
                description="Głęboka wizualizacja Twoich nawyków i intensywności pracy."
                features={[
                  "Mapy cieplne (heatmaps) pokazujące natężenie pracy w skali dnia, tygodnia i miesiąca.",
                  "Wykresy skumulowane (stacked bar charts) obrazujące procentowy podział czasu na projekty.",
                  "Analiza średniego dziennego czasu pracy i trendów tygodniowych.",
                  "Podział aktywności na konkretne godziny w widoku miesięcznym (z numeracją tygodni).",
                  "Wizualizacja intensywności zadań (intensity) w ujęciu kalendarzowym."
                ]}
              />
            </TabsContent>

            <TabsContent value="ai" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<Brain className="h-6 w-6" />}
                title="AI & MODEL"
                description="Automatyzacja procesów porządkowania danych przy użyciu uczenia maszynowego."
                features={[
                  "Tryb Auto-Safe – bezpieczne, masowe przypisywanie sesji (wymaga progu ufności i dowodów).",
                  "Cofanie zmian (Rollback) – możliwość odkręcenia ostatniego wsadowego przypisania przez AI.",
                  "Confidence Policy – ustalanie jak bardzo model musi być pewny, by samoczynnie przypisać dane.",
                  "Learning Center – każda Twoja manualna korekta staje się nową lekcją dla modelu.",
                  "Powiadomienia o potrzebie treningu – system informuje, gdy zebrano nową wiedzę.",
                  "Tryby: Off (tylko ręczne), Suggest (podpowiedzi AI), Auto-Safe (automatyzacja)."
                ]}
              />
            </TabsContent>

            <TabsContent value="data" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<Import className="h-6 w-6" />}
                title="DATA"
                description="Importowanie, eksportowanie i porządkowanie bazy wiedzy."
                features={[
                  "Eksport ZIP – szybka archiwizacja całej bazy lub wybranych projektów do paczki .zip.",
                  "Import JSON – wczytywanie dziennych raportów generowanych przez Daemona.",
                  "System Maintenance – czyszczenie starych rekordów i optymalizacja rozmiaru plików.",
                  "Historia operacji – wgląd w to, kiedy i jakie dane były modyfikowane.",
                  "Backup & Database – dostęp do narzędzi konserwacji bazy danych SQLite."
                ]}
              />
            </TabsContent>

            <TabsContent value="daemon" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<Cpu className="h-6 w-6" />}
                title="DAEMON"
                description="Centrum sterowania procesem tła odpowiedzialnym za zbieranie danych."
                features={[
                  "Monitorowanie bieżącego statusu pracy DAEMONA (Running/Stopped).",
                  "Ręczne uruchamianie, zatrzymywanie i restartowanie usługi.",
                  "Włączanie/wyłączanie autostartu wraz z systemem Windows.",
                  "Zarządzanie listą procesów (.exe), które TIMEFLOW ma śledzić.",
                  "Podgląd logów DAEMONA w czasie rzeczywistym (diagnostyka)."
                ]}
              />
            </TabsContent>

            <TabsContent value="settings" className="m-0 focus-visible:outline-none">
              <SectionHelp 
                icon={<Settings className="h-6 w-6" />}
                title="SETTINGS"
                description="Pełna kontrola nad konfiguracją aplikacji i bezpieczeństwem."
                features={[
                  "Working Hours – definiowanie godzin pracy (wpływa na kolorystykę osi czasu).",
                  "Session Management – ustalanie progu łączenia sesji (Gap Fill) oraz ignorowania krótkich bloków.",
                  "Freeze Threshold – konfiguracja liczby dni, po których projekty są mrożone.",
                  "Online Sync – ustawienie synchronizacji z zewnętrznym serwerem (URL, User ID, Token).",
                  "Demo Mode – przełączanie na bazę demo (możliwość testowania bez wpływu na realne dane).",
                  "Emergency Clear – opcja całkowitego wyczyszczenia bazy danych i ustawień."
                ]}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="pt-12 text-center text-[10px] text-muted-foreground/30 font-mono tracking-widest uppercase">
        F1 - Skrót do tej strony
      </div>
    </div>
  );
}


function HelpTabTrigger({ value, icon, label }: { value: string, icon: React.ReactNode, label: string }) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all",
        "data-[state=active]:border-border/40 data-[state=active]:bg-accent/75 data-[state=active]:text-card-foreground data-[state=active]:shadow-sm",
        "data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:border-border/35 data-[state=inactive]:hover:bg-accent/50 data-[state=inactive]:hover:text-accent-foreground"
      )}
    >
      <span className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </span>
      <ChevronRight className="h-3 w-3 opacity-0 data-[state=active]:opacity-100 transition-opacity" />
    </TabsTrigger>
  );
}

function SectionHelp({ icon, title, description, features }: { icon: React.ReactNode, title: string, description: string, features: string[] }) {
  return (
    <Card className="border-none bg-muted/20 shadow-none">
      <CardHeader className="flex flex-row items-center gap-4 pb-4">
        <div className="p-3 rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
          {icon}
        </div>
        <div>
          <CardTitle className="text-xl font-medium tracking-tight">{title}</CardTitle>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">{description}</p>
        </div>
      </CardHeader>
      <CardContent>
        <h4 className="text-[10px] font-bold mb-4 uppercase tracking-[0.15em] text-muted-foreground/60 border-b border-border/10 pb-2">Kluczowe funkcjonalności</h4>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
          {features.map((f, i) => (
            <li key={i} className="flex items-start gap-3 text-sm group">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
              <span className="text-foreground/80 leading-snug">{f}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

