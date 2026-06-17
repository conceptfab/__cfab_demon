import type { RefObject } from 'react';
import type { i18n as I18nInstance, TFunction } from 'i18next';

import type { ManualSessionWithProject } from '@/lib/db-types';
import type { ProjectSessionRow } from '@/components/project-page/ProjectSessionsList';
import type { ProjectPageContextMenu } from '@/components/project-page/project-page-context-menu-utils';

export interface ProjectPageContextMenusProps {
  ctxMenu: ProjectPageContextMenu | null;
  ctxRef: RefObject<HTMLDivElement | null>;
  t: TFunction;
  i18n: I18nInstance;
  sessionCountLabel: (count: number) => string;
  appCountLabel: (count: number) => string;
  showInfo: (message: string) => void;
  setCtxMenu: (menu: ProjectPageContextMenu | null) => void;
  setSessionDialogDate: (date: string | undefined) => void;
  setEditManualSession: (session: ManualSessionWithProject | null) => void;
  setSessionDialogOpen: (open: boolean) => void;
  setSelectedSessionDetail: (session: ProjectSessionRow | null) => void;
  setSessionDetailOpen: (open: boolean) => void;
  handleSetRateMultiplier: (
    multiplier: number | null,
    ids: number[],
  ) => Promise<void>;
  handleCustomRateMultiplier: () => void;
  handleEditComment: () => void;
  handleBulkUnassign: (sessions: ProjectSessionRow[]) => Promise<void>;
  handleBulkDelete: (sessions: ProjectSessionRow[]) => Promise<void>;
  handleAssign: (projectId: number | null) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  deleteManualSessions: (ids: number | number[]) => Promise<void>;
  deleteSessions: (ids: number | number[]) => Promise<void>;
}
