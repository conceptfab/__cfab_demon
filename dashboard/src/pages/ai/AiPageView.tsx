import { AiBatchActionsCard } from '@/components/ai/AiBatchActionsCard';
import { AiFolderScanCard } from '@/components/ai/AiFolderScanCard';
import { AiHowToCard } from '@/components/ai/AiHowToCard';
import { AiMetricsCharts } from '@/components/ai/AiMetricsCharts';
import { AiModelStatusCard } from '@/components/ai/AiModelStatusCard';
import { AiSessionIndicatorsCard } from '@/components/ai/AiSessionIndicatorsCard';
import { AiSettingsForm } from '@/components/ai/AiSettingsForm';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AiPageController } from '@/hooks/useAiPageController';
import { AiTrainingReminderCard } from '@/pages/ai/AiTrainingReminderCard';

interface AiPageViewProps {
  controller: AiPageController;
}

export function AiPageView({ controller }: AiPageViewProps) {
  const {
    autoLimit,
    confirmDialogProps,
    handleAutoLimitChange,
    handleClearFolderScan,
    handleFolderScan,
    handleIndicatorToggle,
    handleRefreshStatus,
    handleResetFull,
    handleResetWeights,
    handleRollback,
    handleRunAutoSafe,
    handleSaveMode,
    handleSettingsChange,
    highlightTrainAction,
    howToSections,
    indicatorItems,
    indicators,
    loadingMetrics,
    metrics,
    resettingKnowledge,
    refreshingStatus,
    rollingBack,
    runningAuto,
    savingMode,
    scanStatus,
    scanning,
    clearingScan,
    settingsFormValues,
    status,
    training,
    trainingReminder,
    translate,
    tr,
  } = controller;

  return (
    <>
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <AiModelStatusCard
          status={status}
          training={training}
          refreshingStatus={refreshingStatus}
          resettingKnowledge={resettingKnowledge}
          highlightTrainAction={highlightTrainAction}
          snoozedUntil={trainingReminder.cooldownUntil}
          reminderSuppressed={!trainingReminder.shouldShow}
          onTrainNow={() => {
            void controller.handleTrainNow();
          }}
          onFullRebuild={() => {
            void controller.handleTrainNow(true);
          }}
          onRefreshStatus={() => {
            void handleRefreshStatus();
          }}
          onResetWeights={handleResetWeights}
          onResetFull={handleResetFull}
        />

        <AiFolderScanCard
          status={scanStatus}
          scanning={scanning}
          clearing={clearingScan}
          onScan={() => {
            void handleFolderScan();
          }}
          onClear={() => {
            void handleClearFolderScan();
          }}
          t={translate}
        />

        <AiMetricsCharts metrics={metrics} loading={loadingMetrics} />

        <AiTrainingReminderCard {...controller} />

        <AiSettingsForm
          values={settingsFormValues}
          saving={savingMode}
          onChange={handleSettingsChange}
          onSave={() => {
            void handleSaveMode();
          }}
        />

        <AiSessionIndicatorsCard
          title={tr('ai_page.text.session_indicators')}
          description={tr(
            'ai_page.text.configure_which_ai_indicators_and_feedback_contr',
          )}
          items={indicatorItems}
          indicators={indicators}
          onToggle={handleIndicatorToggle}
        />

        <AiBatchActionsCard
          title={tr('ai_page.text.batch_auto_safe_actions')}
          sessionLimitLabel={tr('ai_page.text.session_limit_per_run')}
          autoLimit={autoLimit}
          onAutoLimitChange={handleAutoLimitChange}
          runLabel={tr('ai_page.text.run_auto_safe')}
          runStartingLabel={tr('ai_page.text.starting')}
          rollbackLabel={tr('ai_page.text.rollback_last_auto_safe_batch')}
          rollbackRunningLabel={tr('ai_page.text.rolling_back')}
          rollbackHint={tr(
            'ai_page.text.rollback_only_reverts_sessions_that_have_not_bee',
          )}
          modeIsAutoSafe={status?.mode === 'auto_safe'}
          runningAuto={runningAuto}
          rollingBack={rollingBack}
          canRollbackLastRun={Boolean(status?.can_rollback_last_auto_run)}
          onRun={handleRunAutoSafe}
          onRollback={handleRollback}
        />

        <AiHowToCard
          title={tr('ai_page.text.how_to_train_and_configure')}
          sections={howToSections}
        />
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
