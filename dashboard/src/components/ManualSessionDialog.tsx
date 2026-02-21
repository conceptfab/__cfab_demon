import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createManualSession, updateManualSession, deleteManualSession } from "@/lib/tauri";
import type { ProjectWithStats, ManualSessionWithProject } from "@/lib/db-types";

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
  { value: "meeting", label: "Meeting" },
  { value: "call", label: "Call" },
  { value: "other", label: "Other" },
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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  return fallback;
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
  const [title, setTitle] = useState("");
  const [sessionType, setSessionType] = useState("meeting");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
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
      setStartTime(toLocalDatetimeValue(editSession.start_time));
      setEndTime(toLocalDatetimeValue(editSession.end_time));
    } else {
      setTitle("");
      setSessionType("meeting");
      setProjectId(defaultProjectId ?? projects[0]?.id ?? null);
      const start = defaultStartTime ? toLocalDatetimeValue(defaultStartTime) : toLocalDatetimeValue();
      setStartTime(start);
      // Default end = start + 1h (parse components to avoid UTC confusion)
      const [dateStr, timeStr] = start.split("T");
      const [year, month, day] = dateStr.split("-").map(Number);
      const [hours, minutes] = timeStr.split(":").map(Number);
      const startDate = new Date(year, month - 1, day, hours + 1, minutes);
      const endStr = `${String(startDate.getFullYear()).padStart(4, "0")}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}T${String(startDate.getHours()).padStart(2, "0")}:${String(startDate.getMinutes()).padStart(2, "0")}`;
      setEndTime(endStr);
    }
    setError(null);
  }, [open, editSession, defaultProjectId, defaultStartTime, projects, initializedId]);

  const handleDelete = async () => {
    if (!editSession || !confirm("Are you sure you want to delete this session?")) return;
    setSaving(true);
    try {
      await deleteManualSession(editSession.id);
      onOpenChange(false);
      onSaved();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Delete Error"));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Please enter a title");
      return;
    }
    if (!projectId) {
      setError("Please select a project");
      return;
    }
    if (!startTime || !endTime) {
      setError("Please enter start and end times");
      return;
    }
    if (endTime <= startTime) {
      setError("End time must be after the start time");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = {
        title: title.trim(),
        session_type: sessionType,
        project_id: projectId,
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
      setError(getErrorMessage(error, "Save Error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editSession ? "Edit Session" : "Add Manual Session"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Title</label>
            <input
              className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Daily standup"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SESSION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Project</label>
            <Select
              value={projectId ? String(projectId) : ""}
              onValueChange={(v) => setProjectId(Number(v))}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start</label>
              <input
                type="datetime-local"
                className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">End</label>
              <input
                type="datetime-local"
                className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2">
            {editSession && (
              <Button onClick={handleDelete} variant="destructive" className="flex-1" disabled={saving}>
                Delete
              </Button>
            )}
            <Button onClick={handleSave} className="flex-[2]" disabled={saving}>
              {saving ? "Saving..." : editSession ? "Save" : "Add Session"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
