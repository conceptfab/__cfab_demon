import * as React from "react";
import { useEffect, useState, useMemo, useRef } from "react";
import {
    ChevronLeft,
    TimerReset,
    Snowflake,
    CircleOff,
    MessageSquare,
    RefreshCw,
    LayoutDashboard,
    History,
    MousePointerClick,
    CircleDollarSign,
    Trash2,
} from "lucide-react";
import { TimelineChart } from "@/components/dashboard/TimelineChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PromptModal } from "@/components/ui/prompt-modal";
import {
    getProjects,
    getProjectExtraInfo,
    compactProjectData,
    getProjectEstimates,
    resetProjectTime,
    freezeProject,
    unfreezeProject,
    excludeProject,
    getSessions,
    getManualSessions,
    getProjectTimeline,
    updateSessionComment,
    updateSessionRateMultiplier,
    assignSessionToProject,
    deleteSession,
} from "@/lib/tauri";
import { formatDuration, formatMoney, cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import type { ProjectWithStats, ProjectExtraInfo, SessionWithApp, ManualSessionWithProject, StackedBarData } from "@/lib/db-types";

interface ContextMenu {
    x: number;
    y: number;
    session: SessionWithApp;
}

interface PromptConfig {
    title: string;
    initialValue: string;
    onConfirm: (val: string) => void;
    description?: string;
}

export function ProjectPage() {
    const {
        projectPageId,
        setProjectPageId,
        setCurrentPage,
        refreshKey,
        triggerRefresh,
        currencyCode,
    } = useAppStore();

    const [project, setProject] = useState<ProjectWithStats | null>(null);
    const [projectsList, setProjectsList] = useState<ProjectWithStats[]>([]);
    const [extraInfo, setExtraInfo] = useState<ProjectExtraInfo | null>(null);
    const [timelineData, setTimelineData] = useState<StackedBarData[]>([]);
    const [recentSessions, setRecentSessions] = useState<SessionWithApp[]>([]);
    const [manualSessions, setManualSessions] = useState<ManualSessionWithProject[]>([]);
    const [estimate, setEstimate] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);

    const [ctxMenu, setCtxMenu] = useState<ContextMenu | null>(null);
    const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
    const ctxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (projectPageId === null) {
            setCurrentPage("projects");
            return;
        }

        setLoading(true);
        Promise.all([
            getProjects(),
            getProjectExtraInfo(projectPageId, { start: "2020-01-01", end: "2100-01-01" }),
            getProjectEstimates({ start: "2020-01-01", end: "2100-01-01" }),
            getProjectTimeline({ start: "2020-01-01", end: "2100-01-01" }, 100, "day", projectPageId).catch(() => [] as StackedBarData[]),
            getSessions({ projectId: projectPageId, limit: 50 }),
            getManualSessions({ projectId: projectPageId }),
        ])
            .then(([projects, info, estimates, timeline, sessions, manuals]) => {
                const p = projects.find((x) => x.id === projectPageId);
                if (p) {
                    setProject(p);
                    setProjectsList(projects);
                    setExtraInfo(info);
                    setTimelineData(timeline);
                    setRecentSessions(sessions);
                    setManualSessions(manuals);
                    const est = estimates.find((e) => e.project_id === projectPageId);
                    setEstimate(est?.estimated_value || 0);
                } else {
                    setCurrentPage("projects");
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [projectPageId, refreshKey, setCurrentPage]);

    // Handle click outside for context menu
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

    const filteredTimeline = useMemo(() => {
        if (!project) return timelineData;

        // Group comments by date from both recentSessions and manualSessions
        const commentsByDate = new Map<string, Set<string>>();
        recentSessions.forEach(s => {
            if (s.comment?.trim()) {
                const date = s.start_time.substring(0, 10);
                if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
                commentsByDate.get(date)!.add(s.comment.trim());
            }
        });
        manualSessions.forEach(s => {
            if (s.title?.trim()) {
                const date = s.start_time.substring(0, 10);
                if (!commentsByDate.has(date)) commentsByDate.set(date, new Set());
                commentsByDate.get(date)!.add(s.title.trim());
            }
        });

        return timelineData.map(row => {
            const comments = commentsByDate.get(row.date);
            return {
                date: row.date,
                [project.name]: row[project.name] || 0,
                comments: comments ? Array.from(comments) : undefined
            };
        });
    }, [timelineData, project, recentSessions, manualSessions]);

    const handleBack = () => {
        setProjectPageId(null);
        setCurrentPage("projects");
    };

    const handleCompact = async () => {
        if (!project || !window.confirm("Compact this project's data? This will remove detailed file activity history, but will keep sessions and total time. This operation cannot be undone.")) {
            return;
        }
        setBusy("compact");
        try {
            await compactProjectData(project.id);
            triggerRefresh();
        } catch (e) {
            console.error(e);
        } finally {
            setBusy(null);
        }
    };

    const handleAction = async (action: () => Promise<void>, confirmMsg?: string) => {
        if (confirmMsg && !window.confirm(confirmMsg)) return;
        try {
            await action();
            triggerRefresh();
        } catch (e) {
            console.error(e);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, session: SessionWithApp) => {
        e.preventDefault();
        setCtxMenu({ x: e.clientX, y: e.clientY, session });
    };

    const handleSetRateMultiplier = async (multiplier: number | null) => {
        if (!ctxMenu) return;
        try {
            await updateSessionRateMultiplier(ctxMenu.session.id, multiplier);
            triggerRefresh();
        } catch (err) {
            console.error(err);
        }
        setCtxMenu(null);
    };

    const handleEditComment = () => {
        if (!ctxMenu) return;
        const current = ctxMenu.session.comment ?? "";
        const sessionId = ctxMenu.session.id;

        setPromptConfig({
            title: "Session Comment",
            description: "Enter a comment for this session (leave empty to remove).",
            initialValue: current,
            onConfirm: async (raw) => {
                const trimmed = raw.trim();
                try {
                    await updateSessionComment(sessionId, trimmed || null);
                    triggerRefresh();
                } catch (err) {
                    console.error(err);
                }
            }
        });
        setCtxMenu(null);
    };

    const handleCustomRateMultiplier = () => {
        if (!ctxMenu) return;
        const current = typeof ctxMenu.session.rate_multiplier === "number" ? ctxMenu.session.rate_multiplier : 1;

        setPromptConfig({
            title: "Set rate multiplier",
            description: "Multiplier must be > 0. Use 1 to reset.",
            initialValue: String(current > 1 ? current : 2),
            onConfirm: async (raw) => {
                const parsed = Number(raw.trim().replace(",", "."));
                if (!Number.isFinite(parsed) || parsed <= 0) return;
                await handleSetRateMultiplier(parsed);
            }
        });
        setCtxMenu(null);
    };

    const handleAssign = async (projectId: number | null) => {
        if (!ctxMenu) return;
        try {
            await assignSessionToProject(ctxMenu.session.id, projectId, "manual_project_card_change");
            triggerRefresh();
        } catch (err) {
            console.error(err);
        }
        setCtxMenu(null);
    };

    if (loading && !project) {
        return (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
                Loading project details...
            </div>
        );
    }

    if (!project) return null;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={handleBack} className="h-8">
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Back to Projects
                </Button>
                <div className="h-4 w-[1px] bg-border" />
                <h1 className="text-xl font-semibold flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: project.color }} />
                    {project.name}
                </h1>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            Project Overview
                        </CardTitle>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAction(() => resetProjectTime(project.id), "Reset tracked time for this project? This cannot be undone.")}
                                title="Reset time"
                            >
                                <TimerReset className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(project.frozen_at && "text-blue-400 bg-blue-500/10")}
                                onClick={() => handleAction(() => project.frozen_at ? unfreezeProject(project.id) : freezeProject(project.id))}
                                title={project.frozen_at ? "Unfreeze project" : "Freeze project"}
                            >
                                <Snowflake className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive"
                                onClick={() => handleAction(() => excludeProject(project.id), "Exclude this project?")}
                                title="Exclude project"
                            >
                                <CircleOff className="h-4 w-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Total Time / Value</p>
                            <div className="flex items-baseline gap-4">
                                <p className="text-4xl font-[200] text-emerald-400">
                                    {formatDuration(project.total_seconds)}
                                </p>
                                <span className="text-2xl font-[100] opacity-30">/</span>
                                <p className="text-3xl font-[200] text-emerald-400/80">
                                    {formatMoney(estimate, currencyCode)}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Sessions</p>
                                <p className="text-2xl font-light">{extraInfo?.db_stats.session_count || 0}</p>
                            </div>
                            <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">File Edits</p>
                                <p className="text-2xl font-light">{extraInfo?.db_stats.file_activity_count || 0}</p>
                            </div>
                            <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Manual Sessions</p>
                                <p className="text-2xl font-light flex items-center gap-2">
                                    <MousePointerClick className="h-4 w-4 text-muted-foreground/50" />
                                    {extraInfo?.db_stats.manual_session_count || 0}
                                </p>
                            </div>
                            <div className="rounded-lg bg-secondary/20 p-4 border border-border/40">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1">Comments</p>
                                <p className="text-2xl font-light">{extraInfo?.db_stats.comment_count || 0}</p>
                            </div>
                        </div>

                        {project.assigned_folder_path && (
                            <div className="space-y-1">
                                <p className="text-[10px] text-muted-foreground uppercase font-bold">Assigned Folder</p>
                                <p className="text-sm font-mono bg-secondary/30 p-2 rounded truncate transition-colors hover:bg-secondary/50 cursor-default" title={project.assigned_folder_path}>
                                    {project.assigned_folder_path}
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            Top Applications
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {extraInfo?.top_apps.map((app, i) => (
                                <div key={i} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/20 transition-colors">
                                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: app.color || "#64748b" }} />
                                    <span className="text-sm truncate flex-1 font-medium">{app.name}</span>
                                    <span className="font-mono text-xs text-emerald-400 shrink-0">{formatDuration(app.seconds)}</span>
                                </div>
                            ))}
                            {(!extraInfo?.top_apps || extraInfo.top_apps.length === 0) && (
                                <p className="text-sm text-muted-foreground italic text-center py-4">No application data yet</p>
                            )}
                        </div>

                        <div className="mt-6 pt-6 border-t border-dashed border-border/60">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs text-muted-foreground uppercase font-bold">Data Management</span>
                                <Badge variant="outline" className="text-[10px] opacity-70">
                                    ~{((extraInfo?.db_stats.estimated_size_bytes || 0) / 1024).toFixed(1)} KB
                                </Badge>
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="w-full text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/20"
                                onClick={handleCompact}
                                disabled={!extraInfo || extraInfo.db_stats.file_activity_count === 0 || !!busy}
                            >
                                {busy === "compact" ? (
                                    <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <LayoutDashboard className="mr-2 h-3.5 w-3.5" />
                                )}
                                Compact Detailed Records
                            </Button>
                            <p className="text-[10px] text-muted-foreground mt-2 px-1 leading-tight">
                                Compaction removes detailed file-level history while preserving sessions and total time.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-6">
                <TimelineChart
                    title="Activity Over Time"
                    data={filteredTimeline}
                    projectColors={project ? { [project.name]: project.color } : {}}
                    granularity="day"
                    heightClassName="h-64"
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <MousePointerClick className="h-4 w-4 text-sky-400" />
                                Manual Sessions
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {manualSessions.map((ms) => (
                                    <div key={ms.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/20 border border-border/40">
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium">{ms.title}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                                {new Date(ms.start_time).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-mono text-emerald-400">{formatDuration(ms.duration_seconds)}</p>
                                            <p className="text-[10px] text-muted-foreground uppercase">Value Added</p>
                                        </div>
                                    </div>
                                ))}
                                {manualSessions.length === 0 && (
                                    <p className="text-sm text-muted-foreground italic text-center py-4">No manual sessions recorded</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <MessageSquare className="h-4 w-4 text-sky-500" />
                                Recent Comments
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {recentSessions.filter(s => s.comment).slice(0, 5).map((s) => (
                                    <div key={s.id} className="p-3 rounded-lg bg-secondary/20 border border-border/40 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-muted-foreground">{new Date(s.start_time).toLocaleDateString()}</span>
                                            <span className="text-[10px] font-mono text-emerald-400/70">{formatDuration(s.duration_seconds)}</span>
                                        </div>
                                        <p className="text-sm text-sky-100 italic">"{s.comment}"</p>
                                        <p className="text-[10px] text-muted-foreground text-right">— {s.app_name}</p>
                                    </div>
                                ))}
                                {recentSessions.filter(s => s.comment).length === 0 && (
                                    <p className="text-sm text-muted-foreground italic text-center py-4">No comments found</p>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <History className="h-4 w-4" />
                                Detailed Session List
                            </div>
                            <span className="text-xs font-normal lowercase text-muted-foreground">last 50 sessions (right-click to edit)</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto text-muted-foreground">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-secondary/30 text-[10px] uppercase tracking-wider font-bold">
                                    <tr>
                                        <th className="px-4 py-3">Date</th>
                                        <th className="px-4 py-3">Duration</th>
                                        <th className="px-4 py-3">Application</th>
                                        <th className="px-4 py-3">Details / Comment</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                    {recentSessions.map((s) => (
                                        <tr
                                            key={s.id}
                                            className="hover:bg-accent/10 transition-colors cursor-context-menu"
                                            onContextMenu={(e) => handleContextMenu(e, s)}
                                        >
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                {new Date(s.start_time).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-emerald-400">
                                                <div className="flex items-center gap-2">
                                                    {formatDuration(s.duration_seconds)}
                                                    {(s.rate_multiplier ?? 1) > 1.000_001 && (
                                                        <CircleDollarSign className="h-3 w-3 text-emerald-400" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.project_color || "#64748b" }} />
                                                    {s.app_name}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                {s.comment ? (
                                                    <div className="flex items-center gap-2 text-sky-200 italic truncate max-w-xs">
                                                        <MessageSquare className="h-3 w-3 shrink-0" />
                                                        {s.comment}
                                                    </div>
                                                ) : (
                                                    <span className="text-muted-foreground/30">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {recentSessions.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground italic">
                                                No sessions found for this project.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {ctxMenu && (
                <div
                    ref={ctxRef}
                    className="fixed z-50 min-w-[240px] max-h-[70vh] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
                    style={{ left: ctxMenu.x, top: ctxMenu.y }}
                >
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground border-b border-border/30 mb-1">
                        Session ({ctxMenu.session.app_name})
                    </div>
                    <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                        onClick={handleEditComment}
                    >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>{ctxMenu.session.comment ? "Edit Comment" : "Add Comment"}</span>
                    </button>

                    <div className="h-px bg-border my-1" />
                    <div className="px-2 py-1 text-[11px] text-muted-foreground">Rate Multiplier</div>
                    <div className="flex gap-1 px-1">
                        <button
                            className="flex-1 rounded border border-emerald-500/20 bg-emerald-500/10 py-1.5 text-[11px] font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20 cursor-pointer"
                            onClick={() => handleSetRateMultiplier(2)}
                        >Boost x2</button>
                        <button
                            className="flex-1 rounded border border-border bg-secondary/30 py-1.5 text-[11px] font-medium transition-colors hover:bg-secondary/60 cursor-pointer"
                            onClick={handleCustomRateMultiplier}
                        >Custom...</button>
                    </div>

                    <div className="h-px bg-border my-1" />
                    <div className="px-2 py-1 text-[11px] text-muted-foreground">Assign to project</div>
                    <div className="max-h-[40vh] overflow-y-auto pr-1">
                        {projectsList.map(p => (
                            <button
                                key={p.id}
                                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                                onClick={() => handleAssign(p.id)}
                            >
                                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                                <span className="truncate">{p.name}</span>
                                {p.id === project?.id && <Badge variant="secondary" className="ml-auto text-[8px] h-3 px-1">current</Badge>}
                            </button>
                        ))}
                        <button
                            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer"
                            onClick={() => handleAssign(null)}
                        >
                            <div className="h-2 w-2 rounded-full bg-muted-foreground" />
                            <span>Unassigned</span>
                        </button>
                    </div>

                    <div className="h-px bg-border my-1" />
                    <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-destructive/10 text-destructive cursor-pointer"
                        onClick={async () => {
                            if (window.confirm("Delete this session?")) {
                                await deleteSession(ctxMenu.session.id);
                                triggerRefresh();
                                setCtxMenu(null);
                            }
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete Session</span>
                    </button>
                </div>
            )}

            <PromptModal
                open={promptConfig !== null}
                onOpenChange={(open) => !open && setPromptConfig(null)}
                title={promptConfig?.title ?? ""}
                description={promptConfig?.description}
                initialValue={promptConfig?.initialValue ?? ""}
                onConfirm={promptConfig?.onConfirm ?? (() => { })}
                confirmLabel="Save"
            />
        </div>
    );
}
