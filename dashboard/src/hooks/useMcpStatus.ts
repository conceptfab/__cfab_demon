import { useEffect, useState } from 'react';

import { isDocumentVisible } from '@/components/sync/job-pool-helpers';
import { mcpApi, type McpStatus } from '@/lib/tauri';

const POLL_MS = 15_000;

export function useMcpStatus(): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      // Status widać tylko w sidebarze — przy ukrytym oknie nie odpytuj.
      if (!isDocumentVisible()) return;
      mcpApi
        .status()
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => {
          /* keep last known status */
        });
    };
    const onVisibilityChange = () => tick();
    tick();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return status;
}
