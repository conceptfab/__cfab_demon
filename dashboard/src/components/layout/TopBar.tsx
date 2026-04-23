import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { hasTauriRuntime } from "@/lib/tauri";
import { AppTooltip } from "@/components/ui/app-tooltip";
import { useTranslation } from "react-i18next";
import { tryStartWindowDrag } from "@/lib/window-drag";
import { isMacOS } from "@/lib/platform";

export function TopBar() {
  const { t } = useTranslation();
  const tauriRuntime = hasTauriRuntime();
  const onMac = isMacOS();
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
    tryStartWindowDrag();
  };

  const stopTitlebarButtonMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <header className="flex h-12 items-stretch border-b border-border/25 bg-background/95">
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 select-none items-center justify-end px-4 [app-region:drag] [-webkit-app-region:drag]"
        onDoubleClick={() => withWindow((appWindow) => appWindow.toggleMaximize())}
        onMouseDown={handleDragMouseDown}
      >
        {onMac && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            TIMEFLOW
          </span>
        )}
      </div>
      {tauriRuntime && !onMac && (
        <div className="flex items-stretch border-l border-border/25 [app-region:no-drag] [-webkit-app-region:no-drag]">
          <AppTooltip content={t("topbar.aria.minimize")} side="bottom">
            <button
              type="button"
              aria-label={t("topbar.aria.minimize")}
              className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground [app-region:no-drag] [-webkit-app-region:no-drag]"
              onMouseDown={stopTitlebarButtonMouseDown}
              onClick={() => withWindow((appWindow) => appWindow.minimize())}
            >
              <Minus className="h-4 w-4" />
            </button>
          </AppTooltip>
          <AppTooltip content={isMaximized ? t("topbar.aria.restore") : t("topbar.aria.maximize")} side="bottom">
            <button
              type="button"
              aria-label={isMaximized ? t("topbar.aria.restore") : t("topbar.aria.maximize")}
              className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground [app-region:no-drag] [-webkit-app-region:no-drag]"
              onMouseDown={stopTitlebarButtonMouseDown}
              onClick={() => withWindow((appWindow) => appWindow.toggleMaximize())}
            >
              {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
            </button>
          </AppTooltip>
          <AppTooltip content={t("topbar.aria.close")} side="bottom">
            <button
              type="button"
              aria-label={t("topbar.aria.close")}
              className="flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive [app-region:no-drag] [-webkit-app-region:no-drag]"
              onMouseDown={stopTitlebarButtonMouseDown}
              onClick={() => withWindow((appWindow) => appWindow.close())}
            >
              <X className="h-4 w-4" />
            </button>
          </AppTooltip>
        </div>
      )}
    </header>
  );
}
