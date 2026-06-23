import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useUIStore } from '@/store/ui-store';
import { useSettingsStore } from '@/store/settings-store';
import { useDataStore } from '@/store/data-store';
import { formatMoney, getErrorMessage, cn } from '@/lib/utils';
import { statusTextClass } from '@/lib/project-status';
import { RoundedDuration } from '@/components/ui/RoundedDuration';
import { ALL_TIME_DATE_RANGE } from '@/lib/date-helpers';
import { useToast } from '@/components/ui/toast-notification';
import {
  clientsList,
  getClientsSummary,
  projectSetStatus,
  type Client,
  type ClientSummary,
  type ProjectStatus,
} from '@/lib/tauri';

// Mirrors the Projects tab status (frozen/excluded derived) — single source of truth.
const STATUSES: ProjectStatus[] = ['active', 'frozen', 'excluded'];

export function ClientPage() {
  const { t } = useTranslation();
  const { showError } = useToast();
  const clientName = useUIStore((s) => s.clientPageName);
  const setCurrentPage = useUIStore((s) => s.setCurrentPage);
  const setProjectPageId = useUIStore((s) => s.setProjectPageId);
  const currencyCode = useSettingsStore((s) => s.currencyCode);
  const refreshKey = useDataStore((s) => s.refreshKey);
  const triggerRefresh = useDataStore((s) => s.triggerRefresh);

  const openProject = (projectId: number) => {
    setProjectPageId(projectId);
    setCurrentPage('project-card');
  };

  const onSetStatus = async (projectId: number, status: ProjectStatus) => {
    try {
      await projectSetStatus(projectId, status);
      triggerRefresh('settings_saved');
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    }
  };

  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!clientName) return;
    try {
      const [summaries, clients] = await Promise.all([
        getClientsSummary(ALL_TIME_DATE_RANGE),
        clientsList(),
      ]);
      setSummary(
        summaries.find((s) => s.client_name === clientName) ?? null,
      );
      setClient(clients.find((c) => c.name === clientName) ?? null);
    } catch (err) {
      showError(getErrorMessage(err, t('clients_page.error')));
    } finally {
      setLoading(false);
    }
  }, [clientName, showError, t]);

  useEffect(() => {
    // load() ustawia dwa stany (summary + client) i reaguje na refreshKey.
    // useAsyncData zwraca pojedynczy data: T|null — wymagałoby krotki lub obiektu
    // i dodatkowego unwrappowania; zysk zerowy przy ryzyku regresji.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- two-state loader (summary + client) with refreshKey dep; useAsyncData would require a tuple wrapper with no benefit
    void load();
  }, [load, refreshKey]);

  const projects = useMemo(
    () =>
      (summary?.projects ?? []).toSorted((a, b) => b.value - a.value),
    [summary],
  );

  const back = (
    <Button variant="ghost" size="sm" onClick={() => setCurrentPage('clients')} className="h-8">
      <ChevronLeft className="mr-1 size-4" />
      {t('clients_page.back')}
    </Button>
  );

  if (!clientName) {
    return <div className="p-8 text-sm text-muted-foreground">{back}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-20">
      <div>{back}</div>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className="size-5 rounded-full"
          style={{ backgroundColor: summary?.color ?? client?.color ?? '#38bdf8' }}
        />
        <h1 className="text-xl font-semibold">{clientName}</h1>
      </div>
      {client && (client.contact || client.address || client.tax_id || client.currency) && (
        <p className="text-sm text-muted-foreground">
          {[
            client.contact,
            client.tax_id ? `${t('clients_page.field.tax_id')}: ${client.tax_id}` : null,
            client.address,
            client.currency,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {/* KPI — global total only */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi label={t('clients_page.summary.total_value')} value={formatMoney(summary?.total_value ?? 0, currencyCode)} accent="text-sky-400" />
      </div>
      <div className="text-sm text-muted-foreground">
        {t('clients_page.card.projects', { n: summary?.project_count ?? 0 })} ·{' '}
        <RoundedDuration seconds={summary?.total_seconds ?? 0} dailySeconds={summary?.daily_seconds ?? []} />
      </div>
      <p className="rounded-md border border-border/50 bg-background/40 p-2 text-xs text-muted-foreground">
        {t('clients_page.status_hint')}
      </p>

      {/* Projects */}
      <Card>
        <CardContent className="p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('clients_page.no_projects')}</p>
          ) : (
            <div className="divide-y divide-border/40">
              {projects.map((p) => (
                <div key={p.project_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <button
                    type="button"
                    onClick={() => openProject(p.project_id)}
                    className="flex min-w-0 items-center gap-2 text-left hover:text-sky-400"
                    title={t('clients_page.open_project')}
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.project_color }} />
                    <span className="truncate">{p.project_name}</span>
                  </button>
                  <span className="flex shrink-0 items-center gap-3 font-mono text-xs">
                    <select
                      value={STATUSES.includes(p.status) ? p.status : 'active'}
                      onChange={(e) => onSetStatus(p.project_id, e.target.value as ProjectStatus)}
                      className={cn('rounded-md border border-input bg-background px-1.5 py-1 text-xs font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40', statusTextClass(p.status))}
                    >
                      {STATUSES.map((st) => (
                        <option key={st} value={st}>{t(`clients_page.status.${st}`)}</option>
                      ))}
                    </select>
                    <span className="text-muted-foreground"><RoundedDuration seconds={p.seconds} dailySeconds={p.daily_seconds} /></span>
                    <span className="w-24 text-right">{formatMoney(p.value, currencyCode)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <Card className="border-border/70">
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-xl font-semibold ${accent}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
