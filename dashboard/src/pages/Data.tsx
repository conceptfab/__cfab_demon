import { ExportPanel } from "@/components/data/ExportPanel";
import { ImportPanel } from "@/components/data/ImportPanel";
import { DataStats } from "@/components/data/DataStats";
import { DataHistory } from "@/components/data/DataHistory";
import { DatabaseManagement } from "@/components/data/DatabaseManagement";
import { useTranslation } from "react-i18next";
import { mobileLayout } from "@/lib/mobile-layout";

export function DataManagement() {
  const { t } = useTranslation();

  return (
    <div className={`${mobileLayout.pageContainer} max-w-4xl space-y-8 sm:space-y-12`}>
      <DataStats />

      {/* Primary Actions Section */}
      <section className={mobileLayout.pageStack}>
        <div className="flex items-center gap-4 px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
            {t("data_page.sections.data_exchange")}
          </h2>
          <div className="h-px w-full bg-border/40" />
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <ImportPanel />
          <ExportPanel />
        </div>
      </section>

      {/* System Maintenance Section */}
      <section className={mobileLayout.pageStack}>
        <div className="flex items-center gap-4 px-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">
            {t("data_page.sections.system_database")}
          </h2>
          <div className="h-px w-full bg-border/40" />
        </div>
        <DatabaseManagement />
      </section>

      <DataHistory />
    </div>
  );
}
