import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, CircleDollarSign, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PromptModal } from "@/components/ui/prompt-modal";
import { formatDuration } from "@/lib/utils";
import {
  normalizeHexColor,
  timeToMinutes,
  type WorkingHoursSettings,
} from "@/lib/user-settings";
import type { SessionWithApp, ProjectWithStats, ManualSessionWithProject } from "@/lib/db-types";

interface Props {
  sessions: SessionWithApp[];
  manualSessions?: ManualSessionWithProject[];
  workingHours?: WorkingHoursSettings;
  title?: string;
  minHeightClassName?: string;
  projects?: ProjectWithStats[];
  onAssignSession?: (sessionIds: number[], projectId: number | null) => void | Promise<void>;
  onUpdateSessionRateMultiplier?: (sessionIds: number[], multiplier: number | null) => void | Promise<void>;
  onUpdateSessionComment?: (sessionId: number, comment: string | null) => void | Promise<void>;
  onAddManualSession?: (startTime?: string) => void;
  onEditManualSession?: (session: ManualSessionWithProject) => void;
}

interface SegmentData {
  sessionId: number;
  sessionIds?: number[];
  fragmentCount?: number;
  fragments?: SegmentData[];
  startMs: number;
  endMs: number;
  appName: string;
  appNames?: string[];
  appId: number;
  rateMultiplier?: number;
  mixedRateMultiplier?: boolean;
  isManual?: boolean;
  manualTitle?: string;
  manualSession?: ManualSessionWithProject;
  comment?: string | null;
  hasSuggestion?: boolean;
  suggestedProjectName?: string;
  suggestedProjectId?: number;
  suggestedConfidence?: number;
}

interface TimelineRow {
  name: string;
  color: string;
  totalSeconds: number;
  isUnassigned: boolean;
  boostedCount: number;
  segments: SegmentData[];
}

type CtxMenu =
  | { type: "assign"; x: number; y: number; segment: SegmentData; rowName: string; rowColor: string }
  | { type: "timeline"; x: number; y: number; timeMs: number; editSession?: ManualSessionWithProject };

interface ClusterDetailsState {
  rowName: string;
  rowColor: string;
  segment: SegmentData;
}

interface PromptConfig {
  title: string;
  initialValue: string;
  onConfirm: (val: string) => void;
  description?: string;
}

const HATCH_STYLE: React.CSSProperties = {
  background: `repeating-linear-gradient(
    30deg,
    transparent,
    transparent 3px,
    rgba(0,0,0,0.15) 3px,
    rgba(0,0,0,0.15) 4px
  )`,
  pointerEvents: "none",
};
const SESSION_FRAGMENT_CLUSTER_GAP_MS = 60_000;

function formatMultiplierLabel(multiplier?: number): string {
  const value = typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Number.isInteger(value)
    ? `x${value.toFixed(0)}`
    : `x${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function getSegmentSessionIds(segment: SegmentData): number[] {
  if (segment.isManual) return [];
  if (segment.sessionIds && segment.sessionIds.length > 0) return segment.sessionIds;
  return [segment.sessionId];
}

function getSegmentFragments(segment: SegmentData): SegmentData[] {
  if (segment.fragments && segment.fragments.length > 0) return segment.fragments;
  return [segment];
}

function summarizeCluster(segment: SegmentData) {
  const fragments = getSegmentFragments(segment)
    .filter((f) => !f.isManual)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const sessionIds = Array.from(new Set(fragments.flatMap((f) => getSegmentSessionIds(f))));
  const appNames = Array.from(new Set(fragments.map((f) => f.appName))).sort((a, b) => a.localeCompare(b));
  const spanMs = Math.max(0, segment.endMs - segment.startMs);
  const sumMs = fragments.reduce((acc, f) => acc + Math.max(0, f.endMs - f.startMs), 0);

  let unionMs = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const f of fragments) {
    if (cursorStart < 0) {
      cursorStart = f.startMs;
      cursorEnd = f.endMs;
      continue;
    }
    if (f.startMs <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, f.endMs);
      continue;
    }
    unionMs += Math.max(0, cursorEnd - cursorStart);
    cursorStart = f.startMs;
    cursorEnd = f.endMs;
  }
  if (cursorStart >= 0) {
    unionMs += Math.max(0, cursorEnd - cursorStart);
  }

  const overlapMs = Math.max(0, sumMs - unionMs);
  const boostedCount = fragments.filter((f) => (f.rateMultiplier ?? 1) > 1.000_001).length;
  return { fragments, sessionIds, appNames, spanMs, sumMs, unionMs, overlapMs, boostedCount };
}

function mergeSessionFragments(segments: SegmentData[]): SegmentData[] {
  if (segments.length <= 1) return segments;

  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: SegmentData[] = [];

  for (const segment of sorted) {
    const prev = out[out.length - 1];
    const canMerge =
      prev &&
      !prev.isManual &&
      !segment.isManual &&
      segment.startMs <= prev.endMs + SESSION_FRAGMENT_CLUSTER_GAP_MS;

    if (!canMerge) {
      const fragments = segment.isManual ? undefined : [segment];
      const appNames = segment.isManual ? undefined : [segment.appName];
      out.push({
        ...segment,
        sessionIds: segment.isManual ? undefined : getSegmentSessionIds(segment),
        fragmentCount: segment.isManual ? undefined : 1,
        fragments,
        appNames,
        mixedRateMultiplier: segment.isManual ? undefined : false,
      });
      continue;
    }

    const prevIds = getSegmentSessionIds(prev);
    const nextIds = getSegmentSessionIds(segment);
    const prevRate = typeof prev.rateMultiplier === "number" ? prev.rateMultiplier : 1;
    const nextRate = typeof segment.rateMultiplier === "number" ? segment.rateMultiplier : 1;
    const mergedRate = Math.max(prevRate, nextRate);
    const mixedRateMultiplier =
      Boolean(prev.mixedRateMultiplier) ||
      Boolean(segment.mixedRateMultiplier) ||
      Math.abs(prevRate - nextRate) > 0.000_001;

    const prevFragments = getSegmentFragments(prev);
    const nextFragments = getSegmentFragments(segment);
    const mergedFragments = [...prevFragments, ...nextFragments].sort(
      (a, b) => a.startMs - b.startMs || a.endMs - b.endMs
    );
    const appNames = Array.from(new Set(mergedFragments.map((f) => f.appName)));
    const appLabel =
      appNames.length <= 1
        ? (appNames[0] ?? prev.appName)
        : `${appNames.length} apps`;

    out[out.length - 1] = {
      ...prev,
      sessionIds: [...prevIds, ...nextIds],
      sessionId: prevIds[0] ?? prev.sessionId,
      fragmentCount: (prev.fragmentCount ?? 1) + (segment.fragmentCount ?? 1),
      fragments: mergedFragments,
      appNames,
      appName: appLabel,
      startMs: Math.min(prev.startMs, segment.startMs),
      endMs: Math.max(prev.endMs, segment.endMs),
      rateMultiplier: mergedRate,
      mixedRateMultiplier,
      hasSuggestion: Boolean(prev.hasSuggestion) || Boolean(segment.hasSuggestion),
      suggestedProjectName: (prev.suggestedConfidence ?? 0) >= (segment.suggestedConfidence ?? 0) ? (prev.suggestedProjectName || segment.suggestedProjectName) : (segment.suggestedProjectName || prev.suggestedProjectName),
      suggestedProjectId: (prev.suggestedConfidence ?? 0) >= (segment.suggestedConfidence ?? 0) ? (prev.suggestedProjectId ?? segment.suggestedProjectId) : (segment.suggestedProjectId ?? prev.suggestedProjectId),
      suggestedConfidence: Math.max(prev.suggestedConfidence ?? 0, segment.suggestedConfidence ?? 0),
    };
  }

  return out;
}

function fmtHourMinute(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function chooseTickMinutes(spanMinutes: number): number {
  if (spanMinutes <= 120) return 15;
  if (spanMinutes <= 360) return 30;
  if (spanMinutes <= 720) return 60;
  return 120;
}

function hexToRgba(hex: string, alpha: number): string {
  const color = normalizeHexColor(hex).replace("#", "");
  const expanded =
    color.length === 3
      ? color
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : color;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ProjectDayTimeline({
  sessions,
  manualSessions = [],
  workingHours,
  title = "Activity Timeline",
  minHeightClassName,
  projects,
  onAssignSession,
  onUpdateSessionRateMultiplier,
  onUpdateSessionComment,
  onAddManualSession,
  onEditManualSession,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [clusterDetails, setClusterDetails] = useState<ClusterDetailsState | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ctxMenu]);

  const handleSegmentContextMenu = useCallback(
    (e: React.MouseEvent, segment: SegmentData, rowName: string, rowColor: string) => {
      const canAssign = Boolean(onAssignSession && projects?.length);
      const canSetMultiplier = Boolean(onUpdateSessionRateMultiplier);
      const canComment = Boolean(onUpdateSessionComment);
      const hasSuggestion = Boolean(segment.hasSuggestion);
      if (!canAssign && !canSetMultiplier && !canComment && !hasSuggestion) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ type: "assign", x: e.clientX, y: e.clientY, segment, rowName, rowColor });
    },
    [onAssignSession, onUpdateSessionRateMultiplier, onUpdateSessionComment, projects]
  );

  const handleTimelineContextMenu = useCallback(
    (e: React.MouseEvent, rangeStart: number, rangeSpan: number) => {
      if (!onAddManualSession) return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const pct = relX / rect.width;
      const timeMs = rangeStart + pct * rangeSpan;
      setCtxMenu({ type: "timeline", x: e.clientX, y: e.clientY, timeMs });
    },
    [onAddManualSession]
  );

  const handleManualSegmentContextMenu = useCallback(
    (e: React.MouseEvent, segment: SegmentData) => {
      if (!onEditManualSession || !segment.manualSession) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({
        type: "timeline",
        x: e.clientX,
        y: e.clientY,
        timeMs: segment.startMs,
        editSession: segment.manualSession,
      });
    },
    [onEditManualSession]
  );

  const handleAssign = useCallback(
    async (projectId: number | null) => {
      if (!ctxMenu || ctxMenu.type !== "assign" || !onAssignSession) return;
      try {
        const sessionIds = getSegmentSessionIds(ctxMenu.segment);
        if (sessionIds.length === 0) return;
        await onAssignSession(sessionIds, projectId);
      } catch (err) {
        console.error("Failed to assign session(s) to project:", err);
        window.alert(`Failed to assign session(s): ${String(err)}`);
      } finally {
        setCtxMenu(null);
      }
    },
    [ctxMenu, onAssignSession]
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (!ctxMenu || ctxMenu.type !== "assign" || !onUpdateSessionRateMultiplier) return;
      try {
        const sessionIds = getSegmentSessionIds(ctxMenu.segment);
        if (sessionIds.length === 0) return;
        await onUpdateSessionRateMultiplier(sessionIds, multiplier);
      } catch (err) {
        console.error("Failed to update session rate multiplier:", err);
        window.alert(`Failed to update session rate multiplier: ${String(err)}`);
      } finally {
        setCtxMenu(null);
      }
    },
    [ctxMenu, onUpdateSessionRateMultiplier]
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu || ctxMenu.type !== "assign") return;
    const current =
      ctxMenu.segment.mixedRateMultiplier
        ? 1
        : (typeof ctxMenu.segment.rateMultiplier === "number" ? ctxMenu.segment.rateMultiplier : 1);
    const suggested = current > 1 ? current : 2;

    setPromptConfig({
      title: "Set session rate multiplier",
      description: "Set multiplier (> 0). Use 1 to reset.",
      initialValue: String(suggested),
      onConfirm: async (raw) => {
        const normalizedRaw = raw.trim().replace(",", ".");
        const parsed = Number(normalizedRaw);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          window.alert("Multiplier must be a positive number.");
          return;
        }
        await handleSetRateMultiplier(parsed);
      }
    });
    setCtxMenu(null);
  }, [ctxMenu, handleSetRateMultiplier]);

  const handleEditComment = useCallback(async () => {
    if (!ctxMenu || ctxMenu.type !== "assign" || !onUpdateSessionComment) return;
    const sessionIds = getSegmentSessionIds(ctxMenu.segment);
    if (sessionIds.length === 0) return;
    const current = ctxMenu.segment.comment ?? "";
    const sessionId = sessionIds[0];

    setPromptConfig({
      title: "Session comment",
      description: sessionIds.length > 1
        ? `(applies to first session of ${sessionIds.length}; leave empty to remove)`
        : "(leave empty to remove)",
      initialValue: current,
      onConfirm: async (raw) => {
        const trimmed = raw.trim();
        try {
          await onUpdateSessionComment(sessionId, trimmed || null);
        } catch (err) {
          console.error("Failed to update session comment:", err);
        }
      }
    });
    setCtxMenu(null);
  }, [ctxMenu, onUpdateSessionComment]);

  const handleOpenClusterDetails = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== "assign") return;
    setClusterDetails({
      rowName: ctxMenu.rowName,
      rowColor: ctxMenu.rowColor,
      segment: ctxMenu.segment,
    });
    setCtxMenu(null);
  }, [ctxMenu]);

  const handleAddSession = useCallback(() => {
    if (!ctxMenu || ctxMenu.type !== "timeline" || !onAddManualSession) return;
    if (ctxMenu.editSession && onEditManualSession) {
      onEditManualSession(ctxMenu.editSession);
      setCtxMenu(null);
      return;
    }
    const d = new Date(ctxMenu.timeMs);
    d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    onAddManualSession(local.toISOString().slice(0, 16));
    setCtxMenu(null);
  }, [ctxMenu, onAddManualSession, onEditManualSession]);

  const model = useMemo(() => {
    const valid = sessions
      .map((s) => {
        const startMs = new Date(s.start_time).getTime();
        const endMs = new Date(s.end_time).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
        return { s, startMs, endMs };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
      .sort((a, b) => a.startMs - b.startMs);

    // Parse manual sessions
    const validManual = manualSessions
      .map((ms) => {
        const startMs = new Date(ms.start_time).getTime();
        const endMs = new Date(ms.end_time).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
        return { ms, startMs, endMs };
      })
      .filter((v): v is NonNullable<typeof v> => Boolean(v));

    if (valid.length === 0 && validManual.length === 0) {
      return null;
    }

    const allStarts = [...valid.map((v) => v.startMs), ...validManual.map((v) => v.startMs)];
    const allEnds = [...valid.map((v) => v.endMs), ...validManual.map((v) => v.endMs)];
    const rawStart = Math.min(...allStarts);
    const rawEnd = Math.max(...allEnds);
    const workingColor = normalizeHexColor(workingHours?.color ?? "");

    const workingStartMinutes = timeToMinutes(workingHours?.start ?? "");
    const workingEndMinutes = timeToMinutes(workingHours?.end ?? "");

    const workingRangeRaw =
      workingStartMinutes !== null &&
      workingEndMinutes !== null &&
      workingEndMinutes > workingStartMinutes
        ? (() => {
            const base = new Date(rawStart);
            const dayStart = new Date(
              base.getFullYear(),
              base.getMonth(),
              base.getDate(),
              0,
              0,
              0,
              0
            ).getTime();
            return {
              startMs: dayStart + workingStartMinutes * 60_000,
              endMs: dayStart + workingEndMinutes * 60_000,
              label: `${workingHours?.start ?? "09:00"} - ${workingHours?.end ?? "17:00"}`,
            };
          })()
        : null;

    const alignedStart = workingRangeRaw
      ? Math.min(rawStart, workingRangeRaw.startMs)
      : rawStart;
    const alignedEnd = workingRangeRaw ? Math.max(rawEnd, workingRangeRaw.endMs) : rawEnd;

    const spanMinutes = Math.max(1, Math.ceil((alignedEnd - alignedStart) / 60000));
    const tickMinutes = chooseTickMinutes(spanMinutes);
    const tickMs = tickMinutes * 60_000;

    const rangeStart = Math.floor(alignedStart / tickMs) * tickMs;
    const rangeEnd = Math.ceil(alignedEnd / tickMs) * tickMs;
    const rangeSpan = Math.max(60_000, rangeEnd - rangeStart);

    const workingRange = workingRangeRaw
      ? (() => {
          const left = ((workingRangeRaw.startMs - rangeStart) / rangeSpan) * 100;
          const right = ((workingRangeRaw.endMs - rangeStart) / rangeSpan) * 100;
          const leftClamped = Math.max(0, Math.min(100, left));
          const rightClamped = Math.max(0, Math.min(100, right));
          if (rightClamped <= leftClamped) return null;
          return {
            leftPct: leftClamped,
            widthPct: rightClamped - leftClamped,
            label: workingRangeRaw.label,
            color: workingColor,
          };
        })()
      : null;

    const byProject = new Map<string, TimelineRow>();
    for (const item of valid) {
      const projectName = item.s.project_name ?? "Unassigned";
      const projectColor = item.s.project_color ?? "#64748b";
      const isUnassigned = item.s.project_name === null;

      const key = projectName.toLowerCase();
      if (!byProject.has(key)) {
        byProject.set(key, {
          name: projectName,
          color: projectColor,
          totalSeconds: 0,
          isUnassigned,
          boostedCount: 0,
          segments: [],
        });
      }
      const row = byProject.get(key)!;
      row.totalSeconds += item.s.duration_seconds;
      if ((item.s.rate_multiplier ?? 1) > 1.000_001) row.boostedCount++;
      const suggestedProject = projects?.find(p => p.id === item.s.suggested_project_id);
      const suggestedName = item.s.suggested_project_name && item.s.suggested_project_name !== "?" 
        ? item.s.suggested_project_name 
        : suggestedProject?.name || "Unknown";
      const hasValidSuggestion = item.s.suggested_project_id != null;

      row.segments.push({
        sessionId: item.s.id,
        startMs: item.startMs,
        endMs: item.endMs,
        appName: item.s.app_name,
        appId: item.s.app_id,
        rateMultiplier: item.s.rate_multiplier ?? 1,
        comment: item.s.comment,
        hasSuggestion: hasValidSuggestion,
        suggestedProjectName: suggestedName,
        suggestedProjectId: item.s.suggested_project_id,
        suggestedConfidence: item.s.suggested_confidence,
      });
    }

    // Add manual sessions to their project rows
    for (const item of validManual) {
      const projectName = item.ms.project_name;
      const key = projectName.toLowerCase();
      if (!byProject.has(key)) {
        byProject.set(key, {
          name: projectName,
          color: item.ms.project_color,
          totalSeconds: 0,
          isUnassigned: false,
          boostedCount: 0,
          segments: [],
        });
      }
      const row = byProject.get(key)!;
      row.totalSeconds += item.ms.duration_seconds;
      row.segments.push({
        sessionId: item.ms.id,
        startMs: item.startMs,
        endMs: item.endMs,
        appName: item.ms.title,
        appId: -1,
        isManual: true,
        manualTitle: item.ms.title,
        manualSession: item.ms,
      });
    }

    const rows = Array.from(byProject.values())
      .map((row) => ({
        ...row,
        segments: mergeSessionFragments(row.segments),
      }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
    const ticks: number[] = [];
    for (let t = rangeStart; t <= rangeEnd; t += tickMs) {
      ticks.push(t);
    }

    const totalSeconds = rows.reduce((acc, row) => acc + row.totalSeconds, 0);
    return { rows, ticks, rangeStart, rangeSpan, totalSeconds, workingRange };
  }, [sessions, manualSessions, workingHours]);

  const clusterDetailsSummary = useMemo(() => {
    if (!clusterDetails) return null;
    return summarizeCluster(clusterDetails.segment);
  }, [clusterDetails]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between gap-2">
          <span>{title}</span>
          <span className="text-xs text-muted-foreground">
            {model ? `Total: ${formatDuration(model.totalSeconds)}` : "No data"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className={minHeightClassName ?? ""}>
        {!model && (
          <p className="text-sm text-muted-foreground py-6">
            No project activity in selected day.
          </p>
        )}

        {model && (
          <div className="space-y-3">


            {(() => {
              const unassigned = model.rows.find((row) => row.isUnassigned);
              if (!unassigned) return null;
              return (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <span className="font-semibold">Unassigned sessions detected.</span>{" "}
                  Right-click their segments to assign each session to a project.
                </div>
              );
            })()}
            {model.rows.map((row) => (
              <div key={row.name} className="grid grid-cols-[170px_1fr_90px] items-center gap-3">
                <div
                  className={`flex items-center gap-1 text-xs ${row.isUnassigned ? "text-amber-300" : "text-muted-foreground"}`}
                  title={row.name}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                  <span className="truncate">{row.name}</span>
                  {row.boostedCount > 0 && (
                    <span className="shrink-0" title={`${row.boostedCount} boosted session(s)`}>
                      <CircleDollarSign className="h-3 w-3 text-emerald-400" />
                    </span>
                  )}
                </div>
                <div
                  className="relative h-7 rounded-md border border-border/60 bg-secondary/20 overflow-hidden"
                  onContextMenu={
                    onAddManualSession
                      ? (e) => handleTimelineContextMenu(e, model.rangeStart, model.rangeSpan)
                      : undefined
                  }
                >
                  {model.workingRange && (
                    <div
                      className="absolute inset-y-0 pointer-events-none border-x"
                      style={{
                        left: `${model.workingRange.leftPct}%`,
                        width: `${model.workingRange.widthPct}%`,
                        borderColor: hexToRgba(model.workingRange.color, 0.42),
                        backgroundColor: hexToRgba(model.workingRange.color, 0.14),
                      }}
                      title={`Working hours: ${model.workingRange.label}`}
                    />
                  )}
                  {row.segments.map((segment, idx) => {
                    const left = ((segment.startMs - model.rangeStart) / model.rangeSpan) * 100;
                    const width = ((segment.endMs - segment.startMs) / model.rangeSpan) * 100;
                    const fragmentCount = segment.fragmentCount ?? 1;
                    const hasManyFragments = !segment.isManual && fragmentCount > 1;
                    const hasBoostedRate = (segment.rateMultiplier ?? 1) > 1.000001;
                    const multiplierLabel = segment.mixedRateMultiplier
                      ? "mixed"
                      : formatMultiplierLabel(segment.rateMultiplier);
                    const titleBase = segment.isManual
                      ? `[Manual] ${segment.manualTitle}`
                      : segment.appName;
                    const titleFragments = hasManyFragments
                      ? ` • ${fragmentCount} sessions`
                      : "";
                    const titleRate = hasBoostedRate || segment.mixedRateMultiplier
                      ? ` • $$$ ${multiplierLabel}`
                      : "";
                    const titleSuggestion = segment.hasSuggestion && !segment.isManual && segment.suggestedProjectName
                      ? ` • AI Suggests: ${segment.suggestedProjectName}${segment.suggestedConfidence != null ? ` (${(segment.suggestedConfidence * 100).toFixed(0)}%)` : ""} (Right-click to assign)`
                      : "";
                    return (
                      <div
                        key={`${row.name}-${idx}-${segment.startMs}`}
                        className={`absolute top-1 bottom-1 rounded-sm${(onAssignSession || onUpdateSessionRateMultiplier) ? " cursor-context-menu" : ""}`}
                        style={{
                          left: `${Math.max(0, Math.min(100, left))}%`,
                          width: `${Math.max(0.8, Math.min(100, width))}%`,
                          backgroundColor: row.color,
                          opacity: 0.9,
                        }}
                        title={`${titleBase}: ${fmtHourMinute(segment.startMs)} - ${fmtHourMinute(segment.endMs)}${titleFragments}${titleRate}${titleSuggestion}`}
                        onContextMenu={
                          !segment.isManual
                            ? (e) => handleSegmentContextMenu(e, segment, row.name, row.color)
                            : segment.isManual
                              ? (e) => handleManualSegmentContextMenu(e, segment)
                              : undefined
                        }
                      >
                        {segment.isManual && (
                          <div className="absolute inset-0 rounded-sm" style={HATCH_STYLE} />
                        )}
                        {segment.hasSuggestion && !segment.isManual && (
                          <div className="pointer-events-none absolute left-0.5 top-0.5 flex items-center justify-center rounded bg-black/40 p-[2px] shadow-sm">
                            <Sparkles className="h-2.5 w-2.5 text-sky-300" />
                          </div>
                        )}
                        {segment.comment && (
                          <div className="pointer-events-none absolute left-0.5 bottom-0.5 flex items-center justify-center rounded bg-black/40 p-[2px] shadow-sm">
                            <MessageSquare className="h-2.5 w-2.5 text-amber-300" />
                          </div>
                        )}
                        {(segment.rateMultiplier ?? 1) > 1.000001 && (
                          <div className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/35 px-1 py-[1px] text-[9px] font-semibold leading-none text-emerald-100 shadow-sm">
                            $$$
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="text-right font-mono text-xs">{formatDuration(row.totalSeconds)}</div>
              </div>
            ))}

            <div className="grid grid-cols-[170px_1fr_90px] items-start gap-3 pt-1">
              <div />
              <div className="relative h-7">
                {model.ticks.map((tick) => {
                  const left = ((tick - model.rangeStart) / model.rangeSpan) * 100;
                  return (
                    <div
                      key={tick}
                      className="absolute top-0 text-[10px] text-muted-foreground"
                      style={{ left: `${left}%`, transform: "translateX(-50%)" }}
                    >
                      <div className="mx-auto h-2 w-px bg-border/70" />
                      <div className="mt-1">{fmtHourMinute(tick)}</div>
                    </div>
                  );
                })}
              </div>
              <div />
            </div>
          </div>
        )}
      </CardContent>

      {/* Context menu for session actions on timeline segment */}
      {ctxMenu && ctxMenu.type === "assign" && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Session actions ({ctxMenu.segment.appName})
            {!ctxMenu.segment.isManual && (ctxMenu.segment.fragmentCount ?? 1) > 1 ? (
              <span className="ml-1 text-[10px] font-normal">
                · {(ctxMenu.segment.fragmentCount ?? 1)} sessions
              </span>
            ) : null}
          </div>
          {ctxMenu.segment.hasSuggestion && !ctxMenu.segment.isManual && (
            <div className="mx-1 mb-1 rounded-sm bg-sky-500/15 border border-sky-500/25 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 shrink-0 text-sky-400" />
                <span className="text-[11px] text-sky-200">
                  AI suggests: <span className="font-medium">{ctxMenu.segment.suggestedProjectName || "Unknown"}</span>
                  {ctxMenu.segment.suggestedConfidence != null && (
                    <span className="ml-1 opacity-75">({((ctxMenu.segment.suggestedConfidence) * 100).toFixed(0)}%)</span>
                  )}
                </span>
              </div>
              {onAssignSession && ctxMenu.segment.suggestedProjectId != null && (
                <div className="flex items-center gap-1 mt-1.5">
                  <button
                    className="rounded-sm bg-sky-500/25 hover:bg-sky-500/40 px-2 py-1 text-[11px] text-sky-100 transition-colors cursor-pointer"
                    onClick={() => {
                      const sessionIds = getSegmentSessionIds(ctxMenu.segment);
                      if (sessionIds.length > 0 && ctxMenu.segment.suggestedProjectId !== undefined) {
                        void onAssignSession(sessionIds, ctxMenu.segment.suggestedProjectId);
                      }
                      setCtxMenu(null);
                    }}
                  >
                    Accept
                  </button>
                  <button
                    className="rounded-sm hover:bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors cursor-pointer"
                    onClick={() => {
                      const sessionIds = getSegmentSessionIds(ctxMenu.segment);
                      if (sessionIds.length > 0) {
                        void onAssignSession(sessionIds, null);
                      }
                      setCtxMenu(null);
                    }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="h-px bg-border my-1" />
          <button
            className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={handleOpenClusterDetails}
          >
            <span>Session details</span>
            {!ctxMenu.segment.isManual && (ctxMenu.segment.fragmentCount ?? 1) > 1 ? (
              <span className="font-mono text-[10px] opacity-80">
                {(ctxMenu.segment.fragmentCount ?? 1)}
              </span>
            ) : null}
          </button>
          {onUpdateSessionRateMultiplier && (
            <>
              <div className="h-px bg-border my-1" />
              {!ctxMenu.segment.isManual && (ctxMenu.segment.fragmentCount ?? 1) > 1 && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground">
                  Applies to all {(ctxMenu.segment.fragmentCount ?? 1)} sessions in this visual chunk
                </div>
              )}
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                Rate multiplier (default x2):{" "}
                <span className="font-mono">
                  {ctxMenu.segment.mixedRateMultiplier
                    ? "mixed"
                    : formatMultiplierLabel(ctxMenu.segment.rateMultiplier)}
                </span>
              </div>
              <div className="flex gap-1.5 px-1.5 pb-1.5">
                <button
                  className="flex-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
                  onClick={() => void handleSetRateMultiplier(2)}
                >
                  Boost x2
                </button>
                <button
                  className="flex-1 rounded border border-border bg-secondary/30 py-2 text-xs font-medium transition-colors hover:bg-secondary/60 cursor-pointer"
                  onClick={() => void handleCustomRateMultiplier()}
                >
                  Custom...
                </button>
              </div>
            </>
          )}
          {onUpdateSessionComment && !ctxMenu.segment.isManual && (
            <>
              <div className="h-px bg-border my-1" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                onClick={() => void handleEditComment()}
              >
                <span className="h-4 w-4 shrink-0 text-center text-muted-foreground">💬</span>
                <span>{ctxMenu.segment.comment ? "Edit comment" : "Add comment"}</span>
              </button>
            </>
          )}
          {onAssignSession && (
            <>
              <div className="h-px bg-border my-1" />
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                Assign to project
              </div>
              <div className="max-h-[58vh] overflow-y-auto pr-1">
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  onClick={() => handleAssign(null)}
                >
                  <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
                  <span className="truncate">Unassigned</span>
                </button>
                {projects && projects.filter((p) => !p.frozen_at).length > 0 ? (
                  projects.filter((p) => !p.frozen_at).map((p) => (
                    <button
                      key={p.id}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                      onClick={() => handleAssign(p.id)}
                    >
                      <div
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    No projects available
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <Dialog
        open={clusterDetails !== null}
        onOpenChange={(open) => {
          if (!open) setClusterDetails(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          {clusterDetails && clusterDetailsSummary && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: clusterDetails.rowColor }}
                  />
                  <span className="truncate">Detale sesji</span>
                </DialogTitle>
              </DialogHeader>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">Project</p>
                  <p className="truncate text-sm font-medium" title={clusterDetails.rowName}>
                    {clusterDetails.rowName}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">Time range</p>
                  <p className="text-sm font-mono">
                    {fmtHourMinute(clusterDetails.segment.startMs)} - {fmtHourMinute(clusterDetails.segment.endMs)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    span {formatDuration(Math.round(clusterDetailsSummary.spanMs / 1000))}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">Sessions</p>
                  <p className="text-sm font-medium">{clusterDetailsSummary.sessionIds.length}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {clusterDetailsSummary.appNames.length} app{clusterDetailsSummary.appNames.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-[11px] text-muted-foreground">Activity</p>
                  <p className="text-sm font-mono">
                    {formatDuration(Math.round(clusterDetailsSummary.unionMs / 1000))}
                  </p>
                  {clusterDetailsSummary.overlapMs > 0 && (
                    <p className="text-[11px] text-amber-300">
                      overlap +{formatDuration(Math.round(clusterDetailsSummary.overlapMs / 1000))}
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">Apps in chunk:</span>
                  {clusterDetailsSummary.appNames.map((appName) => (
                    <Badge key={appName} variant="secondary" className="text-[10px]">
                      {appName}
                    </Badge>
                  ))}
                  {clusterDetailsSummary.boostedCount > 0 && (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300">
                      $$$ on {clusterDetailsSummary.boostedCount}/{clusterDetailsSummary.fragments.length}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">
                    Sessions inside merged chunk
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Sum durations: {formatDuration(Math.round(clusterDetailsSummary.sumMs / 1000))}
                  </p>
                </div>
                <div className="max-h-[50vh] space-y-1 overflow-y-auto rounded-md border p-2">
                  {clusterDetailsSummary.fragments.map((f, idx) => {
                    const durationSec = Math.max(0, Math.round((f.endMs - f.startMs) / 1000));
                    const multiplierValue = f.rateMultiplier ?? 1;
                    return (
                      <div
                        key={`${f.sessionId}-${idx}-${f.startMs}`}
                        className="flex items-center justify-between gap-3 rounded border border-border/60 px-2 py-1.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{f.appName}</span>
                            {(multiplierValue > 1.000_001) && (
                              <Badge variant="outline" className="h-4 text-[10px] border-emerald-500/40 text-emerald-300">
                                $$$ {formatMultiplierLabel(multiplierValue)}
                              </Badge>
                            )}
                          </div>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {fmtHourMinute(f.startMs)} - {fmtHourMinute(f.endMs)} · id {f.sessionId}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono">{formatDuration(durationSec)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Context menu for adding manual session on timeline */}
      {ctxMenu && ctxMenu.type === "timeline" && onAddManualSession && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
            onClick={handleAddSession}
          >
            {ctxMenu.editSession ? "Edit/Delete Session" : `Add Session (${fmtHourMinute(ctxMenu.timeMs)})`}
          </button>
        </div>
      )}
      <PromptModal
        open={promptConfig !== null}
        onOpenChange={(open) => !open && setPromptConfig(null)}
        title={promptConfig?.title ?? ""}
        description={promptConfig?.description}
        initialValue={promptConfig?.initialValue ?? ""}
        onConfirm={promptConfig?.onConfirm ?? (() => {})}
      />
    </Card>
  );
}
