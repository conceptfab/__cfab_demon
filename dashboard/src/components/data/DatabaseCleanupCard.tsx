import { Trash2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/utils';
import type { DatabaseManagementController } from '@/hooks/useDatabaseManagementController';

type DatabaseCleanupCardProps = Pick<
  DatabaseManagementController,
  'cleaning' | 'folderStats' | 'handleCleanup' | 't'
>;

export function DatabaseCleanupCard({
  cleaning,
  folderStats,
  handleCleanup,
  t,
}: DatabaseCleanupCardProps) {
  return (
    <Card className="overflow-hidden border-border/40 bg-background/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Trash2 className="size-4 text-amber-500" />
          {t('data_page.database_management.data_cleanup')}
        </CardTitle>
        <CardDescription className="text-xs">
          {t('data_page.database_management.cleanup_description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between p-3 rounded-md bg-accent/30 border border-border/20">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {t('data_page.database_management.cleanup_files_label')}
            </p>
            <p className="text-sm font-medium">
              {folderStats && folderStats.file_count > 0
                ? t('data_page.database_management.cleanup_files_found', {
                    count: folderStats.file_count,
                    size: formatBytes(folderStats.total_bytes),
                  })
                : t('data_page.database_management.cleanup_no_files')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 text-amber-500 hover:text-amber-600"
            onClick={handleCleanup}
            disabled={cleaning || !folderStats || folderStats.file_count === 0}
          >
            <Trash2 className="size-3.5" />
            {cleaning
              ? t('data_page.database_management.cleanup_cleaning')
              : t('data_page.database_management.cleanup_button')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
