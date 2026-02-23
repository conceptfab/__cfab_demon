import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportPanel } from "@/components/data/ExportPanel";
import { ImportPanel } from "@/components/data/ImportPanel";
import { Database, Download, Upload } from "lucide-react";

export function DataManagement() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/60 text-muted-foreground">
          <Database className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Management</h1>
          <p className="text-muted-foreground">Export your data to a backup or import from another source.</p>
        </div>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="export" className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger value="import" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import
          </TabsTrigger>
        </TabsList>
        <TabsContent value="export" className="space-y-4">
          <ExportPanel />
        </TabsContent>
        <TabsContent value="import" className="space-y-4">
          <ImportPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
