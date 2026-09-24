import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Coins,
  Cpu,
  FolderOpen,
  Unlink,
  Check,
} from "lucide-react";
import { RendersOfflineSection } from "@/components/renders/RendersOfflineSection";
import { RendersIntegrationStatus } from "@/components/renders/RendersIntegrationStatus";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { mobileLayout } from "@/lib/mobile-layout";
import {
  getUnassignedCfabRenders,
  getAllCfabRenders,
  assignCfabRender,
  reassignCfabRender,
  detachCfabRender,
  type CfabUnassignedRenderRow,
  type CfabAllRendersResponse,
  type CfabRenderCostDetail,
} from "@/lib/tauri/cfab-render";
import { getProjects } from "@/lib/tauri/projects";
import type { ProjectWithStats } from "@/lib/db-types";
import {
  formatDurationRaw,
  formatMoney,
  formatDateTime,
  getErrorMessage,
} from "@/lib/utils";
import { useToast } from "@/components/ui/toast-notification";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function RendersPage() {
  const { t } = useTranslation();
  const { showError, showInfo } = useToast();

  const [loading, setLoading] = useState(false);
  const [unassigned, setUnassigned] = useState<CfabUnassignedRenderRow[]>([]);
  const [allRenders, setAllRenders] = useState<CfabAllRendersResponse | null>(null);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);

  // Filters for All Renders
  const [filterProjectId, setFilterProjectId] = useState<number | "all">("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");

  // Selection for Unassigned batch assignment
  const [selectedUnassignedKeys, setSelectedUnassignedKeys] = useState<Set<string>>(new Set());

  // Modals state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTargetRows, setAssignTargetRows] = useState<CfabUnassignedRenderRow[]>([]);
  const [assignSelectedProjectId, setAssignSelectedProjectId] = useState<number | null>(null);
  const [assignRememberRule, setAssignRememberRule] = useState<boolean>(true);

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignTargetRow, setReassignTargetRow] = useState<CfabRenderCostDetail | null>(null);
  const [reassignSelectedProjectId, setReassignSelectedProjectId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [unassignedRes, allRes, projectsRes] = await Promise.all([
        getUnassignedCfabRenders().catch(() => []),
        getAllCfabRenders({
          projectId: filterProjectId === "all" ? null : filterProjectId,
          dateFrom: filterDateFrom || null,
          dateTo: filterDateTo || null,
          limit: 100,
          offset: 0,
        }).catch(() => null),
        getProjects().catch(() => []),
      ]);
      setUnassigned(unassignedRes);
      setAllRenders(allRes);
      setProjects(projectsRes);
    } finally {
      setLoading(false);
    }
  }, [filterProjectId, filterDateFrom, filterDateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Unassigned selection toggles
  const toggleSelectAllUnassigned = () => {
    if (selectedUnassignedKeys.size === unassigned.length) {
      setSelectedUnassignedKeys(new Set());
    } else {
      setSelectedUnassignedKeys(
        new Set(unassigned.map((r) => `${r.hub_instance_id}:${r.ledger_id}`))
      );
    }
  };

  const toggleSelectUnassigned = (key: string) => {
    const next = new Set(selectedUnassignedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelectedUnassignedKeys(next);
  };

  const openAssignModalForRows = (rows: CfabUnassignedRenderRow[]) => {
    if (rows.length === 0) return;
    setAssignTargetRows(rows);
    const suggestedId = rows[0]?.matched_project_id ?? (projects[0]?.id ?? null);
    setAssignSelectedProjectId(suggestedId);
    setAssignRememberRule(true);
    setAssignModalOpen(true);
  };

  const handleExecuteAssign = async () => {
    if (!assignSelectedProjectId || assignTargetRows.length === 0) return;
    try {
      for (const row of assignTargetRows) {
        await assignCfabRender(
          row.hub_instance_id,
          row.ledger_id,
          assignSelectedProjectId,
          assignRememberRule
        );
      }
      setAssignModalOpen(false);
      setSelectedUnassignedKeys(new Set());
    } catch (err) {
      showError(getErrorMessage(err, t("renders_page.assign_error")));
    } finally {
      await loadData();
    }
  };

  // Każdy wiersz trafia do własnego proponowanego projektu; bez nowej reguły folderu,
  // bo propozycja już wynika z indeksu ścieżek.
  const acceptSuggestions = async (rows: CfabUnassignedRenderRow[]) => {
    const withSuggestion = rows.filter((r) => r.matched_project_id != null);
    if (withSuggestion.length === 0) return;
    setLoading(true);
    try {
      for (const row of withSuggestion) {
        await assignCfabRender(
          row.hub_instance_id,
          row.ledger_id,
          row.matched_project_id as number,
          false
        );
      }
      setSelectedUnassignedKeys(new Set());
      showInfo(t("renders_page.accept_done", { count: withSuggestion.length }));
    } catch (err) {
      showError(getErrorMessage(err, t("renders_page.assign_error")));
    } finally {
      await loadData();
    }
  };

  const handleExecuteReassign = async () => {
    if (!reassignTargetRow || !reassignSelectedProjectId) return;
    try {
      await reassignCfabRender(
        reassignTargetRow.hub_instance_id,
        reassignTargetRow.ledger_id,
        reassignSelectedProjectId
      );
      setReassignModalOpen(false);
      await loadData();
    } catch (err) {
      showError(getErrorMessage(err, t("renders_page.assign_error")));
    }
  };

  const handleExecuteDetach = async (row: CfabRenderCostDetail) => {
    if (!window.confirm(t("renders_page.detach_confirm"))) return;
    try {
      await detachCfabRender(row.hub_instance_id, row.ledger_id);
      await loadData();
    } catch (err) {
      showError(getErrorMessage(err, t("renders_page.detach_error")));
    }
  };

  const selectedRowsList = useMemo(() => {
    return unassigned.filter((r) =>
      selectedUnassignedKeys.has(`${r.hub_instance_id}:${r.ledger_id}`)
    );
  }, [unassigned, selectedUnassignedKeys]);

  const selectedWithSuggestionCount = selectedRowsList.filter(
    (r) => r.matched_project_id != null
  ).length;

  return (
    <div className={mobileLayout.pageStack}>
      {/* KPI Cards */}
      <div className={mobileLayout.metricGrid}>
        <MetricCard
          title={t("renders_page.total_time")}
          value={formatDurationRaw(allRenders?.total_seconds ?? 0)}
          icon={Clock}
        />
        <MetricCard
          title={t("renders_page.total_rbh")}
          value={`${(allRenders?.total_rbh ?? 0).toFixed(2)} RBH`}
          icon={Cpu}
        />
        <MetricCard
          title={t("renders_page.total_value")}
          value={formatMoney(allRenders?.total_value ?? 0, "PLN")}
          icon={Coins}
        />
        <MetricCard
          title={t("renders_page.unassigned_title")}
          value={unassigned.length}
          subtitle={
            unassigned.length > 0
              ? t("renders_page.unassigned_desc")
              : t("renders_page.no_unassigned")
          }
          icon={FolderOpen}
        />
      </div>

      {/* Section 1: Unassigned Renders */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
            <div className="flex items-center gap-2">
              <FolderOpen className="size-4" />
              <span>{t("renders_page.unassigned_title")}</span>
              <Badge variant="secondary">{unassigned.length}</Badge>
            </div>
            {selectedUnassignedKeys.size > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {selectedWithSuggestionCount > 0 && (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={loading}
                    onClick={() => acceptSuggestions(selectedRowsList)}
                  >
                    <Check className="size-3.5" />
                    {t("renders_page.accept_suggestions_selected", {
                      count: selectedWithSuggestionCount,
                    })}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => openAssignModalForRows(selectedRowsList)}
                >
                  {t("renders_page.assign_to_project")} (
                  {selectedUnassignedKeys.size})
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t("renders_page.no_unassigned")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={
                          selectedUnassignedKeys.size > 0 &&
                          selectedUnassignedKeys.size === unassigned.length
                        }
                        onChange={toggleSelectAllUnassigned}
                        className="size-3.5 rounded border-border"
                      />
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_scene")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_duration")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_rbh")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_machine")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_last_render")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_project")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t("renders_page.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {unassigned.map((row) => {
                    const key = `${row.hub_instance_id}:${row.ledger_id}`;
                    const isSelected = selectedUnassignedKeys.has(key);
                    return (
                      <tr
                        key={key}
                        className={`hover:bg-muted/20 ${isSelected ? "bg-muted/30" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectUnassigned(key)}
                            className="size-3.5 rounded border-border"
                          />
                        </td>
                        <td
                          className="max-w-[240px] truncate px-3 py-2 font-mono text-[11px] text-foreground/90"
                          title={row.working_path}
                        >
                          {row.working_path}
                        </td>
                        <td className="px-3 py-2">
                          {formatDurationRaw(row.render_seconds)}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {row.rbh.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {row.machine_name || "-"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDateTime(new Date(row.ended_at * 1000))}
                        </td>
                        <td className="px-3 py-2">
                          {row.matched_project_name ? (
                            <Badge variant="outline" className="text-[10px]">
                              {t("renders_page.suggested", {
                                project: row.matched_project_name,
                              })}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {row.matched_project_id != null && (
                              <Button
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                disabled={loading}
                                onClick={() => acceptSuggestions([row])}
                              >
                                <Check className="size-3.5" />
                                {t("renders_page.accept_suggestion")}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => openAssignModalForRows([row])}
                            >
                              {t("renders_page.assign_to_project")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: All Renders */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="size-4" />
              <span>{t("renders_page.all_renders_title")}</span>
              <Badge variant="secondary">{allRenders?.total ?? 0}</Badge>
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-8 rounded-md border border-border bg-transparent px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                value={filterProjectId}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterProjectId(val === "all" ? "all" : Number(val));
                }}
              >
                <option value="all" className="bg-background text-foreground">
                  {t("renders_page.all_projects")}
                </option>
                {projects.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    className="bg-background text-foreground"
                  >
                    {p.name}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{t("renders_page.filter_date_from")}:</span>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="h-8 rounded-md border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{t("renders_page.filter_date_to")}:</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="h-8 rounded-md border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!allRenders || allRenders.items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("renders_page.no_renders")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/30 text-muted-foreground">
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_last_render")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_project")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_scene")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_machine")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_duration")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_rbh")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_coeff")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_value")}
                    </th>
                    <th className="px-3 py-2 font-medium">
                      {t("renders_page.col_assignment")}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t("renders_page.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {allRenders.items.map((row) => (
                    <tr
                      key={`${row.hub_instance_id}:${row.ledger_id}`}
                      className="hover:bg-muted/20"
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(new Date(row.ended_at * 1000))}
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        {row.project_name}
                      </td>
                      <td
                        className="max-w-[220px] truncate px-3 py-2 font-mono text-[11px] text-foreground/80"
                        title={row.working_path}
                      >
                        {row.working_path}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.machine_name || "-"}
                      </td>
                      <td className="px-3 py-2">
                        {formatDurationRaw(row.render_seconds)}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {row.rbh.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {row.coefficient.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {formatMoney(row.value, "PLN")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-[10px]">
                          {row.assigned_by === "manual"
                            ? t("renders_page.assigned_manual")
                            : t("renders_page.assigned_auto")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              setReassignTargetRow(row);
                              setReassignSelectedProjectId(row.project_id);
                              setReassignModalOpen(true);
                            }}
                          >
                            {t("renders_page.reassign_project")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleExecuteDetach(row)}
                          >
                            <Unlink className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Offline Exchange (.cfabx) */}
      <RendersOfflineSection onImportSuccess={loadData} />

      {/* Integration Status Card at bottom */}
      <RendersIntegrationStatus />

      {/* Assign Modal */}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("renders_page.assign_to_project")}</DialogTitle>
            <DialogDescription>
              {assignTargetRows.length === 1
                ? assignTargetRows[0]?.working_path
                : t("renders_page.selected_count", {
                    count: assignTargetRows.length,
                  })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("renders_page.col_project")}
              </label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                value={assignSelectedProjectId ?? ""}
                onChange={(e) =>
                  setAssignSelectedProjectId(Number(e.target.value))
                }
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="remember_rule_cb"
                checked={assignRememberRule}
                onChange={(e) => setAssignRememberRule(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <label
                htmlFor="remember_rule_cb"
                className="cursor-pointer text-xs text-foreground"
              >
                {t("renders_page.remember_rule")}
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAssignModalOpen(false)}
            >
              {t("renders_page.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteAssign}
              disabled={!assignSelectedProjectId}
            >
              {t("renders_page.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reassign Modal */}
      <Dialog open={reassignModalOpen} onOpenChange={setReassignModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("renders_page.reassign_project")}</DialogTitle>
            <DialogDescription>
              {reassignTargetRow?.working_path}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {t("renders_page.col_project")}
              </label>
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                value={reassignSelectedProjectId ?? ""}
                onChange={(e) =>
                  setReassignSelectedProjectId(Number(e.target.value))
                }
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReassignModalOpen(false)}
            >
              {t("renders_page.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteReassign}
              disabled={!reassignSelectedProjectId}
            >
              {t("renders_page.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RendersPage;
