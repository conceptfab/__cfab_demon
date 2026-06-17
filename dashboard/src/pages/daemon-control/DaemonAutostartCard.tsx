import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DaemonControlController } from '@/hooks/useDaemonControlController';

type DaemonAutostartCardProps = Pick<
  DaemonControlController,
  'handleAutostartToggle' | 'status' | 't'
>;

export function DaemonAutostartCard({
  handleAutostartToggle,
  status,
  t,
}: DaemonAutostartCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          {t('daemon_page.autostart_title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('daemon_page.autostart_description')}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            {status?.autostart
              ? t('daemon_page.enabled')
              : t('daemon_page.disabled')}
          </span>
          <button
            type="button"
            onClick={handleAutostartToggle}
            role="switch"
            aria-checked={!!status?.autostart}
            aria-label={t('daemon_page.autostart')}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              status?.autostart ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <span
              className={`inline-block size-5 rounded-full bg-white transition-transform ${
                status?.autostart ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
