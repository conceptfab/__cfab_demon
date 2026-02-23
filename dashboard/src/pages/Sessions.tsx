import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Trash2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSessions, getProjects, assignSessionToProject, deleteSession, updateSessionRateMultiplier } from "@/lib/tauri";
import { formatDuration } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { addDays, format, parseISO, subDays } from "date-fns";
import type { DateRange, SessionWithApp, ProjectWithStats } from "@/lib/db-types";

interface ContextMenu {
  x: number;
  y: number;
  session: SessionWithApp;
}
type RangeMode = "daily" | "weekly";

function formatMultiplierLabel(multiplier?: number): string {
  const value = typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Number.isInteger(value) ? `x${value.toFixed(0)}` : `x${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function Sessions() {
  const { refreshKey, triggerRefresh, sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject } = useAppStore();
  const [rangeMode, setRangeMode] = useState<RangeMode>("daily");
  const [anchorDate, setAnchorDate] = useState<string>(
    () => sessionsFocusDate ?? format(new Date(), "yyyy-MM-dd")
  );
  const [activeProjectId, setActiveProjectId] = useState<number | "unassigned" | null>(sessionsFocusProject);
  const [sessions, setSessions] = useState<SessionWithApp[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [projects, setProjects] = useState<ProjectWithStats[]>([]);
  const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
  const [viewMode, setViewMode] = useState<"detailed" | "compact">("detailed");
  const ctxRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 100;
  const today = format(new Date(), "yyyy-MM-dd");
  const canShiftForward = anchorDate < today;
  const shiftStepDays = rangeMode === "weekly" ? 7 : 1;

  const activeDateRange = useMemo<DateRange>(() => {
    const selectedDay = anchorDate || today;
    const selectedDateObj = parseISO(selectedDay);

    switch (rangeMode) {
      case "daily":
        return { start: selectedDay, end: selectedDay };
      case "weekly":
        return { start: format(subDays(selectedDateObj, 6), "yyyy-MM-dd"), end: selectedDay };
    }
  }, [rangeMode, anchorDate, today]);

  const shiftDateRange = (direction: -1 | 1) => {
    const current = parseISO(anchorDate);
    const next = format(addDays(current, direction * shiftStepDays), "yyyy-MM-dd");
    if (next > today) return;
    setAnchorDate(next);
  };

  useEffect(() => {
    if (!sessionsFocusDate && sessionsFocusProject === null) return;
    if (sessionsFocusDate) {
      setRangeMode("daily");
      setAnchorDate(sessionsFocusDate);
      clearSessionsFocusDate();
    }
    if (sessionsFocusProject !== null) {
      setActiveProjectId(sessionsFocusProject);
      setSessionsFocusProject(null);
    }
  }, [sessionsFocusDate, clearSessionsFocusDate, sessionsFocusProject, setSessionsFocusProject]);

  useEffect(() => {
    getSessions({ 
      dateRange: activeDateRange, 
      limit: PAGE_SIZE, 
      offset: 0,
      projectId: activeProjectId === "unassigned" ? undefined : (activeProjectId ?? undefined),
      unassigned: activeProjectId === "unassigned" ? true : undefined
    })
      .then((data) => {
        setSessions(data);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  }, [activeDateRange, refreshKey, activeProjectId]);

  useEffect(() => {
    setDismissedSuggestions(new Set());
  }, [activeDateRange.start, activeDateRange.end]);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, [refreshKey]);

  // Close context menu on click outside or Escape
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


  const handleContextMenu = useCallback(
    (e: React.MouseEvent, session: SessionWithApp) => {
      e.preventDefault();
      setCtxMenu({ x: e.clientX, y: e.clientY, session });
    },
    []
  );

  const handleAssign = useCallback(
    async (projectId: number | null, source?: string) => {
      if (!ctxMenu) return;
      try {
        await assignSessionToProject(ctxMenu.session.id, projectId, source);
        triggerRefresh();
      } catch (err) {
        console.error("Failed to assign session to project:", err);
      }
      setCtxMenu(null);
    },
    [ctxMenu, triggerRefresh]
  );

  const handleSetRateMultiplier = useCallback(
    async (multiplier: number | null) => {
      if (!ctxMenu) return;
      try {
        await updateSessionRateMultiplier(ctxMenu.session.id, multiplier);
        triggerRefresh();
      } catch (err) {
        console.error("Failed to update session rate multiplier:", err);
        window.alert(`Failed to update session rate multiplier: ${String(err)}`);
      }
      setCtxMenu(null);
    },
    [ctxMenu, triggerRefresh]
  );

  const handleCustomRateMultiplier = useCallback(async () => {
    if (!ctxMenu) return;
    const current = typeof ctxMenu.session.rate_multiplier === "number" ? ctxMenu.session.rate_multiplier : 1;
    const suggested = current > 1 ? current : 2;
    const raw = window.prompt(
      "Set session rate multiplier (> 0). Use 1 to reset:",
      String(suggested)
    );
    if (raw == null) return;
    const normalizedRaw = raw.trim().replace(",", ".");
    const parsed = Number(normalizedRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      window.alert("Multiplier must be a positive number.");
      return;
    }
    await handleSetRateMultiplier(parsed);
  }, [ctxMenu, handleSetRateMultiplier]);

  const handleAcceptSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessionToProject(
          session.id,
          session.suggested_project_id ?? null,
          "ai_suggestion_accept"
        );
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
        triggerRefresh();
      } catch (err) {
        console.error("Failed to accept AI suggestion:", err);
      }
    },
    [triggerRefresh]
  );

  const handleRejectSuggestion = useCallback(
    async (session: SessionWithApp, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await assignSessionToProject(session.id, null, "ai_suggestion_reject");
        setDismissedSuggestions((prev) => {
          const next = new Set(prev);
          next.add(session.id);
          return next;
        });
        setSessions((prev) =>
          prev.map((item) =>
            item.id === session.id
              ? {
                  ...item,
                  suggested_project_id: undefined,
                  suggested_project_name: undefined,
                  suggested_confidence: undefined,
                }
              : item
          )
        );
        triggerRefresh();
      } catch (err) {
        console.error("Failed to reject AI suggestion:", err);
      }
    },
    [triggerRefresh]
  );

  const loadMore = () => {
    getSessions({ 
      dateRange: activeDateRange, 
      limit: PAGE_SIZE, 
      offset: sessions.length,
      projectId: activeProjectId === "unassigned" ? undefined : (activeProjectId ?? undefined),
      unassigned: activeProjectId === "unassigned" ? true : undefined
    })
      .then((data) => {
        setSessions((prev) => [...prev, ...data]);
        setHasMore(data.length >= PAGE_SIZE);
      })
      .catch(console.error);
  };

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatTime = (t: string) => {
    try { return format(parseISO(t), "HH:mm"); } catch { return t; }
  };
  const formatDate = (t: string) => {
    try { return format(parseISO(t), "MMM d, yyyy"); } catch { return t; }
  };

  const groupedByProject = useMemo(() => {
    const groups = new Map<
      string,
      { projectName: string; projectColor: string; totalSeconds: number; sessions: SessionWithApp[] }
    >();
    for (const session of sessions) {
      const projectName = session.project_name ?? "Unassigned";
      const projectColor = session.project_color ?? "#64748b";
      const key = projectName.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { projectName, projectColor, totalSeconds: 0, sessions: [] });
      }
      const group = groups.get(key)!;
      group.totalSeconds += session.duration_seconds;
      group.sessions.push(session);
    }
    return Array.from(groups.values()).sort((a, b) => {
      const aUnassigned = a.projectName.toLowerCase() === "unassigned";
      const bUnassigned = b.projectName.toLowerCase() === "unassigned";
      if (aUnassigned !== bUnassigned) return aUnassigned ? -1 : 1;
      return b.totalSeconds - a.totalSeconds;
    });
  }, [sessions]);
  const unassignedGroup = groupedByProject.find((g) => g.projectName.toLowerCase() === "unassigned");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {sessions.length} sessions in {groupedByProject.length} projects
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={rangeMode === "daily" ? "default" : "ghost"}
            size="sm"
            onClick={() => setRangeMode("daily")}
          >
            Today
          </Button>
          <Button
            variant={rangeMode === "weekly" ? "default" : "ghost"}
            size="sm"
            onClick={() => setRangeMode("weekly")}
          >
            Week
          </Button>
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
          <span className="text-xs text-muted-foreground min-w-[5rem] text-center">
            {activeDateRange.start === activeDateRange.end
              ? format(parseISO(activeDateRange.start), "MMM d")
              : `${format(parseISO(activeDateRange.start), "MMM d")} – ${format(parseISO(activeDateRange.end), "MMM d")}`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => shiftDateRange(1)}
            disabled={!canShiftForward}
            title="Next period"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <div className="flex bg-secondary/50 p-1 rounded-md text-sm">
            <button
              onClick={() => setViewMode("detailed")}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === "detailed" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Detailed
            </button>
            <button
              onClick={() => setViewMode("compact")}
              className={`px-3 py-1 rounded-sm transition-colors ${viewMode === "compact" ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              Compact
            </button>
          </div>
        </div>
          {activeProjectId !== null && (
            <div className="mx-1 h-5 w-px bg-border flex items-center gap-2" />
          )}
          {activeProjectId !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveProjectId(null)}
              className="text-xs text-muted-foreground"
            >
              Clear filter
            </Button>
          )}
      </div>

      {unassignedGroup && viewMode === "detailed" && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-3 text-sm text-amber-100">
            <span className="font-semibold">*</span> {unassignedGroup.sessions.length} sessions are unassigned. Right-click
            any session card to assign or unassign it.
          </CardContent>
        </Card>
      )}

      {viewMode === "compact" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {groupedByProject.map((group) => (
            <div key={group.projectName} className="flex items-center gap-3 p-3 bg-card border rounded-md shadow-sm">
              <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: group.projectColor }} />
              <span className="font-medium truncate text-sm" title={group.projectName}>{group.projectName}</span>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="col-span-full py-12 text-center text-muted-foreground">
              No sessions found.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {groupedByProject.map((group) => (
            <Card key={group.projectName}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: group.projectColor }} />
                    <span className="font-medium truncate">{group.projectName}</span>
                    <Badge variant="secondary" className="text-xs">
                      {group.sessions.length} sessions
                    </Badge>
                  </div>
                  <span className="font-mono text-sm">{formatDuration(group.totalSeconds)}</span>
                </div>

                <div className="space-y-2">
                  {group.sessions.map((s) => (
                    <div
                      key={s.id}
                      className="rounded border border-border/60 p-3 cursor-context-menu"
                      onContextMenu={(e) => handleContextMenu(e, s)}
                    >
                      <div className="flex items-center gap-3">
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggle(s.id)}>
                          {expanded.has(s.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{s.app_name}</span>
                            {(s.rate_multiplier ?? 1) > 1.000_001 && (
                              <Badge variant="outline" className="text-[10px] h-5 border-emerald-500/40 text-emerald-300">
                                $$$ {formatMultiplierLabel(s.rate_multiplier)}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(s.start_time)} &middot; {formatTime(s.start_time)} – {formatTime(s.end_time)}
                          </p>
                        </div>
                        <span className="font-mono text-sm">{formatDuration(s.duration_seconds)}</span>
                        {s.project_name === null && (
                          <div className="flex items-center gap-1 shrink-0">
                            {s.suggested_project_id !== undefined &&
                            s.suggested_project_name &&
                            !dismissedSuggestions.has(s.id) ? (
                              <div className="flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1">
                                <span
                                  className="flex items-center gap-1 text-[11px] text-sky-200"
                                  title={`AI suggests ${s.suggested_project_name} (${((s.suggested_confidence ?? 0) * 100).toFixed(0)}%)`}
                                >
                                  <Sparkles className="h-3 w-3" />
                                  AI: {s.suggested_project_name} ({((s.suggested_confidence ?? 0) * 100).toFixed(0)}%)
                                </span>
                                <Button
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={(e) => void handleAcceptSuggestion(s, e)}
                                >
                                  Accept
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  onClick={(e) => void handleRejectSuggestion(s, e)}
                                >
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 rounded-md border border-muted bg-muted/20 px-2 py-1">
                                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50" title="The AI model is not confident enough yet. Assign the session manually to train it!">
                                  <Sparkles className="h-3 w-3 opacity-50" />
                                  AI: No sample
                                </span>
                              </div>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:bg-destructive/20"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  await deleteSession(s.id);
                                  triggerRefresh();
                                } catch (err) {
                                  console.error("Failed to delete session:", err);
                                }
                              }}
                              title="Delete session"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>

                      {expanded.has(s.id) && s.files.length > 0 && (
                        <div className="mt-3 ml-9 space-y-1">
                          <p className="text-[11px] text-muted-foreground">
                            Daily app files (aggregated for app + date)
                          </p>
                          {s.files.map((f, i) => (
                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="truncate">{f.file_name}</span>
                              <span className="font-mono">{formatDuration(f.total_seconds)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {sessions.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              No sessions found. Import some data first.
            </div>
          )}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" onClick={loadMore}>
              Load more
            </Button>
          </div>
        )}
      </div>
      )}

      {/* Context menu for assigning session to a project */}
      {ctxMenu && (
        <div
          ref={ctxRef}
          className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Session actions ({ctxMenu.session.app_name})
          </div>
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            Rate multiplier (default x2): <span className="font-mono">{formatMultiplierLabel(ctxMenu.session.rate_multiplier)}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 px-1 pb-1">
            <button
              className="rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => void handleSetRateMultiplier(2)}
            >
              x2
            </button>
            <button
              className="rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => void handleCustomRateMultiplier()}
            >
              Custom...
            </button>
          </div>
          <div className="h-px bg-border my-1" />
          <div className="px-2 py-1 text-[11px] text-muted-foreground">
            Assign to project
          </div>
          <div className="max-h-[58vh] overflow-y-auto pr-1">
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
              onClick={() => handleAssign(null, "manual_session_unassign")}
            >
              <div className="h-2.5 w-2.5 rounded-full shrink-0 bg-muted-foreground/60" />
              <span className="truncate">Unassigned</span>
            </button>
            {projects.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No projects available
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                  onClick={() => handleAssign(p.id, "manual_session_change")}
                >
                  <div
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
