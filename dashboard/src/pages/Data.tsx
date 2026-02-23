import { ExportPanel } from "@/components/data/ExportPanel";
import { ImportPanel } from "@/components/data/ImportPanel";
import { DataStats } from "@/components/data/DataStats";
import { DataHistory } from "@/components/data/DataHistory";

export function DataManagement() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 pb-10">
      <DataStats />

      <div className="grid gap-8">
        <ImportPanel />
        <ExportPanel />
      </div>

      <DataHistory />
    </div>
  );
}
