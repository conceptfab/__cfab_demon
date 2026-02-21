import { useAppStore } from "@/store/app-store";

const pageTitles: Record<string, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
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
    <header className="flex h-14 items-center border-b px-6">
      <h1 className="text-lg font-semibold">{pageTitles[currentPage] ?? "Dashboard"}</h1>
    </header>
  );
}
