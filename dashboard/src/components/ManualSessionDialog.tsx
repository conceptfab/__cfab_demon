import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createManualSession, updateManualSession, deleteManualSession, getApplications } from "@/lib/tauri";
import { getErrorMessage } from "@/lib/utils";
import type { ProjectWithStats, ManualSessionWithProject, AppWithStats } from "@/lib/db-types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectWithStats[];
  defaultProjectId?: number | null;
  defaultStartTime?: string;
  editSession?: ManualSessionWithProject | null;
  onSaved: () => void;
}

const SESSION_TYPES = [
  { value: "meeting", labelKey: "components.manual_session_dialog.session_types.meeting" },
  { value: "call", labelKey: "components.manual_session_dialog.session_types.call" },
  { value: "other", labelKey: "components.manual_session_dialog.session_types.other" },
];

function toLocalDatetimeValue(iso?: string): string {
  if (!iso) {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }
  // If already in YYYY-MM-DDTHH:MM format, use as-is
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) {
    return iso.slice(0, 16);
  }
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function ManualSessionDialog({
  open,
  onOpenChange,
  projects,
  defaultProjectId,
  defaultStartTime,
  editSession,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [sessionType, setSessionType] = useState("meeting");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [appId, setAppId] = useState<number | null>(null);
  const [apps, setApps] = useState<AppWithStats[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowMultiDay, setAllowMultiDay] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initializedId, setInitializedId] = useState<number | "new" | null>(null);

  useEffect(() => {
    if (!open) {
      setInitializedId(null);
      return;
    }

    const currentId = editSession?.id ?? "new";
    if (initializedId === currentId) return;
    setInitializedId(currentId);

    if (editSession) {
      setTitle(editSession.title);
      setSessionType(editSession.session_type);
      setProjectId(editSession.project_id);
      setAppId(editSession.app_id ?? null);
      setStartTime(toLocalDatetimeValue(editSession.start_time));
      setEndTime(toLocalDatetimeValue(editSession.end_time));
      // Check if start and end dates are different
      const startDay = editSession.start_time.split("T")[0];
      const endDay = editSession.end_time.split("T")[0];
      setAllowMultiDay(startDay !== endDay);
    } else {
      setTitle("");
      setSessionType("meeting");
      setProjectId(defaultProjectId ?? projects[0]?.id ?? null);
      setAppId(null);
      const start = defaultStartTime ? toLocalDatetimeValue(defaultStartTime) : toLocalDatetimeValue();
      setStartTime(start);
      // Default end = start + 1h (parse components to avoid UTC confusion)
      const parts = start.split("T");
      const dateStr = parts[0] ?? "";
      const timeStr = parts[1] ?? "00:00";
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = timeStr.split(":").map(Number);
      const startDate = new Date(year, month - 1, day, hours + 1, minutes);
      const endStr = `${String(startDate.getFullYear()).padStart(4, "0")}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}T${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getHours()).padStart(2, "0")}`;
      setEndTime(endStr);
      setAllowMultiDay(false);
    }
    setError(null);

    // Fetch applications
    getApplications().then(setApps).catch(console.error);
  }, [open, editSession, defaultProjectId, defaultStartTime, projects, initializedId]);

  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    if (!allowMultiDay) {
      const parts = newStartTime.split("T");
      if (parts.length === 2) {
        const newDate = parts[0];
        const endParts = endTime.split("T");
        if (endParts.length === 2) {
          setEndTime(`${newDate}T${endParts[1]}`);
        }
      }
    }
  };

  const handleAllowMultiDayChange = (checked: boolean) => {
    setAllowMultiDay(checked);
    if (!checked) {
      const startParts = startTime.split("T");
      const endParts = endTime.split("T");
      if (startParts.length === 2 && endParts.length === 2) {
        setEndTime(`${startParts[0]}T${endParts[1]}`);
      }
    }
  };

  const handleDelete = async () => {
    if (!editSession || !confirm(t("components.manual_session_dialog.confirm_delete"))) return;
    setSaving(true);
    try {
      await deleteManualSession(editSession.id);
      onOpenChange(false);
      onSaved();
    } catch (error: unknown) {
      setError(getErrorMessage(error, t("components.manual_session_dialog.errors.delete")));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError(t("components.manual_session_dialog.errors.title_required"));
      return;
    }
    if (!projectId) {
      setError(t("components.manual_session_dialog.errors.project_required"));
      return;
    }
    if (!startTime || !endTime) {
      setError(t("components.manual_session_dialog.errors.time_required"));
      return;
    }
    if (endTime <= startTime) {
      setError(t("components.manual_session_dialog.errors.end_after_start"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = {
        title: title.trim(),
        session_type: sessionType,
        project_id: projectId,
        app_id: appId,
        start_time: startTime,
        end_time: endTime,
      };
      if (editSession) {
        await updateManualSession(editSession.id, input);
      } else {
        await createManualSession(input);
      }
      onOpenChange(false);
      onSaved();
    } catch (error: unknown) {
      setError(getErrorMessage(error, t("components.manual_session_dialog.errors.save")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editSession ? t("components.manual_session_dialog.title_edit") : t("components.manual_session_dialog.title_add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.title")}</label>
            <input
              className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("components.manual_session_dialog.placeholders.title")}
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.type")}</label>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SESSION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {t(type.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.project")}</label>
            <Select
              value={projectId ? String(projectId) : ""}
              onValueChange={(v) => setProjectId(Number(v))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t("components.manual_session_dialog.placeholders.select_project")} />
              </SelectTrigger>
              <SelectContent>
                {projects.filter((p) => !p.frozen_at).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      {p.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.application")}</label>
            <Select
              value={appId ? String(appId) : "none"}
              onValueChange={(v) => setAppId(v === "none" ? null : Number(v))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t("components.manual_session_dialog.placeholders.manual_no_app")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("components.manual_session_dialog.placeholders.manual_no_app")}</SelectItem>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.start")}</label>
              <input
                type="datetime-local"
                className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("components.manual_session_dialog.fields.end")}</label>
              <input
                type="datetime-local"
                className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={allowMultiDay}
              onChange={(e) => handleAllowMultiDayChange(e.target.checked)}
            />
            <span className="text-sm font-medium">{t("components.manual_session_dialog.fields.allow_multi_day")}</span>
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            {editSession && (
              <Button onClick={handleDelete} variant="destructive" className="flex-1" disabled={saving}>
                {t("components.manual_session_dialog.actions.delete")}
              </Button>
            )}
            <Button onClick={handleSave} className="flex-[2]" disabled={saving}>
              {saving
                ? t("components.manual_session_dialog.actions.saving")
                : editSession
                  ? t("components.manual_session_dialog.actions.save")
                  : t("components.manual_session_dialog.actions.add")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
