import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportPanel } from "@/components/data/ExportPanel";
import { ImportPanel } from "@/components/data/ImportPanel";
import { Database } from "lucide-react";

export function DataManagement() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Database className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Zarządzanie Danymi</h1>
          <p className="text-muted-foreground">Eksportuj swoje dane do kopii zapasowej lub importuj z innego źródła.</p>
        </div>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="export">Eksport</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
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
