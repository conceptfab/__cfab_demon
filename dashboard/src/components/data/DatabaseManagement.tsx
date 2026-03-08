import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
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
import { AppTooltip } from "@/components/ui/app-tooltip";
import { createInlineTranslator } from "@/lib/inline-i18n";
import { formatBytes } from "@/lib/utils";

export function DatabaseManagement() {
  const { t, i18n } = useTranslation();
  const tInline = createInlineTranslator(
    t,
    i18n.resolvedLanguage ?? i18n.language,
  );
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
      showInfo(tInline("Vacuum bazy zakończony pomyślnie", "Database vacuumed successfully"));
      loadAll();
    } catch (e) {
      showError(
        tInline('Vacuum nie powiódł się: {{error}}', 'Vacuum failed: {{error}}', {
          error: String(e),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    setLoading(true);
    try {
      await optimizeDatabase();
      showInfo(tInline("Baza zoptymalizowana pomyślnie", "Database optimized successfully"));
      loadAll();
    } catch (e) {
      showError(
        tInline(
          'Optymalizacja nie powiodła się: {{error}}',
          'Optimization failed: {{error}}',
          { error: String(e) },
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleManualBackup = async () => {
    if (!settings?.backup_path) {
      showError(tInline("Najpierw skonfiguruj ścieżkę backupu", "Please configure a backup path first"));
      return;
    }
    setLoading(true);
    try {
      const path = await performManualBackup();
      showInfo(
        tInline('Utworzono backup: {{path}}', 'Backup created: {{path}}', {
          path,
        }),
      );
      loadAll();
    } catch (e) {
      showError(
        tInline('Backup nie powiódł się: {{error}}', 'Backup failed: {{error}}', {
          error: String(e),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await openDbFolder();
    } catch {
      showError(tInline("Nie udało się otworzyć folderu", "Failed to open folder"));
    }
  };

  const handleBrowseBackup = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: tInline("Wybierz katalog backupu", "Select Backup Directory"),
      });
      if (selected && typeof selected === "string" && settings) {
        const nextSettings = { ...settings, backup_path: selected };
        setSettings(nextSettings);
        try {
          await updateDatabaseSettings(nextSettings);
          showInfo(tInline("Ścieżka backupu zaktualizowana", "Backup path updated"));
          loadAll();
        } catch (e: unknown) {
          showError(
            tInline(
              'Nie udało się zapisać ścieżki: {{error}}',
              'Failed to save path: {{error}}',
              { error: String(e) },
            ),
          );
        }
      }
    } catch (e: unknown) {
      console.error(e);
      showError(tInline("Nie udało się otworzyć wyboru katalogu", "Failed to open directory picker"));
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
      showError(tInline("Nie udało się zaktualizować ustawienia", "Failed to update setting"));
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
      tInline("Interwał backupu zaktualizowany", "Backup interval updated"),
      tInline("Nie udało się zaktualizować interwału backupu", "Failed to update backup interval"),
    );

  const saveOptimizeInterval = async () =>
    saveSettings(
      tInline("Interwał optymalizacji zaktualizowany", "Optimization interval updated"),
      tInline("Nie udało się zaktualizować interwału optymalizacji", "Failed to update optimization interval"),
    );

  const handleRestore = async () => {
    try {
      const selected = await open({
        filters: [{ name: tInline("Baza SQLite", "SQLite Database"), extensions: ["db"] }],
        multiple: false,
        title: tInline("Wybierz plik bazy do przywrócenia", "Select Database File to Restore"),
      });
      if (selected && typeof selected === "string") {
        if (confirm(tInline("UWAGA: Wszystkie bieżące dane zostaną utracone. Kontynuować?", "WARNING: All current data will be lost. Continue?"))) {
          setLoading(true);
          try {
            await restoreDatabaseFromFile(selected);
            showInfo(tInline("Baza przywrócona. Uruchom ponownie aplikację.", "Database restored. Please restart the app."));
          } catch (e: unknown) {
            showError(
              tInline(
                'Przywracanie nie powiodło się: {{error}}',
                'Restore failed: {{error}}',
                { error: String(e) },
              ),
            );
          } finally {
            setLoading(false);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!settings || !info) return null;

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-500" />
              {tInline("Stan bazy danych", "Database Health")}
            </CardTitle>
            <CardDescription className="text-xs">
              {tInline("Monitoruj i optymalizuj lokalną bazę danych", "Monitor and optimize your local database")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {tInline("Rozmiar bazy", "Database Size")}
                </p>
                <p className="text-lg font-bold">{formatBytes(info.size_bytes)}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                onClick={handleVacuum}
                disabled={loading}
              >
                <Wind className="h-3.5 w-3.5" />
                {tInline("Uruchom VACUUM", "Run VACUUM")}
              </Button>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{tInline("VACUUM przy starcie", "Vacuum on startup")}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {tInline("Automatycznie utrzymuj bazę w dobrej kondycji", "Keep database optimized automatically")}
                  </p>
                </div>
                <Switch
                  checked={settings.vacuum_on_startup}
                  onCheckedChange={() => handleToggleSetting("vacuum_on_startup")}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">{tInline("Autooptymalizacja", "Auto optimize")}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {tInline("Uruchamiaj planową automatyczną optymalizację", "Run smart optimization automatically on schedule")}
                  </p>
                </div>
                <Switch
                  checked={settings.auto_optimize_enabled}
                  onCheckedChange={() => handleToggleSetting("auto_optimize_enabled")}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {tInline("Interwał optymalizacji (godziny)", "Optimize Interval (Hours)")}
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
                  <AppTooltip content={tInline('Zapisz interwał optymalizacji', 'Save optimize interval')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={saveOptimizeInterval}
                      disabled={saving}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                {tInline("Ostatnia optymalizacja:", "Last optimization:")}
                {" "}
                {settings.last_optimize_at
                  ? new Date(settings.last_optimize_at).toLocaleString()
                  : tInline("Nigdy", "Never")}
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px]"
                  onClick={handleOpenFolder}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {tInline("Otwórz folder DB", "Open DB Folder")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px]"
                  onClick={handleOptimize}
                  disabled={loading}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {tInline("Optymalizuj teraz", "Optimize Now")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 h-8 text-[11px] text-amber-500 hover:text-amber-600"
                  onClick={handleRestore}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  {tInline("Przywróć DB", "Restore DB")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              {tInline("Kopie zapasowe", "Data Backups")}
            </CardTitle>
            <CardDescription className="text-xs">
              {tInline("Zabezpiecz dane automatycznymi kopiami", "Secure your data with automatic backups")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">{tInline("Automatyczne backupy", "Automatic backups")}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {tInline("Planuj cykliczne kopie bazy", "Schedule periodic database copies")}
                </p>
              </div>
              <Switch
                checked={settings.backup_enabled}
                onCheckedChange={() => handleToggleSetting("backup_enabled")}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                {tInline("Lokalizacja backupu", "Backup Destination")}
              </Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={settings.backup_path || tInline("Nie skonfigurowano", "Not configured")}
                  className="h-8 text-[11px] bg-background/30"
                />
                <Button variant="outline" size="sm" className="h-8" onClick={handleBrowseBackup}>
                  {tInline("Przeglądaj", "Browse")}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {tInline("Interwał (dni)", "Interval (Days)")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={settings.backup_interval_days}
                    onChange={(e) => handleBackupIntervalChange(e.target.value)}
                    className="h-8 text-[11px]"
                  />
                  <AppTooltip content={tInline('Zapisz interwał backupu', 'Save backup interval')}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={saveBackupInterval}
                      disabled={saving}
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  </AppTooltip>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-semibold text-muted-foreground">
                  {tInline("Ostatni backup", "Last Backup")}
                </Label>
                <div className="flex items-center gap-1.5 text-[11px] font-medium py-1.5">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  {settings.last_backup_at
                    ? new Date(settings.last_backup_at).toLocaleDateString()
                    : tInline("Nigdy", "Never")}
                </div>
              </div>
            </div>

            <Button
              className="w-full gap-2 h-9 bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-lg"
              onClick={handleManualBackup}
              disabled={loading}
            >
              <Save className="h-4 w-4" />
              {tInline("Utwórz backup", "Backup Now")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

