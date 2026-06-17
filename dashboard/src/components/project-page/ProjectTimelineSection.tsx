import { useTranslation } from 'react-i18next';

import { TimelineChart } from '@/components/dashboard/TimelineChart';
import type { ProjectWithStats, StackedBarData } from '@/lib/db-types';

type ProjectTimelineSectionProps = {
  project: ProjectWithStats;
  data: StackedBarData[];
  isLoading: boolean;
  errorMessage: string | null;
  onBarClick: (date: string) => void;
  onBarContextMenu: (date: string, x: number, y: number) => void;
};

export function ProjectTimelineSection({
  project,
  data,
  isLoading,
  errorMessage,
  onBarClick,
  onBarContextMenu,
}: ProjectTimelineSectionProps) {
  const { t } = useTranslation();

  return (
    <TimelineChart
      data={data}
      presentation={{
        title: t('project_page.timeline.activity_over_time'),
        projectColors: { [project.name]: project.color },
        granularity: 'day',
        heightClassName: 'h-64',
      }}
      interaction={{
        onBarClick,
        onBarContextMenu,
      }}
      state={{
        isLoading,
        errorMessage,
      }}
    />
  );
}
