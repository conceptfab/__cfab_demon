import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { 
  Database, 
  FolderOpen, 
  Wind, 
  Save, 
  Clock, 
  ShieldCheck,
  FileUp
} from "lucide-react";
import { 
  getDbInfo, 
  vacuumDatabase, 
  getDatabaseSettings, 
  updateDatabaseSettings, 
  openDbFolder,
  performManualBackup,
  restoreDatabaseFromFile
} from "@/lib/tauri";
import type { DbInfo, DatabaseSettings } from "@/lib/db-types";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/components/ui/toast-notification";

export function DatabaseManagement() {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [settings, setSettings] = useState<DatabaseSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showError, showInfo } = useToast();

  const loadAll = async () => {
    try {
      const dbInfo = await getDbInfo();
      const dbSettings = await getDatabaseSettings();
      setInfo(dbInfo);
      setSettings(dbSettings);
    } catch (e) {
      console.error("Failed to load database management data:", e);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleVacuum = async () => {
    setLoading(true);
    try {
      await vacuumDatabase();
      showInfo("Database vacuumed successfully");
      loadAll();
    } catch (e) {
      showError(`Vacuum failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    if (!settings?.backup_path) {
      showError("Please configure a backup path first");
      return;
    }
    setLoading(true);
    try {
      const path = await performManualBackup();
      showInfo(`Backup created: ${path}`);
      loadAll();
    } catch (e) {
      showError(`Backup failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openDbFolder();
    } catch (e) {
      showError("Failed to open folder");
    }
  };

  const handleBrowseBackup = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Backup Directory"
      });
      if (selected && typeof selected === "string" && settings) {
        const newSettings = { ...settings, backup_path: selected };
        setSettings(newSettings);
        try {
          await updateDatabaseSettings(newSettings);
          showInfo("Backup path updated");
          loadAll();
        } catch (e: any) {
          showError(`Failed to save path: ${e}`);
        }
      }
    } catch (e: any) {
      console.error(e);
      showError("Failed to open directory picker");
    }
  };

  const handleToggleSetting = async (key: keyof DatabaseSettings) => {
    if (!settings) return;
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    try {
      await updateDatabaseSettings(newSettings);
      loadAll();
    } catch (e: any) {
      showError("Failed to update setting");
      // Rollback
      setSettings(settings);
    }
  };

  const handleIntervalChange = (val: string) => {
    if (!settings) return;
    const days = parseInt(val) || 1;
    setSettings({ ...settings, backup_interval_days: days });
  };

  const saveInterval = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await updateDatabaseSettings(settings);
      showInfo("Interval updated");
      loadAll();
    } catch (e: any) {
      showError("Failed to update interval");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    try {
      const selected = await open({
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
        multiple: false,
        title: "Select Database File to Restore"
      });
      if (selected && typeof selected === "string") {
        if (confirm("WARNING: All current data will be lost. Continue?")) {
          setLoading(true);
          try {
            await restoreDatabaseFromFile(selected);
            showInfo("Database restored. Please restart the app.");
          } catch (e: any) {
            showError(`Restore failed: ${e}`);
          } finally {
            setLoading(false);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (!settings || !info) return null;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              Database Health
            </CardTitle>
            <CardDescription className="text-xs">Monitor and optimize your local database</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Database Size</p>
                <p className="text-lg font-bold">{formatSize(info.size_bytes)}</p>
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-2" onClick={handleVacuum} disabled={loading}>
                <Wind className="h-3.5 w-3.5" />
                Run VACUUM
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Vacuum on startup</Label>
                  <p className="text-[10px] text-muted-foreground">Keep database optimized automatically</p>
                </div>
                <Switch 
                  checked={settings.vacuum_on_startup} 
                  onCheckedChange={() => handleToggleSetting("vacuum_on_startup")} 
                />
              </div>

              <div className="pt-2 flex gap-2">
                <Button variant="secondary" size="sm" className="w-full gap-2 h-8 text-[11px]" onClick={handleOpenFolder}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  Open DB Folder
                </Button>
                <Button variant="outline" size="sm" className="w-full gap-2 h-8 text-[11px] text-amber-500 hover:text-amber-600" onClick={handleRestore}>
                  <FileUp className="h-3.5 w-3.5" />
                  Restore DB
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Data Backups
            </CardTitle>
            <CardDescription className="text-xs">Secure your data with automatic backups</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Automatic backups</Label>
                <p className="text-[10px] text-muted-foreground">Schedule periodic database copies</p>
              </div>
              <Switch 
                checked={settings.backup_enabled} 
                onCheckedChange={() => handleToggleSetting("backup_enabled")} 
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Backup Destination</Label>
              <div className="flex gap-2">
                <Input 
                  readOnly 
                  value={settings.backup_path || "Not configured"} 
                  className="h-8 text-[11px] bg-background/30"
                />
                <Button variant="outline" size="sm" className="h-8" onClick={handleBrowseBackup}>Browse</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Interval (Days)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    min="1" 
                    value={settings.backup_interval_days} 
                    onChange={(e: any) => handleIntervalChange(e.target.value)}
                    className="h-8 text-[11px]" 
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={saveInterval} disabled={saving}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">Last Backup</Label>
                <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {settings.last_backup_at ? new Date(settings.last_backup_at).toLocaleDateString() : "Never"}
                </div>
              </div>
            </div>

            <Button 
              className="w-full gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg" 
              onClick={handleManualBackup} 
              disabled={loading}
            >
              <Save className="h-4 w-4" />
              Backup Now
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
