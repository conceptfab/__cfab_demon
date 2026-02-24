import { useState } from "react";
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
  Languages,
  Rocket,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";

type Language = "pl" | "en";

export function Help() {
  const [lang, setLang] = useState<Language>("pl");
  const { helpTab: activeTab, setHelpTab: setActiveTab, setCurrentPage } = useAppStore();

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  return (
    <div className="flex h-full flex-col p-8 space-y-8 overflow-y-auto max-w-6xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border/10 pb-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-light tracking-[0.1em]">
            {t("Witaj w", "Welcome to")}{" "}
            <span className="font-semibold tracking-[0.2em]">TIMEFLOW</span>
            <span className="ml-2 font-[100] text-sm text-muted-foreground/40 tracking-normal antialiased">
              β v0.1.32
            </span>
          </h1>

        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLang(lang === "pl" ? "en" : "pl")}
            className="w-fit flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest border-primary/20 hover:bg-primary/5 transition-colors"
          >
            <Languages className="h-3.5 w-3.5" />
            {lang === "pl" ? "ENGLISH VERSION" : "POLSKA WERSJA"}
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {t("O oprogramowaniu", "About the software")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground font-semibold">TIMEFLOW</strong>{" "}
            {t(
              "to zaawansowany ekosystem do monitorowania czasu pracy, który działa dyskretnie w tle, pozwalając Ci skupić się na tym, co naprawdę ważne.",
              "is an advanced time tracking ecosystem that works discreetly in the background, letting you focus on what really matters."
            )}
            {" "}
            {t(
              "W przeciwieństwie do tradycyjnych narzędzi, TIMEFLOW inteligentnie analizuje aktywność okien, procesów oraz plików, aby precyzyjnie przypisać Twój czas do odpowiednich projektów.",
              "Unlike traditional tools, TIMEFLOW intelligently analyzes window activity, processes, and files to precisely assign your time to the correct projects."
            )}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Activity className="h-4 w-4 text-emerald-500" />
                {t("Automatyczne śledzenie", "Automatic Tracking")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Daemon TIMEFLOW monitoruje używane aplikacje i aktywne dokumenty bez Twojej ingerencji.",
                  "The TIMEFLOW Daemon monitors used applications and active documents without your intervention."
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Brain className="h-4 w-4 text-purple-400" />
                {t("Inteligentna kategoryzacja", "Intelligent Categorization")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Lokalny silnik uczenia maszynowego (ML) uczy się Twoich nawyków bez wysyłania danych do chmury.",
                  "A local machine learning (ML) engine learns your habits without sending any data to the cloud."
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <CircleDollarSign className="h-4 w-4 text-amber-500" />
                {t("Analiza finansowa", "Financial Analysis")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Zyskaj natychmiastowy wgląd v faktyczną wartość Twojej pracy dzięki systemowi stawek i wycen.",
                  "Get instant insight into the actual value of your work thanks to the rate and estimate system."
                )}
              </p>
            </div>
            <div className="space-y-1">
              <h4 className="font-medium text-sm flex items-center gap-2 text-foreground/90">
                <Settings className="h-4 w-4 text-blue-400" />
                {t("Prywatność i lokalność", "Privacy and Locality")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Twoje dane są Twoją własnością. Wszystko jest przechowywane lokalnie w bezpiecznej bazie danych SQLite.",
                  "Your data is your property. Everything is stored locally in a secure SQLite database."
                )}
              </p>
            </div>
          </div>
        </CardContent>
        <div className="border-t border-primary/10 p-4">
          <Button
            variant="ghost"
            className="w-full justify-between group hover:bg-primary/5 text-primary"
            onClick={() => setCurrentPage("quickstart")}
          >
            <span className="flex items-center gap-2">
              <Rocket className="h-4 w-4" />
              {t("Uruchom samouczek Szybki Start", "Launch Quick Start Tutorial")}
            </span>
            <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
          </Button>
        </div>
      </Card>

      <div className="space-y-4 pt-4">
        <h2 className="text-2xl font-light mb-6">
          {t("Przewodnik po sekcjach", "Section Guide")}
        </h2>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          orientation="vertical"
          className="flex flex-col md:flex-row gap-8 items-start"
        >
          <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 w-full md:w-56 shrink-0">
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

          <div className="flex-1 min-w-0 w-full">
            <TabsContent value="dashboard" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<LayoutDashboard className="h-6 w-6" />}
                title="DASHBOARD"
                description={t(
                  "Szybki podgląd Twojej bieżącej aktywności i najważniejszych wskaźników wydajności.",
                  "Quick overview of your current activity and key performance indicators."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Zintegrowane karty metryk (łączny śledzony czas, liczba aplikacji, aktywne projekty).",
                    "Integrated metrics cards (total tracked time, number of apps, active projects)."
                  ),
                  t(
                    "Interaktywna oś czasu z widokiem godzinowym (dzisiaj) lub dziennym (dłuższe okresy).",
                    "Interactive timeline with hourly view (today) or daily view (longer periods)."
                  ),
                  t(
                    "Zestawienie 'Top 5 Projektów' oraz analiza najczęściej używanych aplikacji.",
                    "'Top 5 Projects' charts and analysis of most used applications."
                  ),
                  t(
                    "Szybkie przełączanie zakresów czasowych: Dzisiaj, Tydzień, Miesiąc, Cały okres.",
                    "Quick time range switching: Today, Week, Month, All Time."
                  ),
                  t(
                    "Tryb wizualizacji Timeline – pokazuje Twoje zaangażowanie w czasie rzeczywistym.",
                    "Timeline visualization mode – shows your engagement in real-time."
                  ),
                  t(
                    "Powiadomienia o statusie auto-importu i ewentualnych błędach odczytu danych.",
                    "Notifications on auto-import status and potential data read errors."
                  ),
                  t(
                    "Przycisk odświeżania synchronizujący dane bezpośrednio z pracującego Daemona.",
                    "Refresh button synchronizing data directly from the running Daemon."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="sessions" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<List className="h-6 w-6" />}
                title={t("SESJE", "SESSIONS")}
                description={t(
                  "Szczegółowa lista wszystkich zarejestrowanych bloków aktywności w systemie.",
                  "Detailed list of all activity blocks registered in the system."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Dodawanie komentarzy i notatek – kliknij prawym przyciskiem myszy na sesję, aby stworzyć opis.",
                    "Adding comments and notes – right-click a session to create a description."
                  ),
                  t(
                    "Mnożniki stawek (Multiplier) – definiuj stawki x2 lub własne dla pracy o wyższej wartości.",
                    "Rate multipliers – define rate x2 or custom for higher-value work."
                  ),
                  t(
                    "AI Suggestions – przeglądaj i zatwierdzaj (lub odrzucaj) sugestie projektów wygenerowane przez AI.",
                    "AI Suggestions – review and approve (or reject) project suggestions generated by AI."
                  ),
                  t(
                    "Ręczne dodawanie sesji (Add Session) – rejestruj spotkania, telefony lub pracę poza komputerem.",
                    "Manual session addition – register meetings, calls, or offline work."
                  ),
                  t(
                    "Masowe przypisywanie (Batch Assign) – zaznacz wiele sesji i przypisz je do projektu jednym kliknięciem.",
                    "Batch Assign – select multiple sessions and assign them to a project with one click."
                  ),
                  t(
                    "Tryby widoku: Detailed (pełne logi plików) vs Compact (sama lista aplikacji i sesji).",
                    "View modes: Detailed (full file logs) vs Compact (apps and sessions list only)."
                  ),
                  t(
                    "Sortowanie i filtrowanie po aplikacji, projekcie, dacie oraz czasie trwania.",
                    "Sorting and filtering by application, project, date, and duration."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="projects" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<FolderKanban className="h-6 w-6" />}
                title={t("PROJEKTY", "PROJECTS")}
                description={t(
                  "Zarządzanie strukturą Twoich zadań i inteligentną automatyzacją ich wykrywania.",
                  "Managing task structure and intelligent automation of project detection."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Mrożenie (Freezing) – ukrywaj nieaktywne projekty, by nie przeszkadzały przy przypisywaniu sesji.",
                    "Freezing – hide inactive projects to keep them from cluttering session assignment."
                  ),
                  t(
                    "Automatyczne mrożenie – system sam 'zamraża' projekty nieużywane przez określoną liczbę dni.",
                    "Auto-freezing – the system automatically 'freezes' projects unused for a specified number of days."
                  ),
                  t(
                    "Odmrażanie (Unfreeze) – ikona płomienia przywraca projekt do listy aktywnych zadań.",
                    "Unfreezing – use the flame icon to restore a project to the active tasks list."
                  ),
                  t(
                    "Synchronizacja folderów – TIMEFLOW skanuje ścieżki i automatycznie wykrywa nowe projekty.",
                    "Folder Sync – TIMEFLOW scans paths and automatically detects new projects."
                  ),
                  t(
                    "Detekcja kandydatów – system sugeruje utworzenie projektów na podstawie aktywności v folderach.",
                    "Candidate Detection – the system suggests project creation based on folder activity."
                  ),
                  t(
                    "Root folders – zarządzaj miejscami na dysku, które TIMEFLOW ma obserwować.",
                    "Root folders – manage disk locations that TIMEFLOW should monitor."
                  ),
                  t(
                    "Wykluczanie (Exclude) – usuwaj projekty z widoku bez ich permanentnego skasowania z bazy.",
                    "Exclude – remove projects from view without permanently deleting them from the database."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="estimates" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<CircleDollarSign className="h-6 w-6" />}
                title={t("WYCENY", "ESTIMATES")}
                description={t(
                  "Moduł biznesowy pozwalający na precyzyjne przeliczanie czasu na finanse.",
                  "Business module for precise conversion of time into finances."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Konfiguracja globalnej stawki godzinowej oraz stawek specyficznych dla wybranych projektów.",
                    "Global hourly rate configuration and specific rates for chosen projects."
                  ),
                  t(
                    "Uwzględnianie mnożników sesji (Multipliers) v końcowej wycenie projektu.",
                    "Includes session multipliers in the final project valuation."
                  ),
                  t(
                    "Wycena sesji manualnych – spotkania i telefony są doliczane do budżetu projektu.",
                    "Manual session valuation – meetings and calls are added to the project budget."
                  ),
                  t(
                    "Analiza dochodowości projektów w czasie (widok miesięczny i roczny).",
                    "Project profitability analysis over time (monthly and yearly views)."
                  ),
                  t(
                    "Wizualny podział na zarobki dzienne i tygodniowe.",
                    "Visual breakdown into daily and weekly earnings."
                  ),
                  t(
                    "Możliwość porównywania wartości czasu poświęconego na różne grupy zadań.",
                    "Ability to compare time value spent on different task groups."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="apps" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<AppWindow className="h-6 w-6" />}
                title={t("APLIKACJE", "APPLICATIONS")}
                description={t(
                  "Zarządzanie listą wykrytego oprogramowania i procesów.",
                  "Managing the list of detected software and processes."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Pełna lista aplikacji, w których rejestrowana była aktywność wraz ze statystykami czasu.",
                    "Full list of applications with activity history and time statistics."
                  ),
                  t(
                    "Aliasy aplikacji – zmieniaj nazwy procesów (np. 'cmd.exe') na czytelne (np. 'Terminal').",
                    "App Aliases – change process names (e.g., 'cmd.exe') to readable ones (e.g., 'Terminal')."
                  ),
                  t(
                    "Blokowanie śledzenia – usuwaj dane dla aplikacji, których nie chcesz monitorować.",
                    "Tracking Block – remove data for applications you don't want to track."
                  ),
                  t(
                    "Archiwizacja danych aplikacji – możliwość zresetowania czasu bez usuwania definicji.",
                    "App Data Archiving – reset tracking time without deleting the app definition."
                  ),
                  t(
                    "Bezpośrednie przypisanie całej aplikacji do konkretnego projektu.",
                    "Directly assign an entire application to a specific project."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="analysis" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<BarChart3 className="h-6 w-6" />}
                title={t("ANALIZA CZASU", "TIME ANALYSIS")}
                description={t(
                  "Głęboka wizualizacja Twoich nawyków i intensywności pracy.",
                  "Deep visualization of your habits and work intensity."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Heatmapy aktywności – wizualizacja godzinowa i dzienna Twojego zaangażowania.",
                    "Activity Heatmaps – hourly and daily visualization of your engagement."
                  ),
                  t(
                    "Widok miesięczny z numeracją tygodni – ułatwia planowanie i retrospekcję.",
                    "Monthly view with week numbers – facilitates planning and retrospection."
                  ),
                  t(
                    "Analiza intensywności – wykresy pokazujące w jakich godzinach pracujesz najefektywniej.",
                    "Intensity Analysis – charts showing what hours you work most effectively."
                  ),
                  t(
                    "Stacked Bar Charts – procentowy udział projektów w Twoim całkowitym czasie pracy.",
                    "Stacked Bar Charts – percentage share of projects in your total work time."
                  ),
                  t(
                    "Timeline Project View – szczegółowa oś czasu z podziałem na konkretne zadania.",
                    "Timeline Project View – detailed timeline broken down by specific tasks."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="ai" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Brain className="h-6 w-6" />}
                title="AI & Model"
                description={t(
                  "Autorski, lokalny silnik ML (Rust) analizujący kontekst aplikacji, pory dnia oraz tokeny z nazw plików i okien. Działa w 100% offline.",
                  "Proprietary local ML engine (Rust) analyzing app context, time of day, and file/window tokens. Works 100% offline."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Tryb Auto-Safe – bezpieczne, masowe przypisywanie sesji (wymaga progu ufności i dowodów).",
                    "Auto-Safe Mode – secure, batch session assignment (requires confidence and evidence thresholds)."
                  ),
                  t(
                    "Cofanie zmian (Rollback) – możliwość odkręcenia ostatniego wsadowego przypisania przez AI.",
                    "Rollback – ability to undo the last batch assignment run by the AI."
                  ),
                  t(
                    "Confidence Policy – ustalanie jak bardzo model musi być pewny, by samoczynnie przypisać dane.",
                    "Confidence Policy – set how certain the model must be to automatically assign data."
                  ),
                  t(
                    "Learning Center – każda Twoja manualna korekta staje się nową lekcją dla modelu.",
                    "Learning Center – every manual correction of yours becomes a new lesson for the model."
                  ),
                  t(
                    "Powiadomienia o potrzebie treningu – system informuje, gdy zebrano nową wiedzę.",
                    "Training Notifications – the system notifies you when new knowledge has been gathered."
                  ),
                  t(
                    "Tryby: Off (tylko ręczne), Suggest (podpowiedzi AI), Auto-Safe (automatyzacja).",
                    "Modes: Off (manual only), Suggest (AI hints), Auto-Safe (automation)."
                  ),
                  t(
                    "Prywatność 100% – Silnik ML działa lokalnie w Rust, nie korzysta z zewnętrznych API (jak ChatGPT) i nie wymaga internetu.",
                    "100% Privacy – The ML engine runs locally in Rust, doesn't use external APIs (like ChatGPT), and requires no internet."
                  )
                ]}
                t={t}
              >
                <div className="text-sm space-y-4 text-foreground/90 leading-relaxed">
                  <p>
                    {t(
                      "W aplikacji TIMEFLOW zastosowano autorski, lokalny model uczenia maszynowego (Local ML) typu klasyfikacyjnego, napisanego w języku Rust. Nie jest to zewnętrzne AI (jak ChatGPT), lecz algorytm działający w 100% na Twoim komputerze, co zapewnia pełną prywatność.",
                      "TIMEFLOW uses a proprietary, local machine learning model (Local ML) for classification, written in Rust. It's not an external AI (like ChatGPT), but an algorithm running 100% on your computer, ensuring full privacy."
                    )}
                  </p>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t("1. Na czym się uczy?", "1. What does it learn from?")}
                    </h4>
                    <p>
                      {t(
                        "Model analizuje Twoje historyczne, ręczne przypisania sesji do projektów. Podczas „treningu” buduje tablice statystyczne oparte na trzech głównych filarach:",
                        "The model analyzes your historical, manual session assignments to projects. During 'training', it builds statistical tables based on three main pillars:"
                      )}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>{t("Kontekst aplikacji", "Application context")}:</strong>{" "}
                        {t("Które programy przypisujesz do których projektów.", "Which programs you assign to which projects.")}
                      </li>
                      <li>
                        <strong>{t("Kontekst czasowy", "Time context")}:</strong>{" "}
                        {t("Pora dnia i dzień tygodnia (Twoje nawyki pracy).", "Time of day and day of the week (your work habits).")}
                      </li>
                      <li>
                        <strong>{t("Analiza tokenów", "Token analysis")}:</strong>{" "}
                        {t("Słowa kluczowe wyciągane z nazw plików i okien (najsilniejszy sygnał).", "Keywords extracted from file names and windows (the strongest signal).")}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t("2. Algorytm decyzyjny", "2. Decision algorithm")}
                    </h4>
                    <p>
                      {t(
                        "Model nie zgaduje „na ślepo” – dla każdej nieprzypisanej sesji wylicza:",
                        "The model doesn't guess 'blindly' – for each unassigned session it calculates:"
                      )}
                    </p>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>{t("Confidence (Ufność)", "Confidence")}:</strong>{" "}
                        {t("Wartość od 0 do 1 określaną przez funkcję sigmoidalną.", "A value from 0 to 1 determined by a sigmoid function.")}
                      </li>
                      <li>
                        <strong>{t("Evidence Count", "Evidence Count")}:</strong>{" "}
                        {t("Liczba historycznych „dowodów” potwierdzających decyzję.", "The number of historical 'proofs' confirming the decision.")}
                      </li>
                      <li>
                        <strong>{t("Margin", "Margin")}:</strong>{" "}
                        {t("Różnica między najlepszym a drugim dopasowaniem (chroni przed błędami).", "The difference between the best and second match (protects against errors).")}
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-semibold text-primary/90 text-xs uppercase tracking-wider">
                      {t("3. Tryby pracy", "3. Operating modes")}
                    </h4>
                    <ul className="list-disc ml-5 space-y-1 text-muted-foreground">
                      <li>
                        <strong>Suggest:</strong>{" "}
                        {t("Podpowiada projekt w menu (wymaga >60% pewności).", "Suggests a project in the menu (requires >60% confidence).")}
                      </li>
                      <li>
                        <strong>Auto-Safe:</strong>{" "}
                        {t("Samodzielnie przypisuje sesje (wymaga >85% pewności i silnych dowodów).", "Automatically assigns sessions (requires >85% confidence and strong evidence).")}
                      </li>
                    </ul>
                  </div>

                  <p className="text-xs italic text-muted-foreground pt-2 border-t border-border/10">
                    {t(
                      "Wszystkie dane modelu są przechowywane w Twojej lokalnej bazie SQLite (assignment_model_state itp.), więc system staje się mądrzejszy z każdą Twoją korektą.",
                      "All model data is stored in your local SQLite database (assignment_model_state, etc.), so the system gets smarter with each of your corrections."
                    )}
                  </p>
                </div>
              </SectionHelp>
            </TabsContent>

            <TabsContent value="data" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Import className="h-6 w-6" />}
                title={t("DANE", "DATA")}
                description={t(
                  "Importowanie, eksportowanie i porządkowanie bazy wiedzy.",
                  "Importing, exporting, and organizing the knowledge base."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Eksport ZIP – szybka archiwizacja całej bazy lub wybranych projektów do paczki .zip.",
                    "ZIP Export – quick archiving of the entire database or selected projects to .zip."
                  ),
                  t(
                    "Import JSON – wczytywanie dziennych raportów generowanych przez Daemona.",
                    "JSON Import – loading daily reports generated by the Daemon."
                  ),
                  t(
                    "System Maintenance – czyszczenie starych rekordów i optymalizacja rozmiaru plików.",
                    "System Maintenance – cleaning old records and optimizing file size."
                  ),
                  t(
                    "Historia operacji – wgląd w to, kiedy i jakie dane były modyfikowane.",
                    "Operation History – insight into when and what data was modified."
                  ),
                  t(
                    "Backup & Database – dostęp do narzędzi konserwacji bazy danych SQLite.",
                    "Backup & Database – access to SQLite database maintenance tools."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="daemon" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Cpu className="h-6 w-6" />}
                title="DAEMON"
                description={t(
                  "Centrum sterowania procesem tła odpowiedzialnym za zbieranie danych.",
                  "Control center for the background process responsible for data collection."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Kontrola statusu i diagnostyka – monitoruj czy system śledzenia czasu działa poprawnie.",
                    "Status Control & Diagnostics – monitor if the time tracking system is working correctly."
                  ),
                  t(
                    "Zarządzanie usługą – start, stop i restart Daemona bezpośrednio z dashboardu.",
                    "Service Management – start, stop, and restart the Daemon directly from the dashboard."
                  ),
                  t(
                    "Windows Autostart – automatyczne pobudzenie TIMEFLOW przy logowaniu do systemu.",
                    "Windows Autostart – automatic startup of TIMEFLOW upon system login."
                  ),
                  t(
                    "Real-time Logs – podgląd dziennika zdarzeń w celu identyfikacji problemów.",
                    "Real-time Logs – preview of the event log to identify issues."
                  ),
                  t(
                    "Wgląd w wersję – informacja o kompatybilności wersji Daemona i Dashboardu.",
                    "Version Insight – information on the compatibility of Daemon and Dashboard versions."
                  )
                ]}
                t={t}
              />
            </TabsContent>

            <TabsContent value="settings" className="m-0 focus-visible:outline-none">
              <SectionHelp
                icon={<Settings className="h-6 w-6" />}
                title={t("USTAWIENIA", "SETTINGS")}
                description={t(
                  "Pełna kontrola nad konfiguracją aplikacji i bezpieczeństwem.",
                  "Full control over application configuration and security."
                )}
                footer={t("Kluczowe funkcjonalności", "Key Functionalities")}
                features={[
                  t(
                    "Working Hours – definiowanie godzin pracy (wpływa na kolorystykę osi czasu).",
                    "Working Hours – define work hours (affects timeline color scheme)."
                  ),
                  t(
                    "Session Management – ustalanie progu łączenia sesji (Gap Fill) oraz ignorowania krótkich bloków.",
                    "Session Management – set session merging threshold (Gap Fill) and ignore short blocks."
                  ),
                  t(
                    "Freeze Threshold – konfiguracja liczby dni, po których projekty są mrożone.",
                    "Freeze Threshold – configure the number of days after which projects are frozen."
                  ),
                  t(
                    "Online Sync – ustawienie synchronizacji z zewnętrznym serwerem (URL, User ID, Token).",
                    "Online Sync – set up synchronization with an external server (URL, User ID, Token)."
                  ),
                  t(
                    "Demo Mode – przełączanie na bazę demo (możliwość testowania bez wpływu na realne dane).",
                    "Demo Mode – switch to a demo database (test without affecting real data)."
                  ),
                  t(
                    "Emergency Clear – opcja całkowitego wyczyszczenia bazy danych i ustawień.",
                    "Emergency Clear – option to completely clear the database and settings."
                  )
                ]}
                t={t}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>

      <div className="pt-12 text-center text-[10px] text-muted-foreground/30 font-mono tracking-widest uppercase">
        {t("F1 - Skrót do tej strony", "F1 - Shortcut to this page")}
      </div>
    </div>
  );
}

function HelpTabTrigger({
  value,
  icon,
  label
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all group",
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
function SectionHelp({
  icon,
  title,
  description,
  features,
  footer,
  t,
  children
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  footer: string;
  t: (pl: string, en: string) => string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-none bg-muted/20 shadow-none">
      <CardHeader className="flex flex-row items-center gap-4 pb-4">
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
      <CardContent className="space-y-6">
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


