import { ChevronLeft, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ProjectColorPicker } from '@/components/project/ProjectColorPicker';
import { Button } from '@/components/ui/button';
import type { ProjectWithStats } from '@/lib/db-types';

type ProjectOverviewProps = {
  project: ProjectWithStats;
  onBack: () => void;
  onGenerateReport: () => void;
  onSaveColor: (color: string) => Promise<void>;
};

export function ProjectOverview({
  project,
  onBack,
  onGenerateReport,
  onSaveColor,
}: ProjectOverviewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="h-8">
        <ChevronLeft className="mr-1 h-4 w-4" />
        {t('project_page.text.back_to_projects')}
      </Button>
      <div className="h-4 w-[1px] bg-border" />
      <h1
        data-project-id={project.id}
        data-project-name={project.name}
        className="flex items-center gap-2 text-xl font-semibold"
      >
        <ProjectColorPicker
          currentColor={project.color}
          labels={{
            changeColor: t('project_page.text.change_color'),
            chooseColor: t('project_page.text.choose_color'),
            saveColor: t('project_page.text.save_color'),
          }}
          onSave={onSaveColor}
        />
        {project.name}
      </h1>
      <Button
        size="sm"
        className="ml-auto bg-sky-600 text-white hover:bg-sky-700"
        onClick={onGenerateReport}
      >
        <FileText className="mr-2 h-4 w-4" />
        {t('project_page.text.generate_report_pdf')}
      </Button>
    </div>
  );
}
