import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PROJECT_COLORS } from '@/lib/project-colors';
import { getErrorMessage } from '@/lib/utils';

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectCount: number;
  onSave: (name: string, color: string, folderPath: string) => Promise<void>;
}

export function CreateProjectDialog({
  open: isOpen,
  onOpenChange,
  projectCount,
  onSave,
}: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [color, setColor] = useState(
    PROJECT_COLORS[projectCount % PROJECT_COLORS.length],
  );
  const [folderPath, setFolderPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setName('');
      setFolderPath('');
      setError(null);
      setColor(PROJECT_COLORS[projectCount % PROJECT_COLORS.length]);
    }
    onOpenChange(next);
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('projects.dialogs.select_assigned_project_folder'),
      });
      if (selected && typeof selected === 'string') {
        setFolderPath(selected);
        setError(null);
      }
    } catch (e) {
      console.error('Failed to open folder dialog:', e);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('projects.errors.project_name_required'));
      return;
    }
    if (!folderPath.trim()) {
      setError(t('projects.errors.project_folder_required'));
      return;
    }
    setError(null);
    try {
      await onSave(name.trim(), color, folderPath.trim());
      onOpenChange(false);
      setName('');
      setFolderPath('');
    } catch (e) {
      setError(getErrorMessage(e, 'Failed to create project'));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('projects_page.new_project')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">
              {t('projects_page.name')}
            </label>
            <input
              className="mt-1 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t('projects_page.project_name')}
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              {t('projects_page.assigned_folder')}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={folderPath}
                onChange={(e) => {
                  setFolderPath(e.target.value);
                  setError(null);
                }}
                placeholder={t('projects_page.c_projects_my_new_app')}
              />
              <Button size="sm" variant="outline" onClick={handleBrowse}>
                {t('projects_page.browse')}
              </Button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">
              {t('projects_page.color')}
            </label>
            <div className="mt-1 flex gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  className="h-8 w-8 rounded-full border-2 transition-transform"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#fff' : 'transparent',
                    transform: color === c ? 'scale(1.1)' : 'scale(1)',
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={handleSave} className="w-full mt-2">
            {t('projects.actions.create')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
