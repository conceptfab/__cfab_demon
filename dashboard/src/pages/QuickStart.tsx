import { useState } from "react";
import {
  Rocket,
  Monitor,
  FolderKanban,
  AppWindow,
  Cpu,
  MousePointer2,
  Brain,
  ChevronLeft,
  Languages,
  ArrowRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";

type Language = "pl" | "en";

export function QuickStart() {
  const [lang, setLang] = useState<Language>("en");
  const { setCurrentPage, setFirstRun } = useAppStore();

  const handleStart = () => {
    setFirstRun(false);
    setCurrentPage("dashboard");
  };

  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const steps = [
    {
      icon: <Monitor className="h-6 w-6" />,
      title: t("Przygotowanie plików", "File Preparation"),
      desc: t(
        "Wrzuć oba pliki .exe (timeflow-dashboard.exe i timeflow-demon.exe) do jednego folderu na dysku i uruchom timeflow-dashboard.exe.",
        "Place both .exe files (timeflow-dashboard.exe and timeflow-demon.exe) in the same folder and run timeflow-dashboard.exe."
      ),
      color: "text-blue-400",
      bg: "bg-blue-400/10",
    },
    {
      icon: <FolderKanban className="h-6 w-6" />,
      title: t("Konfiguracja projektów", "Projects Configuration"),
      desc: t(
        "W zakładce <strong>Projects</strong> wskaż folder nadrzędny Twoich prac. Każdy podfolder będzie traktowany jako osobny projekt.",
        "In the <strong>Projects</strong> tab, point to the parent folder of your work. Each subfolder will be treated as a separate project."
      ),
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
    },
    {
      icon: <AppWindow className="h-6 w-6" />,
      title: t("Dodawanie aplikacji", "Adding Applications"),
      desc: t(
        "W zakładce <strong>Applications</strong> dodaj nazwy procesów (np. nazwa.exe), które chcesz śledzić. Nadaj im czytelne nazwy.",
        "In the <strong>Applications</strong> tab, add process names (e.g. name.exe) you want to track. Give them friendly names."
      ),
      color: "text-amber-400",
      bg: "bg-amber-400/10",
    },
    {
      icon: <Cpu className="h-6 w-6" />,
      title: t("Uruchomienie Demona", "Starting the Demon"),
      desc: t(
        "W zakładce <strong>Daemon</strong> uruchom go i włącz 'Autostart ON'. System zacznie pracować w tle.",
        "In the <strong>Daemon</strong> tab, start it and enable 'Autostart ON'. The system will start working in the background."
      ),
      color: "text-purple-400",
      bg: "bg-purple-400/10",
    },
    {
      icon: <MousePointer2 className="h-6 w-6" />,
      title: t("Przypisywanie sesji", "Assigning Sessions"),
      desc: t(
        "Użyj prawego przycisku myszy w zakładce <strong>Dashboard</strong>, aby przypisać sesje. Gwiazdka w trayu oznacza nieprzypisane sesje.",
        "Right-click in the <strong>Dashboard</strong> tab to assign sessions. A star in the tray icon means unassigned sessions."
      ),
      color: "text-sky-400",
      bg: "bg-sky-400/10",
    },
    {
      icon: <Brain className="h-6 w-6" />,
      title: t("Szkolenie AI", "AI Training"),
      desc: t(
        "Kilka ręcznych przypisań wyszkoli Twoje lokalne AI (zakładka <strong>AI & Model</strong>), które zacznie automatyzować pracę za Ciebie.",
        "A few manual assignments will train your local AI (<strong>AI & Model</strong> tab), which will then start automating the work for you."
      ),
      color: "text-pink-400",
      bg: "bg-pink-400/10",
    },
  ];

  return (
    <div className="flex h-full flex-col p-8 space-y-6 overflow-y-auto max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleStart}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("Powrót", "Back")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setLang(lang === "pl" ? "en" : "pl")}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest border-primary/20 hover:bg-primary/5 transition-colors"
        >
          <Languages className="h-3.5 w-3.5" />
          {lang === "pl" ? "ENGLISH VERSION" : "POLSKA WERSJA"}
        </Button>
      </div>

      <div className="text-center space-y-2 py-4">
        <div className="inline-flex p-3 rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Rocket className="h-8 w-8" />
        </div>
        <h1 className="text-3xl font-light tracking-[0.2em] uppercase">
          {t("Szybki", "Quick")}{" "}
          <span className="font-semibold">{t("Start", "Start")}</span>
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed text-sm">
          {t(
            "Witaj w TIMEFLOW! Przejdźmy przez te kilka prostych kroków, aby poprawnie skonfigurować Twój system śledzenia czasu.",
            "Welcome to TIMEFLOW! Let's go through these few simple steps to properly configure your time tracking system."
          )}
        </p>
      </div>

      <div className="flex flex-col gap-6 pb-6 w-full border-b border-border/10">
        {steps.map((step, idx) => (
          <div key={idx} className="flex gap-8 items-start w-full group">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset shadow-sm transition-all duration-500", step.bg, step.color, "ring-current/20")}>
              <div className="scale-75">{step.icon}</div>
            </div>
            <div className="flex-1">
              <div className="flex flex-col">
                <span className="text-[10px] font-mono text-primary/50 font-bold uppercase tracking-[0.2em]">Step {idx + 1}</span>
                <h3 className="text-lg font-semibold tracking-tight text-foreground/90">{step.title}</h3>
              </div>
              <p
                className="text-sm text-muted-foreground/80 leading-relaxed max-w-5xl [&_strong]:text-primary [&_strong]:font-semibold [&_strong]:bg-transparent mt-0.5"
                dangerouslySetInnerHTML={{ __html: step.desc }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="text-center space-y-4 py-6">
        <p className="text-muted-foreground text-sm italic">
          {t(
            "To wszystko! Teraz możesz cieszyć się pełną automatyzacją.",
            "That's all! Now you can enjoy full automation."
          )}
        </p>
        <Button
          size="lg"
          onClick={handleStart}
          className="group px-12 rounded-full font-bold tracking-widest uppercase transition-all hover:scale-105 active:scale-95 bg-primary text-primary-foreground hover:bg-primary/95 shadow-lg shadow-primary/20"
        >
          {t("Zaczynamy", "Let's Go")}
          <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
        </Button>
      </div>
    </div>
  );
}
