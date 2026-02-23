import { useEffect, useState } from "react";
import { getDaemonStatus } from "@/lib/tauri";
import type { DaemonStatus } from "@/lib/db-types";

export function Help() {
  const [status, setStatus] = useState<DaemonStatus | null>(null);

  useEffect(() => {
    getDaemonStatus().then(setStatus).catch(console.error);
  }, []);

  return (
    <div className="flex h-full flex-col p-8">
      <div className="space-y-2">
        <h1 className="text-4xl font-light" style={{ letterSpacing: "0.35em" }}>TIMEFLOW</h1>
        <p className="text-sm font-mono text-muted-foreground tracking-widest">
          v{status?.dashboard_version || "?.?.?"}
        </p>
      </div>
    </div>
  );
}
