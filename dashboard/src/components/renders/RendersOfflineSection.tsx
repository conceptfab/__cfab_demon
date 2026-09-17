import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Package, FileCheck, UploadCloud, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { invoke } from "@tauri-apps/api/core";

export function RendersOfflineSection({ onImportSuccess }: { onImportSuccess?: () => void }) {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; success: boolean } | null>(null);

  const handlePickAndPreview = async () => {
    setStatusMsg(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        filters: [{ name: "CFABX Package", extensions: ["cfabx"] }],
        multiple: false,
      });
      if (!selected || typeof selected !== "string") return;

      setFilePath(selected);
      setLoading(true);
      const res = await invoke("preview_cfabx_package", { filePath: selected });
      setPreview(res);
    } catch (err: any) {
      setStatusMsg({ text: `Błąd podglądu paczki: ${err.message || err}`, success: false });
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!preview || !filePath) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const assignments = preview.proposals.map((p: any) => ({
        kind: p.kind,
        source_id: p.source_id,
        status: "accepted",
        project_id: p.matched_project_id || null,
      }));

      const ackPath: string = await invoke("import_cfabx_package", {
        filePath,
        assignments,
      });

      setStatusMsg({
        text: `Zaimportowano pomyślnie! Utworzono plik potwierdzenia: ${ackPath}`,
        success: true,
      });
      setPreview(null);
      setFilePath("");
      if (onImportSuccess) onImportSuccess();
    } catch (err: any) {
      setStatusMsg({ text: `Błąd importu paczki: ${err.message || err}`, success: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="size-4 text-purple-400" />
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Wymiana offline (.cfabx / .cfabx-ack)
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={handlePickAndPreview} disabled={loading}>
            <UploadCloud className="mr-2 size-3.5" />
            Wybierz paczkę .cfabx…
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusMsg && (
          <div
            className={`flex items-center gap-2 p-3 rounded text-xs ${
              statusMsg.success
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}
          >
            {statusMsg.success ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {preview && (
          <div className="space-y-3 rounded-lg border border-border/50 bg-secondary/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Paczka z maszyny: {preview.manifest.machine_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  Instancja: {preview.manifest.hub_instance_id} · Pozycji: {preview.manifest.item_count}
                </div>
              </div>
              <Button size="sm" onClick={handleImport} disabled={loading}>
                <FileCheck className="mr-2 size-3.5" />
                Zatwierdź import i zapisz .cfabx-ack
              </Button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5 text-xs">
              {preview.proposals.map((p: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded bg-background/50 border border-border/30"
                >
                  <div className="truncate max-w-[60%]">
                    <span className="font-mono text-[10px] text-muted-foreground mr-2">[{p.kind}]</span>
                    <span>{p.working_path || p.title || `ID #${p.source_id}`}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.matched_project_name ? (
                      <Badge variant="outline" className="text-emerald-400 border-emerald-500/30">
                        {p.matched_project_name}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Nieprzypisane
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!preview && (
          <p className="text-xs text-muted-foreground">
            Możesz importować renderingi z maszyn renderujących bez połączenia sieciowego. Wybierz paczkę wyeksportowaną z Huba, a TIMEFLOW dopasuje projekty i wygeneruje plik potwierdzenia powrotnego.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
