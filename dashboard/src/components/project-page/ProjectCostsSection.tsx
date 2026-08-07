import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sumCosts } from '@/lib/costs-utils';
import type { ProjectCost } from '@/lib/tauri/costs';
import { formatMoney } from '@/lib/utils';

interface ProjectCostsSectionProps {
  costs: ProjectCost[];
  currencyCode: string;
  loading: boolean;
  error: string | null;
  onAdd: () => void;
  onEdit: (cost: ProjectCost) => void;
  onDelete: (cost: ProjectCost) => void;
}

export function ProjectCostsSection({
  costs,
  currencyCode,
  loading,
  error,
  onAdd,
  onEdit,
  onDelete,
}: ProjectCostsSectionProps) {
  const { t } = useTranslation();
  const total = sumCosts(costs);

  // Szerokości kolumn w tabeli poniżej: data i akcje wąskie i stałe, komentarz
  // zabiera resztę — inaczej długi komentarz spycha kwotę poza widok.

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('costs.section_title')}
        </CardTitle>
        <Button size="sm" onClick={onAdd}>
          <Plus className="mr-1 h-4 w-4" />
          {t('costs.add')}
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t('costs.loading')}
          </p>
        ) : error ? (
          <p className="py-4 text-sm text-destructive">{error}</p>
        ) : costs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t('costs.empty')}
          </p>
        ) : (
          <>
            {/* Desktop: tabela. Mobile: lista kart — ten sam kod serwuje webui na telefonie. */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="w-28 py-2 pr-4 font-medium">
                    {t('costs.column_date')}
                  </th>
                  <th className="w-32 py-2 pr-6 text-right font-medium">
                    {t('costs.column_amount')}
                  </th>
                  <th className="py-2 pr-4 font-medium">
                    {t('costs.column_comment')}
                  </th>
                  <th className="w-24 py-2 text-right font-medium">
                    {t('costs.column_actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {costs.map((cost) => (
                  <tr key={cost.uid} className="border-t">
                    <td className="py-2 pr-4 tabular-nums">{cost.cost_date}</td>
                    <td className="py-2 pr-6 text-right tabular-nums">
                      {formatMoney(cost.amount, currencyCode)}
                    </td>
                    <td className="break-words py-2 pr-4 text-muted-foreground">
                      {cost.comment ?? t('ui.common.not_available')}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onEdit(cost)}
                        aria-label={t('costs.edit')}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(cost)}
                        aria-label={t('costs.delete')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="space-y-2 md:hidden">
              {costs.map((cost) => (
                <li key={cost.uid} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">{cost.cost_date}</span>
                    <span className="tabular-nums">
                      {formatMoney(cost.amount, currencyCode)}
                    </span>
                  </div>
                  {cost.comment ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cost.comment}
                    </p>
                  ) : null}
                  <div className="mt-2 flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onEdit(cost)}
                      aria-label={t('costs.edit')}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onDelete(cost)}
                      aria-label={t('costs.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex justify-between border-t pt-3 text-sm font-medium">
              <span>{t('costs.total')}</span>
              <span className="tabular-nums">
                {formatMoney(total, currencyCode)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
