import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  onAssignSession?: (sessionId: number, projectId: number | null) => void;
  onAddManualSession?: (startTime?: string) => void;
  onEditManualSession?: (session: ManualSessionWithProject) => void;
}

interface SegmentData {
  sessionId: number;
  startMs: number;
  endMs: number;
  appName: string;
  appId: number;
  rateMultiplier?: number;
  isManual?: boolean;
  manualTitle?: string;
  manualSession?: ManualSessionWithProject;
}

interface TimelineRow {
  name: string;
  color: string;
  totalSeconds: number;
  isUnassigned: boolean;
  segments: SegmentData[];
}

type CtxMenu =
  | { type: "assign"; x: number; y: number; segment: SegmentData }
  | { type: "timeline"; x: number; y: number; timeMs: number; editSession?: ManualSessionWithProject };

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
  onAddManualSession,
  onEditManualSession,
}: Props) {
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
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
    (e: React.MouseEvent, segment: SegmentData) => {
      if (!onAssignSession || !projects?.length) return;
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ type: "assign", x: e.clientX, y: e.clientY, segment });
    },
    [onAssignSession, projects]
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
    (projectId: number | null) => {
      if (!ctxMenu || ctxMenu.type !== "assign" || !onAssignSession) return;
      onAssignSession(ctxMenu.segment.sessionId, projectId);
      setCtxMenu(null);
    },
    [ctxMenu, onAssignSession]
  );

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
          segments: [],
        });
      }
      const row = byProject.get(key)!;
      row.totalSeconds += item.s.duration_seconds;
      row.segments.push({
        sessionId: item.s.id,
        startMs: item.startMs,
        endMs: item.endMs,
        appName: item.s.app_name,
        appId: item.s.app_id,
        rateMultiplier: item.s.rate_multiplier ?? 1,
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

    const rows = Array.from(byProject.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
    const ticks: number[] = [];
    for (let t = rangeStart; t <= rangeEnd; t += tickMs) {
      ticks.push(t);
    }

    const totalSeconds = rows.reduce((acc, row) => acc + row.totalSeconds, 0);
    return { rows, ticks, rangeStart, rangeSpan, totalSeconds, workingRange };
  }, [sessions, manualSessions, workingHours]);

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
                  className={`truncate text-xs ${row.isUnassigned ? "text-amber-300" : "text-muted-foreground"}`}
                  title={row.name}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: row.color }} />
                  {row.name}
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
                    return (
                      <div
                        key={`${row.name}-${idx}-${segment.startMs}`}
                        className={`absolute top-1 bottom-1 rounded-sm${onAssignSession ? " cursor-context-menu" : ""}`}
                        style={{
                          left: `${Math.max(0, Math.min(100, left))}%`,
                          width: `${Math.max(0.8, Math.min(100, width))}%`,
                          backgroundColor: row.color,
                          opacity: 0.9,
                        }}
                        title={`${segment.isManual ? `[Manual] ${segment.manualTitle}` : segment.appName}: ${fmtHourMinute(segment.startMs)} - ${fmtHourMinute(segment.endMs)}${(segment.rateMultiplier ?? 1) > 1.000001 ? ` • $$ ${Number.isInteger(segment.rateMultiplier ?? 1) ? `x${(segment.rateMultiplier ?? 1).toFixed(0)}` : `x${(segment.rateMultiplier ?? 1).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`}` : ""}`}
                        onContextMenu={
                          !segment.isManual
                            ? (e) => handleSegmentContextMenu(e, segment)
                            : segment.isManual
                              ? (e) => handleManualSegmentContextMenu(e, segment)
                              : undefined
                        }
                      >
                        {segment.isManual && (
                          <div className="absolute inset-0 rounded-sm" style={HATCH_STYLE} />
                        )}
                        {(segment.rateMultiplier ?? 1) > 1.000001 && (
                          <div className="pointer-events-none absolute right-0.5 top-0.5 rounded bg-black/35 px-1 py-[1px] text-[9px] font-semibold leading-none text-emerald-100 shadow-sm">
                            $$
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

      {/* Context menu for assigning one unassigned session to a project */}
      {ctxMenu && ctxMenu.type === "assign" && projects && projects.length > 0 && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Assign this session ({ctxMenu.segment.appName}) to project
          </div>
          <div className="h-px bg-border my-1" />
          <div className="max-h-[58vh] overflow-y-auto pr-1">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => handleAssign(null)}
            >
              <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
              <span className="truncate">Unassigned</span>
            </button>
            {projects.map((p) => (
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
            ))}
          </div>
        </div>
      )}

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
    </Card>
  );
}
