import type { WorkingHoursSettings } from '@/lib/user-settings';
import type {
  ManualSessionWithProject,
  ProjectWithStats,
  SessionWithApp,
} from '@/lib/db-types';

export const EMPTY_MANUAL_SESSIONS: ManualSessionWithProject[] = [];

export interface ProjectDayTimelineProps {
  sessions: SessionWithApp[];
  manualSessions?: ManualSessionWithProject[];
  workingHours?: WorkingHoursSettings;
  title?: string;
  minHeightClassName?: string;
  projects?: ProjectWithStats[];
  onAssignSession?: (
    sessionIds: number[],
    projectId: number | null,
  ) => void | Promise<void>;
  onUpdateSessionRateMultiplier?: (
    sessionIds: number[],
    multiplier: number | null,
  ) => void | Promise<void>;
  onUpdateSessionComment?: (
    sessionId: number,
    comment: string | null,
  ) => void | Promise<void>;
  onAddManualSession?: (startTime?: string) => void;
  onEditManualSession?: (session: ManualSessionWithProject) => void;
}
