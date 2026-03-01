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
  Zap,
  Save,
  Clock,
  ShieldCheck,
  FileUp,
} from "lucide-react";
import {
  getDbInfo,
  vacuumDatabase,
  optimizeDatabase,
  getDatabaseSettings,
  updateDatabaseSettings,
  openDbFolder,
  performManualBackup,
  restoreDatabaseFromFile,
} from "@/lib/tauri";
import type { DbInfo, DatabaseSettings } from "@/lib/db-types";
import { open } from "@tauri-apps/plugin-dialog";
import { useToast } from "@/components/ui/toast-notification";
import { useInlineT } from "@/lib/inline-i18n";

export function DatabaseManagement() {
  const t = useInlineT();
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
      showInfo(t("Vacuum bazy zakończony pomyślnie", "Database vacuumed successfully"));
      loadAll();
    } catch (e) {
      showError(t(`Vacuum nie powiódł się: ${e}`, `Vacuum failed: ${e}`));
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    setLoading(true);
    try {
      await optimizeDatabase();
      showInfo(t("Baza zoptymalizowana pomyślnie", "Database optimized successfully"));
      loadAll();
    } catch (e) {
      showError(t(`Optymalizacja nie powiodła się: ${e}`, `Optimization failed: ${e}`));
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    if (!settings?.backup_path) {
      showError(t("Najpierw skonfiguruj ścieżkę backupu", "Please configure a backup path first"));
      return;
    }
    setLoading(true);
    try {
      const path = await performManualBackup();
      showInfo(t(`Utworzono backup: ${path}`, `Backup created: ${path}`));
      loadAll();
    } catch (e) {
      showError(t(`Backup nie powiódł się: ${e}`, `Backup failed: ${e}`));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openDbFolder();
    } catch {
      showError(t("Nie udało się otworzyć folderu", "Failed to open folder"));
    }
  };

  const handleBrowseBackup = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("Wybierz katalog backupu", "Select Backup Directory"),
      });
      if (selected && typeof selected === "string" && settings) {
        const nextSettings = { ...settings, backup_path: selected };
        setSettings(nextSettings);
        try {
          await updateDatabaseSettings(nextSettings);
          showInfo(t("Ścieżka backupu zaktualizowana", "Backup path updated"));
          loadAll();
        } catch (e: unknown) {
          showError(t(`Nie udało się zapisać ścieżki: ${e}`, `Failed to save path: ${e}`));
        }
      }
    } catch (e: unknown) {
      console.error(e);
      showError(t("Nie udało się otworzyć wyboru katalogu", "Failed to open directory picker"));
    }
  };

  const handleToggleSetting = async (key: keyof DatabaseSettings) => {
    if (!settings) return;
    const nextSettings = { ...settings, [key]: !settings[key] };
    setSettings(nextSettings);
    try {
      await updateDatabaseSettings(nextSettings);
      loadAll();
    } catch {
      showError(t("Nie udało się zaktualizować ustawienia", "Failed to update setting"));
      setSettings(settings);
    }
  };

  const handleBackupIntervalChange = (val: string) => {
    if (!settings) return;
    const days = parseInt(val, 10) || 1;
    setSettings({ ...settings, backup_interval_days: days });
  };

  const saveSettings = async (successMessage: string, errorMessage: string) => {
    if (!settings) return;
    setSaving(true);
    try {
      await updateDatabaseSettings(settings);
      showInfo(successMessage);
      loadAll();
    } catch {
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const saveBackupInterval = async () =>
    saveSettings(
      t("Interwał backupu zaktualizowany", "Backup interval updated"),
      t("Nie udało się zaktualizować interwału backupu", "Failed to update backup interval"),
    );

  const saveOptimizeInterval = async () =>
    saveSettings(
      t("Interwał optymalizacji zaktualizowany", "Optimization interval updated"),
      t("Nie udało się zaktualizować interwału optymalizacji", "Failed to update optimization interval"),
    );

  const handleRestore = async () => {
    try {
      const selected = await open({
        filters: [{ name: t("Baza SQLite", "SQLite Database"), extensions: ["db"] }],
        multiple: false,
        title: t("Wybierz plik bazy do przywrócenia", "Select Database File to Restore"),
      });
      if (selected && typeof selected === "string") {
        if (confirm(t("UWAGA: Wszystkie bieżące dane zostaną utracone. Kontynuować?", "WARNING: All current data will be lost. Continue?"))) {
          setLoading(true);
          try {
            await restoreDatabaseFromFile(selected);
            showInfo(t("Baza przywrócona. Uruchom ponownie aplikację.", "Database restored. Please restart the app."));
          } catch (e: unknown) {
            showError(t(`Przywracanie nie powiodło się: ${e}`, `Restore failed: ${e}`));
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
              {t("Stan bazy danych", "Database Health")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("Monitoruj i optymalizuj lokalną bazę danych", "Monitor and optimize your local database")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {t("Rozmiar bazy", "Database Size")}
                </p>
                <p className="text-lg font-bold">{formatSize(info.size_bytes)}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                onClick={handleVacuum}
                disabled={loading}
              >
                <Wind className="h-3.5 w-3.5" />
                {t("Uruchom VACUUM", "Run VACUUM")}
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{t("VACUUM przy starcie", "Vacuum on startup")}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t("Automatycznie utrzymuj bazę w dobrej kondycji", "Keep database optimized automatically")}
                  </p>
                </div>
                <Switch
                  checked={settings.vacuum_on_startup}
                  onCheckedChange={() => handleToggleSetting("vacuum_on_startup")}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{t("Autooptymalizacja", "Auto optimize")}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t("Uruchamiaj planową automatyczną optymalizację", "Run smart optimization automatically on schedule")}
                  </p>
                </div>
                <Switch
                  checked={settings.auto_optimize_enabled}
                  onCheckedChange={() => handleToggleSetting("auto_optimize_enabled")}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {t("Interwał optymalizacji (godziny)", "Optimize Interval (Hours)")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    max={24 * 30}
                    value={settings.auto_optimize_interval_hours}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        auto_optimize_interval_hours: Math.max(
                          1,
                          Math.min(24 * 30, parseInt(e.target.value, 10) || 1),
                        ),
                      })
                    }
                    className="h-8 text-[11px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={saveOptimizeInterval}
                    disabled={saving}
                  >
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {t("Ostatnia optymalizacja:", "Last optimization:")}
                {" "}
                {settings.last_optimize_at
                  ? new Date(settings.last_optimize_at).toLocaleString()
                  : t("Nigdy", "Never")}
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px]"
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("Otwórz folder DB", "Open DB Folder")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px]"
                  onClick={handleOptimize}
                  disabled={loading}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {t("Optymalizuj teraz", "Optimize Now")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px] text-amber-500 hover:text-amber-600"
                  onClick={handleRestore}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {t("Przywróć DB", "Restore DB")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {t("Kopie zapasowe", "Data Backups")}
            </CardTitle>
            <CardDescription className="text-xs">
              {t("Zabezpiecz dane automatycznymi kopiami", "Secure your data with automatic backups")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">{t("Automatyczne backupy", "Automatic backups")}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {t("Planuj cykliczne kopie bazy", "Schedule periodic database copies")}
                </p>
              </div>
              <Switch
                checked={settings.backup_enabled}
                onCheckedChange={() => handleToggleSetting("backup_enabled")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                {t("Lokalizacja backupu", "Backup Destination")}
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={settings.backup_path || t("Nie skonfigurowano", "Not configured")}
                  className="h-8 text-[11px] bg-background/30"
                />
                <Button variant="outline" size="sm" className="h-8" onClick={handleBrowseBackup}>
                  {t("Przeglądaj", "Browse")}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {t("Interwał (dni)", "Interval (Days)")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={settings.backup_interval_days}
                    onChange={(e) => handleBackupIntervalChange(e.target.value)}
                    className="h-8 text-[11px]"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={saveBackupInterval}
                    disabled={saving}
                  >
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {t("Ostatni backup", "Last Backup")}
                </Label>
                <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {settings.last_backup_at
                    ? new Date(settings.last_backup_at).toLocaleDateString()
                    : t("Nigdy", "Never")}
                </div>
              </div>
            </div>

            <Button
              className="w-full gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg"
              onClick={handleManualBackup}
              disabled={loading}
            >
              <Save className="h-4 w-4" />
              {t("Utwórz backup", "Backup Now")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

