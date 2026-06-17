import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { hasTauriRuntime } from '@/lib/tauri/core';
import { getWebToken, pairWithCode } from '@/lib/webui/http-transport';

function isLocalDevelopmentHost(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false;
  }
  return window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
}

export function WebLoginGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [authed] = useState(
    () => hasTauriRuntime() || isLocalDevelopmentHost() || !!getWebToken(),
  );
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (authed) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await pairWithCode(code.trim());
      // Reload so the app boots fresh with the token: data loads and i18n adopts
      // the shared backend language (get_persisted_language) — 1:1 with desktop.
      window.location.reload();
    } catch {
      setError(t('webserver.login.invalid_code'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border/50 p-6">
        <h1 className="text-lg font-semibold text-foreground">
          {t('webserver.login.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('webserver.login.hint')}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          aria-label={t('webserver.login.code_label')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-center font-mono text-2xl tracking-widest"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button className="w-full" disabled={busy || code.length < 6} onClick={() => void submit()}>
          {t('webserver.login.submit')}
        </Button>
      </div>
    </div>
  );
}
