import { ChevronDown, ChevronRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { ClientsPageController } from '@/hooks/useClientsPageController';
import { statusTextClass } from '@/lib/project-status';
import { cn } from '@/lib/utils';
import {
  CLIENT_FORM_SELECT_CLASS,
  CLIENT_PROJECT_STATUSES,
} from '@/pages/clients/clients-page-constants';
import type { ProjectStatus } from '@/lib/tauri';

type ClientsAssignSectionProps = Pick<
  ClientsPageController,
  | 'activeClientNames'
  | 'onAssignClient'
  | 'onAssignStatus'
  | 'openProject'
  | 'projects'
  | 'setShowAssign'
  | 'showAssign'
  | 't'
>;

export function ClientsAssignSection({
  activeClientNames,
  onAssignClient,
  onAssignStatus,
  openProject,
  projects,
  setShowAssign,
  showAssign,
  t,
}: ClientsAssignSectionProps) {
  return (
    <Card>
      <button
        type="button"
        onClick={() => setShowAssign((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold">
          {showAssign ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
          {t('clients_page.assign.title')}
        </span>
        <span className="text-xs text-muted-foreground">{projects.length}</span>
      </button>
      {showAssign && (
        <CardContent>
          <div className="grid grid-cols-[1fr_160px_130px] gap-2 border-b border-border/50 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>{t('clients_page.assign.project')}</span>
            <span>{t('clients_page.assign.client')}</span>
            <span>{t('clients_page.assign.status')}</span>
          </div>
          <div className="divide-y divide-border/40">
            {projects.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[1fr_160px_130px] items-center gap-2 py-1.5 text-sm"
              >
                <button
                  type="button"
                  onClick={() => openProject(p.id)}
                  className="flex min-w-0 items-center gap-2 text-left hover:text-sky-400"
                  title={t('clients_page.open_project')}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="truncate">{p.name}</span>
                </button>
                <select
                  className={CLIENT_FORM_SELECT_CLASS}
                  value={p.client_name ?? ''}
                  onChange={(e) => onAssignClient(p.id, e.target.value)}
                >
                  <option value="">{t('clients_page.assign.no_client')}</option>
                  {activeClientNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <select
                  className={cn(
                    CLIENT_FORM_SELECT_CLASS,
                    'font-medium',
                    statusTextClass(p.status),
                  )}
                  value={
                    CLIENT_PROJECT_STATUSES.includes(p.status) ? p.status : 'active'
                  }
                  onChange={(e) =>
                    onAssignStatus(p.id, e.target.value as ProjectStatus)
                  }
                >
                  {CLIENT_PROJECT_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {t(`clients_page.status.${st}`)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
