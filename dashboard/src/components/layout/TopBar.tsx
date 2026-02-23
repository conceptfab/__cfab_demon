import { useAppStore } from "@/store/app-store";

const pageTitles: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  estimates: "Estimates",
  applications: "Applications",
  analysis: "Time Analysis",
  sessions: "Sessions",
  ai: "AI & Model",
  data: "Data",
  import: "Data",
  settings: "Settings",
  daemon: "Daemon",
};

export function TopBar() {
  const { currentPage } = useAppStore();

  return (
    <header className="flex h-12 items-center gap-3 bg-background px-4">
      <h1 className="text-sm font-medium tracking-wide text-foreground">
        {pageTitles[currentPage] ?? "Dashboard"}
      </h1>
    </header>
  );
}
