import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

export function TopBar() {
  const tauriRuntime = hasTauriRuntime();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!tauriRuntime) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    const syncMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!disposed) {
          setIsMaximized(maximized);
        }
      } catch {
        // Ignore runtime errors when not running inside Tauri.
      }
    };

    void syncMaximized();

    void appWindow
      .onResized(() => {
        void syncMaximized();
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenResize = unlisten;
      })
      .catch(() => {
        // Ignore listener registration errors outside Tauri.
      });

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, [tauriRuntime]);

  const withWindow = (action: (appWindow: ReturnType<typeof getCurrentWindow>) => Promise<void>) => {
    if (!tauriRuntime) return;
    void action(getCurrentWindow()).catch((error) => {
      console.warn("Window action failed (permissions/capability?):", action.name || "anonymous", error);
    });
  };

  const handleDragMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    withWindow((appWindow) => appWindow.startDragging());
  };

  const stopTitlebarButtonMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <header className="flex h-12 items-stretch border-b border-border/25 bg-background/95">
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 select-none items-center px-4 [app-region:drag] [-webkit-app-region:drag]"
        onDoubleClick={() => withWindow((appWindow) => appWindow.toggleMaximize())}
        onMouseDown={handleDragMouseDown}
      />
      {tauriRuntime && (
        <div className="flex items-stretch border-l border-border/25 [app-region:no-drag] [-webkit-app-region:no-drag]">
          <button
            type="button"
            aria-label="Minimize window"
            className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground [app-region:no-drag] [-webkit-app-region:no-drag]"
            onMouseDown={stopTitlebarButtonMouseDown}
            onClick={() => withWindow((appWindow) => appWindow.minimize())}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Restore window" : "Maximize window"}
            className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground [app-region:no-drag] [-webkit-app-region:no-drag]"
            onMouseDown={stopTitlebarButtonMouseDown}
            onClick={() => withWindow((appWindow) => appWindow.toggleMaximize())}
          >
            {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Close window"
            className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive [app-region:no-drag] [-webkit-app-region:no-drag]"
            onMouseDown={stopTitlebarButtonMouseDown}
            onClick={() => withWindow((appWindow) => appWindow.close())}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </header>
  );
}

function hasTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const win = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return Boolean(win.__TAURI__ || win.__TAURI_INTERNALS__);
}
