import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  EstimatesProjectsDesktopTable,
  EstimatesProjectsMobileList,
} from '@/components/estimates/EstimatesProjectsLists';
import type { EstimatesPageController } from '@/hooks/useEstimatesPageController';

interface EstimatesProjectsSectionProps {
  controller: EstimatesPageController;
}

export function EstimatesProjectsSection({
  controller,
}: EstimatesProjectsSectionProps) {
  const { t } = useTranslation();
  const {
    loading,
    filteredRows,
    setCurrentPage,
    tableError,
    tableMessage,
    ...listProps
  } = controller;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {t('estimates_page.sections.project_estimates')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tableError && (
          <p className="text-xs text-destructive">{tableError}</p>
        )}
        {tableMessage && !tableError && (
          <p className="text-xs text-emerald-400">{tableMessage}</p>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">
            {t('estimates_page.states.loading_estimates')}
          </p>
        ) : filteredRows.length === 0 ? (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <p className="text-sm text-muted-foreground">
              {t('estimates_page.empty.no_active_time')}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage('projects')}
            >
              {t('estimates_page.actions.open_projects')}
            </Button>
          </div>
        ) : (
          <>
            <EstimatesProjectsMobileList {...listProps} rows={filteredRows} />
            <EstimatesProjectsDesktopTable {...listProps} rows={filteredRows} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
