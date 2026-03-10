import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { AssignmentMode } from '@/lib/db-types';

export interface AiSettingsFormValues {
  mode: AssignmentMode;
  suggestConf: number;
  autoConf: number;
  autoEvidence: number;
  trainingHorizonDays: number;
  feedbackWeight: number;
  trainingAppBlacklistText: string;
  trainingFolderBlacklistText: string;
}

interface AiSettingsFormProps {
  values: AiSettingsFormValues;
  saving: boolean;
  onChange: (patch: Partial<AiSettingsFormValues>) => void;
  onSave: () => void;
}

export function AiSettingsForm({
  values,
  saving,
  onChange,
  onSave,
}: AiSettingsFormProps) {
  const { t: tr } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          {tr('ai_page.text.mode_and_thresholds')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.model_operation_mode')}
            </span>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={values.mode}
              onChange={(e) =>
                onChange({ mode: e.target.value as AssignmentMode })
              }
            >
              <option value="off">{tr('ai_page.text.off_manual')}</option>
              <option value="suggest">{tr('ai_page.text.ai_suggestions')}</option>
              <option value="auto_safe">{tr('ai_page.text.auto_safe')}</option>
            </select>
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.suggest_min_confidence_0_1')}
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={values.suggestConf}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value);
                onChange({ suggestConf: Number.isNaN(next) ? 0 : next });
              }}
            />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.auto_safe_min_confidence_0_1')}
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={values.autoConf}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value);
                onChange({ autoConf: Number.isNaN(next) ? 0 : next });
              }}
            />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.auto_safe_min_evidence_1_50')}
            </span>
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={values.autoEvidence}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                onChange({ autoEvidence: Number.isNaN(next) ? 1 : next });
              }}
            />
          </label>

          <label className="space-y-1.5 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.training_horizon_days')}
            </span>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={30}
                max={730}
                step={1}
                className="h-9 w-full"
                value={values.trainingHorizonDays}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  onChange({
                    trainingHorizonDays: Number.isNaN(next) ? 730 : next,
                  });
                }}
              />
              <span className="min-w-[5rem] text-right text-xs text-muted-foreground">
                {values.trainingHorizonDays} {tr('ai_page.text.days')}
              </span>
            </div>
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.feedback_weight_1_50')}
            </span>
            <input
              type="number"
              min={1}
              max={50}
              step={0.5}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={values.feedbackWeight}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value);
                onChange({ feedbackWeight: Number.isNaN(next) ? 5 : next });
              }}
            />
          </label>

          <label className="space-y-1.5 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.text.applications_blacklist_exe_one_per_line')}
            </span>
            <textarea
              className="min-h-[90px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              value={values.trainingAppBlacklistText}
              onChange={(e) =>
                onChange({ trainingAppBlacklistText: e.target.value })
              }
              placeholder={tr('ai_page.text.e_g_chrome_exe')}
            />
          </label>

          <label className="space-y-1.5 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">
              {tr('ai_page.fields.folders_blacklist')}
            </span>
            <textarea
              className="min-h-[90px] w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
              value={values.trainingFolderBlacklistText}
              onChange={(e) =>
                onChange({ trainingFolderBlacklistText: e.target.value })
              }
              placeholder={tr('ai_page.text.e_g_c_users_me_downloads')}
            />
          </label>
        </div>

        <div className="flex justify-end">
          <Button className="h-9 min-w-[9rem]" onClick={onSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving
              ? tr('ai_page.text.saving')
              : tr('ai_page.text.save_model_settings')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
