import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NO_CLIENT_KEY } from '@/lib/estimate-report';

interface EstimatesClientFilterProps {
  clientOptions: string[];
  selectedClients: Set<string>;
  toggleClient: (key: string) => void;
  clearClientFilter: () => void;
}

export function EstimatesClientFilter({
  clientOptions,
  selectedClients,
  toggleClient,
  clearClientFilter,
}: EstimatesClientFilterProps) {
  const { t } = useTranslation();
  if (clientOptions.length === 0) return null;

  const label = (key: string) =>
    key === NO_CLIENT_KEY ? t('estimates_page.client_filter.no_client') : key;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Users className="size-4" />
          {t('estimates_page.client_filter.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {clientOptions.map((key) => {
            const active = selectedClients.size === 0 || selectedClients.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleClient(key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-sky-500/60 bg-sky-500/10 text-foreground'
                    : 'border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                {label(key)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {selectedClients.size === 0
              ? t('estimates_page.client_filter.all_selected')
              : t('estimates_page.client_filter.selected_count', {
                  count: selectedClients.size,
                })}
          </span>
          {selectedClients.size > 0 && (
            <Button variant="ghost" size="sm" onClick={clearClientFilter}>
              {t('estimates_page.client_filter.clear')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
