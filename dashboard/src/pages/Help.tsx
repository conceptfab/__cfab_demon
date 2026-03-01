import logo from '@/assets/logo.png';
import cfab from '@/assets/cfab.png';
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
  ChevronRight,
  Rocket,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/store/ui-store';
import {
  normalizeHelpTab,
  pageForHelpTab,
  type HelpTabId,
} from '@/lib/help-navigation';
import { normalizeLanguageCode } from '@/lib/user-settings';
import { useTranslation } from 'react-i18next';

type Language = 'pl' | 'en';

export function Help() {
  const { i18n, t: t18n } = useTranslation();
  const lang: Language = normalizeLanguageCode(
    i18n.resolvedLanguage ?? i18n.language,
  );
  const {
    helpTab: activeTab,
    setHelpTab: setActiveTab,
    setCurrentPage,
  } = useUIStore();

  const t = (pl: string, en: string) => (lang === 'pl' ? pl : en);
  const activeTabValue = normalizeHelpTab(activeTab, 'dashboard');
  const openActiveSection = () => {
    setCurrentPage(pageForHelpTab(activeTabValue));
  };

  return (
    <div className="flex h-full flex-col p-8 space-y-8 overflow-y-auto max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/10 pb-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-[0.1em] flex items-center gap-3">
            {t('Witaj w', 'Welcome to')}{' '}
            <div className="flex items-center gap-4 ml-1">
              <img
                src={logo}
                alt="TIMEFLOW"
                className="h-11 w-11 object-contain"
              />
              <span className="font-semibold tracking-[0.2em]">TIMEFLOW</span>
            </div>
            <span className="ml-2 font-medium text-sm text-muted-foreground/70 tracking-normal antialiased self-end mb-1">
              β v0.1.32
            </span>
          </h1>
          <div className="text-[11px] text-muted-foreground/70 tracking-wide ml-1 mt-1 flex items-center gap-2">
            <span className="uppercase font-extralight tracking-[0.15em]">
              {t(
                'Pomysł / kreacja / realizacja',
                'Concept / creation / execution',
              )}
            </span>
            <img
              src={cfab}
              alt="CONCEPTFAB"
              className="h-9 w-auto object-contain"
            />
            <span className="font-light">
              {t('Wszystkie prawa zastrzeżone', 'All rights reserved')}
            </span>
          </div>
        </div>

        <span className="text-[11px] text-muted-foreground">
          {t18n('help.language_hint')}
        </span>
      </div>

      <Card className="border-none bg-transparent shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {t('O oprogramowaniu', 'About the software')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground font-semibold">TIMEFLOW</strong>{' '}
            {t(
              'to zaawansowany ekosystem do monitorowania czasu pracy, który działa dyskretnie w tle, pozwalając Ci skupić się na tym, co naprawdę ważne.',
              'is an advanced time tracking ecosystem that works discreetly in the background, letting you focus on what really matters.',
            )}{' '}
            {t(
              'W przeciwieństwie do tradycyjnych narzędzi, TIMEFLOW inteligentnie analizuje aktywność okien, procesów oraz plików, aby precyzyjnie przypisać Twój czas do odpowiednich projektów.',
              'Unlike traditional tools, TIMEFLOW intelligently analyzes window activity, processes, and files to precisely assign your time to the correct projects.',
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Activity className="h-4 w-4 text-emerald-500" />
                {t('Automatyczne śledzenie', 'Automatic Tracking')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Daemon TIMEFLOW monitoruje używane aplikacje i aktywne dokumenty bez Twojej ingerencji.',
                  'The TIMEFLOW Daemon monitors used applications and active documents without your intervention.',
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Brain className="h-4 w-4 text-purple-400" />
                {t('Inteligentna kategoryzacja', 'Intelligent Categorization')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Lokalny silnik uczenia maszynowego (ML) uczy się Twoich nawyków bez wysyłania danych do chmury.',
                  'A local machine learning (ML) engine learns your habits without sending any data to the cloud.',
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <CircleDollarSign className="h-4 w-4 text-amber-500" />
                {t('Analiza finansowa', 'Financial Analysis')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Zyskaj natychmiastowy wgląd w faktyczną wartość Twojej pracy dzięki systemowi stawek i wycen.',
                  'Get instant insight into the actual value of your work thanks to the rate and estimate system.',
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Settings className="h-4 w-4 text-blue-400" />
                {t('Prywatność i lokalność', 'Privacy and Locality')}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  'Twoje dane są Twoją własnością. Wszystko jest przechowywane lokalnie w bezpiecznej bazie danych SQLite.',
                  'Your data is your property. Everything is stored locally in a secure SQLite database.',
                )}
              </p>
            </div>
          </div>
        </CardContent>
        <div className="border-t border-border/10 p-4 pl-0">
          <Button
            variant="ghost"
            className="w-full justify-between group hover:bg-primary/5 text-primary"
            onClick={() => setCurrentPage('quickstart')}
          >
            <span className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              {t(
                'Uruchom samouczek Szybki Start',
                'Launch Quick Start Tutorial',
              )}
            </span>
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </Card>

      <div className="space-y-4 pt-4">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-light">
            {t('Przewodnik po sekcjach', 'Section Guide')}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={openActiveSection}
            className="w-fit border-primary/20 hover:bg-primary/5"
          >
            {activeTabValue === 'quickstart'
              ? t('Uruchom pełny samouczek', 'Open full tutorial')
              : t('Przejdź do opisywanego modułu', 'Open this module')}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </div>

        <Tabs
          value={activeTabValue}
          onValueChange={(value) =>
            setActiveTab(normalizeHelpTab(value, activeTabValue))
          }
          orientation="vertical"
          className="flex flex-col md:flex-row gap-0 items-start"
        >
          <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 w-full md:w-56 shrink-0 border-r border-border/10 pr-6">
            <HelpTabTrigger
              value="quickstart"
              icon={<Rocket className="h-3.5 w-3.5" />}
              label={t('Quick Start', 'Quick Start')}
            />
            <HelpTabTrigger
              value="dashboard"
              icon={<LayoutDashboard className="h-3.5 w-3.5" />}
              label="Dashboard"
            />
            <HelpTabTrigger
              value="sessions"
              icon={<List className="h-3.5 w-3.5" />}
              label="Sessions"
            />
            <HelpTabTrigger
              value="projects"
              icon={<FolderKanban className="h-3.5 w-3.5" />}
              label="Projects"
            />
            <HelpTabTrigger
              value="estimates"
              icon={<CircleDollarSign className="h-3.5 w-3.5" />}
              label="Estimates"
            />
            <HelpTabTrigger
              value="apps"
              icon={<AppWindow className="h-3.5 w-3.5" />}
              label="Applications"
            />
            <HelpTabTrigger
              value="analysis"
              icon={<BarChart3 className="h-3.5 w-3.5" />}
              label="Time Analysis"
            />
            <HelpTabTrigger
              value="ai"
              icon={<Brain className="h-3.5 w-3.5" />}
              label="AI & Model"
            />
            <HelpTabTrigger
              value="data"
              icon={<Import className="h-3.5 w-3.5" />}
              label="Data"
            />
            <HelpTabTrigger
              value="daemon"
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="Daemon"
            />
            <HelpTabTrigger
              value="settings"
              icon={<Settings className="h-3.5 w-3.5" />}
              label="Settings"
            />
          </TabsList>

          <div className="flex-1 min-w-0 w-full pl-10">
            <TabsContent
              value="quickstart"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Rocket className="h-6 w-6" />}
                title={t('SZYBKI START', 'QUICK START')}
                description={t(
                  'Szybka konfiguracja TIMEFLOW dla nowych instalacji i pierwszego uruchomienia.',
                  'Fast TIMEFLOW setup for a new install and first launch.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Krok po kroku: od przygotowania plików .exe po uruchomienie Daemona.',
                    'Step by step guidance from .exe preparation to launching the Daemon.',
                  ),
                  t(
                    'Konfiguracja folderów projektowych i procesów aplikacji do monitorowania.',
                    'Configuration of project folders and app processes to be tracked.',
                  ),
                  t(
                    'Instrukcja pierwszego przypisywania sesji i uruchomienia lokalnego AI.',
                    'First-session assignment and local AI onboarding instructions.',
                  ),
                  t(
                    'Dostęp z ikony rakiety w sidebarze oraz z poziomu ekranu pomocy.',
                    'Accessible from the sidebar rocket icon and from the Help screen.',
                  ),
                  t(
                    "Automatyczne ukrycie wskaźnika 'first run' po zakończeniu samouczka.",
                    'Automatically clears the first-run hint after finishing the tutorial.',
                  ),
                ]}
              >
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                  <p className="text-muted-foreground">
                    {t(
                      'Pełny samouczek prowadzi przez wszystkie kroki instalacji i konfiguracji.',
                      'The full tutorial walks through installation and configuration end-to-end.',
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    className="mt-3 h-8 px-2 text-primary hover:bg-primary/10"
                    onClick={() => setCurrentPage('quickstart')}
                  >
                    <Rocket className="mr-2 h-3.5 w-3.5" />
                    {t('Uruchom Quick Start', 'Launch Quick Start')}
                  </Button>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="dashboard"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<LayoutDashboard className="h-6 w-6" />}
                title="DASHBOARD"
                description={t(
                  'Szybki podgląd Twojej bieżącej aktywności i najważniejszych wskaźników wydajności.',
                  'Quick overview of your current activity and key performance indicators.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Zintegrowane karty metryk (łączny śledzony czas, liczba aplikacji, aktywne projekty).',
                    'Integrated metrics cards (total tracked time, number of apps, active projects).',
                  ),
                  t(
                    'Interaktywna oś czasu z widokiem godzinowym (dzisiaj) lub dziennym (dłuższe okresy).',
                    'Interactive timeline with hourly view (today) or daily view (longer periods).',
                  ),
                  t(
                    "Zestawienie 'Top 5 Projektów' oraz analiza najczęściej używanych aplikacji.",
                    "'Top 5 Projects' charts and analysis of most used applications.",
                  ),
                  t(
                    'Szybkie przełączanie zakresów czasowych: Dzisiaj, Tydzień, Miesiąc, Cały okres.',
                    'Quick time range switching: Today, Week, Month, All Time.',
                  ),
                  t(
                    'Tryb wizualizacji Timeline – pokazuje Twoje zaangażowanie w czasie rzeczywistym.',
                    'Timeline visualization mode – shows your engagement in real-time.',
                  ),
                  t(
                    'Powiadomienia o statusie auto-importu i ewentualnych błędach odczytu danych.',
                    'Notifications on auto-import status and potential data read errors.',
                  ),
                  t(
                    'Przycisk odświeżania synchronizujący dane bezpośrednio z pracującego Daemona.',
                    'Refresh button synchronizing data directly from the running Daemon.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="sessions"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<List className="h-6 w-6" />}
                title={t('SESJE', 'SESSIONS')}
                description={t(
                  'Szczegółowa lista wszystkich zarejestrowanych bloków aktywności w systemie.',
                  'Detailed list of all activity blocks registered in the system.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Dodawanie komentarzy i notatek – kliknij prawym przyciskiem myszy na sesję, aby stworzyć opis.',
                    'Adding comments and notes – right-click a session to create a description.',
                  ),
                  t(
                    'Mnożniki stawek (Multiplier) – definiuj stawki x2 lub własne dla pracy o wyższej wartości.',
                    'Rate multipliers – define rate x2 or custom for higher-value work.',
                  ),
                  t(
                    'AI Suggestions – przeglądaj i zatwierdzaj (lub odrzucaj) sugestie projektów wygenerowane przez AI.',
                    'AI Suggestions – review and approve (or reject) project suggestions generated by AI.',
                  ),
                  t(
                    'Ręczne dodawanie sesji (Add Session) – rejestruj spotkania, telefony lub pracę poza komputerem.',
                    'Manual session addition – register meetings, calls, or offline work.',
                  ),
                  t(
                    'Masowe przypisywanie (Batch Assign) – zaznacz wiele sesji i przypisz je do projektu jednym kliknięciem.',
                    'Batch Assign – select multiple sessions and assign them to a project with one click.',
                  ),
                  t(
                    'Tryby widoku: Detailed (pełne logi plików), Compact (sama lista aplikacji i sesji) oraz AI Data (precyzyjne statystyki i argumentacja modelu AI).',
                    'View modes: Detailed (full file logs), Compact (apps and sessions list only), and AI Data (precise statistics and AI model reasoning).',
                  ),
                  t(
                    'Sortowanie i filtrowanie po aplikacji, projekcie, dacie oraz czasie trwania.',
                    'Sorting and filtering by application, project, date, and duration.',
                  ),
                ]}
              >
                <div className="text-sm space-y-4 text-foreground/90 leading-relaxed border-t border-border/10 pt-4">
                  <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                    {t(
                      'Interpretacja widoku AI Data',
                      'AI Data View Interpretation',
                    )}
                  </h4>
                  <p className="text-muted-foreground">
                    {t(
                      'Widok "AI Data" prezentuje "tok myślenia" modelu dla przypisanych lub sugerowanych sesji. Oto jak czytać zawarte w nim wskaźniki:',
                      'The "AI Data" view presents the model\'s "train of thought" for assigned or suggested sessions. Here is how to read its metrics:',
                    )}
                  </p>
                  <ul className="list-disc ml-5 space-y-2 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">
                        Confidence (Ufność):
                      </strong>{' '}
                      {t(
                        'Wyrażona w procentach (0-100%) pewność modelu względem dokonanego wyboru. Powyżej ustalonego progu (np. 40%) model generuje sugestię.',
                        "Expressed in percentage (0-100%), it's the model's certainty about its choice. Above the set threshold (e.g., 40%), the model generates a suggestion.",
                      )}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        Evidence Count (Dowody):
                      </strong>{' '}
                      {t(
                        'Ilość podobnych sesji w przeszłości, które ręcznie zatwierdziłeś/aś. To najtwardszy dowód dla modelu – im więcej dowodów, tym pewniejsza decyzja.',
                        'The number of similar past sessions you manually approved. This is the hardest proof for the model – the more evidence, the more certain the decision.',
                      )}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        Score & Base Log Prob:
                      </strong>{' '}
                      {t(
                        'Surowe matematyczne i probabilistyczne wyniki dopasowania wyliczone przez silnik ML. Służą gównie do celów diagnostycznych.',
                        'Raw mathematical and probabilistic match scores calculated by the ML engine. Mainly used for diagnostic purposes.',
                      )}
                    </li>
                    <li>
                      <strong className="text-foreground">
                        Matched Tokens & Context Matches:
                      </strong>{' '}
                      {t(
                        'Słowa kluczowe z nazw plików, okien czy tytułów stron internetowych (oraz ogólny kontekst np. pory dnia), które model zidentyfikował jako bezpośrednio powiązane z tym wskazanym projektem.',
                        'Keywords from filenames, windows, or website titles (and general context like time of day) that the model identified as directly linked to that specific project.',
                      )}
                    </li>
                    <li>
                      <strong className="text-foreground">Penalty:</strong>{' '}
                      {t(
                        'Punkty ujemne, jeśli model wykrył cechy wskazujące, że przypisanie może być mętne pomimo innych mocnych sygnałów.',
                        'Negative points if the model detected traits suggesting the assignment could be murky despite other strong signals.',
                      )}
                    </li>
                  </ul>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="projects"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<FolderKanban className="h-6 w-6" />}
                title={t('PROJEKTY', 'PROJECTS')}
                description={t(
                  'Zarządzanie strukturą Twoich zadań i inteligentną automatyzacją ich wykrywania.',
                  'Managing task structure and intelligent automation of project detection.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Mrożenie (Freezing) – ukrywaj nieaktywne projekty, by nie przeszkadzały przy przypisywaniu sesji.',
                    'Freezing – hide inactive projects to keep them from cluttering session assignment.',
                  ),
                  t(
                    "Automatyczne mrożenie – system sam 'zamraża' projekty nieużywane przez określoną liczbę dni.",
                    "Auto-freezing – the system automatically 'freezes' projects unused for a specified number of days.",
                  ),
                  t(
                    'Odmrażanie (Unfreeze) – ikona płomienia przywraca projekt do listy aktywnych zadań.',
                    'Unfreezing – use the flame icon to restore a project to the active tasks list.',
                  ),
                  t(
                    'Synchronizacja folderów – TIMEFLOW skanuje ścieżki i automatycznie wykrywa nowe projekty.',
                    'Folder Sync – TIMEFLOW scans paths and automatically detects new projects.',
                  ),
                  t(
                    'Detekcja kandydatów – system sugeruje utworzenie projektów na podstawie aktywności w folderach.',
                    'Candidate Detection – the system suggests project creation based on folder activity.',
                  ),
                  t(
                    'Root folders – zarządzaj miejscami na dysku, które TIMEFLOW ma obserwować.',
                    'Root folders – manage disk locations that TIMEFLOW should monitor.',
                  ),
                  t(
                    'Wykluczanie (Exclude) – usuwaj projekty z widoku bez ich permanentnego skasowania z bazy.',
                    'Exclude – remove projects from view without permanently deleting them from the database.',
                  ),
                  t(
                    'Wyszukiwanie – filtruj projekty po nazwie lub ścieżce folderu w czasie rzeczywistym.',
                    'Search – filter projects by name or folder path in real time.',
                  ),
                  t(
                    'Zmiana koloru – kliknij kropkę koloru w karcie projektu, aby zmienić kolor projektu (paleta presetów + dowolny kolor).',
                    'Color change – click the color dot on the project card to change the project color (preset palette + custom color).',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="estimates"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<CircleDollarSign className="h-6 w-6" />}
                title={t('WYCENY', 'ESTIMATES')}
                description={t(
                  'Moduł biznesowy pozwalający na precyzyjne przeliczanie czasu na finanse.',
                  'Business module for precise conversion of time into finances.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Konfiguracja globalnej stawki godzinowej oraz stawek specyficznych dla wybranych projektów.',
                    'Global hourly rate configuration and specific rates for chosen projects.',
                  ),
                  t(
                    'Uwzględnianie mnożników sesji (Multipliers) w końcowej wycenie projektu.',
                    'Includes session multipliers in the final project valuation.',
                  ),
                  t(
                    'Wycena sesji manualnych – spotkania i telefony są doliczane do budżetu projektu.',
                    'Manual session valuation – meetings and calls are added to the project budget.',
                  ),
                  t(
                    'Analiza dochodowości projektów w czasie (widok miesięczny i roczny).',
                    'Project profitability analysis over time (monthly and yearly views).',
                  ),
                  t(
                    'Wizualny podział na zarobki dzienne i tygodniowe.',
                    'Visual breakdown into daily and weekly earnings.',
                  ),
                  t(
                    'Możliwość porównywania wartości czasu poświęconego na różne grupy zadań.',
                    'Ability to compare time value spent on different task groups.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="apps"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<AppWindow className="h-6 w-6" />}
                title={t('APLIKACJE', 'APPLICATIONS')}
                description={t(
                  'Zarządzanie listą wykrytego oprogramowania i procesów.',
                  'Managing the list of detected software and processes.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Pełna lista aplikacji, w których rejestrowana była aktywność wraz ze statystykami czasu.',
                    'Full list of applications with activity history and time statistics.',
                  ),
                  t(
                    "Aliasy aplikacji – zmieniaj nazwy procesów (np. 'cmd.exe') na czytelne (np. 'Terminal').",
                    "App Aliases – change process names (e.g., 'cmd.exe') to readable ones (e.g., 'Terminal').",
                  ),
                  t(
                    'Blokowanie śledzenia – usuwaj dane dla aplikacji, których nie chcesz monitorować.',
                    "Tracking Block – remove data for applications you don't want to track.",
                  ),
                  t(
                    'Archiwizacja danych aplikacji – możliwość zresetowania czasu bez usuwania definicji.',
                    'App Data Archiving – reset tracking time without deleting the app definition.',
                  ),
                  t(
                    'Bezpośrednie przypisanie całej aplikacji do konkretnego projektu.',
                    'Directly assign an entire application to a specific project.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="analysis"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<BarChart3 className="h-6 w-6" />}
                title={t('ANALIZA CZASU', 'TIME ANALYSIS')}
                description={t(
                  'Głęboka wizualizacja Twoich nawyków i intensywności pracy.',
                  'Deep visualization of your habits and work intensity.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Heatmapy aktywności – wizualizacja godzinowa i dzienna Twojego zaangażowania.',
                    'Activity Heatmaps – hourly and daily visualization of your engagement.',
                  ),
                  t(
                    'Widok miesięczny z numeracją tygodni – ułatwia planowanie i retrospekcję.',
                    'Monthly view with week numbers – facilitates planning and retrospection.',
                  ),
                  t(
                    'Analiza intensywności – wykresy pokazujące w jakich godzinach pracujesz najefektywniej.',
                    'Intensity Analysis – charts showing what hours you work most effectively.',
                  ),
                  t(
                    'Stacked Bar Charts – procentowy udział projektów w Twoim całkowitym czasie pracy.',
                    'Stacked Bar Charts – percentage share of projects in your total work time.',
                  ),
                  t(
                    'Timeline Project View – szczegółowa oś czasu z podziałem na konkretne zadania.',
                    'Timeline Project View – detailed timeline broken down by specific tasks.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent value="ai" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Brain className="h-6 w-6" />}
                title="AI & Model"
                description={t(
                  'Autorski, lokalny silnik ML (Rust) analizujący kontekst aplikacji, pory dnia oraz tokeny z nazw plików i okien. Działa w 100% offline.',
                  'Proprietary local ML engine (Rust) analyzing app context, time of day, and file/window tokens. Works 100% offline.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Tryb Auto-Safe – bezpieczne, masowe przypisywanie sesji (wymaga progu ufności i dowodów).',
                    'Auto-Safe Mode – secure, batch session assignment (requires confidence and evidence thresholds).',
                  ),
                  t(
                    'Cofanie zmian (Rollback) – możliwość odkręcenia ostatniego wsadowego przypisania przez AI.',
                    'Rollback – ability to undo the last batch assignment run by the AI.',
                  ),
                  t(
                    'Confidence Policy – ustalanie jak bardzo model musi być pewny, by samoczynnie przypisać dane.',
                    'Confidence Policy – set how certain the model must be to automatically assign data.',
                  ),
                  t(
                    'Learning Center – każda Twoja manualna korekta staje się nową lekcją dla modelu.',
                    'Learning Center – every manual correction of yours becomes a new lesson for the model.',
                  ),
                  t(
                    'Powiadomienia o potrzebie treningu – system informuje, gdy zebrano nową wiedzę.',
                    'Training Notifications – the system notifies you when new knowledge has been gathered.',
                  ),
                  t(
                    'Tryby: Off (tylko ręczne), Suggest (podpowiedzi AI), Auto-Safe (automatyzacja).',
                    'Modes: Off (manual only), Suggest (AI hints), Auto-Safe (automation).',
                  ),
                  t(
                    'Prywatność 100% – Silnik ML działa lokalnie w Rust, nie korzysta z zewnętrznych API (jak ChatGPT) i nie wymaga internetu.',
                    "100% Privacy – The ML engine runs locally in Rust, doesn't use external APIs (like ChatGPT), and requires no internet.",
                  ),
                ]}
              >
                <div className="text-sm space-y-4 text-foreground/90 leading-relaxed">
                  <p>
                    {t(
                      'W aplikacji TIMEFLOW zastosowano autorski, lokalny model uczenia maszynowego (Local ML) typu klasyfikacyjnego, napisanego w języku Rust. Nie jest to zewnętrzne AI (jak ChatGPT), lecz algorytm działający w 100% na Twoim komputerze, co zapewnia pełną prywatność.',
                      "TIMEFLOW uses a proprietary, local machine learning model (Local ML) for classification, written in Rust. It's not an external AI (like ChatGPT), but an algorithm running 100% on your computer, ensuring full privacy.",
                    )}
                  </p>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t('1. Na czym się uczy?', '1. What does it learn from?')}
                    </h4>
                    <p>
                      {t(
                        'Model analizuje Twoje historyczne, ręczne przypisania sesji do projektów. Podczas „treningu” buduje tablice statystyczne oparte na trzech głównych filarach:',
                        "The model analyzes your historical, manual session assignments to projects. During 'training', it builds statistical tables based on three main pillars:",
                      )}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>
                          {t('Kontekst aplikacji', 'Application context')}:
                        </strong>{' '}
                        {t(
                          'Które programy przypisujesz do których projektów.',
                          'Which programs you assign to which projects.',
                        )}
                      </li>
                      <li>
                        <strong>
                          {t('Kontekst czasowy', 'Time context')}:
                        </strong>{' '}
                        {t(
                          'Pora dnia i dzień tygodnia (Twoje nawyki pracy).',
                          'Time of day and day of the week (your work habits).',
                        )}
                      </li>
                      <li>
                        <strong>
                          {t('Analiza tokenów', 'Token analysis')}:
                        </strong>{' '}
                        {t(
                          'Słowa kluczowe wyciągane z nazw plików i okien (najsilniejszy sygnał).',
                          'Keywords extracted from file names and windows (the strongest signal).',
                        )}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t('2. Algorytm decyzyjny', '2. Decision algorithm')}
                    </h4>
                    <p>
                      {t(
                        'Model nie zgaduje „na ślepo” – dla każdej nieprzypisanej sesji wylicza:',
                        "The model doesn't guess 'blindly' – for each unassigned session it calculates:",
                      )}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>
                          {t('Confidence (Ufność)', 'Confidence')}:
                        </strong>{' '}
                        {t(
                          'Wartość od 0 do 1 określaną przez funkcję sigmoidalną.',
                          'A value from 0 to 1 determined by a sigmoid function.',
                        )}
                      </li>
                      <li>
                        <strong>
                          {t('Evidence Count', 'Evidence Count')}:
                        </strong>{' '}
                        {t(
                          'Liczba historycznych „dowodów” potwierdzających decyzję.',
                          "The number of historical 'proofs' confirming the decision.",
                        )}
                      </li>
                      <li>
                        <strong>{t('Margin', 'Margin')}:</strong>{' '}
                        {t(
                          'Różnica między najlepszym a drugim dopasowaniem (chroni przed błędami).',
                          'The difference between the best and second match (protects against errors).',
                        )}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t('3. Tryby pracy', '3. Operating modes')}
                    </h4>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>Suggest:</strong>{' '}
                        {t(
                          'Podpowiada projekt w menu (wymaga >60% pewności).',
                          'Suggests a project in the menu (requires >60% confidence).',
                        )}
                      </li>
                      <li>
                        <strong>Auto-Safe:</strong>{' '}
                        {t(
                          'Samodzielnie przypisuje sesje (wymaga >85% pewności i silnych dowodów).',
                          'Automatically assigns sessions (requires >85% confidence and strong evidence).',
                        )}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t(
                        '4. Optymalne ustawienia nauki',
                        '4. Optimal learning settings',
                      )}
                    </h4>
                    <div className="space-y-3 pl-2 text-muted-foreground">
                      <div>
                        <strong>1. Model operation mode: suggest</strong>
                        <p className="mt-1 leading-relaxed">
                          {t(
                            `Pozostaw ten tryb. AI będzie podsuwać Ci propozycje powiązań/kategorii, ale nie przypisze ich automatycznie. Twoje ręczne akceptacje (lub odrzucenia/korekty) to najważniejszy element budowania "wiedzy" modelu. (W trybie auto, model nie pytałby o zdanie w pewnych przypadkach, tracąc potencjalną szansę na upewnienie).`,
                            `Keep this mode. The AI will suggest connections/categories but won't assign them automatically. Your manual approvals (or rejections/corrections) are the most crucial element in building the model's "knowledge". (In auto mode, the model wouldn't ask your opinion in some cases, losing a potential chance for confirmation).`,
                          )}
                        </p>
                      </div>

                      <div>
                        <strong>
                          2. Suggest Min Confidence: 0.4 - 0.5 (Zmniejsz obecne
                          0.6)
                        </strong>
                        <p className="mt-1 leading-relaxed">
                          {t(
                            `Obniżenie tego progu sprawi, że model będzie zgłaszał propozycje nawet wtedy, gdy nie jest super pewny. Konsekwencja: dostaniesz więcej sugestii, a poprawiając te błędne, model nauczy się znacznie szybciej rozróżniać trudniejsze przypadki. Jeśli jednak poczujesz się "zaspamowany" bzdurnymi sugestiami, podnieś powoli do 0.6.`,
                            `Lowering this threshold means the model will make suggestions even when it's not super confident. Consequence: you'll get more suggestions, and by correcting the wrong ones, the model will learn to distinguish harder cases much faster. But if you feel "spammed" by nonsensical suggestions, slowly increase it to 0.6.`,
                          )}
                        </p>
                      </div>

                      <div>
                        <strong>
                          3. Feedback Weight: 10 - 15 (Zwiększ obecne 5)
                        </strong>
                        <p className="mt-1 leading-relaxed">
                          {t(
                            `Waga feedbacku decyduje o tym, jak mocno jedna Twoja poprawka wpływa na kolejne decyzje modelu. Wyższa wartość = model szybciej adaptuje się do Twoich świeżych zachowań i włożonych korekt. Ważne: jeśli waga będzie zbyt wysoka (np. 50), model może "zwariować" po jednej Twojej przypadkowej pomyłce. Wartość 10-15 pozwala na wydajną naukę, będąc zarazem stosunkowo stabilną opcją.`,
                            `Feedback weight determines how strongly a single correction from you affects the model's subsequent decisions. Higher value = the model adapts faster to your fresh behaviors and corrections. Important: if the weight is too high (e.g., 50), the model might "go crazy" after a single accidental mistake. A value of 10-15 allows for efficient learning while being a relatively stable option.`,
                          )}
                        </p>
                      </div>

                      <div>
                        <strong>
                          4. Kryteria dla Auto-safe (na przyszłość/dla
                          bezpieczeństwa)
                        </strong>
                        <p className="mt-1 mb-1 leading-relaxed">
                          {t(
                            'Jeśli po okresie uczenia zechcesz włączyć tryb auto-safe, gdzie AI samo rozwiązuje oczywiste przypadki:',
                            'If after the learning period you want to enable auto-safe mode, where AI solves obvious cases by itself:',
                          )}
                        </p>
                        <ul className="list-disc ml-5 space-y-1">
                          <li>
                            <strong>
                              Auto-safe Min Confidence: 0.85 - 0.95
                            </strong>{' '}
                            {t(
                              '(zostaw wysoko, niech automatyzuje tylko absolutne pewniaki).',
                              '(keep it high, let it automate only absolute certainties).',
                            )}
                          </li>
                          <li>
                            <strong>Auto-safe Min Evidence: 5</strong>{' '}
                            {t(
                              '(podnieś z 3. Oznacza to, że model musi mieć mocne potwierdzenie w min. 5 podobnych, wcześniej zatwierdzonych przez Ciebie sesjach, by zadziałać bez Twojej zgody).',
                              '(increase from 3. This means the model must have strong confirmation in at least 5 similar, previously user-approved sessions to act without your consent).',
                            )}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs italic text-muted-foreground pt-2 border-t border-border/10">
                    {t(
                      'Wszystkie dane modelu są przechowywane w Twojej lokalnej bazie SQLite (assignment_model_state itp.), więc system staje się mądrzejszy z każdą Twoją korektą.',
                      'All model data is stored in your local SQLite database (assignment_model_state, etc.), so the system gets smarter with each of your corrections.',
                    )}
                  </p>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent
              value="data"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Import className="h-6 w-6" />}
                title={t('DANE', 'DATA')}
                description={t(
                  'Importowanie, eksportowanie i porządkowanie bazy wiedzy.',
                  'Importing, exporting, and organizing the knowledge base.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Eksport ZIP – szybka archiwizacja całej bazy lub wybranych projektów do paczki .zip.',
                    'ZIP Export – quick archiving of the entire database or selected projects to .zip.',
                  ),
                  t(
                    'Import JSON – wczytywanie dziennych raportów generowanych przez Daemona.',
                    'JSON Import – loading daily reports generated by the Daemon.',
                  ),
                  t(
                    'System Maintenance – czyszczenie starych rekordów i optymalizacja rozmiaru plików.',
                    'System Maintenance – cleaning old records and optimizing file size.',
                  ),
                  t(
                    'Historia operacji – wgląd w to, kiedy i jakie dane były modyfikowane.',
                    'Operation History – insight into when and what data was modified.',
                  ),
                  t(
                    'Backup & Database – dostęp do narzędzi konserwacji bazy danych SQLite.',
                    'Backup & Database – access to SQLite database maintenance tools.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="daemon"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Cpu className="h-6 w-6" />}
                title="DAEMON"
                description={t(
                  'Centrum sterowania procesem tła odpowiedzialnym za zbieranie danych.',
                  'Control center for the background process responsible for data collection.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Kontrola statusu i diagnostyka – monitoruj czy system śledzenia czasu działa poprawnie.',
                    'Status Control & Diagnostics – monitor if the time tracking system is working correctly.',
                  ),
                  t(
                    'Zarządzanie usługą – start, stop i restart Daemona bezpośrednio z dashboardu.',
                    'Service Management – start, stop, and restart the Daemon directly from the dashboard.',
                  ),
                  t(
                    'Windows Autostart – automatyczne pobudzenie TIMEFLOW przy logowaniu do systemu.',
                    'Windows Autostart – automatic startup of TIMEFLOW upon system login.',
                  ),
                  t(
                    'Real-time Logs – podgląd dziennika zdarzeń w celu identyfikacji problemów.',
                    'Real-time Logs – preview of the event log to identify issues.',
                  ),
                  t(
                    'Wgląd w wersję – informacja o kompatybilności wersji Daemona i Dashboardu.',
                    'Version Insight – information on the compatibility of Daemon and Dashboard versions.',
                  ),
                ]}
              />
            </TabsContent>

            <TabsContent
              value="settings"
              className="m-0 focus-visible:outline-none"
            >
              <SectionHelp
                icon={<Settings className="h-6 w-6" />}
                title={t('USTAWIENIA', 'SETTINGS')}
                description={t(
                  'Pełna kontrola nad konfiguracją aplikacji i bezpieczeństwem.',
                  'Full control over application configuration and security.',
                )}
                footer={t('Kluczowe funkcjonalności', 'Key Functionalities')}
                features={[
                  t(
                    'Working Hours – definiowanie godzin pracy (wpływa na kolorystykę osi czasu).',
                    'Working Hours – define work hours (affects timeline color scheme).',
                  ),
                  t(
                    'Session Management – ustalanie progu łączenia sesji (Gap Fill) oraz ignorowania krótkich bloków.',
                    'Session Management – set session merging threshold (Gap Fill) and ignore short blocks.',
                  ),
                  t(
                    'Freeze Threshold – konfiguracja liczby dni, po których projekty są mrożone.',
                    'Freeze Threshold – configure the number of days after which projects are frozen.',
                  ),
                  t(
                    'Online Sync – ustawienie synchronizacji z zewnętrznym serwerem (URL, User ID, Token).',
                    'Online Sync – set up synchronization with an external server (URL, User ID, Token).',
                  ),
                  t(
                    'Demo Mode – przełączanie na bazę demo (możliwość testowania bez wpływu na realne dane).',
                    'Demo Mode – switch to a demo database (test without affecting real data).',
                  ),
                  t(
                    'Auto Optimize DB – harmonogram automatycznej optymalizacji SQLite oraz ręczne uruchamianie optymalizacji.',
                    'Auto Optimize DB – schedule automatic SQLite optimization and run optimization manually.',
                  ),
                  t(
                    'Emergency Clear – opcja całkowitego wyczyszczenia bazy danych i ustawień.',
                    'Emergency Clear – option to completely clear the database and settings.',
                  ),
                  t(
                    'Appearance & Performance – wyłączanie animacji wykresów w celu poprawy responsywności UI.',
                    'Appearance & Performance – disable chart animations to improve UI responsiveness.',
                  ),
                ]}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

function HelpTabTrigger({
  value,
  icon,
  label,
}: {
  value: HelpTabId;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-all group rounded-l-lg',
        'data-[state=active]:bg-primary/10 data-[state=active]:text-primary',
        'data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-accent/30 data-[state=inactive]:hover:text-accent-foreground',
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
function SectionHelp({
  icon,
  title,
  description,
  features,
  footer,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  footer: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="flex flex-row items-center gap-4 pb-4 px-0">
        <div className="p-3 rounded-xl bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20">
          {icon}
        </div>
        <div>
          <CardTitle className="text-xl font-medium tracking-tight">
            {title}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            {description}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-0">
        {children}

        <div className="mt-8">
          <h4 className="text-[10px] font-bold mb-4 uppercase tracking-[0.15em] text-muted-foreground/60 border-b border-border/10 pb-2">
            {footer}
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-3">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-3 text-sm group">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                <span className="text-foreground/80 leading-snug">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
