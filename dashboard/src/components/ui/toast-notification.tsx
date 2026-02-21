import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

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
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: "error" | "info") => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const showError = useCallback((msg: string) => addToast(msg, "error"), [addToast]);
  const showInfo = useCallback((msg: string) => addToast(msg, "info"), [addToast]);

  return (
    <ToastContext.Provider value={{ showError, showInfo }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 text-sm shadow-lg animate-in slide-in-from-right ${
              t.type === "error"
                ? "bg-red-900/90 text-red-100 border border-red-700"
                : "bg-slate-800/90 text-slate-100 border border-slate-600"
            }`}
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
