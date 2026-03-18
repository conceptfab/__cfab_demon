import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Toast {
  id: number;
  message: string;
  type: "error" | "info";
}

interface ToastContextValue {
  showError: (message: string) => void;
  showInfo: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showError: () => {},
  showInfo: () => {},
});

export function useToast() {
  return useContext(ToastContext);
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
    return () => {
      Object.values(timersRef.current).forEach((timer) => window.clearTimeout(timer));
      timersRef.current = {};
    };
  }, []);

  const addToast = useCallback((message: string, type: "error" | "info") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    timersRef.current[id] = window.setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  const showError = useCallback((msg: string) => addToast(msg, "error"), [addToast]);
  const showInfo = useCallback((msg: string) => addToast(msg, "info"), [addToast]);

  return (
    <ToastContext.Provider value={{ showError, showInfo }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
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
            <button
              type="button"
              className="w-full text-left"
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
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
