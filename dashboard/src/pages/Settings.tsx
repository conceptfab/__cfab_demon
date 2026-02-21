import { useMemo, useState } from "react";
import { TimerReset } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clearAllData, rebuildSessions } from "@/lib/tauri";
import { useAppStore } from "@/store/app-store";
import {
  loadWorkingHoursSettings,
  normalizeHexColor,
  saveWorkingHoursSettings,
  timeToMinutes,
  type WorkingHoursSettings,
  loadSessionSettings,
  saveSessionSettings,
  type SessionSettings,
} from "@/lib/user-settings";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function splitTime(value: string): [string, string] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return ["09", "00"];
  return [match[1], match[2]];
}

export function Settings() {
  const triggerRefresh = useAppStore((s) => s.triggerRefresh);
  const [clearing, setClearing] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [workingHours, setWorkingHours] = useState<WorkingHoursSettings>(() =>
    loadWorkingHoursSettings()
  );
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>(() => loadSessionSettings());
  const [workingHoursError, setWorkingHoursError] = useState<string | null>(null);
  const [savedSettings, setSavedSettings] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const labelClassName = "text-sm font-medium text-muted-foreground";
  const compactSelectClassName =
    "h-8 w-[3.75rem] rounded-md border border-input bg-background px-1.5 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  const sliderValue = Math.min(30, Math.max(0, sessionSettings.gapFillMinutes));

  const [startHour, startMinute] = useMemo(() => splitTime(workingHours.start), [workingHours.start]);
  const [endHour, endMinute] = useMemo(() => splitTime(workingHours.end), [workingHours.end]);
  const normalizedColor = normalizeHexColor(workingHours.color);

  const updateTimePart = (field: "start" | "end", part: "hour" | "minute", value: string) => {
    setWorkingHours((prev) => {
      const [hour, minute] = splitTime(prev[field]);
      const nextHour = part === "hour" ? value : hour;
      const nextMinute = part === "minute" ? value : minute;
      return { ...prev, [field]: `${nextHour}:${nextMinute}` };
    });
    setWorkingHoursError(null);
    setSavedSettings(false);
  };

  const handleSaveSettings = () => {
    const startMinutes = timeToMinutes(workingHours.start);
    const endMinutes = timeToMinutes(workingHours.end);

    if (startMinutes === null || endMinutes === null) {
      setWorkingHoursError("Please use a valid HH:mm time.");
      setSavedSettings(false);
      return;
    }
    if (endMinutes <= startMinutes) {
      setWorkingHoursError("'To' time must be later than 'From' time.");
      setSavedSettings(false);
      return;
    }

    const savedWorking = saveWorkingHoursSettings({
      ...workingHours,
      color: normalizedColor,
    });
    const savedSession = saveSessionSettings(sessionSettings);

    setWorkingHours(savedWorking);
    setSessionSettings(savedSession);
    setWorkingHoursError(null);
    setSavedSettings(true);
    triggerRefresh();
  };

  const handleRebuildSessions = async () => {
    setRebuilding(true);
    try {
      const merged = await rebuildSessions(sessionSettings.gapFillMinutes);
      alert(`Pomyślnie połączono ${merged} bliskich sesji.`);
      triggerRefresh();
    } catch (e) {
      console.error(e);
      alert("Error linking sessions: " + String(e));
    } finally {
      setRebuilding(false);
    }
  };

  const handleClearData = async () => {
    if (!confirm("Are you sure you want to delete all data? This cannot be undone.")) return;
    setClearing(true);
    try {
      await clearAllData();
      triggerRefresh();
      setClearArmed(false);
      alert("All data removed.");
    } catch (e) {
      console.error(e);
      alert("Failed to clear data: " + String(e));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">Working Hours</CardTitle>
          <p className="text-sm text-muted-foreground">Used to highlight expected work window on timeline.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>From</label>
              <div className="flex items-center gap-1.5">
                <select
                  className={compactSelectClassName}
                  value={startHour}
                  onChange={(e) => updateTimePart("start", "hour", e.target.value)}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  className={compactSelectClassName}
                  value={startMinute}
                  onChange={(e) => updateTimePart("start", "minute", e.target.value)}
                >
                  {MINUTES.map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>

              <label className={labelClassName}>To</label>
              <div className="flex items-center gap-1.5">
                <select
                  className={compactSelectClassName}
                  value={endHour}
                  onChange={(e) => updateTimePart("end", "hour", e.target.value)}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">:</span>
                <select
                  className={compactSelectClassName}
                  value={endMinute}
                  onChange={(e) => updateTimePart("end", "minute", e.target.value)}
                >
                  {MINUTES.map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>Highlight Color</label>
              <div className="flex items-center gap-2.5">
                <input
                  type="color"
                  className="h-8 w-10 cursor-pointer rounded border border-input bg-background p-1"
                  value={normalizedColor}
                  onChange={(e) => {
                    setWorkingHours((prev) => ({ ...prev, color: e.target.value }));
                    setWorkingHoursError(null);
                    setSavedSettings(false);
                  }}
                />
                <span className="font-mono text-sm text-muted-foreground">{normalizedColor}</span>
              </div>
            </div>
          </div>

          {workingHoursError && <p className="text-sm text-destructive">{workingHoursError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold">Session Management</CardTitle>
          <p className="text-sm text-muted-foreground">Rules for automatic merging of nearby sessions.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/70 bg-background/35 p-3">
            <div className="grid items-center gap-3 sm:grid-cols-[7.5rem_1fr]">
              <label className={labelClassName}>Merge Gap</label>
              <div className="w-full space-y-1.5">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="30"
                    step="1"
                    aria-label="Merge gap in minutes"
                    className="h-2 w-full cursor-pointer accent-primary"
                    value={sliderValue}
                    onChange={(e) => {
                      const val = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(val)) {
                        setSessionSettings((prev) => ({ ...prev, gapFillMinutes: val }));
                        setSavedSettings(false);
                      }
                    }}
                  />
                  <span className="min-w-[4.75rem] whitespace-nowrap text-right font-mono text-sm text-foreground">
                    {sliderValue} min
                  </span>
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>0 min</span>
                  <span>30 min</span>
                </div>
              </div>
            </div>
          </div>

          <label
            htmlFor="rebuildOnStartup"
            className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">Auto-rebuild on startup</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                Automatically merge close sessions when app starts.
              </p>
            </div>
            <input
              id="rebuildOnStartup"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={sessionSettings.rebuildOnStartup}
              onChange={(e) => {
                setSessionSettings((prev) => ({ ...prev, rebuildOnStartup: e.target.checked }));
                setSavedSettings(false);
              }}
            />
          </label>

          <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium">Rebuild Existing Sessions</p>
              <p className="text-xs leading-5 break-words text-muted-foreground">
                Apply current merge gap to already imported sessions.
              </p>
            </div>
            <Button variant="outline" className="h-8 w-fit" onClick={handleRebuildSessions} disabled={rebuilding}>
              <TimerReset className="mr-2 h-4 w-4" />
              {rebuilding ? "Rebuilding..." : "Rebuild"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-destructive">Danger Zone</CardTitle>
          <p className="text-sm text-muted-foreground">Hidden by default to avoid accidental clicks.</p>
        </CardHeader>
        <CardContent>
          <details className="group rounded-md border border-destructive/50 bg-destructive/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
              <span className="text-sm font-medium">Data wipe controls</span>
              <span className="text-xs text-muted-foreground group-open:hidden">Open</span>
              <span className="hidden text-xs text-muted-foreground group-open:inline">Close</span>
            </summary>

            <div className="space-y-3 border-t border-destructive/40 p-3">
              <p className="text-xs leading-5 break-words text-muted-foreground">
                Deletes all imported sessions and history from local database.
              </p>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-destructive"
                  checked={clearArmed}
                  onChange={(e) => setClearArmed(e.target.checked)}
                />
                Enable clear action
              </label>

              <Button
                variant="destructive"
                className="h-8"
                onClick={handleClearData}
                disabled={clearing || !clearArmed}
              >
                {clearing ? "Clearing..." : "Clear Data"}
              </Button>
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-emerald-400">{savedSettings ? "Settings saved." : ""}</div>
        <Button className="h-9 min-w-[10rem]" onClick={handleSaveSettings}>
          Save Settings
        </Button>
      </div>
    </div>
  );
}
