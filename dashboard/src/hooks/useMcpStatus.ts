import { useEffect, useState } from 'react';

import { mcpApi, type McpStatus } from '@/lib/tauri';

const POLL_MS = 15_000;

export function useMcpStatus(): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      mcpApi
        .status()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          /* keep last known status */
        });
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return status;
}
