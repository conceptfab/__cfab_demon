import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FolderOpen,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { useAppStore } from "@/store/app-store";
import {
  getEstimateSettings,
  getEstimatesSummary,
  getProjectEstimates,
  updateGlobalHourlyRate,
  updateProjectHourlyRate,
} from "@/lib/tauri";
import type {
  EstimateProjectRow,
  EstimateSettings,
  EstimateSummary,
} from "@/lib/db-types";

const MAX_RATE = 100000;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function parseRateInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

function formatRateInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function Estimates() {
  const {
    dateRange,
    refreshKey,
    timePreset,
    setTimePreset,
    shiftDateRange,
    canShiftForward,
    triggerRefresh,
    setCurrentPage,
  } = useAppStore();

  const [settings, setSettings] = useState<EstimateSettings | null>(null);
  const [summary, setSummary] = useState<EstimateSummary | null>(null);
  const [rows, setRows] = useState<EstimateProjectRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [globalRateInput, setGlobalRateInput] = useState("100");
  const [loading, setLoading] = useState(true);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null);
  const [globalMessage, setGlobalMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [tableMessage, setTableMessage] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);

  const currency = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }),
    []
  );
  const decimal = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGlobalError(null);
    setTableError(null);

    Promise.allSettled([
      getEstimateSettings(),
      getProjectEstimates(dateRange),
      getEstimatesSummary(dateRange),
    ])
      .then(([settingsRes, rowsRes, summaryRes]) => {
        if (cancelled) return;

        if (settingsRes.status === "fulfilled") {
          setSettings(settingsRes.value);
          setGlobalRateInput(formatRateInput(settingsRes.value.global_hourly_rate));
        } else {
          setGlobalError(
            getErrorMessage(settingsRes.reason, "Failed to load global rate")
          );
        }

        if (rowsRes.status === "fulfilled") {
          setRows(rowsRes.value);
          const nextDrafts: Record<number, string> = {};
          for (const row of rowsRes.value) {
            nextDrafts[row.project_id] =
              row.project_hourly_rate === null
                ? ""
                : formatRateInput(row.project_hourly_rate);
          }
          setDrafts(nextDrafts);
        } else {
          setRows([]);
          setTableError(getErrorMessage(rowsRes.reason, "Failed to load project estimates"));
        }

        if (summaryRes.status === "fulfilled") {
          setSummary(summaryRes.value);
        } else {
          setSummary(null);
          setTableError(getErrorMessage(summaryRes.reason, "Failed to load summary"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dateRange, refreshKey]);

  const handleSaveGlobalRate = async () => {
    const parsed = parseRateInput(globalRateInput);
    if (parsed === null || parsed < 0 || parsed > MAX_RATE) {
      setGlobalError(`Global rate must be between 0 and ${MAX_RATE}`);
      setGlobalMessage(null);
      return;
    }

    setSavingGlobal(true);
    setGlobalError(null);
    setGlobalMessage(null);
    try {
      await updateGlobalHourlyRate(parsed);
      setGlobalMessage("Global hourly rate saved");
      triggerRefresh();
    } catch (error) {
      setGlobalError(getErrorMessage(error, "Failed to save global rate"));
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveProjectRate = async (projectId: number) => {
    const raw = drafts[projectId] ?? "";
    const parsed = parseRateInput(raw);
    if (raw.trim() && (parsed === null || parsed < 0 || parsed > MAX_RATE)) {
      setTableError(`Project rate must be empty or between 0 and ${MAX_RATE}`);
      setTableMessage(null);
      return;
    }

    setSavingProjectId(projectId);
    setTableError(null);
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, parsed);
      setTableMessage("Project rate updated");
      triggerRefresh();
    } catch (error) {
      setTableError(getErrorMessage(error, "Failed to update project rate"));
    } finally {
      setSavingProjectId(null);
    }
  };

  const handleResetProjectRate = async (projectId: number) => {
    setSavingProjectId(projectId);
    setTableError(null);
    setTableMessage(null);
    try {
      await updateProjectHourlyRate(projectId, null);
      setDrafts((prev) => ({ ...prev, [projectId]: "" }));
      setTableMessage("Project rate reset to global");
      triggerRefresh();
    } catch (error) {
      setTableError(getErrorMessage(error, "Failed to reset project rate"));
    } finally {
      setSavingProjectId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(["today", "week", "month", "all"] as const).map((preset) => (
          <Button
            key={preset}
            variant={timePreset === preset ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimePreset(preset)}
            className="capitalize"
          >
            {preset === "all" ? "All time" : preset}
          </Button>
        ))}

        {timePreset !== "all" && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDateRange(-1)}
              title="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[5rem] text-center text-xs text-muted-foreground">
              {dateRange.start === dateRange.end
                ? format(parseISO(dateRange.start), "MMM d")
                : `${format(parseISO(dateRange.start), "MMM d")} – ${format(
                    parseISO(dateRange.end),
                    "MMM d"
                  )}`}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => shiftDateRange(1)}
              disabled={!canShiftForward()}
              title="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Hours"
          value={summary ? `${decimal.format(summary.total_hours)} h` : loading ? "..." : "0.00 h"}
          icon={Clock3}
        />
        <MetricCard
          title="Estimated Value"
          value={summary ? currency.format(summary.total_value) : loading ? "..." : currency.format(0)}
          icon={CircleDollarSign}
        />
        <MetricCard
          title="Active Projects"
          value={summary ? String(summary.projects_count) : loading ? "..." : "0"}
          icon={FolderOpen}
        />
        <MetricCard
          title="Rate Overrides"
          value={summary ? String(summary.overrides_count) : loading ? "..." : "0"}
          icon={SlidersHorizontal}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Global Hourly Rate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              max={MAX_RATE}
              step="0.01"
              value={globalRateInput}
              onChange={(e) => {
                setGlobalRateInput(e.target.value);
                setGlobalError(null);
                setGlobalMessage(null);
              }}
              className="h-9 w-48 rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="100"
            />
            <Button size="sm" onClick={handleSaveGlobalRate} disabled={savingGlobal}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {savingGlobal ? "Saving..." : "Save"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Current: {currency.format(settings?.global_hourly_rate ?? 100)}
            </span>
          </div>
          {globalError && <p className="text-xs text-destructive">{globalError}</p>}
          {globalMessage && !globalError && (
            <p className="text-xs text-emerald-400">{globalMessage}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Project Estimates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {tableError && <p className="text-xs text-destructive">{tableError}</p>}
          {tableMessage && !tableError && <p className="text-xs text-emerald-400">{tableMessage}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading estimates...</p>
          ) : rows.length === 0 ? (
            <div className="space-y-3 rounded-md border border-dashed p-4">
              <p className="text-sm text-muted-foreground">
                No active project time in this date range.
              </p>
              <Button variant="outline" size="sm" onClick={() => setCurrentPage("projects")}>
                Open Projects
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[980px] space-y-2">
                <div className="grid grid-cols-[minmax(220px,1.5fr)_90px_120px_130px_130px_260px] gap-2 px-2 text-xs text-muted-foreground">
                  <span>Project</span>
                  <span className="text-right">Hours</span>
                  <span className="text-right">Sessions</span>
                  <span className="text-right">Effective Rate</span>
                  <span className="text-right">Value</span>
                  <span>Project Rate Override</span>
                </div>

                {rows.map((row) => {
                  const draft = drafts[row.project_id] ?? "";
                  const isSaving = savingProjectId === row.project_id;
                  return (
                    <div
                      key={row.project_id}
                      className="grid grid-cols-[minmax(220px,1.5fr)_90px_120px_130px_130px_260px] gap-2 rounded-md border p-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: row.project_color }}
                        />
                        <span className="truncate text-sm font-medium" title={row.project_name}>
                          {row.project_name}
                        </span>
                      </div>

                      <span className="text-right font-mono text-sm">
                        {decimal.format(row.hours)}
                      </span>

                      <span className="text-right font-mono text-sm">
                        {row.session_count}
                      </span>

                      <span className="text-right font-mono text-sm">
                        {currency.format(row.effective_hourly_rate)}
                      </span>

                      <span className="text-right font-mono text-sm">
                        {currency.format(row.estimated_value)}
                      </span>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={MAX_RATE}
                          step="0.01"
                          value={draft}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [row.project_id]: e.target.value,
                            }))
                          }
                          className="h-8 w-24 rounded-md border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                          placeholder="global"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSaveProjectRate(row.project_id)}
                          disabled={isSaving}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleResetProjectRate(row.project_id)}
                          disabled={isSaving}
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
