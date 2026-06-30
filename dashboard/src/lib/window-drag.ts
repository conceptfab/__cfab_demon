import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@/lib/tauri";
import { logger } from '@/lib/logger';

export function tryStartWindowDrag(): void {
  if (!hasTauriRuntime()) return;
  void getCurrentWindow()
    .startDragging()
    .catch((error) => {
      logger.warn("Window dragging failed (permissions/capability?):", error);
    });
}
