import { ExportPanel } from "@/components/data/ExportPanel";
import { ImportPanel } from "@/components/data/ImportPanel";
import { DataStats } from "@/components/data/DataStats";
import { DataHistory } from "@/components/data/DataHistory";
import { DatabaseManagement } from "@/components/data/DatabaseManagement";

export function DataManagement() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-12 pb-10">
      <DataStats />

      {/* Primary Actions Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-4 px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">Data Exchange</h2>
          <div className="h-px w-full bg-border/40" />
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <ImportPanel />
          <ExportPanel />
        </div>
      </section>

      {/* System Maintenance Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-4 px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70 whitespace-nowrap">System & Database</h2>
          <div className="h-px w-full bg-border/40" />
        </div>
        <DatabaseManagement />
      </section>

      <DataHistory />
    </div>
  );
}
