import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { AlertTriangle, Link, Loader2, ShieldAlert, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { webServerApi } from '@/lib/tauri/webserver';
import { cn, logTauriError } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_WEB_PORT,
  initialWebServerCardState,
  PAIRING_CODE_TTL_SECS,
  webServerCardReducer,
} from '@/components/settings/web-server-card-state';

interface WebServerCardProps {
  myIp: string | null;
  title: string;
  description: string;
}

export function WebServerCard({ myIp, title, description }: WebServerCardProps) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(webServerCardReducer, initialWebServerCardState);
  const {
    busyCode,
    enabled,
    error,
    lanExposure,
    loading,
    pairingCode,
    pairingRemaining,
    port,
    saving,
    sessions,
    status,
  } = state;

  const statusUrl = useMemo(() => {
    const host = myIp?.trim() || '<IP>';
    return `http://${host}:${port || DEFAULT_WEB_PORT}`;
  }, [myIp, port]);

  const load = useCallback(async () => {
    dispatch({ type: 'load_start' });
    try {
      const [nextStatus, nextSessions] = await Promise.all([
        webServerApi.status(),
        webServerApi.listSessions(),
      ]);
      dispatch({
        type: 'load_success',
        status: nextStatus,
        sessions: nextSessions,
      });
    } catch (err) {
      logTauriError('load Web Server settings', err);
      dispatch({ type: 'load_error', error: t('settings.webserver.load_error') });
    } finally {
      dispatch({ type: 'load_end' });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pairingCode || pairingRemaining <= 0) return;
    const id = window.setInterval(() => {
      dispatch({ type: 'tick_pairing_remaining' });
    }, 1000);
    return () => window.clearInterval(id);
  }, [pairingCode, pairingRemaining]);

  const saveConfig = async (
    nextEnabled = enabled,
    nextPort = port,
    nextLanExposure = lanExposure,
  ) => {
    const normalizedPort = Math.max(1, Math.min(65535, Number(nextPort) || DEFAULT_WEB_PORT));
    dispatch({ type: 'set_saving', saving: true });
    dispatch({ type: 'set_error', error: null });
    try {
      await webServerApi.setConfig(nextEnabled, normalizedPort, nextLanExposure);
      dispatch({ type: 'set_enabled', enabled: nextEnabled });
      dispatch({ type: 'set_port', port: normalizedPort });
      dispatch({ type: 'set_lan_exposure', lanExposure: nextLanExposure });
      dispatch({
        type: 'set_status',
        status: status
          ? {
              ...status,
              enabled: nextEnabled,
              port: normalizedPort,
              lan_exposure: nextLanExposure,
            }
          : {
              enabled: nextEnabled,
              running: nextEnabled,
              port: normalizedPort,
              lan_exposure: nextLanExposure,
            },
      });
    } catch (err) {
      logTauriError('save Web Server settings', err);
      dispatch({ type: 'set_error', error: t('settings.webserver.save_error') });
    } finally {
      dispatch({ type: 'set_saving', saving: false });
    }
  };

  const generateCode = async () => {
    dispatch({ type: 'set_busy_code', busyCode: true });
    dispatch({ type: 'set_error', error: null });
    try {
      const code = await webServerApi.generatePairingCode();
      dispatch({ type: 'set_pairing_code', pairingCode: code });
      dispatch({
        type: 'set_pairing_remaining',
        pairingRemaining: PAIRING_CODE_TTL_SECS,
      });
    } catch (err) {
      logTauriError('generate Web Server pairing code', err);
      dispatch({ type: 'set_error', error: t('settings.webserver.code_error') });
    } finally {
      dispatch({ type: 'set_busy_code', busyCode: false });
    }
  };

  const revoke = async (id: string) => {
    dispatch({ type: 'set_error', error: null });
    try {
      await webServerApi.revokeSession(id);
      dispatch({ type: 'remove_session', sessionId: id });
    } catch (err) {
      logTauriError('revoke Web Server session', err);
      dispatch({ type: 'set_error', error: t('settings.webserver.revoke_error') });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/35 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('settings.webserver.loading')}
          </div>
        ) : (
          <>
            <label
              htmlFor="webServerEnabled"
              className="grid cursor-pointer gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.webserver.enable_title')}</p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {t('settings.webserver.enable_description')}
                </p>
              </div>
              <input
                id="webServerEnabled"
                type="checkbox"
                className="size-4 rounded border-input accent-primary"
                checked={enabled}
                disabled={saving}
                onChange={(e) => {
                  void saveConfig(e.target.checked, port);
                }}
              />
            </label>

            <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('settings.webserver.port')}</p>
                <p className="text-xs leading-5 break-words text-muted-foreground">
                  {t('settings.webserver.restart_note')}
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={65535}
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                value={port}
                disabled={saving}
                aria-label={t('settings.webserver.port')}
                onChange={(e) =>
                  dispatch({ type: 'set_port', port: Number(e.target.value) })
                }
                onBlur={() => {
                  void saveConfig(enabled, port);
                }}
              />
            </div>

            {enabled && (
              <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
                <label
                  htmlFor="webServerLanExposure"
                  className="grid cursor-pointer gap-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t('settings.webserver.lan_title')}</p>
                    <p className="text-xs leading-5 break-words text-muted-foreground">
                      {t('settings.webserver.lan_description')}
                    </p>
                  </div>
                  <input
                    id="webServerLanExposure"
                    type="checkbox"
                    className="size-4 rounded border-input accent-primary"
                    checked={lanExposure}
                    disabled={saving}
                    onChange={(e) => {
                      void saveConfig(enabled, port, e.target.checked);
                    }}
                  />
                </label>
                {lanExposure && (
                  <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-5 text-amber-200">
                    <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{t('settings.webserver.lan_warning')}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-2 rounded-md border border-border/70 bg-background/35 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Link className="size-4 text-muted-foreground" />
                {t('settings.webserver.status_url')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">
                  {statusUrl}
                </code>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    status?.running
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400',
                  )}
                >
                  {status?.running
                    ? t('settings.webserver.running')
                    : t('settings.webserver.stopped')}
                </span>
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8"
                  disabled={busyCode}
                  onClick={() => void generateCode()}
                >
                  {busyCode ? t('settings.webserver.generating') : t('settings.webserver.generate_code')}
                </Button>
                {pairingCode && pairingRemaining > 0 && (
                  <>
                    <code className="rounded bg-muted px-2 py-1 font-mono text-lg tracking-widest text-foreground">
                      {pairingCode}
                    </code>
                    <span className="text-xs text-muted-foreground">
                      {t('settings.webserver.code_expires', { seconds: pairingRemaining })}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-border/70 bg-background/35 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Smartphone className="size-4 text-muted-foreground" />
                {t('settings.webserver.sessions_title')}
              </div>
              {sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('settings.webserver.no_sessions')}
                </p>
              ) : (
                <div className="grid gap-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-2 rounded border border-border/60 bg-background/40 p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{session.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('settings.webserver.session_expires', {
                            date: new Date(session.expires_at * 1000).toLocaleString(),
                          })}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8"
                        onClick={() => void revoke(session.id)}
                      >
                        {t('settings.webserver.revoke')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>{t('settings.webserver.security_warning')}</span>
            </div>
          </>
        )}

        {error && (
          <div className="flex gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs leading-5 text-red-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
