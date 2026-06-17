import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { CurrencyCard } from '@/components/settings/CurrencyCard';
import { LanguageCard } from '@/components/settings/LanguageCard';
import { WorkingHoursCard } from '@/components/settings/WorkingHoursCard';
import type { AppLanguageCode } from '@/lib/user-settings';
import type { SettingsPageController } from '@/hooks/useSettingsPageController';
import {
  SETTINGS_HOURS,
  SETTINGS_MINUTES,
} from '@/pages/settings/settings-page-constants';

type SettingsGeneralTabProps = SettingsPageController;

export function SettingsGeneralTab({
  appearanceSettings,
  compactSelectClassName,
  currencyOptions,
  currencySettings,
  endHour,
  endMinute,
  labelClassName,
  languageOptions,
  languageSettings,
  normalizedColor,
  startHour,
  startMinute,
  t,
  updateAppearanceSettings,
  updateCurrencySettings,
  updateLanguageSettings,
  updateTimePart,
  updateWorkingHours,
  workingHoursError,
}: SettingsGeneralTabProps) {
  return (
    <div className="space-y-4">
      <WorkingHoursCard
        title={t('settings_page.working_hours')}
        description={t(
          'settings_page.used_to_highlight_expected_work_window_on_timeline',
        )}
        fromLabel={t('settings_page.from')}
        toLabel={t('settings_page.to')}
        highlightColorLabel={t('settings_page.highlight_color')}
        labelClassName={labelClassName}
        compactSelectClassName={compactSelectClassName}
        hours={SETTINGS_HOURS}
        minutes={SETTINGS_MINUTES}
        startHour={startHour}
        startMinute={startMinute}
        endHour={endHour}
        endMinute={endMinute}
        normalizedColor={normalizedColor}
        errorText={workingHoursError}
        onTimePartChange={updateTimePart}
        onColorChange={(color) => {
          updateWorkingHours((prev) => ({ ...prev, color }));
        }}
      />

      <CurrencyCard
        title={t('settings_page.currency')}
        description={t(
          'settings_page.select_preferred_currency_for_project_values',
        )}
        activeCurrencyLabel={t('settings_page.active_currency')}
        labelClassName={labelClassName}
        currencies={currencyOptions}
        selectedCode={currencySettings.code}
        onSelectCurrency={(code) => {
          updateCurrencySettings({ code });
        }}
      />

      <LanguageCard
        title={t('settings.language.title')}
        description={t('settings.language.description')}
        fieldLabel={t('settings.language.field')}
        rolloutNote={t('settings.language.rollout_note')}
        labelClassName={labelClassName}
        options={languageOptions}
        selectedCode={languageSettings.code}
        onSelectLanguage={(code) => {
          updateLanguageSettings({ code: code as AppLanguageCode });
        }}
      />

      <AppearanceCard
        title={t('settings_page.appearance_performance')}
        description={t(
          'settings_page.adjust_visual_effects_and_performance_options',
        )}
        animationsTitle={t('settings_page.enable_chart_animations')}
        animationsDescription={t(
          'settings_page.turn_off_to_improve_ui_responsiveness_on_slower_devices',
        )}
        checked={appearanceSettings.chartAnimations}
        onToggle={(enabled) => {
          updateAppearanceSettings((prev) => ({
            ...prev,
            chartAnimations: enabled,
          }));
        }}
      />
    </div>
  );
}
