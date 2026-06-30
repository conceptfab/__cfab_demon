import { useCallback, useEffect, useReducer } from "react";
import { useTranslation } from 'react-i18next';
import { Download, Calendar, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportData } from "@/lib/tauri";
import { useToast } from "@/components/ui/toast-notification";
import { loadProjectsAllTime } from "@/store/projects-cache-store";
import { logger } from '@/lib/logger';
import {
  exportPanelReducer,
  initialExportPanelState,
} from '@/components/data/export-panel-state';

const labelClassName = "text-sm font-medium text-muted-foreground";
const compactSelectClassName =
  "h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function ExportPanel() {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(exportPanelReducer, initialExportPanelState);
  const {
    allTime,
    dateEnd,
    dateStart,
    exportType,
    loading,
    projects,
    selectedProject,
  } = state;
  const { showInfo, showError } = useToast();

  const loadProjects = useCallback(() => {
    loadProjectsAllTime()
      .then((nextProjects) => {
        dispatch({ type: 'set_projects', projects: nextProjects });
      })
      .catch((e) => {
        logger.error('Failed to load projects:', e);
        showError(String(e));
      });
  }, [showError]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleExport = async () => {
    dispatch({ type: 'set_loading', loading: true });
    try {
      const result = await exportData(
        exportType === "single" ? parseInt(selectedProject, 10) : undefined,
        allTime ? undefined : dateStart,
        allTime ? undefined : dateEnd
      );
      showInfo(
        t('data_page.export_panel.messages.saved', {
          result,
        }),
      );
    } catch (e) {
      showError(
        t(
          'data_page.export_panel.messages.failed',
          { error: String(e) },
        ),
      );
    } finally {
      dispatch({ type: 'set_loading', loading: false });
    }
  };

  return (
    <Card className="border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Archive className="size-5 text-sky-500" />
          {t("data_page.export_panel.title")}
        </CardTitle>
        <CardDescription>{t("data_page.export_panel.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex gap-4">
            <Button
              variant={exportType === "all" ? "default" : "outline"}
              onClick={() => dispatch({ type: 'set_export_type', exportType: 'all' })}
              className="flex-1"
            >
              {t("data_page.export_panel.all_data")}
            </Button>
            <Button
              variant={exportType === "single" ? "default" : "outline"}
              onClick={() => dispatch({ type: 'set_export_type', exportType: 'single' })}
              className="flex-1"
            >
              {t("data_page.export_panel.single_project")}
            </Button>
          </div>

          {exportType === "single" && (
            <div className="rounded-md border border-border/70 bg-background/35 p-3">
              <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
                <label className={labelClassName}>
                  {t("data_page.export_panel.select_project")}
                </label>
                <Select
                  value={selectedProject}
                  onValueChange={(value) =>
                    dispatch({ type: 'set_selected_project', selectedProject: value })
                  }
                >
                  <SelectTrigger className={compactSelectClassName}>
                    <SelectValue
                      placeholder={t("data_page.export_panel.select_project_placeholder")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <label
              htmlFor="allTime"
              aria-label="Export all time"
              className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t("data_page.export_panel.all_time_title")}
                </p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {t("data_page.export_panel.all_time_description")}
                </p>
              </div>
              <input
                id="allTime"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={allTime}
                onChange={(e) =>
                  dispatch({ type: 'set_all_time', allTime: e.target.checked })
                }
              />
            </label>

            {!allTime && (
              <div className="rounded-md border border-border/70 bg-background/35 p-3">
                <div className="grid gap-1.5 text-sm">
                  <span className={labelClassName}>
                    {t("data_page.export_panel.date_range")}
                  </span>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        {t("data_page.export_panel.from")}
                      </span>
                      <div className="relative">
                        <Calendar className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                        <input
                          type="date"
                          value={dateStart}
                          aria-label={t("data_page.export_panel.from")}
                          onChange={(e) =>
                            dispatch({ type: 'set_date_start', dateStart: e.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pl-8"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        {t("data_page.export_panel.to")}
                      </span>
                      <div className="relative">
                        <Calendar className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
                        <input
                          type="date"
                          value={dateEnd}
                          aria-label={t("data_page.export_panel.to")}
                          onChange={(e) =>
                            dispatch({ type: 'set_date_end', dateEnd: e.target.value })
                          }
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 pl-8"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <Button 
          onClick={handleExport} 
          disabled={loading} 
          className="w-full gap-2 bg-sky-600 hover:bg-sky-700 text-white border-0 shadow-lg shadow-sky-950/20 transition-all duration-200"
        >
          <Download className="size-4" />
          {loading
            ? t("data_page.export_panel.exporting")
            : t("data_page.export_panel.export_data")}
        </Button>
      </CardContent>
    </Card>
  );
}
