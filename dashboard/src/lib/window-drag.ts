import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriRuntime } from "@/lib/tauri";

export function tryStartWindowDrag(): void {
  if (!hasTauriRuntime()) return;
  void getCurrentWindow()
    .startDragging()
    .catch((error) => {
      console.warn("Window dragging failed (permissions/capability?):", error);
    });
}
