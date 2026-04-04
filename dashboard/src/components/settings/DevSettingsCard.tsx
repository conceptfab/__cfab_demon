import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, FolderOpen, Trash2, RefreshCw, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { logManagementApi } from '@/lib/tauri/log-management';
import type { LogSettings, LogFileInfo } from '@/lib/tauri/log-management';

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'off'] as const;

const LOG_CHANNELS = [
  { key: 'daemon' as const, label: 'Daemon', settingsKey: 'daemon_level' as const },
  { key: 'lan_sync' as const, label: 'LAN Sync', settingsKey: 'lan_sync_level' as const },
  { key: 'online_sync' as const, label: 'Online Sync', settingsKey: 'online_sync_level' as const },
  { key: 'dashboard' as const, label: 'Dashboard', settingsKey: 'dashboard_level' as const },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DevSettingsCard() {
  const [settings, setSettings] = useState<LogSettings | null>(null);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [activeLog, setActiveLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef<number | null>(null);

  // Load settings and file info
  useEffect(() => {
    logManagementApi.getLogSettings().then(setSettings).catch(() => {});
    logManagementApi.getLogFilesInfo().then(setFiles).catch(() => {});
  }, []);

  // Poll active log content
  useEffect(() => {
    if (!activeLog) {
      setLogContent('');
      return;
    }
    const poll = () => {
      logManagementApi
        .readLogFile(activeLog, 200)
        .then((content) => {
          setLogContent(content);
          if (autoScroll && logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
          }
        })
        .catch(() => {});
    };
    poll();
    pollRef.current = window.setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeLog, autoScroll]);

  // Refresh file info periodically
  useEffect(() => {
    const timer = window.setInterval(() => {
      logManagementApi.getLogFilesInfo().then(setFiles).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleLevelChange = useCallback(
    (settingsKey: keyof LogSettings, value: string) => {
      setSettings((prev) => {
        if (!prev) return prev;
        const next = { ...prev, [settingsKey]: value };
        logManagementApi.saveLogSettings(next).catch(() => {});
        return next;
      });
    },
    [],
  );

  const handleMaxSizeChange = useCallback((kb: number) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = { ...prev, max_log_size_kb: kb };
      logManagementApi.saveLogSettings(next).catch(() => {});
      return next;
    });
  }, []);

  const handleClear = useCallback(
    (key: string) => {
      logManagementApi
        .clearLogFile(key)
        .then(() => {
          logManagementApi.getLogFilesInfo().then(setFiles).catch(() => {});
          if (activeLog === key) setLogContent('');
        })
        .catch(() => {});
    },
    [activeLog],
  );

  if (!settings) return null;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Terminal className="h-4 w-4 text-amber-400" />
          DEV — Log Management
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Centralized log viewer and configuration. All logs are stored in the{' '}
          <code className="text-xs bg-black/20 px-1 rounded">logs/</code> folder.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Log Levels */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Log Levels</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {LOG_CHANNELS.map((ch) => (
              <div
                key={ch.key}
                className="flex items-center justify-between rounded-md border border-border/70 bg-background/35 p-2.5"
              >
                <span className="text-sm">{ch.label}</span>
                <div className="relative">
                  <select
                    className="h-7 w-24 appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    value={settings[ch.settingsKey] || 'info'}
                    onChange={(e) => handleLevelChange(ch.settingsKey, e.target.value)}
                  >
                    {LOG_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Max log size */}
        <div className="flex items-center justify-between rounded-md border border-border/70 bg-background/35 p-2.5">
          <div>
            <p className="text-sm font-medium">Max log file size</p>
            <p className="text-xs text-muted-foreground">Per file, auto-rotated when exceeded</p>
          </div>
          <div className="relative">
            <select
              className="h-7 w-24 appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={settings.max_log_size_kb}
              onChange={(e) => handleMaxSizeChange(Number(e.target.value))}
            >
              <option value={256}>256 KB</option>
              <option value={512}>512 KB</option>
              <option value={1024}>1 MB</option>
              <option value={2048}>2 MB</option>
              <option value={5120}>5 MB</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Log Files */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Log Files</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => logManagementApi.openLogsFolder().catch(() => {})}
            >
              <FolderOpen className="h-3 w-3 mr-1" />
              Open Folder
            </Button>
          </div>
          <div className="grid gap-1.5">
            {files.map((file) => (
              <div
                key={file.key}
                className={`flex items-center justify-between rounded-md border p-2 cursor-pointer transition-colors ${
                  activeLog === file.key
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-border/50 bg-background/20 hover:bg-background/40'
                }`}
                onClick={() => setActiveLog(activeLog === file.key ? null : file.key)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      file.exists && file.size_bytes > 0
                        ? 'bg-emerald-400'
                        : 'bg-zinc-500'
                    }`}
                  />
                  <span className="text-sm font-mono truncate">{file.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {file.exists ? formatBytes(file.size_bytes) : 'empty'}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClear(file.key);
                    }}
                    title="Clear log"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Log Viewer */}
        {activeLog && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {files.find((f) => f.key === activeLog)?.name ?? activeLog}
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-input accent-primary"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto-scroll
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-muted-foreground"
                  onClick={() => {
                    logManagementApi
                      .readLogFile(activeLog, 200)
                      .then(setLogContent)
                      .catch(() => {});
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refresh
                </Button>
              </div>
            </div>
            <pre
              ref={logRef}
              className="max-h-72 overflow-auto rounded-md border border-border/50 bg-black/40 p-2.5 text-[10px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap select-all"
            >
              {logContent || '(empty)'}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
