import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { open } from '@tauri-apps/plugin-dialog';
import { pmApi } from '@/lib/tauri/pm';
import type { PmSettings } from '@/lib/pm-types';
import { logTauriError } from '@/lib/utils';
import { PmTemplateManager } from '@/components/pm/PmTemplateManager';

export function PmSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PmSettings | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const sett = await pmApi.getPmSettings();
      setSettings(sett);
    } catch {
      setSettings({ work_folder: '', settings_folder: '00_PM_NX' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSetWorkFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === 'string') {
        await pmApi.setPmWorkFolder(selected);
        await load();
      }
    } catch (e) {
      logTauriError('pm set work folder', e);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('pm.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Work folder */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('pm.settings_work_folder')}
            </label>
            <p className="text-[10px] text-muted-foreground">{t('pm.settings_work_folder_desc')}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm font-mono truncate min-h-[32px]">
                {settings?.work_folder || t('pm.no_work_folder')}
              </div>
              <Button variant="outline" size="sm" onClick={handleSetWorkFolder}>
                <FolderOpen className="mr-1.5 size-3.5" />
                {t('pm.set_work_folder')}
              </Button>
            </div>
            {settings?.work_folder && (
              <p className="text-[10px] text-muted-foreground">
                {t('pm.settings_json_path')}: {settings.work_folder}/00_PM_NX/projects_list.json
              </p>
            )}
          </div>

          {/* Templates */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              {t('pm.templates')}
            </label>
            <p className="text-[10px] text-muted-foreground">{t('pm.settings_templates_desc')}</p>
            <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)} disabled={!settings?.work_folder}>
              <LayoutTemplate className="mr-1.5 size-3.5" />
              {t('pm.template_manager.title')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {templatesOpen && (
        <PmTemplateManager
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
    </>
  );
}
