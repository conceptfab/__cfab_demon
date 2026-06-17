import { TimeAlgorithmCard } from '@/components/settings/TimeAlgorithmCard';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';

type SettingsAlgorithmTabProps = Pick<
  SettingsPageController,
  | 'handleSelectTimeAlgorithm'
  | 'savingTimeAlgorithm'
  | 't'
  | 'timeAlgorithm'
  | 'timeAlgorithms'
>;

export function SettingsAlgorithmTab({
  handleSelectTimeAlgorithm,
  savingTimeAlgorithm,
  t,
  timeAlgorithm,
  timeAlgorithms,
}: SettingsAlgorithmTabProps) {
  return (
    <div className="space-y-4">
      <TimeAlgorithmCard
        title={t('settings_page.time_algorithm_title')}
        description={t('settings_page.time_algorithm_description')}
        activeBadge={t('settings_page.time_algorithm_active_badge')}
        note={t('settings_page.time_algorithm_note')}
        selectedId={timeAlgorithm}
        disabled={savingTimeAlgorithm}
        onSelect={handleSelectTimeAlgorithm}
        options={timeAlgorithms.map((algo) => ({
          id: algo.id,
          name: t(algo.name),
          description: t(algo.description),
        }))}
      />
    </div>
  );
}
