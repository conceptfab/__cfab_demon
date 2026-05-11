import { FolderSearch, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { FolderScanStatus } from '@/lib/db-types';

interface AiFolderScanCardProps {
  status: FolderScanStatus | null;
  scanning: boolean;
  clearing: boolean;
  onScan: () => void;
  onClear: () => void;
  t: (key: string, interpolation?: Record<string, string | number>) => string;
}

export function AiFolderScanCard({
  status,
  scanning,
  clearing,
  onScan,
  onClear,
  t,
}: AiFolderScanCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          {t('ai_page.folder_scan.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('ai_page.folder_scan.description')}
        </p>

        {status?.has_scan_data && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {status.last_scanned_at && (
              <span>
                {/* react-doctor-disable-next-line rendering-hydration-mismatch-time -- No SSR (Tauri client app) */}
                {t('ai_page.folder_scan.last_scan')}: {new Date(status.last_scanned_at).toLocaleString()}
              </span>
            )}
            <span>
              {t('ai_page.folder_scan.projects_count')}: {status.projects_count}
            </span>
            <span>
              {t('ai_page.folder_scan.tokens_count')}: {status.tokens_count}
            </span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            className="h-9"
            onClick={onScan}
            disabled={scanning}
          >
            <FolderSearch className="mr-2 size-4" />
            {scanning
              ? t('ai_page.folder_scan.scanning')
              : t('ai_page.folder_scan.scan_button')}
          </Button>

          {status?.has_scan_data && (
            <Button
              variant="outline"
              className="h-9"
              onClick={onClear}
              disabled={clearing}
            >
              <Trash2 className="mr-2 size-4" />
              {clearing
                ? t('ai_page.folder_scan.clearing')
                : t('ai_page.folder_scan.clear_button')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
