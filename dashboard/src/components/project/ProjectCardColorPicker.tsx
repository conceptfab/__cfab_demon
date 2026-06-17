import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';

import { AppTooltip } from '@/components/ui/app-tooltip';
import { Button } from '@/components/ui/button';
import { PROJECT_COLORS } from '@/lib/project-colors';

type ProjectCardColorPickerProps = {
  projectColor: string;
  pendingColor: string | null;
  isOpen: boolean;
  onPendingColorChange: (color: string) => void;
  onSavePendingColor: () => void;
  onSelectPresetColor: (color: string) => void;
  onToggle: () => void;
};

export function ProjectCardColorPicker({
  projectColor,
  pendingColor,
  isOpen,
  onPendingColorChange,
  onSavePendingColor,
  onSelectPresetColor,
  onToggle,
}: ProjectCardColorPickerProps) {
  const { t } = useTranslation();

  return (
    <div className="relative group shrink-0">
      <AppTooltip content={t('projects.labels.change_color')}>
        <button
          type="button"
          aria-label={t('projects.labels.change_color')}
          className="flex size-11 items-center justify-center rounded-full border-0 bg-transparent p-0 cursor-pointer hover:scale-105 transition-transform sm:size-7"
          onClick={onToggle}
        >
          <span
            className="size-3 rounded-full"
            style={{
              backgroundColor: isOpen && pendingColor ? pendingColor : projectColor,
            }}
          />
        </button>
      </AppTooltip>
      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 rounded border bg-popover p-2 shadow-md">
          <div className="flex items-center gap-1">
            <input
              type="color"
              defaultValue={projectColor}
              className="h-8 w-16 cursor-pointer rounded border border-border"
              aria-label={t('projects.labels.choose_color')}
              onChange={(event) => onPendingColorChange(event.target.value)}
              title={t('projects.labels.choose_color')}
            />
            {pendingColor && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-green-500 hover:text-green-400"
                aria-label={t('projects.labels.save')}
                onClick={onSavePendingColor}
                title={t('projects.labels.save')}
              >
                <Save className="size-4" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex gap-1">
            {PROJECT_COLORS.map((color) => (
              <AppTooltip key={color} content={color}>
                <button
                  type="button"
                  className="size-5 rounded-full border border-white/10 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  onClick={() => onSelectPresetColor(color)}
                  aria-label={`${t('projects.labels.choose_color')}: ${color}`}
                />
              </AppTooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
