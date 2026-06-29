import { useReducer, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createManualSession, updateManualSession, deleteManualSession, getApplications } from "@/lib/tauri";
import { getErrorMessage, logTauriError } from "@/lib/utils";
import type { ProjectWithStats, ManualSessionWithProject } from "@/lib/db-types";
import {
  buildManualSessionFormState,
  manualSessionFormReducer,
} from '@/components/manual-session-dialog-state';

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

type FormBodyProps = {
  projects: ProjectWithStats[];
  editSession?: ManualSessionWithProject | null;
  defaultProjectId?: number | null;
  defaultStartTime?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function ManualSessionFormBody({
  projects,
  editSession,
  defaultProjectId,
  defaultStartTime,
  onOpenChange,
  onSaved,
}: FormBodyProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(
    manualSessionFormReducer,
    { editSession, defaultProjectId, defaultStartTime, projects },
    ({ editSession, defaultProjectId, defaultStartTime, projects }) =>
      buildManualSessionFormState(editSession, defaultProjectId, defaultStartTime, projects),
  );
  const {
    allowMultiDay,
    appId,
    apps,
    endTime,
    error,
    projectId,
    saving,
    sessionType,
    startTime,
    title,
  } = state;

  useEffect(() => {
    getApplications()
      .then((nextApps) => dispatch({ type: 'set_apps', apps: nextApps }))
      .catch((e) => logTauriError('manual session dialog load applications', e));
  }, []);

  const handleDelete = async () => {
    if (!editSession || !confirm(t("components.manual_session_dialog.confirm_delete"))) return;
    dispatch({ type: 'set_saving', saving: true });
    try {
      await deleteManualSession(editSession.id);
      onOpenChange(false);
      onSaved();
    } catch (error: unknown) {
      dispatch({
        type: 'set_error',
        error: getErrorMessage(error, t("components.manual_session_dialog.errors.delete")),
      });
    } finally {
      dispatch({ type: 'set_saving', saving: false });
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      dispatch({
        type: 'set_error',
        error: t("components.manual_session_dialog.errors.title_required"),
      });
      return;
    }
    if (!projectId) {
      dispatch({
        type: 'set_error',
        error: t("components.manual_session_dialog.errors.project_required"),
      });
      return;
    }
    if (!startTime || !endTime) {
      dispatch({
        type: 'set_error',
        error: t("components.manual_session_dialog.errors.time_required"),
      });
      return;
    }
    if (endTime <= startTime) {
      dispatch({
        type: 'set_error',
        error: t("components.manual_session_dialog.errors.end_after_start"),
      });
      return;
    }

    dispatch({ type: 'set_saving', saving: true });
    dispatch({ type: 'set_error', error: null });
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
      dispatch({
        type: 'set_error',
        error: getErrorMessage(error, t("components.manual_session_dialog.errors.save")),
      });
    } finally {
      dispatch({ type: 'set_saving', saving: false });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editSession ? t("components.manual_session_dialog.title_edit") : t("components.manual_session_dialog.title_add")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <label htmlFor="manual-session-title" className="text-sm font-medium">{t("components.manual_session_dialog.fields.title")}</label>
          <input
            id="manual-session-title"
            className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={title}
            onChange={(e) => dispatch({ type: 'set_title', title: e.target.value })}
            placeholder={t("components.manual_session_dialog.placeholders.title")}
          />
        </div>

        <div>
          <label htmlFor="manual-session-type" className="text-sm font-medium">{t("components.manual_session_dialog.fields.type")}</label>
          <Select
            value={sessionType}
            onValueChange={(value) => dispatch({ type: 'set_session_type', sessionType: value })}
          >
            <SelectTrigger id="manual-session-type" className="mt-1">
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
          <label htmlFor="manual-session-project" className="text-sm font-medium">{t("components.manual_session_dialog.fields.project")}</label>
          <Select
            value={projectId ? String(projectId) : ""}
            onValueChange={(v) => dispatch({ type: 'set_project_id', projectId: Number(v) })}
          >
            <SelectTrigger id="manual-session-project" className="mt-1">
              <SelectValue placeholder={t("components.manual_session_dialog.placeholders.select_project")} />
            </SelectTrigger>
            <SelectContent>
              {projects.flatMap((p) => (
                p.frozen_at ? [] : [(
                  <SelectItem key={p.id} value={String(p.id)}>
                    <div className="flex items-center gap-2">
                      <div
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      {p.name}
                    </div>
                  </SelectItem>
                )]
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label htmlFor="manual-session-app" className="text-sm font-medium">{t("components.manual_session_dialog.fields.application")}</label>
          <Select
            value={appId ? String(appId) : "none"}
            onValueChange={(v) =>
              dispatch({ type: 'set_app_id', appId: v === 'none' ? null : Number(v) })
            }
          >
            <SelectTrigger id="manual-session-app" className="mt-1">
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
            <label htmlFor="manual-session-start" className="text-sm font-medium">{t("components.manual_session_dialog.fields.start")}</label>
            <input
              id="manual-session-start"
              type="datetime-local"
              className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={startTime}
              onChange={(e) => dispatch({ type: 'set_start_time', startTime: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="manual-session-end" className="text-sm font-medium">{t("components.manual_session_dialog.fields.end")}</label>
            <input
              id="manual-session-end"
              type="datetime-local"
              className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={endTime}
              onChange={(e) => dispatch({ type: 'set_end_time', endTime: e.target.value })}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="size-4 rounded border-input accent-primary"
            checked={allowMultiDay}
            onChange={(e) =>
              dispatch({ type: 'set_allow_multi_day', allowMultiDay: e.target.checked })
            }
          />
          <span className="text-sm font-medium">{t("components.manual_session_dialog.fields.allow_multi_day")}</span>
        </label>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          {editSession && (
            <Button type="button" onClick={handleDelete} variant="destructive" className="flex-1" disabled={saving}>
              {t("components.manual_session_dialog.actions.delete")}
            </Button>
          )}
          <Button type="button" onClick={handleSave} className="flex-[2]" disabled={saving}>
            {saving
              ? t("components.manual_session_dialog.actions.saving")
              : editSession
                ? t("components.manual_session_dialog.actions.save")
                : t("components.manual_session_dialog.actions.add")}
          </Button>
        </div>
      </div>
    </>
  );
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
  const formKey = `${editSession?.id ?? 'new'}-${defaultProjectId ?? ''}-${defaultStartTime ?? ''}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <ManualSessionFormBody
            key={formKey}
            projects={projects}
            editSession={editSession}
            defaultProjectId={defaultProjectId}
            defaultStartTime={defaultStartTime}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
