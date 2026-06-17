import { ChevronDown, ChevronRight, CircleDollarSign, Wand2 } from 'lucide-react';

import { MetricCard } from '@/components/dashboard/MetricCard';
import { ClientCard } from '@/components/clients/ClientCard';
import { Button } from '@/components/ui/button';
import type { ClientsPageController } from '@/hooks/useClientsPageController';
import { mobileLayout } from '@/lib/mobile-layout';
import { formatMoney } from '@/lib/utils';

type ClientsSummarySectionProps = Pick<
  ClientsPageController,
  | 'activeSummaries'
  | 'clients'
  | 'currencyCode'
  | 'emptySummaries'
  | 'loading'
  | 'onSync'
  | 'openClientPage'
  | 'projects'
  | 'setShowEmptyClients'
  | 'showEmptyClients'
  | 'summaries'
  | 't'
  | 'totalValue'
>;

export function ClientsSummarySection({
  activeSummaries,
  clients,
  currencyCode,
  emptySummaries,
  loading,
  onSync,
  openClientPage,
  projects,
  setShowEmptyClients,
  showEmptyClients,
  summaries,
  t,
  totalValue,
}: ClientsSummarySectionProps) {
  return (
    <>
      {totalValue > 0 && (
        <div className="space-y-1">
          <div className={mobileLayout.metricGrid}>
            <MetricCard
              title={t('clients_page.summary.total_value')}
              value={formatMoney(totalValue, currencyCode)}
              icon={CircleDollarSign}
            />
          </div>
          <p className="text-xs text-muted-foreground/80">
            {t('clients_page.estimate_note')}
          </p>
        </div>
      )}

      {!loading && clients.length === 0 && projects.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-400/40 bg-sky-400/5 p-3">
          <p className="text-sm text-foreground">{t('clients_page.sync_hint')}</p>
          <Button size="sm" onClick={onSync}>
            <Wand2 className="mr-1 size-4" />
            {t('clients_page.sync')}
          </Button>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {t('clients_page.summary.title')}
          </h2>
          <Button size="sm" variant="secondary" onClick={onSync}>
            <Wand2 className="mr-1 size-4" />
            {t('clients_page.sync')}
          </Button>
        </div>
        {summaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('clients_page.empty')}</p>
        ) : (
          <>
            {activeSummaries.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeSummaries.map((s) => (
                  <ClientCard
                    key={s.client_name}
                    summary={s}
                    currencyCode={currencyCode}
                    onClick={() => openClientPage(s.client_name)}
                  />
                ))}
              </div>
            )}
            {emptySummaries.length > 0 && (
              <div className={activeSummaries.length > 0 ? 'mt-3' : ''}>
                <button
                  type="button"
                  onClick={() => setShowEmptyClients((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  {showEmptyClients ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                  {t('clients_page.summary.empty_clients', {
                    n: emptySummaries.length,
                  })}
                </button>
                {showEmptyClients && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {emptySummaries.map((s) => (
                      <ClientCard
                        key={s.client_name}
                        summary={s}
                        currencyCode={currencyCode}
                        onClick={() => openClientPage(s.client_name)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
