import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Akcja w toaście (np. „Cofnij"). Kliknięcie zamyka toast po wywołaniu. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Nadpisuje domyślne 5 s — akcja „Cofnij" potrzebuje dłuższego okna. */
  durationMs?: number;
}

interface Toast {
  id: number;
  message: string;
  type: "error" | "info";
  action?: ToastAction;
}

interface ToastContextValue {
  showError: (message: string) => void;
  showInfo: (message: string, options?: ToastOptions) => void;
}

const DEFAULT_TOAST_MS = 5000;

const ToastContext = createContext<ToastContextValue>({
  showError: () => {},
  showInfo: () => {},
});

export function useToast() {
  return use(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t: tr } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof window.setTimeout>>>({});

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  useEffect(() => {
    const timers = timersRef;
    return () => {
      Object.values(timers.current).forEach((timer) => window.clearTimeout(timer));
      timers.current = {};
    };
  }, []);

  const addToast = useCallback(
    (message: string, type: "error" | "info", options?: ToastOptions) => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, type, action: options?.action }]);
      timersRef.current[id] = window.setTimeout(
        () => dismissToast(id),
        options?.durationMs ?? DEFAULT_TOAST_MS,
      );
    },
    [dismissToast],
  );

  const showError = useCallback((msg: string) => addToast(msg, "error"), [addToast]);
  const showInfo = useCallback(
    (msg: string, options?: ToastOptions) => addToast(msg, "info", options),
    [addToast],
  );
  const value = useMemo(() => ({ showError, showInfo }), [showError, showInfo]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[10001] flex max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            className={`rounded-lg px-4 py-3 text-sm shadow-lg animate-in slide-in-from-right ${
              toast.type === "error"
                ? "bg-red-900/90 text-red-100 border border-red-700"
                : "bg-slate-800/90 text-slate-100 border border-slate-600"
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => dismissToast(toast.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    dismissToast(toast.id);
                  }
                }}
                aria-label={tr("ui.a11y.dismiss_notification")}
              >
                {toast.message}
              </button>
              {toast.action && (
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-current/40 px-2 py-1 text-xs font-medium uppercase tracking-wide transition-colors hover:bg-white/10"
                  onClick={() => {
                    toast.action?.onAction();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
